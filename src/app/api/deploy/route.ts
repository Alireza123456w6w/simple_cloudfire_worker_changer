import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CF = "https://api.cloudflare.com/client/v4";

interface DeployBody {
  accountId?: string;
  apiToken?: string;
  workerName?: string;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** پیام فارسی و قابل‌فهم برای خطاهای رایج Cloudflare */
function friendlyCfError(
  errors: { code?: number; message?: string }[] | undefined,
  status: number
): string {
  const first = errors?.[0];
  const code = first?.code ?? 0;
  const msg = first?.message ?? "خطای ناشناخته";
  if (code === 10000 || code === 9109 || code === 9106 || status === 401 || status === 403) {
    return (
      "توکن API نامعتبر است یا دسترسی کافی ندارد. مطمئن شو از قالب «Edit Cloudflare Workers» ساختی و کل توکن را کپی کردی. (جزئیات: " +
      msg +
      ")"
    );
  }
  if (code === 10041 || status === 404) {
    return (
      "ورکر با این نام پیدا نشد. نام ورکر را چک کن (باید دقیقاً balebot باشد). (" +
      msg +
      ")"
    );
  }
  if (code === 7003 || code === 7000) {
    return (
      "Account ID اشتباه به نظر می‌رسد. از نوار آدرس داشبورد کپی‌اش کن. (" +
      msg +
      ")"
    );
  }
  return `Cloudflare: ${msg} (کد ${code})`;
}

/** تشخیص فایل خالی/placeholder — فایل ناقص هرگز نباید ورکر واقعی را بازنویسی کند */
function looksEmptyWorker(code: string): boolean {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, "") // حذف کامنت‌های بلوکی
    .split("\n")
    .filter((line) => !line.trim().startsWith("//")) // حذف کامنت‌های خطی
    .join("\n")
    .trim();
  return stripped.length < 200 || !stripped.includes("export default");
}

export async function POST(req: Request) {
  let body: DeployBody;
  try {
    body = await req.json();
  } catch {
    return json(
      { ok: false, step: "request", error: "بدنه درخواست نامعتبر است" },
      400
    );
  }

  const accountId = (body.accountId || "").trim();
  const apiToken = (body.apiToken || "").trim();
  const workerName = ((body.workerName || "").trim() || "balebot").replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );

  if (!accountId || !apiToken) {
    return json(
      { ok: false, step: "request", error: "Account ID و API Token هر دو لازم است" },
      400
    );
  }

  const auth = { Authorization: `Bearer ${apiToken}` };

  // ۱) خواندن کد جدید از فایل worker.js ریشه پروژه (کنار سایت — منبع رسمی کد)
  let code: string;
  try {
    code = await readFile(path.join(process.cwd(), "worker.js"), "utf8");
  } catch {
    return json(
      { ok: false, step: "code", error: "فایل worker.js در ریشه پروژه پیدا نشد" },
      400
    );
  }

  // گارد ایمنی: تا وقتی worker.js خالی/placeholder است، هیچ آپلودی انجام نمی‌شود
  // (وگرنه یک آپلود اشتباه، کد واقعی ورکر را از بین می‌برد)
  if (looksEmptyWorker(code)) {
    return json(
      {
        ok: false,
        step: "code",
        error:
          "فایل worker.js هنوز خالی است (placeholder). اول کد کامل ورکر را در فایل worker.js ریشه پروژه جای‌گذاری کن و دوباره تلاش کن.",
      },
      400
    );
  }

  // ۲) گرفتن تنظیمات فعلی ورکر → اعتبارسنجی توکن + bindings + compatibility_date
  let settings: {
    success?: boolean;
    errors?: { code?: number; message?: string }[];
    result?: {
      bindings?: { type: string; name: string }[];
      compatibility_date?: string;
    };
  };
  try {
    const sres = await fetch(
      `${CF}/accounts/${accountId}/workers/scripts/${workerName}/settings`,
      { headers: auth, signal: AbortSignal.timeout(20000) }
    );
    settings = await sres.json().catch(() => ({}));
    if (!sres.ok || !settings?.success) {
      return json(
        { ok: false, step: "settings", error: friendlyCfError(settings?.errors, sres.status) },
        200
      );
    }
  } catch {
    return json(
      {
        ok: false,
        step: "settings",
        error: "اتصال به api.cloudflare.com ممکن نشد — دوباره تلاش کن",
      },
      200
    );
  }

  const oldBindings = settings.result?.bindings ?? [];
  const compatDate = settings.result?.compatibility_date || "2024-09-23";

  // ۳) متادیتا: همه نوع binding های قبلی + secret ها حفظ می‌شوند
  //    (keep_bindings طبق مستندات رسمی: «List of binding types to keep from previous_upload»)
  const keepTypes = [...new Set([...oldBindings.map((b) => b.type), "secret_text"])];
  const metadata = {
    main_module: "worker.js",
    compatibility_date: compatDate,
    keep_bindings: keepTypes,
  };

  // ۴) آپلود multipart
  try {
    const fd = new FormData();
    fd.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata.json"
    );
    fd.append(
      "worker.js",
      new Blob([code], { type: "application/javascript+module" }),
      "worker.js"
    );

    const ures = await fetch(
      `${CF}/accounts/${accountId}/workers/scripts/${workerName}`,
      {
        method: "PUT",
        headers: auth,
        body: fd,
        signal: AbortSignal.timeout(90_000),
      }
    );
    const udata = (await ures.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { code?: number; message?: string }[];
      result?: { modified_on?: string };
    };

    if (!ures.ok || !udata?.success) {
      return json(
        { ok: false, step: "upload", error: friendlyCfError(udata?.errors, ures.status) },
        200
      );
    }

    // ۵) راستی‌آزمایی: bindings بعد از آپلود سر جایشان هستند؟
    let bindingsAfter: { type: string; name: string }[] = [];
    try {
      const vres = await fetch(
        `${CF}/accounts/${accountId}/workers/scripts/${workerName}/settings`,
        { headers: auth, signal: AbortSignal.timeout(20000) }
      );
      const vdata = await vres.json().catch(() => ({}));
      if (vdata?.success) bindingsAfter = vdata.result?.bindings ?? [];
    } catch {
      // اگر چک نشد، خود آپلود موفق بوده — فقط گزارش کمتر برمی‌گردد
    }

    const beforeNames = oldBindings.map((b) => b.name).sort();
    const afterNames = bindingsAfter.map((b) => b.name).sort();
    const lost = beforeNames.filter((n) => !afterNames.includes(n));

    return json({
      ok: true,
      codeSize: code.length,
      modifiedOn: udata.result?.modified_on ?? null,
      keptBindings: afterNames,
      lostBindings: lost,
      compatDate,
    });
  } catch {
    return json(
      {
        ok: false,
        step: "upload",
        error: "آپلود ناتمام ماند (قطع اتصال یا تایم‌اوت). دوباره تلاش کن.",
      },
      200
    );
  }
}

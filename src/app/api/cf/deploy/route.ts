import { NextResponse } from "next/server";
import { cf, friendlyCfError, looksEmptyWorker } from "@/lib/cf";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CF = "https://api.cloudflare.com/client/v4";

interface Binding {
  type?: string;
  name?: string;
}

interface DeployBody {
  apiToken?: string;
  accountId?: string;
  workerName?: string;
  code?: string;
  compatibilityDate?: string;
  vars?: Record<string, string>;
  secrets?: Record<string, string>;
  d1?: { binding: string; id: string }[];
  keepExisting?: boolean;
  enableSubdomain?: boolean;
}

/** دیپلوی عمومی: آپلود کد Worker + ساخت/به‌روزرسانی bindings (Variable/Secret/D1) */
export async function POST(req: Request) {
  let body: DeployBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "بدنه درخواست نامعتبر است" },
      { status: 400 }
    );
  }

  const apiToken = (body.apiToken || "").trim();
  const accountId = (body.accountId || "").trim();
  const workerName = ((body.workerName || "").trim() || "my-worker").replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );
  const code = body.code || "";
  const keepExisting = body.keepExisting !== false;
  const enableSubdomain = body.enableSubdomain !== false;

  if (!apiToken || !accountId) {
    return NextResponse.json(
      { ok: false, error: "API Token و Account ID هر دو لازم است" },
      { status: 400 }
    );
  }

  // گارد ایمنی: کد خالی/ناقص هرگز آپلود نمی‌شود
  if (looksEmptyWorker(code)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "کد ورکر خالی یا ناقص است (باید ES Module باشد و export default داشته باشد). اول کد کامل را وارد کن.",
      },
      { status: 400 }
    );
  }

  const auth = { Authorization: `Bearer ${apiToken}` };

  // ۱) تنظیمات فعلی (برای Worker موجود) — برای Worker جدید 404 طبیعی است
  let oldBindings: Binding[] = [];
  let compatDate = (body.compatibilityDate || "").trim();
  let isNew = true;
  try {
    const s = await cf(
      `${CF}/accounts/${accountId}/workers/scripts/${workerName}/settings`,
      { headers: auth },
      20000
    );
    if (s.ok) {
      isNew = false;
      const result = s.data.result as { bindings?: Binding[]; compatibility_date?: string } | null;
      oldBindings = result?.bindings ?? [];
      if (!compatDate) compatDate = result?.compatibility_date || "2025-09-01";
    } else if (s.status !== 404) {
      return NextResponse.json(
        { ok: false, error: friendlyCfError(s.data.errors, s.status) },
        { status: 200 }
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "اتصال به api.cloudflare.com ممکن نشد — دوباره تلاش کن" },
      { status: 200 }
    );
  }
  if (!compatDate) compatDate = "2025-09-01";

  // ۲) ساخت bindings از ورودی کاربر
  const newBindings: Record<string, unknown>[] = [];
  for (const [name, text] of Object.entries(body.vars || {})) {
    const n = name.trim();
    if (n) newBindings.push({ type: "plain_text", name: n, text: String(text ?? "") });
  }
  for (const [name, text] of Object.entries(body.secrets || {})) {
    const n = name.trim();
    if (n && String(text ?? "") !== "") {
      newBindings.push({ type: "secret_text", name: n, text: String(text) });
    }
  }
  for (const d of body.d1 || []) {
    if (d.binding?.trim() && d.id?.trim()) {
      newBindings.push({ type: "d1", name: d.binding.trim(), id: d.id.trim() });
    }
  }

  const newTypes = [...new Set(newBindings.map((b) => b.type as string))];
  const keepTypes = keepExisting
    ? [...new Set([...oldBindings.map((b) => b.type ?? ""), ...newTypes, "secret_text"])].filter(Boolean)
    : newTypes;

  const metadata: Record<string, unknown> = {
    main_module: "worker.js",
    compatibility_date: compatDate,
  };
  if (keepTypes.length) metadata.keep_bindings = keepTypes;
  if (newBindings.length) metadata.bindings = newBindings;

  // ۳) آپلود multipart
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

    const u = await cf(
      `${CF}/accounts/${accountId}/workers/scripts/${workerName}`,
      { method: "PUT", headers: auth, body: fd },
      90000
    );
    if (!u.ok) {
      return NextResponse.json(
        { ok: false, error: friendlyCfError(u.data.errors, u.status) },
        { status: 200 }
      );
    }
    const modifiedOn =
      (u.data.result as { modified_on?: string } | null)?.modified_on ?? null;

    // ۴) راستی‌آزمایی bindings
    let bindingsAfter: string[] = [];
    try {
      const v = await cf(
        `${CF}/accounts/${accountId}/workers/scripts/${workerName}/settings`,
        { headers: auth },
        20000
      );
      if (v.ok) {
        const rb = ((v.data.result as { bindings?: Binding[] } | null)?.bindings ?? []) as Binding[];
        bindingsAfter = rb.map((b) => b.name ?? "").filter(Boolean).sort();
      }
    } catch {
      /* آپلود موفق بوده؛ فقط گزارش کمتر */
    }
    const beforeNames = oldBindings.map((b) => b.name ?? "").filter(Boolean).sort();
    const lost = beforeNames.filter((n) => !bindingsAfter.includes(n));

    // ۵) آدرس workers.dev
    let url: string | null = null;
    if (enableSubdomain) {
      try {
        await cf(
          `${CF}/accounts/${accountId}/workers/scripts/${workerName}/subdomain`,
          {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({ enabled: true, previews_enabled: false }),
          },
          20000
        );
        const sd = await cf(`${CF}/accounts/${accountId}/workers/subdomain`, { headers: auth }, 20000);
        const sub = (sd.data.result as { subdomain?: string } | null)?.subdomain;
        if (sub) url = `https://${workerName}.${sub}`;
      } catch {
        /* نمایش URL اختیاری است */
      }
    }

    return NextResponse.json({
      ok: true,
      isNew,
      modifiedOn,
      keptBindings: bindingsAfter,
      lostBindings: lost,
      compatDate,
      url,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "آپلود ناتمام ماند (قطع اتصال یا تایم‌اوت). دوباره تلاش کن." },
      { status: 200 }
    );
  }
}

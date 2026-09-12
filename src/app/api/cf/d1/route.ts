import { NextResponse } from "next/server";
import { cf, friendlyCfError } from "@/lib/cf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CF = "https://api.cloudflare.com/client/v4";

/** ساخت دیتابیس D1 — اگر نام تکراری باشد، همان دیتابیس موجود برگردانده می‌شود */
export async function POST(req: Request) {
  let apiToken = "";
  let accountId = "";
  let name = "";
  try {
    ({ apiToken = "", accountId = "", name = "" } = await req.json());
  } catch {
    /* بدنه خالی */
  }
  apiToken = (apiToken || "").trim();
  accountId = (accountId || "").trim();
  name = (name || "").trim();
  if (!apiToken || !accountId || !name) {
    return NextResponse.json(
      { ok: false, error: "API Token، Account ID و نام دیتابیس لازم است" },
      { status: 400 }
    );
  }
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
    return NextResponse.json(
      { ok: false, error: "نام دیتابیس فقط حروف انگلیسی، عدد، خط تیره و زیرخط (حداکثر ۳۲ کاراکتر)" },
      { status: 400 }
    );
  }
  const auth = { Authorization: `Bearer ${apiToken}` };

  // ۱) تلاش برای ساخت
  try {
    const r = await cf(
      `${CF}/accounts/${accountId}/d1/database`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ name }),
      },
      30000
    );
    if (r.ok) {
      const result = r.data.result as { uuid?: string } | null;
      if (result?.uuid) {
        return NextResponse.json({ ok: true, databaseId: result.uuid, created: true });
      }
    }
    const errMsg = friendlyCfError(r.data.errors, r.status);
    // ۲) اگر از قبل وجود دارد → پیدا کن و برگردان (اجرای تکراری بی‌خطر)
    if (/exist/i.test(errMsg) || r.data.errors?.[0]?.code === 7502) {
      const l = await cf(
        `${CF}/accounts/${accountId}/d1/database?per_page=100`,
        { headers: auth },
        20000
      );
      if (l.ok) {
        const raw = (Array.isArray(l.data.result)
          ? l.data.result
          : (l.data.result as { results?: { uuid?: string; name?: string }[] } | null)
              ?.results ?? []) as { uuid?: string; name?: string }[];
        const found = raw.find((x) => x.name === name);
        if (found?.uuid) {
          return NextResponse.json({ ok: true, databaseId: found.uuid, created: false });
        }
      }
      return NextResponse.json(
        {
          ok: false,
          error: "دیتابیس از قبل هست ولی در لیست پیدا نشد — از حالت «بروزرسانی» انتخابش کن",
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: false, error: errMsg }, { status: 200 });
  } catch {
    return NextResponse.json(
      { ok: false, error: "اتصال به api.cloudflare.com ممکن نشد — دوباره تلاش کن" },
      { status: 200 }
    );
  }
}

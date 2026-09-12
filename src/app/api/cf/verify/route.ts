import { NextResponse } from "next/server";
import { cf, friendlyCfError } from "@/lib/cf";

export const dynamic = "force-dynamic";

const CF = "https://api.cloudflare.com/client/v4";

/** بررسی اعتبار توکن + گرفتن لیست اکانت‌ها */
export async function POST(req: Request) {
  let apiToken = "";
  try {
    ({ apiToken = "" } = await req.json());
  } catch {
    /* body خالی */
  }
  apiToken = (apiToken || "").trim();
  if (!apiToken) {
    return NextResponse.json(
      { ok: false, error: "API Token لازم است" },
      { status: 400 }
    );
  }
  const auth = { Authorization: `Bearer ${apiToken}` };

  // ۱) اعتبارسنجی خود توکن
  try {
    const v = await cf(`${CF}/user/tokens/verify`, { headers: auth }, 20000);
    if (!v.ok) {
      return NextResponse.json(
        { ok: false, error: friendlyCfError(v.data.errors, v.status) },
        { status: 200 }
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "اتصال به api.cloudflare.com ممکن نشد — دوباره تلاش کن" },
      { status: 200 }
    );
  }

  // ۲) لیست اکانت‌ها (اگر توکن اجازه ندهد، کاربر دستی Account ID می‌دهد)
  let accounts: { id: string; name: string }[] = [];
  let needsAccountId = false;
  try {
    const a = await cf(`${CF}/accounts?per_page=50`, { headers: auth }, 20000);
    if (a.ok && Array.isArray(a.data.result)) {
      accounts = (a.data.result as { id: string; name: string }[]).map((x) => ({
        id: x.id,
        name: x.name,
      }));
    } else {
      needsAccountId = true;
    }
  } catch {
    needsAccountId = true;
  }

  return NextResponse.json({ ok: true, accounts, needsAccountId });
}

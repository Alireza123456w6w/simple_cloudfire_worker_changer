import { NextResponse } from "next/server";
import { cf, friendlyCfError } from "@/lib/cf";

export const dynamic = "force-dynamic";

const CF = "https://api.cloudflare.com/client/v4";

interface BindingRow {
  type?: string;
  name?: string;
  id?: string;
}

/** تنظیمات یک Worker: compatibility_date + لیست bindingهای فعلی */
export async function POST(req: Request) {
  let apiToken = "";
  let accountId = "";
  let workerName = "";
  try {
    ({ apiToken = "", accountId = "", workerName = "" } = await req.json());
  } catch {
    /* بدنه خالی */
  }
  apiToken = (apiToken || "").trim();
  accountId = (accountId || "").trim();
  workerName = (workerName || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!apiToken || !accountId || !workerName) {
    return NextResponse.json(
      { ok: false, error: "API Token، Account ID و نام Worker لازم است" },
      { status: 400 }
    );
  }

  try {
    const r = await cf(
      `${CF}/accounts/${accountId}/workers/scripts/${workerName}/settings`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
      20000
    );
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: friendlyCfError(r.data.errors, r.status) },
        { status: 200 }
      );
    }
    const result = r.data.result as {
      compatibility_date?: string;
      bindings?: BindingRow[];
    } | null;
    const bindings = (result?.bindings ?? [])
      .filter((b) => b.name)
      .map((b) => ({
        type: b.type ?? "",
        name: b.name as string,
        id: b.id ?? null,
      }));
    return NextResponse.json({
      ok: true,
      compatibilityDate: result?.compatibility_date ?? null,
      bindings,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "اتصال به api.cloudflare.com ممکن نشد — دوباره تلاش کن" },
      { status: 200 }
    );
  }
}

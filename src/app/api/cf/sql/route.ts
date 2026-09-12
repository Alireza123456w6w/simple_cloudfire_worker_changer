import { NextResponse } from "next/server";
import { cf, friendlyCfError, splitSqlStatements, chunkStatements } from "@/lib/cf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CF = "https://api.cloudflare.com/client/v4";

interface D1QueryResult {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
}

interface SqlError {
  statement: number;
  preview: string;
  message: string;
}

/**
 * اجرای اسکریپت SQL روی دیتابیس D1:
 *  ۱) اول کل اسکریپت یک‌جا (سریع‌ترین راه)
 *  ۲) در صورت خطا یا حجم بالا: جداسازی دستورها + اجرای تکه‌ای برای پیدا کردن دقیق خطا
 */
export async function POST(req: Request) {
  let apiToken = "";
  let accountId = "";
  let databaseId = "";
  let sql = "";
  try {
    ({ apiToken = "", accountId = "", databaseId = "", sql = "" } = await req.json());
  } catch {
    /* بدنه خالی */
  }
  apiToken = (apiToken || "").trim();
  accountId = (accountId || "").trim();
  databaseId = (databaseId || "").trim();
  sql = sql || "";
  if (!apiToken || !accountId || !databaseId || !sql.trim()) {
    return NextResponse.json(
      { ok: false, error: "API Token، Account ID، دیتابیس و متن SQL همه لازم است" },
      { status: 400 }
    );
  }
  const auth = { Authorization: `Bearer ${apiToken}`, "content-type": "application/json" };
  const url = `${CF}/accounts/${accountId}/d1/database/${databaseId}/query`;

  // ۱) تلاش یک‌جا (تا ۹۰ هزار کاراکتر)
  if (sql.length <= 90_000) {
    try {
      const r = await cf(url, { method: "POST", headers: auth, body: JSON.stringify({ sql }) }, 120000);
      if (r.ok) {
        const count = Array.isArray(r.data.result) ? (r.data.result as unknown[]).length : 0;
        return NextResponse.json({ ok: true, mode: "script", executed: count || 1, total: count || 1 });
      }
    } catch {
      /* می‌رویم سراغ روش تکه‌ای */
    }
  }

  // ۲) روش تکه‌ای
  const stmts = splitSqlStatements(sql);
  if (!stmts.length) {
    return NextResponse.json(
      { ok: false, error: "هیچ دستور معتبری در SQL پیدا نشد" },
      { status: 400 }
    );
  }
  const chunks = chunkStatements(stmts);
  const errors: SqlError[] = [];
  let executed = 0;

  for (const chunk of chunks) {
    const joined = chunk.join(";\n") + ";";
    let chunkOk = false;
    try {
      const r = await cf(url, { method: "POST", headers: auth, body: JSON.stringify({ sql: joined }) }, 120000);
      if (r.ok) {
        executed += chunk.length;
        chunkOk = true;
      }
    } catch {
      /* خطا در ادامه مشخص می‌شود */
    }
    if (chunkOk) continue;

    // پیدا کردن دستور مشکل‌دار: یکی‌یکی
    for (let i = 0; i < chunk.length; i++) {
      const single = chunk[i];
      const globalIndex = stmts.indexOf(single);
      try {
        const r2 = await cf(url, { method: "POST", headers: auth, body: JSON.stringify({ sql: single }) }, 60000);
        if (r2.ok) {
          executed++;
        } else {
          const q = r2.data as D1QueryResult;
          errors.push({
            statement: globalIndex >= 0 ? globalIndex + 1 : i + 1,
            preview: single.slice(0, 120),
            message: q?.errors?.[0]?.message ?? `خطای HTTP ${r2.status}`,
          });
        }
      } catch (e) {
        errors.push({
          statement: globalIndex >= 0 ? globalIndex + 1 : i + 1,
          preview: single.slice(0, 120),
          message: "اتصال قطع شد",
        });
      }
    }
  }

  if (errors.length) {
    return NextResponse.json({
      ok: false,
      mode: "chunked",
      executed,
      total: stmts.length,
      error: `${errors.length} دستور از ${stmts.length} دستور خطا داد — بقیه اجرا شدند`,
      errors: errors.slice(0, 20),
    });
  }

  return NextResponse.json({ ok: true, mode: "chunked", executed, total: stmts.length });
}

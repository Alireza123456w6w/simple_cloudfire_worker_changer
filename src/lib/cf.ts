// ─────────────────────────────────────────────────────────────────────────────
//  کتابخانه مشترک مسیرهای API کلادفلر — اعتبارسنجی، پیام‌های فارسی، ابزار SQL
// ─────────────────────────────────────────────────────────────────────────────

export interface CfErrorEntry {
  code?: number;
  message?: string;
}

export interface CfEnvelope {
  success?: boolean;
  errors?: CfErrorEntry[];
  result?: unknown;
}

/** فراخوانی امن API کلادفلر با تایم‌اوت + پارس JSON */
export async function cf(
  url: string,
  init?: RequestInit,
  timeoutMs = 30000
): Promise<{ status: number; data: CfEnvelope; ok: boolean }> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data: CfEnvelope = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  const ok = res.ok && data?.success !== false;
  return { status: res.status, data, ok };
}

/** پیام فارسی و قابل‌فهم برای خطاهای رایج Cloudflare */
export function friendlyCfError(
  errors: CfErrorEntry[] | undefined,
  status: number
): string {
  const first = errors?.[0];
  const code = first?.code ?? 0;
  const msg = first?.message ?? "خطای ناشناخته";
  if (code === 10000 || code === 9109 || code === 9106 || status === 401 || status === 403) {
    return (
      "توکن API نامعتبر است یا دسترسی کافی ندارد. مطمئن شو دسترسی Workers Scripts و D1 را دارد. (" +
      msg +
      ")"
    );
  }
  if (code === 10041 || status === 404) {
    return (
      "منبع موردنظر در Cloudflare پیدا نشد — نام Worker یا دیتابیس را چک کن. (" +
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
export function looksEmptyWorker(code: string): boolean {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, "") // حذف کامنت‌های بلوکی
    .split("\n")
    .filter((line) => !line.trim().startsWith("//")) // حذف کامنت‌های خطی
    .join("\n")
    .trim();
  return stripped.length < 200 || !stripped.includes("export default");
}

// ─── ابزار SQL: جداسازی دستورها + بسته‌بندی در تکه‌های امن برای D1 ───────────

function shouldSplitNow(cur: string): boolean {
  // اگر داخل CREATE TRIGGER هستیم، فقط بعد از بسته‌شدن بدنه (END) جدا کن
  const up = cur.toUpperCase();
  const t = up.lastIndexOf("CREATE TRIGGER");
  if (t === -1) return true;
  const seg = up.slice(t);
  const begins = (seg.match(/\bBEGIN\b/g) || []).length;
  const ends = (seg.match(/\bEND\b/g) || []).length;
  return ends >= begins;
}

/** جداکردن دستورهای SQL با احترام به رشته‌ها، کامنت‌ها و بدنه تریگر */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLine = false;
  let inBlock = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLine) {
      cur += ch;
      if (ch === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      cur += ch;
      if (ch === "*" && next === "/") {
        cur += next;
        i += 2;
        inBlock = false;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") {
          cur += next;
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      cur += ch;
      if (ch === '"') {
        if (next === '"') {
          cur += next;
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i++;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLine = true;
      cur += ch + next;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      cur += ch + next;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      cur += ch;
      i++;
      continue;
    }
    if (ch === ";") {
      if (!shouldSplitNow(cur)) {
        cur += ch;
        i++;
        continue;
      }
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }

  const rest = cur.trim();
  if (rest) out.push(rest);
  return out;
}

/** بسته‌بندی دستورها در تکه‌های کوچک‌تر از حد مجاز API */
export function chunkStatements(
  stmts: string[],
  maxChars = 80_000,
  maxCount = 40
): string[][] {
  const chunks: string[][] = [];
  let curChunk: string[] = [];
  let curLen = 0;
  for (const s of stmts) {
    const len = s.length + 1;
    if (curChunk.length > 0 && (curLen + len > maxChars || curChunk.length >= maxCount)) {
      chunks.push(curChunk);
      curChunk = [];
      curLen = 0;
    }
    curChunk.push(s);
    curLen += len;
  }
  if (curChunk.length) chunks.push(curChunk);
  return chunks;
}

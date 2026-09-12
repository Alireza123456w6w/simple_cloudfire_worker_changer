import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // کد ورکر از ریشه پروژه خوانده می‌شود (فایل worker.js کنار سایت — منبع رسمی)
    const code = await readFile(path.join(process.cwd(), "worker.js"), "utf8");
    return new Response(code, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response(
      "فایل worker.js در ریشه پروژه پیدا نشد — کد ورکر را در worker.js ریشه جای‌گذاری کن",
      { status: 404 }
    );
  }
}

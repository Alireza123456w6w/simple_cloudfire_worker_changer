"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   راه‌انداز Cloudflare Worker + D1 — نسخه استاتیک (GitHub Pages) — پنل ۲.۲
   همه فراخوانی‌های Cloudflare از طریق «پل» شخصی کاربر انجام می‌شود
   (api.cloudflare.com هدر CORS ندارد — تست شده ۲۰۲۶-۰۹).
   نسخه ۲.۲: ورود فایل SQL درست شد (فیلتر accept اندروید حذف شد)،
   کشیدن-ورها (drop) فایل روی کادرها، و رابط دوزبانه فارسی/انگلیسی 🌐
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── کد پل (یک ورکر کوچک که فقط درخواست را به کلادفلر رد می‌کند) ─── */
const BRIDGE_CODE = [
  '/**',
  ' * CF Bridge - browser relay to the Cloudflare API',
  ' * Forwards /cf/... requests to api.cloudflare.com/client/v4.',
  ' * Opening the bridge URL in a browser redirects back to the panel with ?bridge=...',
  ' * Stores nothing, logs nothing. Optional: create a secret named BRIDGE_KEY,',
  ' * then every request must send header X-Bridge-Key with the same value.',
  ' */',
  'const PANEL = "https://alireza123456w6w.github.io/simple_cloudfire_worker_changer/";',
  'const CORS_HEADERS = {',
  '  "Access-Control-Allow-Origin": "*",',
  '  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",',
  '  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Bridge-Key",',
  '  "Access-Control-Max-Age": "86400"',
  '};',
  '',
  'function json(obj, status) {',
  '  return new Response(JSON.stringify(obj), {',
  '    status: status || 200,',
  '    headers: Object.assign({ "content-type": "application/json" }, CORS_HEADERS)',
  '  });',
  '}',
  '',
  'export default {',
  '  async fetch(request, env) {',
  '    if (request.method === "OPTIONS") {',
  '      return new Response(null, { status: 204, headers: CORS_HEADERS });',
  '    }',
  '    const url = new URL(request.url);',
  '    if (url.pathname === "/" && request.method === "GET") {',
  '      return Response.redirect(PANEL + "?bridge=" + encodeURIComponent(url.origin), 302);',
  '    }',
  '    if (url.pathname === "/ping") {',
  '      return json({ ok: true, bridge: "cf-bridge", usage: "/cf/<cloudflare-api-path>" });',
  '    }',
  '    if (env && env.BRIDGE_KEY) {',
  '      const k = request.headers.get("x-bridge-key");',
  '      if (k !== env.BRIDGE_KEY) return json({ success: false, errors: [{ code: 401, message: "bridge key required" }] }, 401);',
  '    }',
  '    if (!url.pathname.startsWith("/cf/")) {',
  '      return json({ success: false, errors: [{ code: 404, message: "path must start with /cf/" }] }, 404);',
  '    }',
  '    const target = "https://api.cloudflare.com/client/v4/" + url.pathname.slice(4) + url.search;',
  '    const headers = new Headers();',
  '    const auth = request.headers.get("authorization");',
  '    if (auth) headers.set("authorization", auth);',
  '    const ct = request.headers.get("content-type");',
  '    if (ct) headers.set("content-type", ct);',
  '    const body = (request.method === "GET" || request.method === "HEAD") ? undefined : await request.arrayBuffer();',
  '    try {',
  '      const res = await fetch(target, { method: request.method, headers: headers, body: body });',
  '      const out = new Headers(res.headers);',
  '      for (const k in CORS_HEADERS) out.set(k, CORS_HEADERS[k]);',
  '      return new Response(res.body, { status: res.status, headers: out });',
  '    } catch (e) {',
  '      return json({ success: false, errors: [{ code: 0, message: "bridge upstream failed" }] }, 502);',
  '    }',
  '  }',
  '};',
  '',
].join("\n");

const CF = "https://api.cloudflare.com/client/v4";
const DEFAULT_COMPAT = "2025-09-01";
const LS = {
  bridge: "cfw.bridge",
  account: "cfw.accountId",
  last: "cfw.last",
  repo: "cfw.repo",
  lang: "cfw.lang",
};
const S = {
  bridge: "",
  token: "",
  accountId: "",
  connected: false,
};

/* ═══════════ ابزارهای پایه ═══════════ */

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(text, ms) {
  const box = $("toast");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(box._h);
  box._h = setTimeout(() => { box.hidden = true; }, ms || 2600);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e2) { return false; }
  }
}

/* ─── دیکشنری دوزبانه — فارسی (مبنا) ─── */
const DICT_FA = {
  "meta.title": "راه‌انداز Cloudflare Worker + D1",
  "hdr.title": "راه‌انداز Cloudflare Worker + D1",
  "hdr.sub": "ساخت و بروزرسانی ورکر و دیتابیس — مستقیم از مرورگر",
  "chip.on": "● متصل",
  "chip.off": "● وصل نیست",

  "conn.h2": "🔌 اتصال به Cloudflare",
  "conn.hint": "پل، توکن و اکانت — اطلاعات حساس فقط در همین تب مرورگر می‌ماند (sessionStorage) و هرگز ذخیره یا ارسال نمی‌شود.",
  "conn.bridge.label": "آدرس پل (Bridge)",
  "conn.bridge.install": "نصب پل",
  "conn.token.label": "API Token کلادفلر",
  "conn.token.ph": "توکن با دسترسی Workers Scripts + D1",
  "conn.token.hint": 'ساخت سریع توکن با دقیقاً همان دسترسی‌های لازم: <a href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D&amp;accountId=*&amp;zoneId=all&amp;name=Workers-D1-Token-byW6W" target="_blank" rel="noopener">ساخت توکن Workers + D1 ↗</a> — در صفحه‌ی باز‌شده فقط «Create Token» و بعد «Continue to overview» را بزن و توکن را همین‌جا بچسبان.',
  "conn.account.label": "Account ID (اختیاری)",
  "conn.account.ph": "خالی بگذار — خودکار از توکن تشخیص داده می‌شود",
  "conn.connect": "اتصال و راستی‌آزمایی",
  "conn.err.bridge": "آدرس پل لازم است و باید با https:// شروع شود. اگر پل نداری، دکمه «نصب پل» را بزن (فقط یک بار طول می‌کشد).",
  "conn.err.token": "API Token کلادفلر لازم است. از dash.cloudflare.com/profile/api-tokens بسازش (دسترسی Workers Scripts Edit + D1 Edit).",
  "conn.verifying": "در حال راستی‌آزمایی توکن از طریق پل…",
  "conn.log.tokenok": "توکن معتبر است ✅",
  "conn.prompt.multi": "چند اکانت پیدا شد، شماره‌اش را بزن:\n{list}",
  "conn.err.acct": "توکن معتبر است ولی تشخیص خودکار اکانت نشد — یا Account ID را از نوار آدرس داشبورد کپی و دوباره «اتصال» را بزن، یا توکن را با دسترسی Account Settings Read بساز.",
  "conn.ok": "متصل شد ✅",
  "conn.ok.acc": " — اکانت: {n}",
  "conn.log.ok": "اتصال کامل شد — Account: {a}…",
  "conn.err.catch": "اتصال به پل ممکن نشد — آدرس پل را چک کن.",

  "tab.setup": "🚀 راه‌اندازی جدید",
  "tab.update": "🔄 بروزرسانی",
  "tab.webhook": "🪝 وب‌هوک",
  "tab.tools": "🧰 ابزارها",

  "links.h2": "🔗 کانال پیشنهادات و پشتیبانی",
  "links.site": "🌐 سایت کانال پیشنهادات",
  "links.pages": "📄 صفحه‌های کانال پیشنهادات",
  "links.support": "🤖 بات پشتیبانی",
  "links.shop": "🛒 ربات فروشگاه کانال",

  "setup.s1": "۱) مشخصات پروژه",
  "setup.worker.label": "نام Worker",
  "setup.worker.ph": "my-bot",
  "setup.worker.hint": "⚠️ کلادفلر فقط <b>حروف کوچک انگلیسی، عدد و خط تیره (-)</b> را می‌پذیرد. زیرخط (_)، فاصله، حروف بزرگ و حروف فارسی مجاز نیستند — این کادر خودکار اصلاح می‌کند. مثال: <code>my-shop-bot</code>",
  "setup.d1.label": "نام دیتابیس D1",
  "setup.d1.ph": "my-db",
  "setup.d1.hint": "اینجا زیرخط (_) هم مجاز است.",
  "setup.binding.label": "نام اتصال (Binding)",
  "setup.binding.ph": "DB",
  "setup.binding.hint": "همان نامی که در کد با <code>env.DB</code> صدا می‌زنی",
  "setup.defaults": "↩︎ مقادیر قبلی من",

  "setup.s2": "۲) اسکیمای دیتابیس (schema.sql)",
  "setup.s2.hint": "فایل SQL را انتخاب کن، یا متنش را بچسبان، یا از ریپو بگیر. اگر پروژه‌ات دیتابیس نمی‌خواهد، خالی بگذار و از این مرحله رد شو. فایل را می‌توانی روی کادر بکشی و رها کنی (drag & drop).",
  "file.sql": "📁 انتخاب فایل SQL",
  "repo.schema": "☁️ دریافت از ریپو (setup.sql)",
  "setup.d1run": "🟢 ساخت D1 + اجرای اسکیما",

  "setup.s3": "۳) کد Worker (worker.js)",
  "setup.s3.hint": "کد باید ES Module باشد (شامل <code>export default</code>). می‌توانی فایل بدهی، بچسبانی، یا آخرین نسخه را از ریپو بگیری. فایل را می‌توانی روی کادر بکشی و رها کنی (drag & drop).",
  "file.js": "📁 انتخاب فایل JS",
  "repo.worker": "☁️ دریافت از ریپو (worker.js)",
  "setup.vars.sum": "متغیرها و Secretها (اختیاری)",
  "vars.add": "+ افزودن متغیر",
  "setup.vars.hint": "🔒 = Secret (مقدارش بعد از ذخیره خوانده نمی‌شود). BOT_TOKEN و ADMIN_IDS رایج‌ترین‌ها هستند.",
  "setup.deploy": "🟢 آپلود و دیپلوی Worker",

  "setup.s4": "۴) وب‌هوک (اختیاری)",
  "label.platform": "پلتفرم",
  "opt.bale": "بله (Bale)",
  "opt.telegram": "تلگرام (Telegram)",
  "label.token": "توکن ربات",
  "token.ph": "123456:ABC-...",
  "setup.path.label": "مسیر وب‌هوک (اختیاری)",
  "setup.path.ph": "خالی بگذار = ریشه ورکر (/)",
  "setup.path.hint": "ربات‌های ساخته‌شده با این پنل آپدیت‌ها را در <b>ریشه</b> می‌گیرند؛ فقط اگر کد ورکرت مسیر خاصی می‌خواهد (مثل <code>/webhook</code>) اینجا بنویس. مسیر اشتباه = قطع شدن ربات.",
  "hook.set": "🪝 تنظیم وب‌هوک",
  "setup.runall": "▶️ اجرای خودکار همه مراحل",

  "upd.mode": "حالت بروزرسانی را انتخاب کن",
  "seg.code": "کد Worker",
  "seg.d1": "دیتابیس D1",
  "seg.vars": "متغیرها / Bindings",

  "upd.code.h2": "🔄 بروزرسانی کد Worker",
  "upd.worker.label": "Worker موجود",
  "workerpick.ph": "نام ورکر یا از لیست انتخاب کن",
  "upd.list": "دریافت لیست",
  "upd.code.src.sum": "متغیرها و Secretها (اختیاری — فقط اگر بخواهی عوض شوند)",
  "vars.add2": "+ افزودن",
  "upd.vars.hint": "خالی بگذاری = متغیرها و Secretهای قبلی دست‌نخورده می‌مانند.",
  "upd.keep": "حفظ Bindings و Secretهای قبلی (پیشنهادی)",
  "upd.deploy": "🟢 بروزرسانی Worker",

  "upd.d1.h2": "🗄️ اجرای SQL روی D1",
  "upd.db.label": "دیتابیس",
  "upd.d1.hint": "⚠️ اگر جدول قبلاً ساخته شده باشد، CREATE دوباره خطا می‌دهد (مگر IF NOT EXISTS داشته باشد). فایل SQL را می‌توانی روی کادر بکشی و رها کنی.",
  "upd.runsql": "🟢 اجرای SQL",
  "upd.sql.ph": "UPDATE ... ; ALTER TABLE ... ;",

  "upd.vars.h2": "🧩 متغیرها و Bindings فعلی",
  "upd.show": "مشاهده",
  "upd.edit.sum": "ویرایش و ذخیره (بدون تغییر کد)",
  "vars.add3": "+ افزودن متغیر/Secret",
  "upd.edit.hint": "مقادیر جدید جایگزین هم‌نام‌ها می‌شوند؛ سایر Bindings (D1/KV/…) حفظ می‌شوند.",
  "upd.save": "🟢 ذخیره متغیرها",

  "wh.h2": "🪝 تنظیم وب‌هوک ربات",
  "wh.hint": "آدرس وب‌هوک = آدرس ورکر روی workers.dev + مسیر (اختیاری). <b>ربات‌های ساخته‌شده با این پنل آپدیت‌ها را در ریشه می‌گیرند</b> — یعنی کادر «مسیر» را معمولاً خالی بگذار. مسیر اشتباه یا آدرس مرده = قطع شدن ربات.",
  "wh.url.label": "آدرس ورکر",
  "wh.url.ph": "https://my-bot.xxx.workers.dev",
  "wh.url.hint": "بعد از دیپلوی موفق، خودکار پر می‌شود.",
  "wh.path.label": "مسیر وب‌هوک (معمولاً خالی)",
  "wh.path.ph": "خالی = ریشه ورکر (/)",
  "wh.drop": "پاک کردن پیام‌های عقب‌افتاده بعد از تغییر (drop_pending_updates)",
  "wh.info": "📋 وضعیت فعلی وب‌هوک",
  "wh.remove": "✂️ قطع وب‌هوک",
  "wh.manual": "🖥 دستور دستی",
  "wh.fallback.sum": "روش دستی (اگر درخواست مستقیم از مرورگر رد شد)",
  "wh.fallback.hint": 'این دستور را در Termux یا کامپیوتر اجرا کن (خروجی JSON با <code>"ok":true</code> یعنی موفق):',
  "copy": "کپی",

  "tl.target.h2": "🎯 ورکر هدف",
  "tl.url.label": "آدرس ورکر (برای تست سلامت — خالی = خودکار ساخته می‌شود)",
  "tl.cron.h2": "⏰ Cron Triggers (زمان‌بندی)",
  "tl.cron.hint": "زمان‌بندی‌های فعلی ورکر را ببین، اضافه/حذف کن و ذخیره کن. برای اجرا، کد ورکر باید هندلر <code>scheduled</code> داشته باشد.",
  "tl.cron.show": "📋 نمایش زمان‌بندی فعلی",
  "tl.cron.addlabel": "افزودن عبارت Cron",
  "cron.addbtn": "+ افزودن",
  "tl.cron.hint2": "قالب استاندارد ۵ فیلدی: دقیقه، ساعت، روزِماه، ماه، روزِهفته. نمونه: <code>*/5 * * * *</code> هر ۵ دقیقه — <code>0 8 * * *</code> هر روز ساعت ۸ صبح.",
  "cron.p1": "هر ۵ دقیقه",
  "cron.p2": "هر ساعت",
  "cron.p3": "روزانه ۸ صبح",
  "cron.p4": "نیمه‌شب",
  "tl.cron.save": "🟢 ذخیره زمان‌بندی‌ها",
  "tl.cron.dash": "در داشبورد ↗",
  "tl.diag.h2": "🩺 عیب‌یابی و لاگ",
  "tl.probe": "🔎 تست سلامت ورکر",
  "tl.botstatus": "🤖 وضعیت ربات و وب‌هوک",
  "tl.dash.worker": "صفحه ورکر در داشبورد ↗",
  "tl.dash.logs": "لاگ‌ها در داشبورد ↗",
  "tl.platform.label": "پلتفرم ربات",
  "tl.token.label": "توکن ربات (برای «وضعیت ربات»)",
  "tl.diag.hint": "راهنمای عیب‌یابی: اگر «وضعیت ربات» خطای last_error نشان داد، اول «تست سلامت ورکر» را بزن. اگر ورکر زنده بود، مسیر وب‌هوک را با کد مقایسه کن (ربات‌های این پنل: ریشه). اگر ورکر مرده بود، از تب «بروزرسانی» دوباره دیپلوی کن و بعد وب‌هوک را دوباره ست کن.",

  "log.h2": "📜 گزارش اجرا",
  "log.copy": "📋 کپی گزارش",
  "log.clear": "پاک کردن",
  "log.copied": "گزارش کپی شد ✅",
  "log.copyfail": "کپی نشد",

  "foot.main": '<a href="https://github.com/Alireza123456w6w/simple_cloudfire_worker_changer" target="_blank" rel="noopener">ریپوی گیت‌هاب ⭳</a> · ابزار عمومی و متن‌باز · توکن‌ها فقط در مرورگر خودت می‌مانند',
  "foot.links": '<a href="https://offers-pishnahadat.vercel.app" target="_blank" rel="noopener">سایت کانال پیشنهادات</a> · <a href="https://zaya.io/Offers_pishnahadat" target="_blank" rel="noopener">صفحه‌های کانال</a> · <a href="https://t.me/offerspishnahadat_feedbackbot" target="_blank" rel="noopener">بات پشتیبانی</a> · <a href="https://t.me/offerspishnahadat_shop_bot" target="_blank" rel="noopener">ربات فروشگاه کانال</a>',

  "bm.h2": "🌉 نصب پل — فقط یک بار، بدون ترمینال",
  "bm.hint": '<b>چرا پل؟</b> سایت Pages سرور ندارد و <code>api.cloudflare.com</code> هم اجازه اتصال مستقیم مرورگر را نمی‌دهد (CORS بسته است). پل یک ورکر کوچک در <b>خود اکانت کلادفلر تو</b> است که فقط درخواست‌های خودت را رد می‌کند — هیچ چیزی ذخیره نمی‌کند و کدش کاملاً شفاف است. این نصب فقط یک بار است؛ بعدش همه‌چیز از همین صفحه با موبایل انجام می‌شود.',
  "bm.step1": "۱) کد پل را کپی کن",
  "bm.copycode": "📋 کپی کد پل",
  "bm.badge": "~۴۰ خط JavaScript",
  "bm.step2": "۲) در داشبورد کلادفلر یک Worker بساز و کد را جایگزین کن",
  "bm.step2.hint": '<a href="https://dash.cloudflare.com/" target="_blank" rel="noopener">باز کردن داشبورد ↗</a> ← <b>Workers &amp; Pages</b> ← <b>Create</b> ← قالب Hello World ← Deploy ← دکمه <b>Edit code</b> ← همه‌چیز را پاک کن و کد کپی‌شده را بچسبان ← <b>Deploy</b>. بدون Account ID و بدون Termux.',
  "bm.step3": "۳) آدرس ورکر را اینجا بچسبان",
  "bm.open": "↗︎ باز کردن",
  "bm.step3.hint": "میان‌بر: آدرس پل را در مرورگر باز کن — خودش برمی‌گردد به همین صفحه و آدرس را پر می‌کند.",
  "bm.test": "تست و ذخیره پل",
  "bm.alt.sum": "روش جایگزین: Termux / کامپیوتر با curl (توکن + Account ID لازم دارد)",
  "bm.token.label": "API Token (برای ساختن پل لازم است)",
  "bm.token.ph": "همان توکنی که برای اتصال می‌دهی",
  "bm.account.label": "Account ID",
  "bm.account.ph": "از نوار آدرس داشبورد کلادفلر",
  "bm.account.hint": "Account ID را از نوار آدرس داشبورد کپی کن",
  "bm.cmd.label": "این دستور را کپی و در Termux / کامپیوتر اجرا کن",
  "bm.cmd.hint": "کل دستور انگلیسی است و آخرش خط <code>Bridge URL: https://cf-bridge.xxx.workers.dev</code> را چاپ می‌کند — همان را در کادر «آدرس ورکر» بالا بچسبان. اگر نچاپید، آدرس را از داشبورد (Workers &amp; Pages ← cf-bridge) بردار.",
  "bm.how.sum": "پل چطور کار می‌کند؟ (شفاف و کم‌حجم)",
  "bm.how.hint": "پل فقط دو کار می‌کند: هدرهای CORS را اضافه می‌کند و درخواست را به کلادفلر می‌فرستد. توکن از داخلش عبور می‌کند ولی ذخیره نمی‌شود — کد کاملش:",

  "toast.copied": "کپی شد ✅",
  "toast.copyfail": "کپی نشد — دستی انتخاب و کپی کن",
  "toast.lang.fa": "زبان فارسی فعال شد 🌐",
  "toast.lang.en": "English enabled 🌐",

  "cferr.unknown": "خطای ناشناخته",
  "cferr.auth": "توکن API نامعتبر است یا دسترسی کافی ندارد. مطمئن شو دسترسی Workers Scripts و D1 را دارد. ({msg})",
  "cferr.notfound": "منبع موردنظر در Cloudflare پیدا نشد — نام Worker یا دیتابیس را چک کن. ({msg})",
  "cferr.account": "Account ID اشتباه به نظر می‌رسد. از نوار آدرس داشبورد کپی‌اش کن. ({msg})",
  "cferr.header": "هدر درخواست نامعتبر است — توکن را کامل و بدون فاصله اضافه بچسبان. ({msg})",
  "cferr.generic": "Cloudflare: {msg} (کد {code})",

  "bridge.needed": "اول پل را نصب و آدرسش را در کارت اتصال وارد کن.",
  "bridge.timeout": "پاسخ پل دیر آمد (تایم‌اوت). دوباره تلاش کن.",
  "bridge.down": "پل در دسترس نیست — آدرسش را چک کن یا دوباره نصبش کن.",

  "file.read": "فایل خوانده شد",
  "file.readfail": "خواندن فایل ناموفق بود — دوباره تلاش کن",
  "file.empty": "این فایل خالی است یا متنی ندارد",
  "repo.getting": "در حال دریافت از ریپو…",
  "repo.fail": "دریافت از ریپو ناموفق بود — اینترنت/آدرس ریپو را چک کن",
  "repo.notfound": "فایل در ریپو پیدا نشد (HTTP {s}) — شاخه و نام فایل را چک کن",
  "repo.ok": "{path} از ریپو گرفته شد ✅",

  "bridge.msg.badurl": "آدرس پل باید کامل و با https:// باشد — مثل https://cf-bridge.name.workers.dev",
  "bridge.msg.testing": "در حال تست پل…",
  "bridge.msg.notbridge": "این آدرس شبیه پل پاسخ نمی‌دهد — آدرس workers.dev ورکر را کامل و درست بچسبان.",
  "bridge.msg.ok.token": "پل و توکن هر دو سالم ✅ — «اتصال» را در کارت اتصال بزن.",
  "bridge.msg.ok.bridge": "پل نصب و سالم است ✅ — حالا فقط توکن را در کارت اتصال وارد کن و «اتصال» را بزن.",
  "bridge.saved.hint": "پل نصب و تست شده: {url}",
  "bridge.ready": "پل آماده شد 🎉",
  "bridge.msg.unreachable": "به پل دسترسی نبود — مطمئن شو دستور را کامل اجرا کرده‌ای و آدرس را درست چسبانده‌ای. ({e})",
  "bridge.copied": "کد پل کپی شد ✅ حالا در داشبورد کلادفلر بچسبان",
  "bridge.copyfail": "کپی نشد — از کادر پایین دستی کپی کن",
  "bridge.needurl": "اول آدرس پل را وارد کن",

  "name.need": "نام Worker لازم است — فقط حروف کوچک انگلیسی، عدد و خط تیره (-). زیرخط (_) در کلادفلر پذیرفته نمی‌شود و خودکار به خط تیره تبدیل می‌شود.",
  "name.binding": "نام اتصال (Binding) باید یک شناسه جاوااسکریپت معتبر باشد — مثل DB",
  "name.invalid": "❌ هنوز نام معتبری نیست — فقط حروف کوچک انگلیسی، عدد و خط تیره (-)",
  "name.fixed": "⚠️ اصلاح شد: {rs} ← {norm}",
  "name.ok": "✅ نام معتبر است",
  "name.r.fa": "حروف فارسی/عربی حذف شدند",
  "name.r.upper": "حروف بزرگ به کوچک تبدیل شدند",
  "name.r.under": "زیرخط (_) و فاصله → خط تیره (-)",
  "name.r.digit": "ارقام فارسی به انگلیسی تبدیل شدند",

  "d1.namebad": "نام دیتابیس فقط حروف انگلیسی، عدد، خط تیره و زیرخط (حداکثر ۳۲ کاراکتر)",
  "d1.exists.listfail": "دیتابیس از قبل هست ولی در لیست پیدا نشد — از تب «بروزرسانی» انتخابش کن",

  "sql.empty": "متن SQL خالی است",
  "sql.none": "هیچ دستور معتبری در SQL پیدا نشد",
  "sql.disconnected": "اتصال قطع شد",
  "sql.errors": "{n} دستور از {total} دستور خطا داد{partial}:\n{detail}",
  "sql.partial": " (بقیه اجرا شدند)",
  "sql.item": "• دستور {n}: {m}\n  {p}",

  "deploy.empty": "کد ورکر خالی یا ناقص است (باید ES Module باشد و export default داشته باشد). اول کد کامل را وارد کن.",

  "resolve.note": "نام «{a}» در کلادفلر مجاز نیست — ورکر موجود «{b}» استفاده شد",

  "setup.nod1": "نام دیتابیس D1 را وارد کن (یا اگر دیتابیس نمی‌خواهی، از مرحله ۳ ادامه بده)",
  "setup.noschema": "اسکیمای SQL خالی است — فایل بده، بچسبان، یا از ریپو بگیر",
  "setup.db.making": "در حال ساخت/پیدا کردن دیتابیس…",
  "setup.db.created": " ساخته شد ✅",
  "setup.db.existed": " از قبل بوده — همان استفاده می‌شود",
  "setup.log.dbid": "شناسه دیتابیس: {id}",
  "setup.db.ready": "دیتابیس آماده است — در حال اجرای اسکیما…",
  "setup.db.done": "{pre}اسکیما اجرا شد ✅ ({n} دستور)",
  "setup.db.new": "دیتابیس ساخته شد و ",
  "setup.db.old": "دیتابیس موجود و ",
  "setup.log.sql": "اجرای SQL: {n} دستور ({mode})",
  "setup.err.d1": "خطای مرحله D1: {e}",
  "setup.deploy.finddb": "در حال پیدا کردن دیتابیس…",
  "setup.deploy.uploading": "در حال آپلود کد…",
  "setup.deploy.ok.new": "Worker جدید ساخته و دیپلو شد ✅",
  "setup.deploy.ok.upd": "Worker بروزرسانی شد ✅",
  "setup.deploy.lost": "⚠️ این متغیرهای قبلی پیدا نشدند: {n}",
  "setup.log.deployed": "Worker «{w}» {act}{url}",
  "log.w.new": "ساخته شد",
  "log.w.upd": "بروزرسانی شد",
  "setup.log.bindings": "Bindings فعلی: {n}",
  "setup.err.deploy": "خطای دیپلوی Worker: {e}",
  "setup.needtoken": "توکن ربات را وارد کن (یا وب‌هوک را رد کن)",
  "setup.nourl": "آدرس ورکر را وارد کن (workers.dev پیدا نشد)",
  "setup.hook.setting": "در حال تنظیم وب‌هوک روی {p}…\n{url}",
  "setup.hook.verified": "✅ بررسی شد — وب‌هوک روی پلتفرم فعال است",
  "setup.hook.other": "وب‌هوک فعلی پلتفرم آدرس دیگری است: {u}",
  "setup.hook.ok": "وب‌هوک تنظیم شد ✅\n{url}{extra}",
  "setup.log.hook": "🪝 وب‌هوک تنظیم شد → {u}",
  "setup.hook.cors": "درخواست مستقیم از مرورگر رد شد (CORS پلتفرم) — از تب «وب‌هوک» روش دستی را استفاده کن.",
  "setup.err.hook": "خطای وب‌هوک: {e}",
  "setup.needcode": "کد Worker را وارد کن (فایل، پیست، یا از ریپو)",
  "setup.runall.title": "اجرای خودکار: {w}",
  "setup.skipd1": "مرحله D1 رد شد (نام دیتابیس یا اسکیما خالی بود)",
  "setup.hookfail": "راه‌اندازی کامل شد ولی وب‌هوک تنظیم نشد — بعداً از تب وب‌هوک انجامش بده",
  "setup.skiphook": "مرحله وب‌هوک رد شد (توکن ربات خالی بود)",
  "setup.done": "🎉 تمام شد — ورکر آماده است",
  "setup.done.toast": "راه‌اندازی کامل شد 🎉",
  "setup.stopped": "⏹ اجرای خودکار در همین مرحله متوقف شد",
  "setup.stopped.toast": "ناتمام ماند — گزارش را ببین",

  "upd.getting": "در حال گرفتن لیست ورکرها…",
  "upd.none": "هیچ ورکری در این اکانت نیست — از تب «راه‌اندازی جدید» شروع کن",
  "upd.picked": "انتخاب شد: {n} ✅",
  "upd.found": "{n} ورکر پیدا شد ✅ — از لیست زیر یکی را لمس کن",
  "upd.needname": "نام Worker را وارد کن یا از لیست انتخاب کن",
  "upd.finding": "در حال پیدا کردن ورکر…",
  "upd.uploading": "در حال آپلود کد جدید…",
  "upd.ok.new": "⚠️ این نام قبلاً نبود — Worker جدید ساخته شد ✅",
  "upd.ok": "Worker بروزرسانی شد ✅",
  "upd.lost": "⚠️ این‌های قبلی پیدا نشدند: {n}",
  "upd.dbs.getting": "در حال گرفتن لیست دیتابیس‌ها…",
  "upd.dbs.none": "دیتابیسی نیست — از تب راه‌اندازی بساز",
  "upd.dbs.none.toast": "هیچ دیتابیس D1ای در این اکانت نیست",
  "upd.dbs.found": "{n} دیتابیس پیدا شد ✅",
  "upd.sql.needdb": "اول لیست دیتابیس‌ها را بگیر و یکی را انتخاب کن",
  "upd.sql.running": "در حال اجرای SQL…",
  "upd.sql.ok": "اجرا شد ✅ ({n} دستور، روش {m})",
  "upd.sql.mode.script": "یک‌جا",
  "upd.sql.mode.chunked": "تکه‌ای",
  "upd.sql.log": "SQL روی دیتابیس اجرا شد — {n} دستور",
  "upd.vars.needname": "نام Worker را وارد کن",
  "upd.vars.none": "هیچ Bindingsای ندارد.",
  "upd.vars.found": "{n} مورد پیدا شد — برای تغییر، ویرایشگر پایین را باز کن.",
  "upd.vars.saving": "در حال ذخیره…",
  "upd.vars.ok": "متغیرها ذخیره شد ✅ (بدون تغییر کد)",
  "upd.vars.log": "متغیرهای «{n}» بروزرسانی شد",
  "type.plain": "متغیر",
  "type.secret": "Secret",
  "type.d1": "دیتابیس D1",
  "type.kv": "KV",
  "type.r2": "R2",
  "type.service": "سرویس ورکر",

  "hook.needurl": "آدرس ورکر را کامل وارد کن (https://name.sub.workers.dev)",
  "hook.needtoken": "توکن ربات لازم است",
  "hook.checking": "در حال چک کردن زنده‌بودن ورکر…",
  "hook.confirm.notfound": "⚠️ ورکری با نام «{n}» در اکانت کلادفلرت پیدا نشد — یعنی هنوز دیپلوی نشده یا آدرس اشتباه است.\n\nست کردن وب‌هوک روی آدرس مرده = قطع شدن ربات (همان مشکل قبلی).\n\nبا این حال ادامه می‌دهی؟",
  "hook.cancel.notfound": "لغو شد — اول از تب «بروزرسانی» ورکر را دیپلوی کن.",
  "hook.confirm.dead": "⚠️ ورکر روی این آدرس پاسخ نمی‌دهد!\n\nاگر وب‌هوک را روی آدرس مرده ست کنی، ربات قطع می‌شود (همان مشکل قبلی).\n\nاول از تب «ابزارها» تست سلامت بگیر یا از تب «بروزرسانی» دیپلوی کن.\n\nبا این حال ادامه می‌دهی؟",
  "hook.cancel.dead": "لغو شد — اول ورکر را دیپلوی کن یا آدرس را اصلاح کن.",
  "hook.setting": "در حال تنظیم…",
  "hook.rejected": "پلتفرم رد کرد: {m}",
  "hook.verified": "✅ تایید شد — وب‌هوک فعال است",
  "hook.other": "وب‌هوک فعلی پلتفرم: {u}",
  "hook.ok": "وب‌هوک تنظیم شد ✅ → {u}{extra}",
  "hook.cors": "درخواست مستقیم از مرورگر رد شد (CORS/شبکه). دستور آماده‌ی زیر را در Termux یا کامپیوتر اجرا کن:",
  "hook.cors.termux": "درخواست مستقیم از مرورگر رد شد (CORS/شبکه). دستور آماده‌ی زیر را در Termux اجرا کن:",
  "hook.cors.hint": " — احتمالاً CORS پلتفرم اجازه نمی‌دهد؛ از دکمه «دستور دستی» استفاده کن.",
  "hook.confirm.remove": "وب‌هوک قطع شود؟\nتا تنظیم دوباره، ربات هیچ پیامی دریافت نمی‌کند.",
  "hook.removing": "در حال قطع…",
  "hook.removed": "وب‌هوک قطع شد — برای وصل دوباره، «تنظیم وب‌هوک» را بزن.",
  "hook.log.removed": "🪝 وب‌هوک قطع شد",
  "hook.getting": "در حال گرفتن وضعیت…",
  "hook.rejected2": "پلتفرم رد کرد (توکن/شبکه را چک کن)",
  "hook.info": "URL فعلی: {u}\nعقب‌افتاده: {p}\nآخرین خطا: {e}",
  "hook.info.nourl": "— تنظیم نشده —",
  "hook.info.pending": "{n} پیام",
  "hook.info.none": "ندارد",

  "tl.needtarget": "نام ورکر هدف را انتخاب کن (لیست را بگیر یا تایپ کن)",
  "tl.nosub": "زیردامنه workers.dev پیدا نشد — آدرس ورکر را دستی وارد کن",
  "tl.probing": "در حال تست سلامت ورکر…",
  "tl.probe.err": "پاسخی دریافت نشد (DNS/شبکه/ورکر خاموش)",
  "tl.row.url": "آدرس",
  "tl.row.deploy": "وضعیت دیپلوی",
  "tl.deploy.ok": "در اکانت ثبت شده ✅",
  "tl.deploy.no": "در اکانت پیدا نشد ❌ — هنوز دیپلوی نشده یا نامش فرق دارد",
  "tl.deploy.unk": "نامشخص (بررسی API ممکن نشد)",
  "tl.row.guide": "راهنما",
  "tl.guide.notdeployed": "اول از تب «بروزرسانی» کد را دیپلوی کن، بعد وب‌هوک ست کن. وب‌هوک روی ورکر دیپلوی‌نشده = قطع شدن ربات.",
  "tl.notdeployed": "ورکر دیپلوی نشده — وب‌هوک روی این آدرس ست نشود!",
  "tl.log.notdeployed": "🔎 سلامت ورکر: در اکانت پیدا نشد",
  "tl.row.result": "نتیجه",
  "tl.alive": "زنده است ✅ (پاسخ داد) — زمان {ms}ms",
  "tl.row.note": "توضیح",
  "tl.alive.note": "کد وضعیت HTTP از مرورگر قابل خواندن نیست (CORS) — برای ورکر ربات طبیعی است",
  "tl.row.resp": "پاسخ",
  "tl.alive.ok": "ورکر زنده است ✅ — حالا می‌توانی وب‌هوک را با خیال راحت ست کنی",
  "tl.log.alive": "🔎 سلامت ورکر: زنده ({x}, {ms}ms)",
  "tl.dead": "در دسترس نیست ❌",
  "tl.guide.dead": "ورکر دیپلوی نشده یا آدرس اشتباه است. از تب «بروزرسانی» کد را دیپلوی کن و دوباره تست کن. وب‌هوک روی آدرس مرده ست نشود (ربات قطع می‌شود).",
  "tl.dead.msg": "ورکر در دسترس نیست — وب‌هوک روی این آدرس ست نشود!",
  "tl.log.dead": "🔎 سلامت ورکر: در دسترس نیست",
  "tl.needtoken": "توکن ربات را وارد کن (همان توکن BotFather یا بله)",
  "tl.bot.getting": "در حال گرفتن وضعیت ربات…",
  "tl.bot.rejected": "توکن رد شد — بررسی کن ({m})",
  "tl.row.bot": "ربات",
  "tl.row.hook": "وب‌هوک",
  "tl.row.hookhost": "هاست وب‌هوک",
  "tl.row.pending": "عقب‌افتاده",
  "tl.row.lasterr": "آخرین خطا",
  "tl.advice.nourl": "وب‌هوک تنظیم نشده — از تب «وب‌هوک» ست کن",
  "tl.advice.err": "وب‌هوک ست شده ولی پلتفرم خطا می‌گیرد — «تست سلامت ورکر» را بزن؛ اگر ورکر زنده بود، مسیر وب‌هوک را چک کن (ربات‌های این پنل: ریشه)",
  "tl.advice.ok": "همه‌چیز سالم به نظر می‌رسد ✅",
  "tl.bot.done": "وضعیت ربات گرفته شد",
  "tl.log.bot": "🤖 وضعیت ربات @{u} بررسی شد",
  "tl.bot.cors": " — CORS پلتفرم اجازه نداد؛ از دکمه «دستور دستی» در تب وب‌هوک استفاده کن.",

  "cron.empty": "زمان‌بندی‌ای ثبت نشده — عبارت Cron اضافه کن و «ذخیره» بزن",
  "cron.del": "حذف",
  "cron.bad": "عبارت Cron معتبر نیست — قالب ۵ فیلدی مثل */5 * * * *",
  "cron.dup": "این عبارت قبلاً اضافه شده",
  "cron.added": "اضافه شد — برای اعمال، «ذخیره زمان‌بندی‌ها» را بزن",
  "cron.getting": "در حال گرفتن زمان‌بندی‌ها…",
  "cron.found": "{n} زمان‌بندی فعلی پیدا شد — می‌توانی حذف/اضافه کنی و ذخیره بزنی",
  "cron.none": "زمان‌بندی‌ای ثبت نشده — عبارت اضافه کن و ذخیره بزن",
  "cron.saving": "در حال ذخیره زمان‌بندی‌ها…",
  "cron.saved": "زمان‌بندی‌ها ذخیره شد ✅ ({n} مورد)",
  "cron.log": "Cron «{n}» ذخیره شد: {c}",
  "cron.log.empty": "خالی",

  "init.bridge.qs": "پل از لینک آماده شد: {u} — تستش کن یا مستقیم توکن را بده و «اتصال» را بزن.",
  "init.bridge.toast": "آدرس پل خودکار پر شد ✅ — حالا توکن را وارد کن",
  "init.hint.saved": "پل ذخیره‌شده: {u}{tok}",
  "init.hint.savedtok": " — توکن هم مانده، فقط «اتصال» را بزن",
  "init.hint.none": "هنوز پل نداری؟ «نصب پل» — بدون ترمینال و بدون Account ID، فقط یک بار.",
};
/* ─── دیکشنری دوزبانه — English ─── */
const DICT_EN = {
  "meta.title": "Cloudflare Worker + D1 Setup Panel",
  "hdr.title": "Cloudflare Worker + D1 Setup Panel",
  "hdr.sub": "Create & update your Worker and database — right from the browser",
  "chip.on": "● Connected",
  "chip.off": "● Not connected",

  "conn.h2": "🔌 Connect to Cloudflare",
  "conn.hint": "Bridge, token and account — sensitive data only stays in this browser tab (sessionStorage) and is never stored or sent anywhere else.",
  "conn.bridge.label": "Bridge URL",
  "conn.bridge.install": "Install bridge",
  "conn.token.label": "Cloudflare API Token",
  "conn.token.ph": "Token with Workers Scripts + D1 permissions",
  "conn.token.hint": 'Quick token creation with exactly the required permissions: <a href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D&amp;accountId=*&amp;zoneId=all&amp;name=Workers-D1-Token-byW6W" target="_blank" rel="noopener">Create Workers + D1 token ↗</a> — on the page that opens just press “Create Token”, then “Continue to overview”, and paste the token here.',
  "conn.account.label": "Account ID (optional)",
  "conn.account.ph": "Leave empty — auto-detected from the token",
  "conn.connect": "Connect & verify",
  "conn.err.bridge": "The bridge URL is required and must start with https://. If you don't have one, press “Install bridge” (it only takes once).",
  "conn.err.token": "The Cloudflare API token is required. Create one at dash.cloudflare.com/profile/api-tokens (Workers Scripts Edit + D1 Edit permissions).",
  "conn.verifying": "Verifying the token through the bridge…",
  "conn.log.tokenok": "Token is valid ✅",
  "conn.prompt.multi": "Multiple accounts found — type the number:\n{list}",
  "conn.err.acct": "The token is valid but the account could not be auto-detected — copy the Account ID from the dashboard address bar and hit “Connect” again, or create the token with Account Settings Read permission.",
  "conn.ok": "Connected ✅",
  "conn.ok.acc": " — account: {n}",
  "conn.log.ok": "Fully connected — Account: {a}…",
  "conn.err.catch": "Could not connect through the bridge — check the bridge URL.",

  "tab.setup": "🚀 New setup",
  "tab.update": "🔄 Update",
  "tab.webhook": "🪝 Webhook",
  "tab.tools": "🧰 Tools",

  "links.h2": "🔗 Suggestions & Support",
  "links.site": "🌐 Suggestions website",
  "links.pages": "📄 Channel pages",
  "links.support": "🤖 Support bot",
  "links.shop": "🛒 Channel shop bot",

  "setup.s1": "1) Project details",
  "setup.worker.label": "Worker name",
  "setup.worker.ph": "my-bot",
  "setup.worker.hint": "⚠️ Cloudflare only accepts <b>lowercase English letters, digits and dashes (-)</b>. Underscores (_), spaces, uppercase and Persian letters are not allowed — this field auto-fixes them. Example: <code>my-shop-bot</code>",
  "setup.d1.label": "D1 database name",
  "setup.d1.ph": "my-db",
  "setup.d1.hint": "Underscore (_) is allowed here.",
  "setup.binding.label": "Binding name",
  "setup.binding.ph": "DB",
  "setup.binding.hint": "The name you call it with in code: <code>env.DB</code>",
  "setup.defaults": "↩︎ Load my previous values",

  "setup.s2": "2) Database schema (schema.sql)",
  "setup.s2.hint": "Pick an SQL file, paste its text, or fetch it from the repo. If your project doesn't need a database, leave it empty and skip this step. You can also drag & drop the file onto the box.",
  "file.sql": "📁 Choose SQL file",
  "repo.schema": "☁️ Fetch from repo (setup.sql)",
  "setup.d1run": "🟢 Create D1 + run schema",

  "setup.s3": "3) Worker code (worker.js)",
  "setup.s3.hint": "The code must be an ES Module (containing <code>export default</code>). You can provide a file, paste it, or fetch the latest version from the repo. You can also drag & drop the file onto the box.",
  "file.js": "📁 Choose JS file",
  "repo.worker": "☁️ Fetch from repo (worker.js)",
  "setup.vars.sum": "Variables & Secrets (optional)",
  "vars.add": "+ Add variable",
  "setup.vars.hint": "🔒 = Secret (its value cannot be read back after saving). BOT_TOKEN and ADMIN_IDS are the most common ones.",
  "setup.deploy": "🟢 Upload & deploy Worker",

  "setup.s4": "4) Webhook (optional)",
  "label.platform": "Platform",
  "opt.bale": "Bale",
  "opt.telegram": "Telegram",
  "label.token": "Bot token",
  "token.ph": "123456:ABC-...",
  "setup.path.label": "Webhook path (optional)",
  "setup.path.ph": "Empty = worker root (/)",
  "setup.path.hint": "Bots created with this panel receive updates at the <b>root</b>; only write something here if your worker code expects a specific path (like <code>/webhook</code>). Wrong path = broken bot.",
  "hook.set": "🪝 Set webhook",
  "setup.runall": "▶️ Run all steps automatically",

  "upd.mode": "Choose update mode",
  "seg.code": "Worker code",
  "seg.d1": "D1 database",
  "seg.vars": "Variables / Bindings",

  "upd.code.h2": "🔄 Update Worker code",
  "upd.worker.label": "Existing Worker",
  "workerpick.ph": "Worker name or pick from the list",
  "upd.list": "Fetch list",
  "upd.code.src.sum": "Variables & Secrets (optional — only if you want them changed)",
  "vars.add2": "+ Add",
  "upd.vars.hint": "Leave empty = previous variables & Secrets stay untouched.",
  "upd.keep": "Keep previous Bindings & Secrets (recommended)",
  "upd.deploy": "🟢 Update Worker",

  "upd.d1.h2": "🗄️ Run SQL on D1",
  "upd.db.label": "Database",
  "upd.d1.hint": "⚠️ If a table already exists, re-running CREATE fails (unless it has IF NOT EXISTS). You can also drag & drop the SQL file onto the box.",
  "upd.runsql": "🟢 Run SQL",
  "upd.sql.ph": "UPDATE ... ; ALTER TABLE ... ;",

  "upd.vars.h2": "🧩 Current variables & Bindings",
  "upd.show": "View",
  "upd.edit.sum": "Edit & save (no code change)",
  "vars.add3": "+ Add variable/Secret",
  "upd.edit.hint": "New values replace same-name ones; other Bindings (D1/KV/…) are kept.",
  "upd.save": "🟢 Save variables",

  "wh.h2": "🪝 Set the bot webhook",
  "wh.hint": "Webhook URL = the worker's workers.dev address + path (optional). <b>Bots created with this panel receive updates at the root</b> — so usually leave the “path” box empty. Wrong path or dead address = broken bot.",
  "wh.url.label": "Worker URL",
  "wh.url.ph": "https://my-bot.xxx.workers.dev",
  "wh.url.hint": "Filled automatically after a successful deploy.",
  "wh.path.label": "Webhook path (usually empty)",
  "wh.path.ph": "Empty = worker root (/)",
  "wh.drop": "Drop pending messages after the change (drop_pending_updates)",
  "wh.info": "📋 Current webhook status",
  "wh.remove": "✂️ Detach webhook",
  "wh.manual": "🖥 Manual command",
  "wh.fallback.sum": "Manual method (if the direct browser request is refused)",
  "wh.fallback.hint": 'Run this command in Termux or on a computer (JSON output with <code>"ok":true</code> means success):',
  "copy": "Copy",

  "tl.target.h2": "🎯 Target worker",
  "tl.url.label": "Worker URL (for the health test — empty = built automatically)",
  "tl.cron.h2": "⏰ Cron Triggers (schedules)",
  "tl.cron.hint": "View the worker's current schedules, add/remove them and save. To actually run, the worker code must have a <code>scheduled</code> handler.",
  "tl.cron.show": "📋 Show current schedules",
  "tl.cron.addlabel": "Add cron expression",
  "cron.addbtn": "+ Add",
  "tl.cron.hint2": "Standard 5-field format: minute, hour, day-of-month, month, day-of-week. Examples: <code>*/5 * * * *</code> every 5 minutes — <code>0 8 * * *</code> daily at 8 AM.",
  "cron.p1": "Every 5 min",
  "cron.p2": "Hourly",
  "cron.p3": "Daily 8 AM",
  "cron.p4": "Midnight",
  "tl.cron.save": "🟢 Save schedules",
  "tl.cron.dash": "In dashboard ↗",
  "tl.diag.h2": "🩺 Diagnostics & logs",
  "tl.probe": "🔎 Worker health test",
  "tl.botstatus": "🤖 Bot & webhook status",
  "tl.dash.worker": "Worker page in dashboard ↗",
  "tl.dash.logs": "Logs in dashboard ↗",
  "tl.platform.label": "Bot platform",
  "tl.token.label": "Bot token (for “Bot status”)",
  "tl.diag.hint": "Troubleshooting guide: if “Bot status” shows a last_error, run the “Worker health test” first. If the worker is alive, compare the webhook path with the code (bots from this panel: root). If the worker is dead, redeploy from the “Update” tab, then set the webhook again.",

  "log.h2": "📜 Run log",
  "log.copy": "📋 Copy log",
  "log.clear": "Clear",
  "log.copied": "Log copied ✅",
  "log.copyfail": "Copy failed",

  "foot.main": '<a href="https://github.com/Alireza123456w6w/simple_cloudfire_worker_changer" target="_blank" rel="noopener">GitHub repo ⭳</a> · Free & open-source tool · Your tokens stay in your own browser',
  "foot.links": '<a href="https://offers-pishnahadat.vercel.app" target="_blank" rel="noopener">Suggestions website</a> · <a href="https://zaya.io/Offers_pishnahadat" target="_blank" rel="noopener">Channel pages</a> · <a href="https://t.me/offerspishnahadat_feedbackbot" target="_blank" rel="noopener">Support bot</a> · <a href="https://t.me/offerspishnahadat_shop_bot" target="_blank" rel="noopener">Channel shop bot</a>',

  "bm.h2": "🌉 Install the bridge — once only, no terminal",
  "bm.hint": '<b>Why a bridge?</b> The Pages site has no server and <code>api.cloudflare.com</code> does not allow direct browser calls (CORS is closed). The bridge is a tiny worker inside <b>your own Cloudflare account</b> that only relays your own requests — it stores nothing and its code is fully transparent. This install happens once; afterwards everything works from this page on your phone.',
  "bm.step1": "1) Copy the bridge code",
  "bm.copycode": "📋 Copy bridge code",
  "bm.badge": "~40 lines of JavaScript",
  "bm.step2": "2) Create a Worker in the Cloudflare dashboard and replace its code",
  "bm.step2.hint": '<a href="https://dash.cloudflare.com/" target="_blank" rel="noopener">Open the dashboard ↗</a> ← <b>Workers &amp; Pages</b> ← <b>Create</b> ← Hello World template ← Deploy ← the <b>Edit code</b> button ← delete everything, paste the copied code ← <b>Deploy</b>. No Account ID, no Termux.',
  "bm.step3": "3) Paste the worker URL here",
  "bm.open": "↗︎ Open",
  "bm.step3.hint": "Shortcut: open the bridge URL in your browser — it redirects back to this page and fills the address in.",
  "bm.test": "Test & save bridge",
  "bm.alt.sum": "Alternative: Termux / PC with curl (needs token + Account ID)",
  "bm.token.label": "API Token (needed to create the bridge)",
  "bm.token.ph": "The same token you use to connect",
  "bm.account.label": "Account ID",
  "bm.account.ph": "From the Cloudflare dashboard address bar",
  "bm.account.hint": "Copy the Account ID from the dashboard address bar",
  "bm.cmd.label": "Copy this command and run it in Termux / on your computer",
  "bm.cmd.hint": "The whole command is in English and prints a <code>Bridge URL: https://cf-bridge.xxx.workers.dev</code> line at the end — paste that into the “Worker URL” box above. If it doesn't print, take the address from the dashboard (Workers &amp; Pages ← cf-bridge).",
  "bm.how.sum": "How does the bridge work? (transparent & tiny)",
  "bm.how.hint": "The bridge only does two things: it adds the CORS headers and forwards the request to Cloudflare. The token passes through but is never stored — full code:",

  "toast.copied": "Copied ✅",
  "toast.copyfail": "Couldn't copy — select and copy manually",
  "toast.lang.fa": "زبان فارسی فعال شد 🌐",
  "toast.lang.en": "English enabled 🌐",

  "cferr.unknown": "Unknown error",
  "cferr.auth": "The API token is invalid or lacks permissions. Make sure it has Workers Scripts and D1 access. ({msg})",
  "cferr.notfound": "The resource was not found on Cloudflare — check the Worker or database name. ({msg})",
  "cferr.account": "The Account ID looks wrong. Copy it from the dashboard address bar. ({msg})",
  "cferr.header": "Invalid request header — paste the token completely, without extra spaces. ({msg})",
  "cferr.generic": "Cloudflare: {msg} (code {code})",

  "bridge.needed": "First install the bridge and put its URL in the connection card.",
  "bridge.timeout": "The bridge response came late (timeout). Try again.",
  "bridge.down": "The bridge is unreachable — check its URL or reinstall it.",

  "file.read": "File loaded",
  "file.readfail": "Could not read the file — try again",
  "file.empty": "This file is empty or has no text",
  "repo.getting": "Fetching from the repo…",
  "repo.fail": "Fetching from the repo failed — check your internet / the repo address",
  "repo.notfound": "File not found in the repo (HTTP {s}) — check the branch and file name",
  "repo.ok": "{path} fetched from the repo ✅",

  "bridge.msg.badurl": "The bridge URL must be complete and start with https:// — like https://cf-bridge.name.workers.dev",
  "bridge.msg.testing": "Testing the bridge…",
  "bridge.msg.notbridge": "This address doesn't respond like a bridge — paste the worker's full workers.dev URL correctly.",
  "bridge.msg.ok.token": "Bridge and token are both healthy ✅ — press “Connect” in the connection card.",
  "bridge.msg.ok.bridge": "The bridge is installed and healthy ✅ — now just enter the token in the connection card and press “Connect”.",
  "bridge.saved.hint": "Bridge installed & tested: {url}",
  "bridge.ready": "Bridge is ready 🎉",
  "bridge.msg.unreachable": "The bridge was unreachable — make sure you ran the whole command and pasted the address correctly. ({e})",
  "bridge.copied": "Bridge code copied ✅ Now paste it in the Cloudflare dashboard",
  "bridge.copyfail": "Couldn't copy — copy it manually from the box below",
  "bridge.needurl": "Enter the bridge URL first",

  "name.need": "A Worker name is required — only lowercase English letters, digits and dashes (-). Underscores (_) are not accepted on Cloudflare and are auto-converted to dashes.",
  "name.binding": "The binding name must be a valid JavaScript identifier — like DB",
  "name.invalid": "❌ Still not a valid name — only lowercase English letters, digits and dashes (-)",
  "name.fixed": "⚠️ Auto-fixed: {rs} → {norm}",
  "name.ok": "✅ Name is valid",
  "name.r.fa": "Persian/Arabic letters were removed",
  "name.r.upper": "Uppercase letters were lowercased",
  "name.r.under": "Underscore (_) and spaces → dashes (-)",
  "name.r.digit": "Persian digits were converted to English",

  "d1.namebad": "The database name allows only English letters, digits, dashes and underscores (max 32 chars)",
  "d1.exists.listfail": "The database already exists but wasn't found in the list — select it from the “Update” tab",

  "sql.empty": "The SQL text is empty",
  "sql.none": "No valid statements found in the SQL",
  "sql.disconnected": "Connection lost",
  "sql.errors": "{n} of {total} statements failed{partial}:\n{detail}",
  "sql.partial": " (the rest ran fine)",
  "sql.item": "• Statement {n}: {m}\n  {p}",

  "deploy.empty": "The worker code is empty or incomplete (it must be an ES Module with export default). Enter the full code first.",

  "resolve.note": "The name “{a}” is not allowed on Cloudflare — the existing worker “{b}” was used",

  "setup.nod1": "Enter the D1 database name (or if you don't need a database, continue from step 3)",
  "setup.noschema": "The SQL schema is empty — provide a file, paste it, or fetch it from the repo",
  "setup.db.making": "Creating/locating the database…",
  "setup.db.created": " was created ✅",
  "setup.db.existed": " already existed — reusing it",
  "setup.log.dbid": "Database ID: {id}",
  "setup.db.ready": "Database is ready — running the schema…",
  "setup.db.done": "{pre}schema executed ✅ ({n} statements)",
  "setup.db.new": "Database created and ",
  "setup.db.old": "Database existed and ",
  "setup.log.sql": "SQL run: {n} statements ({mode})",
  "setup.err.d1": "D1 step error: {e}",
  "setup.deploy.finddb": "Locating the database…",
  "setup.deploy.uploading": "Uploading the code…",
  "setup.deploy.ok.new": "New Worker created and deployed ✅",
  "setup.deploy.ok.upd": "Worker updated ✅",
  "setup.deploy.lost": "⚠️ These previous variables were not found: {n}",
  "setup.log.deployed": "Worker “{w}” {act}{url}",
  "log.w.new": "was created",
  "log.w.upd": "was updated",
  "setup.log.bindings": "Current bindings: {n}",
  "setup.err.deploy": "Worker deploy error: {e}",
  "setup.needtoken": "Enter the bot token (or skip the webhook)",
  "setup.nourl": "Enter the worker URL (workers.dev not found)",
  "setup.hook.setting": "Setting the webhook on {p}…\n{url}",
  "setup.hook.verified": "✅ Verified — the webhook is active on the platform",
  "setup.hook.other": "The platform's current webhook points elsewhere: {u}",
  "setup.hook.ok": "Webhook set ✅\n{url}{extra}",
  "setup.log.hook": "🪝 Webhook set → {u}",
  "setup.hook.cors": "The direct browser request was refused (platform CORS) — use the manual method in the “Webhook” tab.",
  "setup.err.hook": "Webhook error: {e}",
  "setup.needcode": "Enter the Worker code (file, paste, or from the repo)",
  "setup.runall.title": "Auto-run: {w}",
  "setup.skipd1": "D1 step skipped (database name or schema was empty)",
  "setup.hookfail": "Setup finished but the webhook was not set — do it later from the Webhook tab",
  "setup.skiphook": "Webhook step skipped (bot token was empty)",
  "setup.done": "🎉 All done — your worker is live",
  "setup.done.toast": "Setup finished 🎉",
  "setup.stopped": "⏹ Auto-run stopped at this step",
  "setup.stopped.toast": "Incomplete — check the log",

  "upd.getting": "Fetching the worker list…",
  "upd.none": "No workers in this account — start from the “New setup” tab",
  "upd.picked": "Selected: {n} ✅",
  "upd.found": "{n} workers found ✅ — tap one from the list below",
  "upd.needname": "Enter the Worker name or pick it from the list",
  "upd.finding": "Locating the worker…",
  "upd.uploading": "Uploading the new code…",
  "upd.ok.new": "⚠️ This name didn't exist before — a new Worker was created ✅",
  "upd.ok": "Worker updated ✅",
  "upd.lost": "⚠️ These previous ones were not found: {n}",
  "upd.dbs.getting": "Fetching the database list…",
  "upd.dbs.none": "No databases — create one from the setup tab",
  "upd.dbs.none.toast": "No D1 databases in this account",
  "upd.dbs.found": "{n} databases found ✅",
  "upd.sql.needdb": "Fetch the database list first and pick one",
  "upd.sql.running": "Running the SQL…",
  "upd.sql.ok": "Executed ✅ ({n} statements, {m} mode)",
  "upd.sql.mode.script": "single-shot",
  "upd.sql.mode.chunked": "chunked",
  "upd.sql.log": "SQL executed on the database — {n} statements",
  "upd.vars.needname": "Enter the Worker name",
  "upd.vars.none": "It has no bindings.",
  "upd.vars.found": "{n} items found — open the editor below to change them.",
  "upd.vars.saving": "Saving…",
  "upd.vars.ok": "Variables saved ✅ (code unchanged)",
  "upd.vars.log": "Variables of “{n}” updated",
  "type.plain": "Variable",
  "type.secret": "Secret",
  "type.d1": "D1 database",
  "type.kv": "KV",
  "type.r2": "R2",
  "type.service": "Service worker",

  "hook.needurl": "Enter the full worker URL (https://name.sub.workers.dev)",
  "hook.needtoken": "The bot token is required",
  "hook.checking": "Checking if the worker is live…",
  "hook.confirm.notfound": "⚠️ No worker named “{n}” was found in your Cloudflare account — it means it's not deployed yet or the address is wrong.\n\nSetting a webhook on a dead address = broken bot (the same old problem).\n\nContinue anyway?",
  "hook.cancel.notfound": "Cancelled — deploy the worker from the “Update” tab first.",
  "hook.confirm.dead": "⚠️ The worker doesn't respond at this address!\n\nIf you set the webhook on a dead address, the bot breaks (the same old problem).\n\nFirst run the health test from the “Tools” tab or deploy from the “Update” tab.\n\nContinue anyway?",
  "hook.cancel.dead": "Cancelled — deploy the worker first or fix the address.",
  "hook.setting": "Setting…",
  "hook.rejected": "The platform rejected it: {m}",
  "hook.verified": "✅ Verified — the webhook is active",
  "hook.other": "The platform's current webhook: {u}",
  "hook.ok": "Webhook set ✅ → {u}{extra}",
  "hook.cors": "The direct browser request was refused (CORS/network). Run the ready-made command below in Termux or on a computer:",
  "hook.cors.termux": "The direct browser request was refused (CORS/network). Run the ready-made command below in Termux:",
  "hook.cors.hint": " — the platform's CORS likely blocked it; use the “Manual command” button.",
  "hook.confirm.remove": "Detach the webhook?\nUntil you set it again, the bot receives no messages.",
  "hook.removing": "Detaching…",
  "hook.removed": "Webhook detached — to reconnect, press “Set webhook”.",
  "hook.log.removed": "🪝 Webhook detached",
  "hook.getting": "Fetching the status…",
  "hook.rejected2": "The platform rejected it (check the token/network)",
  "hook.info": "Current URL: {u}\nBacklog: {p}\nLast error: {e}",
  "hook.info.nourl": "— not set —",
  "hook.info.pending": "{n} message(s)",
  "hook.info.none": "none",

  "tl.needtarget": "Pick the target worker name (fetch the list or type it)",
  "tl.nosub": "The workers.dev subdomain was not found — enter the worker URL manually",
  "tl.probing": "Testing worker health…",
  "tl.probe.err": "No response received (DNS/network/worker down)",
  "tl.row.url": "URL",
  "tl.row.deploy": "Deployment status",
  "tl.deploy.ok": "Registered in your account ✅",
  "tl.deploy.no": "Not found in the account ❌ — not deployed yet, or the name differs",
  "tl.deploy.unk": "Unknown (API check not possible)",
  "tl.row.guide": "Guide",
  "tl.guide.notdeployed": "Deploy the code from the “Update” tab first, then set the webhook. A webhook on an undeployed worker = broken bot.",
  "tl.notdeployed": "The worker is not deployed — don't set the webhook on this address!",
  "tl.log.notdeployed": "🔎 Worker health: not found in the account",
  "tl.row.result": "Result",
  "tl.alive": "Alive ✅ (it responded) — {ms}ms",
  "tl.row.note": "Note",
  "tl.alive.note": "The HTTP status code is not readable from the browser (CORS) — normal for a bot worker",
  "tl.row.resp": "Response",
  "tl.alive.ok": "The worker is alive ✅ — now you can safely set the webhook",
  "tl.log.alive": "🔎 Worker health: alive ({x}, {ms}ms)",
  "tl.dead": "Unreachable ❌",
  "tl.guide.dead": "The worker isn't deployed or the address is wrong. Deploy the code from the “Update” tab and test again. Don't set the webhook on a dead address (the bot breaks).",
  "tl.dead.msg": "The worker is unreachable — don't set the webhook on this address!",
  "tl.log.dead": "🔎 Worker health: unreachable",
  "tl.needtoken": "Enter the bot token (the same BotFather or Bale token)",
  "tl.bot.getting": "Fetching the bot status…",
  "tl.bot.rejected": "The token was refused — check it ({m})",
  "tl.row.bot": "Bot",
  "tl.row.hook": "Webhook",
  "tl.row.hookhost": "Webhook host",
  "tl.row.pending": "Backlog",
  "tl.row.lasterr": "Last error",
  "tl.advice.nourl": "No webhook is set — set it from the “Webhook” tab",
  "tl.advice.err": "The webhook is set but the platform gets errors — run the “Worker health test”; if the worker is alive, check the webhook path (bots from this panel: root)",
  "tl.advice.ok": "Everything looks healthy ✅",
  "tl.bot.done": "Bot status fetched",
  "tl.log.bot": "🤖 Bot status of @{u} checked",
  "tl.bot.cors": " — the platform's CORS didn't allow it; use the “Manual command” button in the Webhook tab.",

  "cron.empty": "No schedules yet — add a cron expression and press “Save”",
  "cron.del": "Remove",
  "cron.bad": "Invalid cron expression — 5-field format like */5 * * * *",
  "cron.dup": "This expression is already added",
  "cron.added": "Added — press “Save schedules” to apply it",
  "cron.getting": "Fetching the schedules…",
  "cron.found": "{n} current schedules found — you can remove/add and press save",
  "cron.none": "No schedules yet — add an expression and press save",
  "cron.saving": "Saving the schedules…",
  "cron.saved": "Schedules saved ✅ ({n} items)",
  "cron.log": "Cron of “{n}” saved: {c}",
  "cron.log.empty": "empty",

  "init.bridge.qs": "The bridge came from the link: {u} — test it, or enter the token directly and press “Connect”.",
  "init.bridge.toast": "The bridge URL was filled automatically ✅ — now enter the token",
  "init.hint.saved": "Saved bridge: {u}{tok}",
  "init.hint.savedtok": " — the token is still here, just press “Connect”",
  "init.hint.none": "No bridge yet? “Install bridge” — no terminal, no Account ID, just once.",
};
/* ═══════════ چندزبانه (FA/EN) 🌐 ═══════════ */
const I18N = {
  cur: "fa",
  dict: { fa: DICT_FA, en: DICT_EN },
  t(key, vars) {
    const d = I18N.dict[I18N.cur] || DICT_FA;
    let s = (d[key] != null) ? d[key] : ((DICT_FA[key] != null) ? DICT_FA[key] : key);
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k] == null ? "" : vars[k]));
    return s;
  },
  apply() {
    const html = document.documentElement;
    html.lang = I18N.cur;
    html.dir = I18N.cur === "fa" ? "rtl" : "ltr";
    document.title = I18N.t("meta.title");
    /* نکته: selector باید هر دو صفت را بگیرد — [data-i18n] عنصرهای
       data-i18n-html را نمی‌گیرد (نام صفت دقیقاً match می‌شود) */
    document.querySelectorAll("[data-i18n], [data-i18n-html]").forEach((el) => {
      const key = el.hasAttribute("data-i18n-html") ? el.getAttribute("data-i18n-html") : el.getAttribute("data-i18n");
      const val = I18N.t(key);
      if (el.hasAttribute("data-i18n-html")) el.innerHTML = val;
      else el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.placeholder = I18N.t(el.getAttribute("data-i18n-ph"));
    });
    const sw = $("langSwitch");
    if (sw) sw.dataset.lang = I18N.cur;
    try { localStorage.setItem(LS.lang, I18N.cur); } catch (e) { /* بی‌خطر */ }
  },
  set(lang) {
    if (lang !== "fa" && lang !== "en") return;
    if (lang === I18N.cur) return;
    I18N.cur = lang;
    I18N.apply();
    UI.chip();
    if (typeof refreshBridgeHint === "function") refreshBridgeHint();
    if (typeof Tools !== "undefined" && Tools.cronRender) Tools.cronRender();
    document.body.classList.remove("langfade");
    void document.body.offsetWidth;
    document.body.classList.add("langfade");
    toast(I18N.t("toast.lang." + lang));
  },
  toggle() { I18N.set(I18N.cur === "fa" ? "en" : "fa"); },
  init() {
    let saved = "";
    try { saved = localStorage.getItem(LS.lang) || ""; } catch (e) { /* بی‌خطر */ }
    I18N.cur = saved === "en" ? "en" : "fa";
    I18N.apply();
  },
};
function t(key, vars) { return I18N.t(key, vars); }
/* زبان جاری را برای تاریخ/عدد برمی‌گرداند */
function localeTag() { return I18N.cur === "fa" ? "fa-IR" : "en-US"; }

/* وضعیت راهنمای پل — تا با تعویض زبان هم تازه شود */
const HintState = { qs: "", saved: false, tok: false };
function refreshBridgeHint() {
  const h = $("bridgeHint");
  if (!h) return;
  if (HintState.qs) { h.textContent = t("init.bridge.qs", { u: HintState.qs }); return; }
  const savedBridge = localStorage.getItem(LS.bridge) || "";
  if (HintState.saved && savedBridge) {
    h.textContent = t("init.hint.saved", { u: savedBridge, tok: HintState.tok ? t("init.hint.savedtok") : "" });
  } else {
    h.textContent = t("init.hint.none");
  }
}

/* ─── پیام خطای Cloudflare (دوزبانه) ─── */
function friendlyCfError(errors, status) {
  const first = (errors && errors[0]) || {};
  const code = first.code || 0;
  const msg = first.message || t("cferr.unknown");
  if (code === 10000 || code === 9109 || code === 9106 || status === 401 || status === 403) {
    return t("cferr.auth", { msg: msg });
  }
  if (code === 10041 || status === 404) {
    return t("cferr.notfound", { msg: msg });
  }
  if (code === 7003 || code === 7000) {
    return t("cferr.account", { msg: msg });
  }
  if (code === 6003) {
    return t("cferr.header", { msg: msg });
  }
  return t("cferr.generic", { msg: msg, code: code });
}

/* ─── فراخوانی از طریق پل ─── */
async function cfFetch(path, init) {
  init = init || {};
  if (!S.bridge) throw { friendly: t("bridge.needed") };
  const headers = Object.assign({}, init.headers || {});
  if (S.token) headers["Authorization"] = "Bearer " + S.token;
  let res;
  try {
    res = await fetch(S.bridge + "/cf/" + path, {
      method: init.method || "GET",
      headers: headers,
      body: init.body,
      signal: (init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined),
    });
  } catch (e) {
    if (e && e.name === "TimeoutError") throw { friendly: t("bridge.timeout") };
    throw { friendly: t("bridge.down") };
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* بدنه غیر JSON */ }
  const ok = res.ok && data && data.success !== false;
  return { status: res.status, data: data || {}, ok: ok };
}

function cfFail(r) {
  const e = new Error(friendlyCfError(r.data && r.data.errors, r.status));
  e.cf = true;
  return e;
}

/* ─── گارد کد خالی/placeholder ─── */
function looksEmptyWorker(code) {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .trim();
  return stripped.length < 200 || !stripped.includes("export default");
}

/* ─── ابزار SQL: جداسازی دستورها با احترام به رشته/کامنت/تریگر ─── */
function shouldSplitNow(cur) {
  const up = cur.toUpperCase();
  const idx = up.lastIndexOf("CREATE TRIGGER");
  if (idx === -1) return true;
  const seg = up.slice(idx);
  const begins = (seg.match(/\bBEGIN\b/g) || []).length;
  const ends = (seg.match(/\bEND\b/g) || []).length;
  return ends >= begins;
}

function splitSqlStatements(sql) {
  const out = [];
  let cur = "", i = 0;
  let inSingle = false, inDouble = false, inLine = false, inBlock = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";
    if (inLine) { cur += ch; if (ch === "\n") inLine = false; i++; continue; }
    if (inBlock) {
      cur += ch;
      if (ch === "*" && next === "/") { cur += next; i += 2; inBlock = false; continue; }
      i++; continue;
    }
    if (inSingle) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i += 2; continue; }
        inSingle = false;
      }
      i++; continue;
    }
    if (inDouble) {
      cur += ch;
      if (ch === '"') {
        if (next === '"') { cur += next; i += 2; continue; }
        inDouble = false;
      }
      i++; continue;
    }
    if (ch === "-" && next === "-") { inLine = true; cur += ch + next; i += 2; continue; }
    if (ch === "/" && next === "*") { inBlock = true; cur += ch + next; i += 2; continue; }
    if (ch === "'") { inSingle = true; cur += ch; i++; continue; }
    if (ch === '"') { inDouble = true; cur += ch; i++; continue; }
    if (ch === ";") {
      if (!shouldSplitNow(cur)) { cur += ch; i++; continue; }
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = ""; i++; continue;
    }
    cur += ch; i++;
  }
  const rest = cur.trim();
  if (rest) out.push(rest);
  return out;
}

function chunkStatements(stmts, maxChars, maxCount) {
  maxChars = maxChars || 80000; maxCount = maxCount || 40;
  const chunks = [];
  let curChunk = [], curLen = 0;
  for (const s of stmts) {
    const len = s.length + 1;
    if (curChunk.length > 0 && (curLen + len > maxChars || curChunk.length >= maxCount)) {
      chunks.push(curChunk); curChunk = []; curLen = 0;
    }
    curChunk.push(s); curLen += len;
  }
  if (curChunk.length) chunks.push(curChunk);
  return chunks;
}

/* ═══════════ UI ═══════════ */
const UI = {
  tab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    ["setup", "update", "webhook", "tools"].forEach((tb) => { $("tab-" + tb).hidden = tb !== name; });
  },
  seg(segName) {
    document.querySelectorAll("#tab-update .segbtn").forEach((b) => b.classList.toggle("active", b.dataset.seg === segName));
    ["uWorker", "uD1", "uVars"].forEach((s) => { $("seg-" + s).hidden = s !== segName; });
    /* وقتی بخش D1 باز می‌شود، اگر لیست دیتابیس خالی است خودکار بگیر —
       تا «اجرای SQL» همیشه با یک انتخاب آماده باشد */
    if (segName === "uD1" && S.connected && !$("uD1Select").options.length && !UI._d1Fetching) {
      UI._d1Fetching = true;
      Update.listD1().finally(() => { UI._d1Fetching = false; });
    }
  },
  openConn() { $("connCard").hidden = false; $("connCard").scrollIntoView({ behavior: "smooth", block: "start" }); },
  async copy(id) {
    const ok = await copyToClipboard($(id).value);
    toast(ok ? t("toast.copied") : t("toast.copyfail"));
  },
  chip() {
    const c = $("connChip");
    if (S.connected) { c.className = "chip chip-on"; c.textContent = t("chip.on"); }
    else { c.className = "chip chip-off"; c.textContent = t("chip.off"); }
  },
};

/* ═══════════ گزارش زنده ═══════════ */
const Log = {
  add(text, cls) {
    $("logCard").hidden = false;
    const d = document.createElement("div");
    d.className = "l-" + (cls || "info");
    let stamp = "";
    try { stamp = "[" + new Date().toLocaleTimeString(localeTag(), { hour12: false }) + "] "; } catch (e) { /* بی‌خطر */ }
    d.textContent = stamp + text;
    $("log").appendChild(d);
    while ($("log").children.length > 400) $("log").removeChild($("log").firstChild);
    $("log").scrollTop = $("log").scrollHeight;
  },
  step(text) { Log.add(text, "step"); },
  async copy() {
    const ok = await copyToClipboard($("log").innerText);
    toast(ok ? t("log.copied") : t("log.copyfail"));
  },
  clear() { $("log").innerHTML = ""; $("logCard").hidden = true; },
};

function stepMsg(id, text, cls) {
  const el = $(id);
  el.textContent = text || "";
  el.className = "stepmsg" + (cls ? " " + cls : "");
  if (text) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ═══════════ اتصال ═══════════ */
const Conn = {
  async connect() {
    const btn = $("btnConnect");
    const msg = $("connMsg");
    S.bridge = ($("fBridge").value || "").trim().replace(/\/+$/, "");
    S.token = ($("fToken").value || "").trim();
    S.accountId = ($("fAccount").value || "").trim();
    msg.className = "msg"; msg.textContent = "";

    if (!S.bridge || !/^https:\/\/.+/.test(S.bridge)) {
      msg.className = "msg err";
      msg.textContent = t("conn.err.bridge");
      return;
    }
    if (!S.token) {
      msg.className = "msg err";
      msg.textContent = t("conn.err.token");
      return;
    }
    localStorage.setItem(LS.bridge, S.bridge);
    btn.disabled = true;
    msg.className = "msg"; msg.textContent = t("conn.verifying");
    try {
      const v = await cfFetch("user/tokens/verify", { timeoutMs: 20000 });
      if (!v.ok) { msg.className = "msg err"; msg.textContent = friendlyCfError(v.data.errors, v.status); return; }
      Log.add(t("conn.log.tokenok"), "ok");

      let accounts = [];
      let needsAccountId = false;
      try {
        const a = await cfFetch("accounts?per_page=50", { timeoutMs: 20000 });
        if (a.ok && Array.isArray(a.data.result)) {
          accounts = a.data.result.map((x) => ({ id: x.id, name: x.name }));
        } else needsAccountId = true;
      } catch (e) { needsAccountId = true; }

      if (!S.accountId && accounts.length === 1) {
        S.accountId = accounts[0].id;
      } else if (!S.accountId && accounts.length > 1) {
        const pick = accounts.map((x, i) => (i + 1) + ") " + x.name + " — " + x.id.slice(0, 8) + "…").join("\n");
        const idx = prompt(t("conn.prompt.multi", { list: pick }), "1");
        const n = parseInt(idx, 10);
        if (n >= 1 && n <= accounts.length) S.accountId = accounts[n - 1].id;
      }
      if (!S.accountId) needsAccountId = true;
      if (needsAccountId && !S.accountId) {
        msg.className = "msg err";
        msg.textContent = t("conn.err.acct");
        $("fAccount").focus();
        return;
      }
      localStorage.setItem(LS.account, S.accountId);

      // راستی‌آزمایی نهایی: نام اکانت
      let accName = "";
      try {
        const g = await cfFetch("accounts/" + S.accountId, { timeoutMs: 15000 });
        if (g.ok && g.data.result) accName = g.data.result.name || "";
      } catch (e) { /* نمایش اختیاری */ }

      S.connected = true;
      sessionStorage.setItem("cfw.token", S.token);
      msg.className = "msg ok";
      msg.textContent = t("conn.ok") + (accName ? t("conn.ok.acc", { n: accName }) : "");
      $("tabsNav").hidden = false;
      $("connCard").hidden = true;
      UI.chip();
      Setup.loadDefaults();
      NameSan.refreshAll();
      Log.add(t("conn.log.ok", { a: S.accountId.slice(0, 8) }), "ok");
      if (!$("sWorker").value) $("sWorker").focus();
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = e.friendly || t("conn.err.catch");
    } finally {
      btn.disabled = false;
    }
  },
};

/* ═══════════ پل ═══════════ */
const Bridge = {
  openModal() {
    $("bToken").value = S.token || $("fToken").value || "";
    $("bAccount").value = S.accountId || $("fAccount").value || "";
    $("bCode").value = BRIDGE_CODE;
    $("bUrl").value = S.bridge || $("fBridge").value || "";
    Bridge.genCommand();
    $("bridgeModal").hidden = false;
  },
  closeModal() { $("bridgeModal").hidden = true; },
  async copyCode() {
    const ok = await copyToClipboard(BRIDGE_CODE);
    toast(ok ? t("bridge.copied") : t("bridge.copyfail"));
    if (!ok) { $("bCode").scrollIntoView({ behavior: "smooth", block: "center" }); $("bCode").focus(); }
  },
  openBridge() {
    let url = ($("bUrl").value || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/.+/.test(url)) { toast(t("bridge.needurl")); return; }
    window.open(url + "/ping", "_blank", "noopener");
  },
  genCommand() {
    const tok = ($("bToken").value || "").trim();
    const acc = ($("bAccount").value || "").trim();
    if (!tok || !acc) {
      $("bCmd").value = "Enter the API token and Account ID above to generate the command.";
      return;
    }
    const scriptsBase = "https://api.cloudflare.com/client/v4/accounts/" + acc + "/workers/scripts";
    const workersBase = "https://api.cloudflare.com/client/v4/accounts/" + acc + "/workers";
    const cmd = [
      "# CF Bridge installer - paste this WHOLE script into Termux / PC terminal and press Enter",
      'TOKEN="' + tok + '"',
      'API="' + scriptsBase + '"',
      "",
      "# 1) Upload the bridge worker",
      'curl -s -X PUT "$API/cf-bridge" \\',
      '  -H "Authorization: Bearer $TOKEN" \\',
      "  -F 'metadata={\"main_module\":\"bridge.js\",\"compatibility_date\":\"" + DEFAULT_COMPAT + "\"};type=application/json' \\",
      "  -F 'bridge.js=@-;filename=bridge.js;type=application/javascript+module' <<'CFBRIDGE_EOF_7'",
      BRIDGE_CODE.replace(/\n+$/, ""),
      "CFBRIDGE_EOF_7",
      'echo ""',
      "",
      "# 2) Enable the workers.dev subdomain for the bridge",
      'curl -s -X POST "' + workersBase + '/cf-bridge/subdomain" \\',
      '  -H "Authorization: Bearer $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      "  -d '{\"enabled\":true,\"previews_enabled\":false}'",
      'echo ""',
      "",
      "# 3) Read the account subdomain and print the final bridge URL",
      'SUB=$(curl -s "' + workersBase + '/subdomain" -H "Authorization: Bearer $TOKEN" \\',
      "  | sed -n 's/.*\"subdomain\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' \\",
      "  | head -n 1)",
      'if [ -n "$SUB" ]; then',
      '  echo ""',
      '  echo "=============================================="',
      '  echo "Bridge URL: https://cf-bridge.$SUB.workers.dev"',
      '  echo "=============================================="',
      '  echo "Copy this URL into the panel field."',
      "else",
      '  echo ""',
      '  echo "Could not read the subdomain automatically."',
      '  echo "Open: dash.cloudflare.com -> Workers & Pages -> cf-bridge"',
      '  echo "and copy its URL from there (it looks like https://cf-bridge.xxx.workers.dev)"',
      "fi",
    ].join("\n");
    $("bCmd").value = cmd;
  },
  async testAndSave() {
    const msg = $("bridgeMsg");
    let url = ($("bUrl").value || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/.+/.test(url)) {
      msg.className = "msg err";
      msg.textContent = t("bridge.msg.badurl");
      return;
    }
    msg.className = "msg"; msg.textContent = t("bridge.msg.testing");
    try {
      const probe = ($("bToken").value || "").trim() || S.token || ($("fToken").value || "").trim() || "invalid-probe";
      const res = await fetch(url + "/cf/user/tokens/verify", {
        headers: { "Authorization": "Bearer " + probe },
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      // پل سالم = پاسخ، شکل پاسخ API کلادفلر است (حتی اگر خود توکن رد شده باشد)
      const looksCf = data && (typeof data.success === "boolean" || Array.isArray(data.errors));
      if (!looksCf) {
        msg.className = "msg err";
        msg.textContent = t("bridge.msg.notbridge");
        return;
      }
      localStorage.setItem(LS.bridge, url);
      S.bridge = url;
      $("fBridge").value = url;
      const tokenOk = res.ok && data.success === true;
      msg.className = "msg ok";
      msg.textContent = tokenOk ? t("bridge.msg.ok.token") : t("bridge.msg.ok.bridge");
      $("bridgeHint").textContent = t("bridge.saved.hint", { url: url });
      Bridge.closeModal();
      UI.openConn();
      toast(t("bridge.ready"));
      if (!$("fToken").value) $("fToken").focus();
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = t("bridge.msg.unreachable", { e: e.message });
    }
  },
};

/* ═══════════ منبع کد (فایل / متن / ریپو) — با ورود فایل بی‌نقص ═══════════
   نکته مهم: فیلتر accept=".sql" در اندروید مشکل دارد — پسوند .sql هیچ
   MIME-type شناخته‌شده‌ای ندارد و فایل‌منیجر آن را خاکستری/غیرقابل‌انتخاب
   می‌کند (برای همین «فایل JS وارد می‌شد ولی SQL نه»). راه‌حل: بدون فیلتر
   accept، خواندن متنی مقاوم (BOM/خالی/خطا)، و drag & drop روی کادرها. */
const Source = {
  async readFile(f, textareaId, badgeId) {
    if (!f) return;
    let text = "";
    try { text = await f.text(); }
    catch (e) { toast(t("file.readfail")); return; }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); /* BOM */
    if (!text.trim()) { toast(t("file.empty")); return; }
    $(textareaId).value = text;
    if (badgeId) $(badgeId).textContent = f.name + " (" + (text.length / 1024).toFixed(1) + "KB)";
    toast(t("file.read") + " — " + f.name);
  },
  async fileToText(inputId, textareaId, badgeId) {
    const f = $(inputId).files && $(inputId).files[0];
    if (f) await Source.readFile(f, textareaId, badgeId);
    $(inputId).value = ""; /* اجازه انتخاب دوباره همان فایل */
  },
  /* کشیدن-ورها (drop) فایل روی خود textarea */
  wireDrop(textareaId, badgeId) {
    const ta = $(textareaId);
    if (!ta) return;
    ["dragenter", "dragover"].forEach((ev) => ta.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); ta.classList.add("dragover");
    }));
    ["dragleave", "dragend"].forEach((ev) => ta.addEventListener(ev, () => ta.classList.remove("dragover")));
    ta.addEventListener("drop", async (e) => {
      e.preventDefault(); e.stopPropagation();
      ta.classList.remove("dragover");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) await Source.readFile(f, textareaId, badgeId);
    });
  },
  repoBase() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(LS.repo) || "null"); } catch (e) { /* پیش‌فرض */ }
    return r || { owner: "Alireza123456w6w", repo: "simple_cloudfire_worker_changer", branch: "main" };
  },
  async raw(path, taId, badgeId) {
    const r = Source.repoBase();
    const url = "https://raw.githubusercontent.com/" + r.owner + "/" + r.repo + "/" + r.branch + "/" + path + "?t=" + Date.now();
    toast(t("repo.getting"));
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      toast(t("repo.fail"));
      return false;
    }
    if (!res.ok) {
      toast(t("repo.notfound", { s: res.status }));
      return false;
    }
    const text = await res.text();
    $(taId).value = text;
    if (badgeId) $(badgeId).textContent = path + " (" + (text.length / 1024).toFixed(1) + "KB)";
    toast(t("repo.ok", { path: path }));
    return true;
  },
  fetchRepo(kind) {
    if (kind === "schema") return Source.raw("setup.sql", "sSchemaText", "sSchemaName");
    if (kind === "worker") return Source.raw("worker.js", "sCodeText", "sCodeName");
    if (kind === "workerU") return Source.raw("worker.js", "uCodeText", "uCodeName");
    if (kind === "sqlU") return Source.raw("setup.sql", "uSqlText", "uSqlName");
  },
};

/* ═══════════ ویرایشگر متغیرها ═══════════ */
const Vars = {
  add(containerId, type, name, value) {
    const box = $(containerId);
    const row = document.createElement("div");
    row.className = "vrow";
    const ty = document.createElement("button");
    ty.className = "vtype"; ty.type = "button"; ty.textContent = type === "secret" ? "🔒" : "V";
    ty.title = "کلیک = تبدیل Variable ↔ Secret";
    ty.onclick = () => { ty.textContent = ty.textContent === "V" ? "🔒" : "V"; };
    const n = document.createElement("input");
    n.dir = "ltr"; n.placeholder = "NAME"; n.value = name || "";
    const v = document.createElement("input");
    v.dir = "ltr"; v.placeholder = type === "secret" ? "مقدار (خالی = بدون تغییر)" : "value";
    if (value !== undefined) v.value = value;
    const d = document.createElement("button");
    d.className = "vdel"; d.type = "button"; d.textContent = "✕";
    d.onclick = () => row.remove();
    row.append(ty, n, v, d);
    box.appendChild(row);
  },
  collect(containerId) {
    const vars = {}, secrets = {};
    $(containerId).querySelectorAll(".vrow").forEach((row) => {
      const [ty, n, v] = row.querySelectorAll("button, input");
      const name = n.value.trim();
      if (!name) return;
      if (ty.textContent === "🔒") {
        if (v.value !== "") secrets[name] = v.value;
      } else {
        vars[name] = v.value;
      }
    });
    return { vars: vars, secrets: secrets };
  },
};

/* ═══════════ پاکیزه‌سازی نام‌ها (نام Worker در کلادفلر سخت‌گیرانه است) ═══════════
   کلادفلر برای نام Worker فقط حروف کوچک انگلیسی، عدد و خط تیره می‌پذیرد؛
   زیرخط (_) و فاصله و حروف بزرگ/فارسی رد می‌شوند — این ماژول زنده اصلاح و هشدار می‌دهد. */
const NameSan = {
  FA: "۰۱۲۳۴۵۶۷۸۹", AR: "٠١٢٣٤٥٦٧٨٩",
  normalizeWorker(raw) {
    let s = String(raw == null ? "" : raw);
    s = s.replace(/[۰-۹]/g, (d) => String(NameSan.FA.indexOf(d)))
         .replace(/[٠-٩]/g, (d) => String(NameSan.AR.indexOf(d)));
    s = s.trim().toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    return s.slice(0, 63);
  },
  reasons(raw) {
    const s = String(raw == null ? "" : raw);
    const out = [];
    if (/[\u0600-\u06FF]/.test(s)) out.push(t("name.r.fa"));
    if (/[A-Z]/.test(s)) out.push(t("name.r.upper"));
    if (/[_\s]/.test(s)) out.push(t("name.r.under"));
    if (/[۰-۹٠-٩]/.test(s)) out.push(t("name.r.digit"));
    return out;
  },
  apply(inputId, hintId) {
    const inp = $(inputId);
    if (!inp) return;
    const raw = inp.value;
    const norm = NameSan.normalizeWorker(raw);
    inp.value = norm;
    const h = $(hintId);
    if (!h) return;
    if (!norm) {
      h.className = "livehint warn";
      h.textContent = raw ? t("name.invalid") : "";
      return;
    }
    const rs = NameSan.reasons(raw);
    if (rs.length) { h.className = "livehint warn"; h.textContent = t("name.fixed", { rs: rs.join(" — "), norm: norm }); }
    else { h.className = "livehint ok"; h.textContent = t("name.ok"); }
  },
  refresh(inputId, hintId) { NameSan.apply(inputId, hintId); },
  refreshAll() {
    NameSan.refresh("sWorker", "sWorkerHint");
    NameSan.refresh("uWorkerName", "uWorkerHint");
    NameSan.refresh("uVarsWorker", "uVarsWorkerHint");
  },
  live(inputId, hintId) {
    const inp = $(inputId);
    if (!inp) return;
    inp.addEventListener("input", () => NameSan.apply(inputId, hintId));
    NameSan.apply(inputId, hintId);
  },
};
/* ═══════════ عملیات Cloudflare (هسته مشترک) ═══════════ */
const CloudOps = {
  async ensureD1(name) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
      throw new Error(t("d1.namebad"));
    }
    const r = await cfFetch("accounts/" + S.accountId + "/d1/database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name }),
      timeoutMs: 30000,
    });
    if (r.ok && r.data.result && r.data.result.uuid) {
      return { id: r.data.result.uuid, created: true };
    }
    // از قبل وجود دارد؟ → پیدا کن (اجرای تکراری بی‌خطر)
    const msg = friendlyCfError(r.data.errors, r.status);
    if (r.data.errors && r.data.errors[0] && r.data.errors[0].code === 7502 || /exist/i.test(msg)) {
      const l = await cfFetch("accounts/" + S.accountId + "/d1/database?per_page=100", { timeoutMs: 20000 });
      if (l.ok) {
        const raw = Array.isArray(l.data.result) ? l.data.result : ((l.data.result && l.data.result.results) || []);
        const found = raw.find((x) => x.name === name);
        if (found && found.uuid) return { id: found.uuid, created: false };
      }
      throw new Error(t("d1.exists.listfail"));
    }
    throw new Error(msg);
  },

  async runSql(databaseId, sql) {
    if (!sql || !sql.trim()) throw new Error(t("sql.empty"));
    const url = "accounts/" + S.accountId + "/d1/database/" + databaseId + "/query";
    const post = (query, timeoutMs) => cfFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: query }),
      timeoutMs: timeoutMs,
    });

    // ۱) تلاش یک‌جا
    if (sql.length <= 90000) {
      try {
        const r = await post(sql, 120000);
        if (r.ok) {
          const count = Array.isArray(r.data.result) ? r.data.result.length : 1;
          return { mode: "script", executed: count || 1, total: count || 1 };
        }
      } catch (e) { if (e.cf || e.friendly) throw e; /* رفتن به روش تکه‌ای */ }
    }

    // ۲) روش تکه‌ای با پیدا کردن دستور مشکل‌دار
    const stmts = splitSqlStatements(sql);
    if (!stmts.length) throw new Error(t("sql.none"));
    const chunks = chunkStatements(stmts);
    const errors = [];
    let executed = 0;
    for (const chunk of chunks) {
      const joined = chunk.join(";\n") + ";";
      let chunkOk = false;
      try {
        const r = await post(joined, 120000);
        if (r.ok) { executed += chunk.length; chunkOk = true; }
      } catch (e) { if (e.friendly) throw e; /* ادامه */ }
      if (chunkOk) continue;
      for (let i = 0; i < chunk.length; i++) {
        const single = chunk[i];
        const globalIndex = stmts.indexOf(single);
        try {
          const r2 = await post(single, 60000);
          if (r2.ok) { executed++; continue; }
          const q = r2.data || {};
          errors.push({
            n: globalIndex >= 0 ? globalIndex + 1 : i + 1,
            preview: single.slice(0, 120),
            message: (q.errors && q.errors[0] && q.errors[0].message) || ("HTTP " + r2.status),
          });
        } catch (e) {
          if (e.friendly) throw e;
          errors.push({ n: globalIndex >= 0 ? globalIndex + 1 : i + 1, preview: single.slice(0, 120), message: t("sql.disconnected") });
        }
      }
    }
    if (errors.length) {
      const detail = errors.slice(0, 8).map((e) => t("sql.item", { n: e.n, m: e.message, p: e.preview.replace(/\n/g, " ") })).join("\n");
      const err = new Error(t("sql.errors", {
        n: errors.length, total: stmts.length,
        partial: executed ? t("sql.partial") : "",
        detail: detail,
      }));
      err.partial = true;
      throw err;
    }
    return { mode: "chunked", executed: executed, total: stmts.length };
  },

  async deployWorker(opts) {
    // opts: {name, code, vars, secrets, d1:[{binding,id}], keepExisting}
    if (looksEmptyWorker(opts.code)) {
      throw new Error(t("deploy.empty"));
    }
    const base = "accounts/" + S.accountId + "/workers/scripts/" + opts.name;

    // ۱) تنظیمات فعلی (برای ورکر موجود)
    let oldBindings = [];
    let compatDate = DEFAULT_COMPAT;
    let isNew = true;
    try {
      const s = await cfFetch(base + "/settings", { timeoutMs: 20000 });
      if (s.ok) {
        isNew = false;
        oldBindings = (s.data.result && s.data.result.bindings) || [];
        if (s.data.result && s.data.result.compatibility_date) compatDate = s.data.result.compatibility_date;
      } else if (s.status !== 404) {
        const err = new Error(friendlyCfError(s.data.errors, s.status));
        err.cf = true;
        throw err;
      }
    } catch (e) { if (e.cf) throw e; /* ورکر جدید → 404 طبیعی است */ }

    // ۲) bindings جدید
    const newBindings = [];
    for (const [n, text] of Object.entries(opts.vars || {})) {
      if (n.trim()) newBindings.push({ type: "plain_text", name: n.trim(), text: String(text == null ? "" : text) });
    }
    for (const [n, text] of Object.entries(opts.secrets || {})) {
      if (n.trim() && String(text) !== "") newBindings.push({ type: "secret_text", name: n.trim(), text: String(text) });
    }
    for (const d of opts.d1 || []) {
      if (d.binding && d.binding.trim() && d.id && d.id.trim()) {
        newBindings.push({ type: "d1", name: d.binding.trim(), id: d.id.trim() });
      }
    }
    const newTypes = Array.from(new Set(newBindings.map((b) => b.type)));
    const keepTypes = opts.keepExisting !== false
      ? Array.from(new Set(oldBindings.map((b) => b.type || "").concat(newTypes, ["secret_text"]))).filter(Boolean)
      : newTypes;

    const metadata = { main_module: "worker.js", compatibility_date: compatDate };
    if (keepTypes.length) metadata.keep_bindings = keepTypes;
    if (newBindings.length) metadata.bindings = newBindings;

    // ۳) آپلود multipart
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    fd.append("worker.js", new Blob([opts.code], { type: "application/javascript+module" }), "worker.js");
    const u = await cfFetch(base, { method: "PUT", body: fd, timeoutMs: 90000 });
    if (!u.ok) throw new Error(friendlyCfError(u.data.errors, u.status));

    // ۴) راستی‌آزمایی bindings
    let bindingsAfter = [];
    try {
      const v = await cfFetch(base + "/settings", { timeoutMs: 20000 });
      if (v.ok) {
        const rb = (v.data.result && v.data.result.bindings) || [];
        bindingsAfter = rb.map((b) => b.name || "").filter(Boolean).sort();
      }
    } catch (e) { /* فقط گزارش کمتر */ }
    const beforeNames = oldBindings.map((b) => b.name || "").filter(Boolean).sort();
    const lost = beforeNames.filter((n) => !bindingsAfter.includes(n));

    // ۵) آدرس workers.dev
    let url = null;
    try {
      await cfFetch(base + "/subdomain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, previews_enabled: false }),
        timeoutMs: 20000,
      });
      const sd = await cfFetch("accounts/" + S.accountId + "/workers/subdomain", { timeoutMs: 20000 });
      const sub = sd.data.result && sd.data.result.subdomain;
      if (sub) url = "https://" + opts.name + "." + sub + ".workers.dev";
    } catch (e) { /* نمایش URL اختیاری */ }

    return { isNew: isNew, url: url, kept: bindingsAfter, lost: lost, compatDate: compatDate };
  },

  async saveVarsOnly(workerName, vars, secrets) {
    const base = "accounts/" + S.accountId + "/workers/scripts/" + workerName;
    const s = await cfFetch(base + "/settings", { timeoutMs: 20000 });
    if (!s.ok) throw new Error(friendlyCfError(s.data.errors, s.status));
    const cur = (s.data.result && s.data.result.bindings) || [];
    const kept = cur.filter((b) => b.type !== "plain_text" && b.type !== "secret_text");
    const fresh = [];
    for (const [n, text] of Object.entries(vars || {})) {
      if (n.trim()) fresh.push({ type: "plain_text", name: n.trim(), text: String(text == null ? "" : text) });
    }
    for (const [n, text] of Object.entries(secrets || {})) {
      if (n.trim() && String(text) !== "") fresh.push({ type: "secret_text", name: n.trim(), text: String(text) });
    }
    const body = { bindings: kept.concat(fresh) };
    if (s.data.result && s.data.result.compatibility_date) body.compatibility_date = s.data.result.compatibility_date;
    const p = await cfFetch(base + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 30000,
    });
    if (!p.ok) throw new Error(friendlyCfError(p.data.errors, p.status));
    return true;
  },

  async webhookCall(platform, botToken, method, params) {
    const host = platform === "telegram" ? "api.telegram.org" : "api.bale.ai";
    const qs = new URLSearchParams(params).toString();
    const url = "https://" + host + "/bot" + botToken + "/" + method + (qs ? "?" + qs : "");
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok === true, data: data, status: res.status };
  },

  /* نام تایپ‌شده را با کلادفلر تطبیق می‌دهد: اگر نام دقیق وجود داشت همان استفاده
     می‌شود (ورکرهای قدیمی با زیرخط)؛ وگرنه نسخه پاکیزه‌شده امتحان می‌شود. */
  async resolveWorkerName(typed) {
    const exact = String(typed == null ? "" : typed).trim();
    if (!exact) return { name: "", note: "" };
    const norm = NameSan.normalizeWorker(exact);
    const exists = async (n) => {
      try {
        const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts/" + encodeURIComponent(n) + "/settings", { timeoutMs: 15000 });
        return !!r.ok;
      } catch (e) { return false; }
    };
    if (await exists(exact)) return { name: exact, note: "" };
    if (norm && norm !== exact && (await exists(norm))) {
      return { name: norm, note: t("resolve.note", { a: exact, b: norm }) };
    }
    return { name: norm || exact, note: "" };
  },
};

/* ═══════════ تب راه‌اندازی ═══════════ */
const Setup = {
  loadDefaults() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(LS.last) || "null"); } catch (e) { /* خالی */ }
    if (d) {
      if (d.worker && !$("sWorker").value) $("sWorker").value = d.worker;
      if (d.d1 && !$("sD1").value) $("sD1").value = d.d1;
      if (d.binding) $("sBinding").value = d.binding;
      NameSan.refresh("sWorker", "sWorkerHint");
    }
  },
  saveDefaults() {
    localStorage.setItem(LS.last, JSON.stringify({
      worker: $("sWorker").value.trim(),
      d1: $("sD1").value.trim(),
      binding: $("sBinding").value.trim(),
    }));
  },
  validateNames() {
    const w = NameSan.normalizeWorker($("sWorker").value);
    $("sWorker").value = w;
    NameSan.refresh("sWorker", "sWorkerHint");
    const d1 = ($("sD1").value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
    $("sD1").value = d1;
    const binding = ($("sBinding").value || "").trim();
    if (!w) throw new Error(t("name.need"));
    if (binding && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(binding)) throw new Error(t("name.binding"));
    return { w: w, d1: d1, binding: binding };
  },

  async stepD1(alsoRunAll) {
    const msg = $("msgD1");
    try {
      const { d1, binding } = Setup.validateNames();
      const schema = ($("sSchemaText").value || "").trim();
      if (!d1) throw new Error(t("setup.nod1"));
      if (!schema) throw new Error(t("setup.noschema"));
      stepMsg("msgD1", t("setup.db.making"), "busy");
      const db = await CloudOps.ensureD1(d1);
      Log.step("🗄️ D1: " + d1 + (db.created ? t("setup.db.created") : t("setup.db.existed")));
      Log.add(t("setup.log.dbid", { id: db.id }));
      stepMsg("msgD1", t("setup.db.ready"), "busy");
      const res = await CloudOps.runSql(db.id, schema);
      const done = t("setup.db.done", {
        pre: db.created ? t("setup.db.new") : t("setup.db.old"),
        n: res.executed,
      });
      stepMsg("msgD1", done, "ok");
      Log.add("📋 " + t("setup.log.sql", { n: res.executed, mode: res.mode }), "ok");
      return db;
    } catch (e) {
      stepMsg("msgD1", "❌ " + (e.friendly || e.message), "err");
      Log.add(t("setup.err.d1", { e: e.friendly || e.message }), "err");
      throw e;
    }
  },

  async stepDeploy() {
    const msg = $("msgDeploy");
    try {
      const { w, d1, binding } = Setup.validateNames();
      const code = $("sCodeText").value || "";
      const v = Vars.collect("sVars");
      let d1Bindings = [];
      if (d1 && binding) {
        stepMsg("msgDeploy", t("setup.deploy.finddb"), "busy");
        const db = await CloudOps.ensureD1(d1);
        d1Bindings = [{ binding: binding, id: db.id }];
      }
      stepMsg("msgDeploy", t("setup.deploy.uploading"), "busy");
      const res = await CloudOps.deployWorker({
        name: w, code: code, vars: v.vars, secrets: v.secrets, d1: d1Bindings, keepExisting: true,
      });
      Setup.saveDefaults();
      let text = (res.isNew ? t("setup.deploy.ok.new") : t("setup.deploy.ok.upd")) +
        (res.url ? "\n🔗 " + res.url : "");
      if (res.lost.length) text += "\n⚠️ " + t("setup.deploy.lost", { n: res.lost.join(", ") });
      stepMsg("msgDeploy", text, "ok");
      Log.step("⚙️ " + t("setup.log.deployed", { w: w, act: res.isNew ? t("log.w.new") : t("log.w.upd"), url: res.url ? " → " + res.url : "" }));
      if (res.kept.length) Log.add(t("setup.log.bindings", { n: res.kept.join(", ") }));
      if (res.url) $("wWorkerUrl").value = res.url;
      return res;
    } catch (e) {
      stepMsg("msgDeploy", "❌ " + (e.friendly || e.message), "err");
      Log.add(t("setup.err.deploy", { e: e.friendly || e.message }), "err");
      throw e;
    }
  },

  async stepWebhook() {
    const msg = $("msgHook");
    try {
      const platform = $("sHookPlatform").value;
      const token = ($("sHookToken").value || "").trim();
      if (!token) throw new Error(t("setup.needtoken"));
      const { w } = Setup.validateNames();
      let url = ($("wWorkerUrl").value || "").trim();
      if (!url) {
        const sd = await cfFetch("accounts/" + S.accountId + "/workers/subdomain", { timeoutMs: 15000 });
        const sub = sd.data.result && sd.data.result.subdomain;
        if (!sub) throw new Error(t("setup.nourl"));
        url = "https://" + w + "." + sub + ".workers.dev";
      }
      const path = ($("sHookPath").value || "").trim().replace(/^\/+|\/+$/g, "");
      const hookUrl = url.replace(/\/+$/, "") + (path ? "/" + path : "");
      stepMsg("msgHook", t("setup.hook.setting", { p: platform === "telegram" ? "Telegram" : "Bale", url: hookUrl }), "busy");
      const r = await CloudOps.webhookCall(platform, token, "setWebhook", { url: hookUrl });
      if (!r.ok) {
        const d = r.data || {};
        throw new Error(t("hook.rejected", { m: (d.description || (d.errors && d.errors[0] && d.errors[0].message)) || ("HTTP " + r.status) }));
      }
      let extra = "";
      try {
        const info = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
        const res = info.ok && info.data.result;
        if (res && res.url === hookUrl) extra = "\n" + t("setup.hook.verified");
        else if (res && res.url) extra = "\n⚠️ " + t("setup.hook.other", { u: res.url });
      } catch (e) { /* بررسی اختیاری */ }
      stepMsg("msgHook", t("setup.hook.ok", { url: hookUrl, extra: extra }), "ok");
      Log.step(t("setup.log.hook", { u: hookUrl }));
      if (!$("wWorkerUrl").value) $("wWorkerUrl").value = url;
      return true;
    } catch (e) {
      if (e.name === "TypeError") {
        stepMsg("msgHook", t("setup.hook.cors"), "err");
      } else {
        stepMsg("msgHook", "❌ " + (e.friendly || e.message), "err");
      }
      Log.add(t("setup.err.hook", { e: e.friendly || e.message }), "err");
      throw e;
    }
  },

  async runAll() {
    try {
      const { w, d1, binding } = Setup.validateNames();
      if (!($("sCodeText").value || "").trim()) throw new Error(t("setup.needcode"));
      Log.clear();
      Log.step("▶️ " + t("setup.runall.title", { w: w }));
      let db = null;
      if (d1 && ($("sSchemaText").value || "").trim()) {
        db = await Setup.stepD1();
      } else {
        Log.add(t("setup.skipd1"));
      }
      await Setup.stepDeploy();
      if (($("sHookToken").value || "").trim()) {
        try { await Setup.stepWebhook(); }
        catch (e) { Log.add(t("setup.hookfail"), "err"); }
      } else {
        Log.add(t("setup.skiphook"));
      }
      Log.step(t("setup.done"));
      toast(t("setup.done.toast"));
    } catch (e) {
      Log.add(t("setup.stopped"), "err");
      toast(t("setup.stopped.toast"));
    }
  },
};

/* ═══════════ تب بروزرسانی ═══════════ */
const Update = {
  async listWorkers() {
    try {
      toast(t("upd.getting"));
      const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts", { timeoutMs: 20000 });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const list = Array.isArray(r.data.result) ? r.data.result : [];
      const names = list.map((s) => (typeof s === "string" ? s : (s.id || s.name || ""))).filter(Boolean);
      // datalist برای مرورگرهایی که پشتیبانی می‌کنند
      const dl = $("workerList");
      dl.innerHTML = "";
      names.forEach((n) => { const o = document.createElement("option"); o.value = n; dl.appendChild(o); });
      // چیپ‌های قابل‌کلیک — در همه مرورگرها دیده می‌شوند
      ["workerPick", "workerPick2", "workerPick3"].forEach((cid) => {
        const c = $(cid);
        if (!c) return;
        c.innerHTML = "";
        if (!names.length) {
          const s = document.createElement("span");
          s.className = "pick-empty";
          s.textContent = t("upd.none");
          c.appendChild(s);
          return;
        }
        names.forEach((n) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "pickbtn";
          b.textContent = n;
          b.onclick = () => {
            $("uWorkerName").value = n;
            if ($("uVarsWorker")) $("uVarsWorker").value = n;
            if ($("tWorker")) $("tWorker").value = n;
            NameSan.refreshAll();
            toast(t("upd.picked", { n: n }));
          };
          c.appendChild(b);
        });
      });
      toast(names.length ? t("upd.found", { n: names.length }) : t("upd.none"));
      if (names.length) $("workerPick").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      toast(e.friendly || e.message);
    }
  },
  async deploy() {
    const msg = $("msgUWorker");
    try {
      const typed = ($("uWorkerName").value || "").trim();
      if (!typed) throw new Error(t("upd.needname"));
      stepMsg("msgUWorker", t("upd.finding"), "busy");
      const resolved = await CloudOps.resolveWorkerName(typed);
      const name = resolved.name;
      $("uWorkerName").value = name;
      if (resolved.note) { toast(resolved.note); Log.add(resolved.note); }
      const code = $("uCodeText").value || "";
      if (!code.trim()) throw new Error(t("setup.needcode"));
      const v = Vars.collect("uVars");
      stepMsg("msgUWorker", t("upd.uploading"), "busy");
      const res = await CloudOps.deployWorker({
        name: name, code: code,
        vars: v.vars, secrets: v.secrets, d1: [],
        keepExisting: $("uKeep").checked,
      });
      let text = (res.isNew ? t("upd.ok.new") : t("upd.ok")) +
        (res.url ? "\n🔗 " + res.url : "");
      if (res.lost.length) text += "\n⚠️ " + t("upd.lost", { n: res.lost.join(", ") });
      stepMsg("msgUWorker", text, "ok");
      Log.step("🔄 " + t("setup.log.deployed", { w: name, act: t("log.w.upd"), url: res.url ? " → " + res.url : "" }));
      if (res.url) $("wWorkerUrl").value = res.url;
    } catch (e) {
      stepMsg("msgUWorker", "❌ " + (e.friendly || e.message), "err");
    }
  },
  async listD1() {
    try {
      toast(t("upd.dbs.getting"));
      const r = await cfFetch("accounts/" + S.accountId + "/d1/database?per_page=100", { timeoutMs: 20000 });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const raw = Array.isArray(r.data.result) ? r.data.result : ((r.data.result && r.data.result.results) || []);
      const sel = $("uD1Select");
      sel.innerHTML = "";
      if (!raw.length) {
        const o = document.createElement("option");
        o.textContent = t("upd.dbs.none");
        sel.appendChild(o);
        toast(t("upd.dbs.none.toast"));
        return;
      }
      raw.forEach((db) => {
        const o = document.createElement("option");
        o.value = db.uuid || db.database_id || "";
        o.textContent = db.name + (db.created_at ? " — " + db.created_at.slice(0, 10) : "");
        sel.appendChild(o);
      });
      toast(t("upd.dbs.found", { n: raw.length }));
    } catch (e) {
      toast(e.friendly || e.message);
    }
  },
  async runSql() {
    const msg = $("msgUD1");
    try {
      const dbId = $("uD1Select").value;
      if (!dbId) throw new Error(t("upd.sql.needdb"));
      const sql = $("uSqlText").value || "";
      if (!sql.trim()) throw new Error(t("sql.empty"));
      stepMsg("msgUD1", t("upd.sql.running"), "busy");
      const res = await CloudOps.runSql(dbId, sql);
      stepMsg("msgUD1", t("upd.sql.ok", {
        n: res.executed,
        m: res.mode === "script" ? t("upd.sql.mode.script") : t("upd.sql.mode.chunked"),
      }), "ok");
      Log.step("🗄️ " + t("upd.sql.log", { n: res.executed }));
    } catch (e) {
      stepMsg("msgUD1", "❌ " + (e.friendly || e.message), "err");
    }
  },
  async showBindings() {
    const msg = $("msgUVars");
    const view = $("bindingsView");
    try {
      const typed = ($("uVarsWorker").value || "").trim();
      if (!typed) throw new Error(t("upd.vars.needname"));
      const resolved = await CloudOps.resolveWorkerName(typed);
      const name = resolved.name;
      $("uVarsWorker").value = name;
      const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts/" + name + "/settings", { timeoutMs: 20000 });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const bs = (r.data.result && r.data.result.bindings) || [];
      view.innerHTML = "";
      if (!bs.length) view.innerHTML = '<p class="hint">' + esc(t("upd.vars.none")) + "</p>";
      const TYPE_L = {
        plain_text: t("type.plain"), secret_text: t("type.secret"), d1: t("type.d1"),
        kv_namespace: t("type.kv"), r2_bucket: t("type.r2"), service: t("type.service"),
      };
      bs.forEach((b) => {
        const d = document.createElement("div");
        d.className = "brow";
        d.innerHTML = "<b>" + esc(b.name) + "</b><span class='btype'>" + esc(TYPE_L[b.type] || b.type) + "</span>";
        view.appendChild(d);
      });
      // پر کردن ویرایشگر با متغیرهای فعلی (مقدار Secretها هرگز برنمی‌گردد)
      const ed = $("uVarsQuick");
      ed.innerHTML = "";
      bs.filter((b) => b.type === "plain_text").forEach((b) => Vars.add("uVarsQuick", "plain", b.name, b.text || ""));
      bs.filter((b) => b.type === "secret_text").forEach((b) => Vars.add("uVarsQuick", "secret", b.name, ""));
      $("varsEditWrap").hidden = false;
      stepMsg("msgUVars", t("upd.vars.found", { n: bs.length }), "ok");
    } catch (e) {
      stepMsg("msgUVars", "❌ " + (e.friendly || e.message), "err");
    }
  },
  async saveBindings() {
    const msg = $("msgUVars");
    try {
      const typed = ($("uVarsWorker").value || "").trim();
      if (!typed) throw new Error(t("upd.vars.needname"));
      const resolved = await CloudOps.resolveWorkerName(typed);
      const name = resolved.name;
      $("uVarsWorker").value = name;
      const v = Vars.collect("uVarsQuick");
      stepMsg("msgUVars", t("upd.vars.saving"), "busy");
      await CloudOps.saveVarsOnly(name, v.vars, v.secrets);
      stepMsg("msgUVars", t("upd.vars.ok"), "ok");
      Log.step("🧩 " + t("upd.vars.log", { n: name }));
      await Update.showBindings();
    } catch (e) {
      stepMsg("msgUVars", "❌ " + (e.friendly || e.message), "err");
    }
  },
};
/* ═══════════ تب وب‌هوک ═══════════ */
const Webhook = {
  host(platform) { return platform === "telegram" ? "api.telegram.org" : "api.bale.ai"; },
  base() { return ($("wWorkerUrl").value || "").trim().replace(/\/+$/, ""); },
  fullUrl() {
    const url = Webhook.base();
    const path = ($("wPath").value || "").trim().replace(/^\/+|\/+$/g, "");
    return url + (path ? "/" + path : "");
  },
  async genManual(kind) {
    const platform = $("wPlatform").value;
    const token = ($("wBotToken").value || "").trim();
    const drop = $("wDrop") && $("wDrop").checked;
    if (kind === "delete") {
      $("hookCmd").value = 'curl -s "https://' + Webhook.host(platform) + "/bot" + token + '/deleteWebhook' + (drop ? "?drop_pending_updates=true" : "") + '"';
    } else {
      const hook = Webhook.fullUrl();
      $("hookCmd").value = 'curl -s "https://' + Webhook.host(platform) + "/bot" + token + '/setWebhook?url=' + encodeURIComponent(hook) + (drop ? "&drop_pending_updates=true" : "") + '"';
    }
    $("hookFallback").hidden = false;
    $("hookFallback").open = true;
    $("hookCmd").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
  async set() {
    const msg = $("msgWebhook");
    try {
      const platform = $("wPlatform").value;
      const token = ($("wBotToken").value || "").trim();
      const hook = Webhook.fullUrl();
      if (!/^https:\/\/.+/.test(hook)) throw new Error(t("hook.needurl"));
      if (!token) throw new Error(t("hook.needtoken"));
      msg.className = "stepmsg busy"; msg.textContent = t("hook.checking");
      const p = await Tools.probe(Webhook.base());
      const wName = Tools.workerNameFromUrl(Webhook.base());
      const deployed = wName ? await Tools.apiExists(wName) : null;
      if (deployed === false) {
        const go = confirm(t("hook.confirm.notfound", { n: wName }));
        if (!go) { msg.className = "stepmsg err"; msg.textContent = t("hook.cancel.notfound"); return; }
      } else if (!p.reachable) {
        const go = confirm(t("hook.confirm.dead"));
        if (!go) { msg.className = "stepmsg err"; msg.textContent = t("hook.cancel.dead"); return; }
      }
      const params = { url: hook };
      if ($("wDrop").checked) params.drop_pending_updates = "true";
      msg.className = "stepmsg busy"; msg.textContent = t("hook.setting");
      const r = await CloudOps.webhookCall(platform, token, "setWebhook", params);
      if (!r.ok) {
        const d = r.data || {};
        throw new Error(t("hook.rejected", { m: (d.description || (d.errors && d.errors[0] && d.errors[0].message)) || ("HTTP " + r.status) }));
      }
      let extra = "";
      try {
        const info = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
        const res = info.ok && info.data.result;
        if (res && res.url === hook) extra = "\n" + t("hook.verified");
        else if (res && res.url) extra = "\n⚠️ " + t("hook.other", { u: res.url });
      } catch (e) { /* اختیاری */ }
      msg.className = "stepmsg ok";
      msg.textContent = t("hook.ok", { u: hook, extra: extra });
      Log.step(t("setup.log.hook", { u: hook }));
    } catch (e) {
      if (e.name === "TypeError" || e.name === "TimeoutError") {
        msg.className = "stepmsg err";
        msg.textContent = t("hook.cors");
        await Webhook.genManual("set");
      } else {
        msg.className = "stepmsg err"; msg.textContent = "❌ " + (e.friendly || e.message);
      }
    }
  },
  async remove() {
    const msg = $("msgWebhook");
    try {
      const platform = $("wPlatform").value;
      const token = ($("wBotToken").value || "").trim();
      if (!token) throw new Error(t("hook.needtoken"));
      const go = confirm(t("hook.confirm.remove"));
      if (!go) return;
      msg.className = "stepmsg busy"; msg.textContent = t("hook.removing");
      const params = {};
      if ($("wDrop").checked) params.drop_pending_updates = "true";
      const r = await CloudOps.webhookCall(platform, token, "deleteWebhook", params);
      if (!r.ok) {
        const d = r.data || {};
        throw new Error(t("hook.rejected", { m: d.description || ("HTTP " + r.status) }));
      }
      msg.className = "stepmsg ok";
      msg.textContent = t("hook.removed");
      Log.add(t("hook.log.removed"));
    } catch (e) {
      if (e.name === "TypeError" || e.name === "TimeoutError") {
        msg.className = "stepmsg err";
        msg.textContent = t("hook.cors.termux");
        await Webhook.genManual("delete");
      } else {
        msg.className = "stepmsg err"; msg.textContent = "❌ " + (e.friendly || e.message);
      }
    }
  },
  async info() {
    const msg = $("msgWebhook");
    try {
      const platform = $("wPlatform").value;
      const token = ($("wBotToken").value || "").trim();
      if (!token) throw new Error(t("hook.needtoken"));
      msg.className = "stepmsg busy"; msg.textContent = t("hook.getting");
      const r = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
      if (!r.ok) throw new Error(t("hook.rejected2"));
      const res = r.data.result || {};
      const errDate = res.last_error_date ? new Date(res.last_error_date * 1000).toLocaleString(localeTag()) : "";
      msg.className = "stepmsg ok";
      msg.textContent = t("hook.info", {
        u: res.url || t("hook.info.nourl"),
        p: t("hook.info.pending", { n: res.pending_update_count || 0 }),
        e: res.last_error_message ? res.last_error_message + (errDate ? " — " + errDate : "") : t("hook.info.none"),
      });
      if (res.url) {
        try { $("wWorkerUrl").value = new URL(res.url).origin; } catch (e) { /* بی‌خطر */ }
      }
    } catch (e) {
      msg.className = "stepmsg err";
      msg.textContent = "❌ " + (e.friendly || e.message) + (e.name === "TypeError" ? t("hook.cors.hint") : "");
    }
  },
};

/* ═══════════ ابزارها: Cron Triggers + عیب‌یابی ═══════════ */
const Tools = {
  state: { crons: [] },
  async resolveTarget() {
    const typed = ($("tWorker").value || "").trim();
    if (!typed) throw new Error(t("tl.needtarget"));
    const resolved = await CloudOps.resolveWorkerName(typed);
    $("tWorker").value = resolved.name;
    if (resolved.note) { toast(resolved.note); Log.add(resolved.note); }
    Tools.setDashLinks(resolved.name);
    return resolved.name;
  },
  setDashLinks(name) {
    const base = "https://dash.cloudflare.com/" + S.accountId + "/workers/services/view/" + encodeURIComponent(name) + "/production";
    if ($("dashWorkerLink")) $("dashWorkerLink").href = base;
    if ($("dashLogsLink")) $("dashLogsLink").href = base;
    if ($("cronDashLink")) $("cronDashLink").href = base;
  },
  async ensureWorkerUrl() {
    let url = ($("tWorkerUrl").value || "").trim().replace(/\/+$/, "");
    if (url) return url;
    const name = await Tools.resolveTarget();
    const sd = await cfFetch("accounts/" + S.accountId + "/workers/subdomain", { timeoutMs: 15000 });
    const sub = sd.data.result && sd.data.result.subdomain;
    if (!sub) throw new Error(t("tl.nosub"));
    url = "https://" + name + "." + sub + ".workers.dev";
    $("tWorkerUrl").value = url;
    return url;
  },
  /* بررسی واقعی دیپلوی‌شدن ورکر از طریق API — چون DNS وایلدکارت workers.dev
     برای هر نامی پاسخ می‌دهد، تست شبکه به‌تنهایی کافی نیست */
  async apiExists(name) {
    if (!name) return null;
    try {
      const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts/" + encodeURIComponent(name) + "/settings", { timeoutMs: 15000 });
      return !!r.ok;
    } catch (e) { return null; }
  },
  workerNameFromUrl(url) {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith(".workers.dev")) return "";
      return u.hostname.split(".")[0] || "";
    } catch (e) { return ""; }
  },
  /* تست زنده‌بودن ورکر: اول fetch عادی؛ اگر CORS بست، پیشام no-cors
     مشخص می‌کند سرور زنده است یا واقعا در دسترس نیست. */
  async probe(url) {
    const now = () => (window.performance && performance.now ? performance.now() : Date.now());
    const t0 = now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      let text = "";
      try { text = (await res.text()).replace(/\s+/g, " ").slice(0, 140); } catch (e) { /* CORS جواب را می‌بندد */ }
      return { reachable: true, status: res.status, ms: Math.round(now() - t0), text: text };
    } catch (e) {
      try {
        await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(15000) });
        return { reachable: true, opaque: true, ms: Math.round(now() - t0) };
      } catch (e2) {
        return { reachable: false, ms: Math.round(now() - t0), error: t("tl.probe.err") };
      }
    }
  },
  row(label, value, cls) {
    const d = document.createElement("div");
    d.className = "drow" + (cls ? " " + cls : "");
    const b = document.createElement("b"); b.textContent = label + ": ";
    const s = document.createElement("span"); s.textContent = value;
    d.append(b, s);
    return d;
  },
  async probeWorker() {
    const out = $("diagOut");
    try {
      stepMsg("msgDiag", t("tl.probing"), "busy");
      const url = await Tools.ensureWorkerUrl();
      const wName = Tools.workerNameFromUrl(url);
      const deployed = wName ? await Tools.apiExists(wName) : null;
      const p = await Tools.probe(url);
      out.innerHTML = "";
      out.appendChild(Tools.row(t("tl.row.url"), url, ""));
      if (wName) out.appendChild(Tools.row(t("tl.row.deploy"), deployed === true ? t("tl.deploy.ok") : (deployed === false ? t("tl.deploy.no") : t("tl.deploy.unk")), deployed === true ? "ok" : (deployed === false ? "err" : "warn")));
      if (deployed === false) {
        out.appendChild(Tools.row(t("tl.row.guide"), t("tl.guide.notdeployed"), "err"));
        stepMsg("msgDiag", t("tl.notdeployed"), "err");
        Log.add(t("tl.log.notdeployed"), "err");
        return;
      }
      if (p.reachable) {
        if (p.opaque) {
          out.appendChild(Tools.row(t("tl.row.result"), t("tl.alive", { ms: p.ms }), "ok"));
          out.appendChild(Tools.row(t("tl.row.note"), t("tl.alive.note"), ""));
        } else {
          out.appendChild(Tools.row(t("tl.row.result"), "HTTP " + p.status + " — " + p.ms + "ms", p.status < 500 ? "ok" : "err"));
          if (p.text) out.appendChild(Tools.row(t("tl.row.resp"), p.text, ""));
        }
        if (!$("wWorkerUrl").value) $("wWorkerUrl").value = url;
        stepMsg("msgDiag", t("tl.alive.ok"), "ok");
        Log.add(t("tl.log.alive", { x: p.opaque ? "opaque" : "HTTP " + p.status, ms: p.ms }), "ok");
      } else {
        out.appendChild(Tools.row(t("tl.row.result"), t("tl.dead"), "err"));
        out.appendChild(Tools.row(t("tl.row.guide"), t("tl.guide.dead"), "err"));
        stepMsg("msgDiag", t("tl.dead.msg"), "err");
        Log.add(t("tl.log.dead"), "err");
      }
    } catch (e) {
      stepMsg("msgDiag", "❌ " + (e.friendly || e.message), "err");
    }
  },
  async botStatus() {
    const out = $("diagOut");
    try {
      const platform = $("tPlatform").value;
      const token = ($("tBotToken").value || "").trim();
      if (!token) throw new Error(t("tl.needtoken"));
      stepMsg("msgDiag", t("tl.bot.getting"), "busy");
      const me = await CloudOps.webhookCall(platform, token, "getMe", {});
      if (!me.ok) throw new Error(t("tl.bot.rejected", { m: (me.data && me.data.description) || ("HTTP " + me.status) }));
      const bot = me.data.result || {};
      const info = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
      const res = (info.ok && info.data.result) || {};
      const errDate = res.last_error_date ? new Date(res.last_error_date * 1000).toLocaleString(localeTag()) : "";
      out.innerHTML = "";
      out.appendChild(Tools.row(t("tl.row.bot"), "@" + (bot.username || "?") + (bot.first_name ? " — " + bot.first_name : ""), "ok"));
      out.appendChild(Tools.row(t("tl.row.hook"), res.url || t("hook.info.nourl"), res.url ? "ok" : "warn"));
      if (res.url) {
        try {
          const u = new URL(res.url);
          out.appendChild(Tools.row(t("tl.row.hookhost"), u.host + u.pathname, ""));
          if (!$("tWorkerUrl").value) $("tWorkerUrl").value = u.origin;
          if (!$("wWorkerUrl").value) $("wWorkerUrl").value = u.origin;
        } catch (e) { /* بی‌خطر */ }
      }
      out.appendChild(Tools.row(t("tl.row.pending"), t("hook.info.pending", { n: res.pending_update_count || 0 }), res.pending_update_count ? "warn" : "ok"));
      out.appendChild(Tools.row(t("tl.row.lasterr"), res.last_error_message ? res.last_error_message + (errDate ? " — " + errDate : "") : t("hook.info.none"), res.last_error_message ? "err" : "ok"));
      let advice = "";
      if (!res.url) advice = t("tl.advice.nourl");
      else if (res.last_error_message) advice = t("tl.advice.err");
      else advice = t("tl.advice.ok");
      out.appendChild(Tools.row(t("tl.row.result"), advice, res.last_error_message ? "warn" : "ok"));
      stepMsg("msgDiag", t("tl.bot.done"), "ok");
      Log.add(t("tl.log.bot", { u: bot.username || "?" }));
    } catch (e) {
      stepMsg("msgDiag", "❌ " + (e.friendly || e.message) + (e.name === "TypeError" ? t("tl.bot.cors") : ""), "err");
    }
  },
  validCron(c) {
    const s = String(c || "").trim().replace(/\s+/g, " ");
    if (!/^[\d*,/\- ]+$/.test(s)) return null;
    const f = s.split(" ");
    if (f.length < 5 || f.length > 6) return null;
    return s;
  },
  cronRender() {
    const box = $("cronList");
    box.innerHTML = "";
    if (!Tools.state.crons.length) {
      const s = document.createElement("span");
      s.className = "pick-empty";
      s.textContent = t("cron.empty");
      box.appendChild(s);
      return;
    }
    Tools.state.crons.forEach((c, i) => {
      const chip = document.createElement("span");
      chip.className = "cronchip";
      const code = document.createElement("code"); code.textContent = c;
      const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.title = t("cron.del");
      x.onclick = () => { Tools.state.crons.splice(i, 1); Tools.cronRender(); };
      chip.append(code, x);
      box.appendChild(chip);
    });
  },
  cronAdd() {
    const c = Tools.validCron($("cronInput").value);
    if (!c) { stepMsg("msgCron", t("cron.bad"), "err"); return; }
    if (Tools.state.crons.includes(c)) { toast(t("cron.dup")); return; }
    Tools.state.crons.push(c);
    $("cronInput").value = "";
    Tools.cronRender();
    stepMsg("msgCron", t("cron.added"), "ok");
  },
  cronPreset(v) { $("cronInput").value = v; Tools.cronAdd(); },
  async cronLoad() {
    const msg = $("msgCron");
    try {
      const name = await Tools.resolveTarget();
      msg.className = "stepmsg busy"; msg.textContent = t("cron.getting");
      const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts/" + encodeURIComponent(name) + "/schedules", { timeoutMs: 20000 });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const res = r.data.result;
      const list = Array.isArray(res) ? res : ((res && res.schedules) || []);
      Tools.state.crons = list.map((x) => x.cron).filter(Boolean);
      Tools.cronRender();
      msg.className = "stepmsg ok";
      msg.textContent = Tools.state.crons.length ? t("cron.found", { n: Tools.state.crons.length }) : t("cron.none");
    } catch (e) {
      msg.className = "stepmsg err"; msg.textContent = "❌ " + (e.friendly || e.message);
    }
  },
  async cronSave() {
    const msg = $("msgCron");
    try {
      const name = await Tools.resolveTarget();
      msg.className = "stepmsg busy"; msg.textContent = t("cron.saving");
      const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts/" + encodeURIComponent(name) + "/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedules: Tools.state.crons.map((c) => ({ cron: c })) }),
        timeoutMs: 30000,
      });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const res = r.data.result;
      const list = Array.isArray(res) ? res : ((res && res.schedules) || []);
      Tools.state.crons = list.map((x) => x.cron).filter(Boolean);
      Tools.cronRender();
      msg.className = "stepmsg ok";
      msg.textContent = t("cron.saved", { n: Tools.state.crons.length });
      Log.step("⏰ " + t("cron.log", { n: name, c: Tools.state.crons.join(" | ") || t("cron.log.empty") }));
    } catch (e) {
      msg.className = "stepmsg err"; msg.textContent = "❌ " + (e.friendly || e.message);
    }
  },
};

/* ═══════════ شروع ═══════════ */
(function init() {
  // زبان — اول از همه (قبل از هر متن دینامیک)
  I18N.init();

  // میان‌بر از خود پل: باز کردن آدرس پل در مرورگر → برگشت به پنل با ?bridge=...
  // فقط آدرس پل در فیلد پر می‌شود (ذخیره/اتصال نیازمند تست و کلیک خود کاربر است).
  let qbBridge = "";
  try {
    const q = new URLSearchParams(location.search);
    qbBridge = (q.get("bridge") || "").trim().replace(/\/+$/, "");
    if (qbBridge && !/^https:\/\/[a-z0-9.-]+/i.test(qbBridge)) qbBridge = "";
    if (q.get("bridge")) history.replaceState(null, "", location.pathname);
  } catch (e) { /* بی‌خطر */ }

  // پیش‌فرض‌ها از حافظه
  const savedBridge = localStorage.getItem(LS.bridge) || "";
  const bridge = qbBridge || savedBridge;
  $("fBridge").value = bridge;
  S.bridge = bridge;
  $("fAccount").value = localStorage.getItem(LS.account) || "";
  const savedToken = sessionStorage.getItem("cfw.token") || "";
  if (savedToken) { $("fToken").value = savedToken; S.token = savedToken; }

  if (qbBridge) {
    HintState.qs = qbBridge;
    setTimeout(() => toast(t("init.bridge.toast")), 300);
  }

  // تنظیمات ریپو (فیلدهای پنهان در ذخیره)
  let r = null;
  try { r = JSON.parse(localStorage.getItem(LS.repo) || "null"); } catch (e) { /* پیش‌فرض */ }
  if (!r) {
    r = { owner: "Alireza123456w6w", repo: "simple_cloudfire_worker_changer", branch: "main" };
    localStorage.setItem(LS.repo, JSON.stringify(r));
  }
  if ($("sWorker")) Setup.loadDefaults();

  // اتصال رویداد فایل‌ها — بدون فیلتر accept برای SQL (باگ اندروید)
  $("sSchemaFile").addEventListener("change", () => Source.fileToText("sSchemaFile", "sSchemaText", "sSchemaName"));
  $("sCodeFile").addEventListener("change", () => Source.fileToText("sCodeFile", "sCodeText", "sCodeName"));
  $("uCodeFile").addEventListener("change", () => Source.fileToText("uCodeFile", "uCodeText", "uCodeName"));
  $("uSqlFile").addEventListener("change", () => Source.fileToText("uSqlFile", "uSqlText", "uSqlName"));

  // کشیدن-ورها (drag & drop) فایل روی کادرهای متنی
  Source.wireDrop("sSchemaText", "sSchemaName");
  Source.wireDrop("sCodeText", "sCodeName");
  Source.wireDrop("uCodeText", "uCodeName");
  Source.wireDrop("uSqlText", "uSqlName");

  // تولید خودکار دستور پل هنگام تایپ
  $("bToken").addEventListener("input", Bridge.genCommand);
  $("bAccount").addEventListener("input", Bridge.genCommand);

  // پاکیزه‌سازی زنده نام ورکر (زیرخط مجاز نیست → خط تیره)
  NameSan.live("sWorker", "sWorkerHint");
  NameSan.live("uWorkerName", "uWorkerHint");
  NameSan.live("uVarsWorker", "uVarsWorkerHint");

  // ابزارها
  $("cronInput").addEventListener("keydown", (e) => { if (e.key === "Enter") Tools.cronAdd(); });

  // Enter در فرم اتصال
  $("fToken").addEventListener("keydown", (e) => { if (e.key === "Enter") Conn.connect(); });
  $("fAccount").addEventListener("keydown", (e) => { if (e.key === "Enter") Conn.connect(); });

  UI.chip();
  if (!qbBridge) {
    HintState.saved = !!bridge;
    HintState.tok = !!savedToken;
  }
  refreshBridgeHint();
  // اگر همه‌چیز آماده بود، خودکار وصل کن — ولی فقط با پل ذخیره‌شده‌ی خود کاربر
  // (نه با پلِ آمده از لینک: توکن نباید بدون کلیک کاربر از مسیر جدیدی رد شود)
  if (bridge && savedToken && (localStorage.getItem(LS.account) || "") && bridge === savedBridge) {
    Conn.connect();
  }
})();

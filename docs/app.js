"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   راه‌انداز Cloudflare Worker + D1 — نسخه استاتیک (GitHub Pages)
   همه فراخوانی‌های Cloudflare از طریق «پل» شخصی کاربر انجام می‌شود
   (api.cloudflare.com هدر CORS ندارد — تست شده ۲۰۲۶-۰۹).
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
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.hidden = true; }, ms || 2600);
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

/* ─── پیام فارسی خطاهای Cloudflare ─── */
function friendlyCfError(errors, status) {
  const first = (errors && errors[0]) || {};
  const code = first.code || 0;
  const msg = first.message || "خطای ناشناخته";
  if (code === 10000 || code === 9109 || code === 9106 || status === 401 || status === 403) {
    return "توکن API نامعتبر است یا دسترسی کافی ندارد. مطمئن شو دسترسی Workers Scripts و D1 را دارد. (" + msg + ")";
  }
  if (code === 10041 || status === 404) {
    return "منبع موردنظر در Cloudflare پیدا نشد — نام Worker یا دیتابیس را چک کن. (" + msg + ")";
  }
  if (code === 7003 || code === 7000) {
    return "Account ID اشتباه به نظر می‌رسد. از نوار آدرس داشبورد کپی‌اش کن. (" + msg + ")";
  }
  if (code === 6003) {
    return "هدر درخواست نامعتبر است — توکن را کامل و بدون فاصله اضافه بچسبان. (" + msg + ")";
  }
  return "Cloudflare: " + msg + " (کد " + code + ")";
}

/* ─── فراخوانی از طریق پل ─── */
async function cfFetch(path, init) {
  init = init || {};
  if (!S.bridge) throw { friendly: "اول پل را نصب و آدرسش را در کارت اتصال وارد کن." };
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
    if (e && e.name === "TimeoutError") throw { friendly: "پاسخ پل دیر آمد (تایم‌اوت). دوباره تلاش کن." };
    throw { friendly: "پل در دسترس نیست — آدرسش را چک کن یا دوباره نصبش کن." };
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
  const t = up.lastIndexOf("CREATE TRIGGER");
  if (t === -1) return true;
  const seg = up.slice(t);
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
    ["setup", "update", "webhook", "tools"].forEach((t) => { $("tab-" + t).hidden = t !== name; });
  },
  seg(segName) {
    document.querySelectorAll("#tab-update .segbtn").forEach((b) => b.classList.toggle("active", b.dataset.seg === segName));
    ["uWorker", "uD1", "uVars"].forEach((s) => { $("seg-" + s).hidden = s !== segName; });
  },
  openConn() { $("connCard").hidden = false; $("connCard").scrollIntoView({ behavior: "smooth", block: "start" }); },
  async copy(id) {
    const ok = await copyToClipboard($(id).value);
    toast(ok ? "کپی شد ✅" : "کپی نشد — دستی انتخاب و کپی کن");
  },
  chip() {
    const c = $("connChip");
    if (S.connected) { c.className = "chip chip-on"; c.textContent = "● متصل"; }
    else { c.className = "chip chip-off"; c.textContent = "● وصل نیست"; }
  },
};

/* ═══════════ گزارش زنده ═══════════ */
const Log = {
  add(text, cls) {
    $("logCard").hidden = false;
    const d = document.createElement("div");
    d.className = "l-" + (cls || "info");
    let stamp = "";
    try { stamp = "[" + new Date().toLocaleTimeString("fa-IR", { hour12: false }) + "] "; } catch (e) { /* بی‌خطر */ }
    d.textContent = stamp + text;
    $("log").appendChild(d);
    while ($("log").children.length > 400) $("log").removeChild($("log").firstChild);
    $("log").scrollTop = $("log").scrollHeight;
  },
  step(text) { Log.add(text, "step"); },
  async copy() {
    const ok = await copyToClipboard($("log").innerText);
    toast(ok ? "گزارش کپی شد ✅" : "کپی نشد");
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
      msg.textContent = "آدرس پل لازم است و باید با https:// شروع شود. اگر پل نداری، دکمه «نصب پل» را بزن (فقط یک بار طول می‌کشد).";
      return;
    }
    if (!S.token) {
      msg.className = "msg err";
      msg.textContent = "API Token کلادفلر لازم است. از dash.cloudflare.com/profile/api-tokens بسازش (دسترسی Workers Scripts Edit + D1 Edit).";
      return;
    }
    localStorage.setItem(LS.bridge, S.bridge);
    btn.disabled = true;
    msg.className = "msg"; msg.textContent = "در حال راستی‌آزمایی توکن از طریق پل…";
    try {
      const v = await cfFetch("user/tokens/verify", { timeoutMs: 20000 });
      if (!v.ok) { msg.className = "msg err"; msg.textContent = friendlyCfError(v.data.errors, v.status); return; }
      Log.add("توکن معتبر است ✅", "ok");

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
        const idx = prompt("چند اکانت پیدا شد، شماره‌اش را بزن:\n" + pick, "1");
        const n = parseInt(idx, 10);
        if (n >= 1 && n <= accounts.length) S.accountId = accounts[n - 1].id;
      }
      if (!S.accountId) needsAccountId = true;
      if (needsAccountId && !S.accountId) {
        msg.className = "msg err";
        msg.textContent = "توکن معتبر است ولی تشخیص خودکار اکانت نشد — یا Account ID را از نوار آدرس داشبورد کپی و دوباره «اتصال» را بزن، یا توکن را با دسترسی Account Settings Read بساز.";
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
      msg.textContent = "متصل شد ✅" + (accName ? " — اکانت: " + accName : "");
      $("tabsNav").hidden = false;
      $("connCard").hidden = true;
      UI.chip();
      Setup.loadDefaults();
      NameSan.refreshAll();
      Log.add("اتصال کامل شد — Account: " + S.accountId.slice(0, 8) + "…", "ok");
      if (!$("sWorker").value) $("sWorker").focus();
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = e.friendly || "اتصال به پل ممکن نشد — آدرس پل را چک کن.";
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
    toast(ok ? "کد پل کپی شد ✅ حالا در داشبورد کلادفلر بچسبان" : "کپی نشد — از کادر پایین دستی کپی کن");
    if (!ok) { $("bCode").scrollIntoView({ behavior: "smooth", block: "center" }); $("bCode").focus(); }
  },
  openBridge() {
    let url = ($("bUrl").value || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/.+/.test(url)) { toast("اول آدرس پل را وارد کن"); return; }
    window.open(url + "/ping", "_blank", "noopener");
  },
  genCommand() {
    const t = ($("bToken").value || "").trim();
    const a = ($("bAccount").value || "").trim();
    if (!t || !a) {
      $("bCmd").value = "Enter the API token and Account ID above to generate the command.";
      return;
    }
    const scriptsBase = "https://api.cloudflare.com/client/v4/accounts/" + a + "/workers/scripts";
    const workersBase = "https://api.cloudflare.com/client/v4/accounts/" + a + "/workers";
    const cmd = [
      "# CF Bridge installer - paste this WHOLE script into Termux / PC terminal and press Enter",
      'TOKEN="' + t + '"',
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
      'curl -s -X POST "$API/cf-bridge/subdomain" \\',
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
      msg.textContent = "آدرس پل باید کامل و با https:// باشد — مثل https://cf-bridge.name.workers.dev";
      return;
    }
    msg.className = "msg"; msg.textContent = "در حال تست پل…";
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
        msg.textContent = "این آدرس شبیه پل پاسخ نمی‌دهد — آدرس workers.dev ورکر را کامل و درست بچسبان.";
        return;
      }
      localStorage.setItem(LS.bridge, url);
      S.bridge = url;
      $("fBridge").value = url;
      const tokenOk = res.ok && data.success === true;
      msg.className = "msg ok";
      msg.textContent = tokenOk
        ? "پل و توکن هر دو سالم ✅ — «اتصال» را در کارت اتصال بزن."
        : "پل نصب و سالم است ✅ — حالا فقط توکن را در کارت اتصال وارد کن و «اتصال» را بزن.";
      $("bridgeHint").textContent = "پل نصب و تست شده: " + url;
      Bridge.closeModal();
      UI.openConn();
      toast("پل آماده شد 🎉");
      if (!$("fToken").value) $("fToken").focus();
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = "به پل دسترسی نبود — مطمئن شو دستور را کامل اجرا کرده‌ای و آدرس را درست چسبانده‌ای. (" + e.message + ")";
    }
  },
};

/* ═══════════ منبع کد (فایل / متن / ریپو) ═══════════ */
const Source = {
  async fileToText(inputId, textareaId, badgeId) {
    const f = $(inputId).files && $(inputId).files[0];
    if (!f) return;
    const text = await f.text();
    $(textareaId).value = text;
    $(badgeId).textContent = f.name + " (" + (text.length / 1024).toFixed(1) + "KB)";
    toast("فایل خوانده شد");
  },
  repoBase() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(LS.repo) || "null"); } catch (e) { /* پیش‌فرض */ }
    return r || { owner: "Alireza123456w6w", repo: "simple_cloudfire_worker_changer", branch: "main" };
  },
  async raw(path, taId, badgeId) {
    const r = Source.repoBase();
    const url = "https://raw.githubusercontent.com/" + r.owner + "/" + r.repo + "/" + r.branch + "/" + path + "?t=" + Date.now();
    toast("در حال دریافت از ریپو…");
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      toast("دریافت از ریپو ناموفق بود — اینترنت/آدرس ریپو را چک کن");
      return false;
    }
    if (!res.ok) {
      toast("فایل در ریپو پیدا نشد (HTTP " + res.status + ") — شاخه و نام فایل را چک کن");
      return false;
    }
    const text = await res.text();
    $(taId).value = text;
    if (badgeId) $(badgeId).textContent = path + " (" + (text.length / 1024).toFixed(1) + "KB)";
    toast(path + " از ریپو گرفته شد ✅");
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
    const t = document.createElement("button");
    t.className = "vtype"; t.type = "button"; t.textContent = type === "secret" ? "🔒" : "V";
    t.title = "کلیک = تبدیل Variable ↔ Secret";
    t.onclick = () => { t.textContent = t.textContent === "V" ? "🔒" : "V"; };
    const n = document.createElement("input");
    n.dir = "ltr"; n.placeholder = "NAME"; n.value = name || "";
    const v = document.createElement("input");
    v.dir = "ltr"; v.placeholder = type === "secret" ? "مقدار (خالی = بدون تغییر)" : "value";
    if (value !== undefined) v.value = value;
    const d = document.createElement("button");
    d.className = "vdel"; d.type = "button"; d.textContent = "✕";
    d.onclick = () => row.remove();
    row.append(t, n, v, d);
    box.appendChild(row);
  },
  collect(containerId) {
    const vars = {}, secrets = {};
    $(containerId).querySelectorAll(".vrow").forEach((row) => {
      const [t, n, v] = row.querySelectorAll("button, input");
      const name = n.value.trim();
      if (!name) return;
      if (t.textContent === "🔒") {
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
    if (/[\u0600-\u06FF]/.test(s)) out.push("حروف فارسی/عربی حذف شدند");
    if (/[A-Z]/.test(s)) out.push("حروف بزرگ به کوچک تبدیل شدند");
    if (/[_\s]/.test(s)) out.push("زیرخط (_) و فاصله → خط تیره (-)");
    if (/[۰-۹٠-٩]/.test(s)) out.push("ارقام فارسی به انگلیسی تبدیل شدند");
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
      h.textContent = raw ? "❌ هنوز نام معتبری نیست — فقط حروف کوچک انگلیسی، عدد و خط تیره (-)" : "";
      return;
    }
    const rs = NameSan.reasons(raw);
    if (rs.length) { h.className = "livehint warn"; h.textContent = "⚠️ اصلاح شد: " + rs.join(" — ") + " ← " + norm; }
    else { h.className = "livehint ok"; h.textContent = "✅ نام معتبر است"; }
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
      throw new Error("نام دیتابیس فقط حروف انگلیسی، عدد، خط تیره و زیرخط (حداکثر ۳۲ کاراکتر)");
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
      throw new Error("دیتابیس از قبل هست ولی در لیست پیدا نشد — از تب «بروزرسانی» انتخابش کن");
    }
    throw new Error(msg);
  },

  async runSql(databaseId, sql) {
    if (!sql || !sql.trim()) throw new Error("متن SQL خالی است");
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
    if (!stmts.length) throw new Error("هیچ دستور معتبری در SQL پیدا نشد");
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
          errors.push({ n: globalIndex >= 0 ? globalIndex + 1 : i + 1, preview: single.slice(0, 120), message: "اتصال قطع شد" });
        }
      }
    }
    if (errors.length) {
      const detail = errors.slice(0, 8).map((e) => "• دستور " + e.n + ": " + e.message + "\n  " + e.preview.replace(/\n/g, " ")).join("\n");
      const err = new Error(errors.length + " دستور از " + stmts.length + " دستور خطا داد" + (executed ? " (بقیه اجرا شدند)" : "") + ":\n" + detail);
      err.partial = true;
      throw err;
    }
    return { mode: "chunked", executed: executed, total: stmts.length };
  },

  async deployWorker(opts) {
    // opts: {name, code, vars, secrets, d1:[{binding,id}], keepExisting}
    if (looksEmptyWorker(opts.code)) {
      throw new Error("کد ورکر خالی یا ناقص است (باید ES Module باشد و export default داشته باشد). اول کد کامل را وارد کن.");
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
      return { name: norm, note: "نام «" + exact + "» در کلادفلر مجاز نیست — ورکر موجود «" + norm + "» استفاده شد" };
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
    if (!w) throw new Error("نام Worker لازم است — فقط حروف کوچک انگلیسی، عدد و خط تیره (-). زیرخط (_) در کلادفلر پذیرفته نمی‌شود و خودکار به خط تیره تبدیل می‌شود.");
    if (binding && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(binding)) throw new Error("نام اتصال (Binding) باید یک شناسه جاوااسکریپت معتبر باشد — مثل DB");
    return { w: w, d1: d1, binding: binding };
  },

  async stepD1(alsoRunAll) {
    const msg = $("msgD1");
    try {
      const { d1, binding } = Setup.validateNames();
      const schema = ($("sSchemaText").value || "").trim();
      if (!d1) throw new Error("نام دیتابیس D1 را وارد کن (یا اگر دیتابیس نمی‌خواهی، از مرحله ۳ ادامه بده)");
      if (!schema) throw new Error("اسکیمای SQL خالی است — فایل بده، بچسبان، یا از ریپو بگیر");
      stepMsg("msgD1", "در حال ساخت/پیدا کردن دیتابیس…", "busy");
      const db = await CloudOps.ensureD1(d1);
      Log.step("🗄️ D1: " + d1 + (db.created ? " ساخته شد ✅" : " از قبل بوده — همان استفاده می‌شود"));
      Log.add("شناسه دیتابیس: " + db.id);
      stepMsg("msgD1", "دیتابیس آماده است — در حال اجرای اسکیما…", "busy");
      const res = await CloudOps.runSql(db.id, schema);
      const done = (db.created ? "دیتابیس ساخته شد و " : "دیتابیس موجود و ") + "اسکیما اجرا شد ✅ (" + res.executed + " دستور)";
      stepMsg("msgD1", done, "ok");
      Log.add("📋 اجرای SQL: " + res.executed + " دستور (" + res.mode + ")", "ok");
      return db;
    } catch (e) {
      stepMsg("msgD1", "❌ " + (e.friendly || e.message), "err");
      Log.add("خطای مرحله D1: " + (e.friendly || e.message), "err");
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
        stepMsg("msgDeploy", "در حال پیدا کردن دیتابیس…", "busy");
        const db = await CloudOps.ensureD1(d1);
        d1Bindings = [{ binding: binding, id: db.id }];
      }
      stepMsg("msgDeploy", "در حال آپلود کد…", "busy");
      const res = await CloudOps.deployWorker({
        name: w, code: code, vars: v.vars, secrets: v.secrets, d1: d1Bindings, keepExisting: true,
      });
      Setup.saveDefaults();
      let text = (res.isNew ? "Worker جدید ساخته و دیپلو شد ✅" : "Worker بروزرسانی شد ✅") +
        (res.url ? "\n🔗 " + res.url : "");
      if (res.lost.length) text += "\n⚠️ این متغیرهای قبلی پیدا نشدند: " + res.lost.join(", ");
      stepMsg("msgDeploy", text, "ok");
      Log.step("⚙️ Worker «" + w + "» " + (res.isNew ? "ساخته شد" : "بروزرسانی شد") + (res.url ? " → " + res.url : ""));
      if (res.kept.length) Log.add("Bindings فعلی: " + res.kept.join(", "));
      if (res.url) $("wWorkerUrl").value = res.url;
      return res;
    } catch (e) {
      stepMsg("msgDeploy", "❌ " + (e.friendly || e.message), "err");
      Log.add("خطای دیپلوی Worker: " + (e.friendly || e.message), "err");
      throw e;
    }
  },

  async stepWebhook() {
    const msg = $("msgHook");
    try {
      const platform = $("sHookPlatform").value;
      const token = ($("sHookToken").value || "").trim();
      if (!token) throw new Error("توکن ربات را وارد کن (یا وب‌هوک را رد کن)");
      const { w } = Setup.validateNames();
      let url = ($("wWorkerUrl").value || "").trim();
      if (!url) {
        const sd = await cfFetch("accounts/" + S.accountId + "/workers/subdomain", { timeoutMs: 15000 });
        const sub = sd.data.result && sd.data.result.subdomain;
        if (!sub) throw new Error("آدرس ورکر را وارد کن (workers.dev پیدا نشد)");
        url = "https://" + w + "." + sub + ".workers.dev";
      }
      const path = ($("sHookPath").value || "").trim().replace(/^\/+|\/+$/g, "");
      const hookUrl = url.replace(/\/+$/, "") + (path ? "/" + path : "");
      stepMsg("msgHook", "در حال تنظیم وب‌هوک روی " + (platform === "telegram" ? "تلگرام" : "بله") + "…\n" + hookUrl, "busy");
      const r = await CloudOps.webhookCall(platform, token, "setWebhook", { url: hookUrl });
      if (!r.ok) {
        const d = r.data || {};
        throw new Error("پلتفرم رد کرد: " + ((d.description || (d.errors && d.errors[0] && d.errors[0].message)) || ("HTTP " + r.status)));
      }
      let extra = "";
      try {
        const info = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
        const res = info.ok && info.data.result;
        if (res && res.url === hookUrl) extra = "\n✅ بررسی شد — وب‌هوک روی پلتفرم فعال است";
        else if (res && res.url) extra = "\n⚠️ وب‌هوک فعلی پلتفرم آدرس دیگری است: " + res.url;
      } catch (e) { /* بررسی اختیاری */ }
      stepMsg("msgHook", "وب‌هوک تنظیم شد ✅\n" + hookUrl + extra, "ok");
      Log.step("🪝 وب‌هوک تنظیم شد → " + hookUrl);
      if (!$("wWorkerUrl").value) $("wWorkerUrl").value = url;
      return true;
    } catch (e) {
      if (e.name === "TypeError") {
        stepMsg("msgHook", "درخواست مستقیم از مرورگر رد شد (CORS پلتفرم) — از تب «وب‌هوک» روش دستی را استفاده کن.", "err");
      } else {
        stepMsg("msgHook", "❌ " + (e.friendly || e.message), "err");
      }
      Log.add("خطای وب‌هوک: " + (e.friendly || e.message), "err");
      throw e;
    }
  },

  async runAll() {
    try {
      const { w, d1, binding } = Setup.validateNames();
      if (!($("sCodeText").value || "").trim()) throw new Error("کد Worker را وارد کن (فایل، پیست، یا از ریپو)");
      Log.clear();
      Log.step("▶️ اجرای خودکار: " + w);
      let db = null;
      if (d1 && ($("sSchemaText").value || "").trim()) {
        db = await Setup.stepD1();
      } else {
        Log.add("مرحله D1 رد شد (نام دیتابیس یا اسکیما خالی بود)");
      }
      await Setup.stepDeploy();
      if (($("sHookToken").value || "").trim()) {
        try { await Setup.stepWebhook(); }
        catch (e) { Log.add("راه‌اندازی کامل شد ولی وب‌هوک تنظیم نشد — بعداً از تب وب‌هوک انجامش بده", "err"); }
      } else {
        Log.add("مرحله وب‌هوک رد شد (توکن ربات خالی بود)");
      }
      Log.step("🎉 تمام شد — ورکر آماده است");
      toast("راه‌اندازی کامل شد 🎉");
    } catch (e) {
      Log.add("⏹ اجرای خودکار در همین مرحله متوقف شد", "err");
      toast("ناتمام ماند — گزارش را ببین");
    }
  },
};

/* ═══════════ تب بروزرسانی ═══════════ */
const Update = {
  async listWorkers() {
    try {
      toast("در حال گرفتن لیست ورکرها…");
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
          s.textContent = "هیچ ورکری در این اکانت نیست — از تب «راه‌اندازی جدید» شروع کن";
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
            toast("انتخاب شد: " + n + " ✅");
          };
          c.appendChild(b);
        });
      });
      toast(names.length ? names.length + " ورکر پیدا شد ✅ — از لیست زیر یکی را لمس کن" : "هیچ ورکری در این اکانت نیست — از تب «راه‌اندازی جدید» شروع کن");
      if (names.length) $("workerPick").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      toast(e.friendly || e.message);
    }
  },
  async deploy() {
    const msg = $("msgUWorker");
    try {
      const typed = ($("uWorkerName").value || "").trim();
      if (!typed) throw new Error("نام Worker را وارد کن یا از لیست انتخاب کن");
      stepMsg("msgUWorker", "در حال پیدا کردن ورکر…", "busy");
      const resolved = await CloudOps.resolveWorkerName(typed);
      const name = resolved.name;
      $("uWorkerName").value = name;
      if (resolved.note) { toast(resolved.note); Log.add(resolved.note); }
      const code = $("uCodeText").value || "";
      if (!code.trim()) throw new Error("کد جدید را وارد کن (فایل، پیست، یا از ریپو)");
      const v = Vars.collect("uVars");
      stepMsg("msgUWorker", "در حال آپلود کد جدید…", "busy");
      const res = await CloudOps.deployWorker({
        name: name, code: code,
        vars: v.vars, secrets: v.secrets, d1: [],
        keepExisting: $("uKeep").checked,
      });
      let text = (res.isNew ? "⚠️ این نام قبلاً نبود — Worker جدید ساخته شد ✅" : "Worker بروزرسانی شد ✅") +
        (res.url ? "\n🔗 " + res.url : "");
      if (res.lost.length) text += "\n⚠️ این‌های قبلی پیدا نشدند: " + res.lost.join(", ");
      stepMsg("msgUWorker", text, "ok");
      Log.step("🔄 Worker «" + name + "» بروزرسانی شد" + (res.url ? " → " + res.url : ""));
      if (res.url) $("wWorkerUrl").value = res.url;
    } catch (e) {
      stepMsg("msgUWorker", "❌ " + (e.friendly || e.message), "err");
    }
  },
  async listD1() {
    try {
      toast("در حال گرفتن لیست دیتابیس‌ها…");
      const r = await cfFetch("accounts/" + S.accountId + "/d1/database?per_page=100", { timeoutMs: 20000 });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const raw = Array.isArray(r.data.result) ? r.data.result : ((r.data.result && r.data.result.results) || []);
      const sel = $("uD1Select");
      sel.innerHTML = "";
      if (!raw.length) {
        const o = document.createElement("option");
        o.textContent = "دیتابیسی نیست — از تب راه‌اندازی بساز";
        sel.appendChild(o);
        toast("هیچ دیتابیس D1ای در این اکانت نیست");
        return;
      }
      raw.forEach((db) => {
        const o = document.createElement("option");
        o.value = db.uuid || db.database_id || "";
        o.textContent = db.name + (db.created_at ? " — " + db.created_at.slice(0, 10) : "");
        sel.appendChild(o);
      });
      toast(raw.length + " دیتابیس پیدا شد ✅");
    } catch (e) {
      toast(e.friendly || e.message);
    }
  },
  async runSql() {
    const msg = $("msgUD1");
    try {
      const dbId = $("uD1Select").value;
      if (!dbId) throw new Error("اول لیست دیتابیس‌ها را بگیر و یکی را انتخاب کن");
      const sql = $("uSqlText").value || "";
      if (!sql.trim()) throw new Error("متن SQL خالی است");
      stepMsg("msgUD1", "در حال اجرای SQL…", "busy");
      const res = await CloudOps.runSql(dbId, sql);
      stepMsg("msgUD1", "اجرا شد ✅ (" + res.executed + " دستور، روش " + (res.mode === "script" ? "یک‌جا" : "تکه‌ای") + ")", "ok");
      Log.step("🗄️ SQL روی دیتابیس اجرا شد — " + res.executed + " دستور");
    } catch (e) {
      stepMsg("msgUD1", "❌ " + (e.friendly || e.message), "err");
    }
  },
  async showBindings() {
    const msg = $("msgUVars");
    const view = $("bindingsView");
    try {
      const typed = ($("uVarsWorker").value || "").trim();
      if (!typed) throw new Error("نام Worker را وارد کن");
      const resolved = await CloudOps.resolveWorkerName(typed);
      const name = resolved.name;
      $("uVarsWorker").value = name;
      const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts/" + name + "/settings", { timeoutMs: 20000 });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const bs = (r.data.result && r.data.result.bindings) || [];
      view.innerHTML = "";
      if (!bs.length) view.innerHTML = '<p class="hint">هیچ Bindingsای ندارد.</p>';
      const TYPE_FA = {
        plain_text: "متغیر", secret_text: "Secret", d1: "دیتابیس D1",
        kv_namespace: "KV", r2_bucket: "R2", service: "سرویس ورکر",
      };
      bs.forEach((b) => {
        const d = document.createElement("div");
        d.className = "brow";
        d.innerHTML = "<b>" + esc(b.name) + "</b><span class='btype'>" + (TYPE_FA[b.type] || b.type) + "</span>";
        view.appendChild(d);
      });
      // پر کردن ویرایشگر با متغیرهای فعلی (مقدار Secretها هرگز برنمی‌گردد)
      const ed = $("uVarsQuick");
      ed.innerHTML = "";
      bs.filter((b) => b.type === "plain_text").forEach((b) => Vars.add("uVarsQuick", "plain", b.name, b.text || ""));
      bs.filter((b) => b.type === "secret_text").forEach((b) => Vars.add("uVarsQuick", "secret", b.name, ""));
      $("varsEditWrap").hidden = false;
      stepMsg("msgUVars", bs.length + " مورد پیدا شد — برای تغییر، ویرایشگر پایین را باز کن.", "ok");
    } catch (e) {
      stepMsg("msgUVars", "❌ " + (e.friendly || e.message), "err");
    }
  },
  async saveBindings() {
    const msg = $("msgUVars");
    try {
      const typed = ($("uVarsWorker").value || "").trim();
      if (!typed) throw new Error("نام Worker را وارد کن");
      const resolved = await CloudOps.resolveWorkerName(typed);
      const name = resolved.name;
      $("uVarsWorker").value = name;
      const v = Vars.collect("uVarsQuick");
      stepMsg("msgUVars", "در حال ذخیره…", "busy");
      await CloudOps.saveVarsOnly(name, v.vars, v.secrets);
      stepMsg("msgUVars", "متغیرها ذخیره شد ✅ (بدون تغییر کد)", "ok");
      Log.step("🧩 متغیرهای «" + name + "» بروزرسانی شد");
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
      if (!/^https:\/\/.+/.test(hook)) throw new Error("آدرس ورکر را کامل وارد کن (https://name.sub.workers.dev)");
      if (!token) throw new Error("توکن ربات لازم است");
      msg.className = "stepmsg busy"; msg.textContent = "در حال چک کردن زنده‌بودن ورکر…";
      const p = await Tools.probe(Webhook.base());
      const wName = Tools.workerNameFromUrl(Webhook.base());
      const deployed = wName ? await Tools.apiExists(wName) : null;
      if (deployed === false) {
        const go = confirm("⚠️ ورکری با نام «" + wName + "» در اکانت کلادفلرت پیدا نشد — یعنی هنوز دیپلوی نشده یا آدرس اشتباه است.\n\nست کردن وب‌هوک روی آدرس مرده = قطع شدن ربات (همان مشکل قبلی).\n\nبا این حال ادامه می‌دهی؟");
        if (!go) { msg.className = "stepmsg err"; msg.textContent = "لغو شد — اول از تب «بروزرسانی» ورکر را دیپلوی کن."; return; }
      } else if (!p.reachable) {
        const go = confirm("⚠️ ورکر روی این آدرس پاسخ نمی‌دهد!\n\nاگر وب‌هوک را روی آدرس مرده ست کنی، ربات قطع می‌شود (همان مشکل قبلی).\n\nاول از تب «ابزارها» تست سلامت بگیر یا از تب «بروزرسانی» دیپلوی کن.\n\nبا این حال ادامه می‌دهی؟");
        if (!go) { msg.className = "stepmsg err"; msg.textContent = "لغو شد — اول ورکر را دیپلوی کن یا آدرس را اصلاح کن."; return; }
      }
      const params = { url: hook };
      if ($("wDrop").checked) params.drop_pending_updates = "true";
      msg.className = "stepmsg busy"; msg.textContent = "در حال تنظیم…";
      const r = await CloudOps.webhookCall(platform, token, "setWebhook", params);
      if (!r.ok) {
        const d = r.data || {};
        throw new Error("پلتفرم رد کرد: " + ((d.description || (d.errors && d.errors[0] && d.errors[0].message)) || ("HTTP " + r.status)));
      }
      let extra = "";
      try {
        const info = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
        const res = info.ok && info.data.result;
        if (res && res.url === hook) extra = "\n✅ تایید شد — وب‌هوک فعال است";
        else if (res && res.url) extra = "\n⚠️ وب‌هوک فعلی پلتفرم: " + res.url;
      } catch (e) { /* اختیاری */ }
      msg.className = "stepmsg ok";
      msg.textContent = "وب‌هوک تنظیم شد ✅ → " + hook + extra;
      Log.step("🪝 وب‌هوک تنظیم شد → " + hook);
    } catch (e) {
      if (e.name === "TypeError" || e.name === "TimeoutError") {
        msg.className = "stepmsg err";
        msg.textContent = "درخواست مستقیم از مرورگر رد شد (CORS/شبکه). دستور آماده‌ی زیر را در Termux یا کامپیوتر اجرا کن:";
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
      if (!token) throw new Error("توکن ربات لازم است");
      const go = confirm("وب‌هوک قطع شود؟\nتا تنظیم دوباره، ربات هیچ پیامی دریافت نمی‌کند.");
      if (!go) return;
      msg.className = "stepmsg busy"; msg.textContent = "در حال قطع…";
      const params = {};
      if ($("wDrop").checked) params.drop_pending_updates = "true";
      const r = await CloudOps.webhookCall(platform, token, "deleteWebhook", params);
      if (!r.ok) {
        const d = r.data || {};
        throw new Error("پلتفرم رد کرد: " + (d.description || "HTTP " + r.status));
      }
      msg.className = "stepmsg ok";
      msg.textContent = "وب‌هوک قطع شد — برای وصل دوباره، «تنظیم وب‌هوک» را بزن.";
      Log.add("🪝 وب‌هوک قطع شد");
    } catch (e) {
      if (e.name === "TypeError" || e.name === "TimeoutError") {
        msg.className = "stepmsg err";
        msg.textContent = "درخواست مستقیم از مرورگر رد شد (CORS/شبکه). دستور آماده‌ی زیر را در Termux اجرا کن:";
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
      if (!token) throw new Error("توکن ربات لازم است");
      msg.className = "stepmsg busy"; msg.textContent = "در حال گرفتن وضعیت…";
      const r = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
      if (!r.ok) throw new Error("پلتفرم رد کرد (توکن/شبکه را چک کن)");
      const res = r.data.result || {};
      const errDate = res.last_error_date ? new Date(res.last_error_date * 1000).toLocaleString("fa-IR") : "";
      msg.className = "stepmsg ok";
      msg.textContent = "URL فعلی: " + (res.url || "— تنظیم نشده —") +
        "\nعقب‌افتاده: " + (res.pending_update_count || 0) + " پیام" +
        "\nآخرین خطا: " + (res.last_error_message ? res.last_error_message + (errDate ? " — " + errDate : "") : "ندارد");
      if (res.url) {
        try { $("wWorkerUrl").value = new URL(res.url).origin; } catch (e) { /* بی‌خطر */ }
      }
    } catch (e) {
      msg.className = "stepmsg err";
      msg.textContent = "❌ " + (e.friendly || e.message) + (e.name === "TypeError" ? " — احتمالاً CORS پلتفرم اجازه نمی‌دهد؛ از دکمه «دستور دستی» استفاده کن." : "");
    }
  },
};

/* ═══════════ ابزارها: Cron Triggers + عیب‌یابی ═══════════ */
const Tools = {
  state: { crons: [] },
  async resolveTarget() {
    const typed = ($("tWorker").value || "").trim();
    if (!typed) throw new Error("نام ورکر هدف را انتخاب کن (لیست را بگیر یا تایپ کن)");
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
    if (!sub) throw new Error("زیردامنه workers.dev پیدا نشد — آدرس ورکر را دستی وارد کن");
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
        return { reachable: false, ms: Math.round(now() - t0), error: "پاسخی دریافت نشد (DNS/شبکه/ورکر خاموش)" };
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
      stepMsg("msgDiag", "در حال تست سلامت ورکر…", "busy");
      const url = await Tools.ensureWorkerUrl();
      const wName = Tools.workerNameFromUrl(url);
      const deployed = wName ? await Tools.apiExists(wName) : null;
      const p = await Tools.probe(url);
      out.innerHTML = "";
      out.appendChild(Tools.row("آدرس", url, ""));
      if (wName) out.appendChild(Tools.row("وضعیت دیپلوی", deployed === true ? "در اکانت ثبت شده ✅" : (deployed === false ? "در اکانت پیدا نشد ❌ — هنوز دیپلوی نشده یا نامش فرق دارد" : "نامشخص (بررسی API ممکن نشد)"), deployed === true ? "ok" : (deployed === false ? "err" : "warn")));
      if (deployed === false) {
        out.appendChild(Tools.row("راهنما", "اول از تب «بروزرسانی» کد را دیپلوی کن، بعد وب‌هوک ست کن. وب‌هوک روی ورکر دیپلوی‌نشده = قطع شدن ربات.", "err"));
        stepMsg("msgDiag", "ورکر دیپلوی نشده — وب‌هوک روی این آدرس ست نشود!", "err");
        Log.add("🔎 سلامت ورکر: در اکانت پیدا نشد", "err");
        return;
      }
      if (p.reachable) {
        if (p.opaque) {
          out.appendChild(Tools.row("نتیجه", "زنده است ✅ (پاسخ داد) — زمان " + p.ms + "ms", "ok"));
          out.appendChild(Tools.row("توضیح", "کد وضعیت HTTP از مرورگر قابل خواندن نیست (CORS) — برای ورکر ربات طبیعی است", ""));
        } else {
          out.appendChild(Tools.row("نتیجه", "HTTP " + p.status + " — زمان " + p.ms + "ms", p.status < 500 ? "ok" : "err"));
          if (p.text) out.appendChild(Tools.row("پاسخ", p.text, ""));
        }
        if (!$("wWorkerUrl").value) $("wWorkerUrl").value = url;
        stepMsg("msgDiag", "ورکر زنده است ✅ — حالا می‌توانی وب‌هوک را با خیال راحت ست کنی", "ok");
        Log.add("🔎 سلامت ورکر: زنده (" + (p.opaque ? "opaque" : "HTTP " + p.status) + ", " + p.ms + "ms)", "ok");
      } else {
        out.appendChild(Tools.row("نتیجه", "در دسترس نیست ❌", "err"));
        out.appendChild(Tools.row("راهنما", "ورکر دیپلوی نشده یا آدرس اشتباه است. از تب «بروزرسانی» کد را دیپلوی کن و دوباره تست کن. وب‌هوک روی آدرس مرده ست نشود (ربات قطع می‌شود).", "err"));
        stepMsg("msgDiag", "ورکر در دسترس نیست — وب‌هوک روی این آدرس ست نشود!", "err");
        Log.add("🔎 سلامت ورکر: در دسترس نیست", "err");
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
      if (!token) throw new Error("توکن ربات را وارد کن (همان توکن BotFather یا بله)");
      stepMsg("msgDiag", "در حال گرفتن وضعیت ربات…", "busy");
      const me = await CloudOps.webhookCall(platform, token, "getMe", {});
      if (!me.ok) throw new Error("توکن رد شد — بررسی کن (" + ((me.data && me.data.description) || "HTTP " + me.status) + ")");
      const bot = me.data.result || {};
      const info = await CloudOps.webhookCall(platform, token, "getWebhookInfo", {});
      const res = (info.ok && info.data.result) || {};
      const errDate = res.last_error_date ? new Date(res.last_error_date * 1000).toLocaleString("fa-IR") : "";
      out.innerHTML = "";
      out.appendChild(Tools.row("ربات", "@" + (bot.username || "?") + (bot.first_name ? " — " + bot.first_name : ""), "ok"));
      out.appendChild(Tools.row("وب‌هوک", res.url || "— تنظیم نشده —", res.url ? "ok" : "warn"));
      if (res.url) {
        try {
          const u = new URL(res.url);
          out.appendChild(Tools.row("هاست وب‌هوک", u.host + u.pathname, ""));
          if (!$("tWorkerUrl").value) $("tWorkerUrl").value = u.origin;
          if (!$("wWorkerUrl").value) $("wWorkerUrl").value = u.origin;
        } catch (e) { /* بی‌خطر */ }
      }
      out.appendChild(Tools.row("عقب‌افتاده", (res.pending_update_count || 0) + " پیام", res.pending_update_count ? "warn" : "ok"));
      out.appendChild(Tools.row("آخرین خطا", res.last_error_message ? res.last_error_message + (errDate ? " — " + errDate : "") : "ندارد", res.last_error_message ? "err" : "ok"));
      let advice = "";
      if (!res.url) advice = "وب‌هوک تنظیم نشده — از تب «وب‌هوک» ست کن";
      else if (res.last_error_message) advice = "وب‌هوک ست شده ولی پلتفرم خطا می‌گیرد — «تست سلامت ورکر» را بزن؛ اگر ورکر زنده بود، مسیر وب‌هوک را چک کن (ربات‌های این پنل: ریشه)";
      else advice = "همه‌چیز سالم به نظر می‌رسد ✅";
      out.appendChild(Tools.row("نتیجه", advice, res.last_error_message ? "warn" : "ok"));
      stepMsg("msgDiag", "وضعیت ربات گرفته شد", "ok");
      Log.add("🤖 وضعیت ربات @" + (bot.username || "?") + " بررسی شد");
    } catch (e) {
      stepMsg("msgDiag", "❌ " + (e.friendly || e.message) + (e.name === "TypeError" ? " — CORS پلتفرم اجازه نداد؛ از دکمه «دستور دستی» در تب وب‌هوک استفاده کن." : ""), "err");
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
      s.textContent = "زمان‌بندی‌ای ثبت نشده — عبارت Cron اضافه کن و «ذخیره» بزن";
      box.appendChild(s);
      return;
    }
    Tools.state.crons.forEach((c, i) => {
      const chip = document.createElement("span");
      chip.className = "cronchip";
      const code = document.createElement("code"); code.textContent = c;
      const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.title = "حذف";
      x.onclick = () => { Tools.state.crons.splice(i, 1); Tools.cronRender(); };
      chip.append(code, x);
      box.appendChild(chip);
    });
  },
  cronAdd() {
    const c = Tools.validCron($("cronInput").value);
    if (!c) { stepMsg("msgCron", "عبارت Cron معتبر نیست — قالب ۵ فیلدی مثل */5 * * * *", "err"); return; }
    if (Tools.state.crons.includes(c)) { toast("این عبارت قبلاً اضافه شده"); return; }
    Tools.state.crons.push(c);
    $("cronInput").value = "";
    Tools.cronRender();
    stepMsg("msgCron", "اضافه شد — برای اعمال، «ذخیره زمان‌بندی‌ها» را بزن", "ok");
  },
  cronPreset(v) { $("cronInput").value = v; Tools.cronAdd(); },
  async cronLoad() {
    const msg = $("msgCron");
    try {
      const name = await Tools.resolveTarget();
      msg.className = "stepmsg busy"; msg.textContent = "در حال گرفتن زمان‌بندی‌ها…";
      const r = await cfFetch("accounts/" + S.accountId + "/workers/scripts/" + encodeURIComponent(name) + "/schedules", { timeoutMs: 20000 });
      if (!r.ok) throw new Error(friendlyCfError(r.data.errors, r.status));
      const res = r.data.result;
      const list = Array.isArray(res) ? res : ((res && res.schedules) || []);
      Tools.state.crons = list.map((x) => x.cron).filter(Boolean);
      Tools.cronRender();
      msg.className = "stepmsg ok";
      msg.textContent = Tools.state.crons.length
        ? Tools.state.crons.length + " زمان‌بندی فعلی پیدا شد — می‌توانی حذف/اضافه کنی و ذخیره بزنی"
        : "زمان‌بندی‌ای ثبت نشده — عبارت اضافه کن و ذخیره بزن";
    } catch (e) {
      msg.className = "stepmsg err"; msg.textContent = "❌ " + (e.friendly || e.message);
    }
  },
  async cronSave() {
    const msg = $("msgCron");
    try {
      const name = await Tools.resolveTarget();
      msg.className = "stepmsg busy"; msg.textContent = "در حال ذخیره زمان‌بندی‌ها…";
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
      msg.textContent = "زمان‌بندی‌ها ذخیره شد ✅ (" + Tools.state.crons.length + " مورد)";
      Log.step("⏰ Cron «" + name + "» ذخیره شد: " + (Tools.state.crons.join(" | ") || "خالی"));
    } catch (e) {
      msg.className = "stepmsg err"; msg.textContent = "❌ " + (e.friendly || e.message);
    }
  },
};

/* ═══════════ شروع ═══════════ */
(function init() {
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
    $("bridgeHint").textContent = "پل از لینک آماده شد: " + qbBridge + " — تستش کن یا مستقیم توکن را بده و «اتصال» را بزن.";
    setTimeout(() => toast("آدرس پل خودکار پر شد ✅ — حالا توکن را وارد کن"), 300);
  }

  // تنظیمات ریپو (فیلدهای پنهان در ذخیره)
  let r = null;
  try { r = JSON.parse(localStorage.getItem(LS.repo) || "null"); } catch (e) { /* پیش‌فرض */ }
  if (!r) {
    r = { owner: "Alireza123456w6w", repo: "simple_cloudfire_worker_changer", branch: "main" };
    localStorage.setItem(LS.repo, JSON.stringify(r));
  }
  if ($("sWorker")) Setup.loadDefaults();

  // اتصال رویداد فایل‌ها
  $("sSchemaFile").addEventListener("change", () => Source.fileToText("sSchemaFile", "sSchemaText", "sSchemaName"));
  $("sCodeFile").addEventListener("change", () => Source.fileToText("sCodeFile", "sCodeText", "sCodeName"));
  $("uCodeFile").addEventListener("change", () => Source.fileToText("uCodeFile", "uCodeText", "uCodeName"));
  $("uSqlFile").addEventListener("change", () => Source.fileToText("uSqlFile", "uSqlText", "uSqlName"));

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
    if (bridge) {
      $("bridgeHint").textContent = "پل ذخیره‌شده: " + bridge + (savedToken ? " — توکن هم مانده، فقط «اتصال» را بزن" : "");
    } else {
      $("bridgeHint").textContent = "هنوز پل نداری؟ «نصب پل» — بدون ترمینال و بدون Account ID، فقط یک بار.";
    }
  }
  // اگر همه‌چیز آماده بود، خودکار وصل کن — ولی فقط با پل ذخیره‌شده‌ی خود کاربر
  // (نه با پلِ آمده از لینک: توکن نباید بدون کلیک کاربر از مسیر جدیدی رد شود)
  if (bridge && savedToken && (localStorage.getItem(LS.account) || "") && bridge === savedBridge) {
    Conn.connect();
  }
})();

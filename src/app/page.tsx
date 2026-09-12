'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Copy,
  Check,
  Loader2,
  Database,
  KeyRound,
  Hash,
  ClipboardPaste,
  Rocket,
  Bug,
  IdCard,
  CreditCard,
  ChevronDown,
  AlertTriangle,
  Wallet,
  Zap,
  ShieldCheck,
} from 'lucide-react'

type CopyState = 'idle' | 'loading' | 'done' | 'manual'
type DepState = 'idle' | 'loading' | 'ok' | 'err'

interface DepResult {
  ok: boolean
  step?: string
  error?: string
  codeSize?: number
  modifiedOn?: string | null
  keptBindings?: string[]
  lostBindings?: string[]
  compatDate?: string
}

const STEPS = [
  {
    icon: <ClipboardPaste className="h-6 w-6" />,
    title: 'ویرایشگر Cloudflare رو باز کن',
    body: (
      <>
        dash.cloudflare.com → <b>Workers &amp; Pages</b> → ورکر <b>balebot</b> →
        دکمه <b>Edit code</b>
      </>
    ),
  },
  {
    icon: <ClipboardPaste className="h-6 w-6" />,
    title: 'کد قبلی رو پاک کن',
    body: (
      <>
        داخل ویرایشگر یه جا از کد رو <b>طولانی فشار بده</b> → از منو{' '}
        <b>Select All</b> → بعد <b>Cut</b>
      </>
    ),
  },
  {
    icon: <ClipboardPaste className="h-6 w-6" />,
    title: 'کد جدید رو بچسبون',
    body: (
      <>
        همون‌جا <b>طولانی فشار بده</b> → <b>Paste</b>. چند ثانیه صبر کن — کد
        حدود ۱۱۰ هزار کاراکتره و گوشی ممکنه یه لحظه کند بشه، عادیه.
      </>
    ),
  },
  {
    icon: <Rocket className="h-6 w-6" />,
    title: 'Deploy بزن',
    body: <>دکمه آبی Deploy بالا سمت راست ویرایشگر</>,
  },
  {
    icon: <Bug className="h-6 w-6" />,
    title: 'خودت رو محک بزن',
    body: (
      <>
        تو کروم این آدرس رو باز کن: آدرس‌ورکرت +{' '}
        <code className="rounded bg-stone-100 px-1 text-sm" dir="ltr">
          /debug
        </code>{' '}
        — همه خطوط باید ✅ باشن
      </>
    ),
  },
]

const VARS = [
  {
    icon: <Database className="h-5 w-5" />,
    name: 'PLATFORM',
    value: 'bale',
    type: 'Text',
    desc: 'حالت بله رو فعال می‌کنه — بدون این، ورکر با توکن بله سراغ تلگرام می‌ره و هیچی جواب نمی‌ده',
  },
  {
    icon: <KeyRound className="h-5 w-5" />,
    name: 'BOT_TOKEN',
    value: 'توکن بات بله',
    type: 'Secret',
    desc: 'همون توکنی که از BotFather داخل خود اپ بله گرفتی (نه تلگرام)',
  },
  {
    icon: <Hash className="h-5 w-5" />,
    name: 'ADMIN_CHAT_ID',
    value: '0',
    type: 'Text',
    desc: 'فعلاً صفر بذار — بعد از دیپلوی با /id عدد واقعی رو می‌گیری و جایگزین می‌کنی',
  },
  {
    icon: <Wallet className="h-5 w-5" />,
    name: 'WALLET_TOKEN',
    value: 'WALLET-…',
    type: 'Secret',
    desc: 'اختیاری — توکن پرداخت کیف پول بله (همونی که از بله گرفتی). با این، دکمه «پرداخت آنلاین» کنار کارت‌به‌کارت ظاهر می‌شه',
  },
]

export default function Home() {
  const [code, setCode] = useState<string | null>(null)
  const [state, setState] = useState<CopyState>('idle')
  const [showManual, setShowManual] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // دیپلوی خودکار
  const [accountId, setAccountId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [workerName, setWorkerName] = useState('balebot')
  const [depState, setDepState] = useState<DepState>('idle')
  const [depResult, setDepResult] = useState<DepResult | null>(null)
  const [showTokenGuide, setShowTokenGuide] = useState(false)

  useEffect(() => {
    fetch('/api/worker-code')
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => setCode(t))
      .catch(() => setCode(null))
    // بازگرداندن اطلاعات از دیپلوی قبلی (توکن فقط در sessionStorage — با بستن تب پاک می‌شه)
    let restore: ReturnType<typeof setTimeout> | null = null
    try {
      const aid = localStorage.getItem('cf_account_id')
      const wn = localStorage.getItem('cf_worker_name')
      const tk = sessionStorage.getItem('cf_api_token')
      if (aid || wn || tk) {
        restore = setTimeout(() => {
          if (aid) setAccountId(aid)
          if (wn) setWorkerName(wn)
          if (tk) setApiToken(tk)
        }, 0)
      }
    } catch {
      /* حالت ناشناس/محدود */
    }
    return () => {
      if (restore) clearTimeout(restore)
    }
  }, [])

  async function copyAll() {
    if (!code) return
    setState('loading')
    try {
      await navigator.clipboard.writeText(code)
      setState('done')
    } catch {
      // فالبک برای مرورگرهای قدیمی‌تر
      const ta = taRef.current
      if (ta) {
        setShowManual(true)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        setState(ok ? 'done' : 'manual')
      } else {
        setState('manual')
      }
    }
    setTimeout(() => setState('idle'), 6000)
  }

  async function deployNow() {
    setDepState('loading')
    setDepResult(null)
    try {
      const r = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId, apiToken, workerName }),
      })
      const data = (await r.json()) as DepResult
      setDepResult(data)
      setDepState(data.ok ? 'ok' : 'err')
      // ذخیره برای دیپلوی‌های بعدی — توکن فقط تو همین تب (sessionStorage)
      try {
        localStorage.setItem('cf_account_id', accountId.trim())
        localStorage.setItem('cf_worker_name', workerName.trim() || 'balebot')
        sessionStorage.setItem('cf_api_token', apiToken.trim())
      } catch {
        /* حالت ناشناس */
      }
    } catch {
      setDepResult({ ok: false, error: 'ارتباط با سرور برقرار نشد — دوباره تلاش کن' })
      setDepState('err')
    }
  }

  const canDeploy =
    accountId.trim().length > 10 && apiToken.trim().length > 20 && depState !== 'loading'

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-stone-50 text-stone-800 flex flex-col"
    >
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
        {/* هدر */}
        <header className="pt-8 pb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-4xl shadow-lg shadow-emerald-200">
            🟡
          </div>
          <h1 className="text-2xl font-extrabold leading-snug">
            نصب ربات فروشگاه روی بله
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            کد Worker نسخه ۷.۳ — چند-پلتفرمی + پرداخت کیف پول بله + حالت فقط‌آنلاین
          </p>
        </header>

        {/* وضعیت کد */}
        <div className="mb-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          {code ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4 shrink-0" />
              کد آماده است — {(code.length / 1000).toFixed(0)} هزار کاراکتر
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-amber-600">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              در حال بارگذاری کد...
            </p>
          )}
        </div>

        {/* ═══ روش ۱: دیپلوی خودکار ═══ */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
              ۱
            </span>
            <h2 className="text-lg font-bold">دیپلوی خودکار (پیشنهادی)</h2>
            <span className="mr-auto flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
              <Zap className="h-3 w-3" /> بدون کپی‌پیست
            </span>
          </div>
          <p className="mb-3 text-sm leading-6 text-stone-600">
            کد مستقیم از این صفحه روی ورکرت آپلود می‌شه — نه ادیتور، نه پیست، نه
            دردسر ۴۰۳. فقط دو چیز لازم داری:
          </p>

          {/* راهنمای Account ID */}
          <div className="mb-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-2 font-bold">
              <Hash className="h-5 w-5 text-emerald-700" />
              Account ID (۳۲ کاراکتر)
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              همون چیزی که الان توی نوار آدرس کرومته!{' '}
              <code
                dir="ltr"
                className="rounded bg-stone-100 px-1 text-xs"
              >
                dash.cloudflare.com/<b>این‌بخش</b>
              </code>{' '}
              — از بعد از اسلش تا آخر رو کپی کن.
            </p>
          </div>

          {/* راهنمای توکن */}
          <div className="mb-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <button
              onClick={() => setShowTokenGuide((s) => !s)}
              className="flex min-h-11 w-full items-center gap-2 text-right"
            >
              <KeyRound className="h-5 w-5 shrink-0 text-emerald-700" />
              <span className="font-bold">API Token — راهنمای ساخت (یک‌بار)</span>
              <ChevronDown
                className={`mr-auto h-4 w-4 shrink-0 transition ${showTokenGuide ? 'rotate-180' : ''}`}
              />
            </button>
            {showTokenGuide && (
              <ol className="mt-3 list-decimal space-y-2 border-t border-stone-100 pt-3 pr-5 text-sm leading-6 text-stone-600">
                <li>
                  بالای داشبورد روی <b>آواتار خودت</b> بزن →{' '}
                  <b dir="ltr">My Profile</b>
                </li>
                <li>
                  <b dir="ltr">API Tokens</b> ← <b dir="ltr">Create Token</b>
                </li>
                <li>
                  جلوی قالب <b dir="ltr">«Edit Cloudflare Workers»</b> دکمه{' '}
                  <b dir="ltr">Use template</b> رو بزن
                </li>
                <li>
                  بری پایین ← <b dir="ltr">Continue to summary</b> ←{' '}
                  <b dir="ltr">Create Token</b>
                </li>
                <li>
                  توکن ساخته‌شده رو با <b>Copy</b> کپی کن و همین‌جا بچسبون —{' '}
                  <b>توکن فقط تو همین مرورگر می‌مونه و ذخیره نمی‌شه</b>
                </li>
              </ol>
            )}
          </div>

          {/* فرم */}
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
            <input
              dir="ltr"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="Account ID (32 chars)"
              autoComplete="off"
              className="min-h-11 w-full rounded-lg border border-stone-300 p-3 font-mono text-sm outline-none focus:border-emerald-500"
            />
            <input
              dir="ltr"
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="API Token"
              autoComplete="off"
              className="min-h-11 w-full rounded-lg border border-stone-300 p-3 font-mono text-sm outline-none focus:border-emerald-500"
            />
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-sm font-bold text-stone-600">
                نام ورکر:
              </label>
              <input
                dir="ltr"
                value={workerName}
                onChange={(e) => setWorkerName(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-stone-300 p-3 font-mono text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <button
              onClick={deployNow}
              disabled={!canDeploy}
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-stone-900 px-6 py-4 text-lg font-extrabold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
            >
              {depState === 'loading' ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" /> در حال آپلود...
                  صفحه رو نبند
                </>
              ) : (
                <>
                  <Rocket className="h-6 w-6" /> دیپلوی خودکار (آخرین نسخه ۷.۳)
                </>
              )}
            </button>

            {/* نتیجه */}
            {depState === 'ok' && depResult && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                <p className="flex items-center gap-2 font-bold text-emerald-800">
                  <ShieldCheck className="h-5 w-5 shrink-0" />
                  دیپلوی موفق! 🎉
                </p>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-emerald-800">
                  <li>
                    کد {(depResult.codeSize ?? 0 / 1000) > 0 ? `(${((depResult.codeSize ?? 0) / 1000).toFixed(0)} هزار کاراکتر)` : ''} روی
                    ورکر <b dir="ltr">{workerName}</b> آپلود شد
                  </li>
                  {depResult.keptBindings && depResult.keptBindings.length > 0 ? (
                    <li>
                      ✅ همه متغیرها و اتصال D1 سر جاشونه:{' '}
                      <span dir="ltr" className="font-mono text-xs">
                        {depResult.keptBindings.join(', ')}
                      </span>
                    </li>
                  ) : (
                    <li>⚠️ ورکر هیچ متغیری نداشت — مرحله متغیرها رو چک کن</li>
                  )}
                  {depResult.lostBindings && depResult.lostBindings.length > 0 && (
                    <li className="text-red-700">
                      ⚠️ این موارد حفظ نشدن، دستی دوباره بساز:{' '}
                      <span dir="ltr" className="font-mono text-xs">
                        {depResult.lostBindings.join(', ')}
                      </span>
                    </li>
                  )}
                  <li>
                    حالا آدرس ورکر +{' '}
                    <code dir="ltr" className="rounded bg-white px-1 text-xs">
                      /debug
                    </code>{' '}
                    رو باز کن — باید همه‌چی ✅ باشه
                  </li>
                </ul>
              </div>
            )}
            {depState === 'err' && depResult && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4">
                <p className="flex items-center gap-2 font-bold text-red-800">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  دیپلوی نشد
                </p>
                <p className="mt-1 text-sm leading-6 text-red-800">
                  {depResult.error}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ═══ متغیرها ═══ */}
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-800 text-sm font-bold text-white">
              ۲
            </span>
            متغیرها (اگه قبلاً ساختی، رد شو)
          </h2>
          <p className="mb-3 text-sm leading-6 text-stone-600">
            در صفحه ورکر <b>balebot</b> ← تب <b>Settings</b> ←{' '}
            <b>Variables and Secrets</b> ← <b>Add</b>:
          </p>
          <div className="space-y-3">
            {VARS.map((v) => (
              <div
                key={v.name}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-emerald-700">{v.icon}</span>
                  <code
                    dir="ltr"
                    className="rounded-md bg-stone-100 px-2 py-0.5 font-mono text-sm font-bold"
                  >
                    {v.name}
                  </code>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      v.type === 'Secret'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {v.type}
                  </span>
                  <code
                    dir="ltr"
                    className="ml-auto font-mono text-xs text-stone-500"
                  >
                    = {v.value}
                  </code>
                </div>
                <p className="mt-2 text-xs leading-5 text-stone-500">
                  {v.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ روش دوم: کپی/پیست ═══ */}
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-800 text-sm font-bold text-white">
              ۳
            </span>
            روش دوم: کپی و پیست دستی
          </h2>

          <button
            onClick={copyAll}
            disabled={!code || state === 'loading'}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-extrabold text-white shadow-lg shadow-emerald-200 transition active:scale-[0.98] disabled:opacity-50"
          >
            {state === 'loading' && (
              <Loader2 className="h-6 w-6 animate-spin" />
            )}
            {state === 'done' ? (
              <>
                <Check className="h-6 w-6" /> کپی شد! برو مراحل پایین ✅
              </>
            ) : state === 'manual' ? (
              <>
                <AlertTriangle className="h-6 w-6" /> از باکس پایین دستی کپی کن
              </>
            ) : (
              <>
                <Copy className="h-6 w-6" /> کپی کد Worker
              </>
            )}
          </button>

          <button
            onClick={() => setShowManual((s) => !s)}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white text-sm font-medium text-stone-600"
          >
            کپی دستی (اگه دکمه کار نکرد)
            <ChevronDown
              className={`h-4 w-4 transition ${showManual ? 'rotate-180' : ''}`}
            />
          </button>
          {showManual && (
            <textarea
              ref={taRef}
              dir="ltr"
              readOnly
              value={code ?? ''}
              className="mt-2 h-64 w-full resize-none rounded-xl border border-stone-300 bg-white p-3 font-mono text-xs"
            />
          )}

          <ol className="mt-4 space-y-3">
            {STEPS.map((s, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <span className="shrink-0 text-emerald-700">{s.icon}</span>
                <div>
                  <p className="font-bold">
                    {i + 1}. {s.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ═══ بعد از دیپلوی ═══ */}
        <section className="space-y-3">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-800 text-sm font-bold text-white">
              ۴
            </span>
            بعد از دیپلوی
          </h2>

          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-2 font-bold">
              <IdCard className="h-5 w-5 text-emerald-700" />
              آیدی ادمین واقعی رو بذار
            </p>
            <ol className="mt-2 list-decimal space-y-1 pr-5 text-sm leading-6 text-stone-600">
              <li>تو بله به ربات بگو: /start — باید جواب بده</li>
              <li>بعد بزن: /id — یه عدد بهت می‌ده</li>
              <li>
                برگرد <b>Variables</b> و <b>ADMIN_CHAT_ID</b> رو با اون عدد عوض
                کن → Save
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-2 font-bold">
              <CreditCard className="h-5 w-5 text-emerald-700" />
              کارت placeholder رو عوض کن
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              توی کنسول D1 (همون‌جا که schema رو زدی) این رو با اطلاعات واقعی
              خودت اجرا کن:
            </p>
            <pre
              dir="ltr"
              className="mt-2 overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs leading-5 text-emerald-300"
            >
              {`UPDATE cards SET
  card_number = 'شماره واقعی',
  card_holder = 'نام صاحب کارت',
  bank = 'نام بانک'
WHERE id = 1;`}
            </pre>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              یادت باشه: وبهوک تلگرام قبلی رو دست نزن — این ورکر جدید فقط برای
              بله‌ست و ربات تلگرامی‌ات به کارش ادامه می‌ده.
            </p>
          </div>
        </section>
      </main>

      <footer className="mt-auto pb-6 pt-2 text-center text-xs text-stone-400">
        نسخه ۷.۳ • کارت‌به‌کارت + پرداخت آنلاین کیف پول بله 🟡 • تحویل خودکار •
        امتیاز ⭐ • آپدیت 🔄
      </footer>
    </div>
  )
}

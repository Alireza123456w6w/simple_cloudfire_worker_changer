'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Cloud,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
  Zap,
} from 'lucide-react'

// ─── انواع ───
type Account = { id: string; name: string }
type WorkerRow = { name: string; modifiedOn: string | null }
type DbRow = { name: string; uuid: string; createdAt: string | null }
type BindingRow = { type: string; name: string; id: string | null }
type VarRow = { k: string; v: string; secret: boolean }
type StepState = { key: string; label: string; status: 'pending' | 'run' | 'ok' | 'err'; detail?: string }
type CodeSource = 'upload' | 'paste' | 'repo'
type SqlErr = { statement: number; preview: string; message: string }

type VerifyResp = { ok: boolean; error?: string; accounts?: Account[]; needsAccountId?: boolean }
type ResourcesResp = { ok: boolean; error?: string; workers?: WorkerRow[]; databases?: DbRow[]; warnings?: string[] }
type InfoResp = { ok: boolean; error?: string; compatibilityDate?: string | null; bindings?: BindingRow[] }
type D1Resp = { ok: boolean; error?: string; databaseId?: string; created?: boolean }
type SqlResp = { ok: boolean; error?: string; mode?: string; executed?: number; total?: number; errors?: SqlErr[] }
type DeployResp = {
  ok: boolean
  error?: string
  isNew?: boolean
  modifiedOn?: string | null
  keptBindings?: string[]
  lostBindings?: string[]
  compatDate?: string
  url?: string | null
}

// ─── ثابت‌ها ───
const LS_ACCOUNT = 'scwc-account'
const SS_TOKEN = 'scwc-token'
const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
const btnPrimary =
  'flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50'
const btnSoft =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600'

function pickVars(rows: VarRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) if (r.k.trim() && !r.secret) out[r.k.trim()] = r.v
  return out
}
function pickSecrets(rows: VarRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) if (r.k.trim() && r.secret && r.v) out[r.k.trim()] = r.v
  return out
}

// ─── اجزای کوچک UI ───
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>{children}</div>
}

function SectionTitle({ icon, text, extra }: { icon: React.ReactNode; text: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">{icon}</span>
        <h2 className="text-sm font-extrabold text-slate-800 sm:text-base">{text}</h2>
      </div>
      {extra}
    </div>
  )
}

function VarsEditor({ rows, onChange }: { rows: VarRow[]; onChange: (r: VarRow[]) => void }) {
  const update = (i: number, patch: Partial<VarRow>) => onChange(rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={r.k}
            onChange={(e) => update(i, { k: e.target.value })}
            placeholder="NAME"
            dir="ltr"
            className={inputCls + ' w-2/5 font-mono text-xs'}
          />
          <input
            value={r.v}
            onChange={(e) => update(i, { v: e.target.value })}
            placeholder="مقدار"
            type={r.secret ? 'password' : 'text'}
            dir="ltr"
            className={inputCls + ' flex-1 font-mono text-xs'}
          />
          <button
            onClick={() => update(i, { secret: !r.secret })}
            title={r.secret ? 'Secret (مقدار مخفی می‌ماند)' : 'Variable (عادی)'}
            className={`shrink-0 rounded-lg border px-2 py-2 text-xs font-bold transition ${
              r.secret ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            {r.secret ? '🔒' : 'V'}
          </button>
          <button
            onClick={() => onChange(rows.filter((_, ix) => ix !== i))}
            className="shrink-0 rounded-lg p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
            title="حذف"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...rows, { k: '', v: '', secret: false }])} className={btnSoft}>
        <Plus className="h-3.5 w-3.5" /> افزودن ردیف
      </button>
    </div>
  )
}

function StepsList({ steps }: { steps: StepState[] }) {
  if (!steps.length) return null
  return (
    <div className="mt-4 space-y-2">
      {steps.map((s) => (
        <div
          key={s.key}
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            s.status === 'ok'
              ? 'border-emerald-200 bg-emerald-50'
              : s.status === 'err'
                ? 'border-rose-200 bg-rose-50'
                : s.status === 'run'
                  ? 'border-indigo-200 bg-indigo-50'
                  : 'border-slate-200 bg-white'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            {s.status === 'ok' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : s.status === 'err' ? (
              <XCircle className="h-5 w-5 text-rose-600" />
            ) : s.status === 'run' ? (
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-dashed border-slate-300" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-slate-800">{s.label}</div>
            {s.detail && (
              <div className={`mt-1 break-all text-xs leading-5 ${s.status === 'err' ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
                {s.detail}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── صفحه اصلی ───
export default function Home() {
  // اتصال
  const [token, setToken] = useState('')
  const [connState, setConnState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [connError, setConnError] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [showManualAccount, setShowManualAccount] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // حالت
  const [mode, setMode] = useState<'new' | 'update'>('new')
  const [resState, setResState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [workers, setWorkers] = useState<WorkerRow[]>([])
  const [dbs, setDbs] = useState<DbRow[]>([])
  const [resWarnings, setResWarnings] = useState<string[]>([])

  // حالت «راه‌اندازی جدید»
  const [nWorker, setNWorker] = useState('my-worker')
  const [nD1, setND1] = useState('my-database')
  const [nBinding, setNBinding] = useState('DB')
  const [nVars, setNVars] = useState<VarRow[]>([{ k: '', v: '', secret: false }])

  // حالت «بروزرسانی»
  const [uWorker, setUWorker] = useState('')
  const [uDb, setUDb] = useState('')
  const [uBinding, setUBinding] = useState('')
  const [uInfo, setUInfo] = useState<{ compatibilityDate: string | null; bindings: BindingRow[] } | null>(null)
  const [uInfoState, setUInfoState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [uKeep, setUKeep] = useState(true)
  const [uVars, setUVars] = useState<VarRow[]>([])
  const [uRunSchema, setURunSchema] = useState(false)
  const [uRunCode, setURunCode] = useState(true)
  const [uShowUrl, setUShowUrl] = useState(false)

  // ورودی‌های مشترک: اسکیما و کد
  const [schemaText, setSchemaText] = useState('')
  const [schemaName, setSchemaName] = useState('')
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [codeText, setCodeText] = useState('')
  const [codeName, setCodeName] = useState('')
  const [codeSource, setCodeSource] = useState<CodeSource>('upload')
  const [compatDate, setCompatDate] = useState('2025-09-01')
  const [advOpen, setAdvOpen] = useState(false)

  // اجرا
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<StepState[]>([])
  const [formError, setFormError] = useState('')
  const [finalUrl, setFinalUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      const t = sessionStorage.getItem(SS_TOKEN)
      if (t) setToken(t)
      const a = localStorage.getItem(LS_ACCOUNT)
      if (a) setAccountId(a)
    } catch {
      /* حافظه در دسترس نیست */
    }
  }, [])

  const connected = connState === 'ok' && !!accountId

  function setStep(key: string, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  async function post<T>(url: string, body: unknown): Promise<T> {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await r.json()) as T
  }

  async function connect() {
    if (!token.trim() || connState === 'loading') return
    setConnState('loading')
    setConnError('')
    try {
      const d = await post<VerifyResp>('/api/cf/verify', { apiToken: token.trim() })
      if (!d.ok) {
        setConnState('err')
        setConnError(d.error || 'اتصال ناموفق بود')
        return
      }
      const accs = d.accounts || []
      setAccounts(accs)
      setShowManualAccount(!!d.needsAccountId || accs.length === 0)
      setConnState('ok')
      try {
        sessionStorage.setItem(SS_TOKEN, token.trim())
      } catch {}
      if (accs.length === 1) selectAccount(accs[0].id)
    } catch {
      setConnState('err')
      setConnError('ارتباط با سرور برقرار نشد — دوباره تلاش کن')
    }
  }

  function selectAccount(id: string) {
    setAccountId(id)
    try {
      localStorage.setItem(LS_ACCOUNT, id)
    } catch {}
    loadResources(id)
  }

  async function loadResources(acct?: string) {
    const a = acct || accountId
    if (!a || !token.trim()) return
    setResState('loading')
    setResWarnings([])
    try {
      const d = await post<ResourcesResp>('/api/cf/resources', { apiToken: token.trim(), accountId: a })
      if (!d.ok) {
        setResState('err')
        setResWarnings([d.error || 'دریافت فهرست ناموفق بود'])
        return
      }
      setWorkers(d.workers || [])
      setDbs(d.databases || [])
      setResWarnings(d.warnings || [])
      setResState('ok')
      const ws = d.workers || []
      if (ws.length === 1) setUWorker(ws[0].name)
    } catch {
      setResState('err')
      setResWarnings(['ارتباط با سرور برقرار نشد'])
    }
  }

  // وقتی Worker در حالت بروزرسانی عوض می‌شود → تنظیمات فعلی بخوان
  useEffect(() => {
    if (mode !== 'update' || !uWorker || !connected) return
    let cancel = false
    setUInfoState('loading')
    setUInfo(null)
    post<InfoResp>('/api/cf/worker-info', { apiToken: token.trim(), accountId, workerName: uWorker })
      .then((d) => {
        if (cancel) return
        if (d.ok) {
          setUInfo({ compatibilityDate: d.compatibilityDate ?? null, bindings: d.bindings || [] })
          const d1b = (d.bindings || []).find((b) => b.type === 'd1')
          if (d1b) setUBinding(d1b.name)
          setUInfoState('ok')
        } else {
          setUInfoState('err')
        }
      })
      .catch(() => {
        if (!cancel) setUInfoState('err')
      })
    return () => {
      cancel = true
    }
  }, [uWorker, accountId, mode, connected])

  function onFile(e: ChangeEvent<HTMLInputElement>, onText: (t: string, name: string) => void) {
    const f = e.target.files?.[0]
    if (!f) return
    f.text()
      .then((t) => onText(t, f.name))
      .catch(() => setFormError('خواندن فایل ناموفق بود'))
    e.target.value = ''
  }

  async function fetchRepoWorker() {
    try {
      const r = await fetch('/api/worker-code', { cache: 'no-store' })
      const t = await r.text()
      setCodeText(t)
      setCodeName('worker.js همین ریپو')
      setCodeSource('repo')
    } catch {
      setFormError('دریافت worker.js از ریپو ناموفق بود')
    }
  }

  const codeIsPlaceholder = codeText.length > 0 && codeText.length < 3000 && codeText.includes('خالی')

  // ─── پایپ‌لاین «راه‌اندازی جدید» ───
  async function runNew() {
    if (running) return
    setFormError('')
    const wName = nWorker.trim()
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(wName)) {
      setFormError('نام Worker فقط حروف انگلیسی، عدد، خط تیره و زیرخط')
      return
    }
    if (!codeText.trim()) {
      setFormError('کد Worker را وارد کن (آپلود فایل، پیست یا از ریپو)')
      return
    }
    if (nD1.trim() && !/^[a-zA-Z0-9_-]{1,32}$/.test(nD1.trim())) {
      setFormError('نام دیتابیس فقط حروف انگلیسی، عدد، خط تیره و زیرخط (حداکثر ۳۲)')
      return
    }
    if (nD1.trim() && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(nBinding.trim())) {
      setFormError('نام Binding باید مثل اسم متغیر JS باشد (مثل DB)')
      return
    }

    const list: StepState[] = []
    if (nD1.trim()) list.push({ key: 'd1', label: `ساخت دیتابیس D1 «${nD1.trim()}»`, status: 'pending' })
    if (schemaText.trim()) list.push({ key: 'schema', label: 'اجرای اسکیما روی D1', status: 'pending' })
    list.push({ key: 'worker', label: `آپلود کد Worker «${wName}»`, status: 'pending' })
    list.push({ key: 'url', label: 'فعال‌سازی آدرس workers.dev', status: 'pending' })
    setSteps(list)
    setFinalUrl(null)
    setRunning(true)

    let databaseId = ''
    try {
      if (nD1.trim()) {
        setStep('d1', { status: 'run' })
        const d = await post<D1Resp>('/api/cf/d1', { apiToken: token.trim(), accountId, name: nD1.trim() })
        if (!d.ok || !d.databaseId) throw new Error(d.error || 'ساخت دیتابیس ناموفق بود')
        databaseId = d.databaseId
        setStep('d1', { status: 'ok', detail: d.created ? 'دیتابیس جدید ساخته شد' : 'از قبل وجود داشت — همان استفاده شد' })
      }
      if (schemaText.trim()) {
        setStep('schema', { status: 'run' })
        const d = await post<SqlResp>('/api/cf/sql', {
          apiToken: token.trim(),
          accountId,
          databaseId,
          sql: schemaText,
        })
        if (!d.ok) {
          const extra = d.errors?.length ? ` — دستور ${d.errors[0].statement}: ${d.errors[0].message}` : ''
          throw new Error((d.error || 'اجرای اسکیما ناموفق بود') + extra)
        }
        setStep('schema', { status: 'ok', detail: `${d.executed ?? '?'} دستور اجرا شد (${d.mode === 'script' ? 'یک‌جا' : 'تکه‌ای'})` })
      }
      setStep('worker', { status: 'run' })
      const d = await post<DeployResp>('/api/cf/deploy', {
        apiToken: token.trim(),
        accountId,
        workerName: wName,
        code: codeText,
        compatibilityDate: compatDate.trim() || undefined,
        vars: pickVars(nVars),
        secrets: pickSecrets(nVars),
        d1: nD1.trim() && databaseId ? [{ binding: nBinding.trim(), id: databaseId }] : [],
        keepExisting: false,
        enableSubdomain: true,
      })
      if (!d.ok) throw new Error(d.error || 'آپلود Worker ناموفق بود')
      setStep('worker', {
        status: 'ok',
        detail: `${d.isNew ? 'Worker جدید ساخته شد' : 'Worker به‌روز شد'} — ${(d.keptBindings || []).length} binding فعال`,
      })
      if (d.url) {
        setStep('url', { status: 'ok', detail: d.url })
        setFinalUrl(d.url)
      } else {
        setStep('url', { status: 'ok', detail: 'Worker فعال است (نمایش آدرس ناموفق بود)' })
      }
    } catch (e) {
      setSteps((prev) => prev.map((s) => (s.status === 'run' ? { ...s, status: 'err', detail: (e as Error).message } : s)))
    } finally {
      setRunning(false)
    }
  }

  // ─── پایپ‌لاین «بروزرسانی» ───
  async function runUpdate() {
    if (running) return
    setFormError('')
    const doSchema = uRunSchema && schemaText.trim().length > 0
    const doCode = uRunCode && codeText.trim().length > 0
    if (!doSchema && !doCode) {
      setFormError('حداقل یکی را انتخاب کن: اجرای اسکیمای جدید یا آپلود کد جدید')
      return
    }
    if (doSchema && !uDb) {
      setFormError('برای اجرای اسکیما، اول دیتابیس D1 را انتخاب کن')
      return
    }
    if (doCode && !uWorker) {
      setFormError('برای آپلود کد، اول Worker را از فهرست انتخاب کن')
      return
    }
    const useD1 = !!uDb
    if (useD1 && !uBinding.trim()) {
      setFormError('نام Binding دیتابیس را وارد کن (مثل DB)')
      return
    }

    const list: StepState[] = []
    if (doSchema) list.push({ key: 'schema', label: `اجرای اسکیمای جدید روی «${dbs.find((x) => x.uuid === uDb)?.name ?? 'D1'}»`, status: 'pending' })
    if (doCode) list.push({ key: 'worker', label: `آپلود کد جدید روی «${uWorker}»`, status: 'pending' })
    setSteps(list)
    setFinalUrl(null)
    setRunning(true)

    try {
      if (doSchema) {
        setStep('schema', { status: 'run' })
        const d = await post<SqlResp>('/api/cf/sql', {
          apiToken: token.trim(),
          accountId,
          databaseId: uDb,
          sql: schemaText,
        })
        if (!d.ok) {
          const extra = d.errors?.length ? ` — دستور ${d.errors[0].statement}: ${d.errors[0].message}` : ''
          throw new Error((d.error || 'اجرای اسکیما ناموفق بود') + extra)
        }
        setStep('schema', { status: 'ok', detail: `${d.executed ?? '?'} دستور اجرا شد` })
      }
      if (doCode) {
        setStep('worker', { status: 'run' })
        const d = await post<DeployResp>('/api/cf/deploy', {
          apiToken: token.trim(),
          accountId,
          workerName: uWorker,
          code: codeText,
          vars: pickVars(uVars),
          secrets: pickSecrets(uVars),
          d1: useD1 ? [{ binding: uBinding.trim(), id: uDb }] : [],
          keepExisting: uKeep,
          enableSubdomain: uShowUrl,
        })
        if (!d.ok) throw new Error(d.error || 'آپلود ناموفق بود')
        if (d.lostBindings?.length) {
          setStep('worker', {
            status: 'ok',
            detail: `آپلود شد — ⚠️ این bindingها پیدا نشدند: ${d.lostBindings.join(', ')}`,
          })
        } else {
          setStep('worker', { status: 'ok', detail: `آپلود شد — ${(d.keptBindings || []).length} binding فعال` })
        }
        if (d.url) setFinalUrl(d.url)
      }
    } catch (e) {
      setSteps((prev) => prev.map((s) => (s.status === 'run' ? { ...s, status: 'err', detail: (e as Error).message } : s)))
    } finally {
      setRunning(false)
    }
  }

  function copyUrl() {
    if (!finalUrl) return
    navigator.clipboard
      ?.writeText(finalUrl)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }

  function renderSchemaBlock() {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className={btnSoft + ' cursor-pointer'}>
            <Upload className="h-3.5 w-3.5" /> آپلود فایل SQL
            <input type="file" accept=".sql,.txt" className="hidden" onChange={(e) => onFile(e, (t, n) => { setSchemaText(t); setSchemaName(n); setSchemaOpen(true) })} />
          </label>
          <button className={btnSoft} onClick={() => setSchemaOpen((v) => !v)}>
            <ClipboardPaste className="h-3.5 w-3.5" /> {schemaOpen ? 'بستن' : 'پیست دستی'}
          </button>
          {schemaName && (
            <span className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
              <Database className="h-3.5 w-3.5" /> {schemaName} ({schemaText.length.toLocaleString('fa-IR')} کاراکتر)
            </span>
          )}
        </div>
        {schemaOpen && (
          <textarea
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            rows={6}
            dir="ltr"
            placeholder="CREATE TABLE IF NOT EXISTS ..."
            className={inputCls + ' font-mono text-xs'}
          />
        )}
      </div>
    )
  }

  function renderCodeBlock() {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1">
          {(
            [
              ['upload', 'آپلود فایل', Upload],
              ['paste', 'پیست کد', ClipboardPaste],
              ['repo', 'worker.js ریپو', FileCode2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => (key === 'repo' ? fetchRepoWorker() : setCodeSource(key))}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition ${
                codeSource === key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        {codeSource === 'upload' && (
          <label className={btnSoft + ' w-full cursor-pointer'}>
            <Upload className="h-3.5 w-3.5" /> انتخاب فایل worker.js
            <input type="file" accept=".js,.txt" className="hidden" onChange={(e) => onFile(e, (t, n) => { setCodeText(t); setCodeName(n) })} />
          </label>
        )}
        {(codeSource === 'paste' || codeText) && (
          <textarea
            value={codeText}
            onChange={(e) => {
              setCodeText(e.target.value)
              if (codeSource === 'upload') setCodeSource('paste')
            }}
            rows={6}
            dir="ltr"
            placeholder="export default { fetch(req, env, ctx) { ... } }"
            className={inputCls + ' font-mono text-xs'}
          />
        )}
        {codeName && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1">
              <FileCode2 className="h-3.5 w-3.5" /> {codeName} — {codeText.length.toLocaleString('fa-IR')} کاراکتر
            </span>
            {codeIsPlaceholder && (
              <span className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> این فایل هنوز خالی است — کد واقعی را جای‌گذاری کن
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  const [manualOpen, setManualOpen] = useState(false)

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md">
              <Cloud className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-sm font-black text-slate-800 sm:text-base">راه‌انداز و به‌روزرسان Cloudflare Worker + D1</h1>
              <p className="text-xs text-slate-500">ساخت و بروزرسانی سریع — بدون کپی‌پیست، با آپلود فایل</p>
            </div>
          </div>
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black text-indigo-600">v2.0</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <Card>
          <SectionTitle icon={<Plug className="h-4 w-4" />} text="۱ — اتصال به Cloudflare" />
          <div className="flex gap-2">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') connect()
              }}
              type="password"
              dir="ltr"
              placeholder="Cloudflare API Token"
              className={inputCls + ' font-mono text-xs'}
            />
            <button
              onClick={connect}
              disabled={connState === 'loading'}
              className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {connState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'اتصال'}
            </button>
          </div>
          {connState === 'err' && connError && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-rose-50 p-2.5 text-xs font-semibold text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {connError}
            </p>
          )}
          <button onClick={() => setHelpOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-slate-400 transition hover:text-indigo-600">
            <ChevronDown className={`h-3.5 w-3.5 transition ${helpOpen ? 'rotate-180' : ''}`} /> توکن از کجا بگیرم؟ چه دسترسی‌هایی لازم است؟
          </button>
          {helpOpen && (
            <div className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">
              <p>dash.cloudflare.com → آیکون پروفایل → <b>My Profile</b> → <b>API Tokens</b> → <b>Create Token</b></p>
              <p>در Custom token این دسترسی‌ها را بده (یا از قالب «Edit Cloudflare Workers» شروع کن و D1 را هم اضافه کن):</p>
              <p dir="ltr" className="rounded-lg bg-white p-2 font-mono text-[11px]">
                Account · Workers Scripts · Edit<br />
                Account · D1 · Edit<br />
                User · Memberships · Read
              </p>
              <p className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> توکن فقط در حافظه همین مرورگر می‌ماند و هیچ‌جا ذخیره نمی‌شود.
              </p>
            </div>
          )}
          {connState === 'ok' && accounts.length > 1 && (
            <select value={accountId} onChange={(e) => selectAccount(e.target.value)} className={inputCls + ' mt-2'}>
              <option value="">— انتخاب اکانت —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.id.slice(0, 8)}…)</option>
              ))}
            </select>
          )}
          {connState === 'ok' && (showManualAccount || accounts.length === 0) && (
            <div className="mt-2 space-y-1.5">
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                dir="ltr"
                placeholder="Account ID (از نوار آدرس داشبورد)"
                className={inputCls + ' font-mono text-xs'}
              />
              <button onClick={() => loadResources()} disabled={!accountId} className={btnSoft}>تأیید و ادامه</button>
            </div>
          )}
          {connected && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> متصل — {workers.length} Worker، {dbs.length} دیتابیس D1
              </span>
              <button onClick={() => loadResources()} className="flex items-center gap-1 transition hover:text-emerald-900">
                <RefreshCw className={`h-3.5 w-3.5 ${resState === 'loading' ? 'animate-spin' : ''}`} /> بروزرسانی فهرست
              </button>
            </div>
          )}
          {resWarnings.map((w, i) => (
            <p key={i} className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">{w}</p>
          ))}
        </Card>

        {connected && (
          <>
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
              {([
                ['new', 'راه‌اندازی جدید', Rocket],
                ['update', 'بروزرسانی', RefreshCw],
              ] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-black transition ${
                    mode === key ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>

            {mode === 'new' ? (
              <Card>
                <SectionTitle icon={<Rocket className="h-4 w-4" />} text="راه‌اندازی جدید — همه‌چیز را خودم می‌سازم" />
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">نام Worker</label>
                    <input value={nWorker} onChange={(e) => setNWorker(e.target.value)} dir="ltr" className={inputCls + ' font-mono text-sm'} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">
                      نام دیتابیس D1 <span className="font-normal text-slate-400">(خالی = بدون دیتابیس)</span>
                    </label>
                    <input value={nD1} onChange={(e) => setND1(e.target.value)} dir="ltr" className={inputCls + ' font-mono text-sm'} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">نام Binding دیتابیس</label>
                    <input value={nBinding} onChange={(e) => setNBinding(e.target.value)} dir="ltr" placeholder="DB" className={inputCls + ' font-mono text-sm'} />
                  </div>
                </div>
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-bold text-slate-500">
                    Variableها و Secretها <span className="font-normal text-slate-400">(دکمه V/🔒 نوع را عوض می‌کند)</span>
                  </p>
                  <VarsEditor rows={nVars} onChange={setNVars} />
                </div>
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-bold text-slate-500">
                    اسکیمای SQL <span className="font-normal text-slate-400">(اختیاری — بعد از ساخت دیتابیس خودکار اجرا می‌شود)</span>
                  </p>
                  {renderSchemaBlock()}
                </div>
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-bold text-slate-500">کد Worker</p>
                  {renderCodeBlock()}
                </div>
                <button onClick={() => setAdvOpen((v) => !v)} className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 transition hover:text-indigo-600">
                  <ChevronDown className={`h-3.5 w-3.5 transition ${advOpen ? 'rotate-180' : ''}`} /> تنظیمات پیشرفته
                </button>
                {advOpen && (
                  <div className="mt-2">
                    <label className="mb-1 block text-xs font-bold text-slate-500">Compatibility Date <span className="font-normal text-slate-400">(مخصوص Worker جدید)</span></label>
                    <input value={compatDate} onChange={(e) => setCompatDate(e.target.value)} dir="ltr" className={inputCls + ' w-40 font-mono text-xs'} />
                  </div>
                )}
                {formError && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {formError}
                  </p>
                )}
                <button onClick={runNew} disabled={running || codeIsPlaceholder} className={btnPrimary + ' mt-4'}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  {codeIsPlaceholder ? 'اول کد واقعی Worker را وارد کن' : 'ساخت دیتابیس + آپلود Worker'}
                </button>
                <StepsList steps={steps} />
              </Card>
            ) : (
              <Card>
                <SectionTitle
                  icon={<RefreshCw className="h-4 w-4" />}
                  text="بروزرسانی — Worker و D1 موجود"
                  extra={resState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> : undefined}
                />
                {resState === 'err' && (
                  <p className="mb-3 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-700">فهرست گرفته نشد — دکمه «بروزرسانی فهرست» را در کارت اتصال بزن.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">Worker مقصد</label>
                    <select value={uWorker} onChange={(e) => setUWorker(e.target.value)} className={inputCls}>
                      <option value="">— انتخاب کن —</option>
                      {workers.map((w) => (
                        <option key={w.name} value={w.name}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">دیتابیس D1</label>
                    <select value={uDb} onChange={(e) => setUDb(e.target.value)} className={inputCls}>
                      <option value="">— بدون دیتابیس —</option>
                      {dbs.map((d) => (
                        <option key={d.uuid} value={d.uuid}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {uDb && (
                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-bold text-slate-500">
                      نام Binding این دیتابیس در کد <span className="font-normal text-slate-400">(اگر Worker از قبل D1 داشته باشد خودکار پر می‌شود)</span>
                    </label>
                    <input value={uBinding} onChange={(e) => setUBinding(e.target.value)} dir="ltr" placeholder="DB" className={inputCls + ' w-40 font-mono text-sm'} />
                  </div>
                )}
                {uWorker && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                    {uInfoState === 'loading' && (
                      <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> خواندن تنظیمات فعلی…</span>
                    )}
                    {uInfoState === 'err' && <span className="font-semibold text-amber-600">تنظیمات فعلی خوانده نشد — Worker تازه است یا دسترسی ندارد.</span>}
                    {uInfoState === 'ok' && uInfo && (
                      <>
                        <p className="mb-1.5 font-bold text-slate-700">
                          وضعیت فعلی: compatibility_date = <span dir="ltr" className="font-mono">{uInfo.compatibilityDate ?? '?'}</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {uInfo.bindings.length === 0 && <span className="text-slate-400">بدون binding</span>}
                          {uInfo.bindings.map((b) => (
                            <span key={b.name} dir="ltr" className="rounded-lg bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 shadow-sm">
                              {b.type === 'secret_text' ? '🔒' : b.type === 'd1' ? '🗄' : 'V'} {b.name}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="mt-4 space-y-3">
                  <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={uRunSchema} onChange={(e) => setURunSchema(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                    <span>
                      اجرای اسکیمای جدید روی دیتابیس
                      <span className="block text-xs font-normal text-slate-400">برای جداول/ستون‌های جدید — اجرای تکراری هم امن است</span>
                    </span>
                  </label>
                  {uRunSchema && renderSchemaBlock()}
                  <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={uRunCode} onChange={(e) => setURunCode(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                    <span>
                      آپلود کد جدید Worker
                      <span className="block text-xs font-normal text-slate-400">کد قبلی به‌طور کامل جایگزین می‌شود</span>
                    </span>
                  </label>
                  {uRunCode && renderCodeBlock()}
                  <div>
                    <p className="mb-1.5 text-xs font-bold text-slate-500">
                      افزودن یا تغییر Variable / Secret <span className="font-normal text-slate-400">(خالی = دست نزن)</span>
                    </p>
                    <VarsEditor rows={uVars} onChange={setUVars} />
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={uKeep} onChange={(e) => setUKeep(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                    <span>
                      حفظ Variableها و Secretهای قبلی
                      <span className="block text-xs font-normal text-slate-400">با keep_bindings — Secretهای فعلی پاک نمی‌شوند</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={uShowUrl} onChange={(e) => setUShowUrl(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                    <span>
                      فعال‌سازی و نمایش آدرس workers.dev
                      <span className="block text-xs font-normal text-slate-400">برای ربات‌ها: همین آدرس را وبهوک کن</span>
                    </span>
                  </label>
                </div>
                {formError && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {formError}
                  </p>
                )}
                <button onClick={runUpdate} disabled={running} className={btnPrimary + ' mt-4'}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} شروع بروزرسانی
                </button>
                <StepsList steps={steps} />
              </Card>
            )}

            {finalUrl && (
              <Card className="border-emerald-200 bg-emerald-50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-black text-emerald-800">
                    <ExternalLink className="h-4 w-4" /> آدرس Worker:
                  </p>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <code dir="ltr" className="overflow-x-auto rounded-lg bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700 shadow-sm">
                      {finalUrl}
                    </code>
                    <button onClick={copyUrl} title="کپی" className="shrink-0 rounded-lg bg-white p-2 text-emerald-700 shadow-sm">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {copied && <p className="mt-1.5 text-xs font-bold text-emerald-700">کپی شد</p>}
                <p className="mt-3 text-xs leading-6 text-emerald-800">
                  اگر ربات داری، همین آدرس را وبهوک کن:
                  <code dir="ltr" className="mt-1 block overflow-x-auto rounded-lg bg-white p-2 font-mono text-[11px] text-slate-700 shadow-sm">
                    {`https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=${finalUrl}`}
                  </code>
                  <code dir="ltr" className="mt-1 block overflow-x-auto rounded-lg bg-white p-2 font-mono text-[11px] text-slate-700 shadow-sm">
                    {`https://tapi.bale.ai/bot<BOT_TOKEN>/setWebhook?url=${finalUrl}`}
                  </code>
                </p>
              </Card>
            )}
          </>
        )}

        <Card>
          <button onClick={() => setManualOpen((v) => !v)} className="flex w-full items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
              <ClipboardPaste className="h-4 w-4 text-indigo-500" /> روش دستی (کپی/پیست در ادیتور Cloudflare)
            </span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition ${manualOpen ? 'rotate-180' : ''}`} />
          </button>
          {manualOpen && (
            <ol className="mt-3 list-decimal space-y-1.5 pr-5 text-xs leading-6 text-slate-600">
              <li>داشبورد Cloudflare → Workers وamp; Pages → ورکر تو → دکمه <b>Edit code</b></li>
              <li>در همین صفحه دکمه «worker.js ریپو» را بزن تا کد در باکس بیاید، بعد همه را انتخاب و کپی کن</li>
              <li>در ادیتور Cloudflare کد قبلی را کامل پاک کن، کد جدید را پیست کن → <b>Deploy</b></li>
            </ol>
          )}
        </Card>

        <footer className="pt-2 text-center text-[11px] leading-5 text-slate-400">
          <ShieldCheck className="mb-1 inline h-3.5 w-3.5" />
          توکن API فقط در حافظه همین تب (sessionStorage) می‌ماند و روی هیچ سروری ذخیره نمی‌شود · نسخه ۲.۰
        </footer>
      </main>
    </div>
  )
}

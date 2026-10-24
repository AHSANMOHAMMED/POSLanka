'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, MessageCircle, MessageSquare, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { smsSegments } from '@/lib/messaging/phone'

interface Plan {
  smsEnabled: boolean
  whatsappEnabled: boolean
  useOwnSmsProvider: boolean
  senderMask: string | null
  billingMode: 'prepaid' | 'monthly_quota'
  smsCredits: number
  whatsappCredits: number
  smsMonthlyQuota: number
  whatsappMonthlyQuota: number
  smsUsedThisMonth: number
  whatsappUsedThisMonth: number
  smsPrice: number
  whatsappPrice: number
  expiresAt: string | null
  alertPhone: string | null
  lowStockChannel: 'off' | 'sms' | 'whatsapp'
}
interface Usage { period: string; sms: { sent: number; failed: number; cost: number; units: number }; whatsapp: { sent: number; failed: number; cost: number; units: number } }
interface Overview {
  available: { sms: boolean; whatsapp: boolean }
  subscribed?: boolean
  plan?: Plan
  usage?: Usage
  ledger?: Array<{ id: string; channel: string; change: number; balanceAfter: number; reason: string; createdAt: string }>
}
interface Template { purpose: string; label: string; variables: string[]; text: string; defaultText: string; custom: boolean }
interface Log {
  id: string; channel: string; status: string; purpose: string | null; billedVia: string | null; recipientContact: string; recipientName: string | null
  content: string; entityReference: string | null; segments: number | null; errorMessage: string | null; createdAt: string
}

const PURPOSES: Record<string, string> = { sale_receipt: 'Receipt', payment_reminder: 'Reminder', low_stock: 'Low stock', test: 'Test', manual: 'Manual' }
const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white'

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body as T
}

export default function MessagingPlanPage() {
  const params = useParams()
  const basePath = `/c/${params.slug}`
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => getJson<Overview>('/api/messaging').then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)), [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href={`${basePath}/settings/notifications`} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Back"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">SMS &amp; WhatsApp</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Messages to customers (bills, payment reminders) and low-stock alerts to you.</p>
        </div>
      </div>

      {error && <Card className="p-4 text-sm text-red-600">{error}</Card>}
      {!data && !error && <Card className="p-6 text-sm text-gray-500">Loading…</Card>}

      {data && !data.subscribed && (
        <Card className="p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white">No messaging plan yet</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Send bills and payment reminders by SMS or WhatsApp straight from the POS. Contact skyERPOS support to add an SMS or WhatsApp plan.
            Until then the POS offers the free WhatsApp share button (opens WhatsApp on this device).
          </p>
        </Card>
      )}

      {data?.plan && data.usage && <PlanCards plan={data.plan} usage={data.usage} />}
      {data?.plan && <AlertsCard plan={data.plan} onSaved={load} />}
      {data?.subscribed && <TemplatesCard />}
      {data?.subscribed && <LogsCard />}
      {data?.ledger && data.ledger.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Top-ups</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500"><th className="py-1">Date</th><th>Channel</th><th className="text-right">Messages</th><th className="text-right">Balance after</th></tr></thead>
            <tbody>
              {data.ledger.map((l) => (
                <tr key={l.id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="py-1.5">{new Date(l.createdAt).toLocaleDateString()}</td>
                  <td>{l.channel === 'sms' ? 'SMS' : 'WhatsApp'}</td>
                  <td className={`text-right ${l.change < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{l.change > 0 ? '+' : ''}{l.change.toLocaleString()}</td>
                  <td className="text-right">{l.balanceAfter.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function PlanCards({ plan, usage }: { plan: Plan; usage: Usage }) {
  const expired = !!plan.expiresAt && plan.expiresAt < new Date().toISOString().slice(0, 10)
  const channel = (key: 'sms' | 'whatsapp') => {
    const on = key === 'sms' ? plan.smsEnabled : plan.whatsappEnabled
    const own = key === 'sms' && plan.useOwnSmsProvider
    const left = plan.billingMode === 'prepaid'
      ? `${(key === 'sms' ? plan.smsCredits : plan.whatsappCredits).toLocaleString()} credits left`
      : `${(key === 'sms' ? plan.smsUsedThisMonth : plan.whatsappUsedThisMonth).toLocaleString()} of ${(key === 'sms' ? plan.smsMonthlyQuota : plan.whatsappMonthlyQuota).toLocaleString()} used this month`
    const u = usage[key]
    const price = key === 'sms' ? plan.smsPrice : plan.whatsappPrice
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-2">
          {key === 'sms' ? <MessageSquare size={18} className="text-blue-600" /> : <MessageCircle size={18} className="text-emerald-600" />}
          <h2 className="font-semibold text-gray-900 dark:text-white">{key === 'sms' ? 'SMS' : 'WhatsApp'}</h2>
          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${on && !expired ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
            {!on ? 'Not in plan' : expired ? 'Expired' : 'Active'}
          </span>
        </div>
        {on && (
          <dl className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
            <div className="flex justify-between"><dt className="text-gray-500">Balance</dt><dd className="font-medium">{own ? 'Your own SMS gateway' : left}</dd></div>
            {key === 'sms' && !own && <div className="flex justify-between"><dt className="text-gray-500">Sender name</dt><dd>{plan.senderMask || 'Platform default'}</dd></div>}
            <div className="flex justify-between"><dt className="text-gray-500">Sent this month</dt><dd>{u.sent.toLocaleString()}{u.failed ? ` (${u.failed} failed)` : ''}</dd></div>
            {!own && price > 0 && <div className="flex justify-between"><dt className="text-gray-500">Price per message</dt><dd>LKR {price.toFixed(2)}</dd></div>}
            {plan.expiresAt && <div className="flex justify-between"><dt className="text-gray-500">Valid until</dt><dd className={expired ? 'text-red-600' : ''}>{plan.expiresAt}</dd></div>}
          </dl>
        )}
      </Card>
    )
  }
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{channel('sms')}{channel('whatsapp')}</div>
}

function AlertsCard({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [phone, setPhone] = useState(plan.alertPhone || '')
  const [ch, setCh] = useState(plan.lowStockChannel)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true); setMsg(null)
    try {
      await getJson('/api/messaging', { method: 'PUT', body: JSON.stringify({ alertPhone: phone, lowStockChannel: ch }) })
      setMsg({ ok: true, text: 'Saved' }); onSaved()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setSaving(false) }
  }
  return (
    <Card className="p-5 space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-white">Low-stock alerts to your phone</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">When an item runs low or out, a message is sent to this number (once per item per day). Each alert uses one message from your plan.</p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px_auto] gap-2 items-end">
        <label className="text-sm">Mobile number<input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="077 123 4567" inputMode="tel" /></label>
        <label className="text-sm">Send by
          <select className={inputCls} value={ch} onChange={(e) => setCh(e.target.value as Plan['lowStockChannel'])}>
            <option value="off">Off</option>
            {plan.smsEnabled && <option value="sms">SMS</option>}
            {plan.whatsappEnabled && <option value="whatsapp">WhatsApp</option>}
          </select>
        </label>
        <Button onClick={save} loading={saving}>Save</Button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
    </Card>
  )
}

function TemplatesCard() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { getJson<{ templates: Template[] }>('/api/messaging/templates').then((d) => setTemplates(d.templates)).catch((e) => setError(e.message)) }, [])
  if (error) return <Card className="p-5 text-sm text-gray-500">Message texts: {error}</Card>
  if (!templates) return null
  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-white">Message texts</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Placeholders in {'{{ }}'} are filled in for each message. Sinhala / Tamil text is allowed (70 characters per SMS instead of 160).</p>
      </div>
      {templates.map((t) => <TemplateEditor key={t.purpose} t={t} />)}
    </Card>
  )
}

function TemplateEditor({ t }: { t: Template }) {
  const [text, setText] = useState(t.text)
  const [saved, setSaved] = useState(t.text)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  async function save(value: string) {
    setSaving(true); setMsg(null)
    try {
      const r = await getJson<{ text: string }>('/api/messaging/templates', { method: 'PUT', body: JSON.stringify({ purpose: t.purpose, text: value }) })
      setText(r.text); setSaved(r.text); setMsg({ ok: true, text: value ? 'Saved' : 'Back to the default text' })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setSaving(false) }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-gray-800 dark:text-gray-200" htmlFor={`tpl-${t.purpose}`}>{t.label}</label>
        <span className="text-xs text-gray-500">~{text.length} chars · about {smsSegments(text)} SMS</span>
      </div>
      <textarea id={`tpl-${t.purpose}`} rows={3} maxLength={640} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-1.5">
        {t.variables.map((v) => (
          <button key={v} type="button" className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200" onClick={() => setText((s) => `${s}{{${v}}}`)}>{`{{${v}}}`}</button>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={saving || text === t.defaultText} onClick={() => save('')}>Use default</Button>
        <Button size="sm" disabled={saving || text === saved} loading={saving} onClick={() => save(text)}>Save</Button>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  )
}

function LogsCard() {
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ logs: Log[]; total: number; pageSize: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (channel) q.set('channel', channel)
    if (status) q.set('status', status)
    if (search.trim()) q.set('search', search.trim())
    getJson<{ logs: Log[]; total: number; pageSize: number }>(`/api/messaging/logs?${q}`).then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message))
  }, [channel, status, search, page])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 dark:text-white">Delivery log</h2>
        <Button size="sm" variant="ghost" onClick={load} aria-label="Refresh"><RefreshCw size={14} /></Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select className={inputCls} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1) }} aria-label="Channel"><option value="">All channels</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
        <select className={inputCls} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Status"><option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="pending">Pending</option></select>
        <input className={inputCls} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Number, name or bill no" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-gray-500"><th className="py-1">When</th><th>To</th><th>Type</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>
            {data?.logs.map((l) => (
              <tr key={l.id} className="border-t border-gray-100 dark:border-gray-700 align-top">
                <td className="py-1.5 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="whitespace-nowrap">{l.recipientName ? `${l.recipientName} · ` : ''}{l.recipientContact}<div className="text-xs text-gray-500">{l.channel === 'sms' ? 'SMS' : 'WhatsApp'}{l.billedVia === 'own' ? ' (own gateway)' : ''}</div></td>
                <td>{PURPOSES[l.purpose || ''] || l.purpose || '—'}{l.entityReference ? <div className="text-xs text-gray-500">{l.entityReference}</div> : null}</td>
                <td><span className={l.status === 'failed' ? 'text-red-600' : l.status === 'sent' || l.status === 'delivered' ? 'text-emerald-600' : 'text-gray-500'}>{l.status}</span>{l.errorMessage ? <div className="text-xs text-red-500 max-w-[220px]">{l.errorMessage}</div> : null}</td>
                <td className="text-gray-600 dark:text-gray-300 max-w-[280px] break-words">{l.content}</td>
              </tr>
            ))}
            {data && !data.logs.length && <tr><td colSpan={5} className="py-6 text-center text-gray-500">No messages yet</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>{page} / {pages}</span>
          <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </Card>
  )
}

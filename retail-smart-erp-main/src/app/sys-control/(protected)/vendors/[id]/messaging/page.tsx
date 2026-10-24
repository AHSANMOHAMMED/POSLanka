'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Coins, MessageSquare, RefreshCw, ScrollText } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  AdminTable,
  Alert,
  Badge,
  Button,
  Field,
  Input,
  SearchInput,
  Select,
  Skeleton,
  StatCard,
  StatGrid,
  Switch,
  Textarea,
  fmtDateTime,
  fmtLKR,
  fmtNumber,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { adminFetch } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

interface Plan {
  smsEnabled: boolean; whatsappEnabled: boolean; useOwnSmsProvider: boolean; senderMask: string | null
  billingMode: 'prepaid' | 'monthly_quota'; smsCredits: number; whatsappCredits: number
  smsMonthlyQuota: number; whatsappMonthlyQuota: number; smsUsedThisMonth: number; whatsappUsedThisMonth: number
  smsPrice: number; whatsappPrice: number; expiresAt: string | null; alertPhone: string | null
  lowStockChannel: 'off' | 'sms' | 'whatsapp'; notes: string | null
}
interface ChannelUsage { sent: number; failed: number; cost: number; units: number }
interface Ledger { id: string; channel: string; change: number; balanceAfter: number; reason: string; amountPaid: string | null; note: string | null; createdAt: string }
interface Payload {
  vendor?: { id: string; name: string; businessId: string; phone: string | null }
  subscribed: boolean
  plan: Plan
  usage: { period: string; sms: ChannelUsage; whatsapp: ChannelUsage }
  ledger: Ledger[]
  featureFlags: { sms: boolean; whatsapp: boolean }
  platformReady: { sms: boolean; whatsapp: boolean }
  platformSender: string | null
  ownProvider: { provider: string; enabled: boolean } | null
}
interface Log {
  id: string; channel: string; status: string; purpose: string | null; billedVia: string | null; recipientContact: string; recipientName: string | null
  content: string; entityReference: string | null; segments: number | null; cost: string | null; errorMessage: string | null; createdAt: string
}

type Form = {
  smsEnabled: boolean; whatsappEnabled: boolean; useOwnSmsProvider: boolean; senderMask: string
  billingMode: 'prepaid' | 'monthly_quota'; smsMonthlyQuota: string; whatsappMonthlyQuota: string
  smsPrice: string; whatsappPrice: string; expiresAt: string; notes: string; alertPhone: string; lowStockChannel: Plan['lowStockChannel']
}
const toForm = (p: Plan): Form => ({
  smsEnabled: p.smsEnabled, whatsappEnabled: p.whatsappEnabled, useOwnSmsProvider: p.useOwnSmsProvider, senderMask: p.senderMask ?? '',
  billingMode: p.billingMode, smsMonthlyQuota: String(p.smsMonthlyQuota), whatsappMonthlyQuota: String(p.whatsappMonthlyQuota),
  smsPrice: String(p.smsPrice), whatsappPrice: String(p.whatsappPrice), expiresAt: p.expiresAt ?? '', notes: p.notes ?? '',
  alertPhone: p.alertPhone ?? '', lowStockChannel: p.lowStockChannel,
})

export default function VendorMessagingPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => adminFetch<Payload>(`/api/sys-control/vendors/${id}/messaging`).then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)), [id])
  useEffect(() => { void load() }, [load])

  const name = data?.vendor?.name ?? 'Vendor'
  return (
    <AdminPage
      title="SMS & WhatsApp plan"
      description={data?.vendor ? `${name} · ${formatBusinessId(data.vendor.businessId)}` : undefined}
      breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: name, href: `/sys-control/vendors/${id}` }, { label: 'Messaging' }]}
    >
      {error && <Alert tone="danger" title="Could not load" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>}
      {!data && !error && <Skeleton className="h-72 w-full rounded-xl" />}
      {data && (
        <>
          <Overview data={data} />
          <PlanForm key={JSON.stringify(data.plan)} vendorId={id} data={data} onSaved={(d) => setData((x) => (x ? { ...x, ...d } : d))} />
          <CreditsCard vendorId={id} data={data} onDone={load} />
          <LogsCard vendorId={id} />
        </>
      )}
    </AdminPage>
  )
}

function Overview({ data }: { data: Payload }) {
  const p = data.plan
  const left = (ch: 'sms' | 'whatsapp') => {
    if (!(ch === 'sms' ? p.smsEnabled : p.whatsappEnabled)) return 'Off'
    if (ch === 'sms' && p.useOwnSmsProvider) return 'Own gateway'
    return p.billingMode === 'prepaid'
      ? `${fmtNumber(ch === 'sms' ? p.smsCredits : p.whatsappCredits)} left`
      : `${fmtNumber(ch === 'sms' ? p.smsUsedThisMonth : p.whatsappUsedThisMonth)} / ${fmtNumber(ch === 'sms' ? p.smsMonthlyQuota : p.whatsappMonthlyQuota)}`
  }
  const u = data.usage
  return (
    <>
      {(!data.platformReady.sms || !data.platformReady.whatsapp) && (
        <Alert tone="warning">
          {!data.platformReady.sms && 'The platform SMS gateway is not set up. '}
          {!data.platformReady.whatsapp && 'The platform WhatsApp number is not set up. '}
          <a className="underline" href="/sys-control/messaging">Set up in SMS &amp; WhatsApp</a>.
        </Alert>
      )}
      {((p.smsEnabled && !data.featureFlags.sms) || (p.whatsappEnabled && !data.featureFlags.whatsapp)) && (
        <Alert tone="warning">A channel in this plan is switched off under the vendor’s Features, so sending is refused. Save the plan to switch it back on.</Alert>
      )}
      <StatGrid cols={4}>
        <StatCard label="SMS balance" value={left('sms')} icon={MessageSquare} />
        <StatCard label="WhatsApp balance" value={left('whatsapp')} icon={MessageSquare} tone="success" />
        <StatCard label={`Sent this month`} value={`${fmtNumber(u.sms.sent)} SMS · ${fmtNumber(u.whatsapp.sent)} WA`} hint={`${fmtNumber(u.sms.units)} SMS parts billed · ${fmtNumber(u.sms.failed + u.whatsapp.failed)} failed`} icon={ScrollText} tone="info" />
        <StatCard label="To invoice this month" value={fmtLKR(u.sms.cost + u.whatsapp.cost, 2)} hint="Sent messages × price per message" icon={Coins} tone="warning" />
      </StatGrid>
    </>
  )
}

function PlanForm({ vendorId, data, onSaved }: { vendorId: string; data: Payload; onSaved: (d: Payload) => void }) {
  const canBill = useAdminCan('billing')
  const [f, setF] = useState<Form>(toForm(data.plan))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }))
  const num = (s: string) => (s.trim() === '' ? 0 : Number(s))

  async function submit() {
    setBusy(true); setMsg(null)
    try {
      const next = await adminFetch<Payload>(`/api/sys-control/vendors/${vendorId}/messaging`, {
        method: 'PUT',
        json: {
          ...f,
          smsMonthlyQuota: num(f.smsMonthlyQuota), whatsappMonthlyQuota: num(f.whatsappMonthlyQuota),
          smsPrice: num(f.smsPrice), whatsappPrice: num(f.whatsappPrice),
        },
      })
      onSaved(next)
      setMsg({ tone: 'success', text: 'Plan saved' })
    } catch (e) { setMsg({ tone: 'danger', text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <AdminCard
      title="Plan"
      description="Turning a channel on also turns on its feature switch for the vendor. Without a plan the vendor keeps the free WhatsApp share link."
      actions={data.subscribed ? <Badge tone="success">Has a plan</Badge> : <Badge>No plan yet</Badge>}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px]">{msg ? <span className={msg.tone === 'success' ? 'text-adm-success' : 'text-adm-danger'}>{msg.text}</span> : !canBill ? <span className="text-adm-subtle">Only billing admins can change plans.</span> : null}</span>
          <Button variant="primary" size="sm" loading={busy} disabled={!canBill} onClick={submit}>Save plan</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Switch checked={f.smsEnabled} onChange={(c) => set('smsEnabled', c)} label="SMS" description="Bills, reminders and alerts by SMS" />
          <Switch checked={f.whatsappEnabled} onChange={(c) => set('whatsappEnabled', c)} label="WhatsApp" description="From the platform WhatsApp Business number" />
        </div>
        <Switch
          checked={f.useOwnSmsProvider}
          onChange={(c) => set('useOwnSmsProvider', c)}
          label="Vendor uses their own SMS gateway"
          description={`SMS goes through the vendor’s Settings → SMS account and is not charged here. ${data.ownProvider ? `Their gateway: ${data.ownProvider.provider}${data.ownProvider.enabled ? '' : ' (disabled)'}` : 'They have not set one up.'}`}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Sender mask" htmlFor="m-mask" hint={`Vendor’s own approved mask; blank = ${data.platformSender || 'platform default'}`}>
            <Input id="m-mask" maxLength={11} value={f.senderMask} onChange={(e) => set('senderMask', e.target.value)} />
          </Field>
          <Field label="Billing" htmlFor="m-mode">
            <Select id="m-mode" value={f.billingMode} onChange={(e) => set('billingMode', e.target.value as Form['billingMode'])}>
              <option value="prepaid">Prepaid credits (top up)</option>
              <option value="monthly_quota">Monthly quota</option>
            </Select>
          </Field>
          <Field label="Valid until" htmlFor="m-exp" hint="Blank = no end date">
            <Input id="m-exp" type="date" value={f.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
          </Field>
        </div>
        {f.billingMode === 'monthly_quota' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="SMS per month" htmlFor="m-sq" hint="Billable SMS parts (160 English / 70 Sinhala-Tamil characters each)"><Input id="m-sq" inputMode="numeric" value={f.smsMonthlyQuota} onChange={(e) => set('smsMonthlyQuota', e.target.value)} /></Field>
            <Field label="WhatsApp messages per month" htmlFor="m-wq"><Input id="m-wq" inputMode="numeric" value={f.whatsappMonthlyQuota} onChange={(e) => set('whatsappMonthlyQuota', e.target.value)} /></Field>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Price per SMS (LKR)" htmlFor="m-sp" hint="For invoicing; shown to the vendor"><Input id="m-sp" inputMode="decimal" value={f.smsPrice} onChange={(e) => set('smsPrice', e.target.value)} /></Field>
          <Field label="Price per WhatsApp message (LKR)" htmlFor="m-wp"><Input id="m-wp" inputMode="decimal" value={f.whatsappPrice} onChange={(e) => set('whatsappPrice', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Owner’s alert phone" htmlFor="m-ap" hint="Low-stock alerts (the vendor can change this)"><Input id="m-ap" inputMode="tel" value={f.alertPhone} onChange={(e) => set('alertPhone', e.target.value)} placeholder="077 123 4567" /></Field>
          <Field label="Low-stock alerts by" htmlFor="m-ls">
            <Select id="m-ls" value={f.lowStockChannel} onChange={(e) => set('lowStockChannel', e.target.value as Form['lowStockChannel'])}>
              <option value="off">Off</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
            </Select>
          </Field>
        </div>
        <Field label="Internal notes" htmlFor="m-notes" hint="Not shown to the vendor"><Textarea id="m-notes" rows={2} maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </AdminCard>
  )
}

function CreditsCard({ vendorId, data, onDone }: { vendorId: string; data: Payload; onDone: () => void }) {
  const canBill = useAdminCan('billing')
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms')
  const [credits, setCredits] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const n = Number(credits)

  async function submit() {
    setBusy(true); setErr(null)
    try {
      await adminFetch(`/api/sys-control/vendors/${vendorId}/messaging/topup`, {
        method: 'POST',
        json: { channel, credits: n, amountPaid: amount.trim() ? Number(amount) : undefined, note },
      })
      setOpen(false); setCredits(''); setAmount(''); setNote('')
      onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <AdminCard
      title="Prepaid credits"
      icon={<Coins size={17} />}
      description={data.plan.billingMode === 'prepaid' ? 'Each SMS part or WhatsApp message uses one credit. Failed sends are refunded automatically.' : 'This plan uses a monthly quota; credits are only used in prepaid mode.'}
      actions={<Button size="sm" variant="primary" disabled={!canBill} onClick={() => setOpen(true)}>Top up</Button>}
      flush
    >
      <AdminTable
        rows={data.ledger}
        rowKey={(r) => r.id}
        empty="No top-ups yet"
        columns={[
          { key: 'd', header: 'Date', primary: true, cell: (r) => fmtDateTime(r.createdAt) },
          { key: 'c', header: 'Channel', cell: (r) => (r.channel === 'sms' ? 'SMS' : 'WhatsApp') },
          { key: 'n', header: 'Messages', align: 'right', cell: (r) => <span className={r.change < 0 ? 'text-adm-danger' : 'text-adm-success'}>{r.change > 0 ? '+' : ''}{fmtNumber(r.change)}</span> },
          { key: 'b', header: 'Balance after', align: 'right', cell: (r) => fmtNumber(r.balanceAfter) },
          { key: 'p', header: 'Paid', align: 'right', cell: (r) => (r.amountPaid ? fmtLKR(Number(r.amountPaid), 2) : '—') },
          { key: 'note', header: 'Note', cell: (r) => r.note || '—', hideBelow: 'lg' },
        ]}
      />
      <AdminModal
        open={open}
        onClose={() => setOpen(false)}
        title="Top up credits"
        description="Use a negative number to correct a mistake. The change is recorded with your name."
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!Number.isInteger(n) || n === 0} onClick={submit}>{n < 0 ? 'Remove credits' : 'Add credits'}</Button></div>}
      >
        <div className="space-y-4">
          {err && <Alert tone="danger">{err}</Alert>}
          <Field label="Channel" htmlFor="t-ch">
            <Select id="t-ch" value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'whatsapp')}><option value="sms">SMS ({fmtNumber(data.plan.smsCredits)} now)</option><option value="whatsapp">WhatsApp ({fmtNumber(data.plan.whatsappCredits)} now)</option></Select>
          </Field>
          <Field label="Messages" htmlFor="t-n" required><Input id="t-n" inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="1000" /></Field>
          <Field label="Amount paid (LKR)" htmlFor="t-a" hint="Optional"><Input id="t-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Note" htmlFor="t-note" hint="e.g. bank slip reference"><Input id="t-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </AdminModal>
    </AdminCard>
  )
}

function LogsCard({ vendorId }: { vendorId: string }) {
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [purpose, setPurpose] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ logs: Log[]; total: number; pageSize: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (channel) q.set('channel', channel)
    if (status) q.set('status', status)
    if (purpose) q.set('purpose', purpose)
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (search.trim()) q.set('search', search.trim())
    setLoading(true)
    adminFetch<{ logs: Log[]; total: number; pageSize: number }>(`/api/sys-control/vendors/${vendorId}/messaging/logs?${q}`)
      .then(setData).catch(() => setData({ logs: [], total: 0, pageSize: 25 })).finally(() => setLoading(false))
  }, [vendorId, channel, status, purpose, from, to, search, page])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1) }

  return (
    <AdminCard
      title="Delivery log"
      icon={<ScrollText size={17} />}
      actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Refresh</Button>}
      flush
    >
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Select aria-label="Channel" value={channel} onChange={(e) => reset(setChannel)(e.target.value)}><option value="">All channels</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></Select>
        <Select aria-label="Status" value={status} onChange={(e) => reset(setStatus)(e.target.value)}><option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="pending">Pending</option></Select>
        <Select aria-label="Type" value={purpose} onChange={(e) => reset(setPurpose)(e.target.value)}><option value="">All types</option><option value="sale_receipt">Receipts</option><option value="payment_reminder">Reminders</option><option value="low_stock">Low stock</option></Select>
        <Input type="date" aria-label="From" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        <Input type="date" aria-label="To" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
        <SearchInput aria-label="Search" placeholder="Number, name, bill" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
      </div>
      <AdminTable
        rows={data?.logs ?? []}
        loading={loading && !data}
        rowKey={(r) => r.id}
        empty="No messages match"
        rowClassName={(r) => (r.status === 'failed' ? 'bg-adm-danger-soft/30' : undefined)}
        columns={[
          { key: 'when', header: 'When', primary: true, cell: (r) => fmtDateTime(r.createdAt) },
          { key: 'to', header: 'To', cell: (r) => <span>{r.recipientName ? `${r.recipientName} · ` : ''}<span className="font-mono">{r.recipientContact}</span></span> },
          { key: 'ch', header: 'Channel', cell: (r) => `${r.channel === 'sms' ? 'SMS' : 'WhatsApp'}${r.billedVia === 'own' ? ' (own)' : ''}` },
          { key: 'type', header: 'Type', cell: (r) => `${r.purpose ?? '—'}${r.entityReference ? ` · ${r.entityReference}` : ''}`, hideBelow: 'md' },
          { key: 'status', header: 'Status', cell: (r) => <span title={r.errorMessage ?? undefined}><Badge tone={r.status === 'failed' ? 'danger' : r.status === 'pending' ? 'warning' : 'success'}>{r.status}</Badge>{r.errorMessage ? <span className="ml-1 text-[12px] text-adm-danger">{r.errorMessage.slice(0, 80)}</span> : null}</span> },
          { key: 'units', header: 'Parts', align: 'right', cell: (r) => r.segments ?? 1, hideBelow: 'lg' },
          { key: 'msg', header: 'Message', cell: (r) => <span className="line-clamp-2 max-w-[320px] text-adm-muted">{r.content}</span>, hideBelow: 'xl' },
        ]}
      />
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 p-3 text-[13px]">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>{page} / {pages} · {fmtNumber(data?.total ?? 0)} messages</span>
          <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </AdminCard>
  )
}

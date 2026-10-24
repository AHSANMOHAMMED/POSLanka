'use client'

/**
 * Compose → preview → send → history, shared by /sys-control/notifications (vendor app inbox,
 * account portal, email) and /sys-control/send-email (email only, also to plain addresses).
 * Backed by /api/sys-control/notifications and /api/sys-control/send-email (src/lib/admin/broadcast.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bell, Inbox, Mail, RefreshCw, Send, Users } from 'lucide-react'
import {
  AdminCard,
  AdminTable,
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  BUSINESS_TYPE_LABELS,
  fmtDateTime,
  fmtNumber,
  timeAgo,
  type AdminColumn,
  type Tone,
} from '@/components/admin/kit'
import { AdminDrawer, Pager, adminFetch } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'
import { useAdminCan } from './AdminRoleContext'

type Kind = 'notification' | 'email'
type Mode = 'all' | 'filtered' | 'selected' | 'addresses'
type Channel = 'in_app' | 'account' | 'email' | 'push'
type PushScope = 'owners_managers' | 'all_staff'

interface Tier { id: string; displayName: string; isActive: boolean }

interface BroadcastRow {
  id: string
  title: string
  body: string
  link: string | null
  category: string
  channels: Channel[]
  audience: Record<string, unknown>
  recipientScope: string
  status: string
  vendorCount: number
  inAppCount: number
  accountCount: number
  emailSent: number
  emailLogged: number
  emailFailed: number
  pushScope?: PushScope | null
  pushSent?: number
  pushFailed?: number
  pushNoDevice?: number
  createdAt: string
  completedAt: string | null
  sentBy: string | null
}

interface HistoryResponse {
  broadcasts: BroadcastRow[]
  pagination: { total: number }
  tiers?: Tier[]
  vendorStatusCounts?: Record<string, number>
  emailConfigured?: boolean
}

interface Preview {
  vendorCount: number
  userCount: number
  accountCount: number
  emailCount: number
  pushUserCount: number
  pushDeviceCount: number
  sample: Array<{ id: string; name: string; businessId: string; status: string }>
  unknownBusinessIds: string[]
  tooLarge: string | null
}

interface RecipientRow {
  id: string
  vendorId: string | null
  vendorName: string | null
  businessId: string | null
  email: string | null
  inAppCount: number
  accountCount: number
  emailStatus: string | null
  pushStatus: string | null
  pushSent: number
  pushFailed: number
  error: string | null
}

const HISTORY_SIZE = 15

const CHANNEL_LABEL: Record<Channel, string> = { in_app: 'Vendor app inbox', account: 'Account portal', email: 'Email', push: 'Push to phones' }
const PUSH_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: 'Push sent', tone: 'success' },
  partial: { label: 'Push partly failed', tone: 'warning' },
  failed: { label: 'Push failed', tone: 'danger' },
  no_device: { label: 'No phone', tone: 'neutral' },
}
const CATEGORY_LABEL: Record<string, string> = { info: 'General', maintenance: 'Maintenance', billing: 'Billing', feature: 'New feature', warning: 'Important' }
const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  sent: { label: 'Delivered', tone: 'success' },
  partial: { label: 'Partly failed', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  sending: { label: 'Sending', tone: 'info' },
}
const EMAIL_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: 'Sent', tone: 'success' },
  logged: { label: 'Not sent (email off)', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'No address', tone: 'neutral' },
}
const VENDOR_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'locked', label: 'Locked' },
  { value: 'cancelled', label: 'Archived' },
]
const SUB_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Paid' },
  { value: 'past_due', label: 'Past due' },
  { value: 'locked', label: 'Locked' },
  { value: 'cancelled', label: 'Cancelled' },
]

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

function splitList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]
}

function audienceSummary(a: Record<string, unknown>, tiers: Tier[]): string {
  const mode = a.mode as Mode
  if (mode === 'all') return 'All vendors'
  if (mode === 'selected') return `${(a.businessIds as string[] | undefined)?.length ?? 0} selected vendor(s)`
  if (mode === 'addresses') return `${(a.addresses as string[] | undefined)?.length ?? 0} address(es)`
  const parts: string[] = []
  const tierIds = (a.tierIds as string[] | undefined) ?? []
  if (tierIds.length) parts.push(tierIds.map((id) => tiers.find((t) => t.id === id)?.displayName ?? 'plan').join(', '))
  const types = (a.businessTypes as string[] | undefined) ?? []
  if (types.length) parts.push(types.map((t) => BUSINESS_TYPE_LABELS[t] ?? t).join(', '))
  const st = (a.statuses as string[] | undefined) ?? []
  if (st.length) parts.push(st.join(', '))
  const sub = (a.subscriptionStatuses as string[] | undefined) ?? []
  if (sub.length) parts.push(sub.map((s) => s.replace('_', ' ')).join(', '))
  return parts.length ? parts.join(' · ') : 'Filtered vendors'
}

function deliverySummary(b: Pick<BroadcastRow, 'channels' | 'inAppCount' | 'accountCount' | 'emailSent' | 'emailLogged' | 'emailFailed' | 'pushSent' | 'pushFailed'>): string {
  const out: string[] = []
  if (b.channels.includes('in_app')) out.push(`${fmtNumber(b.inAppCount)} inbox`)
  if (b.channels.includes('account')) out.push(`${fmtNumber(b.accountCount)} portal`)
  if (b.channels.includes('email')) {
    out.push(`${fmtNumber(b.emailSent)} emailed`)
    if (b.emailLogged) out.push(`${fmtNumber(b.emailLogged)} not sent`)
    if (b.emailFailed) out.push(`${fmtNumber(b.emailFailed)} failed`)
  }
  if (b.channels.includes('push')) {
    out.push(`${fmtNumber(b.pushSent ?? 0)} phones`)
    if (b.pushFailed) out.push(`${fmtNumber(b.pushFailed)} push failed`)
  }
  return out.join(' · ')
}

/* ------------------------------------------------------------------ workspace */

export function BroadcastWorkspace({ kind }: { kind: Kind }) {
  const api = kind === 'email' ? '/api/sys-control/send-email' : '/api/sys-control/notifications'
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [metaLoaded, setMetaLoaded] = useState(false)
  const canSend = useAdminCan('notifications')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(HISTORY_SIZE) })
      if (!metaLoaded) p.set('meta', '1')
      const res = await adminFetch<HistoryResponse>(`${api}?${p.toString()}`)
      setHistory(res)
      if (res.tiers) setTiers(res.tiers)
      if (res.vendorStatusCounts) setStatusCounts(res.vendorStatusCounts)
      if (res.emailConfigured !== undefined) setEmailConfigured(res.emailConfigured)
      setMetaLoaded(true)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the history')
    } finally {
      setLoading(false)
    }
    // metaLoaded only matters for the first request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, page])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5">
      {kind === 'email' && emailConfigured === false && (
        <Alert tone="warning" title="Email is not configured on this server">
          RESEND_API_KEY is not set, so emails are written to the server log instead of being delivered. History marks them as “not sent”.
        </Alert>
      )}
      {canSend ? (
        <Composer
          kind={kind}
          api={api}
          tiers={tiers}
          statusCounts={statusCounts}
          metaReady={metaLoaded}
          onSent={(id) => { setPage(1); load(); setOpenId(id) }}
        />
      ) : (
        <Alert tone="info">Your role can see what was sent but not send {kind === 'email' ? 'emails' : 'notifications'}.</Alert>
      )}
      <HistoryCard
        kind={kind}
        history={history}
        tiers={tiers}
        loading={loading}
        error={loadError}
        page={page}
        onPage={setPage}
        onReload={load}
        onOpen={setOpenId}
      />
      <BroadcastDrawer key={openId ?? 'closed'} id={openId} tiers={tiers} onClose={() => setOpenId(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ composer */

function Composer({
  kind,
  api,
  tiers,
  statusCounts,
  metaReady,
  onSent,
}: {
  kind: Kind
  api: string
  tiers: Tier[]
  statusCounts: Record<string, number>
  metaReady: boolean
  onSent: (id: string) => void
}) {
  const [mode, setMode] = useState<Mode>('all')
  const [tierIds, setTierIds] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>(['active'])
  const [subStatuses, setSubStatuses] = useState<string[]>([])
  const [idsText, setIdsText] = useState('')
  const [addressesText, setAddressesText] = useState('')
  const [scope, setScope] = useState<'owners' | 'all_staff'>('owners')
  const [pushScope, setPushScope] = useState<PushScope>('owners_managers')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [category, setCategory] = useState('info')
  const [channels, setChannels] = useState<Channel[]>(kind === 'email' ? ['email'] : ['in_app', 'account'])

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const addresses = useMemo(() => splitList(addressesText), [addressesText])
  const businessIds = useMemo(() => splitList(idsText), [idsText])
  const badAddresses = addresses.filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))

  const audience = useMemo(() => {
    if (mode === 'all') return { mode, statuses: statuses.length ? statuses : undefined }
    if (mode === 'selected') return { mode, businessIds }
    if (mode === 'addresses') return { mode, addresses }
    return {
      mode,
      tierIds: tierIds.length ? tierIds : undefined,
      businessTypes: types.length ? types : undefined,
      statuses: statuses.length ? statuses : undefined,
      subscriptionStatuses: subStatuses.length ? subStatuses : undefined,
    }
  }, [mode, tierIds, types, statuses, subStatuses, businessIds, addresses])

  // Any change to who/what invalidates the last preview
  useEffect(() => { setPreview(null) }, [audience, scope, channels, pushScope])

  const linkOk = !link.trim() || /^\/(?!\/)/.test(link.trim()) || /^https:\/\/\S+$/.test(link.trim())
  const audienceOk = mode === 'selected' ? businessIds.length > 0 : mode === 'addresses' ? addresses.length > 0 && badAddresses.length === 0 : true
  const contentOk = title.trim().length >= 3 && body.trim().length >= 5 && linkOk && channels.length > 0
  const ready = contentOk && audienceOk

  const payload = () => {
    const base = { body: body.trim(), link: link.trim() || undefined, audience, recipientScope: scope }
    return kind === 'email'
      ? { ...base, subject: title.trim() }
      : { ...base, title: title.trim(), category, channels, ...(channels.includes('push') ? { pushScope } : {}) }
  }

  async function runPreview(): Promise<Preview | null> {
    setPreviewing(true)
    setError(null)
    try {
      const res = await adminFetch<{ preview: Preview }>(api, { method: 'POST', json: { ...payload(), dryRun: true } })
      setPreview(res.preview)
      return res.preview
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the recipients')
      return null
    } finally {
      setPreviewing(false)
    }
  }

  async function startSend() {
    const p = preview ?? (await runPreview())
    if (p && !p.tooLarge && (p.vendorCount > 0 || p.emailCount > 0)) setConfirming(true)
  }

  async function send() {
    setSending(true)
    setError(null)
    try {
      const res = await adminFetch<{ result: { id: string; status: string; vendorCount: number; inAppCount: number; accountCount: number; emailSent: number; emailLogged: number; emailFailed: number; pushSent?: number; pushFailed?: number } }>(api, { method: 'POST', json: payload() })
      const r = res.result
      setConfirming(false)
      setResult(`${kind === 'email' ? 'Email' : 'Notification'} sent${r.vendorCount ? ` to ${fmtNumber(r.vendorCount)} vendor${r.vendorCount === 1 ? '' : 's'}` : ''}: ${deliverySummary({ channels: kind === 'email' ? ['email'] : channels, ...r })}.`)
      setTitle(''); setBody(''); setLink(''); setPreview(null)
      onSent(r.id)
    } catch (e) {
      setConfirming(false)
      setError(e instanceof Error ? e.message : 'Sending failed')
    } finally {
      setSending(false)
    }
  }

  const modeOptions: Array<{ value: Mode; label: string }> = [
    { value: 'all', label: 'All vendors' },
    { value: 'filtered', label: 'Filter' },
    { value: 'selected', label: 'By Business ID' },
    ...(kind === 'email' ? [{ value: 'addresses' as Mode, label: 'Email addresses' }] : []),
  ]

  const statusPicker = (
    <Field label="Vendor status" hint={statuses.length ? undefined : 'None ticked: every vendor except archived ones.'}>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {VENDOR_STATUSES.map((s) => (
          <Checkbox key={s.value} label={`${s.label}${metaReady ? ` (${fmtNumber(statusCounts[s.value] ?? 0)})` : ''}`} checked={statuses.includes(s.value)} onChange={() => setStatuses(toggle(statuses, s.value))} />
        ))}
      </div>
    </Field>
  )

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <AdminCard
        title={kind === 'email' ? 'New email' : 'New notification'}
        description={kind === 'email'
          ? 'Sent from the platform address to vendor owners, all staff, or the addresses you enter.'
          : 'Appears in the vendor app’s bell inbox and/or the owner’s account portal; can also be emailed.'}
        icon={kind === 'email' ? <Mail size={17} /> : <Bell size={17} />}
      >
        <div className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          {result && <Alert tone="success" action={<Button size="sm" variant="ghost" onClick={() => setResult(null)}>Dismiss</Button>}>{result}</Alert>}

          <section className="space-y-3">
            <h3 className="text-[14px] font-semibold text-adm-fg">Who receives it</h3>
            <SegmentedControl ariaLabel="Audience" size="sm" value={mode} onChange={setMode} options={modeOptions} />
            {mode === 'all' && statusPicker}
            {mode === 'filtered' && (
              <div className="space-y-4">
                <Field label="Plan" hint={tierIds.length ? undefined : 'None ticked: any plan.'}>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {!metaReady ? <Skeleton className="h-5 w-48" /> : tiers.length === 0 ? <span className="text-[13px] text-adm-subtle">No plans</span> : tiers.map((t) => (
                      <Checkbox key={t.id} label={`${t.displayName}${t.isActive ? '' : ' (retired)'}`} checked={tierIds.includes(t.id)} onChange={() => setTierIds(toggle(tierIds, t.id))} />
                    ))}
                  </div>
                </Field>
                <Field label="Business type" hint={types.length ? undefined : 'None ticked: any type.'}>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {Object.entries(BUSINESS_TYPE_LABELS).map(([v, l]) => (
                      <Checkbox key={v} label={l} checked={types.includes(v)} onChange={() => setTypes(toggle(types, v))} />
                    ))}
                  </div>
                </Field>
                {statusPicker}
                <Field label="Subscription" hint={subStatuses.length ? undefined : 'None ticked: any subscription state.'}>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {SUB_STATUSES.map((s) => (
                      <Checkbox key={s.value} label={s.label} checked={subStatuses.includes(s.value)} onChange={() => setSubStatuses(toggle(subStatuses, s.value))} />
                    ))}
                  </div>
                </Field>
              </div>
            )}
            {mode === 'selected' && (
              <Field label="Business IDs" htmlFor="bc-ids" hint={`${businessIds.length} entered. Separate with spaces, commas or new lines (PL-123456, PL123456 or 123456).`}>
                <Textarea id="bc-ids" rows={3} value={idsText} onChange={(e) => setIdsText(e.target.value)} placeholder="PL-123456, PL-234567" />
              </Field>
            )}
            {mode === 'addresses' && (
              <Field
                label="Email addresses"
                htmlFor="bc-addr"
                error={badAddresses.length ? `Not valid: ${badAddresses.slice(0, 3).join(', ')}${badAddresses.length > 3 ? '…' : ''}` : undefined}
                hint={`${addresses.length} address${addresses.length === 1 ? '' : 'es'}. Separate with spaces, commas or new lines.`}
              >
                <Textarea id="bc-addr" rows={3} value={addressesText} invalid={badAddresses.length > 0} onChange={(e) => setAddressesText(e.target.value)} placeholder="name@example.com" />
              </Field>
            )}
            {mode !== 'addresses' && (
              <Field label="People at each vendor" htmlFor="bc-scope">
                <Select id="bc-scope" value={scope} onChange={(e) => setScope(e.target.value as 'owners' | 'all_staff')} className="sm:w-72">
                  <option value="owners">Owners only</option>
                  <option value="all_staff">All active staff</option>
                </Select>
              </Field>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-[14px] font-semibold text-adm-fg">Message</h3>
            <Field label={kind === 'email' ? 'Subject' : 'Title'} htmlFor="bc-title" required hint={`${title.trim().length}/200`}>
              <Input id="bc-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Message" htmlFor="bc-body" required hint={`${body.trim().length}/5000 · plain text; blank lines start a new paragraph`}>
              <Textarea id="bc-body" rows={6} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Link" htmlFor="bc-link" hint="Optional: a path like /account/billing or an https:// address" error={linkOk ? undefined : 'Use a path starting with / or an https:// address'}>
                <Input id="bc-link" value={link} invalid={!linkOk} onChange={(e) => setLink(e.target.value)} placeholder="/account/billing" />
              </Field>
              {kind === 'notification' && (
                <Field label="Category" htmlFor="bc-cat">
                  <Select id="bc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            {kind === 'notification' && (
              <Field label="Deliver to" error={channels.length === 0 ? 'Choose at least one' : undefined}>
                <div className="space-y-2">
                  <Checkbox label="Vendor app inbox" description="The bell in the vendor app (web and mobile)" checked={channels.includes('in_app')} onChange={() => setChannels(toggle(channels, 'in_app') as Channel[])} />
                  <Checkbox label="Account portal" description="Notifications in the owner’s account portal" checked={channels.includes('account')} onChange={() => setChannels(toggle(channels, 'account') as Channel[])} />
                  <Checkbox label="Email" description="Also email the same message" checked={channels.includes('email')} onChange={() => setChannels(toggle(channels, 'email') as Channel[])} />
                  <Checkbox label="Push to phones" description="A push notification on phones signed in to the skyERPOS app" checked={channels.includes('push')} onChange={() => setChannels(toggle(channels, 'push') as Channel[])} />
                </div>
              </Field>
            )}
            {kind === 'notification' && channels.includes('push') && (
              <Field label="Phones of" htmlFor="bc-push-scope" hint="Push goes to every phone these people signed in on.">
                <Select id="bc-push-scope" value={pushScope} onChange={(e) => setPushScope(e.target.value as PushScope)} className="sm:w-72">
                  <option value="owners_managers">Owners and managers</option>
                  <option value="all_staff">All active staff</option>
                </Select>
              </Field>
            )}
          </section>

          <div className="flex flex-wrap gap-2 border-t border-adm-border pt-4">
            <Button icon={Users} loading={previewing} disabled={!audienceOk || channels.length === 0} onClick={runPreview}>Check recipients</Button>
            <Button variant="primary" icon={Send} disabled={!ready || previewing} loading={sending} onClick={startSend}>Send…</Button>
          </div>
        </div>
      </AdminCard>

      <div className="space-y-5">
        <AdminCard title="Recipients" description={preview ? undefined : 'Check recipients to see exactly who gets it.'}>
          {previewing ? (
            <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-5 w-56" /><Skeleton className="h-5 w-48" /></div>
          ) : preview ? (
            <div className="space-y-3">
              {preview.tooLarge && <Alert tone="danger">{preview.tooLarge}</Alert>}
              {preview.unknownBusinessIds.length > 0 && <Alert tone="warning">Not found: {preview.unknownBusinessIds.join(', ')}</Alert>}
              <KeyValueList
                items={[
                  ...(mode !== 'addresses' ? [{ label: 'Vendors', value: fmtNumber(preview.vendorCount) }] : []),
                  ...(channels.includes('in_app') && kind === 'notification' ? [{ label: 'App inboxes', value: fmtNumber(preview.userCount) }] : []),
                  ...(channels.includes('account') && kind === 'notification' ? [{ label: 'Account portals', value: fmtNumber(preview.accountCount) }] : []),
                  ...(channels.includes('email') ? [{ label: 'Email addresses', value: fmtNumber(preview.emailCount) }] : []),
                  ...(channels.includes('push') && kind === 'notification' ? [{ label: 'Phones', value: `${fmtNumber(preview.pushDeviceCount)} (${fmtNumber(preview.pushUserCount)} people)` }] : []),
                ]}
              />
              {preview.sample.length > 0 && (
                <ul className="space-y-1 text-[13px]">
                  {preview.sample.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-adm-fg">{v.name}</span>
                      <span className="adm-num shrink-0 text-adm-subtle">{formatBusinessId(v.businessId)}</span>
                    </li>
                  ))}
                  {preview.vendorCount > preview.sample.length && <li className="text-adm-subtle">and {fmtNumber(preview.vendorCount - preview.sample.length)} more</li>}
                </ul>
              )}
              {preview.vendorCount === 0 && preview.emailCount === 0 && <p className="text-[13px] text-adm-muted">Nobody matches this audience.</p>}
            </div>
          ) : (
            <p className="text-[13px] text-adm-subtle">No check yet.</p>
          )}
        </AdminCard>

        <AdminCard title="Preview" description={kind === 'email' ? 'How the email reads' : 'How it appears in the inbox'}>
          {title.trim() || body.trim() ? (
            <div className="space-y-2 rounded-lg border border-adm-border bg-adm-surface-2 p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-adm-primary-soft text-adm-primary-soft-fg">
                  {kind === 'email' ? <Mail size={15} aria-hidden /> : <Inbox size={15} aria-hidden />}
                </span>
                <div className="min-w-0">
                  <p className="break-words text-[14px] font-semibold text-adm-fg">{title.trim() || 'Title'}</p>
                  {kind === 'notification' && <p className="text-[12px] text-adm-subtle">{CATEGORY_LABEL[category]} · just now</p>}
                </div>
              </div>
              <p className="whitespace-pre-wrap break-words text-[13.5px] text-adm-muted">{body.trim() || 'Message'}</p>
              {link.trim() && linkOk && <p className="break-all text-[13px] font-medium text-adm-primary">{link.trim()}</p>}
            </div>
          ) : (
            <p className="text-[13px] text-adm-subtle">Start typing to see a preview.</p>
          )}
        </AdminCard>
      </div>

      {confirming && preview && (
        <ConfirmDialog
          open
          onCancel={() => setConfirming(false)}
          onConfirm={send}
          loading={sending}
          title={kind === 'email' ? 'Send this email?' : 'Send this notification?'}
          description="This cannot be undone."
          confirmLabel="Send now"
        >
          <KeyValueList
            items={[
              { label: kind === 'email' ? 'Subject' : 'Title', value: <span className="break-words">{title.trim()}</span> },
              ...(mode !== 'addresses' ? [{ label: 'Vendors', value: fmtNumber(preview.vendorCount) }] : []),
              ...(kind === 'notification' ? [{ label: 'Channels', value: channels.map((c) => CHANNEL_LABEL[c]).join(', ') }] : []),
              ...(channels.includes('email') ? [{ label: 'Emails', value: fmtNumber(preview.emailCount) }] : []),
              ...(channels.includes('push') ? [{ label: 'Phones', value: fmtNumber(preview.pushDeviceCount) }] : []),
            ]}
          />
        </ConfirmDialog>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ history */

function HistoryCard({
  kind,
  history,
  tiers,
  loading,
  error,
  page,
  onPage,
  onReload,
  onOpen,
}: {
  kind: Kind
  history: HistoryResponse | null
  tiers: Tier[]
  loading: boolean
  error: string | null
  page: number
  onPage: (p: number) => void
  onReload: () => void
  onOpen: (id: string) => void
}) {
  const columns: AdminColumn<BroadcastRow>[] = [
    {
      key: 'title',
      header: kind === 'email' ? 'Subject' : 'Title',
      primary: true,
      cell: (b) => (
        <div className="min-w-0 max-w-[420px]">
          <p className="truncate font-medium text-adm-fg">{b.title}</p>
          <p className="truncate text-[12.5px] text-adm-subtle">{audienceSummary(b.audience, tiers)}</p>
        </div>
      ),
    },
    { key: 'delivery', header: 'Delivery', cell: (b) => <span className="text-adm-muted">{deliverySummary(b)}</span> },
    { key: 'status', header: 'Status', cell: (b) => { const s = STATUS_LABEL[b.status] ?? { label: b.status, tone: 'neutral' as Tone }; return <Badge tone={s.tone} dot>{s.label}</Badge> } },
    { key: 'by', header: 'Sent by', hideBelow: 'xl', cell: (b) => <span className="text-adm-muted">{b.sentBy ?? '—'}</span> },
    { key: 'when', header: 'Sent', hideBelow: 'md', cell: (b) => <span className="whitespace-nowrap text-adm-muted" title={fmtDateTime(b.createdAt)}>{timeAgo(b.createdAt)}</span> },
  ]
  return (
    <AdminCard
      flush
      title={kind === 'email' ? 'Sent emails' : 'Sent notifications'}
      description="Select one to see who received it."
      actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={onReload} loading={loading && !!history}>Refresh</Button>}
    >
      {error ? (
        <div className="p-4 sm:p-5"><Alert tone="danger" action={<Button size="sm" onClick={onReload}>Retry</Button>}>{error}</Alert></div>
      ) : (
        <AdminTable
          columns={columns}
          rows={history?.broadcasts ?? []}
          rowKey={(b) => b.id}
          onRowClick={(b) => onOpen(b.id)}
          loading={loading}
          minWidth={720}
          empty={<EmptyState icon={kind === 'email' ? Mail : Bell} title={kind === 'email' ? 'No emails sent yet' : 'No notifications sent yet'} description="Messages you send from this page are listed here with their delivery status." />}
        />
      )}
      {history && history.pagination.total > 0 && (
        <div className="border-t border-adm-border px-4 py-3 sm:px-5">
          <Pager page={page} pageSize={HISTORY_SIZE} total={history.pagination.total} onPage={onPage} />
        </div>
      )}
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ detail drawer */

function BroadcastDrawer({ id, tiers, onClose }: { id: string | null; tiers: Tier[]; onClose: () => void }) {
  const [data, setData] = useState<(BroadcastRow & { body: string; sentByEmail: string | null; recipients: RecipientRow[]; pagination: { total: number } }) | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // The drawer is keyed by id, so page/data start fresh for every broadcast
  useEffect(() => {
    if (!id) return
    let cancelled = false
    adminFetch<NonNullable<typeof data>>(`/api/sys-control/notifications/${id}?page=${page}&pageSize=50`)
      .then((d) => { if (!cancelled) { setData(d); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the details') })
    return () => { cancelled = true }
  }, [id, page])

  const s = data ? STATUS_LABEL[data.status] ?? { label: data.status, tone: 'neutral' as Tone } : null

  return (
    <AdminDrawer open={!!id} onClose={onClose} title={data?.title ?? 'Details'} description={data ? `${fmtDateTime(data.createdAt)}${data.sentBy ? ` · ${data.sentBy}` : ''}` : undefined}>
      {error ? <Alert tone="danger">{error}</Alert> : !data || data.id !== id ? (
        <div className="space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : (
        <div className="space-y-5">
          <KeyValueList
            items={[
              { label: 'Status', value: s ? <Badge tone={s.tone} dot>{s.label}</Badge> : '—' },
              { label: 'Audience', value: audienceSummary(data.audience, tiers) },
              ...(data.audience.mode !== 'addresses' ? [{ label: 'People', value: data.recipientScope === 'all_staff' ? 'All active staff' : 'Owners only' }] : []),
              ...(data.channels.includes('push') ? [{ label: 'Phones of', value: data.pushScope === 'all_staff' ? 'All active staff' : 'Owners and managers' }] : []),
              { label: 'Channels', value: data.channels.map((c) => CHANNEL_LABEL[c]).join(', ') },
              { label: 'Delivery', value: deliverySummary(data) },
              ...(data.link ? [{ label: 'Link', value: <span className="break-all">{data.link}</span> }] : []),
            ]}
          />
          <section className="space-y-1.5">
            <h3 className="text-[13px] font-semibold text-adm-fg">Message</h3>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-adm-border bg-adm-surface-2 p-3 text-[13.5px] text-adm-muted">{data.body}</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold text-adm-fg">Recipients ({fmtNumber(data.pagination.total)})</h3>
            <ul className="divide-y divide-[var(--adm-border)] rounded-lg border border-adm-border">
              {data.recipients.map((r) => {
                const es = r.emailStatus ? EMAIL_STATUS[r.emailStatus] : null
                const ps = r.pushStatus ? PUSH_STATUS[r.pushStatus] : null
                return (
                  <li key={r.id} className="space-y-1 px-3 py-2.5 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-adm-fg">
                        {r.vendorId ? <Link href={`/sys-control/vendors/${r.vendorId}`} className="hover:text-adm-primary">{r.vendorName ?? 'Vendor'}</Link> : r.email}
                        {r.businessId && <span className="adm-num ml-1.5 font-normal text-adm-subtle">{formatBusinessId(r.businessId)}</span>}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {es && <Badge tone={es.tone}>{es.label}</Badge>}
                        {ps && <Badge tone={ps.tone}>{ps.label}</Badge>}
                      </span>
                    </div>
                    <p className="text-adm-subtle">
                      {[
                        r.vendorId && r.email ? r.email : null,
                        data.channels.includes('in_app') ? `${r.inAppCount} inbox` : null,
                        data.channels.includes('account') ? `${r.accountCount} portal` : null,
                        data.channels.includes('push') && r.pushStatus ? `${r.pushSent} phone${r.pushSent === 1 ? '' : 's'}${r.pushFailed ? `, ${r.pushFailed} failed` : ''}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    {r.error && <p className="text-adm-danger">{r.error}</p>}
                  </li>
                )
              })}
            </ul>
            {data.pagination.total > 50 && <Pager page={page} pageSize={50} total={data.pagination.total} onPage={setPage} />}
          </section>
        </div>
      )}
    </AdminDrawer>
  )
}

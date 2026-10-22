'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Receipt, RefreshCw } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  AdminTable,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  SearchInput,
  SegmentedControl,
  Select,
  Textarea,
  fmtLKR,
  statusTone,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import {
  LOCK_REASON_LABEL,
  Pager,
  SUBSCRIPTION_STATUS_LABEL,
  adminFetch,
  daysUntil,
  fmtBytes,
  fmtDate,
  isNeverEnding,
  labelFor,
} from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

interface SubRow {
  id: string
  status: string
  billingCycle: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  lastPaymentAt: string | null
  subscribedPriceMonthly: string | null
  subscribedPriceYearly: string | null
  overrideDatabaseBytes: number | null
  overrideFileStorageBytes: number | null
  tenant: { id: string; name: string; slug: string; businessId: string; status: string; lockedReason: string | null }
  tier: { id: string; name: string; displayName: string; priceMonthly: string | null; priceYearly: string | null; maxDatabaseBytes: number | null; maxFileStorageBytes: number | null }
  billingAccount: { id: string; email: string; fullName: string }
  usage: { storageBytes: number; fileStorageBytes: number }
}

interface ListResponse {
  subscriptions: SubRow[]
  pagination: { page: number; pageSize: number; total: number }
  statusCounts: Record<string, number>
  tiers: Array<{ id: string; displayName: string }>
}

type View = 'all' | 'expiring' | 'trial' | 'active' | 'past_due' | 'locked' | 'cancelled'
const PAGE_SIZE = 25
const GB = 1024 ** 3

const isFreeRow = (s: SubRow) => (s.status === 'trial' && !s.trialEndsAt) || isNeverEnding(s.currentPeriodEnd)

function endsOf(s: SubRow): string | null {
  return s.status === 'trial' && s.trialEndsAt ? s.trialEndsAt : s.currentPeriodEnd
}

export default function SubscriptionsPage() {
  // Changing a subscription is billing work; other roles see the list read-only
  const canBill = useAdminCan('billing')
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('all')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [tierId, setTierId] = useState('')
  const [page, setPage] = useState(1)
  const [managing, setManaging] = useState<SubRow | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])
  useEffect(() => { setPage(1) }, [view, debouncedQ, tierId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (view === 'expiring') p.set('view', 'expiring')
      else if (view !== 'all') p.set('status', view)
      if (debouncedQ) p.set('q', debouncedQ)
      if (tierId) p.set('tierId', tierId)
      setData(await adminFetch<ListResponse>(`/api/sys-control/subscriptions?${p.toString()}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load subscriptions')
    } finally {
      setLoading(false)
    }
  }, [page, view, debouncedQ, tierId])

  useEffect(() => { load() }, [load])

  const c = data?.statusCounts ?? {}
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  const views: Array<{ value: View; label: string }> = [
    { value: 'all', label: `All ${data ? total : ''}`.trim() },
    { value: 'expiring', label: 'Ending in 7 days' },
    { value: 'trial', label: `Trial / free ${c.trial ?? 0}` },
    { value: 'active', label: `Active ${c.active ?? 0}` },
    { value: 'past_due', label: `Past due ${c.past_due ?? 0}` },
    { value: 'locked', label: `Locked ${c.locked ?? 0}` },
    { value: 'cancelled', label: `Cancelled ${c.cancelled ?? 0}` },
  ]

  const columns: AdminColumn<SubRow>[] = [
    {
      key: 'vendor',
      header: 'Vendor',
      primary: true,
      cell: (s) => (
        <div className="min-w-0">
          <p className="font-medium text-adm-fg">{s.tenant.name}</p>
          <p className="text-[12.5px] text-adm-subtle">
            <span className="adm-num text-adm-muted">{formatBusinessId(s.tenant.businessId)}</span> · {s.billingAccount.email}
          </p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (s) => (
        <div>
          <p className="text-adm-fg">{s.tier.displayName}</p>
          <p className="adm-num text-[12.5px] text-adm-subtle">
            {isFreeRow(s) ? 'Free' : `${fmtLKR(Number(s.billingCycle === 'yearly' ? s.subscribedPriceYearly ?? s.tier.priceYearly : s.subscribedPriceMonthly ?? s.tier.priceMonthly))} / ${s.billingCycle === 'yearly' ? 'year' : 'month'}`}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={statusTone(s.status)}>{isFreeRow(s) ? 'Free' : labelFor(SUBSCRIPTION_STATUS_LABEL, s.status)}</Badge>
          {s.tenant.status !== 'active' && <span className="text-[12px] text-adm-danger">{labelFor(LOCK_REASON_LABEL, s.tenant.lockedReason) || s.tenant.status}</span>}
        </div>
      ),
    },
    {
      key: 'ends',
      header: 'Ends',
      cell: (s) => {
        if (isFreeRow(s)) return <span className="text-adm-subtle">Never</span>
        const e = endsOf(s)
        const d = daysUntil(e)
        return (
          <div>
            <p className="text-adm-fg">{fmtDate(e)}</p>
            <p className={`text-[12.5px] ${d !== null && d <= 7 ? (d < 0 ? 'text-adm-danger' : 'text-adm-warning') : 'text-adm-subtle'}`}>
              {d === null ? '' : d < 0 ? `${-d} days ago` : d === 0 ? 'today' : `in ${d} days`}
              {s.status === 'trial' && s.trialEndsAt ? ' · trial' : ''}
            </p>
          </div>
        )
      },
    },
    {
      key: 'storage',
      header: 'Storage',
      hideBelow: 'lg',
      cell: (s) => {
        const limit = s.overrideDatabaseBytes ?? s.tier.maxDatabaseBytes
        return (
          <span className="adm-num text-adm-muted">
            {fmtBytes(s.usage.storageBytes)}
            {limit ? ` / ${fmtBytes(limit)}` : ''}
            {s.overrideDatabaseBytes != null && <Badge tone="info" className="ml-1.5">Custom</Badge>}
          </span>
        )
      },
    },
    { key: 'paid', header: 'Last payment', hideBelow: 'xl', cell: (s) => <span className="text-adm-muted">{s.lastPaymentAt ? fmtDate(s.lastPaymentAt) : '—'}</span> },
  ]

  return (
    <AdminPage
      title="Subscriptions"
      description="Plan, period and storage of every vendor. Soonest to lapse first."
      actions={<Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>}
    >
      {flash && <Alert tone="success" action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash}</Alert>}

      <AdminCard flush>
        <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
          <SegmentedControl ariaLabel="Subscription view" value={view} onChange={setView} options={views} size="sm" />
          <AdminToolbar>
            <SearchInput size="sm" wrapperClassName="w-full sm:w-80" placeholder="Vendor, PL-123456 or billing email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search subscriptions" />
            <Select size="sm" className="w-full min-[480px]:w-auto" value={tierId} onChange={(e) => setTierId(e.target.value)} aria-label="Plan">
              <option value="">All plans</option>
              {(data?.tiers ?? []).map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
            </Select>
          </AdminToolbar>
        </div>
        {error ? (
          <div className="p-4 sm:p-5"><Alert tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert></div>
        ) : (
          <AdminTable
            columns={columns}
            rows={data?.subscriptions ?? []}
            rowKey={(s) => s.id}
            onRowClick={canBill ? setManaging : undefined}
            loading={loading}
            minWidth={760}
            empty={<EmptyState icon={Receipt} title="No subscriptions match" description="Try another view or search." />}
          />
        )}
        {data && data.pagination.total > 0 && (
          <div className="border-t border-adm-border px-4 py-3 sm:px-5">
            <Pager page={page} pageSize={PAGE_SIZE} total={data.pagination.total} onPage={setPage} />
          </div>
        )}
      </AdminCard>

      {managing && (
        <ManageDialog
          sub={managing}
          onClose={() => setManaging(null)}
          onDone={(msg) => { setManaging(null); setFlash(msg); load() }}
        />
      )}
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ manage dialog */

type Mode = 'period' | 'storage' | 'access'

function ManageDialog({ sub, onClose, onDone }: { sub: SubRow; onClose: () => void; onDone: (msg: string) => void }) {
  const free = isFreeRow(sub)
  const [mode, setMode] = useState<Mode>(free ? 'storage' : 'period')
  const [months, setMonths] = useState('1')
  const [endDate, setEndDate] = useState('')
  const [periodHow, setPeriodHow] = useState<'months' | 'date'>('months')
  const [reason, setReason] = useState('')
  const [dbGb, setDbGb] = useState(sub.overrideDatabaseBytes != null ? String(+(sub.overrideDatabaseBytes / GB).toFixed(2)) : '')
  const [fileGb, setFileGb] = useState(sub.overrideFileStorageBytes != null ? String(+(sub.overrideFileStorageBytes / GB).toFixed(2)) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Unlock: free access is opt-in (default: no extension)
  const [grantFree, setGrantFree] = useState(false)
  const [grantMonths, setGrantMonths] = useState('1')
  const locked = sub.status === 'locked' || sub.tenant.status === 'locked'
  const ends = endsOf(sub)
  const periodOver = !free && !!ends && new Date(ends) <= new Date()

  const preview = useMemo(() => {
    if (periodHow === 'date') return endDate ? new Date(endDate) : null
    const m = Number(months)
    if (!Number.isInteger(m) || m === 0) return null
    const base = endsOf(sub) && new Date(endsOf(sub)!) > new Date() ? new Date(endsOf(sub)!) : new Date()
    base.setMonth(base.getMonth() + m)
    return base
  }, [periodHow, endDate, months, sub])

  async function put(body: Record<string, unknown>, msg: string) {
    setBusy(true)
    setError(null)
    try {
      await adminFetch(`/api/sys-control/subscriptions/${sub.id}`, { method: 'PUT', json: body })
      onDone(msg)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const reasonOk = reason.trim().length >= 3
  let footer: ReactNode = null
  if (mode === 'period') {
    const ok = reasonOk && !!preview && preview > new Date()
    footer = (
      <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!ok}
          onClick={() => put(
            periodHow === 'date' ? { setEndDate: new Date(endDate).toISOString(), reason } : { adjustMonths: Number(months), reason },
            `${sub.tenant.name}: period now ends ${fmtDate(preview)}.`,
          )}
        >
          Save period
        </Button>
      </>
    )
  } else if (mode === 'storage') {
    const toBytes = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * GB))
    const valid = [dbGb, fileGb].every((v) => v.trim() === '' || (Number(v) >= 0 && Number.isFinite(Number(v))))
    footer = (
      <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!valid}
          onClick={() => put({ overrideDatabaseBytes: toBytes(dbGb), overrideFileStorageBytes: toBytes(fileGb) }, `${sub.tenant.name}: storage limits updated.`)}>
          Save limits
        </Button>
      </>
    )
  } else {
    footer = (
      <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        {locked ? (
          <Button
            variant="primary"
            loading={busy}
            onClick={() => put(
              { unlock: true, unlockGrantMonths: grantFree ? Number(grantMonths) : 0, ...(reason.trim() ? { reason: reason.trim() } : {}) },
              grantFree
                ? `${sub.tenant.name} unlocked with ${grantMonths} free month${grantMonths === '1' ? '' : 's'}.`
                : `${sub.tenant.name} unlocked. The subscription keeps its current dates.`,
            )}
          >
            {grantFree ? `Unlock and add ${grantMonths} month${grantMonths === '1' ? '' : 's'}` : 'Unlock'}
          </Button>
        ) : (
          <Button variant="danger" loading={busy} disabled={!reasonOk} onClick={() => put({ lock: true, reason: reason.trim() }, `${sub.tenant.name} locked.`)}>Lock vendor</Button>
        )}
      </>
    )
  }

  return (
    <AdminModal open onClose={onClose} title={sub.tenant.name} description={`${sub.tier.displayName} · ${formatBusinessId(sub.tenant.businessId)}`} footer={footer} size="md">
      <div className="space-y-4">
        <KeyValueList
          items={[
            { label: 'Status', value: <Badge tone={statusTone(sub.status)}>{free ? 'Free' : labelFor(SUBSCRIPTION_STATUS_LABEL, sub.status)}</Badge> },
            { label: free ? 'Expires' : sub.status === 'trial' ? 'Trial ends' : 'Period', value: free ? 'Never' : sub.status === 'trial' ? fmtDate(sub.trialEndsAt) : `${fmtDate(sub.currentPeriodStart)} – ${fmtDate(sub.currentPeriodEnd)}` },
            { label: 'Billing account', value: <span className="break-all">{sub.billingAccount.fullName} · {sub.billingAccount.email}</span> },
            { label: 'Vendor', value: <Link href={`/sys-control/vendors/${sub.tenant.id}`} className="text-adm-primary hover:underline">Open vendor page</Link> },
          ]}
        />
        <SegmentedControl
          ariaLabel="What to change"
          value={mode}
          onChange={(m) => { setMode(m); setError(null) }}
          options={[
            ...(free ? [] : [{ value: 'period' as Mode, label: 'Period' }]),
            { value: 'storage', label: 'Storage limits' },
            { value: 'access', label: locked ? 'Unlock' : 'Lock' },
          ]}
        />
        {error && <Alert tone="danger">{error}</Alert>}

        {mode === 'period' && (
          <div className="space-y-3">
            <SegmentedControl ariaLabel="How" size="sm" value={periodHow} onChange={setPeriodHow} options={[{ value: 'months', label: 'Add or remove months' }, { value: 'date', label: 'Set end date' }]} />
            {periodHow === 'months' ? (
              <Field label="Months" htmlFor="m-months" hint="Negative numbers shorten the period. Counted from the current end, or today if it has passed.">
                <Input id="m-months" type="number" inputMode="numeric" min={-24} max={36} value={months} onChange={(e) => setMonths(e.target.value)} />
              </Field>
            ) : (
              <Field label="New end date" htmlFor="m-date">
                <Input id="m-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
              </Field>
            )}
            {preview && <p className="text-[13px] text-adm-muted">New end date: <strong className="text-adm-fg">{fmtDate(preview)}</strong>{locked ? ' — the vendor is unlocked.' : ''}</p>}
            <Field label="Reason" htmlFor="m-reason" required hint="Recorded in the audit log.">
              <Textarea id="m-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}

        {mode === 'storage' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Database (GB)" htmlFor="s-db" hint={`Plan: ${sub.tier.maxDatabaseBytes ? fmtBytes(sub.tier.maxDatabaseBytes) : 'no limit'} · used ${fmtBytes(sub.usage.storageBytes)}`}>
              <Input id="s-db" type="number" min={0} step="0.1" value={dbGb} onChange={(e) => setDbGb(e.target.value)} placeholder="Plan default" />
            </Field>
            <Field label="Files (GB)" htmlFor="s-file" hint={`Plan: ${sub.tier.maxFileStorageBytes ? fmtBytes(sub.tier.maxFileStorageBytes) : 'no limit'} · used ${fmtBytes(sub.usage.fileStorageBytes)}`}>
              <Input id="s-file" type="number" min={0} step="0.1" value={fileGb} onChange={(e) => setFileGb(e.target.value)} placeholder="Plan default" />
            </Field>
            <p className="text-[12.5px] text-adm-subtle sm:col-span-2">A custom limit replaces the plan’s limit for this vendor only. Leave a box empty to use the plan’s limit.</p>
          </div>
        )}

        {mode === 'access' && (
          locked ? (
            <div className="space-y-3">
              <p className="text-[13.5px] text-adm-muted">
                Unlocking restores sign-in. By default the subscription keeps its current dates
                {ends && !free ? <> (ends <strong className="text-adm-fg">{fmtDate(ends)}</strong>)</> : null} — no free time is added.
              </p>
              {periodOver && !grantFree && (
                <Alert tone="warning">
                  The paid period has already ended. Without extra time the vendor stays past due and the next billing check locks it again unless it pays.
                </Alert>
              )}
              <Checkbox
                label="Also give free access"
                description="Starts a new period from today at no charge. Recorded in the audit log."
                checked={grantFree}
                onChange={(e) => setGrantFree(e.target.checked)}
              />
              {grantFree && (
                <Field label="Free months" htmlFor="u-months">
                  <Select id="u-months" value={grantMonths} onChange={(e) => setGrantMonths(e.target.value)} className="sm:w-48">
                    {['1', '2', '3', '6', '12'].map((m) => <option key={m} value={m}>{m} month{m === '1' ? '' : 's'}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Note" htmlFor="u-reason" hint="Optional. Recorded in the audit log.">
                <Textarea id="u-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[13.5px] text-adm-muted">Locking blocks sign-in until the vendor is unlocked or pays. No data is deleted.</p>
              <Field label="Reason" htmlFor="l-reason" required hint="Recorded in the audit log.">
                <Textarea id="l-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          )
        )}
      </div>
    </AdminModal>
  )
}

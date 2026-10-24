'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Archive,
  CalendarPlus,
  CreditCard,
  Database,
  ExternalLink,
  KeyRound,
  Layers,
  Mail,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Store,
  UserPlus,
  Users,
} from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  AdminTable,
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  LinkButton,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  StatGrid,
  Switch,
  Textarea,
  businessTypeLabel,
  fmtDateTime,
  fmtLKR,
  fmtNumber,
  statusTone,
  timeAgo,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { displayLogin } from '@/lib/users/display-login'
import {
  CopyButton,
  LOCK_REASON_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  UsageBar,
  VENDOR_STATUS_LABEL,
  adminFetch,
  daysUntil,
  fmtBytes,
  fmtDate,
  labelFor,
} from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'
import { getRolesForBusinessType } from '@/lib/auth/roles'
import { FEATURE_DEFS, FEATURE_GROUPS, featureAppliesTo } from '@/lib/features/flags'

/* ------------------------------------------------------------------ types */

interface Tier {
  id: string
  name: string
  displayName: string
  priceMonthly: string | null
  priceYearly: string | null
  maxUsers: number | null
  isActive: boolean
}

interface Detail {
  vendor: {
    id: string
    name: string
    legalName: string | null
    slug: string
    businessId: string
    email: string
    phone: string | null
    address: string | null
    taxId: string | null
    brn: string | null
    vatRegistered: boolean
    businessType: string
    country: string
    currency: string
    status: string
    lockedAt: string | null
    lockedReason: string | null
    deletionScheduledAt: string | null
    planExpiresAt: string | null
    einvoiceEnabled: boolean
    aiEnabled: boolean
    createdAt: string
    setupCompletedAt: string | null
    featureFlags: Record<string, boolean>
    branches: Array<{ id: string; name: string; code: string | null; isActive: boolean; isDefault: boolean }>
    counters: Array<{ id: string; name: string; code: string | null; status: string; isDefault: boolean }>
  }
  owner: { id: string; fullName: string; email: string; lastLoginAt: string | null; inviteAccepted: boolean } | null
  subscription: {
    id: string
    status: string
    billingCycle: string | null
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    trialEndsAt: string | null
    subscribedPriceMonthly: string | null
    subscribedPriceYearly: string | null
    lastPaymentAt: string | null
    neverExpires: boolean
    tier: (Tier & { maxSalesMonthly: number | null }) | null
  } | null
  usage: {
    activeUsers: number
    totalUsers: number
    itemsCount: number
    customersCount: number
    salesCount: number
    salesThisMonth: number
    storageBytes: number
    fileStorageBytes: number
    warehouses: number
    posProfiles: number
  }
  limits: { maxUsers: number | null; maxSalesMonthly: number | null; maxDatabaseBytes: number | null; maxFileStorageBytes: number | null }
  staff: Array<{ id: string; fullName: string; email: string; role: string; isActive: boolean; lastLoginAt: string | null; lastActiveAt: string | null }>
  payments: Array<{ id: string; kind: 'bank_transfer' | 'payhere'; amount: string; currency: string; status: string; reference: string | null; periodMonths: number; createdAt: string; paidAt: string | null }>
  activity: Array<{ id: string; action: string; resource: string; details: Record<string, unknown> | null; createdAt: string; adminName: string | null }>
  tiers: Tier[]
  featureFlagLabels: Record<string, string>
}

interface Totals { netSales: number; receipts: number; avgBasket: number }
interface Analytics { totals: { today: Totals; '7d': Totals; '30d': Totals } }

type Tab = 'overview' | 'staff' | 'billing' | 'features' | 'activity'
type Dialog = null | 'suspend' | 'reactivate' | 'extend' | 'plan' | 'password' | 'welcome' | 'archive' | 'impersonate'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', manager: 'Manager', cashier: 'Cashier', technician: 'Technician', chef: 'Chef', waiter: 'Waiter',
  system_manager: 'System manager', accounts_manager: 'Accounts manager', sales_manager: 'Sales manager',
  purchase_manager: 'Purchase manager', hr_manager: 'HR manager', stock_manager: 'Stock manager',
  pos_user: 'POS user', report_user: 'Report user', dealer_sales: 'Dealer sales',
}

const OP_LABEL: Record<string, string> = {
  suspend: 'Suspended the vendor',
  reactivate: 'Reactivated the vendor',
  extend: 'Extended the subscription',
  extend_trial: 'Extended the trial',
  change_plan: 'Changed the plan',
  reset_password: 'Reset the owner password',
  resend_welcome: 'Emailed the owner',
  archive: 'Archived the vendor',
}

function activityText(a: Detail['activity'][number]): string {
  const d = (a.details || {}) as Record<string, unknown>
  const op = typeof d.op === 'string' ? d.op : null
  if (op && OP_LABEL[op]) {
    if (op === 'reset_password') return `${OP_LABEL[op]} (${d.mode === 'temporary' ? 'temporary password' : 'emailed link'})`
    if (op === 'extend' || op === 'extend_trial') return `${OP_LABEL[op]} by ${d.days} days`
    if (op === 'change_plan') return `${OP_LABEL[op]} to ${(d.after as { tier?: string } | undefined)?.tier ?? 'another plan'}`
    return OP_LABEL[op]
  }
  if (a.resource === 'impersonate') return 'Opened the vendor app as its owner'
  if (a.resource === 'tenant' && a.action === 'create') return 'Created the vendor'
  if (a.resource === 'tenant_feature_flags') return 'Changed feature switches'
  if (a.resource === 'payment') return a.action === 'approve' ? 'Approved a bank transfer' : 'Rejected a bank transfer'
  if (a.resource === 'subscription') return a.action === 'extend' ? 'Changed the subscription period' : 'Updated the subscription'
  return `${a.action} ${a.resource.replace(/_/g, ' ')}`
}

/* ------------------------------------------------------------------ page */

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Detail | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [flash, setFlash] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null)
  const canManage = useAdminCan('vendors.manage')
  const canBill = useAdminCan('billing')
  const canImpersonate = useAdminCan('vendors.impersonate')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [d, a] = await Promise.allSettled([
        adminFetch<Detail>(`/api/sys-control/vendors/${id}`),
        adminFetch<Analytics>(`/api/sys-control/analytics/vendors/${id}`),
      ])
      if (d.status === 'fulfilled') setData(d.value)
      else setError(d.reason instanceof Error ? d.reason.message : 'Could not load the vendor')
      setAnalytics(a.status === 'fulfilled' ? a.value : null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const done = useCallback((text: string, tone: 'success' | 'warning' = 'success') => {
    setDialog(null)
    setFlash({ tone, text })
    load()
  }, [load])

  if (error && !data) {
    return (
      <AdminPage title="Vendor" breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: 'Vendor' }]}>
        <Alert tone="danger" title="Could not load the vendor" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
      </AdminPage>
    )
  }

  if (!data) {
    return (
      <AdminPage title={<Skeleton className="h-7 w-56" />} breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: '…' }]}>
        <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCard key={i} label="" value="" loading />)}</StatGrid>
        <Skeleton className="h-64 w-full" />
      </AdminPage>
    )
  }

  const { vendor: v, subscription: sub, usage, limits, owner } = data
  const bid = formatBusinessId(v.businessId)
  const isActive = v.status === 'active'
  const trialEnds = sub?.status === 'trial' && sub.trialEndsAt ? sub.trialEndsAt : null
  const periodLabel = sub
    ? sub.neverExpires
      ? 'Does not expire'
      : trialEnds
        ? `Trial ends ${fmtDate(trialEnds)}`
        : `${(daysUntil(sub.currentPeriodEnd) ?? 0) < 0 ? 'Ended' : 'Renews'} ${fmtDate(sub.currentPeriodEnd)}`
    : 'No subscription'

  return (
    <AdminPage
      title={v.name}
      titleAside={
        <>
          <Badge tone={statusTone(v.status)} dot>{labelFor(VENDOR_STATUS_LABEL, v.status)}</Badge>
          {sub?.tier && <Badge tone="primary">{sub.tier.displayName}</Badge>}
        </>
      }
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-0.5">
            <span className="adm-num font-medium text-adm-fg">{bid}</span>
            <CopyButton text={bid} label="Copy Business ID" />
          </span>
          <span aria-hidden>·</span>
          <span>{v.slug}</span>
          <span aria-hidden>·</span>
          <span>{businessTypeLabel(v.businessType)}</span>
        </span>
      }
      breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: v.name }]}
      actions={
        <>
          <Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading}>Refresh</Button>
          {canImpersonate && <LinkButton href={`/sys-control/vendors/${v.id}/data`} icon={Database}>All data</LinkButton>}
          {canImpersonate && <Button icon={ExternalLink} onClick={() => setDialog('impersonate')} disabled={!isActive || !owner}>Open as owner</Button>}
        </>
      }
    >
      {flash && (
        <Alert tone={flash.tone} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash.text}</Alert>
      )}
      {!isActive && (
        <Alert tone={v.status === 'locked' ? 'danger' : 'warning'} title={`${labelFor(VENDOR_STATUS_LABEL, v.status)}${v.lockedReason ? ` — ${labelFor(LOCK_REASON_LABEL, v.lockedReason)}` : ''}`}>
          Staff cannot sign in{v.lockedAt ? ` since ${fmtDateTime(v.lockedAt)}` : ''}.
          {v.deletionScheduledAt && ` The billing job will permanently delete this vendor’s data on ${fmtDate(v.deletionScheduledAt)} unless the subscription is renewed or extended.`}
        </Alert>
      )}

      <StatGrid>
        <StatCard label="Net sales today" icon={CreditCard} loading={loading && !analytics} value={analytics ? fmtLKR(analytics.totals.today.netSales) : '—'} hint={analytics ? `${fmtNumber(analytics.totals.today.receipts)} receipts` : 'Sales data unavailable'} />
        <StatCard label="Net sales, 30 days" icon={CreditCard} tone="success" loading={loading && !analytics} value={analytics ? fmtLKR(analytics.totals['30d'].netSales) : '—'} hint={analytics ? `${fmtNumber(analytics.totals['30d'].receipts)} receipts · avg ${fmtLKR(analytics.totals['30d'].avgBasket)}` : undefined} />
        <StatCard label="Active users" icon={Users} tone="info" value={`${usage.activeUsers}${limits.maxUsers ? ` / ${limits.maxUsers}` : ''}`} hint={`${usage.totalUsers} accounts in total`} />
        <StatCard label="Plan" icon={Layers} tone="warning" value={sub?.tier?.displayName ?? 'None'} hint={periodLabel} />
      </StatGrid>

      <SegmentedControl
        ariaLabel="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'staff', label: `Staff ${data.staff.length}` },
          { value: 'billing', label: 'Billing' },
          { value: 'features', label: 'Features' },
          { value: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <AdminCard title="Business profile">
              <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
                <KeyValueList
                  items={[
                    { label: 'Business ID', value: <span className="adm-num">{bid}</span> },
                    { label: 'Legal name', value: v.legalName || '—' },
                    { label: 'Business type', value: businessTypeLabel(v.businessType) },
                    { label: 'Email', value: v.email },
                    { label: 'Phone', value: v.phone || '—' },
                    { label: 'Address', value: v.address || '—' },
                  ]}
                />
                <KeyValueList
                  items={[
                    { label: 'BRN', value: v.brn || '—' },
                    { label: 'TIN / VAT no.', value: v.taxId || '—' },
                    { label: 'VAT', value: v.vatRegistered ? 'Registered' : 'Not registered' },
                    { label: 'E-invoicing (RAMIS)', value: v.einvoiceEnabled ? 'On' : 'Off' },
                    { label: 'Created', value: fmtDate(v.createdAt) },
                    { label: 'Web address', value: `/c/${v.slug}` },
                  ]}
                />
              </div>
            </AdminCard>

            <AdminCard title="Usage and limits" description="Limits come from the plan (or a storage override set on the subscription).">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[13px] text-adm-muted">Active users</p>
                  <UsageBar used={usage.activeUsers} limit={limits.maxUsers} />
                </div>
                <div>
                  <p className="mb-1.5 text-[13px] text-adm-muted">Sales this month</p>
                  <UsageBar used={usage.salesThisMonth} limit={limits.maxSalesMonthly} />
                </div>
                <div>
                  <p className="mb-1.5 text-[13px] text-adm-muted">Database storage</p>
                  <UsageBar used={usage.storageBytes} limit={limits.maxDatabaseBytes} format={fmtBytes} />
                </div>
                <div>
                  <p className="mb-1.5 text-[13px] text-adm-muted">File storage</p>
                  <UsageBar used={usage.fileStorageBytes} limit={limits.maxFileStorageBytes} format={fmtBytes} />
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-adm-border pt-4 text-[13px] sm:grid-cols-4">
                {[
                  ['Items', usage.itemsCount],
                  ['Customers', usage.customersCount],
                  ['Sales (all time)', usage.salesCount],
                  ['Locations / counters', `${usage.warehouses} / ${usage.posProfiles}`],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-adm-subtle">{label}</dt>
                    <dd className="adm-num text-[15px] font-semibold text-adm-fg">{typeof value === 'number' ? fmtNumber(value) : value}</dd>
                  </div>
                ))}
              </dl>
            </AdminCard>

            <AdminCard title="Locations and counters" flush>
              {v.branches.length + v.counters.length === 0 ? (
                <EmptyState icon={Store} title="No locations yet" compact />
              ) : (
                <ul className="divide-y divide-[var(--adm-border)] text-[13.5px]">
                  {v.branches.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <span className="min-w-0 truncate text-adm-fg">{b.name}{b.code ? <span className="text-adm-subtle"> · {b.code}</span> : null}</span>
                      <span className="flex shrink-0 gap-1.5">{b.isDefault && <Badge tone="info">Default</Badge>}<Badge>Location</Badge></span>
                    </li>
                  ))}
                  {v.counters.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <span className="min-w-0 truncate text-adm-fg">{c.name}{c.code ? <span className="text-adm-subtle"> · {c.code}</span> : null}</span>
                      <span className="flex shrink-0 gap-1.5"><Badge tone={statusTone(c.status)}>{c.status}</Badge><Badge>POS counter</Badge></span>
                    </li>
                  ))}
                </ul>
              )}
            </AdminCard>
          </div>

          <div className="space-y-5">
            <AdminCard title="Owner">
              {owner ? (
                <KeyValueList
                  items={[
                    { label: 'Name', value: owner.fullName },
                    { label: 'Email', value: <span className="break-all">{owner.email}</span> },
                    { label: 'Last sign-in', value: owner.lastLoginAt ? timeAgo(owner.lastLoginAt) : 'Never' },
                    { label: 'Invitation', value: owner.inviteAccepted ? 'Accepted' : <Badge tone="warning">Not accepted yet</Badge> },
                  ]}
                />
              ) : (
                <Alert tone="warning">This vendor has no active owner user.</Alert>
              )}
            </AdminCard>

            <AdminCard title="Subscription">
              {sub ? (
                <KeyValueList
                  items={[
                    { label: 'Plan', value: sub.tier?.displayName ?? '—' },
                    { label: 'Status', value: <Badge tone={statusTone(sub.status)}>{labelFor(SUBSCRIPTION_STATUS_LABEL, sub.status)}</Badge> },
                    { label: 'Billing', value: sub.neverExpires ? 'Free' : `${sub.billingCycle === 'yearly' ? 'Yearly' : 'Monthly'} · ${fmtLKR(Number(sub.billingCycle === 'yearly' ? sub.subscribedPriceYearly ?? sub.tier?.priceYearly : sub.subscribedPriceMonthly ?? sub.tier?.priceMonthly))}` },
                    { label: trialEnds ? 'Trial ends' : 'Period ends', value: sub.neverExpires ? 'Does not expire' : fmtDate(trialEnds ?? sub.currentPeriodEnd) },
                    { label: 'Last payment', value: sub.lastPaymentAt ? fmtDate(sub.lastPaymentAt) : '—' },
                  ]}
                />
              ) : (
                <Alert tone="warning">No subscription record.</Alert>
              )}
            </AdminCard>

            {(canManage || canBill) && (
            <AdminCard title="Manage vendor" description="Every action asks for confirmation and is recorded in the audit log.">
              <div className="grid grid-cols-1 gap-2">
                {!canManage ? null : isActive ? (
                  <Button icon={PauseCircle} variant="danger-soft" onClick={() => setDialog('suspend')} className="justify-start">Suspend sign-in</Button>
                ) : (
                  <Button icon={PlayCircle} variant="primary" onClick={() => setDialog('reactivate')} className="justify-start">Reactivate</Button>
                )}
                {canBill && (
                  <>
                    <Button icon={CalendarPlus} onClick={() => setDialog('extend')} disabled={!sub || sub.neverExpires || v.status === 'suspended' || v.status === 'cancelled'} className="justify-start">
                      {trialEnds ? 'Extend trial' : 'Extend subscription'}
                    </Button>
                    <Button icon={Layers} onClick={() => setDialog('plan')} disabled={!sub} className="justify-start">Change plan</Button>
                  </>
                )}
                {canManage && (
                  <>
                    <Button icon={KeyRound} onClick={() => setDialog('password')} disabled={!owner} className="justify-start">Reset owner password</Button>
                    <Button icon={Mail} onClick={() => setDialog('welcome')} disabled={!owner} className="justify-start">
                      {owner && !owner.inviteAccepted ? 'Resend invitation' : 'Email sign-in details'}
                    </Button>
                  </>
                )}
                {canManage && v.status !== 'cancelled' && (
                  <Button icon={Archive} variant="ghost" onClick={() => setDialog('archive')} className="justify-start text-adm-danger">Archive vendor</Button>
                )}
              </div>
            </AdminCard>
            )}
          </div>
        </div>
      )}

      {tab === 'staff' && <StaffTab staff={data.staff} vendorId={v.id} businessType={v.businessType} canManage={canManage} onChanged={(text) => { setFlash({ tone: 'success', text }); load() }} />}
      {tab === 'billing' && <BillingTab data={data} />}
      {tab === 'features' && <FeaturesTab key={JSON.stringify(v.featureFlags)} vendorId={v.id} flags={v.featureFlags} businessType={v.businessType} onSaved={(t) => setFlash({ tone: 'success', text: t })} />}
      {tab === 'activity' && <ActivityTab activity={data.activity} />}

      <ActionDialogs key={dialog ?? 'none'} dialog={dialog} data={data} onClose={() => setDialog(null)} onDone={done} />
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ tabs */

type StaffRow = Detail['staff'][number]
type StaffResult = { title: string; email: string; password: string }

/** Staff of this vendor: list, add (only name + role required), reset password, deactivate / activate. */
function StaffTab({ staff, vendorId, businessType, canManage, onChanged }: {
  staff: Detail['staff']; vendorId: string; businessType: string; canManage: boolean; onChanged: (text: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StaffResult | null>(null)

  async function act(u: StaffRow, action: 'deactivate' | 'activate' | 'reset_password') {
    setBusyId(u.id)
    setError(null)
    try {
      const res = await adminFetch<{ temporaryPassword: string | null; email: string }>(`/api/sys-control/vendors/${vendorId}/staff`, { method: 'PATCH', json: { userId: u.id, action } })
      if (res.temporaryPassword) setResult({ title: `New password for ${u.fullName}`, email: res.email, password: res.temporaryPassword })
      onChanged(action === 'reset_password' ? `${u.fullName} has a new password.` : `${u.fullName} was ${action === 'activate' ? 'activated' : 'deactivated'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change failed')
    } finally {
      setBusyId(null)
    }
  }

  const columns: AdminColumn<StaffRow>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      cell: (u) => (
        <div className="min-w-0">
          <p className="font-medium text-adm-fg">{u.fullName}</p>
          <p className="truncate text-[12.5px] text-adm-subtle">{displayLogin(u.email)}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', cell: (u) => <Badge tone={u.role === 'owner' ? 'primary' : 'neutral'}>{ROLE_LABEL[u.role] ?? u.role}</Badge> },
    { key: 'status', header: 'Status', cell: (u) => <Badge tone={u.isActive ? 'success' : 'neutral'} dot>{u.isActive ? 'Active' : 'Deactivated'}</Badge> },
    { key: 'login', header: 'Last sign-in', hideBelow: 'md', cell: (u) => <span className="text-adm-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</span> },
    ...(canManage ? [{
      key: 'actions',
      header: '',
      align: 'right' as const,
      cell: (u: StaffRow) => u.role === 'owner' ? <span className="text-[12.5px] text-adm-subtle">Use the vendor actions</span> : (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="sm" icon={KeyRound} disabled={busyId === u.id} onClick={() => act(u, 'reset_password')}>New password</Button>
          {u.isActive
            ? <Button size="sm" variant="ghost" icon={PauseCircle} disabled={busyId === u.id} onClick={() => act(u, 'deactivate')}>Deactivate</Button>
            : <Button size="sm" variant="ghost" icon={PlayCircle} disabled={busyId === u.id} onClick={() => act(u, 'activate')}>Activate</Button>}
        </div>
      ),
    }] : []),
  ]
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <Alert tone="warning" title={`${result.title} (shown once)`}>
          <span className="inline-flex flex-wrap items-center gap-2">
            Login <span className="font-mono">{displayLogin(result.email)}</span> · password <span className="font-mono font-semibold">{result.password}</span>
            <CopyButton text={`Login: ${displayLogin(result.email)}\nPassword: ${result.password}`} label="Copy login and password" />
          </span>
          <span className="mt-1 block">They sign in with the Business ID, this login and password, and can change the password afterwards.</span>
        </Alert>
      )}
      <AdminCard
        title="Staff"
        description="Users of this business and their roles. Add managers, cashiers and other staff for the vendor here or from their own settings."
        actions={canManage ? <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>Add staff</Button> : undefined}
        flush
      >
        <AdminTable columns={columns} rows={staff} rowKey={(u) => u.id} minWidth={640} empty={<EmptyState icon={Users} title="No staff" compact />} />
      </AdminCard>
      {adding && (
        <AddStaffDialog
          vendorId={vendorId}
          businessType={businessType}
          onClose={() => setAdding(false)}
          onCreated={(name, email, password) => {
            setAdding(false)
            if (password) setResult({ title: `${name} can sign in`, email, password })
            onChanged(`${name} was added.`)
          }}
        />
      )}
    </>
  )
}

function AddStaffDialog({ vendorId, businessType, onClose, onCreated }: {
  vendorId: string; businessType: string; onClose: () => void; onCreated: (name: string, email: string, password: string | null) => void
}) {
  const roles = getRolesForBusinessType(businessType).filter((r) => r !== 'owner')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<string>(roles.includes('cashier') ? 'cashier' : roles[0])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameOk = fullName.trim().length >= 2

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch<{ user: { email: string; fullName: string }; generatedPassword: string | null }>(`/api/sys-control/vendors/${vendorId}/staff`, {
        method: 'POST',
        json: { fullName: fullName.trim(), role, email: email.trim() || undefined, password: password || undefined, pin: pin || undefined },
      })
      onCreated(res.user.fullName, res.user.email, res.generatedPassword ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the staff member')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      title="Add staff"
      description="Only the name and role are needed. Give a simple username (e.g. cashier1) or leave it blank to make one from the name; leave the password blank to get a 6-digit one."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon={UserPlus} onClick={save} loading={busy} disabled={!nameOk}>Add staff</Button></>}
    >
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="st-name" required>
          <Input id="st-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nimal Perera" autoFocus />
        </Field>
        <Field label="Role" htmlFor="st-role" required hint="Manager = admin of the business; Cashier = POS only.">
          <Select id="st-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
          </Select>
        </Field>
        <Field label="Username or email" htmlFor="st-email" hint="Optional — e.g. cashier1. Blank = made from the name.">
          <Input id="st-email" type="text" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cashier1" />
        </Field>
        <Field label="Password" htmlFor="st-pass" hint="Optional — any 4+ characters (e.g. 1234).">
          <Input id="st-pass" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Generated if blank" />
        </Field>
        <Field label="POS PIN" htmlFor="st-pin" hint="Optional, 4–6 digits, for the POS lock screen.">
          <Input id="st-pin" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
      </div>
    </AdminModal>
  )
}

function BillingTab({ data }: { data: Detail }) {
  const columns: AdminColumn<Detail['payments'][number]>[] = [
    { key: 'date', header: 'Date', primary: true, cell: (p) => fmtDate(p.createdAt) },
    { key: 'method', header: 'Method', cell: (p) => (p.kind === 'payhere' ? 'Card (PayHere)' : 'Bank transfer') },
    { key: 'ref', header: 'Reference', hideBelow: 'md', cell: (p) => <span className="adm-num text-adm-muted">{p.reference || '—'}</span> },
    { key: 'period', header: 'Covers', hideBelow: 'lg', cell: (p) => `${p.periodMonths} month${p.periodMonths === 1 ? '' : 's'}` },
    { key: 'amount', header: 'Amount', align: 'right', cell: (p) => <span className="adm-num">{fmtLKR(Number(p.amount), 2)}</span> },
    { key: 'status', header: 'Status', cell: (p) => <Badge tone={statusTone(p.status)}>{p.status.replace(/_/g, ' ')}</Badge> },
  ]
  const sub = data.subscription
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <AdminCard title="Subscription" className="xl:col-span-1">
        {sub ? (
          <KeyValueList
            items={[
              { label: 'Plan', value: sub.tier?.displayName ?? '—' },
              { label: 'Status', value: <Badge tone={statusTone(sub.status)}>{labelFor(SUBSCRIPTION_STATUS_LABEL, sub.status)}</Badge> },
              { label: 'Cycle', value: sub.neverExpires ? 'Free' : sub.billingCycle === 'yearly' ? 'Yearly' : 'Monthly' },
              { label: 'Locked-in price', value: sub.neverExpires ? '—' : `${fmtLKR(Number(sub.subscribedPriceMonthly ?? 0))} / month` },
              { label: 'Current plan price', value: sub.tier ? `${fmtLKR(Number(sub.tier.priceMonthly ?? 0))} / month` : '—' },
              { label: 'Period', value: sub.neverExpires ? 'Does not expire' : `${fmtDate(sub.currentPeriodStart)} – ${fmtDate(sub.currentPeriodEnd)}` },
              { label: 'Trial ends', value: sub.trialEndsAt ? fmtDate(sub.trialEndsAt) : '—' },
              { label: 'Sign-in cut-off', value: data.vendor.planExpiresAt ? fmtDate(data.vendor.planExpiresAt) : 'None' },
            ]}
          />
        ) : (
          <Alert tone="warning">No subscription record.</Alert>
        )}
      </AdminCard>
      <AdminCard title="Payments" description="Bank transfers and card payments for this subscription (latest 25 of each)." className="xl:col-span-2" flush>
        <AdminTable columns={columns} rows={data.payments} rowKey={(p) => `${p.kind}-${p.id}`} minWidth={620} empty={<EmptyState icon={CreditCard} title="No payments yet" compact />} />
      </AdminCard>
    </div>
  )
}

function FeaturesTab({ vendorId, flags, businessType, onSaved }: { vendorId: string; flags: Record<string, boolean>; businessType: string; onSaved: (text: string) => void }) {
  // What the server holds now. Starts from the loaded flags and follows each save, so a change can be
  // saved and then switched back and saved again (comparing with the stale prop disabled Save).
  const [saved, setSaved] = useState(flags)
  const [draft, setDraft] = useState(flags)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOther, setShowOther] = useState(false)
  const dirty = FEATURE_DEFS.some((d) => !!draft[d.key] !== !!saved[d.key])
  const canEdit = useAdminCan('vendors.manage')
  const relevant = FEATURE_DEFS.filter((d) => featureAppliesTo(d.key, businessType))
  const other = FEATURE_DEFS.filter((d) => !featureAppliesTo(d.key, businessType))
  const onCount = relevant.filter((d) => draft[d.key]).length

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await adminFetch<{ featureFlags: Record<string, boolean> }>(`/api/sys-control/vendors/${vendorId}/features`, { method: 'PUT', json: { featureFlags: draft } })
      setSaved(res.featureFlags)
      setDraft(res.featureFlags)
      onSaved('Feature switches saved. Menus update on the vendor’s next page load; the server applies them within seconds.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const setGroup = (keys: string[], on: boolean) => setDraft((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k, on])) }))
  const renderGroup = (defs: typeof FEATURE_DEFS) => (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
      {defs.map((d) => (
        <Switch key={d.key} label={d.label} description={d.description} checked={!!draft[d.key]} disabled={!canEdit} onChange={(c) => setDraft((x) => ({ ...x, [d.key]: c }))} />
      ))}
    </div>
  )

  return (
    <AdminCard
      title="Feature switches"
      description={`${onCount} of ${relevant.length} features on for this ${businessTypeLabel(businessType).toLowerCase()} business. A switched-off feature disappears from the vendor’s menus, web and app, and its API answers “turned off”. Existing data is kept and comes back when switched on.`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <span className="mr-auto text-[13px] text-adm-danger">{error}</span>}
          {!canEdit && <span className="mr-auto text-[13px] text-adm-subtle">Only owners can change feature switches.</span>}
          <Button variant="ghost" onClick={() => setDraft(saved)} disabled={!dirty || saving}>Undo changes</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty || !canEdit}>Save</Button>
        </div>
      }
    >
      <div className="space-y-6">
        {FEATURE_GROUPS.map((g) => {
          const defs = relevant.filter((d) => d.group === g)
          if (defs.length === 0) return null
          return (
            <section key={g}>
              <div className="mb-3 flex items-center justify-between gap-2 border-b border-adm-border pb-2">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-adm-subtle">{g}</h3>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setGroup(defs.map((d) => d.key), true)}>All on</Button>
                    <Button size="sm" variant="ghost" onClick={() => setGroup(defs.map((d) => d.key), false)}>All off</Button>
                  </div>
                )}
              </div>
              {renderGroup(defs)}
            </section>
          )
        })}
        {other.length > 0 && (
          <section>
            <button type="button" className="text-[13px] font-medium text-adm-primary hover:underline" onClick={() => setShowOther((v) => !v)}>
              {showOther ? 'Hide' : 'Show'} {other.length} feature{other.length === 1 ? '' : 's'} for other business types
            </button>
            {showOther && <div className="mt-3">{renderGroup(other)}</div>}
          </section>
        )}
      </div>
    </AdminCard>
  )
}

function ActivityTab({ activity }: { activity: Detail['activity'] }) {
  return (
    <AdminCard title="Admin activity" description="Platform-admin actions on this vendor and its subscription (latest 40)." flush>
      {activity.length === 0 ? (
        <EmptyState title="No admin actions recorded" compact />
      ) : (
        <ul className="divide-y divide-[var(--adm-border)]">
          {activity.map((a) => {
            const reason = (a.details as { reason?: string } | null)?.reason
            return (
              <li key={a.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5">
                <div className="min-w-0">
                  <p className="text-[13.5px] text-adm-fg">{activityText(a)}</p>
                  {reason && <p className="text-[12.5px] text-adm-muted">“{reason}”</p>}
                </div>
                <p className="shrink-0 text-[12.5px] text-adm-subtle">{a.adminName ?? 'Admin'} · {fmtDateTime(a.createdAt)}</p>
              </li>
            )
          })}
        </ul>
      )}
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ action dialogs */

function ActionDialogs({ dialog, data, onClose, onDone }: { dialog: Dialog; data: Detail; onClose: () => void; onDone: (text: string, tone?: 'success' | 'warning') => void }) {
  const v = data.vendor
  const sub = data.subscription
  // State starts fresh for every dialog: the parent remounts this component per dialog (key)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('14')
  const [tierId, setTierId] = useState(sub?.tier?.id ?? '')
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>((sub?.billingCycle as 'monthly' | 'yearly') || 'monthly')
  const [confirm, setConfirm] = useState('')
  const [pwMode, setPwMode] = useState<'email' | 'temporary'>('email')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(body: Record<string, unknown>, onOk?: (res: Record<string, unknown>) => boolean | void) {
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch<Record<string, unknown>>(`/api/sys-control/vendors/${v.id}/actions`, { method: 'POST', json: body })
      if (onOk?.(res) === true) return
      const warning = typeof res.warning === 'string' ? res.warning : null
      onDone([res.message, warning].filter(Boolean).join(' '), warning ? 'warning' : 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed')
    } finally {
      setBusy(false)
    }
  }

  async function impersonate() {
    setBusy(true)
    setError(null)
    // Open the tab inside the click so pop-up blockers allow it, then point it at the sign-in link
    const tab = window.open('about:blank', '_blank')
    try {
      const res = await adminFetch<{ redirectUrl: string }>(`/api/sys-control/vendors/${v.id}/impersonate`, { method: 'POST', json: { reason: reason.trim() || undefined } })
      if (tab) {
        tab.opener = null
        tab.location.href = res.redirectUrl
      } else {
        window.location.href = res.redirectUrl
      }
      onClose()
    } catch (e) {
      tab?.close()
      setError(e instanceof Error ? e.message : 'Could not open the vendor app')
    } finally {
      setBusy(false)
    }
  }

  const reasonOk = reason.trim().length >= 3
  const reasonField = (label = 'Reason', hint = 'Recorded in the audit log.') => (
    <Field label={label} htmlFor="act-reason" required hint={hint}>
      <Textarea id="act-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Field>
  )
  const footer = (label: string, onClick: () => void, variant: 'primary' | 'danger' = 'primary', disabled = false) => (
    <>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant={variant} onClick={onClick} loading={busy} disabled={disabled}>{label}</Button>
    </>
  )
  const err = error && <Alert tone="danger" className="mb-3">{error}</Alert>
  const trial = sub?.status === 'trial' && !!sub.trialEndsAt
  const daysN = Number(days)
  const daysOk = Number.isInteger(daysN) && daysN >= 1 && daysN <= 366
  const targetTier = data.tiers.find((t) => t.id === tierId)
  const targetFree = targetTier ? Number(targetTier.priceMonthly ?? 0) === 0 && Number(targetTier.priceYearly ?? 0) === 0 : false

  switch (dialog) {
    case 'suspend':
      return (
        <AdminModal open onClose={onClose} title={`Suspend ${v.name}?`} description="Staff are signed out and cannot sign in on the web or the app. No data is changed." footer={footer('Suspend', () => run({ action: 'suspend', reason }), 'danger', !reasonOk)}>
          {err}
          {reasonField()}
        </AdminModal>
      )
    case 'reactivate':
      return (
        <AdminModal open onClose={onClose} title={`Reactivate ${v.name}?`} description="Staff can sign in again straight away." footer={footer('Reactivate', () => run({ action: 'reactivate', reason: reason.trim() || undefined }))}>
          {err}
          {sub && !sub.neverExpires && (daysUntil(sub.trialEndsAt ?? sub.currentPeriodEnd) ?? 0) < 0 && (
            <Alert tone="warning" className="mb-3">The subscription period has ended. Extend it after reactivating, or the billing job will lock the vendor again.</Alert>
          )}
          <Field label="Note" htmlFor="act-reason" hint="Optional; recorded in the audit log.">
            <Textarea id="act-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </AdminModal>
      )
    case 'extend':
      return (
        <AdminModal
          open
          onClose={onClose}
          title={trial ? 'Extend trial' : 'Extend subscription'}
          description={trial ? `Trial currently ends ${fmtDate(sub?.trialEndsAt)}.` : `Current period ends ${fmtDate(sub?.currentPeriodEnd)}. Added days are free of charge.`}
          footer={footer('Extend', () => run({ action: trial ? 'extend_trial' : 'extend', days: daysN, reason }), 'primary', !reasonOk || !daysOk)}
        >
          {err}
          <div className="space-y-4">
            <Field label="Days to add" htmlFor="act-days" required hint="Counted from the current end date, or from today if it has passed.">
              <Input id="act-days" type="number" inputMode="numeric" min={1} max={366} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            {reasonField()}
          </div>
        </AdminModal>
      )
    case 'plan':
      return (
        <AdminModal
          open
          onClose={onClose}
          title="Change plan"
          description="Moves the vendor to another plan without charging them. The new plan’s current price applies from the next renewal."
          footer={footer('Change plan', () => run({ action: 'change_plan', tierId, billingCycle: targetFree ? undefined : cycle, reason }), 'primary', !reasonOk || !tierId)}
        >
          {err}
          <div className="space-y-4">
            <Field label="Plan" htmlFor="act-tier" required>
              <Select id="act-tier" value={tierId} onChange={(e) => setTierId(e.target.value)}>
                {data.tiers.filter((t) => t.isActive || t.id === sub?.tier?.id).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName} — {Number(t.priceMonthly ?? 0) === 0 ? 'Free' : `${fmtLKR(Number(t.priceMonthly))}/month`}{t.maxUsers ? ` · ${t.maxUsers} users` : ''}{t.id === sub?.tier?.id ? ' (current)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {!targetFree && (
              <Field label="Billing cycle">
                <SegmentedControl ariaLabel="Billing cycle" value={cycle} onChange={setCycle} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} size="sm" />
              </Field>
            )}
            <p className="text-[13px] text-adm-muted">
              {targetFree
                ? 'The free plan does not expire.'
                : sub?.status === 'trial' || sub?.neverExpires
                  ? `A complimentary first ${cycle === 'yearly' ? 'year' : 'month'} starts today.`
                  : 'The current paid period is kept as it is.'}
            </p>
            {reasonField()}
          </div>
        </AdminModal>
      )
    case 'password':
      return (
        <AdminModal
          open
          onClose={onClose}
          title="Reset owner password"
          description={data.owner ? `${data.owner.fullName} · ${data.owner.email}` : undefined}
          footer={
            tempPassword ? (
              <Button variant="primary" onClick={() => onDone('Temporary password set. The owner’s other sessions were signed out.')}>Done</Button>
            ) : (
              footer(pwMode === 'email' ? 'Send reset link' : 'Set temporary password', () =>
                run({ action: 'reset_password', mode: pwMode }, (res) => {
                  if (typeof res.temporaryPassword === 'string') {
                    setTempPassword(res.temporaryPassword)
                    return true
                  }
                }))
            )
          }
        >
          {err}
          {tempPassword ? (
            <div className="space-y-3">
              <Alert tone="warning" title="Shown only once">Give this password to the owner securely and ask them to change it after signing in.</Alert>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-adm-border bg-adm-surface-2 px-4 py-3">
                <span className="adm-num select-all break-all text-[18px] font-semibold tracking-[0.04em] text-adm-fg">{tempPassword}</span>
                <CopyButton text={tempPassword} label="Copy password" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <SegmentedControl
                ariaLabel="Reset method"
                value={pwMode}
                onChange={setPwMode}
                options={[{ value: 'email', label: 'Email a reset link' }, { value: 'temporary', label: 'Set a temporary password' }]}
              />
              <p className="text-[13px] text-adm-muted">
                {pwMode === 'email'
                  ? 'The owner receives a one-time link that expires in 1 hour. The current password keeps working until they use it.'
                  : 'The current password stops working immediately and the owner is signed out everywhere. You will see the new password once.'}
              </p>
            </div>
          )}
        </AdminModal>
      )
    case 'welcome':
      return (
        <AdminModal
          open
          onClose={onClose}
          title={data.owner && !data.owner.inviteAccepted ? 'Resend invitation' : 'Email sign-in details'}
          description={data.owner?.email}
          footer={footer('Send email', () => run({ action: 'resend_welcome' }))}
        >
          {err}
          <p className="text-[13.5px] text-adm-muted">
            {data.owner && !data.owner.inviteAccepted
              ? 'A new 7-day invitation link replaces the previous one.'
              : `The owner receives the sign-in page address, the Business ID ${formatBusinessId(v.businessId)} and their email. No password is sent.`}
          </p>
        </AdminModal>
      )
    case 'archive':
      return (
        <AdminModal
          open
          onClose={onClose}
          title={`Archive ${v.name}?`}
          description="Sign-in is blocked and the vendor is hidden from active lists. Sales, invoices and billing records are kept and nothing is deleted. You can reactivate it later."
          footer={footer('Archive', () => run({ action: 'archive', reason, confirm }), 'danger', !reasonOk || !confirm.trim())}
        >
          {err}
          <div className="space-y-4">
            {reasonField()}
            <Field label={`Type the Business ID ${formatBusinessId(v.businessId)} to confirm`} htmlFor="act-confirm" required>
              <Input id="act-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </Field>
          </div>
        </AdminModal>
      )
    case 'impersonate':
      return (
        <AdminModal
          open
          onClose={onClose}
          title="Open as owner"
          description={`Opens ${v.name} in a new tab signed in as ${data.owner?.fullName ?? 'the owner'}. The link is valid for 2 minutes.`}
          footer={footer('Open vendor app', impersonate)}
        >
          {err}
          <Alert tone="info" className="mb-3">Everything you do there is done as the owner. This sign-in is recorded in the audit log.</Alert>
          <Field label="Reason" htmlFor="act-reason" hint="Optional, e.g. a support ticket number.">
            <Input id="act-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </AdminModal>
      )
    default:
      return null
  }
}

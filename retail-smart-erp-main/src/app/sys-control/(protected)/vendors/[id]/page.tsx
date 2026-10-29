'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Archive,
  Boxes,
  CalendarPlus,
  CreditCard,
  Database,
  ExternalLink,
  KeyRound,
  Layers,
  MessagesSquare,
  Mail,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Store,
  Trash2,
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
  Checkbox,
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
import { ADJUSTMENT_REASON_CODES, ADJUSTMENT_REASON_LABELS, type AdjustmentReasonCode } from '@/lib/inventory/adjustment-reasons'

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

type Tab = 'overview' | 'staff' | 'stock' | 'billing' | 'features' | 'activity'
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
  if (a.resource === 'vendor_stock') return `Changed stock counts of ${d.count} item${d.count === 1 ? '' : 's'}${d.warehouse ? ` in ${d.warehouse}` : ''}${d.note ? ` — ${d.note}` : ''}`
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
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null)
  const [creatingCashier, setCreatingCashier] = useState(false)
  const [credResult, setCredResult] = useState<{ title: string; email: string; password: string } | null>(null)
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

  const done = useCallback((text: string, tone: 'success' | 'warning' = 'success', creds?: { title: string; email: string; password: string }) => {
    setDialog(null)
    setFlash({ tone, text })
    if (creds) setCredResult(creds)
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
  const cashiers = data.staff.filter((s) => s.role === 'cashier')
  const otherStaff = data.staff.filter((s) => s.role !== 'owner' && s.role !== 'cashier')
  const trialEnds = sub?.status === 'trial' && sub.trialEndsAt ? sub.trialEndsAt : null
  const periodLabel = sub
    ? sub.neverExpires
      ? 'Does not expire'
      : trialEnds
        ? `Trial ends ${fmtDate(trialEnds)}`
        : `${(daysUntil(sub.currentPeriodEnd) ?? 0) < 0 ? 'Ended' : 'Renews'} ${fmtDate(sub.currentPeriodEnd)}`
    : 'No subscription'

  async function handleResetStaffPassword(u: StaffRow) {
    if (!data) return
    setBusyStaffId(u.id)
    try {
      const res = await adminFetch<{ temporaryPassword: string | null; email: string }>(
        `/api/sys-control/vendors/${data.vendor.id}/staff`,
        { method: 'PATCH', json: { userId: u.id, action: 'reset_password' } }
      )
      if (res.temporaryPassword) {
        setCredResult({
          title: `New temporary password for ${u.fullName} (${ROLE_LABEL[u.role] ?? u.role})`,
          email: res.email,
          password: res.temporaryPassword,
        })
      }
      setFlash({ tone: 'success', text: `Temporary password generated for ${u.fullName}.` })
      load()
    } catch (e) {
      setFlash({ tone: 'danger', text: e instanceof Error ? e.message : 'Password reset failed' })
    } finally {
      setBusyStaffId(null)
    }
  }

  async function handleCreateDefaultCashier() {
    if (!data) return
    setCreatingCashier(true)
    try {
      const res = await adminFetch<{ success: boolean; user: { fullName: string; email: string }; generatedPassword?: string }>(
        `/api/sys-control/vendors/${data.vendor.id}/staff`,
        {
          method: 'POST',
          json: {
            fullName: 'Cashier',
            role: 'cashier',
            email: `cashier@${data.vendor.slug}`,
          },
        }
      )
      if (res.generatedPassword) {
        setCredResult({
          title: `Cashier account created for ${data.vendor.name}`,
          email: res.user.email,
          password: res.generatedPassword,
        })
      }
      setFlash({ tone: 'success', text: `Cashier account created (${displayLogin(res.user.email)}).` })
      load()
    } catch (e) {
      setFlash({ tone: 'danger', text: e instanceof Error ? e.message : 'Failed to create cashier' })
    } finally {
      setCreatingCashier(false)
    }
  }

  function copyFullCredentials() {
    if (!data) return
    const adminLogin = data.owner?.email || 'N/A'
    const primaryCashier = cashiers[0] ? displayLogin(cashiers[0].email) : 'None created yet'
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const text = [
      `=== ${data.vendor.name} Sign-in Credentials ===`,
      `Business ID: ${bid}`,
      `Sign-in URL: ${origin}/c/${data.vendor.slug}/login`,
      `Admin Login: ${adminLogin}`,
      `Cashier Login: ${primaryCashier}`,
    ].join('\n')
    navigator.clipboard.writeText(text)
    setFlash({ tone: 'success', text: 'Full sign-in credentials copied to clipboard!' })
  }

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
          <Button variant="ghost" icon={KeyRound} onClick={copyFullCredentials}>Copy Credentials</Button>
          <LinkButton href={`/sys-control/vendors/${v.id}/messaging`} icon={MessagesSquare}>SMS &amp; WhatsApp</LinkButton>
          {canImpersonate && <LinkButton href={`/sys-control/vendors/${v.id}/data`} icon={Database}>All data</LinkButton>}
          {canImpersonate && <LinkButton href={`/sys-control/vendors/${v.id}/recycle-bin`} icon={Trash2}>Recycle bin</LinkButton>}
          {canImpersonate && <Button icon={ExternalLink} onClick={() => setDialog('impersonate')} disabled={!isActive || !owner}>Open as owner</Button>}
        </>
      }
    >
      {flash && (
        <Alert tone={flash.tone} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash.text}</Alert>
      )}
      {credResult && (
        <Alert tone="warning" title={`${credResult.title} (shown once)`}>
          <div className="space-y-1">
            <span className="inline-flex flex-wrap items-center gap-2">
              Business ID <span className="font-mono font-bold text-adm-fg">{bid}</span> ·
              Login <span className="font-mono font-bold text-adm-fg">{displayLogin(credResult.email)}</span> ·
              Password <span className="font-mono font-semibold text-adm-fg">{credResult.password}</span>
              <CopyButton
                text={`Business ID: ${bid}\nLogin: ${displayLogin(credResult.email)}\nPassword: ${credResult.password}\nSign-in URL: ${typeof window !== 'undefined' ? window.location.origin : ''}/c/${v.slug}/login`}
                label="Copy credentials"
              />
              <Button size="sm" variant="ghost" onClick={() => setCredResult(null)}>Dismiss</Button>
            </span>
            <span className="mt-1 block text-xs text-adm-muted">Sign in with the Business ID, this login and password at /c/{v.slug}/login.</span>
          </div>
        </Alert>
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
          ...(canImpersonate ? [{ value: 'stock' as const, label: 'Stock' }] : []),
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
            <AdminCard
              title="Admin & Cashier Access"
              description="Business ID, Vendor Admin, and Cashier sign-in credentials for testing or access."
              actions={
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="ghost" icon={KeyRound} onClick={copyFullCredentials}>
                    Copy All
                  </Button>
                  <LinkButton href={`/c/${v.slug}/login`} target="_blank" icon={ExternalLink} size="sm">
                    Sign-in Page
                  </LinkButton>
                </div>
              }
            >
              {/* Business ID Bar */}
              <div className="mb-3 rounded-lg border border-adm-border bg-adm-surface-2/60 px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-adm-muted font-medium">Business ID:</span>
                  <span className="font-mono text-sm font-bold text-adm-fg">{bid}</span>
                </div>
                <CopyButton text={bid} label="Copy Business ID" />
              </div>

              <div className="space-y-3">
                {/* Admin Account */}
                <div className="rounded-lg border border-adm-border p-3 space-y-2 bg-adm-surface">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-adm-muted flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      Vendor Admin (Owner)
                    </span>
                    {owner && <Badge tone={owner.inviteAccepted ? 'success' : 'warning'} dot>{owner.inviteAccepted ? 'Active' : 'Invited'}</Badge>}
                  </div>

                  {owner ? (
                    <div className="space-y-1 text-[13px]">
                      <div className="flex justify-between">
                        <span className="text-adm-subtle">Name:</span>
                        <span className="font-medium text-adm-fg">{owner.fullName}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-adm-subtle">Login / Email:</span>
                        <span className="font-mono text-adm-fg flex items-center gap-1">
                          {owner.email}
                          <CopyButton text={owner.email} label="Copy admin login" />
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-adm-muted">
                        <span>Last sign-in:</span>
                        <span>{owner.lastLoginAt ? timeAgo(owner.lastLoginAt) : 'Never'}</span>
                      </div>
                      <div className="pt-2 flex flex-wrap gap-1.5">
                        <Button size="sm" icon={KeyRound} onClick={() => setDialog('password')}>
                          Reset Password
                        </Button>
                        {canImpersonate && isActive && (
                          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => setDialog('impersonate')}>
                            Sign In As Admin
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Alert tone="warning">No owner user found.</Alert>
                  )}
                </div>

                {/* Cashier Account(s) */}
                <div className="rounded-lg border border-adm-border p-3 space-y-2 bg-adm-surface">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-adm-muted flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Cashier
                    </span>
                    {cashiers.length > 0 && <Badge tone="success" dot>{cashiers.length} Cashier{cashiers.length > 1 ? 's' : ''}</Badge>}
                  </div>

                  {cashiers.length > 0 ? (
                    <div className="space-y-2.5">
                      {cashiers.map((c) => (
                        <div key={c.id} className="space-y-1 text-[13px] border-b border-adm-border/50 pb-2 last:border-none last:pb-0">
                          <div className="flex justify-between">
                            <span className="text-adm-subtle">Name:</span>
                            <span className="font-medium text-adm-fg">{c.fullName}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-adm-subtle">Login:</span>
                            <span className="font-mono text-adm-fg flex items-center gap-1">
                              {displayLogin(c.email)}
                              <CopyButton text={displayLogin(c.email)} label="Copy cashier login" />
                            </span>
                          </div>
                          <div className="flex justify-between text-xs text-adm-muted">
                            <span>Status:</span>
                            <span>{c.isActive ? 'Active' : 'Deactivated'} · {c.lastLoginAt ? timeAgo(c.lastLoginAt) : 'Never signed in'}</span>
                          </div>
                          <div className="pt-1.5 flex flex-wrap gap-1.5">
                            <Button size="sm" icon={KeyRound} disabled={busyStaffId === c.id} onClick={() => handleResetStaffPassword(c)}>
                              Reset Password
                            </Button>
                            <LinkButton size="sm" variant="ghost" icon={ExternalLink} href={`/c/${v.slug}/login`} target="_blank">
                              Open Login
                            </LinkButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <p className="text-xs text-adm-muted">No cashier created yet for this vendor.</p>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={UserPlus}
                          loading={creatingCashier}
                          onClick={handleCreateDefaultCashier}
                        >
                          + Create Default Cashier
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Other staff summary */}
                {otherStaff.length > 0 && (
                  <div className="text-xs text-adm-muted pt-1">
                    <button
                      type="button"
                      onClick={() => setTab('staff')}
                      className="text-adm-primary hover:underline font-medium"
                    >
                      View all {data.staff.length} staff members (including {otherStaff.length} other roles) &rarr;
                    </button>
                  </div>
                )}
              </div>
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

      {tab === 'staff' && <StaffTab staff={data.staff} vendorId={v.id} businessType={v.businessType} branches={v.branches.filter((b) => b.isActive)} canManage={canManage} onChanged={(text) => { setFlash({ tone: 'success', text }); load() }} />}
      {tab === 'stock' && canImpersonate && <StockTab vendorId={v.id} onSaved={(text) => setFlash({ tone: 'success', text })} />}
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
type BranchRow = Detail['vendor']['branches'][number]

function StaffTab({ staff, vendorId, businessType, branches, canManage, onChanged }: {
  staff: Detail['staff']; vendorId: string; businessType: string; branches: BranchRow[]; canManage: boolean; onChanged: (text: string) => void
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
          branches={branches}
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

function AddStaffDialog({ vendorId, businessType, branches, onClose, onCreated }: {
  vendorId: string; businessType: string; branches: BranchRow[]; onClose: () => void; onCreated: (name: string, email: string, password: string | null) => void
}) {
  const roles = getRolesForBusinessType(businessType).filter((r) => r !== 'owner')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<string>(roles.includes('cashier') ? 'cashier' : roles[0])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  // K4: branches this staff member works in (none = every branch; one branch is auto-assigned)
  const [branchIds, setBranchIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameOk = fullName.trim().length >= 2

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const trimmed = email.trim()
      const normalizedEmail = trimmed
        ? trimmed.includes('@')
          ? trimmed.replace(/\s*@\s*/, '@').replace(/\s+/g, '').toLowerCase()
          : trimmed.replace(/\s+/g, '.').toLowerCase()
        : undefined
      const res = await adminFetch<{ user: { email: string; fullName: string }; generatedPassword: string | null }>(`/api/sys-control/vendors/${vendorId}/staff`, {
        method: 'POST',
        json: { fullName: fullName.trim(), role, email: normalizedEmail, password: password || undefined, pin: pin || undefined, warehouseIds: branchIds.length ? branchIds : undefined },
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
        {branches.length > 1 && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[13px] font-medium text-adm-fg">Branches</legend>
            <p className="mb-2 text-[12.5px] text-adm-subtle">Staff given branches only see and work with those branches. Leave all unticked to let them work with every branch.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {branches.map((b) => (
                <Checkbox
                  key={b.id}
                  label={b.name}
                  description={b.code || undefined}
                  checked={branchIds.includes(b.id)}
                  onChange={(e) => setBranchIds((ids) => e.target.checked ? [...ids, b.id] : ids.filter((x) => x !== b.id))}
                />
              ))}
            </div>
          </fieldset>
        )}
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

interface StockRow { itemId: string; name: string; sku: string | null; barcode: string | null; unit: string | null; costPrice: number; stock: number; reserved: number }
interface StockList { branches: Array<{ id: string; name: string; code: string | null; isDefault: boolean }>; warehouseId: string | null; rows: StockRow[]; total: number; page: number; pageSize: number }

function StockTab({ vendorId, onSaved }: { vendorId: string; onSaved: (text: string) => void }) {
  const canEdit = useAdminCan('vendors.manage')
  const [list, setList] = useState<StockList | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // itemId → new count typed in (kept across pages and searches until saved)
  const [draft, setDraft] = useState<Record<string, { value: string; name: string; before: number }>>({})
  const [reasonCode, setReasonCode] = useState<AdjustmentReasonCode>('count_correction')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (warehouseId) params.set('warehouseId', warehouseId)
      if (q) params.set('q', q)
      const res = await adminFetch<StockList>(`/api/sys-control/vendors/${vendorId}/stock?${params}`)
      setList(res)
      if (res.warehouseId && res.warehouseId !== warehouseId) setWarehouseId(res.warehouseId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load stock')
    } finally {
      setLoading(false)
    }
  }, [vendorId, warehouseId, q, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const changes = Object.entries(draft)
    .map(([itemId, d]) => ({ itemId, ...d, qty: Number(d.value) }))
    .filter((d) => d.value.trim() !== '' && Number.isFinite(d.qty) && d.qty >= 0 && d.qty !== d.before)
  const invalid = Object.values(draft).some((d) => d.value.trim() !== '' && !(Number(d.value) >= 0))

  function changeBranch(id: string) {
    if (changes.length > 0 && !confirm('Changed counts for this branch are not saved yet. Discard them?')) return
    setDraft({})
    setWarehouseId(id)
    setPage(1)
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await adminFetch<{ adjusted: number; warnings: string[] }>(`/api/sys-control/vendors/${vendorId}/stock`, {
        method: 'POST',
        json: { warehouseId, reasonCode, note, adjustments: changes.map((c) => ({ itemId: c.itemId, newQuantity: c.qty })) },
      })
      setDraft({})
      setNote('')
      onSaved(`Stock updated for ${res.adjusted} item${res.adjusted === 1 ? '' : 's'}. The vendor sees each change in Stock movements.${res.warnings.length ? ` Note: ${res.warnings.join('; ')}` : ''}`)
      await load()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const columns: AdminColumn<StockRow>[] = [
    {
      key: 'item', header: 'Item', primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-adm-fg">{r.name}</div>
          <div className="adm-num text-[12px] text-adm-subtle">{[r.sku, r.barcode].filter(Boolean).join(' · ') || '—'}</div>
        </div>
      ),
    },
    { key: 'stock', header: 'In stock', align: 'right', cell: (r) => <span className="adm-num">{fmtNumber(r.stock)} {r.unit || ''}</span> },
    { key: 'reserved', header: 'Reserved', align: 'right', hideBelow: 'md', cell: (r) => <span className="adm-num text-adm-muted">{r.reserved ? fmtNumber(r.reserved) : '—'}</span> },
    {
      key: 'new', header: 'New count', align: 'right',
      cell: (r) => {
        const d = draft[r.itemId]
        const value = d?.value ?? ''
        const qty = Number(value)
        const delta = value.trim() !== '' && qty >= 0 ? qty - r.stock : 0
        return (
          <div className="flex items-center justify-end gap-2">
            {delta !== 0 && <Badge tone={delta > 0 ? 'success' : 'danger'}>{delta > 0 ? '+' : ''}{fmtNumber(delta)}</Badge>}
            <Input
              size="sm"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              aria-label={`New count for ${r.name}`}
              className="w-24 text-right"
              placeholder={String(r.stock)}
              value={value}
              disabled={!canEdit}
              invalid={value.trim() !== '' && !(qty >= 0)}
              onChange={(e) => setDraft((x) => ({ ...x, [r.itemId]: { value: e.target.value, name: r.name, before: r.stock } }))}
            />
          </div>
        )
      },
    },
  ]

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1

  if (list && list.branches.length === 0) {
    return <AdminCard title="Stock"><EmptyState icon={Boxes} title="This vendor has no active branch" compact /></AdminCard>
  }

  return (
    <AdminCard
      title="Stock"
      description="Counts per branch for stock-tracked items. Type the real count and save: each change is saved like the vendor’s own stock adjustment (stock movement with your reason, accounting entry) and logged here under Activity."
      flush
      footer={canEdit ? (
        <div className="space-y-3">
          {saveError && <Alert tone="danger">{saveError}</Alert>}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Reason" htmlFor="stk-reason" className="w-44">
              <Select id="stk-reason" size="sm" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as AdjustmentReasonCode)}>
                {ADJUSTMENT_REASON_CODES.map((c) => <option key={c} value={c}>{ADJUSTMENT_REASON_LABELS[c]}</option>)}
              </Select>
            </Field>
            <Field label="Note" htmlFor="stk-note" className="min-w-[200px] flex-1">
              <Input id="stk-note" size="sm" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Owner asked to correct counts after stock check" />
            </Field>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0 || saving}>Clear</Button>
              <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={changes.length === 0 || invalid || note.trim().length < 3}>
                Save {changes.length > 0 ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'changes'}
              </Button>
            </div>
          </div>
          {changes.length > 0 && note.trim().length < 3 && <p className="text-[12.5px] text-adm-subtle">Add a note saying why the stock is changed.</p>}
        </div>
      ) : (
        <span className="text-[13px] text-adm-subtle">Only owners can change stock.</span>
      )}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-adm-border px-4 py-3 sm:px-5">
        <Select size="sm" aria-label="Branch" className="w-56" value={warehouseId} onChange={(e) => changeBranch(e.target.value)}>
          {(list?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
        </Select>
        <Input size="sm" leftIcon={Search} wrapperClassName="min-w-[200px] flex-1" placeholder="Search name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
        {list && <span className="text-[13px] text-adm-muted">{fmtNumber(list.total)} item{list.total === 1 ? '' : 's'}</span>}
      </div>
      {error ? (
        <div className="p-4"><Alert tone="danger" action={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Retry</Button>}>{error}</Alert></div>
      ) : (
        <AdminTable
          columns={columns}
          rows={list?.rows ?? []}
          rowKey={(r) => r.itemId}
          loading={loading && !list}
          minWidth={560}
          empty={<EmptyState icon={Boxes} title={q ? 'No items match' : 'No stock-tracked items'} compact />}
        />
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-adm-border px-4 py-2.5 text-[13px] sm:px-5">
          <span className="mr-auto text-adm-muted">Page {page} of {pages}</span>
          <Button size="sm" variant="ghost" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button size="sm" variant="ghost" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
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

function ActionDialogs({ dialog, data, onClose, onDone }: {
  dialog: Dialog
  data: Detail
  onClose: () => void
  onDone: (text: string, tone?: 'success' | 'warning', creds?: { title: string; email: string; password: string }) => void
}) {
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
              <Button
                variant="primary"
                onClick={() =>
                  onDone(
                    'Temporary password set. The owner’s other sessions were signed out.',
                    'success',
                    {
                      title: `New temporary password for Vendor Admin (${data.owner?.fullName})`,
                      email: data.owner?.email || '',
                      password: tempPassword,
                    }
                  )
                }
              >
                Done
              </Button>
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

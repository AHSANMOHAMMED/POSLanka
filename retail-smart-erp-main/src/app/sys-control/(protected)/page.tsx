'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bug,
  Clock,
  Database,
  FileCheck,
  History,
  Plus,
  RefreshCw,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  Alert,
  Badge,
  Button,
  EmptyState,
  LinkButton,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatGrid,
  StatusDot,
  businessTypeLabel,
  fmtCompact,
  fmtLKR,
  fmtNumber,
  timeAgo,
} from '@/components/admin/kit'
import { formatUptime, useAdminHealth } from '@/components/admin/AdminHealth'
import { cn } from '@/lib/utils'

type RangeKey = 'today' | '7d' | '30d'

interface StatsResponse {
  overview: {
    totalAccounts: number
    totalCompanies: number
    activeSubscriptions: number
    trialSubscriptions: number
    pendingPayments: number
    newSignupsThisWeek: number
    newCompaniesThisWeek: number
    totalRevenue: number
    monthlyRevenue: number
  }
  subscriptionsByStatus: Record<string, number>
  tenantsByType: Record<string, number>
  recentSignups: Array<{ id: string; email: string; fullName: string; createdAt: string }>
  recentCompanies: Array<{ id: string; name: string; slug: string; businessType: string; createdAt: string }>
  expiringTrials: Array<{
    id: string
    trialEndsAt: string | null
    tenant?: { name: string; slug: string } | null
    billingAccount?: { email: string; fullName: string } | null
  }>
}

interface SalesAnalytics {
  totals: { netSales: number; grossSales: number; returns: number; receipts: number; avgBasket: number; voids: number }
  byDay: Array<{ date: string; netSales: number; receipts: number }>
  byBusinessType: Array<{ businessType: string; netSales: number; receipts: number }>
  topVendors: Array<{ tenantId: string; name: string; slug: string; netSales: number; receipts: number }>
  openShifts: { count: number; byVendor: Array<{ tenantId: string; name: string; count: number }> }
}

interface AuditLogRow {
  id: string
  action: string
  resource: string
  resourceId: string | null
  createdAt: string
  account?: { email: string; fullName: string } | null
}

const POLL_MS = 60_000
const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]
const RANGE_TEXT: Record<RangeKey, string> = { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days' }

function goLogin(res: Response) {
  if (res.status === 401) {
    window.location.href = '/sys-control/login?session=expired'
    return true
  }
  return false
}

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AdminOverviewPage() {
  const { health, refresh: refreshHealth } = useAdminHealth()
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [audit, setAudit] = useState<AuditLogRow[] | null>(null)
  const [sales, setSales] = useState<SalesAnalytics | null>(null)
  const [hourly, setHourly] = useState<Array<{ hour: string; netSales: number; receipts: number }>>([])
  const [range, setRange] = useState<RangeKey>('today')
  const [salesLoading, setSalesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const [statsRes, auditRes] = await Promise.all([
        fetch('/api/sys-control/stats', { cache: 'no-store' }),
        fetch('/api/sys-control/audit-logs?days=30&limit=6', { cache: 'no-store' }),
      ])
      if (goLogin(statsRes)) return
      if (!statsRes.ok) throw new Error('Platform statistics could not be loaded.')
      setStats(await statsRes.json())
      const rows = auditRes.ok ? await auditRes.json() : []
      setAudit(Array.isArray(rows) ? rows : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Platform statistics could not be loaded.')
    }
  }, [])

  const loadSales = useCallback(async (r: RangeKey) => {
    try {
      const [salesRes, liveRes] = await Promise.all([
        fetch(`/api/sys-control/analytics/sales?range=${r}`, { cache: 'no-store' }),
        r === 'today' ? fetch('/api/sys-control/analytics/live', { cache: 'no-store' }) : Promise.resolve(null),
      ])
      if (goLogin(salesRes)) return
      if (!salesRes.ok) throw new Error('Sales figures could not be loaded.')
      setSales(await salesRes.json())
      if (liveRes?.ok) setHourly((await liveRes.json()).hourly || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sales figures could not be loaded.')
    } finally {
      setSalesLoading(false)
    }
  }, [])

  // Stats + audit: once on mount, then every minute (independent of the range)
  useEffect(() => {
    loadStats()
    const id = window.setInterval(() => !document.hidden && loadStats(), POLL_MS)
    return () => window.clearInterval(id)
  }, [loadStats])

  // Sales: on mount and whenever the range changes, then every minute
  useEffect(() => {
    loadSales(range)
    const id = window.setInterval(() => !document.hidden && loadSales(range), POLL_MS)
    return () => window.clearInterval(id)
  }, [range, loadSales])

  const changeRange = (r: RangeKey) => {
    if (r === range) return
    setSalesLoading(true)
    setRange(r)
  }

  const refreshAll = async () => {
    setRefreshing(true)
    await Promise.all([loadStats(), loadSales(range), refreshHealth()])
    setRefreshing(false)
  }

  const series = useMemo(() => buildSeries(range, sales, hourly), [range, sales, hourly])
  const ov = stats?.overview
  const subs = stats?.subscriptionsByStatus ?? {}
  const statsLoading = !stats && !error

  return (
    <AdminPage
      title="Overview"
      description="Sales, vendors and billing across the whole platform."
      actions={
        <>
          <Button icon={RefreshCw} onClick={refreshAll} loading={refreshing}>Refresh</Button>
          <LinkButton href="/sys-control/vendors/create" variant="primary" icon={Plus}>New vendor</LinkButton>
        </>
      }
    >
      {error && <Alert tone="danger" action={<Button size="sm" onClick={refreshAll}>Retry</Button>}>{error}</Alert>}

      <StatGrid>
        <StatCard
          label="Vendors"
          icon={Store}
          loading={statsLoading}
          value={fmtNumber(ov?.totalCompanies)}
          hint={`${ov?.newCompaniesThisWeek ?? 0} new this week`}
          href="/sys-control/vendors"
          footer={
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span><b className="font-medium text-adm-fg">{subs.active ?? 0}</b> paying</span>
              <span><b className="font-medium text-adm-fg">{subs.trial ?? 0}</b> on trial</span>
              {(subs.locked ?? 0) > 0 && <span className="text-adm-danger"><b className="font-medium">{subs.locked}</b> locked</span>}
            </span>
          }
        />
        <StatCard
          label={`Net sales, ${RANGE_TEXT[range]}`}
          icon={TrendingUp}
          loading={salesLoading && !sales}
          value={fmtLKR(sales?.totals.netSales)}
          hint={`${fmtNumber(sales?.totals.receipts)} receipts · avg ${fmtLKR(sales?.totals.avgBasket)}`}
          href="/sys-control/sales-wall"
          footer={
            <span>
              Returns {fmtLKR(sales?.totals.returns)} · {fmtNumber(sales?.totals.voids)} voided
            </span>
          }
        />
        <StatCard
          label="Subscription revenue, this month"
          icon={BarChart3}
          tone="info"
          loading={statsLoading}
          value={fmtLKR(ov?.monthlyRevenue)}
          hint={`${fmtLKR(ov?.totalRevenue)} all time`}
          href="/sys-control/subscriptions"
        />
        <StatCard
          label="Payment slips to review"
          icon={FileCheck}
          tone={(ov?.pendingPayments ?? 0) > 0 ? 'warning' : 'success'}
          loading={statsLoading}
          value={fmtNumber(ov?.pendingPayments)}
          hint={(ov?.pendingPayments ?? 0) > 0 ? 'Bank transfers awaiting approval' : 'Nothing waiting'}
          href="/sys-control/payments"
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <AdminCard
          className="xl:col-span-8"
          title="Net sales"
          description={range === 'today' ? 'By hour, all vendors (returns subtracted, voids excluded)' : 'By day, all vendors (returns subtracted, voids excluded)'}
          actions={<SegmentedControl ariaLabel="Sales range" size="sm" value={range} onChange={changeRange} options={RANGE_OPTIONS} />}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="text-adm-muted">
                {series.peak ? <>Best {range === 'today' ? 'hour' : 'day'}: <b className="font-medium text-adm-fg">{series.peak.label}</b> · {fmtLKR(series.peak.value)}</> : 'No sales in this range yet'}
              </span>
              <Link href="/sys-control/sales-wall" className="inline-flex items-center gap-1 font-medium text-adm-primary hover:underline">
                Live sales <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          }
        >
          {salesLoading && !sales ? (
            <Skeleton className="h-[220px] w-full" />
          ) : series.total === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={range === 'today' ? 'No sales recorded today yet' : `No sales in the ${RANGE_TEXT[range]}`}
              description="Receipts from every vendor’s POS appear here within a minute."
            />
          ) : (
            <SalesBars points={series.points} />
          )}
          {sales && sales.byBusinessType.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {sales.byBusinessType.map((t) => (
                <Badge key={t.businessType} tone="neutral">
                  {businessTypeLabel(t.businessType)} · {fmtLKR(t.netSales)}
                </Badge>
              ))}
            </div>
          )}
        </AdminCard>

        <AdminCard
          className="xl:col-span-4"
          title="Top vendors"
          description={`By net sales, ${RANGE_TEXT[range]}`}
          flush
          footer={
            <Link href="/sys-control/vendors" className="inline-flex items-center gap-1 text-[13px] font-medium text-adm-primary hover:underline">
              All vendors <ArrowRight size={14} aria-hidden />
            </Link>
          }
        >
          {salesLoading && !sales ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (sales?.topVendors ?? []).length === 0 ? (
            <EmptyState compact icon={Store} title="No vendor sales in this range" />
          ) : (
            <ol className="divide-y divide-[var(--adm-border)]">
              {sales!.topVendors.slice(0, 6).map((v, i) => (
                <li key={v.tenantId}>
                  <Link href={`/sys-control/vendors/${v.tenantId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-adm-surface-2 sm:px-5">
                    <span className="adm-num w-5 text-[12.5px] text-adm-subtle">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-adm-fg">{v.name}</span>
                      <span className="block text-[12px] text-adm-subtle">{fmtNumber(v.receipts)} receipts</span>
                    </span>
                    <span className="adm-num text-[13.5px] font-medium text-adm-fg">{fmtLKR(v.netSales)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </AdminCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <AdminCard id="platform-health" title="Platform health" description={health ? `Checked ${timeAgo(health.checkedAt)}` : 'Measuring…'} icon={<Activity size={17} />}>
          {!health ? (
            <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
          ) : (
            <dl className="divide-y divide-[var(--adm-border)] text-[13.5px]">
              <HealthRow icon={Database} label="Database">
                <StatusDot tone={health.database.ok ? 'success' : 'danger'} className="mr-1.5" />
                {health.database.ok ? `${health.database.latencyMs} ms round trip` : 'Unreachable'}
              </HealthRow>
              <HealthRow icon={Store} label={`Active in last ${health.vendors.windowMinutes} min`}>
                {health.vendors.activeNow} of {health.vendors.active} vendors
              </HealthRow>
              <HealthRow icon={Clock} label="Open POS shifts">{fmtNumber(health.openShifts)}</HealthRow>
              {health.realtime && (
                <HealthRow icon={Activity} label="Realtime connections">
                  {fmtNumber(health.realtime.connections)} · {health.realtime.tenants} vendors
                </HealthRow>
              )}
              <HealthRow icon={Bug} label="Unresolved errors, 24h">
                <Link href="/sys-control/error-logs" className={cn('font-medium hover:underline', health.errors24h > 0 ? 'text-adm-danger' : 'text-adm-fg')}>
                  {fmtNumber(health.errors24h)}
                </Link>
              </HealthRow>
              <HealthRow label="App">
                v{health.appVersion} · up {formatUptime(health.uptimeSeconds)} · {health.memoryMb} MB
              </HealthRow>
            </dl>
          )}
        </AdminCard>

        <AdminCard title="Needs attention" icon={<AlertTriangle size={17} />} flush>
          {statsLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <AttentionList stats={stats} sales={sales} />
          )}
        </AdminCard>

        <AdminCard
          title="Recent admin activity"
          icon={<History size={17} />}
          flush
          className="lg:col-span-2 xl:col-span-1"
          footer={
            <Link href="/sys-control/audit-logs" className="inline-flex items-center gap-1 text-[13px] font-medium text-adm-primary hover:underline">
              Audit log <ArrowRight size={14} aria-hidden />
            </Link>
          }
        >
          {audit === null ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : audit.length === 0 ? (
            <EmptyState compact icon={History} title="No admin actions in the last 30 days" />
          ) : (
            <ul className="divide-y divide-[var(--adm-border)]">
              {audit.map((log) => (
                <li key={log.id} className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] text-adm-fg">
                      <span className="capitalize">{log.action.replace(/_/g, ' ')}</span> {log.resource.replace(/_/g, ' ')}
                    </span>
                    <span className="block truncate text-[12px] text-adm-subtle">{log.account?.email || 'System'}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-adm-subtle">{timeAgo(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <AdminCard title="Newest vendors" icon={<Store size={17} />} flush>
          {statsLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (stats?.recentCompanies ?? []).length === 0 ? (
            <EmptyState compact icon={Store} title="No vendors yet" action={<LinkButton href="/sys-control/vendors/create" size="sm" variant="primary" icon={Plus}>Add the first vendor</LinkButton>} />
          ) : (
            <ul className="divide-y divide-[var(--adm-border)]">
              {stats!.recentCompanies.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`/sys-control/vendors/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-adm-surface-2 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-adm-fg">{c.name}</span>
                      <span className="block truncate text-[12px] text-adm-subtle">{businessTypeLabel(c.businessType)} · /c/{c.slug}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-adm-subtle">{timeAgo(c.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        <AdminCard title="Newest accounts" description={ov ? `${ov.newSignupsThisWeek} signed up this week · ${fmtNumber(ov.totalAccounts)} total` : undefined} icon={<Users size={17} />} flush>
          {statsLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (stats?.recentSignups ?? []).length === 0 ? (
            <EmptyState compact icon={Users} title="No accounts yet" />
          ) : (
            <ul className="divide-y divide-[var(--adm-border)]">
              {stats!.recentSignups.slice(0, 5).map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-adm-fg">{u.fullName || u.email}</span>
                    <span className="block truncate text-[12px] text-adm-subtle">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-adm-subtle">{timeAgo(u.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ helpers */

function HealthRow({ icon: Icon, label, children }: { icon?: typeof Activity; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex min-w-0 items-center gap-2 text-adm-muted">
        {Icon && <Icon size={15} aria-hidden className="shrink-0" />}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="adm-num flex items-center text-right text-adm-fg">{children}</dd>
    </div>
  )
}

function AttentionList({ stats, sales }: { stats: StatsResponse | null; sales: SalesAnalytics | null }) {
  const items: Array<{ key: string; title: string; detail: string; href: string; tone: 'warning' | 'danger' | 'info' }> = []
  const pending = stats?.overview.pendingPayments ?? 0
  if (pending > 0) items.push({ key: 'slips', title: `${pending} payment slip${pending === 1 ? '' : 's'} to review`, detail: 'Approve or reject bank transfers', href: '/sys-control/payments', tone: 'warning' })
  for (const t of (stats?.expiringTrials ?? []).slice(0, 4)) {
    items.push({
      key: `trial-${t.id}`,
      title: `${t.tenant?.name ?? 'A vendor'}’s trial ends ${t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString('en-LK', { day: 'numeric', month: 'short' }) : 'soon'}`,
      detail: t.billingAccount?.email ?? 'Trial expiring within 7 days',
      href: '/sys-control/subscriptions',
      tone: 'info',
    })
  }
  const locked = stats?.subscriptionsByStatus?.locked ?? 0
  if (locked > 0) items.push({ key: 'locked', title: `${locked} vendor${locked === 1 ? '' : 's'} locked for non-payment`, detail: 'Review their subscriptions', href: '/sys-control/subscriptions', tone: 'danger' })
  const voids = sales?.totals.voids ?? 0
  if (voids > 0) items.push({ key: 'voids', title: `${voids} voided receipt${voids === 1 ? '' : 's'} in this range`, detail: 'See live sales for details', href: '/sys-control/sales-wall', tone: 'warning' })

  if (items.length === 0) {
    return <EmptyState compact icon={FileCheck} title="All clear" description="No pending slips, expiring trials or locked vendors." />
  }
  return (
    <ul className="divide-y divide-[var(--adm-border)]">
      {items.map((it) => (
        <li key={it.key}>
          <Link href={it.href} className="flex items-start gap-3 px-4 py-2.5 hover:bg-adm-surface-2 sm:px-5">
            <StatusDot tone={it.tone} className="mt-1.5" />
            <span className="min-w-0">
              <span className="block text-[13.5px] text-adm-fg">{it.title}</span>
              <span className="block truncate text-[12px] text-adm-subtle">{it.detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

interface SeriesPoint { key: string; label: string; short: string; value: number; receipts: number }

function buildSeries(range: RangeKey, sales: SalesAnalytics | null, hourly: Array<{ hour: string; netSales: number; receipts: number }>) {
  const points: SeriesPoint[] = []
  if (range === 'today') {
    const byHour = new Map<number, { netSales: number; receipts: number }>()
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    for (const h of hourly) {
      const t = new Date(h.hour)
      if (t.getTime() >= start.getTime()) byHour.set(t.getHours(), h)
    }
    const nowHour = new Date().getHours()
    for (let h = 0; h <= Math.max(nowHour, 0); h++) {
      const v = byHour.get(h)
      const label = `${String(h).padStart(2, '0')}:00`
      points.push({ key: label, label, short: h % 3 === 0 ? String(h).padStart(2, '0') : '', value: v?.netSales ?? 0, receipts: v?.receipts ?? 0 })
    }
  } else {
    const days = range === '7d' ? 7 : 30
    const map = new Map((sales?.byDay ?? []).map((d) => [d.date, d]))
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = localDateKey(d)
      const v = map.get(key)
      const label = d.toLocaleDateString('en-LK', { day: 'numeric', month: 'short' })
      const step = days > 10 ? 5 : 1
      points.push({ key, label, short: (days - 1 - i) % step === 0 ? label : '', value: v?.netSales ?? 0, receipts: v?.receipts ?? 0 })
    }
  }
  const total = points.reduce((s, p) => s + Math.abs(p.value), 0)
  const peak = points.reduce<SeriesPoint | null>((a, p) => (p.value > 0 && (!a || p.value > a.value) ? p : a), null)
  return { points, total, peak }
}

function SalesBars({ points }: { points: SeriesPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.value))
  return (
    <div>
      <div className="flex items-end gap-[3px] sm:gap-1" style={{ height: 200 }} role="img" aria-label="Net sales chart">
        {points.map((p, i) => (
          <div key={p.key} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className={cn('w-full rounded-t-[3px] transition-colors', p.value > 0 ? 'bg-adm-primary/80 group-hover:bg-adm-primary' : 'bg-adm-surface-3')}
              style={{ height: `${p.value > 0 ? Math.max(3, (p.value / max) * 100) : 1.5}%` }}
            />
            <div
              className={cn(
                'pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md border border-adm-border bg-adm-surface px-2 py-1 text-[12px] text-adm-fg shadow-[var(--adm-shadow-lg)] group-hover:block',
                i < points.length / 3 ? 'left-0' : i > (points.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              )}
            >
              <b className="font-medium">{p.label}</b> · LKR {fmtCompact(p.value)} · {p.receipts} receipts
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] overflow-hidden sm:gap-1" aria-hidden>
        {points.map((p) => (
          <div key={p.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-[11px] text-adm-subtle">
            {p.short}
          </div>
        ))}
      </div>
    </div>
  )
}

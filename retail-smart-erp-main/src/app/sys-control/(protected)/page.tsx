'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Store,
  DollarSign,
  TrendingUp,
  Cpu,
  FileCheck,
  AlertOctagon,
  CheckCircle2,
  Radio,
  Layers,
  ArrowUpRight,
  ShieldAlert,
  Terminal,
  Activity,
  Zap,
  Globe,
  Server,
  Loader2,
  RotateCcw,
  Users,
  Clock,
} from 'lucide-react'

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
  topBranches: Array<{ tenantId: string; tenantName: string; warehouseId: string | null; warehouseName: string; netSales: number; receipts: number }>
  openShifts: { count: number; byVendor: Array<{ tenantId: string; name: string; count: number }> }
}

interface LiveHourly {
  hourly: Array<{ hour: string; netSales: number; receipts: number }>
}

interface AuditLogRow {
  id: string
  action: string
  resource: string
  resourceId: string | null
  details: Record<string, unknown> | null
  createdAt: string
  account?: { email: string; fullName: string } | null
}

const STATS_POLL_MS = 60_000
const SALES_POLL_MS = 60_000

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  retail: 'Retail',
  restaurant: 'Restaurant / F&B',
  supermarket: 'Supermarket',
  auto_service: 'Auto Service',
  dealership: 'Dealership',
}

const TYPE_COLORS = ['#6bd8cb', '#4fdbc8', '#29a195', '#04b4a2', '#1f7a72']

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [sales, setSales] = useState<SalesAnalytics | null>(null)
  const [hourly, setHourly] = useState<LiveHourly['hourly']>([])
  const [audit, setAudit] = useState<AuditLogRow[]>([])
  const [range, setRange] = useState<RangeKey>('today')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const [statsRes, auditRes] = await Promise.all([
        fetch('/api/sys-control/stats', { cache: 'no-store' }),
        fetch('/api/sys-control/audit-logs?days=30&limit=6', { cache: 'no-store' }),
      ])
      if (statsRes.status === 401) {
        window.location.href = '/sys-control/login'
        return
      }
      if (!statsRes.ok) throw new Error('Failed to load platform stats')
      setStats(await statsRes.json())
      if (auditRes.ok) {
        const rows = await auditRes.json()
        setAudit(Array.isArray(rows) ? rows : [])
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform stats')
    }
  }, [])

  const loadSales = useCallback(async (r: RangeKey) => {
    try {
      const [salesRes, liveRes] = await Promise.all([
        fetch(`/api/sys-control/analytics/sales?range=${r}`, { cache: 'no-store' }),
        r === 'today' ? fetch('/api/sys-control/analytics/live', { cache: 'no-store' }) : Promise.resolve(null),
      ])
      if (salesRes.status === 401) {
        window.location.href = '/sys-control/login'
        return
      }
      if (!salesRes.ok) throw new Error('Failed to load sales analytics')
      setSales(await salesRes.json())
      if (liveRes && liveRes.ok) {
        const live: LiveHourly = await liveRes.json()
        setHourly(live.hourly || [])
      }
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales analytics')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadStats(), loadSales(range)]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    const statsTimer = setInterval(loadStats, STATS_POLL_MS)
    const salesTimer = setInterval(() => loadSales(range), SALES_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(statsTimer)
      clearInterval(salesTimer)
    }
  }, [loadStats, loadSales, range])

  const overview = stats?.overview
  const lockedTenants = stats?.subscriptionsByStatus?.locked ?? 0
  const activeTenants = overview?.activeSubscriptions ?? 0
  const trialTenants = overview?.trialSubscriptions ?? 0

  // Chart series: hourly (today) or daily (7d/30d)
  const chartSeries: Array<{ label: string; value: number; receipts: number }> =
    range === 'today'
      ? (() => {
          const todayStart = new Date()
          todayStart.setHours(0, 0, 0, 0)
          return hourly
            .filter((h) => Date.parse(h.hour) >= todayStart.getTime())
            .map((h) => ({
              label: new Date(h.hour).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', hour12: false }),
              value: h.netSales,
              receipts: h.receipts,
            }))
        })()
      : (sales?.byDay || []).map((d) => ({
          label: d.date.slice(5),
          value: d.netSales,
          receipts: d.receipts,
        }))
  const chartMax = Math.max(1, ...chartSeries.map((s) => s.value))
  const peak = chartSeries.reduce<{ label: string; value: number } | null>(
    (acc, s) => (!acc || s.value > acc.value ? { label: s.label, value: s.value } : acc),
    null
  )

  const typeTotal = (sales?.byBusinessType || []).reduce((s, t) => s + t.netSales, 0)
  const rangeLabel = range === 'today' ? 'TODAY' : range === '7d' ? 'LAST 7 DAYS' : 'LAST 30 DAYS'

  if (loading) {
    return (
      <div className="py-24 text-center text-[#bcc9c6] space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#6bd8cb]" />
        <div className="font-mono text-xs">Loading platform telemetry...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Level Command Ticker */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 px-4 py-2.5 bg-[#131b2e] border border-[#2d3449] rounded-xl shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#6bd8cb]/10 text-[#6bd8cb] font-mono text-xs border border-[#6bd8cb]/20 font-semibold">
            <span className="w-2 h-2 rounded-full bg-[#6bd8cb] animate-pulse"></span>
            <span>PLATFORM OVERVIEW</span>
          </div>
          <span className="text-[#3d4947] hidden sm:inline">•</span>
          <div className="text-xs text-[#bcc9c6] flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-[#4fdbc8]" />
            <span>{overview?.totalCompanies ?? 0} companies</span>
            <span className="font-mono text-[#4fdbc8] font-bold">[{overview?.totalAccounts ?? 0} accounts]</span>
          </div>
          <span className="text-[#3d4947] hidden sm:inline">•</span>
          <div className="font-mono text-xs text-[#bcc9c6]">
            UPDATED:{' '}
            <span className="text-white font-semibold">
              {lastUpdated ? lastUpdated.toLocaleTimeString('en-LK', { hour12: false }) : '—'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto">
          <button
            type="button"
            onClick={() => {
              loadStats()
              loadSales(range)
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-[#bcc9c6] text-xs font-semibold transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <Link
            href="/sys-control/messages"
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#222a3d] hover:bg-[#2d3449] border border-[#3d4947] text-[#6bd8cb] text-xs font-semibold transition-colors"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Broadcast</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-[#93000a]/30 border border-[#ff5451]/50 rounded-xl text-xs text-[#ffdad6] flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-[#ffb4ab]" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Vendors */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#6bd8cb]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold">
                REGISTERED VENDORS
              </div>
              <div className="text-2xl font-bold text-white mt-1 flex items-baseline gap-2">
                {overview?.totalCompanies ?? 0}
                <span className="font-mono text-xs text-[#4fdbc8] font-semibold">
                  +{overview?.newCompaniesThisWeek ?? 0} this week
                </span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#171f33] border border-[#2d3449] flex items-center justify-center text-[#6bd8cb]">
              <Store className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-[#4fdbc8] font-semibold">{activeTenants} Live</span>
            <span className="text-[#bcc9c6]">{trialTenants} Trial</span>
            <span className="text-[#ff5451] font-semibold">{lockedTenants} Locked</span>
          </div>
        </div>

        {/* 2. Platform GMV */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#4fdbc8]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold">
                NET SALES {rangeLabel}
              </div>
              <div className="text-2xl font-bold text-[#4fdbc8] mt-1 truncate">
                <span className="font-mono text-sm text-[#879391] font-normal">LKR </span>
                {fmtMoney(sales?.totals.netSales ?? 0)}
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#171f33] border border-[#2d3449] flex items-center justify-center text-[#4fdbc8]">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-[#bcc9c6]">{(sales?.totals.receipts ?? 0).toLocaleString()} Receipts</span>
            <span className="text-[#4fdbc8] font-bold">LKR {fmtMoney(sales?.totals.avgBasket ?? 0)} avg</span>
          </div>
        </div>

        {/* 3. Subscription revenue */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#6bd8cb]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold">
                SUBSCRIPTION REVENUE (MONTH)
              </div>
              <div className="text-2xl font-bold text-white mt-1 truncate">
                <span className="font-mono text-sm text-[#879391] font-normal">LKR </span>
                {fmtMoney(overview?.monthlyRevenue ?? 0)}
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#171f33] border border-[#2d3449] flex items-center justify-center text-[#6bd8cb]">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-[#bcc9c6]">Lifetime: LKR {fmtCompact(overview?.totalRevenue ?? 0)}</span>
            <span className="text-[#6bd8cb] font-bold">{activeTenants} paying</span>
          </div>
        </div>

        {/* 4. Open shifts */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#4fdbc8]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold">
                OPEN POS SHIFTS
              </div>
              <div className="text-2xl font-bold text-white mt-1">
                {sales?.openShifts.count ?? 0}{' '}
                <span className="font-mono text-xs text-[#879391] font-normal">
                  across {sales?.openShifts.byVendor.length ?? 0} vendors
                </span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#171f33] border border-[#2d3449] flex items-center justify-center text-[#4fdbc8]">
              <Cpu className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-[#bcc9c6] truncate max-w-[150px]">
              {sales?.openShifts.byVendor[0]?.name || 'No open shifts'}
            </span>
            <span className="text-[#4fdbc8] font-bold">{sales?.openShifts.byVendor[0]?.count ?? 0} tills</span>
          </div>
        </div>

        {/* 5. Bank slips */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#ffb3ad]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#ffdad7] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff5451] animate-pulse"></span>
                MANUAL BANK SLIPS
              </div>
              <div className="text-2xl font-bold text-[#ffdad7] mt-1">
                {overview?.pendingPayments ?? 0} Slips{' '}
                <span className="font-mono text-xs text-[#bcc9c6] font-normal">Pending</span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#171f33] border border-[#2d3449] flex items-center justify-center text-[#ffdad7]">
              <FileCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-white font-semibold">Awaiting verification</span>
            <Link href="/sys-control/payments" className="text-[#6bd8cb] hover:underline font-bold">
              Verify →
            </Link>
          </div>
        </div>

        {/* 6. Voids / returns */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#ff5451]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#ff5451] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <AlertOctagon className="w-3.5 h-3.5 text-[#ff5451]" />
                VOIDS &amp; RETURNS {rangeLabel}
              </div>
              <div className="text-2xl font-bold text-[#ff5451] mt-1">
                {sales?.totals.voids ?? 0} Voids
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#93000a]/20 border border-[#ff5451]/40 flex items-center justify-center text-[#ff5451]">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-[#ffb4ab] truncate max-w-[150px]">
              Returns: LKR {fmtCompact(sales?.totals.returns ?? 0)}
            </span>
            <Link href="/sys-control/error-logs" className="text-[#ff5451] hover:underline font-semibold">
              Errors →
            </Link>
          </div>
        </div>

        {/* 7. New signups */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#6bd8cb]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold">
                NEW SIGNUPS (7D)
              </div>
              <div className="text-2xl font-bold text-white mt-1 flex items-baseline gap-2">
                {overview?.newSignupsThisWeek ?? 0}
                <span className="font-mono text-xs text-[#4fdbc8] font-semibold">accounts</span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#171f33] border border-[#2d3449] flex items-center justify-center text-[#6bd8cb]">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-[#bcc9c6] truncate max-w-[160px]">
              {stats?.recentSignups[0]?.email || 'No signups yet'}
            </span>
            <Link href="/sys-control/users" className="text-[#4fdbc8] hover:underline font-bold">
              Users →
            </Link>
          </div>
        </div>

        {/* 8. Expiring trials */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#4fdbc8]/50 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold">
                TRIALS EXPIRING (7D)
              </div>
              <div className="text-2xl font-bold text-[#4fdbc8] mt-1">
                {stats?.expiringTrials.length ?? 0}
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#171f33] border border-[#2d3449] flex items-center justify-center text-[#4fdbc8]">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-[#2d3449]/40 flex items-center justify-between font-mono text-[11px] bg-[#060e20]/60 px-2.5 py-1 rounded-lg">
            <span className="text-[#bcc9c6] truncate max-w-[150px]">
              {stats?.expiringTrials[0]?.tenant?.name || 'None expiring'}
            </span>
            <Link href="/sys-control/subscriptions" className="text-[#6bd8cb] hover:underline font-semibold">
              Manage →
            </Link>
          </div>
        </div>
      </div>

      {/* Sales Chart & Mix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 bg-[#131b2e] border border-[#2d3449] p-6 rounded-xl shadow-md flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-3 border-b border-[#2d3449]/50">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#6bd8cb]"></span>
                <h3 className="font-bold text-base text-white">Net Sales Performance</h3>
              </div>
              <p className="text-xs text-[#bcc9c6] mt-0.5">
                Aggregated non-void sales across all tenants (returns subtracted)
              </p>
            </div>
            <div className="flex items-center gap-1 bg-[#060e20] p-1 rounded-lg font-mono text-xs">
              {(['today', '7d', '30d'] as RangeKey[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 rounded-md ${
                    range === r ? 'bg-[#29a195] text-[#00302b] font-bold' : 'text-[#bcc9c6] hover:text-white'
                  }`}
                >
                  {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : '30 Days'}
                </button>
              ))}
            </div>
          </div>

          {/* Business type legend */}
          <div className="flex items-center gap-4 py-3 font-mono text-xs text-[#bcc9c6] flex-wrap">
            {(sales?.byBusinessType || []).map((t, i) => (
              <div key={t.businessType} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: TYPE_COLORS[i % TYPE_COLORS.length] }}></span>
                <span>
                  {BUSINESS_TYPE_LABELS[t.businessType] || t.businessType} (
                  {typeTotal > 0 ? Math.round((t.netSales / typeTotal) * 100) : 0}%)
                </span>
              </div>
            ))}
            {(sales?.byBusinessType || []).length === 0 && <span>No sales recorded in this range.</span>}
          </div>

          {/* Bar Chart */}
          <div className="flex-1 min-h-[220px] flex items-end justify-between gap-1.5 pt-6 pb-2 px-2 overflow-x-auto">
            {chartSeries.length === 0 ? (
              <div className="w-full text-center text-xs text-[#879391] font-mono py-12">No data for this range</div>
            ) : (
              chartSeries.map((item, idx) => {
                const isPeak = peak && item.value === peak.value && item.value > 0
                return (
                  <div key={idx} className="flex-1 min-w-[22px] flex flex-col items-center gap-2 group">
                    <div className="font-mono text-[10px] text-[#4fdbc8] opacity-0 group-hover:opacity-100 transition-opacity font-bold whitespace-nowrap">
                      {fmtCompact(item.value)}
                    </div>
                    <div className="w-full max-w-[42px] bg-[#060e20] h-40 rounded-t-lg flex items-end overflow-hidden p-0.5">
                      <div
                        className={`w-full rounded-t-sm transition-all duration-500 ${
                          isPeak
                            ? 'bg-gradient-to-t from-[#04b4a2] to-[#6bd8cb] shadow-lg shadow-[#6bd8cb]/20'
                            : 'bg-gradient-to-t from-[#171f33] to-[#29a195] group-hover:to-[#4fdbc8]'
                        }`}
                        style={{ height: `${Math.max(2, (item.value / chartMax) * 100)}%` }}
                      ></div>
                    </div>
                    <div className="font-mono text-[10px] text-[#879391] group-hover:text-white transition-colors whitespace-nowrap">
                      {item.label}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-[#2d3449]/40 flex items-center justify-between text-xs text-[#bcc9c6]">
            <span className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-[#4fdbc8]" />
              Peak:{' '}
              <strong className="text-white">
                {peak && peak.value > 0 ? `LKR ${fmtCompact(peak.value)} at ${peak.label}` : '—'}
              </strong>
            </span>
            <Link href="/sys-control/sales-wall" className="text-[#6bd8cb] hover:underline font-semibold flex items-center gap-1">
              Open Live Sales Wall <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Right: Top vendors & tenant mix */}
        <div className="xl:col-span-4 bg-[#131b2e] border border-[#2d3449] p-6 rounded-xl shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/50 mb-4">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-[#6bd8cb]" />
                <h3 className="font-bold text-base text-white">Top Vendors {rangeLabel}</h3>
              </div>
              <span className="font-mono text-[11px] bg-[#4fdbc8]/15 text-[#4fdbc8] px-2 py-0.5 rounded font-bold border border-[#4fdbc8]/30">
                NET
              </span>
            </div>

            <div className="space-y-2.5">
              {(sales?.topVendors || []).slice(0, 5).map((v) => (
                <Link
                  key={v.tenantId}
                  href={`/sys-control/vendors/${v.tenantId}`}
                  className="bg-[#060e20] border border-[#2d3449]/60 p-3 rounded-lg flex items-center justify-between hover:border-[#6bd8cb]/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{v.name}</div>
                    <div className="font-mono text-[10px] text-[#879391]">{v.slug} • {v.receipts} receipts</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-[11px] text-[#4fdbc8] font-bold">LKR {fmtCompact(v.netSales)}</div>
                  </div>
                </Link>
              ))}
              {(sales?.topVendors || []).length === 0 && (
                <div className="text-xs text-[#879391] font-mono text-center py-6">No sales in this range</div>
              )}
            </div>

            <div className="mt-5 pt-3 border-t border-[#2d3449]/50">
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider mb-2">Tenants by type</div>
              <div className="space-y-1.5 font-mono text-[11px]">
                {Object.entries(stats?.tenantsByType || {}).map(([type, count]) => (
                  <div key={type} className="flex justify-between text-[#bcc9c6]">
                    <span>{BUSINESS_TYPE_LABELS[type] || type}</span>
                    <span className="text-white font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#2d3449]/50 mt-4">
            <Link
              href="/sys-control/vendors"
              className="w-full py-2.5 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Store className="w-3.5 h-3.5 text-[#6bd8cb]" />
              <span>Open Vendor Registry</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Audit Log Stream & Quick Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#131b2e] border border-[#2d3449] p-6 rounded-xl shadow-md">
          <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/50 mb-4">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#6bd8cb]" />
              <h3 className="font-bold text-base text-white">Privileged Audit Log Stream</h3>
            </div>
            <Link href="/sys-control/audit-logs" className="font-mono text-xs text-[#6bd8cb] hover:underline">
              View Full Audit Log →
            </Link>
          </div>

          <div className="space-y-2.5">
            {audit.length === 0 && (
              <div className="text-xs text-[#879391] font-mono text-center py-6">No recent admin activity</div>
            )}
            {audit.map((log) => {
              const danger = log.action === 'delete' || log.action === 'reject'
              return (
                <div
                  key={log.id}
                  className="p-3 bg-[#060e20] border border-[#2d3449]/50 rounded-lg flex items-center justify-between font-mono text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${danger ? 'bg-[#ff5451]' : 'bg-[#4fdbc8]'}`}></span>
                    <div className="min-w-0">
                      <div className={`font-semibold uppercase truncate ${danger ? 'text-[#ffdad7]' : 'text-white'}`}>
                        {log.action}_{log.resource}
                      </div>
                      <div className="text-[10px] text-[#879391] truncate">
                        {log.account?.email || 'system'}
                        {log.resourceId ? ` • ${log.resourceId.slice(0, 8)}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className="text-[#bcc9c6] text-[11px] shrink-0">{timeAgo(log.createdAt)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#131b2e] border border-[#2d3449] p-6 rounded-xl shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/50 mb-4">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#4fdbc8]" />
                <h3 className="font-bold text-base text-white">Platform Operations</h3>
              </div>
              <span className="font-mono text-[10px] bg-[#222a3d] text-[#bcc9c6] px-2 py-0.5 rounded">ROOT</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link href="/sys-control/vendors/create" className="p-3 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-left transition-colors group">
                <div className="w-7 h-7 rounded bg-[#29a195]/20 text-[#6bd8cb] flex items-center justify-center mb-2">
                  <Store className="w-4 h-4" />
                </div>
                <div className="font-bold text-xs text-white group-hover:text-[#6bd8cb]">+ Provision Tenant</div>
                <div className="text-[10px] text-[#879391] mt-0.5">Create vendor &amp; owner</div>
              </Link>

              <Link href="/sys-control/sales-wall" className="p-3 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-left transition-colors group">
                <div className="w-7 h-7 rounded bg-[#04b4a2]/20 text-[#4fdbc8] flex items-center justify-center mb-2">
                  <Radio className="w-4 h-4" />
                </div>
                <div className="font-bold text-xs text-white group-hover:text-[#4fdbc8]">Live Sales Wall</div>
                <div className="text-[10px] text-[#879391] mt-0.5">Realtime receipts</div>
              </Link>

              <Link href="/sys-control/pricing" className="p-3 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-left transition-colors group">
                <div className="w-7 h-7 rounded bg-[#222a3d] text-[#bcc9c6] flex items-center justify-center mb-2">
                  <Layers className="w-4 h-4" />
                </div>
                <div className="font-bold text-xs text-white group-hover:text-[#6bd8cb]">Pricing Tiers</div>
                <div className="text-[10px] text-[#879391] mt-0.5">Plans &amp; limits</div>
              </Link>

              <Link href="/sys-control/payments" className="p-3 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-left transition-colors group">
                <div className="w-7 h-7 rounded bg-[#ff5451]/20 text-[#ffb4ab] flex items-center justify-center mb-2">
                  <FileCheck className="w-4 h-4" />
                </div>
                <div className="font-bold text-xs text-white group-hover:text-[#ffdad7]">Verify Slips</div>
                <div className="text-[10px] text-[#ff5451] font-semibold mt-0.5">
                  {overview?.pendingPayments ?? 0} Pending
                </div>
              </Link>
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-[#2d3449]/40 flex items-center justify-between text-xs text-[#879391]">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#4fdbc8]" />
              Stats refresh every 60s
            </span>
            <span className="font-mono text-[11px] text-[#4fdbc8]">
              {stats?.recentCompanies[0] ? `Latest: ${stats.recentCompanies[0].name}` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

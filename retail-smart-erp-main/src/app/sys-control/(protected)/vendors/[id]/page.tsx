'use client'

import { useState, useEffect, use, useCallback } from 'react'
import Link from 'next/link'
import {
  Store,
  Building2,
  ShieldCheck,
  Lock,
  Loader2,
  CheckCircle2,
  Zap,
  Globe,
  Cpu,
  ArrowLeft,
  TrendingUp,
  Users,
  AlertOctagon,
  Receipt,
} from 'lucide-react'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  type FeatureFlag,
  type FeatureFlagsMap,
} from '@/lib/features/flags'

interface VendorBranch {
  id: string
  name: string
  code?: string | null
  address?: string | null
  isDefault?: boolean
  isActive?: boolean
}

interface VendorCounter {
  id: string
  name: string
  code?: string | null
  status?: string
  warehouseId?: string | null
}

interface VendorSubscription {
  status: string
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  trialEndsAt?: string | null
  billingCycle?: string | null
  lastPaymentAt?: string | null
  subscribedPriceMonthly?: string | null
  subscribedPriceYearly?: string | null
  tier?: { id: string; name: string; priceMonthly?: string | null; priceYearly?: string | null } | null
}

interface VendorData {
  id: string
  name: string
  slug: string
  email: string
  phone?: string | null
  address?: string | null
  businessType: string
  status: string
  plan?: string | null
  currency: string
  country?: string
  createdAt?: string
  setupCompletedAt?: string | null
  userCount?: number
  branches?: VendorBranch[]
  counters?: VendorCounter[]
  featureFlags?: FeatureFlagsMap
  settings?: Record<string, unknown> | null
  subscription?: VendorSubscription | null
}

interface RangeTotals {
  netSales: number
  grossSales: number
  returns: number
  receipts: number
  avgBasket: number
}

interface VendorAnalytics {
  totals: { today: RangeTotals; '7d': RangeTotals; '30d': RangeTotals }
  byBranch: Array<{ warehouseId: string | null; name: string; netSales: number; receipts: number }>
  byCounter: Array<{ posProfileId: string | null; name: string; netSales: number; receipts: number }>
  byCashier: Array<{ userId: string | null; name: string; netSales: number; receipts: number; variance: number }>
  openShifts: Array<{ id: string; entryNumber: string; cashierName: string; counterName: string; warehouseName: string; openingTime: string }>
}

interface AuditLogRow {
  id: string
  action: string
  resource: string
  resourceId: string | null
  details: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
  account?: { email: string; fullName: string } | null
}

interface Vendor360Props {
  params: Promise<{ id: string }>
}

type TabId = 'sales' | 'branches' | 'flags' | 'billing' | 'audit'

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-LK', { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-LK', { hour12: false })
}

export default function Vendor360DossierPage({ params }: Vendor360Props) {
  const resolvedParams = use(params)
  const vendorId = resolvedParams.id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [vendorData, setVendorData] = useState<VendorData | null>(null)
  const [analytics, setAnalytics] = useState<VendorAnalytics | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[] | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('sales')
  const [flags, setFlags] = useState<FeatureFlagsMap>({} as FeatureFlagsMap)
  const [savingFlags, setSavingFlags] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [status, setStatus] = useState('active')
  const [statusBusy, setStatusBusy] = useState(false)

  const loadVendor = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/sys-control/vendors/${vendorId}`, { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = '/sys-control/login'
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(data.error || 'Failed to load vendor')
        return
      }
      setVendorData(data.vendor)
      setFlags(data.vendor.featureFlags || {})
      setStatus(data.vendor.status || 'active')
    } catch {
      setLoadError('Network error while loading vendor')
    } finally {
      setLoading(false)
    }
  }, [vendorId])

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const res = await fetch(`/api/sys-control/analytics/vendors/${vendorId}`, { cache: 'no-store' })
      if (res.ok) {
        setAnalytics(await res.json())
      }
    } catch {
      // keep previous analytics
    } finally {
      setAnalyticsLoading(false)
    }
  }, [vendorId])

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch('/api/sys-control/audit-logs?days=90&limit=500', { cache: 'no-store' })
      if (res.ok) {
        const rows: AuditLogRow[] = await res.json()
        setAuditLogs(
          (Array.isArray(rows) ? rows : []).filter(
            (r) =>
              r.resourceId === vendorId ||
              (r.details && (r.details as { tenantIds?: string[] }).tenantIds?.includes(vendorId))
          )
        )
      } else {
        setAuditLogs([])
      }
    } catch {
      setAuditLogs([])
    }
  }, [vendorId])

  useEffect(() => {
    loadVendor()
    loadAnalytics()
  }, [loadVendor, loadAnalytics])

  useEffect(() => {
    if (activeTab === 'audit' && auditLogs === null) loadAudit()
  }, [activeTab, auditLogs, loadAudit])

  const handleToggleFlag = (flag: FeatureFlag) => {
    setFlags((prev) => ({ ...prev, [flag]: !prev[flag] }))
  }

  const saveFlags = async () => {
    setSavingFlags(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/sys-control/vendors/${vendorId}/features`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureFlags: flags }),
      })
      if (res.ok) {
        const data = await res.json()
        setFlags(data.featureFlags || flags)
        setMessage('Feature flags updated.')
        setAuditLogs(null)
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.error || 'Failed to persist feature flag update.')
      }
    } catch {
      setMessage('Network error while saving flags.')
    } finally {
      setSavingFlags(false)
    }
  }

  const handleImpersonate = async () => {
    setMessage(null)
    try {
      const res = await fetch(`/api/sys-control/vendors/${vendorId}/impersonate`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.redirectUrl) {
        window.location.href = data.redirectUrl
      } else {
        setMessage(data.error || 'Impersonation failed.')
      }
    } catch {
      setMessage('Network error while starting impersonation.')
    }
  }

  const handleToggleStatus = async () => {
    const nextStatus = status === 'active' ? 'locked' : 'active'
    setStatusBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/sys-control/vendors/${vendorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setStatus(data.vendor?.status || nextStatus)
        setMessage(`Tenant status updated to: ${nextStatus.toUpperCase()}`)
        setAuditLogs(null)
      } else {
        setMessage(data.error || 'Failed to update tenant status.')
      }
    } catch {
      setMessage('Network error while updating status.')
    } finally {
      setStatusBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="py-24 text-center text-[#bcc9c6] space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#6bd8cb]" />
        <div className="font-mono text-xs">Loading Vendor 360° Dossier...</div>
      </div>
    )
  }

  if (loadError || !vendorData) {
    return (
      <div className="py-24 text-center space-y-4">
        <AlertOctagon className="w-10 h-10 mx-auto text-[#ff5451]" />
        <div className="text-sm text-[#ffdad6]">{loadError || 'Vendor not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={loadVendor}
            className="px-4 py-2 rounded-lg bg-[#222a3d] text-white text-xs font-semibold"
          >
            Retry
          </button>
          <Link href="/sys-control/vendors" className="px-4 py-2 rounded-lg bg-[#6bd8cb] text-[#003732] text-xs font-bold">
            Back to Vendors
          </Link>
        </div>
      </div>
    )
  }

  const settings = (vendorData.settings || {}) as Record<string, unknown>
  const tin = (settings.tin as string) || null
  const brn = (settings.brn as string) || null
  const sub = vendorData.subscription
  const currency = vendorData.currency || 'LKR'
  const t30 = analytics?.totals['30d']
  const tToday = analytics?.totals.today
  const t7 = analytics?.totals['7d']

  const monthlyFee = sub?.subscribedPriceMonthly ?? sub?.tier?.priceMonthly ?? null
  const daysRemaining = sub?.currentPeriodEnd
    ? Math.max(0, Math.ceil((Date.parse(sub.currentPeriodEnd) - Date.now()) / 86400000))
    : null

  return (
    <div className="space-y-6 pb-16">
      {/* Breadcrumb strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-1 font-mono text-xs">
        <div className="flex items-center gap-2 text-[#879391]">
          <Link href="/sys-control/vendors" className="hover:text-[#6bd8cb] flex items-center gap-1 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Vendors Directory</span>
          </Link>
          <span>/</span>
          <span className="capitalize">{vendorData.businessType.replace('_', ' ')}</span>
          <span>/</span>
          <span className="text-[#6bd8cb] font-semibold">{vendorData.slug}</span>
        </div>

        <div className="flex items-center gap-4 text-[#bcc9c6]">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#131b2e] border border-[#2d3449]">
            <span className="text-[#879391] text-[10px] uppercase">CREATED:</span>
            <span className="text-[#4fdbc8] font-bold">{fmtDate(vendorData.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#131b2e] border border-[#2d3449]">
            <span className="text-[#879391] text-[10px] uppercase">SETUP:</span>
            <span className={`font-bold ${vendorData.setupCompletedAt ? 'text-[#4fdbc8]' : 'text-[#ffb4ab]'}`}>
              {vendorData.setupCompletedAt ? 'COMPLETE' : 'PENDING'}
            </span>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 relative z-10">
          <div className="flex items-start gap-5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-xl bg-[#060e20] border border-[#2d3449] flex items-center justify-center text-[#6bd8cb] font-bold text-2xl shadow-inner">
                <Store className="w-8 h-8 text-[#6bd8cb]" />
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 bg-[#29a195] text-[#00302b] font-mono text-[9px] font-bold rounded shadow uppercase">
                {vendorData.plan || 'trial'}
              </span>
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-white tracking-tight truncate">{vendorData.name}</h1>
                <span className="px-2 py-0.5 rounded bg-[#29a195]/20 text-[#6bd8cb] font-mono text-xs font-semibold">
                  Slug: {vendorData.slug}
                </span>
                <span className="px-2 py-0.5 rounded bg-[#060e20] border border-[#2d3449] text-[#bcc9c6] font-mono text-[11px]">
                  ID: {vendorId.slice(0, 8)}
                </span>
                <div
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold ${
                    status === 'active'
                      ? 'bg-[#4fdbc8]/15 text-[#4fdbc8] border border-[#4fdbc8]/30'
                      : 'bg-[#ff5451]/20 text-[#ffb4ab] border border-[#ff5451]/40'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${status === 'active' ? 'bg-[#4fdbc8] animate-pulse' : 'bg-[#ff5451]'}`}></span>
                  <span className="uppercase">{status}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-[#bcc9c6] flex-wrap">
                <Link href={`/c/${vendorData.slug}/login`} className="flex items-center gap-1 text-[#6bd8cb] hover:underline">
                  <Globe className="w-3.5 h-3.5" />
                  <span>/c/{vendorData.slug}</span>
                </Link>
                <span className="text-[#3d4947]">•</span>
                <span className="text-white capitalize">{vendorData.businessType.replace('_', ' ')}</span>
                <span className="text-[#3d4947]">•</span>
                <span>{vendorData.email}</span>
                {vendorData.phone && (
                  <>
                    <span className="text-[#3d4947]">•</span>
                    <span>{vendorData.phone}</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1 flex-wrap text-xs font-mono">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#060e20] border border-[#2d3449] text-white">
                  <span className="text-[#879391] uppercase text-[10px]">TIN:</span>
                  <span className="text-[#6bd8cb] font-bold">{tin || 'Not set'}</span>
                  {tin && <ShieldCheck className="w-3.5 h-3.5 text-[#4fdbc8]" />}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#060e20] border border-[#2d3449] text-white">
                  <span className="text-[#879391] uppercase text-[10px]">BRN:</span>
                  <span className="text-[#4fdbc8] font-bold">{brn || 'Not set'}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#060e20] border border-[#2d3449] text-white">
                  <span className="text-[#879391] uppercase text-[10px]">Currency:</span>
                  <span className="text-[#bcc9c6]">{currency}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start xl:items-end gap-2 shrink-0">
            <button
              type="button"
              onClick={handleImpersonate}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff5451] hover:bg-[#ff897d] text-[#690005] font-bold text-xs uppercase tracking-wider shadow-lg transition-transform active:scale-95"
            >
              <Zap className="w-4 h-4" />
              <span>Impersonate Vendor</span>
            </button>
            <div className="font-mono text-[10px] text-[#ffb4ab] bg-[#93000a]/20 px-2.5 py-0.5 rounded border border-[#ff5451]/30">
              All actions recorded in admin_audit_logs
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                disabled={statusBusy}
                onClick={handleToggleStatus}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                  status === 'active'
                    ? 'bg-[#171f33] border-[#ff5451]/50 text-[#ffdad7] hover:bg-[#93000a]/30'
                    : 'bg-[#29a195] border-[#6bd8cb] text-[#003732] hover:bg-[#89f5e7]'
                }`}
              >
                {statusBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                <span>{status === 'active' ? 'Lock / Freeze Tenant' : 'Unlock Tenant'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="p-3 bg-[#222a3d] border border-[#3d4947] rounded-lg text-xs text-[#dae2fd] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#4fdbc8]" />
          <span>{message}</span>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>Net Sales 30D</span>
            <TrendingUp className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {analyticsLoading && !analytics ? '…' : `${currency} ${fmtMoney(t30?.netSales ?? 0)}`}
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#bcc9c6]">Daily Avg: {fmtMoney((t30?.netSales ?? 0) / 30)}</span>
            <span className="text-[#4fdbc8] font-bold">{t30?.receipts ?? 0} receipts</span>
          </div>
        </div>

        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>Outlets &amp; Tills</span>
            <Building2 className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {vendorData.branches?.length ?? 0} Branches • {vendorData.counters?.length ?? 0} Tills
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#4fdbc8]">{analytics?.openShifts.length ?? 0} shifts open</span>
            <span className="text-[#bcc9c6]">{vendorData.userCount ?? 0} users</span>
          </div>
        </div>

        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>Today</span>
            <Receipt className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {currency} {fmtMoney(tToday?.netSales ?? 0)}
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#bcc9c6]">{tToday?.receipts ?? 0} receipts</span>
            <span className="text-[#6bd8cb] font-bold">avg {fmtMoney(tToday?.avgBasket ?? 0)}</span>
          </div>
        </div>

        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>Subscription</span>
            <ShieldCheck className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="text-xl font-bold text-[#4fdbc8] font-mono uppercase">{sub?.status || 'NONE'}</div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#4fdbc8]">{sub?.tier?.name || vendorData.plan || 'trial'}</span>
            <span className="text-[#bcc9c6]">Ends {fmtDate(sub?.currentPeriodEnd || sub?.trialEndsAt)}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#2d3449] pb-1 font-mono text-xs overflow-x-auto">
        {(
          [
            { id: 'sales', label: 'Sales Analytics' },
            { id: 'branches', label: 'Terminals & Branches' },
            { id: 'flags', label: 'Feature Flags Matrix' },
            { id: 'billing', label: 'Billing & Commercials' },
            { id: 'audit', label: 'Audit Trail & Access' },
          ] as Array<{ id: TabId; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-t-lg font-semibold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[#131b2e] border-t border-x border-[#2d3449] text-[#6bd8cb]'
                : 'text-[#879391] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB: Sales Analytics */}
      {activeTab === 'sales' && (
        <div className="space-y-4">
          {analyticsLoading && !analytics ? (
            <div className="py-12 text-center text-[#bcc9c6] font-mono text-xs flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#6bd8cb]" />
              Loading sales analytics...
            </div>
          ) : !analytics ? (
            <div className="py-12 text-center text-[#ffb4ab] font-mono text-xs">
              Sales analytics unavailable.{' '}
              <button type="button" onClick={loadAnalytics} className="underline">
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
                {(
                  [
                    { key: 'today', label: 'Today', t: tToday },
                    { key: '7d', label: 'Last 7 Days', t: t7 },
                    { key: '30d', label: 'Last 30 Days', t: t30 },
                  ] as Array<{ key: string; label: string; t?: RangeTotals }>
                ).map(({ key, label, t }) => (
                  <div key={key} className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl space-y-2">
                    <div className="text-[#879391] uppercase text-[10px]">{label}</div>
                    <div className="text-xl font-bold text-white">
                      {currency} {fmtMoney(t?.netSales ?? 0)}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[11px] text-[#bcc9c6]">
                      <span>Gross: {fmtMoney(t?.grossSales ?? 0)}</span>
                      <span className="text-right">Returns: {fmtMoney(t?.returns ?? 0)}</span>
                      <span>Receipts: {t?.receipts ?? 0}</span>
                      <span className="text-right text-[#4fdbc8]">Avg: {fmtMoney(t?.avgBasket ?? 0)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* By Branch */}
                <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-4 shadow-sm">
                  <h4 className="font-bold text-sm text-white mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#6bd8cb]" />
                    By Branch (30D)
                  </h4>
                  <div className="space-y-2 font-mono text-xs">
                    {analytics.byBranch.length === 0 && <div className="text-[#879391]">No sales</div>}
                    {analytics.byBranch.map((b, i) => (
                      <div key={b.warehouseId ?? i} className="flex items-center justify-between p-2 bg-[#060e20] rounded-lg border border-[#2d3449]/50">
                        <div className="min-w-0">
                          <div className="text-white truncate">{b.name}</div>
                          <div className="text-[10px] text-[#879391]">{b.receipts} receipts</div>
                        </div>
                        <div className="text-[#6bd8cb] font-bold shrink-0">{fmtMoney(b.netSales)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Counter */}
                <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-4 shadow-sm">
                  <h4 className="font-bold text-sm text-white mb-3 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#4fdbc8]" />
                    By Counter (30D)
                  </h4>
                  <div className="space-y-2 font-mono text-xs">
                    {analytics.byCounter.length === 0 && <div className="text-[#879391]">No sales</div>}
                    {analytics.byCounter.map((c, i) => (
                      <div key={c.posProfileId ?? i} className="flex items-center justify-between p-2 bg-[#060e20] rounded-lg border border-[#2d3449]/50">
                        <div className="min-w-0">
                          <div className="text-white truncate">{c.name}</div>
                          <div className="text-[10px] text-[#879391]">{c.receipts} receipts</div>
                        </div>
                        <div className="text-[#6bd8cb] font-bold shrink-0">{fmtMoney(c.netSales)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Cashier */}
                <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-4 shadow-sm">
                  <h4 className="font-bold text-sm text-white mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#6bd8cb]" />
                    By Cashier (30D)
                  </h4>
                  <div className="space-y-2 font-mono text-xs">
                    {analytics.byCashier.length === 0 && <div className="text-[#879391]">No sales</div>}
                    {analytics.byCashier.map((c, i) => (
                      <div key={c.userId ?? i} className="flex items-center justify-between p-2 bg-[#060e20] rounded-lg border border-[#2d3449]/50">
                        <div className="min-w-0">
                          <div className="text-white truncate">{c.name}</div>
                          <div className="text-[10px] text-[#879391]">
                            {c.receipts} receipts • variance{' '}
                            <span className={c.variance < 0 ? 'text-[#ffb4ab]' : c.variance > 0 ? 'text-[#4fdbc8]' : ''}>
                              {c.variance >= 0 ? '+' : ''}
                              {c.variance.toFixed(2)}
                            </span>
                          </div>
                        </div>
                        <div className="text-[#6bd8cb] font-bold shrink-0">{fmtMoney(c.netSales)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Open shifts */}
              <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl overflow-hidden p-4 shadow-sm">
                <h4 className="font-bold text-sm text-white mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#4fdbc8]" />
                  Open Shifts ({analytics.openShifts.length})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead className="bg-[#060e20] text-[#879391] uppercase text-[10px] border-b border-[#2d3449]">
                      <tr>
                        <th className="px-3 py-2">Entry</th>
                        <th className="px-3 py-2">Cashier</th>
                        <th className="px-3 py-2">Counter</th>
                        <th className="px-3 py-2">Branch</th>
                        <th className="px-3 py-2 text-right">Opened</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2d3449]/40">
                      {analytics.openShifts.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-[#879391]">No open shifts</td>
                        </tr>
                      )}
                      {analytics.openShifts.map((s) => (
                        <tr key={s.id} className="hover:bg-[#171f33]">
                          <td className="px-3 py-2 text-[#4fdbc8] font-bold">{s.entryNumber}</td>
                          <td className="px-3 py-2 text-white">{s.cashierName}</td>
                          <td className="px-3 py-2 text-[#bcc9c6]">{s.counterName}</td>
                          <td className="px-3 py-2 text-[#bcc9c6]">{s.warehouseName}</td>
                          <td className="px-3 py-2 text-right text-[#879391]">{fmtDateTime(s.openingTime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB: Terminals & Branches */}
      {activeTab === 'branches' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(vendorData.branches || []).length === 0 && (
              <div className="md:col-span-3 text-xs text-[#879391] font-mono">No branches configured.</div>
            )}
            {(vendorData.branches || []).map((b, idx) => (
              <div key={b.id} className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-white">{b.name}</div>
                  <span className={`w-2 h-2 rounded-full ${b.isActive === false ? 'bg-[#ff5451]' : 'bg-[#4fdbc8]'}`}></span>
                </div>
                <div className="text-xs text-[#bcc9c6]">{b.address || 'No address on file'}</div>
                <div className="pt-2 border-t border-[#2d3449]/40 flex justify-between font-mono text-[11px] text-[#879391]">
                  <span>Code: {b.code || '—'}{b.isDefault ? ' • Default' : ''}</span>
                  <span className="text-[#6bd8cb]">Branch #{idx + 1}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl overflow-hidden p-4 shadow-sm">
            <h4 className="font-bold text-sm text-white mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#4fdbc8]" />
              POS Counters / Profiles
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#060e20] text-[#879391] uppercase text-[10px] border-b border-[#2d3449]">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Counter Name</th>
                    <th className="px-3 py-2">Branch</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3449]/40">
                  {(vendorData.counters || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-[#879391]">No POS profiles configured.</td>
                    </tr>
                  )}
                  {(vendorData.counters || []).map((c, idx) => {
                    const branch = (vendorData.branches || []).find((b) => b.id === c.warehouseId)
                    const active = (c.status || 'active') === 'active'
                    return (
                      <tr key={c.id} className="hover:bg-[#171f33]">
                        <td className="px-3 py-2 text-[#4fdbc8] font-bold">{c.code || `POS-${String(idx + 1).padStart(2, '0')}`}</td>
                        <td className="px-3 py-2 text-white">{c.name}</td>
                        <td className="px-3 py-2 text-[#bcc9c6]">{branch?.name || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              active ? 'bg-[#4fdbc8]/15 text-[#4fdbc8]' : 'bg-[#ff5451]/20 text-[#ffb4ab]'
                            }`}
                          >
                            {c.status || 'active'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Feature Flags */}
      {activeTab === 'flags' && (
        <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/50">
            <div>
              <h3 className="font-bold text-base text-white">Granular Feature Flags &amp; Modules</h3>
              <p className="text-xs text-[#bcc9c6]">Configure feature capabilities for {vendorData.name}</p>
            </div>
            <button
              type="button"
              disabled={savingFlags}
              onClick={saveFlags}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6bd8cb] text-[#003732] hover:bg-[#89f5e7] text-xs font-bold transition-all disabled:opacity-50"
            >
              {savingFlags ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Save Tenant Flags</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEATURE_FLAGS.map((flag) => {
              const enabled = !!flags[flag]
              return (
                <div
                  key={flag}
                  onClick={() => handleToggleFlag(flag)}
                  className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between transition-all ${
                    enabled ? 'bg-[#29a195]/20 border-[#6bd8cb]' : 'bg-[#060e20] border-[#2d3449] opacity-75'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold text-white">{FEATURE_FLAG_LABELS[flag]}</div>
                    <div className="font-mono text-[10px] text-[#879391]">{flag}</div>
                  </div>
                  <div className={`w-9 h-5 rounded-full p-0.5 flex transition-colors ${enabled ? 'bg-[#6bd8cb] justify-end' : 'bg-[#222a3d] justify-start'}`}>
                    <div className={`w-4 h-4 rounded-full ${enabled ? 'bg-[#003732]' : 'bg-[#879391]'}`}></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* TAB: Billing */}
      {activeTab === 'billing' && (
        <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/50">
            <h3 className="font-bold text-base text-white">Commercial Tier &amp; Billing Records</h3>
            <span className="font-mono text-xs text-[#4fdbc8] font-bold uppercase">
              PLAN: {vendorData.plan || 'trial'}
              {sub?.tier?.name ? ` (${sub.tier.name})` : ''}
            </span>
          </div>

          {!sub ? (
            <div className="text-xs text-[#879391] font-mono">
              No subscription record for this tenant.{' '}
              <Link href="/sys-control/subscriptions" className="text-[#6bd8cb] underline">
                Manage subscriptions
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="bg-[#060e20] p-4 rounded-xl border border-[#2d3449] space-y-2">
                <div className="text-[#879391] uppercase text-[10px]">
                  {sub.billingCycle === 'yearly' ? 'Yearly Fee' : 'Monthly Fee'}
                </div>
                <div className="text-xl font-bold text-white">
                  {monthlyFee !== null && monthlyFee !== undefined
                    ? `LKR ${fmtMoney(parseFloat(String(sub.billingCycle === 'yearly' ? sub.subscribedPriceYearly ?? sub.tier?.priceYearly ?? monthlyFee : monthlyFee)))}`
                    : '—'}
                </div>
                <div className="text-[#4fdbc8]">Cycle: {sub.billingCycle || 'monthly'}</div>
              </div>

              <div className="bg-[#060e20] p-4 rounded-xl border border-[#2d3449] space-y-2">
                <div className="text-[#879391] uppercase text-[10px]">Current Period End</div>
                <div className="text-xl font-bold text-white">{fmtDate(sub.currentPeriodEnd || sub.trialEndsAt)}</div>
                <div className="text-[#bcc9c6]">
                  {daysRemaining !== null ? `${daysRemaining} days remaining in cycle` : 'No period set'}
                </div>
              </div>

              <div className="bg-[#060e20] p-4 rounded-xl border border-[#2d3449] space-y-2">
                <div className="text-[#879391] uppercase text-[10px]">Subscription Status</div>
                <div className={`text-xl font-bold uppercase ${sub.status === 'active' ? 'text-[#4fdbc8]' : 'text-[#ffb4ab]'}`}>
                  {sub.status}
                </div>
                <div className="text-[#879391]">Last payment: {fmtDate(sub.lastPaymentAt)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Audit */}
      {activeTab === 'audit' && (
        <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-sm space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-base text-white">Privileged Admin Audit History (90 days)</h3>
            <Link href="/sys-control/audit-logs" className="text-[#6bd8cb] hover:underline text-xs">
              Full audit log →
            </Link>
          </div>
          {auditLogs === null ? (
            <div className="py-8 text-center text-[#bcc9c6] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#6bd8cb]" />
              Loading audit history...
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="py-8 text-center text-[#879391]">No admin actions recorded for this tenant.</div>
          ) : (
            <div className="space-y-2">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-3 bg-[#060e20] border border-[#2d3449]/50 rounded-lg flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white font-semibold uppercase truncate">
                      {log.action}_{log.resource}
                    </div>
                    <div className="text-[10px] text-[#879391] truncate">
                      Actor: {log.account?.email || 'system'} • IP: {log.ipAddress || '—'}
                    </div>
                  </div>
                  <div className="text-[#bcc9c6] text-[11px] shrink-0">{fmtDateTime(log.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

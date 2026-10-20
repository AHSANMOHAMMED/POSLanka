'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  Radio,
  Pause,
  Play,
  Volume2,
  VolumeX,
  Receipt,
  DollarSign,
  Zap,
  ShoppingBag,
  CheckCircle2,
  Building,
  Search,
  TrendingUp,
  AlertOctagon,
  Loader2,
  Cpu,
} from 'lucide-react'

type RangeKey = 'today' | '7d' | '30d'

interface LiveReceipt {
  id: string
  invoiceNo: string
  tenantId: string
  tenantName: string
  tenantSlug: string
  businessType: string
  warehouseName: string | null
  cashierName: string | null
  total: number
  isReturn: boolean
  paymentMethod: string | null
  createdAt: string
}

interface LiveResponse {
  since: string
  serverTime: string
  receipts: LiveReceipt[]
  hourly: Array<{ hour: string; netSales: number; receipts: number }>
}

interface SalesAnalytics {
  totals: { netSales: number; grossSales: number; returns: number; receipts: number; avgBasket: number; voids: number }
  byDay: Array<{ date: string; netSales: number; receipts: number }>
  byBusinessType: Array<{ businessType: string; netSales: number; receipts: number }>
  topVendors: Array<{ tenantId: string; name: string; slug: string; netSales: number; receipts: number }>
  topBranches: Array<{ tenantId: string; tenantName: string; warehouseId: string | null; warehouseName: string; netSales: number; receipts: number }>
  openShifts: { count: number; byVendor: Array<{ tenantId: string; name: string; count: number }> }
}

const LIVE_POLL_MS = 5_000
const SALES_POLL_MS = 60_000
const MAX_FEED_ROWS = 200
const HIGH_VALUE_THRESHOLD = 30_000

const BUSINESS_TYPES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'supermarket', label: 'Supermarket' },
  { id: 'retail', label: 'Retail' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'auto_service', label: 'Auto Service' },
  { id: 'dealership', label: 'Dealership' },
]

const TYPE_LABEL: Record<string, string> = {
  supermarket: 'Supermarket',
  retail: 'Retail',
  restaurant: 'Restaurant',
  auto_service: 'Auto Service',
  dealership: 'Dealership',
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank',
  credit: 'Credit',
  gift_card: 'Gift Card',
}

const BAR_COLORS = ['#6bd8cb', '#4fdbc8', '#29a195', '#04b4a2', '#222a3d']

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}

export default function RealTimeSalesWallPage() {
  const [receipts, setReceipts] = useState<LiveReceipt[]>([])
  const [analytics, setAnalytics] = useState<SalesAnalytics | null>(null)
  const [range, setRange] = useState<RangeKey>('today')
  const [isFrozen, setIsFrozen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [selectedType, setSelectedType] = useState<string>('all')
  const [selectedPayment, setSelectedPayment] = useState<string>('all')
  const [minAmount, setMinAmount] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastLiveAt, setLastLiveAt] = useState<Date | null>(null)
  const [feedLatency, setFeedLatency] = useState<number | null>(null)

  const soundRef = useRef(soundEnabled)
  useEffect(() => {
    soundRef.current = soundEnabled
  }, [soundEnabled])

  const playChime = useCallback(() => {
    if (!soundRef.current) return
    try {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const ctx = new AudioContextClass()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.25)
    } catch {
      // AudioContext not allowed or not supported
    }
  }, [])

  const knownIdsRef = useRef<Set<string> | null>(null)

  const loadLive = useCallback(async () => {
    const started = performance.now()
    try {
      const res = await fetch('/api/sys-control/analytics/live', { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = '/sys-control/login'
        return
      }
      if (!res.ok) throw new Error('Failed to load live feed')
      const data: LiveResponse = await res.json()
      setFeedLatency(Math.round(performance.now() - started))

      const incoming = data.receipts || []
      if (knownIdsRef.current) {
        const fresh = incoming.filter((r) => !knownIdsRef.current!.has(r.id))
        if (fresh.some((r) => r.total >= HIGH_VALUE_THRESHOLD)) playChime()
      }
      knownIdsRef.current = new Set(incoming.map((r) => r.id))

      setReceipts((prev) => {
        // Merge: keep rows we've already seen (within window) so the feed never "jumps"
        const map = new Map<string, LiveReceipt>()
        for (const r of incoming) map.set(r.id, r)
        const cutoff = Date.now() - 60 * 60 * 1000
        for (const r of prev) {
          if (!map.has(r.id) && Date.parse(r.createdAt) >= cutoff) map.set(r.id, r)
        }
        return Array.from(map.values())
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, MAX_FEED_ROWS)
      })
      setLastLiveAt(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load live feed')
    }
  }, [playChime])

  const loadAnalytics = useCallback(async (r: RangeKey, type: string) => {
    try {
      const params = new URLSearchParams({ range: r })
      if (type !== 'all') params.set('businessType', type)
      const res = await fetch(`/api/sys-control/analytics/sales?${params.toString()}`, { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = '/sys-control/login'
        return
      }
      if (!res.ok) throw new Error('Failed to load sales analytics')
      setAnalytics(await res.json())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales analytics')
    }
  }, [])

  // Initial load
  useEffect(() => {
    let cancelled = false
    Promise.all([loadLive(), loadAnalytics('today', 'all')]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live feed polling (5s) – paused when frozen
  useEffect(() => {
    if (isFrozen) return
    const id = setInterval(() => {
      if (!document.hidden) loadLive()
    }, LIVE_POLL_MS)
    return () => clearInterval(id)
  }, [isFrozen, loadLive])

  // Analytics polling (60s) – refetch immediately on range / type change
  useEffect(() => {
    loadAnalytics(range, selectedType)
    const id = setInterval(() => {
      if (!document.hidden) loadAnalytics(range, selectedType)
    }, SALES_POLL_MS)
    return () => clearInterval(id)
  }, [range, selectedType, loadAnalytics])

  // Filtered feed
  const q = searchQuery.trim().toLowerCase()
  const filtered = receipts.filter((tx) => {
    if (selectedType !== 'all' && tx.businessType !== selectedType) return false
    if (selectedPayment !== 'all' && (tx.paymentMethod || 'unknown') !== selectedPayment) return false
    if (minAmount > 0 && Math.abs(tx.total) < minAmount) return false
    if (
      q &&
      !tx.tenantName.toLowerCase().includes(q) &&
      !tx.invoiceNo.toLowerCase().includes(q) &&
      !(tx.cashierName || '').toLowerCase().includes(q)
    ) {
      return false
    }
    return true
  })

  // Velocity: receipts in the last 60 minutes (from the live window)
  const lastHourCount = receipts.filter((r) => !r.isReturn).length
  const txPerMin = lastHourCount / 60
  const lastHourNet = receipts.reduce((s, r) => s + r.total, 0)

  const totals = analytics?.totals
  const typeTotal = (analytics?.byBusinessType || []).reduce((s, t) => s + t.netSales, 0)
  const rangeLabel = range === 'today' ? 'Today' : range === '7d' ? '7 Days' : '30 Days'

  if (loading) {
    return (
      <div className="py-24 text-center text-[#bcc9c6] space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#6bd8cb]" />
        <div className="font-mono text-xs">Connecting to live sales stream...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Live Telemetry Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 bg-[#131b2e] border border-[#2d3449] rounded-xl shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex items-center justify-center w-3 h-3">
            {!isFrozen && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4fdbc8] opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isFrozen ? 'bg-[#ff5451]' : 'bg-[#4fdbc8]'}`}></span>
          </div>
          <div className="flex items-center gap-2 truncate">
            <span className="font-mono text-xs text-[#4fdbc8] font-bold uppercase tracking-widest">
              {isFrozen ? 'STREAM FROZEN' : 'LIVE RECEIPT STREAM'}
            </span>
            <span className="text-[#3d4947]">•</span>
            <span className="font-mono text-xs text-[#bcc9c6] truncate">
              LAST SYNC {lastLiveAt ? lastLiveAt.toLocaleTimeString('en-LK', { hour12: false }) : '—'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#222a3d] border border-[#3d4947] text-[#6bd8cb] font-mono text-xs">
            <Zap className="w-3.5 h-3.5 text-[#6bd8cb]" />
            FEED LATENCY: {feedLatency !== null ? `${feedLatency}ms` : '—'}
          </span>

          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#171f33] border border-[#2d3449] text-[#4fdbc8] font-mono text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#4fdbc8]" />
            POLL 5s / 60s
          </span>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-1.5 rounded-lg border transition-colors ${
              soundEnabled
                ? 'bg-[#6bd8cb]/20 border-[#6bd8cb] text-[#6bd8cb]'
                : 'bg-[#171f33] border-[#2d3449] text-[#879391] hover:text-white'
            }`}
            title={soundEnabled ? 'Mute Large Transaction Chime' : 'Enable Large Transaction Chime'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setIsFrozen(!isFrozen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
              isFrozen
                ? 'bg-[#ff5451] border-[#ff5451] text-white hover:bg-[#ff897d]'
                : 'bg-[#222a3d] border-[#3d4947] text-white hover:bg-[#2d3449]'
            }`}
          >
            {isFrozen ? (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Resume Stream</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Freeze Stream</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-[#93000a]/30 border border-[#ff5451]/50 rounded-xl text-xs text-[#ffdad6] flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-[#ffb4ab]" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Ticker Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#6bd8cb]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Receipts {rangeLabel}</span>
            <Receipt className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              {(totals?.receipts ?? 0).toLocaleString()}
            </span>
            <span className="font-mono text-xs text-[#ff5451] font-semibold">{totals?.voids ?? 0} voids</span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <span>RETURNS: LKR {fmtCompact(totals?.returns ?? 0)}</span>
          </div>
        </div>

        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#4fdbc8]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Net Sales {rangeLabel} (LKR)</span>
            <DollarSign className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-[#4fdbc8] tracking-tight">
              {fmtMoney(totals?.netSales ?? 0)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <span className="text-[#4fdbc8] font-semibold">GROSS: {fmtCompact(totals?.grossSales ?? 0)}</span>
            <span>•</span>
            <span>LAST 60 MIN: {fmtCompact(lastHourNet)}</span>
          </div>
        </div>

        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#6bd8cb]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Throughput Velocity</span>
            <Zap className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">{txPerMin.toFixed(2)}</span>
            <span className="font-mono text-sm text-[#6bd8cb] font-semibold">tx / min</span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <span>{lastHourCount} RECEIPTS IN LAST 60 MIN</span>
          </div>
        </div>

        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#4fdbc8]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Average Basket</span>
            <ShoppingBag className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              LKR {fmtMoney(totals?.avgBasket ?? 0)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <Cpu className="w-3 h-3 text-[#4fdbc8]" />
            <span className="text-[#4fdbc8] font-semibold">{analytics?.openShifts.count ?? 0} OPEN SHIFTS</span>
          </div>
        </div>
      </div>

      {/* Filter Strip */}
      <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold mr-1">
              SECTOR:
            </span>
            {BUSINESS_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedType(t.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedType === t.id
                    ? 'bg-[#29a195] text-[#00302b]'
                    : 'bg-[#171f33] text-[#bcc9c6] hover:bg-[#222a3d] hover:text-white border border-[#2d3449]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#879391]" />
            <input
              type="text"
              placeholder="Search vendor, invoice, cashier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#060e20] border border-[#2d3449] rounded-lg text-white font-mono text-xs placeholder:text-[#879391] focus:border-[#6bd8cb] outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#2d3449]/40 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[#879391] uppercase font-semibold">RANGE:</span>
              <div className="flex items-center gap-1 bg-[#060e20] p-0.5 rounded-lg font-mono text-[11px]">
                {(['today', '7d', '30d'] as RangeKey[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`px-2 py-0.5 rounded ${
                      range === r ? 'bg-[#6bd8cb] text-[#003732] font-bold' : 'text-[#bcc9c6] hover:text-white'
                    }`}
                  >
                    {r === 'today' ? 'Today' : r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[#879391] uppercase font-semibold">PAYMENT:</span>
              <select
                value={selectedPayment}
                onChange={(e) => setSelectedPayment(e.target.value)}
                className="bg-[#060e20] border border-[#2d3449] text-white text-xs rounded-lg px-2.5 py-1 outline-none font-mono"
              >
                <option value="all">All methods</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="credit">Credit</option>
                <option value="gift_card">Gift Card</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#879391] uppercase font-semibold">MIN AMOUNT:</span>
            {[
              { label: 'All', value: 0 },
              { label: '> 5K', value: 5000 },
              { label: '> 25K', value: 25000 },
              { label: '> 50K (VIP)', value: 50000 },
            ].map((th) => (
              <button
                key={th.value}
                type="button"
                onClick={() => setMinAmount(th.value)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold transition-colors ${
                  minAmount === th.value ? 'bg-[#6bd8cb] text-[#003732]' : 'bg-[#171f33] text-[#bcc9c6] hover:bg-[#222a3d]'
                }`}
              >
                {th.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Live Transactions Feed */}
        <div className="xl:col-span-8 bg-[#131b2e] border border-[#2d3449] rounded-xl shadow-md overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[#2d3449] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className={`w-4 h-4 text-[#4fdbc8] ${isFrozen ? '' : 'animate-pulse'}`} />
              <h3 className="font-bold text-base text-white">Live Receipt Stream (last 60 min)</h3>
              <span className="font-mono text-[11px] bg-[#060e20] text-[#6bd8cb] px-2 py-0.5 rounded font-bold">
                {filtered.length} rows
              </span>
            </div>
            <div className="font-mono text-xs text-[#879391]">Updates every 5s</div>
          </div>

          <div className="overflow-x-auto max-h-[720px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#060e20] text-[#879391] font-mono text-[10px] uppercase border-b border-[#2d3449] sticky top-0">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Vendor / Outlet</th>
                  <th className="px-3 py-3">Cashier</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Amount (LKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d3449]/40 font-mono text-xs">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[#879391]">
                      No receipts in the last 60 minutes matching the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#171f33] transition-colors group">
                      <td className="px-4 py-3 text-[#bcc9c6] whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleTimeString('en-LK', { hour12: false })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[#4fdbc8] font-bold">{tx.invoiceNo}</span>
                        {tx.isReturn && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#ff5451]/20 text-[#ffb4ab] text-[9px] font-bold">
                            RETURN
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/sys-control/vendors/${tx.tenantId}`}
                          className="font-sans font-semibold text-white truncate max-w-[200px] block hover:text-[#6bd8cb] hover:underline"
                        >
                          {tx.tenantName}
                        </Link>
                        <div className="text-[10px] text-[#879391]">
                          {tx.tenantSlug}
                          {tx.warehouseName ? ` • ${tx.warehouseName}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[#bcc9c6] whitespace-nowrap">{tx.cashierName || '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                            tx.paymentMethod === 'card'
                              ? 'bg-[#04b4a2]/20 text-[#4fdbc8] border border-[#04b4a2]/40'
                              : tx.paymentMethod === 'bank_transfer'
                                ? 'bg-[#29a195]/20 text-[#6bd8cb] border border-[#29a195]/40'
                                : tx.paymentMethod === 'credit'
                                  ? 'bg-[#ff5451]/20 text-[#ffb4ab] border border-[#ff5451]/40'
                                  : 'bg-[#222a3d] text-[#bcc9c6]'
                          }`}
                        >
                          {tx.paymentMethod ? PAYMENT_LABEL[tx.paymentMethod] || tx.paymentMethod : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-[10px] text-[#bcc9c6]">
                        {TYPE_LABEL[tx.businessType] || tx.businessType}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-bold">
                        <span
                          className={
                            tx.total < 0 ? 'text-[#ffb4ab]' : tx.total > 25000 ? 'text-[#6bd8cb] text-sm' : 'text-white'
                          }
                        >
                          {fmtMoney(tx.total)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Sector mix & Leaderboard */}
        <div className="xl:col-span-4 space-y-6">
          <div className="bg-[#131b2e] border border-[#2d3449] p-5 rounded-xl shadow-md space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d3449]/50">
              <h4 className="font-bold text-sm text-white flex items-center gap-2">
                <Building className="w-4 h-4 text-[#6bd8cb]" />
                Sales by Business Type
              </h4>
              <span className="font-mono text-[10px] text-[#4fdbc8] font-bold uppercase">{rangeLabel}</span>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {(analytics?.byBusinessType || []).length === 0 && (
                <div className="text-[#879391] text-center py-4">No sales in this range</div>
              )}
              {(analytics?.byBusinessType || []).map((t, i) => {
                const pct = typeTotal > 0 ? Math.round((t.netSales / typeTotal) * 100) : 0
                return (
                  <div key={t.businessType}>
                    <div className="flex justify-between text-[#bcc9c6] mb-1">
                      <span>
                        {TYPE_LABEL[t.businessType] || t.businessType} • {t.receipts} receipts
                      </span>
                      <span className="text-white font-bold">{pct}%</span>
                    </div>
                    <div className="w-full bg-[#060e20] h-2 rounded-full overflow-hidden">
                      <div className="h-full" style={{ width: `${pct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-[#131b2e] border border-[#2d3449] p-5 rounded-xl shadow-md space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d3449]/50">
              <h4 className="font-bold text-sm text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#4fdbc8]" />
                Top Branches {rangeLabel}
              </h4>
              <span className="font-mono text-[10px] text-[#bcc9c6]">NET SALES</span>
            </div>

            <div className="space-y-3">
              {(analytics?.topBranches || []).length === 0 && (
                <div className="text-[#879391] text-center py-4 font-mono text-xs">No sales in this range</div>
              )}
              {(analytics?.topBranches || []).slice(0, 6).map((b, idx) => (
                <Link
                  key={`${b.tenantId}-${b.warehouseId ?? idx}`}
                  href={`/sys-control/vendors/${b.tenantId}`}
                  className="p-3 bg-[#060e20] border border-[#2d3449]/50 rounded-lg flex items-center justify-between hover:border-[#6bd8cb]/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{b.tenantName}</div>
                    <div className="font-mono text-[10px] text-[#879391] truncate">
                      {b.warehouseName} • {b.receipts} receipts
                    </div>
                  </div>
                  <div className="font-mono text-xs text-[#6bd8cb] font-bold shrink-0">LKR {fmtCompact(b.netSales)}</div>
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-[#131b2e] border border-[#2d3449] p-5 rounded-xl shadow-md space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d3449]/50">
              <h4 className="font-bold text-sm text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#6bd8cb]" />
                Open Shifts by Vendor
              </h4>
              <span className="font-mono text-[10px] text-[#4fdbc8] font-bold">{analytics?.openShifts.count ?? 0} OPEN</span>
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              {(analytics?.openShifts.byVendor || []).length === 0 && (
                <div className="text-[#879391] text-center py-3">No open shifts</div>
              )}
              {(analytics?.openShifts.byVendor || []).slice(0, 8).map((v) => (
                <div key={v.tenantId} className="flex justify-between text-[#bcc9c6]">
                  <span className="truncate">{v.name}</span>
                  <span className="text-white font-bold">{v.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

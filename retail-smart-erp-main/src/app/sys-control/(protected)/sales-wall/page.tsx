'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Building2, Clock, Pause, Play, Receipt, ShoppingBag, Store, TrendingUp, Volume2, VolumeX, Zap } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  AdminTable,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  EmptyState,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  StatGrid,
  StatusDot,
  businessTypeLabel,
  fmtLKR,
  fmtNumber,
  type AdminColumn,
} from '@/components/admin/kit'
import { cn } from '@/lib/utils'

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

const BUSINESS_TYPES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'supermarket', label: 'Supermarket' },
  { value: 'retail', label: 'Retail' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'auto_service', label: 'Auto service' },
  { value: 'dealership', label: 'Dealership' },
]

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  credit: 'Credit',
  gift_card: 'Gift card',
}

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]
const RANGE_TEXT: Record<RangeKey, string> = { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days' }

const MIN_AMOUNTS = [
  { value: '0', label: 'Any amount' },
  { value: '5000', label: 'Over LKR 5,000' },
  { value: '25000', label: 'Over LKR 25,000' },
  { value: '50000', label: 'Over LKR 50,000' },
]

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export default function LiveSalesPage() {
  const [receipts, setReceipts] = useState<LiveReceipt[]>([])
  const [analytics, setAnalytics] = useState<SalesAnalytics | null>(null)
  const [range, setRange] = useState<RangeKey>('today')
  const [isFrozen, setIsFrozen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [selectedType, setSelectedType] = useState<string>('all')
  const [selectedPayment, setSelectedPayment] = useState<string>('all')
  const [minAmount, setMinAmount] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [liveLoaded, setLiveLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLiveAt, setLastLiveAt] = useState<Date | null>(null)

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
    try {
      const res = await fetch('/api/sys-control/analytics/live', { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = '/sys-control/login?session=expired'
        return
      }
      if (!res.ok) throw new Error('The live receipt feed could not be loaded.')
      const data: LiveResponse = await res.json()
      const incoming = data.receipts || []

      if (knownIdsRef.current) {
        const fresh = incoming.filter((r) => !knownIdsRef.current!.has(r.id))
        if (fresh.some((r) => r.total >= HIGH_VALUE_THRESHOLD)) playChime()
      }
      knownIdsRef.current = new Set(incoming.map((r) => r.id))

      setReceipts((prev) => {
        // Merge so rows already shown (within the 60 min window) never jump out
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
      setError(err instanceof Error ? err.message : 'The live receipt feed could not be loaded.')
    } finally {
      setLiveLoaded(true)
    }
  }, [playChime])

  const loadAnalytics = useCallback(async (r: RangeKey, type: string) => {
    try {
      const params = new URLSearchParams({ range: r })
      if (type !== 'all') params.set('businessType', type)
      const res = await fetch(`/api/sys-control/analytics/sales?${params.toString()}`, { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = '/sys-control/login?session=expired'
        return
      }
      if (!res.ok) throw new Error('Sales totals could not be loaded.')
      setAnalytics(await res.json())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sales totals could not be loaded.')
    }
  }, [])

  // Live feed: immediately, then every 5 s while visible and not paused
  useEffect(() => {
    if (isFrozen) return
    loadLive()
    const id = window.setInterval(() => {
      if (!document.hidden) loadLive()
    }, LIVE_POLL_MS)
    return () => window.clearInterval(id)
  }, [isFrozen, loadLive])

  // Totals: immediately on range/type change, then every 60 s
  useEffect(() => {
    loadAnalytics(range, selectedType)
    const id = window.setInterval(() => {
      if (!document.hidden) loadAnalytics(range, selectedType)
    }, SALES_POLL_MS)
    return () => window.clearInterval(id)
  }, [range, selectedType, loadAnalytics])

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

  const lastHourCount = receipts.filter((r) => !r.isReturn).length
  const lastHourNet = receipts.reduce((s, r) => s + r.total, 0)
  const totals = analytics?.totals
  const typeTotal = (analytics?.byBusinessType || []).reduce((s, t) => s + Math.max(0, t.netSales), 0)
  const filtersActive = selectedType !== 'all' || selectedPayment !== 'all' || minAmount > 0 || q.length > 0

  const columns: AdminColumn<LiveReceipt>[] = [
    { key: 'time', header: 'Time', width: '96px', cell: (tx) => <span className="adm-num text-adm-muted">{fmtTime(tx.createdAt)}</span> },
    {
      key: 'vendor',
      header: 'Vendor',
      primary: true,
      cell: (tx) => (
        <span className="block min-w-0">
          <Link href={`/sys-control/vendors/${tx.tenantId}`} className="font-medium text-adm-fg hover:text-adm-primary">{tx.tenantName}</Link>
          {tx.warehouseName && <span className="block text-[12px] text-adm-subtle">{tx.warehouseName}</span>}
        </span>
      ),
    },
    { key: 'invoice', header: 'Receipt', cell: (tx) => <span className="adm-num">{tx.invoiceNo}</span> },
    { key: 'cashier', header: 'Cashier', hideBelow: 'lg', cell: (tx) => tx.cashierName || <span className="text-adm-subtle">—</span> },
    {
      key: 'payment',
      header: 'Payment',
      hideBelow: 'lg',
      cell: (tx) => (tx.paymentMethod ? PAYMENT_LABEL[tx.paymentMethod] || tx.paymentMethod : <span className="text-adm-subtle">—</span>),
    },
    {
      key: 'type',
      header: 'Type',
      hideBelow: 'xl',
      cell: (tx) => (tx.isReturn ? <Badge tone="danger">Return</Badge> : <span className="text-adm-muted">{businessTypeLabel(tx.businessType)}</span>),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (tx) => (
        <span className={cn('adm-num font-medium', tx.isReturn ? 'text-adm-danger' : tx.total >= HIGH_VALUE_THRESHOLD ? 'text-adm-primary' : 'text-adm-fg')}>
          {fmtLKR(tx.total, 2)}
        </span>
      ),
    },
  ]

  return (
    <AdminPage
      title="Live sales"
      titleAside={
        <Badge tone={isFrozen ? 'warning' : 'success'} dot>
          {isFrozen ? 'Paused' : 'Live'}
        </Badge>
      }
      description={
        <>
          Receipts from every vendor in the last 60 minutes, refreshed every 5 seconds.
          {lastLiveAt && <> Last update {lastLiveAt.toLocaleTimeString('en-LK', { hour12: false })}.</>}
        </>
      }
      actions={
        <>
          <Button
            icon={soundEnabled ? Volume2 : VolumeX}
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-pressed={soundEnabled}
            title={`Chime for receipts over ${fmtLKR(HIGH_VALUE_THRESHOLD)}`}
          >
            {soundEnabled ? 'Chime on' : 'Chime off'}
          </Button>
          <Button variant={isFrozen ? 'primary' : 'secondary'} icon={isFrozen ? Play : Pause} onClick={() => setIsFrozen(!isFrozen)}>
            {isFrozen ? 'Resume' : 'Pause'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <StatGrid>
        <StatCard
          label={`Net sales, ${RANGE_TEXT[range]}`}
          icon={TrendingUp}
          loading={!analytics}
          value={fmtLKR(totals?.netSales)}
          hint={`Gross ${fmtLKR(totals?.grossSales)} · returns ${fmtLKR(totals?.returns)}`}
        />
        <StatCard
          label={`Receipts, ${RANGE_TEXT[range]}`}
          icon={Receipt}
          tone="info"
          loading={!analytics}
          value={fmtNumber(totals?.receipts)}
          hint={`${fmtNumber(totals?.voids)} voided`}
        />
        <StatCard
          label="Last 60 minutes"
          icon={Zap}
          tone="warning"
          loading={!liveLoaded}
          value={fmtLKR(lastHourNet)}
          hint={`${lastHourCount} receipts · ${(lastHourCount / 60).toFixed(1)} per minute`}
        />
        <StatCard
          label="Average basket"
          icon={ShoppingBag}
          tone="success"
          loading={!analytics}
          value={fmtLKR(totals?.avgBasket)}
          hint={`${analytics?.openShifts.count ?? 0} POS shifts open now`}
        />
      </StatGrid>

      <AdminCard flush>
        <div className="space-y-3 p-4 sm:p-5">
          <AdminToolbar
            end={<SegmentedControl ariaLabel="Totals range" value={range} onChange={setRange} options={RANGE_OPTIONS} size="sm" />}
          >
            <SearchInput
              size="sm"
              wrapperClassName="w-full sm:w-72"
              placeholder="Vendor, receipt no. or cashier"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter receipts"
            />
            <Select size="sm" className="w-full min-[480px]:w-auto" value={selectedType} onChange={(e) => setSelectedType(e.target.value)} aria-label="Business type">
              {BUSINESS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={selectedPayment} onChange={(e) => setSelectedPayment(e.target.value)} aria-label="Payment method">
              <option value="all">All payments</option>
              {Object.entries(PAYMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={String(minAmount)} onChange={(e) => setMinAmount(Number(e.target.value))} aria-label="Minimum amount">
              {MIN_AMOUNTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </AdminToolbar>
        </div>
      </AdminCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <AdminCard
          className="xl:col-span-8"
          title="Receipts, last 60 minutes"
          description={`${filtered.length} of ${receipts.length} shown`}
          icon={<StatusDot tone={isFrozen ? 'warning' : 'success'} pulse={!isFrozen} />}
          flush
        >
          <AdminTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            loading={!liveLoaded}
            maxHeight={640}
            minWidth={560}
            empty={
              <EmptyState
                icon={Receipt}
                title={filtersActive ? 'No receipts match these filters' : 'No receipts in the last hour'}
                description={filtersActive ? 'Clear a filter to see more.' : 'New receipts appear here a few seconds after they’re rung up.'}
                action={
                  filtersActive ? (
                    <Button size="sm" onClick={() => { setSelectedType('all'); setSelectedPayment('all'); setMinAmount(0); setSearchQuery('') }}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </AdminCard>

        <div className="space-y-5 xl:col-span-4">
          <AdminCard title="By business type" description={`Net sales, ${RANGE_TEXT[range]}`} icon={<Store size={17} />}>
            {!analytics ? (
              <Skeleton className="h-20 w-full" />
            ) : analytics.byBusinessType.length === 0 ? (
              <EmptyState compact title="No sales in this range" />
            ) : (
              <ul className="space-y-3">
                {analytics.byBusinessType.map((t) => {
                  const pct = typeTotal > 0 ? Math.round((Math.max(0, t.netSales) / typeTotal) * 100) : 0
                  return (
                    <li key={t.businessType}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="text-adm-fg">{businessTypeLabel(t.businessType)}</span>
                        <span className="adm-num text-adm-muted">{fmtLKR(t.netSales)} · {pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-adm-surface-3">
                        <div className="h-full rounded-full bg-adm-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </AdminCard>

          <AdminCard title="Top branches" description={`Net sales, ${RANGE_TEXT[range]}`} icon={<Building2 size={17} />} flush>
            {!analytics ? (
              <div className="p-4"><Skeleton className="h-20 w-full" /></div>
            ) : analytics.topBranches.length === 0 ? (
              <EmptyState compact title="No branch sales in this range" />
            ) : (
              <ul className="divide-y divide-[var(--adm-border)]">
                {analytics.topBranches.slice(0, 6).map((b) => (
                  <li key={`${b.tenantId}-${b.warehouseId ?? 'none'}`} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-adm-fg">{b.warehouseName}</span>
                      <span className="block truncate text-[12px] text-adm-subtle">{b.tenantName} · {fmtNumber(b.receipts)} receipts</span>
                    </span>
                    <span className="adm-num shrink-0 text-[13.5px] text-adm-fg">{fmtLKR(b.netSales)}</span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <AdminCard
            title="Open POS shifts"
            icon={<Clock size={17} />}
            actions={analytics ? <Badge tone={analytics.openShifts.count > 0 ? 'success' : 'neutral'}>{analytics.openShifts.count} open</Badge> : undefined}
            flush
          >
            {!analytics ? (
              <div className="p-4"><Skeleton className="h-16 w-full" /></div>
            ) : analytics.openShifts.byVendor.length === 0 ? (
              <EmptyState compact title="No tills open right now" />
            ) : (
              <ul className="divide-y divide-[var(--adm-border)]">
                {analytics.openShifts.byVendor.slice(0, 8).map((v) => (
                  <li key={v.tenantId}>
                    <Link href={`/sys-control/vendors/${v.tenantId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-adm-surface-2 sm:px-5">
                      <span className="truncate text-[13.5px] text-adm-fg">{v.name}</span>
                      <span className="adm-num shrink-0 text-[13px] text-adm-muted">{v.count} {v.count === 1 ? 'till' : 'tills'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>
    </AdminPage>
  )
}

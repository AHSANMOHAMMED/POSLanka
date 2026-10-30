'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BadgePercent, Boxes, CreditCard, Database, Download, HandCoins, Package,
  PackageCheck, PiggyBank, Receipt, ShoppingBag, TrendingUp, Truck, Wallet,
} from 'lucide-react'
import {
  AdminCard,
  AdminTable,
  Alert,
  Badge,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  LinkButton,
  SearchInput,
  SegmentedControl,
  Select,
  StatCard,
  StatGrid,
  buttonClass,
  fmtLKR,
  fmtNumber,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { Pager, adminFetch, fmtDate } from '@/components/admin/console-helpers'
import type { VendorBusinessSummary, vendorItemReport } from '@/lib/admin/vendor-business'

type Summary = VendorBusinessSummary & { currency: string }
type ItemRow = Awaited<ReturnType<typeof vendorItemReport>>['rows'][number]
interface ItemList { rows: ItemRow[]; total: number; page: number; pageSize: number }

type Period = 'today' | '7d' | '30d' | 'month' | 'year' | 'all' | 'custom'
type Sort = 'profit' | 'revenue' | 'sold' | 'margin' | 'stockCost' | 'stockValue' | 'stock' | 'name'

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'profit', label: 'Most profit' },
  { value: 'revenue', label: 'Most revenue' },
  { value: 'sold', label: 'Most sold' },
  { value: 'margin', label: 'Best margin' },
  { value: 'stockCost', label: 'Most stock at cost' },
  { value: 'stockValue', label: 'Most stock at selling price' },
  { value: 'stock', label: 'Most on hand' },
  { value: 'name', label: 'Name A–Z' },
]

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', credit: 'On credit', gift_card: 'Gift card', cheque: 'Cheque',
}

const ITEM_PAGE_SIZE = 25
const pct = (n: number | null) => (n === null ? '—' : `${fmtNumber(n, 1)}%`)

/** Sales, profit, stock and money of one vendor, then the same item by item. */
export function VendorBusinessTab({ vendorId }: { vendorId: string }) {
  const canExportAll = useAdminCan('vendors.manage')
  const [period, setPeriod] = useState<Period>('30d')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // A custom period waits for both dates
  const periodQuery = useMemo(() => {
    const p = new URLSearchParams({ period })
    if (period === 'custom') {
      if (!fromDate || !toDate) return null
      p.set('fromDate', fromDate)
      p.set('toDate', toDate)
    }
    return p.toString()
  }, [period, fromDate, toDate])

  // Only the newest request may fill the page: period buttons can be clicked faster than it answers
  const latest = useRef(0)
  const load = useCallback(async () => {
    if (!periodQuery) return
    const mine = ++latest.current
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch<Summary>(`/api/sys-control/vendors/${vendorId}/business?${periodQuery}`)
      if (mine === latest.current) setSummary(res)
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? e.message : 'Could not load the report')
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [vendorId, periodQuery])

  useEffect(() => { load() }, [load])

  const s = summary
  const v = (fn: (x: Summary) => ReactNode) => (s ? fn(s) : '—')
  const busy = loading && !s

  return (
    <div className="space-y-5">
      <AdminCard
        title="Business report"
        description={s ? `${fmtDate(s.period.fromDate)} – ${fmtDate(s.period.toDate)} · the same figures the vendor sees in its own reports.` : 'The same figures the vendor sees in its own reports.'}
        actions={canExportAll ? <LinkButton size="sm" icon={Database} href={`/sys-control/vendors/${vendorId}/data?export=1`}>Export all data</LinkButton> : undefined}
      >
        <SegmentedControl ariaLabel="Period" size="sm" value={period} onChange={setPeriod} options={PERIODS} />
        {period === 'custom' && (
          <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
            <Field label="From" htmlFor="biz-from"><Input id="biz-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
            <Field label="To" htmlFor="biz-to"><Input id="biz-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
          </div>
        )}
      </AdminCard>

      {error && <Alert tone="danger">{error}</Alert>}
      {s && s.catalog.inStockWithoutCost > 0 && (
        <Alert tone="warning" title="Stock value is understated">
          {fmtNumber(s.catalog.inStockWithoutCost)} item{s.catalog.inStockWithoutCost === 1 ? ' is' : 's are'} in stock with no cost price, so they count as zero in the stock value and in profit.
        </Alert>
      )}

      <StatGrid>
        <StatCard label="Net sales" icon={Receipt} tone="success" loading={busy} value={v((x) => fmtLKR(x.sales.netSales))} hint={v((x) => `${fmtNumber(x.sales.receipts)} receipts · avg ${fmtLKR(x.sales.avgBasket)}`)} />
        <StatCard label="Cost of goods sold" icon={ShoppingBag} loading={busy} value={v((x) => fmtLKR(x.profit.costOfGoods))} hint={v((x) => `Revenue without tax ${fmtLKR(x.profit.revenue)}`)} />
        <StatCard label="Gross profit" icon={TrendingUp} tone="success" loading={busy} value={v((x) => fmtLKR(x.profit.grossProfit))} hint={v((x) => `Margin ${pct(x.profit.marginPercent)}`)} />
        <StatCard label="Net profit" icon={PiggyBank} tone="info" loading={busy} value={v((x) => (x.profit.netProfit === null ? '—' : fmtLKR(x.profit.netProfit)))} hint={v((x) => (x.profit.netProfit === null ? 'Nothing posted to the ledger' : 'From the vendor’s ledger'))} />
        <StatCard label="Stock at cost" icon={Boxes} tone="warning" loading={busy} value={v((x) => fmtLKR(x.stock.atCost))} hint={v((x) => `${fmtNumber(x.stock.units, 2)} units on hand`)} />
        <StatCard label="Stock at selling price" icon={BadgePercent} loading={busy} value={v((x) => fmtLKR(x.stock.atSellingPrice))} hint={v((x) => `Potential margin ${fmtLKR(x.stock.potentialMargin)}`)} />
        <StatCard label="Items" icon={Package} tone="info" loading={busy} value={v((x) => fmtNumber(x.catalog.active))} hint={v((x) => `${fmtNumber(x.catalog.inStock)} in stock · ${fmtNumber(x.catalog.outOfStock)} out of stock`)} />
        <StatCard label="Low stock" icon={AlertTriangle} tone="warning" loading={busy} value={v((x) => fmtNumber(x.stock.lowStock))} hint={v((x) => `${fmtNumber(x.stock.outOfStockLines)} at zero or below`)} />
        <StatCard label="Customers owe" icon={ArrowDownToLine} loading={busy} value={v((x) => fmtLKR(x.money.receivable))} hint={v((x) => `${fmtNumber(x.money.customers)} customers`)} />
        <StatCard label="Owed to suppliers" icon={ArrowUpFromLine} loading={busy} value={v((x) => fmtLKR(x.money.payable))} hint={v((x) => `${fmtNumber(x.money.suppliers)} suppliers`)} />
        <StatCard label="Purchases" icon={Truck} loading={busy} value={v((x) => fmtLKR(x.money.purchases))} hint={v((x) => `${fmtNumber(x.money.purchaseBills)} bills`)} />
        <StatCard label="Expenses" icon={HandCoins} loading={busy} value={v((x) => fmtLKR(x.money.expenses))} hint="Approved and paid" />
      </StatGrid>

      {s && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <AdminCard title="Sales breakdown">
            <KeyValueList
              items={[
                { label: 'Gross sales', value: fmtLKR(s.sales.grossSales, 2) },
                { label: 'Returns', value: `${fmtLKR(s.sales.returns, 2)} (${fmtNumber(s.sales.returnCount)})` },
                { label: 'Net sales', value: fmtLKR(s.sales.netSales, 2) },
                { label: 'Discounts given', value: fmtLKR(s.sales.discounts, 2) },
                { label: 'Tax collected', value: fmtLKR(s.sales.tax, 2) },
              ]}
            />
          </AdminCard>
          <AdminCard title="Payments received" flush>
            {s.payments.length === 0 ? <EmptyState icon={CreditCard} title="No payments in this period" compact /> : (
              <ul className="divide-y divide-[var(--adm-border)] text-[13.5px]">
                {s.payments.map((p) => (
                  <li key={p.method} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <span className="flex items-center gap-2 text-adm-fg"><Wallet size={15} aria-hidden className="text-adm-subtle" /> {METHOD_LABEL[p.method] ?? p.method}</span>
                    <span className="adm-num font-medium text-adm-fg">{fmtLKR(p.amount, 2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
          <AdminCard title="Branches" flush>
            {s.branches.length === 0 ? <EmptyState icon={PackageCheck} title="No branches yet" compact /> : (
              <ul className="divide-y divide-[var(--adm-border)] text-[13.5px]">
                {s.branches.map((b) => (
                  <li key={b.name} className="px-4 py-2.5 sm:px-5">
                    <p className="font-medium text-adm-fg">{b.name}</p>
                    <p className="text-[12.5px] text-adm-muted">
                      Sales {fmtLKR(b.revenue)} · profit {fmtLKR(b.grossProfit)} · stock {fmtLKR(b.atCost)} ({fmtNumber(b.itemsInStock)} items)
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      )}

      {periodQuery && <ItemTable vendorId={vendorId} periodQuery={periodQuery} />}
    </div>
  )
}

function ItemTable({ vendorId, periodQuery }: { vendorId: string; periodQuery: string }) {
  const [list, setList] = useState<ItemList | null>(null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('profit')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams(periodQuery)
    if (q) p.set('q', q)
    p.set('sort', sort)
    p.set('dir', sort === 'name' ? 'asc' : 'desc')
    for (const [k, val] of Object.entries(extra)) p.set(k, val)
    return p.toString()
  }, [periodQuery, q, sort])

  // A new search, order or period starts again at page 1
  const filters = query({})
  const [lastFilters, setLastFilters] = useState(filters)
  if (lastFilters !== filters) {
    setLastFilters(filters)
    setPage(1)
  }

  const latest = useRef(0)
  const load = useCallback(async () => {
    const mine = ++latest.current
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch<ItemList>(`/api/sys-control/vendors/${vendorId}/business/items?${query({ page: String(page), pageSize: String(ITEM_PAGE_SIZE) })}`)
      if (mine === latest.current) setList(res)
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? e.message : 'Could not load the items')
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [vendorId, query, page])

  useEffect(() => { load() }, [load])

  const columns: AdminColumn<ItemRow>[] = [
    {
      key: 'name',
      header: 'Item',
      primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 font-medium text-adm-fg">
            {r.name}
            {!r.inCatalog ? <Badge tone="warning">Removed</Badge> : !r.isActive && <Badge>Inactive</Badge>}
          </p>
          <p className="text-[12.5px] text-adm-subtle">{[r.sku, r.barcode, r.category].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { key: 'cost', header: 'Cost', align: 'right', hideBelow: 'xl', cell: (r) => <span className="adm-num">{fmtNumber(r.costPrice, 2)}</span> },
    { key: 'price', header: 'Price', align: 'right', hideBelow: 'xl', cell: (r) => <span className="adm-num">{fmtNumber(r.sellingPrice, 2)}</span> },
    { key: 'hand', header: 'On hand', align: 'right', cell: (r) => <span className="adm-num">{r.trackStock ? `${fmtNumber(r.onHand, 2)} ${r.unit ?? ''}` : '—'}</span> },
    { key: 'stockCost', header: 'Stock at cost', align: 'right', hideBelow: 'lg', cell: (r) => <span className="adm-num">{fmtNumber(r.stockAtCost, 2)}</span> },
    { key: 'sold', header: 'Sold', align: 'right', cell: (r) => <span className="adm-num">{fmtNumber(r.soldQty, 2)}</span> },
    { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => <span className="adm-num">{fmtNumber(r.revenue, 2)}</span> },
    { key: 'cogs', header: 'Cost of sales', align: 'right', hideBelow: 'lg', cell: (r) => <span className="adm-num">{fmtNumber(r.costOfGoods, 2)}</span> },
    { key: 'profit', header: 'Profit', align: 'right', cell: (r) => <span className={`adm-num font-medium ${r.profit < 0 ? 'text-adm-danger' : 'text-adm-fg'}`}>{fmtNumber(r.profit, 2)}</span> },
    { key: 'margin', header: 'Margin', align: 'right', hideBelow: 'md', cell: (r) => <span className="adm-num text-adm-muted">{pct(r.marginPercent)}</span> },
  ]

  return (
    <AdminCard
      title="Item by item"
      description={list ? `${fmtNumber(list.total)} items. Sales and profit are for the period above; stock is as of now.` : undefined}
      actions={
        <a href={`/api/sys-control/vendors/${vendorId}/business/items?${query({ format: 'csv' })}`} className={buttonClass('secondary', 'sm')} download>
          <Download size={14} aria-hidden /> Export items CSV
        </a>
      }
      flush
    >
      <div className="flex flex-col gap-2 border-b border-adm-border p-3 sm:flex-row sm:items-center">
        <SearchInput size="sm" wrapperClassName="flex-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU, barcode or category" aria-label="Search items" />
        <Select size="sm" className="sm:w-56" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort items">
          {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>
      {error ? (
        <div className="p-3"><Alert tone="danger">{error}</Alert></div>
      ) : (
        <AdminTable
          columns={columns}
          rows={list?.rows ?? []}
          rowKey={(r) => r.itemId ?? `removed-${r.name}`}
          loading={loading}
          minWidth={860}
          empty={<EmptyState icon={Package} title={q ? 'No items match' : 'No items yet'} compact />}
        />
      )}
      {list && list.total > 0 && (
        <div className="border-t border-adm-border px-4 py-3 sm:px-5">
          <Pager page={page} pageSize={ITEM_PAGE_SIZE} total={list.total} onPage={setPage} />
        </div>
      )}
    </AdminCard>
  )
}

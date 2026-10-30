// Super admin → one vendor's sales, stock and profit, then the same item by item.
// Server: /api/sys-control/vendors/[id]/business (owner / support admins).
// Route: /admin/vendor-business?vendorId=…&vendorName=…
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { adminGet, useAdminUser } from '../../src/lib/adminApi'
import { adminDownload, downloadName } from '../../src/lib/adminDownload'
import { THEME, formatLKR } from '../../src/lib/theme'
import { ErrorView, InlineNotice, LoadingView } from '../../src/components/StateViews'
import { AdminShell, Card, Kpi, ListRow, Pill, SectionTitle, adminStyles, compactLKR } from '../../src/components/admin/AdminShell'

type Period = 'today' | '7d' | '30d' | 'month' | 'year' | 'all'
type Sort = 'profit' | 'revenue' | 'sold' | 'stockCost' | 'name'

interface Summary {
  period: { fromDate: string; toDate: string }
  sales: { receipts: number; returnCount: number; grossSales: number; returns: number; netSales: number; discounts: number; tax: number; avgBasket: number }
  profit: { revenue: number; costOfGoods: number; grossProfit: number; marginPercent: number | null; netProfit: number | null }
  stock: { atCost: number; atSellingPrice: number; potentialMargin: number; units: number; lowStock: number; outOfStockLines: number }
  catalog: { total: number; active: number; inStock: number; outOfStock: number; inStockWithoutCost: number }
  money: { receivable: number; payable: number; customers: number; suppliers: number; purchases: number; purchaseBills: number; expenses: number }
  payments: Array<{ method: string; amount: number }>
  branches: Array<{ name: string; revenue: number; grossProfit: number; atCost: number; atSellingPrice: number; itemsInStock: number }>
}

interface ItemRow {
  itemId: string | null; name: string; inCatalog: boolean; isActive: boolean; trackStock: boolean; sku: string | null; barcode: string | null
  category: string | null; unit: string | null; costPrice: number; sellingPrice: number; onHand: number; stockAtCost: number
  soldQty: number; revenue: number; costOfGoods: number; profit: number; marginPercent: number | null
}

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }, { value: 'all', label: 'All time' },
]
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'profit', label: 'Most profit' }, { value: 'revenue', label: 'Most revenue' }, { value: 'sold', label: 'Most sold' },
  { value: 'stockCost', label: 'Most stock value' }, { value: 'name', label: 'Name A–Z' },
]
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', credit: 'On credit', gift_card: 'Gift card', cheque: 'Cheque' }
const ITEM_PAGE_SIZE = 30

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export default function VendorBusinessScreen() {
  const params = useLocalSearchParams<{ vendorId: string; vendorName?: string }>()
  const vendorId = params.vendorId
  const vendorName = params.vendorName ? String(params.vendorName) : 'Vendor'
  const { can } = useAdminUser()

  const [period, setPeriod] = useState<Period>('30d')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [items, setItems] = useState<ItemRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('profit')
  const [loadingItems, setLoadingItems] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Only the newest request may fill the screen: period chips can be tapped faster than it answers
  const summarySeq = useRef(0)
  const itemSeq = useRef(0)

  const loadSummary = useCallback(async () => {
    const mine = ++summarySeq.current
    const r = await adminGet<Summary>(`/api/sys-control/vendors/${vendorId}/business?period=${period}`)
    if (mine !== summarySeq.current) return
    setRefreshing(false)
    if (r.ok) { setSummary(r.data); setError(null) } else setError(r.error)
  }, [vendorId, period])

  const itemQuery = useCallback(() => {
    const p = new URLSearchParams({ period, sort, dir: sort === 'name' ? 'asc' : 'desc' })
    if (q) p.set('q', q)
    return p
  }, [period, sort, q])

  const loadItems = useCallback(async (nextPage: number) => {
    const mine = ++itemSeq.current
    setLoadingItems(true)
    const p = itemQuery()
    p.set('page', String(nextPage))
    p.set('pageSize', String(ITEM_PAGE_SIZE))
    const r = await adminGet<{ rows: ItemRow[]; total: number }>(`/api/sys-control/vendors/${vendorId}/business/items?${p.toString()}`)
    if (mine !== itemSeq.current) return
    setLoadingItems(false)
    if (!r.ok) return Alert.alert('Could not load the items', r.error)
    setTotal(r.data.total)
    setPage(nextPage)
    setItems((prev) => (nextPage === 1 ? r.data.rows : [...prev, ...r.data.rows]))
  }, [vendorId, itemQuery])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadItems(1) }, [loadItems])
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  async function exportItems() {
    setExporting(true)
    const p = itemQuery()
    p.set('format', 'csv')
    const failed = await adminDownload(`/api/sys-control/vendors/${vendorId}/business/items?${p.toString()}`, downloadName(vendorName, `items-${period}`, 'csv'))
    setExporting(false)
    if (failed) Alert.alert('Export failed', failed)
  }

  const s = summary
  return (
    <AdminShell title="Sales, stock & profit" subtitle={vendorName} tab="vendors" back>
      {error && !s ? <ErrorView message={error} onRetry={loadSummary} /> : !s ? <LoadingView text="Loading the report…" /> : (
        <ScrollView style={adminStyles.scroll} contentContainerStyle={adminStyles.content} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadSummary(); loadItems(1) }} />}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {PERIODS.map((o) => (
              <Pressable key={o.value} onPress={() => setPeriod(o.value)} style={[styles.chip, period === o.value && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: period === o.value }}>
                <Text style={[styles.chipText, period === o.value && { color: '#FFF' }]}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={adminStyles.muted}>{s.period.fromDate} to {s.period.toDate} • the same figures the vendor sees in its own reports</Text>
          {error ? <InlineNotice text={error} tone="warn" /> : null}
          {s.catalog.inStockWithoutCost > 0 ? (
            <InlineNotice tone="warn" text={`Stock value is understated: ${s.catalog.inStockWithoutCost} item${s.catalog.inStockWithoutCost === 1 ? ' is' : 's are'} in stock with no cost price, so they count as zero in the stock value and in profit.`} />
          ) : null}

          <SectionTitle>Sales and profit</SectionTitle>
          <View style={adminStyles.kpiGrid}>
            <Kpi label="Net sales" value={compactLKR(s.sales.netSales)} hint={`${s.sales.receipts} receipts • avg ${compactLKR(s.sales.avgBasket)}`} tone="primary" />
            <Kpi label="Cost of goods" value={compactLKR(s.profit.costOfGoods)} hint={`Revenue without tax ${compactLKR(s.profit.revenue)}`} />
            <Kpi label="Gross profit" value={compactLKR(s.profit.grossProfit)} hint={s.profit.marginPercent === null ? undefined : `Margin ${s.profit.marginPercent}%`} tone={s.profit.grossProfit < 0 ? 'error' : 'ok'} />
            <Kpi label="Net profit" value={s.profit.netProfit === null ? '—' : compactLKR(s.profit.netProfit)} hint={s.profit.netProfit === null ? 'Nothing posted to the ledger' : 'From the vendor’s ledger'} />
          </View>

          <SectionTitle>Stock and items</SectionTitle>
          <View style={adminStyles.kpiGrid}>
            <Kpi label="Stock at cost" value={compactLKR(s.stock.atCost)} hint={`${num(s.stock.units)} units on hand`} tone="warn" />
            <Kpi label="At selling price" value={compactLKR(s.stock.atSellingPrice)} hint={`Potential margin ${compactLKR(s.stock.potentialMargin)}`} />
            <Kpi label="Items" value={String(s.catalog.active)} hint={`${s.catalog.inStock} in stock • ${s.catalog.outOfStock} out`} />
            <Kpi label="Low stock" value={String(s.stock.lowStock)} hint={`${s.stock.outOfStockLines} at zero or below`} tone={s.stock.lowStock > 0 ? 'warn' : undefined} />
          </View>

          <SectionTitle>Money</SectionTitle>
          <View style={adminStyles.kpiGrid}>
            <Kpi label="Customers owe" value={compactLKR(s.money.receivable)} hint={`${s.money.customers} customers`} />
            <Kpi label="Owed to suppliers" value={compactLKR(s.money.payable)} hint={`${s.money.suppliers} suppliers`} />
            <Kpi label="Purchases" value={compactLKR(s.money.purchases)} hint={`${s.money.purchaseBills} bills`} />
            <Kpi label="Expenses" value={compactLKR(s.money.expenses)} hint="Approved and paid" />
          </View>

          <SectionTitle>Sales breakdown</SectionTitle>
          <Card>
            <ListRow title="Gross sales" right={formatLKR(s.sales.grossSales)} />
            <ListRow title={`Returns (${s.sales.returnCount})`} right={formatLKR(s.sales.returns)} />
            <ListRow title="Discounts given" right={formatLKR(s.sales.discounts)} />
            <ListRow title="Tax collected" right={formatLKR(s.sales.tax)} />
          </Card>

          {s.payments.length > 0 ? (
            <>
              <SectionTitle>Payments received</SectionTitle>
              <Card>{s.payments.map((p) => <ListRow key={p.method} title={METHOD_LABEL[p.method] ?? p.method} right={formatLKR(p.amount)} />)}</Card>
            </>
          ) : null}

          {s.branches.length > 0 ? (
            <>
              <SectionTitle>Branches</SectionTitle>
              <Card>
                {s.branches.map((b, i) => (
                  <ListRow key={`${b.name}-${i}`} title={b.name} subtitle={`Profit ${compactLKR(b.grossProfit)} • stock ${compactLKR(b.atCost)} (${b.itemsInStock} items)`} right={compactLKR(b.revenue)} />
                ))}
              </Card>
            </>
          ) : null}

          <SectionTitle right={<Text style={adminStyles.muted}>{total} items</Text>}>Item by item</SectionTitle>
          <TextInput style={adminStyles.input} value={search} onChangeText={setSearch} placeholder="Name, SKU, barcode or category" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" returnKeyType="search" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            {SORTS.map((o) => (
              <Pressable key={o.value} onPress={() => setSort(o.value)} style={[styles.chip, sort === o.value && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: sort === o.value }}>
                <Text style={[styles.chipText, sort === o.value && { color: '#FFF' }]}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={[adminStyles.ghostBtn, { height: 42 }, exporting && { opacity: 0.6 }]} onPress={exportItems} disabled={exporting}>
            {exporting ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={adminStyles.ghostBtnText}>⬇  Export items CSV</Text>}
          </Pressable>

          {items.length === 0 && !loadingItems ? <Text style={adminStyles.empty}>{q ? 'No items match' : 'No items yet'}</Text> : null}
          {items.map((r, i) => (
            <Card key={r.itemId ?? `removed-${r.name}-${i}`} style={{ padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.itemName} numberOfLines={2}>{r.name}</Text>
                {!r.inCatalog ? <Pill text="removed" tone="warn" /> : !r.isActive ? <Pill text="inactive" /> : null}
              </View>
              {r.sku || r.barcode || r.category ? <Text style={adminStyles.muted} numberOfLines={1}>{[r.sku, r.barcode, r.category].filter(Boolean).join(' • ')}</Text> : null}
              <View style={styles.figures}>
                <Figure label="On hand" value={r.trackStock ? `${num(r.onHand)} ${r.unit ?? ''}` : '—'} />
                <Figure label="Stock at cost" value={num(r.stockAtCost)} />
                <Figure label="Cost / price" value={`${num(r.costPrice)} / ${num(r.sellingPrice)}`} />
                <Figure label="Sold" value={num(r.soldQty)} />
                <Figure label="Revenue" value={num(r.revenue)} />
                <Figure label="Cost of sales" value={num(r.costOfGoods)} />
                <Figure label="Profit" value={num(r.profit)} tone={r.profit < 0 ? 'error' : 'ok'} />
                <Figure label="Margin" value={r.marginPercent === null ? '—' : `${r.marginPercent}%`} />
              </View>
            </Card>
          ))}
          {loadingItems ? <ActivityIndicator color={THEME.colors.primary} /> : null}
          {items.length < total && !loadingItems ? (
            <Pressable style={[adminStyles.ghostBtn, { height: 42 }]} onPress={() => loadItems(page + 1)}>
              <Text style={adminStyles.ghostBtnText}>Load more ({total - items.length} left)</Text>
            </Pressable>
          ) : null}

          {can('vendors.impersonate') ? (
            <Pressable style={adminStyles.ghostBtn} onPress={() => router.push({ pathname: '/admin/vendor-data', params: { vendorId, vendorName } })}>
              <Text style={adminStyles.ghostBtnText}>🗄  All data and bulk export</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </AdminShell>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'error' }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, tone === 'error' && { color: THEME.colors.error }, tone === 'ok' && { color: THEME.colors.tertiary }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  chipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  itemName: { flexShrink: 1, fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  figures: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  figure: { width: '50%', paddingRight: 8 },
  figureLabel: { fontSize: 10, fontWeight: '700', color: THEME.colors.textMuted },
  figureValue: { fontSize: 13, fontWeight: '700', color: THEME.colors.text, fontFamily: 'monospace' },
})

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { apiGet, getUser, qs, type AuthUser } from '../src/lib/api'
import { hasPermission, roleLabel, displayRole } from '../src/lib/roles'
import { fetchCurrentShift, shiftWarehouseName, type Shift } from '../src/lib/shift'
import { THEME } from '../src/lib/theme'
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal'
import { LoadingView, EmptyView, ErrorView } from '../src/components/StateViews'
import { useHeaderPad } from '../src/lib/safeArea'
import { goBack } from '../src/lib/nav'

type MovementType = 'in' | 'out' | 'adjustment'

interface StockMovement {
  id: string
  type: MovementType
  quantity: string | number
  /** signed change (negative = stock decreased) */
  qtyChange?: string | number | null
  stockBefore?: string | number | null
  stockAfter?: string | number | null
  referenceType?: string | null
  referenceId?: string | null
  notes?: string | null
  createdAt: string
  itemId: string
  itemName?: string | null
  itemSku?: string | null
  itemBarcode?: string | null
  warehouseId?: string | null
  warehouseName?: string | null
  createdByName?: string | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const PAGE_SIZE = 40

const TYPE_LABELS: Record<MovementType, string> = {
  in: 'STOCK IN',
  out: 'STOCK OUT',
  adjustment: 'ADJUSTMENT',
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function referenceLabel(m: StockMovement) {
  const ref = (m.referenceType || '').replace(/_/g, ' ')
  return ref ? ref.charAt(0).toUpperCase() + ref.slice(1) : ''
}

export default function InventoryScreen() {
  const headerPad = useHeaderPad()
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [shift, setShift] = useState<Shift | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterType, setFilterType] = useState<'ALL' | MovementType>('ALL')
  const [branchOnly, setBranchOnly] = useState(true)
  const [isScannerOpen, setIsScannerOpen] = useState(false)

  const [movements, setMovements] = useState<StockMovement[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const canView = hasPermission(user ?? null, 'manageInventory')
  const warehouseId = branchOnly ? shift?.warehouseId || undefined : undefined

  useEffect(() => {
    getUser().then(setUser)
    fetchCurrentShift().then((r) => {
      if (r.ok) setShift(r.data.shift)
    })
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  const fetchPage = useCallback(
    async (page: number, mode: 'replace' | 'append' | 'refresh') => {
      const seq = ++requestSeq.current
      if (mode === 'replace') setLoading(true)
      if (mode === 'append') setLoadingMore(true)
      setError(null)

      const res = await apiGet<{ data: StockMovement[]; pagination: Pagination }>(
        `/api/stock-movements${qs({
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
          type: filterType === 'ALL' ? undefined : filterType,
          warehouseId,
        })}`
      )
      if (seq !== requestSeq.current) return

      if (!res.ok) {
        if (mode !== 'append') setMovements([])
        setError(res.error)
      } else {
        const rows = res.data?.data || []
        setMovements((prev) => (mode === 'append' ? [...prev, ...rows] : rows))
        setPagination(res.data?.pagination || null)
      }
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    },
    [debouncedSearch, filterType, warehouseId]
  )

  useEffect(() => {
    if (user === undefined) return
    if (!canView) {
      setLoading(false)
      return
    }
    fetchPage(1, 'replace')
  }, [user, canView, fetchPage])

  const hasMore = !!pagination && pagination.page < pagination.totalPages

  function loadMore() {
    if (!hasMore || loadingMore || loading || !pagination) return
    fetchPage(pagination.page + 1, 'append')
  }

  const renderItem = ({ item }: { item: StockMovement }) => {
    const qtyNum = Number(item.quantity) || 0
    // `quantity` is always unsigned; adjustments carry their direction in qtyChange
    // (or stockAfter − stockBefore), so a stock-take shortfall shows as a decrease.
    const change = item.qtyChange != null && item.qtyChange !== '' ? Number(item.qtyChange) : NaN
    const delta = item.stockAfter != null && item.stockBefore != null ? Number(item.stockAfter) - Number(item.stockBefore) : NaN
    const signed = item.type === 'out' ? -Math.abs(qtyNum) : item.type === 'in' ? Math.abs(qtyNum) : Number.isFinite(change) ? change : Number.isFinite(delta) ? delta : qtyNum
    const ref = referenceLabel(item)
    return (
      <View style={styles.movementCard}>
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.typeBadge,
                item.type === 'in' && styles.typeBadgeIn,
                item.type === 'out' && styles.typeBadgeOut,
                item.type === 'adjustment' && styles.typeBadgeAdjust,
              ]}
            >
              <Text
                style={[
                  styles.typeBadgeText,
                  item.type === 'in' && styles.typeBadgeTextIn,
                  item.type === 'out' && styles.typeBadgeTextOut,
                  item.type === 'adjustment' && styles.typeBadgeTextAdjust,
                ]}
              >
                {TYPE_LABELS[item.type] || String(item.type).toUpperCase()}
              </Text>
            </View>
            {item.itemSku ? <Text style={styles.skuText}>{item.itemSku}</Text> : null}
          </View>
          <Text style={styles.timeText}>{fmtDate(item.createdAt)}</Text>
        </View>

        <Text style={styles.itemName}>{item.itemName || 'Unknown item'}</Text>

        <View style={styles.detailsRow}>
          <Text style={styles.batchText}>{ref || (item.notes ? item.notes : 'Movement')}</Text>
          <Text style={styles.locationText}>{item.warehouseName || ''}</Text>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.balanceText}>
            By <Text style={styles.balanceValue}>{item.createdByName || 'System'}</Text>
          </Text>
          <Text style={[styles.quantityText, signed > 0 ? styles.quantityIn : signed < 0 ? styles.quantityOut : styles.quantityNeutral]}>
            {signed > 0 ? `+${signed}` : `${signed}`} units
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.safe}>
      <View style={[styles.header, headerPad]}>
        <TouchableOpacity onPress={() => goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Stock Ledger & Movements</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {shift ? shiftWarehouseName(shift) || 'All warehouses' : 'All warehouses'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setIsScannerOpen(true)} style={styles.scanBtn}>
          <Text style={styles.scanBtnText}>[|||]</Text>
        </TouchableOpacity>
      </View>

      {user === undefined ? (
        <LoadingView />
      ) : !canView ? (
        <EmptyView icon="🔒" title="Not available for your role" subtitle={`${displayRole(user)} accounts cannot view the stock ledger.`} />
      ) : (
        <FlatList
          data={movements}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.contentInner}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                fetchPage(1, 'refresh')
              }}
            />
          }
          ListHeaderComponent={
            <View>
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Movements</Text>
                  <Text style={styles.kpiValue}>{pagination ? pagination.total.toLocaleString() : '—'}</Text>
                  <Text style={styles.kpiSub}>matching filter</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Loaded</Text>
                  <Text style={[styles.kpiValue, { color: THEME.colors.tertiary }]}>{movements.length}</Text>
                  <Text style={styles.kpiSub}>of {pagination?.total ?? 0}</Text>
                </View>
                <TouchableOpacity style={[styles.kpiCard, branchOnly && styles.kpiCardActive]} onPress={() => setBranchOnly((v) => !v)} disabled={!shift?.warehouseId}>
                  <Text style={styles.kpiLabel}>Scope</Text>
                  <Text style={[styles.kpiValue, { fontSize: 12 }]} numberOfLines={1}>
                    {branchOnly && shift?.warehouseId ? shiftWarehouseName(shift) || 'This branch' : 'All branches'}
                  </Text>
                  <Text style={styles.kpiSub}>{shift?.warehouseId ? 'tap to toggle' : 'no open shift'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.searchContainer}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search item name, SKU or barcode..."
                  placeholderTextColor={THEME.colors.textSubtle}
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() => setDebouncedSearch(searchQuery.trim())}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Text style={styles.clearIcon}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.filterRow}>
                {(
                  [
                    { id: 'ALL', label: 'All Movements' },
                    { id: 'in', label: 'Stock In' },
                    { id: 'out', label: 'Stock Out' },
                    { id: 'adjustment', label: 'Adjustments' },
                  ] as Array<{ id: 'ALL' | MovementType; label: string }>
                ).map((f) => (
                  <TouchableOpacity key={f.id} onPress={() => setFilterType(f.id)} style={[styles.filterPill, filterType === f.id && styles.filterPillActive]}>
                    <Text style={[styles.filterPillText, filterType === f.id && styles.filterPillTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {loading ? <LoadingView text="Loading stock movements…" /> : null}
              {!loading && error ? <ErrorView message={error} onRetry={() => fetchPage(1, 'replace')} /> : null}
              {!loading && !error && movements.length === 0 ? (
                <EmptyView icon="📦" title="No stock movements" subtitle="Nothing matches the current filter." />
              ) : null}
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={{ padding: 16 }}>
                <ActivityIndicator color={THEME.colors.primary} />
              </View>
            ) : hasMore ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore}>
                <Text style={styles.loadMoreText}>Load more</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      <BarcodeScannerModal
        visible={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onBarcodeScanned={(barcode) => {
          setSearchQuery(barcode)
          setDebouncedSearch(barcode)
          setIsScannerOpen(false)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.colors.surface },
  header: {
    paddingTop: 44,
    height: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: THEME.spacing.lg,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backButton: { width: 36, height: 36, borderRadius: THEME.radius.md, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  headerSub: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted },
  scanBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: THEME.radius.md, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  scanBtnText: { color: THEME.colors.onPrimary, fontFamily: 'monospace', fontWeight: '700', fontSize: 12 },
  contentInner: { padding: THEME.spacing.lg, paddingBottom: 40, gap: 10 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: THEME.spacing.md },
  kpiCard: { flex: 1, backgroundColor: THEME.colors.card, padding: 10, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border },
  kpiCardActive: { borderColor: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight },
  kpiLabel: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted, textTransform: 'uppercase' },
  kpiValue: { fontSize: 15, fontWeight: '800', fontFamily: 'monospace', color: THEME.colors.primary, marginTop: 4 },
  kpiSub: { fontSize: 9, color: THEME.colors.textSubtle, marginTop: 2 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border, paddingHorizontal: 12, height: 44, marginBottom: THEME.spacing.md },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 13, color: THEME.colors.text },
  clearIcon: { fontSize: 14, color: THEME.colors.textMuted },
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: THEME.spacing.sm, flexWrap: 'wrap' },
  filterPill: { backgroundColor: THEME.colors.surfaceContainerHigh, paddingHorizontal: 12, paddingVertical: 6, borderRadius: THEME.radius.full },
  filterPillActive: { backgroundColor: THEME.colors.primary },
  filterPillText: { fontSize: 11, fontWeight: '600', color: THEME.colors.textMuted },
  filterPillTextActive: { color: THEME.colors.onPrimary },
  movementCard: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, padding: 14, borderWidth: 1, borderColor: THEME.colors.border, gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: THEME.radius.xs },
  typeBadgeIn: { backgroundColor: THEME.colors.tertiaryLight },
  typeBadgeOut: { backgroundColor: THEME.colors.surfaceContainerHigh },
  typeBadgeAdjust: { backgroundColor: THEME.colors.secondaryLight },
  typeBadgeText: { fontSize: 9, fontFamily: 'monospace', fontWeight: '800', color: THEME.colors.text },
  typeBadgeTextIn: { color: THEME.colors.tertiary },
  typeBadgeTextOut: { color: THEME.colors.textMuted },
  typeBadgeTextAdjust: { color: THEME.colors.secondary },
  skuText: { fontSize: 11, fontFamily: 'monospace', color: THEME.colors.textMuted },
  timeText: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textSubtle },
  itemName: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  detailsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  batchText: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted, flexShrink: 1 },
  locationText: { fontSize: 10, color: THEME.colors.textSubtle },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: THEME.colors.border, marginTop: 2 },
  balanceText: { fontSize: 11, color: THEME.colors.textMuted },
  balanceValue: { fontWeight: '700', color: THEME.colors.text, fontFamily: 'monospace' },
  quantityText: { fontSize: 14, fontWeight: '800', fontFamily: 'monospace' },
  quantityIn: { color: THEME.colors.tertiary },
  quantityOut: { color: THEME.colors.error },
  quantityNeutral: { color: THEME.colors.text },
  loadMoreBtn: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: THEME.colors.surfaceContainerHigh },
  loadMoreText: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
})

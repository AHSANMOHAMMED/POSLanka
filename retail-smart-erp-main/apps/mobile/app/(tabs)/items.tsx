// Items tab: look up any item (search or camera scan) with price + stock, the stock tools
// (intake, labels, stock ledger) and — for report roles — the low-stock list.
//   GET /api/items?search=…            item search (stock / selling module)
//   GET /api/items/barcode-lookup      camera scan
//   GET /api/dashboard/owner           low-stock list (viewReports)
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, ActivityIndicator, Keyboard } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, asList, isNetworkError, qs } from '../../src/lib/api'
import { hasPermission } from '../../src/lib/roles'
import { THEME, formatLKR } from '../../src/lib/theme'
import { useSessionUser } from '../../src/lib/session'
import { useFeatureFlags } from '../../src/lib/features'
import { visibleFeatures } from '../../src/lib/modules'
import { BarcodeScannerModal } from '../../src/components/BarcodeScannerModal'
import { Badge, Banner, Card, EmptyState, IconBubble, ListItem, ScreenHeader, SectionHeader, Skeleton, uiStyles } from '../../src/components/ui'

interface ItemRow {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  sellingPrice?: string | number | null
  costPrice?: string | number | null
  unit?: string | null
  trackStock?: boolean
  currentStock?: string | number | null
  availableStock?: string | number | null
  categoryName?: string | null
  category?: { name?: string | null } | null
}

interface LowStockRow {
  itemId: string
  name: string
  warehouse?: string | null
  current: number
  reorderLevel: number
}

function stockOf(i: ItemRow): number | null {
  if (i.trackStock === false) return null
  const raw = i.availableStock ?? i.currentStock
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export default function ItemsTab() {
  const { user } = useSessionUser()
  const features = useFeatureFlags()
  const params = useLocalSearchParams<{ scan?: string }>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ItemRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scannerVisible, setScannerVisible] = useState(false)
  const [scanned, setScanned] = useState<ItemRow | null>(null)
  const [lowStock, setLowStock] = useState<LowStockRow[] | null>(null)
  const seq = useRef(0)

  // Home "Scan item" quick action opens the scanner straight away.
  useEffect(() => {
    if (params.scan) setScannerVisible(true)
  }, [params.scan])

  useEffect(() => {
    if (!hasPermission(user, 'viewReports')) return
    apiGet<any>(`/api/dashboard/owner${qs({ topItems: 1 })}`).then((r) => {
      if (r.ok && r.data?.lowStock?.list) setLowStock(r.data.lowStock.list as LowStockRow[])
    })
  }, [user])

  const search = useCallback(async (q: string) => {
    const s = ++seq.current
    if (!q.trim()) {
      setResults(null)
      setError(null)
      return
    }
    setBusy(true)
    const res = await apiGet<any>(`/api/items${qs({ search: q.trim(), pageSize: 30 })}`)
    if (s !== seq.current) return
    setBusy(false)
    if (res.ok) {
      setResults(asList<ItemRow>(res.data))
      setError(null)
    } else {
      setResults([])
      setError(isNetworkError(res) ? 'Offline — item search needs a connection.' : res.error)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(query), 300)
    return () => clearTimeout(t)
  }, [query, search])

  async function onScanned(code: string) {
    setScannerVisible(false)
    setBusy(true)
    const res = await apiGet<ItemRow>(`/api/items/barcode-lookup${qs({ barcode: code.trim() })}`)
    setBusy(false)
    if (res.ok && res.data?.id) {
      setScanned(res.data)
      setError(null)
    } else {
      setScanned(null)
      setQuery(code.trim())
      setError(res.status === 404 ? `No item with barcode ${code}` : res.error)
    }
  }

  const tools = visibleFeatures(user, features.has, ['stock'])

  const header = (
    <View>
      {scanned ? (
        <Card style={{ marginBottom: 12 }}>
          <View style={styles.scanHead}>
            <Badge text="Scanned" tone="ok" icon="barcode-outline" />
            <Pressable onPress={() => setScanned(null)} hitSlop={10} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={20} color={THEME.colors.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.scanName}>{scanned.name}</Text>
          <Text style={styles.muted}>{[scanned.sku && `SKU ${scanned.sku}`, scanned.barcode && `Barcode ${scanned.barcode}`].filter(Boolean).join(' · ') || 'No codes'}</Text>
          <View style={styles.scanStats}>
            <Stat label="Price" value={formatLKR(scanned.sellingPrice)} />
            <Stat label="In stock" value={stockOf(scanned) === null ? '—' : `${stockOf(scanned)} ${scanned.unit || ''}`} />
          </View>
        </Card>
      ) : null}

      {!query ? (
        <>
          {tools.length > 0 ? (
            <View style={styles.tools}>
              {tools.map((t) => (
                <Pressable key={t.key} style={({ pressed }) => [styles.tool, pressed && { opacity: 0.7 }]} onPress={() => t.route && router.push(t.route as any)}>
                  <IconBubble name={t.icon} tone={t.tone} size={44} />
                  <Text style={styles.toolTitle} numberOfLines={1}>
                    {t.title}
                  </Text>
                  <Text style={styles.toolSub} numberOfLines={2}>
                    {t.subtitle}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {lowStock ? (
            <>
              <SectionHeader title={`Low stock (${lowStock.length})`} />
              <Card style={uiStyles.listCard}>
                {lowStock.length === 0 ? (
                  <EmptyState icon="checkmark-circle-outline" tone="ok" title="Stock levels are healthy" subtitle="No item is below its reorder level." />
                ) : (
                  lowStock.slice(0, 25).map((r, i) => (
                    <ListItem
                      key={`${r.itemId}-${r.warehouse}-${i}`}
                      icon={r.current <= 0 ? 'close-circle-outline' : 'alert-circle-outline'}
                      iconTone={r.current <= 0 ? 'error' : 'warn'}
                      title={r.name}
                      subtitle={`${r.warehouse || 'Branch'} · reorder at ${r.reorderLevel}`}
                      right={<Badge text={r.current <= 0 ? 'Out' : String(r.current)} tone={r.current <= 0 ? 'error' : 'warn'} />}
                      last={i === Math.min(lowStock.length, 25) - 1}
                    />
                  ))
                )}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  )

  return (
    <View style={uiStyles.screen}>
      <ScreenHeader title="Items" subtitle="Look up price & stock" back={false} />

      {/* Search + scan */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={THEME.colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, SKU or barcode"
            placeholderTextColor={THEME.colors.textSubtle}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {busy ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={20} color={THEME.colors.textSubtle} />
            </Pressable>
          ) : null}
        </View>
        <Pressable style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.8 }]} onPress={() => setScannerVisible(true)} accessibilityLabel="Scan barcode">
          <Ionicons name="barcode-outline" size={26} color={THEME.colors.onPrimary} />
        </Pressable>
      </View>
      {error ? <Banner text={error} tone="error" icon="alert-circle-outline" /> : null}

      <FlatList
        data={query ? results || [] : []}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[uiStyles.content, { paddingBottom: 24 }]}
        ListHeaderComponent={header}
        ListEmptyComponent={
          query ? (
            results === null || busy ? (
              <View style={{ gap: 10 }}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} height={56} radius={12} />
                ))}
              </View>
            ) : (
              <EmptyState icon="search-outline" title="No items found" subtitle="Try another name, SKU or scan the barcode." />
            )
          ) : null
        }
        renderItem={({ item, index }) => {
          const stock = stockOf(item)
          return (
            <Card style={[styles.itemCard, index === 0 && { marginTop: 0 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {[item.sku && `SKU ${item.sku}`, item.barcode, item.category?.name || item.categoryName].filter(Boolean).join(' · ') || 'Item'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.price}>{formatLKR(item.sellingPrice)}</Text>
                {stock === null ? (
                  <Badge text="Untracked" />
                ) : (
                  <Badge text={stock <= 0 ? 'Out of stock' : `${stock} ${item.unit || 'in stock'}`} tone={stock <= 0 ? 'error' : stock < 5 ? 'warn' : 'ok'} />
                )}
              </View>
            </Card>
          )
        }}
      />

      <BarcodeScannerModal visible={scannerVisible} onClose={() => setScannerVisible(false)} onBarcodeScanned={onScanned} title="Scan item" />
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  searchWrap: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: THEME.colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.border },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, paddingHorizontal: 12, borderRadius: 14, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border },
  searchInput: { flex: 1, fontSize: 15, color: THEME.colors.text, paddingVertical: 8 },
  scanBtn: { width: 50, height: 50, borderRadius: 14, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tool: { flexGrow: 1, flexBasis: '30%', minWidth: 100, minHeight: 116, padding: 12, borderRadius: 16, backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border, gap: 4 },
  toolTitle: { fontSize: 14, fontWeight: '800', color: THEME.colors.text, marginTop: 4 },
  toolSub: { fontSize: 11, color: THEME.colors.textMuted },
  muted: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingVertical: 12 },
  itemName: { fontSize: 15, fontWeight: '700', color: THEME.colors.text },
  price: { fontSize: 15, fontWeight: '800', color: THEME.colors.primary, fontVariant: ['tabular-nums'] },
  scanHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  scanName: { fontSize: 17, fontWeight: '800', color: THEME.colors.text },
  scanStats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stat: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: THEME.colors.surfaceContainerLow },
  statLabel: { fontSize: 11, fontWeight: '700', color: THEME.colors.textMuted },
  statValue: { fontSize: 16, fontWeight: '800', color: THEME.colors.text, marginTop: 2 },
})

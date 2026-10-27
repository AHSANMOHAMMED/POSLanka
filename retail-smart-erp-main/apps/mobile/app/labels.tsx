import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator, Alert, ScrollView } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { apiGet, asList, getUser, qs } from '../src/lib/api'
import { THEME } from '../src/lib/theme'
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal'
import { InlineNotice, EmptyView, LoadingView } from '../src/components/StateViews'
import { hasAnyPermission, displayRole } from '../src/lib/roles'
import type { AuthUser } from '../src/lib/api'
import { getPrinterForRole, printerErrorMessage, printLabels, stickerSetupForPrinter, type PrinterConfig } from '../src/lib/printer'
import type { StickerSetup } from '../src/lib/label/stickerStock'
import { labelCurrencySymbol, type LabelItemData, type LabelTemplate } from '../src/lib/label'
import { loadBusinessInfo } from '../src/lib/receipt'
import { useHeaderPad, useBottomPad } from '../src/lib/safeArea'
import { goBack } from '../src/lib/nav'
import { ScreenHeader, IconButton, Badge } from '../src/components/ui'

/** Shape accepted in the `items` route param (JSON array). */
interface PreselectedItem {
  itemId?: string
  id?: string
  name?: string
  barcode?: string | null
  sku?: string | null
  price?: number | string | null
  qty?: number | string | null
}

interface Row {
  key: string
  item: LabelItemData
  quantity: number
}

const UUID_RE = /^[0-9a-f-]{36}$/i

function toLabelItem(raw: any): LabelItemData {
  return {
    id: String(raw?.id ?? raw?.itemId ?? ''),
    name: String(raw?.name ?? ''),
    sku: raw?.sku || null,
    barcode: raw?.barcode || null,
    sellingPrice: String(raw?.sellingPrice ?? raw?.price ?? '0'),
    costPrice: String(raw?.costPrice ?? '0'),
    brand: raw?.brand || null,
    oemPartNumber: raw?.oemPartNumber || null,
    pluCode: raw?.pluCode || null,
    category: (typeof raw?.category === 'object' ? raw?.category?.name : raw?.category) || null,
    unit: raw?.unit || 'pcs',
    weight: raw?.weight ? String(raw.weight) : null,
    dimensions: raw?.dimensions || null,
    imageUrl: raw?.imageUrl || null,
  }
}

function rowKey(i: LabelItemData): string {
  return i.id || `${i.barcode || ''}|${i.sku || ''}|${i.name}`
}

function parseParamItems(param: string | string[] | undefined): Row[] {
  const raw = Array.isArray(param) ? param[0] : param
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list
      .filter((p: PreselectedItem) => p && (p.name || p.barcode || p.sku || p.itemId || p.id))
      .map((p: PreselectedItem) => {
        const item = toLabelItem({ ...p, id: p.itemId || p.id || '' })
        const qty = Math.round(Number(p.qty))
        return { key: rowKey(item), item, quantity: Number.isFinite(qty) && qty > 0 ? Math.min(999, qty) : 1 }
      })
  } catch {
    return []
  }
}

export default function LabelsScreen() {
  const bottomPad = useBottomPad()
  const headerPad = useHeaderPad()
  const params = useLocalSearchParams<{ items?: string }>()
  const [rows, setRows] = useState<Row[]>(() => parseParamItems(params.items))
  const [templates, setTemplates] = useState<LabelTemplate[] | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [printer, setPrinter] = useState<PrinterConfig | null | undefined>(undefined)
  const [codeWord, setCodeWord] = useState('')
  const [tenantName, setTenantName] = useState<string | undefined>(undefined)
  // Tenant currency (cached business info, works offline); LKR → "Rs" like the web labels.
  const [currencySymbol, setCurrencySymbol] = useState(() => labelCurrencySymbol(null))
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LabelItemData[]>([])
  const [searching, setSearching] = useState(false)
  const [scanner, setScanner] = useState(false)
  const [printing, setPrinting] = useState(false)
  // Label roll setup from the server (columns across, gaps, calibration) for this printer
  const [setup, setSetup] = useState<StickerSetup | null>(null)
  useEffect(() => {
    if (!printer) return
    stickerSetupForPrinter(printer).then(setSetup).catch(() => setSetup(null))
  }, [printer])
  const searchSeq = useRef(0)
  // undefined = loading; label printing needs an item-handling or selling permission
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  useEffect(() => {
    getUser().then((u) => setUser(u)).catch(() => setUser(null))
  }, [])
  const canUseLabels = hasAnyPermission(user, ['manageItems', 'manageInventory', 'submitStockIntake', 'createSales'])

  // Templates, printer, code word, tenant name
  useEffect(() => {
    apiGet<LabelTemplate[]>('/api/label-templates').then((res) => {
      if (!res.ok) {
        setTemplatesError(res.error)
        setTemplates([])
        return
      }
      const list = asList<LabelTemplate>(res.data).filter((t) => t && Array.isArray(t.elements))
      setTemplates(list)
      setTemplateId((cur) => cur || (list.find((t) => t.isDefault) || list[0])?.id || null)
    })
    apiGet<{ codeWord?: string }>('/api/label-settings').then((res) => {
      if (res.ok && typeof res.data?.codeWord === 'string') setCodeWord(res.data.codeWord)
    })
    getUser().then((u) => setTenantName(u?.tenantName || undefined))
    loadBusinessInfo()
      .then((b) => setCurrencySymbol(labelCurrencySymbol(b.currency)))
      .catch(() => undefined)
    getPrinterForRole('label')
      .then(setPrinter)
      .catch(() => setPrinter(null))
  }, [])

  // Enrich preselected items (from intake etc.) with full item data for price / brand fields.
  useEffect(() => {
    const initial = parseParamItems(params.items)
    if (!initial.length) return
    let cancelled = false
    ;(async () => {
      const ids = initial.map((r) => r.item.id).filter((id) => UUID_RE.test(id))
      const byId = new Map<string, LabelItemData>()
      if (ids.length) {
        const res = await apiGet(`/api/items${qs({ ids: ids.join(','), pageSize: Math.min(100, ids.length) })}`)
        if (res.ok) for (const it of asList(res.data)) byId.set(String(it.id), toLabelItem(it))
      }
      const enriched: Row[] = []
      for (const r of initial) {
        let full = byId.get(r.item.id) || null
        const code = r.item.barcode || r.item.sku
        if (!full && code) {
          const res = await apiGet(`/api/items${qs({ search: code, pageSize: 10 })}`)
          if (res.ok) {
            const hit = asList(res.data).find((it: any) => (r.item.barcode && it.barcode === r.item.barcode) || (r.item.sku && it.sku === r.item.sku))
            if (hit) full = toLabelItem(hit)
          }
        }
        enriched.push(full ? { key: rowKey(full), item: full, quantity: r.quantity } : r)
      }
      if (!cancelled) {
        setRows((cur) => {
          // keep any items the user added meanwhile
          const extra = cur.filter((c) => !initial.some((i) => i.key === c.key))
          return [...enriched, ...extra]
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.items])

  // Debounced item search
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(async () => {
      const res = await apiGet(`/api/items${qs({ search: q, pageSize: 20 })}`)
      if (seq !== searchSeq.current) return
      setResults(res.ok ? asList(res.data).map(toLabelItem) : [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const addItem = useCallback((item: LabelItemData, qty = 1) => {
    setRows((cur) => {
      const key = rowKey(item)
      const i = cur.findIndex((r) => r.key === key)
      if (i >= 0) return cur.map((r, j) => (j === i ? { ...r, quantity: Math.min(999, r.quantity + qty) } : r))
      return [...cur, { key, item, quantity: qty }]
    })
  }, [])

  const onScanned = useCallback(
    async (code: string) => {
      const value = code.trim()
      if (!value) return
      const res = await apiGet(`/api/items${qs({ search: value, pageSize: 10 })}`)
      const list = res.ok ? asList(res.data) : []
      const hit = list.find((it: any) => it.barcode === value || it.sku === value) || (list.length === 1 ? list[0] : null)
      if (hit) addItem(toLabelItem(hit))
      else Alert.alert('Not found', `No item matches "${value}".`)
    },
    [addItem]
  )

  const setQty = (key: string, qty: number) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, quantity: Math.max(0, Math.min(999, Math.round(qty) || 0)) } : r)))
  const remove = (key: string) => setRows((cur) => cur.filter((r) => r.key !== key))

  const template = useMemo(() => templates?.find((t) => t.id === templateId) || null, [templates, templateId])
  const total = rows.reduce((n, r) => n + r.quantity, 0)

  async function onPrint() {
    if (!printer || printer.transport === 'none') {
      Alert.alert('No label printer', 'Add a label printer in Printer settings first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Printer settings', onPress: () => router.push('/printer') },
      ])
      return
    }
    if (!template) {
      Alert.alert('Template', 'Choose a label template. Templates are designed in the web app (Barcode → Label templates).')
      return
    }
    if (total <= 0) {
      Alert.alert('Nothing to print', 'Add items and set how many labels to print.')
      return
    }
    setPrinting(true)
    try {
      const res = await printLabels(
        template,
        rows.filter((r) => r.quantity > 0).map((r) => ({ item: r.item, quantity: r.quantity })),
        { currencySymbol, tenantName, codeWord: codeWord || undefined, setup },
        printer
      )
      Alert.alert('Labels sent', `${res.labels} label${res.labels === 1 ? '' : 's'} sent to ${res.printer.name}.${res.warnings.length ? `\n\n${res.warnings.slice(0, 5).join('\n')}` : ''}`)
    } catch (e) {
      Alert.alert('Print failed', printerErrorMessage(e))
    } finally {
      setPrinting(false)
    }
  }

  const mediaW = setup ? setup.labelWidthMm : printer?.label?.widthMm
  const mediaH = setup ? setup.labelHeightMm : printer?.label?.heightMm
  const sizeMismatch =
    template && mediaW != null && mediaH != null && (Math.abs(Number(template.widthMm) - mediaW) > 0.5 || Math.abs(Number(template.heightMm) - mediaH) > 0.5)

  if (user === undefined || !canUseLabels) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Print labels" />
        {user === undefined ? (
          <LoadingView />
        ) : (
          <EmptyView icon="🔒" title="Not available for your role" subtitle={`${displayRole(user)} accounts cannot print item labels.`} />
        )}
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Print labels"
        subtitle={printer === undefined ? 'Loading printer…' : printer ? `${printer.name} · ${(printer.label?.language || 'tspl').toUpperCase()} · ${printer.label?.dpi || 203} dpi` : 'No label printer configured'}
        right={<IconButton name="settings-outline" label="Label printer settings" onPress={() => router.push('/printer')} />}
      />

      {printer === null && <InlineNotice text="No label printer yet. Tap the gear icon to add one (role: Label printer)." />}
      {printer?.label?.language === 'escpos-raster' && <InlineNotice tone="error" text="ESC/POS raster labels are not supported on mobile. Switch the printer language to TSPL, ZPL or EPL." />}
      {templatesError ? <InlineNotice tone="error" text={`Templates: ${templatesError}`} /> : null}
      {setup ? <InlineNotice text={`Roll: ${setup.name} (${setup.columns} across, ${setup.labelWidthMm} x ${setup.labelHeightMm} mm)${setup.locked ? ' · locked' : ''}`} /> : null}
      {sizeMismatch ? <InlineNotice text={`Template is ${Number(template!.widthMm)} x ${Number(template!.heightMm)} mm but the ${setup ? 'roll labels are' : 'printer is set to'} ${mediaW} x ${mediaH} mm.`} /> : null}

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Template</Text>
        {templates === null ? (
          <ActivityIndicator color={THEME.colors.primary} />
        ) : templates.length === 0 ? (
          <Text style={styles.muted}>No label templates. Create one in the web app under Barcode → Label templates.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {templates.map((t) => {
              const active = t.id === templateId
              return (
                <Pressable key={t.id} style={[styles.chip, active && styles.chipActive]} onPress={() => setTemplateId(t.id)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={[styles.chipSub, active && styles.chipTextActive]}>
                    {Number(t.widthMm)} x {Number(t.heightMm)} mm
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search items by name, SKU or barcode"
            placeholderTextColor={THEME.colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.scanBtn} onPress={() => setScanner(true)}>
            <Text style={{ fontSize: 18 }}>📷</Text>
          </Pressable>
        </View>
        {searching ? <ActivityIndicator color={THEME.colors.primary} style={{ marginTop: 6 }} /> : null}
        {results.length > 0 && (
          <View style={styles.results}>
            <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
              {results.map((it) => (
                <Pressable
                  key={rowKey(it)}
                  style={styles.resultRow}
                  onPress={() => {
                    addItem(it)
                    setQuery('')
                    setResults([])
                  }}
                >
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {it.name}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {[it.sku, it.barcode, `${currencySymbol.trim()} ${Number(it.sellingPrice || 0).toFixed(2)}`].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', marginTop: 24 }]}>Search or scan items to add labels.</Text>}
        renderItem={({ item: r }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {r.item.name || r.item.barcode || r.item.sku}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {[r.item.sku, r.item.barcode, `${currencySymbol.trim()} ${Number(r.item.sellingPrice || 0).toFixed(2)}`].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pressable style={styles.stepBtn} onPress={() => setQty(r.key, r.quantity - 1)}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <TextInput style={styles.qtyInput} keyboardType="number-pad" value={String(r.quantity)} onChangeText={(v) => setQty(r.key, Number(v.replace(/[^0-9]/g, '')))} />
            <Pressable style={styles.stepBtn} onPress={() => setQty(r.key, r.quantity + 1)}>
              <Text style={styles.stepText}>＋</Text>
            </Pressable>
            <Pressable onPress={() => remove(r.key)} hitSlop={8}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(16, bottomPad + 12) }]}>
        <Pressable style={[styles.primaryBtn, (printing || total <= 0) && { opacity: 0.6 }]} disabled={printing || total <= 0} onPress={onPrint}>
          {printing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>🏷️ Print {total} label{total === 1 ? '' : 's'}</Text>}
        </Pressable>
      </View>

      <BarcodeScannerModal visible={scanner} continuous title="Scan items to label" onClose={() => setScanner(false)} onBarcodeScanned={(v) => void onScanned(v)} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    gap: 10,
  },
  backBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  iconBtn: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
  panel: { backgroundColor: '#FFFFFF', padding: 16, borderBottomWidth: 1, borderBottomColor: THEME.colors.border, gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow, maxWidth: 200 },
  chipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  chipSub: { fontSize: 10, color: THEME.colors.textMuted },
  chipTextActive: { color: '#FFF' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME.colors.text,
  },
  scanBtn: { width: 46, height: 44, borderRadius: 10, backgroundColor: THEME.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  results: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, overflow: 'hidden' },
  resultRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.border, backgroundColor: '#FFF' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: THEME.colors.border },
  cardTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  muted: { fontSize: 12, color: THEME.colors.textMuted },
  stepBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  qtyInput: { width: 50, height: 34, borderRadius: 8, borderWidth: 1, borderColor: THEME.colors.border, textAlign: 'center', fontSize: 14, fontWeight: '700', color: THEME.colors.text, padding: 0 },
  removeText: { fontSize: 16, fontWeight: '800', color: THEME.colors.error, paddingHorizontal: 4 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: THEME.colors.border },
  primaryBtn: { height: 52, borderRadius: 12, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
})

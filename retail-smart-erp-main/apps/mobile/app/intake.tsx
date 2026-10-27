import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { router } from 'expo-router'
import { api, apiGet, asList, getUser, type AuthUser } from '../src/lib/api'
import { hasPermission } from '../src/lib/roles'
import { fetchCurrentShift, shiftWarehouseName } from '../src/lib/shift'
import { THEME } from '../src/lib/theme'
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal'
import { LoadingView, EmptyView, InlineNotice } from '../src/components/StateViews'
import { findByCode } from '../src/lib/localdb'
import {
  addLocalLine,
  adoptServerBatch,
  createLocalBatch,
  forgetLocalBatch,
  newId,
  removeLocalLine,
  retryLocalLine,
  startIntakeAutoSync,
  subscribeIntake,
  uploadBatch,
  type IntakeMode,
  type IntakeStoreState,
  type LocalIntakeBatch,
} from '../src/lib/intakeStore'
import { useHeaderPad, useBottomPad } from '../src/lib/safeArea'
import { ScreenHeader, IconButton, Badge } from '../src/components/ui'

interface Warehouse { id: string; name: string }

interface ServerBatchSummary {
  id: string
  batchNo: string
  warehouseId: string
  warehouseName: string | null
  status: string
  totalLines: number
  postedLines: number
  errorLines: number
  createdAt: string
}

interface ServerLine {
  id: string
  lineMode: IntakeMode
  barcode: string | null
  sku: string | null
  quantity: string
  name: string | null
  sellingPrice: string | null
  status: 'pending' | 'posted' | 'error' | 'skipped'
  errorMessage: string | null
  match: { status: string; item: { name: string; itemCode: string; currentStock: number } | null; error?: string }
  warnings: string[]
}

interface ServerDetail {
  batch: ServerBatchSummary & { version: number; notes: string | null; source: string }
  lines: ServerLine[]
  summary: { total: number; pending: number; posted: number; errors: number; newItems: number }
}

/** POST /api/stock-intake/[id]/validate (dry run) */
interface IntakeValidation {
  willAdd: Array<{ lineId: string; itemName: string; currentStock: number; delta: number; after: number }>
  willCreate: Array<{ lineId: string; name: string; quantity: number }>
  conflicts: Array<{ lineId: string; barcode: string | null; sku: string | null; barcodeItem: { name: string }; skuItem: { name: string } }>
  priceChanges?: Array<{ lineId: string; itemName: string; currentPrice: number; newPrice: number; decision: 'apply' | 'keep' | null }>
  errors: Array<{ lineId: string; error: string }>
}

interface SyncResult {
  status: string
  posted: number
  errors: Array<{ lineId: string; error: string }>
  createdItems: Array<{ name: string; itemCode: string }>
  noop?: boolean
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  syncing: 'Syncing',
  posted: 'Posted',
  partially_posted: 'Partly posted',
  cancelled: 'Cancelled',
}
const OPEN_BATCH = ['draft', 'submitted', 'partially_posted']

function fmtQty(q: string | number) {
  const n = Number(q)
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '')
}

export default function IntakeScreen() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [store, setStore] = useState<IntakeStoreState>({ batches: [], pendingLines: 0, uploading: false, online: true })
  const [activeId, setActiveId] = useState<string | null>(null) // clientBatchId

  useEffect(() => {
    getUser().then(setUser)
    startIntakeAutoSync()
    return subscribeIntake(setStore)
  }, [])

  const active = store.batches.find((b) => b.clientBatchId === activeId) || null

  if (user === undefined) return <LoadingView />
  if (!hasPermission(user, 'submitStockIntake')) {
    return (
      <View style={styles.screen}>
        <Header title="Stock Intake" onBack={() => router.back()} />
        <EmptyView icon="🔒" title="No access" subtitle="You do not have permission to receive stock." />
      </View>
    )
  }

  return active
    ? <BatchView user={user} batch={active} online={store.online} onBack={() => setActiveId(null)} />
    : <BatchList store={store} onOpen={setActiveId} />
}

// ============================================================================
// Batch list + new batch
// ============================================================================

function BatchList({ store, onOpen }: { store: IntakeStoreState; onOpen: (clientBatchId: string) => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [shiftWarehouse, setShiftWarehouse] = useState<Warehouse | null>(null)
  const [serverBatches, setServerBatches] = useState<ServerBatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const [shiftRes, mineRes, allRes, batchesRes] = await Promise.all([
      fetchCurrentShift(),
      apiGet('/api/warehouses?all=true&activeOnly=true&userOnly=true'),
      apiGet('/api/warehouses?all=true&activeOnly=true'),
      apiGet('/api/stock-intake?mine=true&pageSize=50'),
    ])
    const shift = shiftRes.ok ? shiftRes.data.shift : null
    if (shift?.warehouseId) setShiftWarehouse({ id: shift.warehouseId, name: shiftWarehouseName(shift) || 'Shift branch' })
    const mine = mineRes.ok ? asList<Warehouse>(mineRes.data, 'data', 'warehouses') : []
    const all = allRes.ok ? asList<Warehouse>(allRes.data, 'data', 'warehouses') : []
    setWarehouses(mine.length ? mine : all)
    if (batchesRes.ok) setServerBatches(asList<ServerBatchSummary>(batchesRes.data, 'data'))
    else setError(batchesRes.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const startBatch = async (wh: Warehouse) => {
    setPicking(false)
    setCreating(true)
    try {
      const b = await createLocalBatch({ warehouseId: wh.id, warehouseName: wh.name })
      void uploadBatch(b.clientBatchId) // offline is fine: it stays local and uploads later
      onOpen(b.clientBatchId)
    } finally {
      setCreating(false)
    }
  }

  const openServer = async (s: ServerBatchSummary) => {
    const local = await adoptServerBatch(s)
    onOpen(local.clientBatchId)
  }

  const localOnly = store.batches.filter((b) => !b.serverId || b.lines.length > 0)
  const serverOpen = serverBatches.filter((s) => OPEN_BATCH.includes(s.status))
  const serverDone = serverBatches.filter((s) => !OPEN_BATCH.includes(s.status)).slice(0, 15)

  return (
    <View style={styles.screen}>
      <Header title="Stock Intake" onBack={() => router.back()} />
      {!store.online && <InlineNotice text="Offline: scans are saved on this device and upload automatically." />}
      {loading ? <LoadingView /> : (
        <ScrollView
          contentContainerStyle={{ padding: THEME.spacing.lg, gap: THEME.spacing.md }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        >
          <Pressable style={[styles.primaryBtn, creating && { opacity: 0.6 }]} disabled={creating}
            onPress={() => {
              if (shiftWarehouse && warehouses.length <= 1) void startBatch(shiftWarehouse)
              else setPicking(true)
            }}>
            <Text style={styles.primaryBtnText}>＋ New intake batch{shiftWarehouse ? ` · ${shiftWarehouse.name}` : ''}</Text>
          </Pressable>
          {error ? <InlineNotice tone="error" text={error} /> : null}

          {localOnly.length > 0 && <Text style={styles.sectionTitle}>On this device</Text>}
          {localOnly.map((b) => (
            <Pressable key={b.clientBatchId} style={styles.card} onPress={() => onOpen(b.clientBatchId)}>
              <Text style={styles.cardTitle}>{b.batchNo || 'New batch (not uploaded)'}</Text>
              <Text style={styles.muted}>{b.warehouseName || 'Branch'} · {b.lines.length} scan(s) waiting to upload</Text>
              {b.lastError ? <Text style={styles.errorText}>{b.lastError}</Text> : null}
            </Pressable>
          ))}

          <Text style={styles.sectionTitle}>My open batches</Text>
          {serverOpen.length === 0 && <Text style={styles.muted}>None</Text>}
          {serverOpen.map((s) => <ServerBatchCard key={s.id} s={s} onPress={() => openServer(s)} />)}

          {serverDone.length > 0 && <Text style={styles.sectionTitle}>Recent</Text>}
          {serverDone.map((s) => <ServerBatchCard key={s.id} s={s} onPress={() => openServer(s)} />)}
        </ScrollView>
      )}

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Receive into which branch?</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(shiftWarehouse && !warehouses.some((w) => w.id === shiftWarehouse.id) ? [shiftWarehouse, ...warehouses] : warehouses).map((w) => (
                <Pressable key={w.id} style={styles.option} onPress={() => startBatch(w)}>
                  <Text style={styles.optionText}>{w.name}{shiftWarehouse?.id === w.id ? '  (current shift)' : ''}</Text>
                </Pressable>
              ))}
              {warehouses.length === 0 && !shiftWarehouse && <Text style={styles.muted}>No branches available.</Text>}
            </ScrollView>
            <Pressable style={styles.secondaryBtn} onPress={() => setPicking(false)}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function ServerBatchCard({ s, onPress }: { s: ServerBatchSummary; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{s.batchNo}</Text>
        <Text style={styles.chip}>{STATUS_LABEL[s.status] || s.status}</Text>
      </View>
      <Text style={styles.muted}>
        {s.warehouseName || ''} · {s.postedLines}/{s.totalLines} posted{s.errorLines ? ` · ${s.errorLines} error(s)` : ''}
      </Text>
    </Pressable>
  )
}

// ============================================================================
// One batch: scan, lines, submit, sync
// ============================================================================

function BatchView({ user, batch, online, onBack }: { user: AuthUser; batch: LocalIntakeBatch; online: boolean; onBack: () => void }) {
  const bottomPad = useBottomPad()
  const canPost = hasPermission(user, 'postStockIntake')
  const [detail, setDetail] = useState<ServerDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [mode, setMode] = useState<IntakeMode>('receive')
  const [code, setCode] = useState('')
  const [qty, setQty] = useState(1)
  const [scanner, setScanner] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [editLine, setEditLine] = useState<ServerLine | null>(null)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [scanNote, setScanNote] = useState('')

  const refresh = useCallback(async () => {
    if (!batch.serverId) return
    setLoadingDetail(true)
    const res = await apiGet<ServerDetail>(`/api/stock-intake/${batch.serverId}`)
    if (res.ok) setDetail(res.data)
    setLoadingDetail(false)
  }, [batch.serverId])

  useEffect(() => {
    void refresh()
  }, [refresh, batch.lines.length])

  const serverStatus = detail?.batch.status
  const editable = !serverStatus || OPEN_BATCH.includes(serverStatus)

  const flush = useCallback(async () => {
    const r = await uploadBatch(batch.clientBatchId)
    if (r.ok) {
      if (r.newlyRejected) Alert.alert('Some scans were rejected', `${r.newlyRejected} scan(s) could not be added. The rest were uploaded. Fix or remove the marked scans.`)
      await refresh()
      return true
    }
    if (!r.offline) Alert.alert('Upload failed', r.error || 'Upload failed')
    return false
  }, [batch.clientBatchId, refresh])

  const addScan = async (value: string, quantity = qty) => {
    const barcode = value.trim()
    if (!barcode) return
    if (mode === 'receive' && quantity <= 0) {
      Alert.alert('Quantity', 'Received quantity must be greater than 0')
      return
    }
    // Instant feedback: an existing item only gets stock (its details stay as they are)
    const known = await findByCode(barcode).catch(() => null)
    await addLocalLine(batch.clientBatchId, { mode, barcode, quantity })
    setCode('')
    setQty(1)
    setScanNote(known
      ? `Already in the catalogue: ${known.item.name} — ${mode === 'receive' ? `+${quantity} to stock` : `counted ${quantity}`}. Item details are not changed.`
      : `New barcode ${barcode} — enter the item name and price on the line below.`)
    if (online) await flush()
  }

  const removeServerLine = (line: ServerLine) => {
    if (!batch.serverId) return
    Alert.alert('Remove line?', line.match.item?.name || line.name || line.barcode || '', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const res = await api(`/api/stock-intake/${batch.serverId}/lines/${line.id}`, { method: 'DELETE' })
          if (!res.ok) Alert.alert('Could not remove', res.error)
          await refresh()
        },
      },
    ])
  }

  const saveNewItem = async () => {
    if (!editLine || !batch.serverId) return
    const price = Number(newPrice)
    if (!newName.trim()) {
      Alert.alert('Name required', 'Enter the new item name')
      return
    }
    setBusy('line')
    const res = await api(`/api/stock-intake/${batch.serverId}/lines/${editLine.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName.trim(), ...(newPrice !== '' && Number.isFinite(price) ? { sellingPrice: price } : {}) }),
    })
    setBusy(null)
    if (!res.ok) {
      Alert.alert('Could not save', res.error)
      return
    }
    setEditLine(null)
    await refresh()
  }

  const submit = async () => {
    if (!detail || !batch.serverId) return
    setBusy('submit')
    const res = await api(`/api/stock-intake/${batch.serverId}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: detail.batch.version, status: 'submitted' }),
    })
    setBusy(null)
    if (!res.ok) Alert.alert('Submit failed', res.error)
    else Alert.alert('Submitted', 'The batch is ready for a manager to sync into stock.')
    await refresh()
  }

  const sync = async () => {
    if (!batch.serverId) return
    if (batch.lines.length > 0) {
      const ok = await flush()
      if (!ok) {
        Alert.alert('Not uploaded', 'Some scans are still on this device. Connect to the server and try again.')
        return
      }
    }
    // Dry run first: show what will change and ask before touching stock or prices
    setBusy('sync')
    const check = await api<IntakeValidation>(`/api/stock-intake/${batch.serverId}/validate`, { method: 'POST' }, { timeoutMs: 60_000 })
    setBusy(null)
    if (!check.ok) {
      Alert.alert('Sync failed', check.error)
      return
    }
    const v = check.data
    if (v.conflicts.length || v.errors.length) {
      Alert.alert('Fix these first', [
        ...v.conflicts.map((c) => `Barcode ${c.barcode} is "${c.barcodeItem.name}" but SKU ${c.sku} is "${c.skuItem.name}"`),
        ...v.errors.map((e) => e.error),
      ].slice(0, 6).join('\n'))
      return
    }
    const undecided = (v.priceChanges || []).filter((c) => c.decision === null)
    let priceChanges: 'apply' | 'keep' | undefined
    if (undecided.length) {
      const list = undecided.slice(0, 6).map((c) => `• ${c.itemName}: ${c.currentPrice.toFixed(2)} → ${c.newPrice.toFixed(2)}`).join('\n')
      priceChanges = await new Promise<'apply' | 'keep' | undefined>((resolve) => Alert.alert(
        'Selling price changed',
        `${undecided.length} item(s) were scanned with a different selling price:\n${list}${undecided.length > 6 ? '\n…' : ''}\n\nUpdate the prices, or keep the current ones?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(undefined) },
          { text: 'Keep current', onPress: () => resolve('keep') },
          { text: 'Update prices', onPress: () => resolve('apply') },
        ],
        { cancelable: true, onDismiss: () => resolve(undefined) },
      ))
      if (!priceChanges) return
    }
    const units = v.willAdd.reduce((s, a) => s + a.delta, 0) + v.willCreate.reduce((s, c) => s + c.quantity, 0)
    const summary = [
      `${v.willAdd.length} existing item(s), ${units.toFixed(units % 1 ? 3 : 0)} unit(s) in total`,
      ...v.willAdd.slice(0, 5).map((a) => `• ${a.itemName}: ${a.currentStock} → ${a.after}`),
      v.willAdd.length > 5 ? '…' : '',
      v.willCreate.length ? `${v.willCreate.length} new item(s) will be created` : '',
    ].filter(Boolean).join('\n')
    const confirmed = await new Promise<boolean>((resolve) => Alert.alert('Add this stock?', summary, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Confirm', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }))
    if (!confirmed) return

    setBusy('sync')
    const res = await api<SyncResult>(`/api/stock-intake/${batch.serverId}/sync`, {
      method: 'POST',
      headers: { 'Idempotency-Key': newId() },
      body: JSON.stringify(priceChanges ? { priceChanges } : {}),
    }, { timeoutMs: 120_000 })
    setBusy(null)
    if (!res.ok) {
      Alert.alert('Sync failed', res.error)
    } else {
      const r = res.data
      const created = r.createdItems.length ? `\nNew items: ${r.createdItems.map((c) => `${c.name} (${c.itemCode})`).join(', ')}` : ''
      Alert.alert(
        r.errors.length ? 'Synced with errors' : 'Synced',
        r.noop ? 'Nothing left to sync.' : `${r.posted} line(s) posted. ${r.errors.length} need attention.${created}`,
      )
    }
    await refresh()
  }

  const lines = detail?.lines || []
  const title = detail?.batch.batchNo || batch.batchNo || 'New batch'
  // Received (posted) lines -> "Print labels" after a sync.
  const labelItems = lines
    .filter((l) => l.status === 'posted' && l.lineMode === 'receive' && Number(l.quantity) > 0)
    .map((l) => ({
      name: l.match.item?.name || l.name || l.barcode || l.sku || '',
      barcode: l.barcode,
      sku: l.sku || l.match.item?.itemCode || null,
      price: l.sellingPrice != null ? Number(l.sellingPrice) : undefined,
      qty: Math.max(1, Math.ceil(Number(l.quantity))),
    }))
  const openLabels = () => router.push({ pathname: '/labels', params: { items: JSON.stringify(labelItems) } })

  return (
    <View style={styles.screen}>
      <Header title={title} subtitle={`${batch.warehouseName || detail?.batch.warehouseName || ''}${serverStatus ? ` · ${STATUS_LABEL[serverStatus] || serverStatus}` : ' · not uploaded'}`} onBack={onBack} />
      {!online && <InlineNotice text="Offline: scans are kept on this device and upload when you are back online." />}
      {batch.lastError && online ? <InlineNotice tone="error" text={batch.lastError} /> : null}
      {scanNote ? <InlineNotice text={scanNote} /> : null}

      {editable && (
        <View style={styles.scanPanel}>
          <View style={styles.modeRow}>
            {(['receive', 'count'] as const).map((m) => (
              <Pressable key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]} onPress={() => setMode(m)}>
                <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'receive' ? 'Receive (+)' : 'Count (=)'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={code}
              onChangeText={setCode}
              placeholder="Barcode / SKU / item code"
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={() => addScan(code)}
            />
            <Pressable style={styles.scanBtn} onPress={() => setScanner(true)}>
              <Text style={styles.scanBtnText}>📷</Text>
            </Pressable>
          </View>
          <View style={styles.inputRow}>
            <Pressable style={styles.stepBtn} onPress={() => setQty((q) => Math.max(0, q - 1))}><Text style={styles.stepText}>−</Text></Pressable>
            <TextInput
              style={[styles.input, styles.qtyInput]}
              keyboardType="decimal-pad"
              value={String(qty)}
              onChangeText={(t) => {
                const n = Number(t.replace(',', '.'))
                setQty(Number.isFinite(n) && n >= 0 ? n : 0)
              }}
            />
            <Pressable style={styles.stepBtn} onPress={() => setQty((q) => q + 1)}><Text style={styles.stepText}>＋</Text></Pressable>
            <Pressable style={[styles.primaryBtn, { flex: 1 }, !code.trim() && { opacity: 0.5 }]} disabled={!code.trim()} onPress={() => addScan(code)}>
              <Text style={styles.primaryBtnText}>Add</Text>
            </Pressable>
          </View>
        </View>
      )}

      <FlatList
        data={lines}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: THEME.spacing.lg, gap: THEME.spacing.sm, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loadingDetail} onRefresh={refresh} />}
        ListHeaderComponent={batch.lines.length > 0 ? (
          <View style={{ gap: THEME.spacing.sm, marginBottom: THEME.spacing.sm }}>
            <Text style={styles.sectionTitle}>⏳ Waiting to upload ({batch.lines.length})</Text>
            {batch.lines.map((l) => (
              <View key={l.clientLineId} style={[styles.card, styles.rowBetween]}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.cardTitle}>{l.barcode} · {l.mode === 'count' ? '=' : '+'}{fmtQty(l.quantity)}</Text>
                  {l.rejected ? <Text style={styles.errorText}>{l.error || 'Rejected by the server'}</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {l.rejected ? (
                    <Pressable onPress={() => retryLocalLine(batch.clientBatchId, l.clientLineId).then(() => online && flush())}><Text style={styles.cardTitle}>↻</Text></Pressable>
                  ) : null}
                  <Pressable onPress={() => removeLocalLine(batch.clientBatchId, l.clientLineId)}><Text style={styles.errorText}>✕</Text></Pressable>
                </View>
              </View>
            ))}
            {online && (
              <Pressable style={styles.secondaryBtn} onPress={flush}><Text style={styles.secondaryBtnText}>Upload now</Text></Pressable>
            )}
          </View>
        ) : null}
        ListEmptyComponent={batch.lines.length === 0 ? (
          batch.serverId ? <EmptyView icon="📦" title="No lines yet" subtitle="Scan or type a barcode to add stock." />
            : <EmptyView icon="📴" title="Not uploaded yet" subtitle="This batch is saved on the device." />
        ) : null}
        renderItem={({ item: l }) => {
          const open = l.status === 'pending' || l.status === 'error'
          const isNew = l.match.status === 'new'
          return (
            <Pressable
              style={[styles.card, l.status === 'error' && { borderColor: THEME.colors.error }]}
              onPress={() => {
                if (open && isNew && editable) {
                  setEditLine(l)
                  setNewName(l.name || '')
                  setNewPrice(l.sellingPrice ? String(Number(l.sellingPrice)) : '')
                }
              }}
              onLongPress={() => open && editable && removeServerLine(l)}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={1}>
                  {isNew ? `🆕 ${l.name || 'NEW ITEM – tap to name'}` : l.match.item?.name || l.match.error || l.barcode}
                </Text>
                <Text style={styles.qtyText}>{l.lineMode === 'count' ? '=' : '+'}{fmtQty(l.quantity)}</Text>
              </View>
              <Text style={styles.muted}>
                {l.barcode || l.sku}
                {l.match.item ? ` · ${l.match.item.itemCode} · stock ${fmtQty(l.match.item.currentStock)}` : ''}
                {' · '}{l.status}
              </Text>
              {open && l.warnings.map((w, i) => <Text key={i} style={styles.warnText}>⚠ {w}</Text>)}
              {l.status === 'error' && l.errorMessage ? <Text style={styles.errorText}>{l.errorMessage}</Text> : null}
            </Pressable>
          )
        }}
      />

      {batch.serverId && editable && (
        <View style={[styles.footer, { paddingBottom: Math.max(28, bottomPad + 12) }]}>
          {serverStatus === 'draft' && (
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} disabled={!!busy || lines.length === 0} onPress={submit}>
              {busy === 'submit' ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={styles.secondaryBtnText}>Submit</Text>}
            </Pressable>
          )}
          {labelItems.length > 0 && (
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} disabled={!!busy} onPress={openLabels}>
              <Text style={styles.secondaryBtnText}>🏷️ Print labels</Text>
            </Pressable>
          )}
          {canPost && (
            <Pressable style={[styles.primaryBtn, { flex: 1 }]} disabled={!!busy || (lines.length === 0 && batch.lines.length === 0)} onPress={sync}>
              {busy === 'sync' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{serverStatus === 'partially_posted' ? 'Re-sync errors' : 'Sync to stock'}</Text>}
            </Pressable>
          )}
        </View>
      )}
      {batch.serverId && !editable && labelItems.length > 0 && (
        <View style={[styles.footer, { paddingBottom: Math.max(28, bottomPad + 12) }]}>
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={openLabels}>
            <Text style={styles.primaryBtnText}>🏷️ Print labels ({labelItems.length} item{labelItems.length === 1 ? '' : 's'})</Text>
          </Pressable>
        </View>
      )}
      {!batch.serverId && batch.lines.length === 0 && (
        <View style={[styles.footer, { paddingBottom: Math.max(28, bottomPad + 12) }]}>
          <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={async () => { await forgetLocalBatch(batch.clientBatchId); onBack() }}>
            <Text style={styles.secondaryBtnText}>Discard batch</Text>
          </Pressable>
        </View>
      )}

      <BarcodeScannerModal
        visible={scanner}
        continuous
        title={mode === 'receive' ? 'Scan items to receive' : 'Scan items to count'}
        onClose={() => setScanner(false)}
        onBarcodeScanned={(value) => { void addScan(value) }}
      />

      <Modal visible={!!editLine} transparent animationType="fade" onRequestClose={() => setEditLine(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New item · {editLine?.barcode || editLine?.sku}</Text>
            <TextInput style={styles.input} placeholder="Item name" value={newName} onChangeText={setNewName} autoFocus />
            <TextInput style={styles.input} placeholder="Selling price" keyboardType="decimal-pad" value={newPrice} onChangeText={setNewPrice} />
            <View style={styles.inputRow}>
              <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => setEditLine(null)}><Text style={styles.secondaryBtnText}>Cancel</Text></Pressable>
              <Pressable style={[styles.primaryBtn, { flex: 1 }]} disabled={busy === 'line'} onPress={saveNewItem}>
                {busy === 'line' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return <ScreenHeader title={title} subtitle={subtitle} onBack={onBack} />
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: THEME.spacing.sm,
    paddingTop: 48, paddingBottom: THEME.spacing.md, paddingHorizontal: THEME.spacing.lg,
    backgroundColor: THEME.colors.card, borderBottomWidth: 1, borderBottomColor: THEME.colors.border,
  },
  backBtn: { paddingHorizontal: THEME.spacing.sm, paddingVertical: THEME.spacing.xs },
  backText: { fontSize: 28, color: THEME.colors.primary, fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: THEME.colors.text },
  headerSub: { fontSize: 12, color: THEME.colors.textMuted },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', marginTop: THEME.spacing.sm },
  card: {
    backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, padding: THEME.spacing.md,
    borderWidth: 1, borderColor: THEME.colors.border, gap: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: THEME.colors.text },
  muted: { fontSize: 12, color: THEME.colors.textMuted },
  errorText: { fontSize: 12, color: THEME.colors.error, fontWeight: '600' },
  warnText: { fontSize: 12, color: THEME.colors.onSecondaryContainer },
  chip: {
    fontSize: 11, fontWeight: '700', color: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: THEME.radius.full, overflow: 'hidden',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: THEME.spacing.sm },
  primaryBtn: {
    backgroundColor: THEME.colors.primary, borderRadius: THEME.radius.md, paddingVertical: 12,
    paddingHorizontal: THEME.spacing.lg, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: THEME.colors.onPrimary, fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    borderWidth: 1, borderColor: THEME.colors.primary, borderRadius: THEME.radius.md, paddingVertical: 12,
    paddingHorizontal: THEME.spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.colors.card,
  },
  secondaryBtnText: { color: THEME.colors.primary, fontWeight: '700', fontSize: 15 },
  scanPanel: { padding: THEME.spacing.lg, gap: THEME.spacing.sm, backgroundColor: THEME.colors.card, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  modeRow: { flexDirection: 'row', borderRadius: THEME.radius.md, overflow: 'hidden', borderWidth: 1, borderColor: THEME.colors.border },
  modeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: THEME.colors.card },
  modeBtnActive: { backgroundColor: THEME.colors.primary },
  modeText: { fontWeight: '600', color: THEME.colors.text },
  modeTextActive: { color: THEME.colors.onPrimary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: THEME.spacing.sm },
  input: {
    borderWidth: 1, borderColor: THEME.colors.outline, borderRadius: THEME.radius.md, paddingHorizontal: THEME.spacing.md,
    paddingVertical: 10, fontSize: 16, color: THEME.colors.text, backgroundColor: '#fff',
  },
  qtyInput: { width: 72, textAlign: 'center' },
  stepBtn: {
    width: 44, height: 44, borderRadius: THEME.radius.md, backgroundColor: THEME.colors.surfaceContainer,
    alignItems: 'center', justifyContent: 'center',
  },
  stepText: { fontSize: 22, fontWeight: '700', color: THEME.colors.primary },
  scanBtn: {
    width: 48, height: 46, borderRadius: THEME.radius.md, backgroundColor: THEME.colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  scanBtnText: { fontSize: 22 },
  qtyText: { fontSize: 16, fontWeight: '700', color: THEME.colors.primary },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: THEME.spacing.sm,
    padding: THEME.spacing.lg, paddingBottom: 28, backgroundColor: THEME.colors.card, borderTopWidth: 1, borderTopColor: THEME.colors.border,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: THEME.spacing.xl },
  modalCard: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.xl, padding: THEME.spacing.lg, gap: THEME.spacing.md },
  modalTitle: { fontSize: 17, fontWeight: '700', color: THEME.colors.text },
  option: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  optionText: { fontSize: 16, color: THEME.colors.text },
})

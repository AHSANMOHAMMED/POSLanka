// Super admin → one vendor's data: every table, search, add / edit / delete rows.
// Server: /api/sys-control/vendors/[id]/data (view: owner / support admins; changes: owner admins).
// Route: /admin/vendor-data?vendorId=…&table=…
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Switch, Alert, ActivityIndicator, RefreshControl, Modal, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { adminApi, adminGet, adminPost, useAdminUser } from '../../src/lib/adminApi'
import { adminDownload, downloadName } from '../../src/lib/adminDownload'
import { groupIcon, tableIcon } from '../../src/lib/vendorDataIcons'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { AdminShell, Card, SectionTitle, adminStyles } from '../../src/components/admin/AdminShell'

type Kind = 'text' | 'number' | 'decimal' | 'boolean' | 'datetime' | 'date' | 'json' | 'uuid' | 'enum' | 'array'
interface Column { name: string; kind: Kind; required: boolean; hasDefault: boolean; secret: boolean; readOnly: boolean; enumValues?: string[]; references?: string }
interface TableInfo { name: string; label: string; group: string; canCreate: boolean; canEdit: boolean; canDelete: boolean; readOnlyReason?: string; rows: number }
type Row = Record<string, unknown>
interface RowsResponse { table: Omit<TableInfo, 'rows'>; columns: Column[]; rows: Row[]; total: number; page: number; pageSize: number }

const PAGE_SIZE = 30

/** Shown first: what is opened most */
const MAIN_TABLES = ['business_profile', 'items', 'warehouse_stock', 'sales', 'sale_items', 'customers', 'suppliers', 'purchases', 'payments', 'expenses', 'users', 'warehouses']

function shown(v: unknown, c: Column): string {
  if (v === null || v === undefined) return '—'
  if (c.kind === 'boolean') return v ? 'Yes' : 'No'
  if (c.kind === 'datetime' && typeof v === 'string') return new Date(v).toLocaleString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function toForm(v: unknown, c: Column): string | boolean {
  if (c.kind === 'boolean') return v === true
  if (v === null || v === undefined) return ''
  if (c.kind === 'json' || c.kind === 'array') return JSON.stringify(v, null, 2)
  return String(v)
}

function fromForm(v: string | boolean, c: Column): unknown {
  if (c.kind === 'boolean') return v === true
  const s = String(v)
  if (c.kind === 'text') return s
  return s.trim() === '' ? null : s
}

/** A row's title: its name-ish column, else its id */
function rowTitle(r: Row): string {
  const v = r.name ?? r.full_name ?? r.invoice_no ?? r.title ?? r.code ?? r.email ?? r.id
  return String(v ?? '').slice(0, 60)
}

export default function VendorDataScreen() {
  const params = useLocalSearchParams<{ vendorId: string; table?: string; vendorName?: string; column?: string; value?: string }>()
  const vendorId = params.vendorId
  const { can } = useAdminUser()
  const canEdit = can('vendors.manage')

  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [table, setTable] = useState<string | null>(params.table || null)
  const [refFilter, setRefFilter] = useState<{ column: string; value: string } | null>(params.column && params.value ? { column: params.column, value: params.value } : null)
  const [data, setData] = useState<RowsResponse | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loadingRows, setLoadingRows] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [tableExporting, setTableExporting] = useState(false)

  const loadTables = useCallback(async () => {
    const r = await adminGet<{ tables: TableInfo[] }>(`/api/sys-control/vendors/${vendorId}/data`)
    if (r.ok) { setTables(r.data.tables); setError(null) } else setError(r.error)
    setRefreshing(false)
  }, [vendorId])

  const loadRows = useCallback(async (nextPage = 1) => {
    if (!table) return
    setLoadingRows(true)
    const p = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) })
    if (q) p.set('q', q)
    if (refFilter) { p.set('column', refFilter.column); p.set('value', refFilter.value) }
    const r = await adminGet<RowsResponse>(`/api/sys-control/vendors/${vendorId}/data/${table}?${p.toString()}`)
    setLoadingRows(false)
    setRefreshing(false)
    if (!r.ok) return Alert.alert('Could not load', r.error)
    setData(r.data)
    setPage(nextPage)
    setRows((prev) => (nextPage === 1 ? r.data.rows : [...prev, ...r.data.rows]))
  }, [vendorId, table, q, refFilter])

  useEffect(() => { loadTables() }, [loadTables])
  useEffect(() => { loadRows(1) }, [loadRows])

  const f = filter.trim().toLowerCase()
  const visible = useMemo(
    () => (tables ?? []).filter((t) => (showEmpty || t.rows > 0 || f) && (!f || t.label.toLowerCase().includes(f) || t.name.includes(f))),
    [tables, showEmpty, f]
  )
  const mainTables = useMemo(() => (f ? [] : MAIN_TABLES.map((n) => visible.find((t) => t.name === n)).filter((t): t is TableInfo => !!t)), [visible, f])
  const groups = useMemo(() => {
    const out = new Map<string, TableInfo[]>()
    for (const t of visible) {
      if (mainTables.includes(t)) continue
      out.set(t.group, [...(out.get(t.group) ?? []), t])
    }
    return Array.from(out.entries())
  }, [visible, mainTables])
  const vendorName = params.vendorName ? String(params.vendorName) : 'vendor'

  async function exportTable() {
    if (!table) return
    setTableExporting(true)
    const failed = await adminDownload(`/api/sys-control/vendors/${vendorId}/data/${table}/export`, downloadName(vendorName, table, 'csv'))
    setTableExporting(false)
    if (failed) Alert.alert('Export failed', failed)
  }

  function openTable(name: string, ref: { column: string; value: string } | null = null) {
    setRows([]); setData(null); setQ(''); setSearch(''); setRefFilter(ref); setTable(name)
  }

  const title = table ? (data?.table.label ?? table) : 'Vendor data'
  const visibleColumns = (data?.columns ?? []).filter((c) => !c.secret && c.name !== 'tenant_id' && c.name !== 'id')

  return (
    <AdminShell title={title} subtitle={params.vendorName ? String(params.vendorName) : undefined} tab="vendors" back>
      {!table ? (
        // ---------------------------------------------------------------- tables
        error ? <ErrorView message={error} onRetry={loadTables} /> : !tables ? <LoadingView text="Loading tables…" /> : (
          <ScrollView style={adminStyles.scroll} contentContainerStyle={adminStyles.content} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTables() }} />}>
            <TextInput style={adminStyles.input} value={filter} onChangeText={setFilter} placeholder="Find a table (items, customers, sales…)" autoCapitalize="none" />
            {!canEdit ? <Text style={adminStyles.muted}>You can view this data. Changing it needs an owner admin.</Text> : null}
            <View style={styles.showEmpty}>
              <Text style={adminStyles.muted}>{(tables ?? []).filter((t) => t.rows > 0).length} tables with data</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={adminStyles.muted}>Show empty</Text>
                <Switch value={showEmpty} onValueChange={setShowEmpty} trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }} />
              </View>
            </View>
            {canEdit ? (
              <Pressable style={[adminStyles.primaryBtn, { height: 42 }]} onPress={() => setExportOpen(true)}>
                <Text style={adminStyles.primaryBtnText}>⬇  Export data</Text>
              </Pressable>
            ) : null}
            {visible.length === 0 ? <Text style={adminStyles.empty}>No tables match</Text> : null}
            {mainTables.length > 0 ? <TileSection title="Main tables" icon="apps-outline" list={mainTables} onOpen={openTable} /> : null}
            {groups.map(([g, list]) => <TileSection key={g} title={g} icon={groupIcon(g)} list={list} onOpen={openTable} />)}
          </ScrollView>
        )
      ) : (
        // ---------------------------------------------------------------- rows
        <ScrollView style={adminStyles.scroll} contentContainerStyle={adminStyles.content} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRows(1) }} />}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[adminStyles.ghostBtn, { flex: 1, height: 40 }]} onPress={() => { setTable(null); loadTables() }}>
              <Text style={adminStyles.ghostBtnText}>‹ All tables</Text>
            </Pressable>
            {canEdit && data?.table.canCreate ? (
              <Pressable style={[adminStyles.primaryBtn, { flex: 1, height: 40 }]} onPress={() => setEditing({ row: null })}>
                <Text style={adminStyles.primaryBtnText}>+ Add row</Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable style={[adminStyles.ghostBtn, { height: 40 }, tableExporting && { opacity: 0.6 }]} onPress={exportTable} disabled={tableExporting}>
            {tableExporting ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={adminStyles.ghostBtnText}>⬇  Export this table (CSV)</Text>}
          </Pressable>
          <TextInput style={adminStyles.input} value={search} onChangeText={setSearch} onSubmitEditing={() => setQ(search.trim())} returnKeyType="search" placeholder="Search this table" autoCapitalize="none" />
          {refFilter ? (
            <Pressable onPress={() => setRefFilter(null)}><Text style={styles.link}>Showing {refFilter.column} = {refFilter.value.slice(0, 8)}… · tap to show all</Text></Pressable>
          ) : null}
          {data?.table.readOnlyReason ? <Text style={adminStyles.muted}>🔒 {data.table.readOnlyReason}</Text> : null}
          {data ? <Text style={adminStyles.muted}>{data.total} row{data.total === 1 ? '' : 's'}{q ? ` matching “${q}”` : ''}</Text> : null}

          {rows.length === 0 && !loadingRows ? <Text style={adminStyles.empty}>No rows</Text> : null}
          {rows.map((r, i) => (
            <Pressable key={String(r.id ?? i)} onPress={() => setEditing({ row: r })}>
              <Card style={{ padding: 12, gap: 2 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{rowTitle(r)}</Text>
                {visibleColumns.slice(0, 5).filter((c) => !['name', 'full_name'].includes(c.name)).slice(0, 4).map((c) => (
                  <Text key={c.name} style={adminStyles.muted} numberOfLines={1}>{c.name}: {shown(r[c.name], c)}</Text>
                ))}
              </Card>
            </Pressable>
          ))}
          {loadingRows ? <ActivityIndicator color={THEME.colors.primary} /> : null}
          {data && rows.length < data.total && !loadingRows ? (
            <Pressable style={[adminStyles.ghostBtn, { height: 42 }]} onPress={() => loadRows(page + 1)}>
              <Text style={adminStyles.ghostBtnText}>Load more ({data.total - rows.length} left)</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      {exportOpen ? <ExportSheet vendorId={vendorId} vendorName={vendorName} tables={tables ?? []} onClose={() => setExportOpen(false)} /> : null}

      {editing && data && table ? (
        <RowEditor
          vendorId={vendorId}
          table={table}
          columns={data.columns}
          row={editing.row}
          canSave={canEdit && (editing.row ? data.table.canEdit : data.table.canCreate)}
          canDelete={canEdit && !!editing.row && data.table.canDelete}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadRows(1); loadTables() }}
          onOpenReference={(t, v) => { setEditing(null); openTable(t, { column: 'id', value: v }) }}
        />
      ) : null}
    </AdminShell>
  )
}

function RowEditor({ vendorId, table, columns, row, canSave, canDelete, onClose, onSaved, onOpenReference }: {
  vendorId: string
  table: string
  columns: Column[]
  row: Row | null
  canSave: boolean
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
  onOpenReference: (table: string, id: string) => void
}) {
  const initial = useMemo(() => Object.fromEntries(columns.map((c) => [c.name, row ? toForm(row[c.name], c) : c.kind === 'boolean' ? false : ''])), [columns, row])
  const [form, setForm] = useState<Record<string, string | boolean>>(initial)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const fields = row ? columns : columns.filter((c) => !c.readOnly)

  function set(name: string, v: string | boolean) {
    setForm((f) => ({ ...f, [name]: v }))
    setTouched((t) => new Set([...t, name]))
  }

  async function save() {
    const values: Record<string, unknown> = {}
    for (const c of columns) {
      if (c.readOnly || !touched.has(c.name)) continue
      if (row && form[c.name] === initial[c.name]) continue
      values[c.name] = fromForm(form[c.name], c)
    }
    if (row && Object.keys(values).length === 0) return onClose()
    setBusy(true)
    const res = row
      ? await adminApi(`/api/sys-control/vendors/${vendorId}/data/${table}/${row.id}`, { method: 'PATCH', body: JSON.stringify({ values }) })
      : await adminPost(`/api/sys-control/vendors/${vendorId}/data/${table}`, { values })
    setBusy(false)
    if (!res.ok) return Alert.alert('Not saved', res.error)
    onSaved()
  }

  function remove() {
    if (!row) return
    Alert.alert('Delete this row?', 'It is removed from the vendor’s data now. The audit log keeps a copy.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true)
          const res = await adminApi(`/api/sys-control/vendors/${vendorId}/data/${table}/${row.id}`, { method: 'DELETE' })
          setBusy(false)
          if (!res.ok) return Alert.alert('Not deleted', res.error)
          onSaved()
        },
      },
    ])
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: THEME.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={styles.link}>Close</Text></Pressable>
          <Text style={styles.modalTitle} numberOfLines={1}>{row ? rowTitle(row) : 'New row'}</Text>
          {canSave ? (
            <Pressable onPress={save} disabled={busy} hitSlop={12}>{busy ? <ActivityIndicator /> : <Text style={[styles.link, { fontWeight: '800' }]}>Save</Text>}</Pressable>
          ) : <View style={{ width: 40 }} />}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          {fields.map((c) => {
            const disabled = !canSave || c.readOnly
            const v = form[c.name]
            return (
              <View key={c.name} style={{ marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.label}>{c.name}{c.required && !disabled ? ' *' : ''}</Text>
                  {c.references && typeof v === 'string' && v ? (
                    <Pressable onPress={() => onOpenReference(c.references!, v)}><Text style={styles.link}>Open ›</Text></Pressable>
                  ) : null}
                </View>
                {c.secret ? (
                  <Text style={adminStyles.muted}>Hidden</Text>
                ) : c.kind === 'boolean' ? (
                  <Switch value={v === true} onValueChange={(b) => set(c.name, b)} disabled={disabled} trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }} />
                ) : c.kind === 'enum' && !disabled ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {(c.enumValues ?? []).map((o) => (
                      <Pressable key={o} onPress={() => set(c.name, o)} style={[styles.chip, v === o && styles.chipActive]}>
                        <Text style={[styles.chipText, v === o && { color: '#FFF' }]}>{o}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <TextInput
                    style={[adminStyles.input, disabled && { opacity: 0.6 }, (c.kind === 'json' || c.kind === 'array') && { minHeight: 90, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 }]}
                    value={String(v)}
                    editable={!disabled}
                    multiline={c.kind === 'json' || c.kind === 'array' || /(address|notes?|description)$/.test(c.name)}
                    onChangeText={(t) => set(c.name, t)}
                    autoCapitalize="none"
                    keyboardType={c.kind === 'number' || c.kind === 'decimal' ? 'decimal-pad' : 'default'}
                    placeholder={c.kind === 'datetime' ? 'YYYY-MM-DDTHH:MM' : c.kind === 'date' ? 'YYYY-MM-DD' : c.readOnly ? 'Set by the system' : undefined}
                  />
                )}
              </View>
            )
          })}
          {canDelete ? (
            <Pressable style={[adminStyles.dangerBtn, { marginTop: 12 }]} onPress={remove} disabled={busy}>
              <Text style={adminStyles.dangerBtnText}>Delete row</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function TileSection({ title, icon, list, onOpen }: { title: string; icon: ReturnType<typeof groupIcon>; list: TableInfo[]; onOpen: (name: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.tileHeading}>
        <Ionicons name={icon} size={15} color={THEME.colors.textMuted} />
        <SectionTitle>{title}</SectionTitle>
      </View>
      <View style={styles.tiles}>
        {list.map((t) => (
          <Pressable key={t.name} onPress={() => onOpen(t.name)} style={styles.tile} accessibilityRole="button" accessibilityLabel={`${t.label}, ${t.rows} row${t.rows === 1 ? '' : 's'}`}>
            <View style={styles.tileTop}>
              <View style={styles.tileIcon}><Ionicons name={tableIcon(t.name, t.group)} size={20} color={THEME.colors.primary} /></View>
              {!t.canEdit ? <Ionicons name="lock-closed-outline" size={13} color={THEME.colors.textSubtle} /> : null}
            </View>
            <Text style={styles.tileName} numberOfLines={2}>{t.label}</Text>
            <Text style={adminStyles.muted}>{t.rows} row{t.rows === 1 ? '' : 's'}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/** Whole-vendor ZIP: every section with rows, ticked by default. Owner admins only (the server checks). */
function ExportSheet({ vendorId, vendorName, tables, onClose }: { vendorId: string; vendorName: string; tables: TableInfo[]; onClose: () => void }) {
  const sections = useMemo(() => {
    const out = new Map<string, { tables: number; rows: number }>()
    for (const t of tables) {
      if (t.rows === 0) continue
      const s = out.get(t.group) ?? { tables: 0, rows: 0 }
      out.set(t.group, { tables: s.tables + 1, rows: s.rows + t.rows })
    }
    return Array.from(out.entries())
  }, [tables])
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set())
  const [bytes, setBytes] = useState<number | null>(null)
  const chosen = sections.filter(([g]) => !unticked.has(g))
  const busy = bytes !== null

  async function start() {
    const all = chosen.length === sections.length
    setBytes(0)
    const stamp = new Date().toISOString().slice(0, 10)
    const failed = await adminDownload(
      `/api/sys-control/vendors/${vendorId}/export${all ? '' : `?groups=${encodeURIComponent(chosen.map(([g]) => g).join(','))}`}`,
      downloadName(vendorName, `data-${stamp}`, 'zip'),
      setBytes,
    )
    setBytes(null)
    if (failed) Alert.alert('Export failed', failed)
    else onClose()
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose() }}>
      <View style={{ flex: 1, backgroundColor: THEME.colors.background }}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} disabled={busy} hitSlop={8}><Text style={styles.link}>Close</Text></Pressable>
          <Text style={styles.modalTitle}>Export this vendor’s data</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={adminStyles.content}>
          <Text style={adminStyles.muted}>One ZIP of Excel-ready CSV files: all-time totals, every item with its stock, cost and profit, and each ticked section table by table. Big vendors can take a few minutes.</Text>
          <Card>
            {sections.map(([g, s]) => (
              <View key={g} style={styles.tableRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.tableName}>{g}</Text>
                  <Text style={adminStyles.muted}>{s.tables} table{s.tables === 1 ? '' : 's'} • {s.rows} row{s.rows === 1 ? '' : 's'}</Text>
                </View>
                <Switch
                  value={!unticked.has(g)}
                  disabled={busy}
                  trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
                  onValueChange={(on) => setUnticked((u) => {
                    const next = new Set(u)
                    if (on) next.delete(g)
                    else next.add(g)
                    return next
                  })}
                />
              </View>
            ))}
          </Card>
          <Text style={adminStyles.muted}>Passwords, PINs, keys and sign-in sessions are never exported, and uploaded files stay in file storage. Each export is written to the audit log. The app clears its copy at your next export or sign-out.</Text>
          <Pressable style={[adminStyles.primaryBtn, (busy || chosen.length === 0) && { opacity: 0.6 }]} disabled={busy || chosen.length === 0} onPress={start}>
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#FFF" />
                <Text style={adminStyles.primaryBtnText}>{(bytes / 1048576).toFixed(1)} MB</Text>
              </View>
            ) : <Text style={adminStyles.primaryBtnText}>Download ZIP</Text>}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  showEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, maxWidth: '50%', backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, gap: 6 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: THEME.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  tableName: { flex: 1, fontSize: 14, fontWeight: '600', color: THEME.colors.text, marginRight: 8 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  link: { color: THEME.colors.primary, fontWeight: '700', fontSize: 13 },
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  modalHeader: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  modalTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  chipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
})

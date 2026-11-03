// Audit trail of platform-admin actions (who changed what) with filters and CSV export.
// GET /api/sys-control/audit-logs (read), GET audit-logs/export (CSV → share sheet).
import React, { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, RefreshControl, TextInput, Alert, StyleSheet } from 'react-native'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Pill, adminStyles } from '../../src/components/admin/AdminShell'
import { FilterChips, FormModal, LinkButton, ListFooter, MoreShell } from '../../src/components/admin/AdminForm'
import { adminDownload } from '../../src/lib/adminDownload'
import { fmtDateTime, openWebPath, titleCase, usePagedList } from '../../src/lib/adminForms'

interface AuditRow {
  id: string
  action: string
  resource: string
  resourceId?: string | null
  createdAt: string
  ipAddress?: string | null
  details?: Record<string, unknown> | null
  adminName?: string | null
  adminEmail?: string | null
  accountName?: string | null
  accountEmail?: string | null
  vendorName?: string | null
  vendorBusinessId?: string | null
}

const ACTIONS = ['all', 'login', 'create', 'update', 'delete', 'approve', 'reject', 'extend', 'view', 'logout'] as const

function tone(action: string): 'ok' | 'warn' | 'error' | 'primary' | 'muted' {
  if (action === 'delete' || action === 'reject') return 'error'
  if (action === 'create' || action === 'approve') return 'ok'
  if (action === 'update' || action === 'extend') return 'warn'
  if (action === 'login') return 'primary'
  return 'muted'
}

export default function AdminAuditLogsScreen() {
  const [action, setAction] = useState<(typeof ACTIONS)[number]>('all')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [vendor, setVendor] = useState('')
  const [vendorDebounced, setVendorDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim())
      setVendorDebounced(vendor.trim())
    }, 350)
    return () => clearTimeout(t)
  }, [query, vendor])

  const filterQuery = () => {
    const p = new URLSearchParams()
    if (action !== 'all') p.set('action', action)
    if (debounced) p.set('q', debounced)
    if (vendorDebounced) p.set('vendor', vendorDebounced)
    return p
  }

  const list = usePagedList<AuditRow>({
    path: (page) => {
      const p = filterQuery()
      p.set('page', String(page))
      p.set('pageSize', '30')
      return `/api/sys-control/audit-logs?${p.toString()}`
    },
    pick: (b) => ({ rows: Array.isArray(b?.logs) ? b.logs : [], total: b?.pagination?.total }),
    deps: [action, debounced, vendorDebounced],
  })

  const [detail, setDetail] = useState<AuditRow | null>(null)
  const [exporting, setExporting] = useState(false)

  async function exportCsv() {
    setExporting(true)
    const stamp = new Date().toISOString().slice(0, 10)
    const err = await adminDownload(`/api/sys-control/audit-logs/export?${filterQuery().toString()}`, `audit-log-${stamp}.csv`)
    setExporting(false)
    if (err) Alert.alert('Export failed', err)
  }

  return (
    <MoreShell
      title="Audit logs"
      subtitle={`${list.total} entries`}
      right={<LinkButton label={exporting ? 'Exporting…' : 'Export CSV'} onPress={exportCsv} disabled={exporting} />}
    >
      <View style={styles.searchWrap}>
        <TextInput style={adminStyles.input} placeholder="Search resource, id or details…" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} />
        <TextInput style={[adminStyles.input, { marginTop: 8 }]} placeholder="Vendor (Business ID or name)…" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} value={vendor} onChangeText={setVendor} />
      </View>
      <FilterChips value={action} onChange={(v) => setAction(v)} options={ACTIONS.map((a) => ({ value: a, label: titleCase(a) }))} />

      {list.loading ? (
        <LoadingView text="Loading audit log…" />
      ) : list.error ? (
        <ErrorView message={list.error} onRetry={list.reload} />
      ) : (
        <FlatList
          data={list.rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={adminStyles.content}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Text style={adminStyles.empty}>No audit entries match.</Text>}
          ListFooterComponent={
            <View style={{ gap: 8 }}>
              <ListFooter loadingMore={list.loadingMore} hasMore={list.hasMore} shown={list.rows.length} total={list.total} onMore={list.loadMore} />
              <Pressable onPress={() => openWebPath('/sys-control/audit-logs')}>
                <Text style={[adminStyles.muted, { textAlign: 'center', color: THEME.colors.primary, fontWeight: '700' }]}>Open on web</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => setDetail(item)}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Pill text={item.action} tone={tone(item.action)} />
                  <Text style={styles.resource} numberOfLines={1}>{item.resource.replace(/_/g, ' ')}</Text>
                </View>
                <Text style={styles.who} numberOfLines={1}>
                  {item.adminName || item.accountName || item.adminEmail || item.accountEmail || 'System'}
                  {item.vendorName ? ` → ${item.vendorName}` : ''}
                </Text>
                <Text style={adminStyles.muted} numberOfLines={1}>{fmtDateTime(item.createdAt)}{item.ipAddress ? ` · ${item.ipAddress}` : ''}</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <FormModal visible={!!detail} title={detail ? `${titleCase(detail.action)} · ${detail.resource.replace(/_/g, ' ')}` : ''} confirmLabel={null} onCancel={() => setDetail(null)}>
        {detail ? (
          <View style={{ gap: 4 }}>
            <Text style={adminStyles.muted}>{fmtDateTime(detail.createdAt)}</Text>
            <Text style={styles.who}>{detail.adminName || detail.accountName || 'System'} {detail.adminEmail || detail.accountEmail ? `(${detail.adminEmail || detail.accountEmail})` : ''}</Text>
            {detail.vendorName ? <Text style={adminStyles.muted}>Vendor: {detail.vendorName}{detail.vendorBusinessId ? ` · ${detail.vendorBusinessId}` : ''}</Text> : null}
            {detail.resourceId ? <Text selectable style={adminStyles.muted}>Resource ID: {detail.resourceId}</Text> : null}
            {detail.ipAddress ? <Text style={adminStyles.muted}>IP: {detail.ipAddress}</Text> : null}
            <Text selectable style={styles.json}>{JSON.stringify(detail.details ?? {}, null, 2)}</Text>
          </View>
        ) : null}
      </FormModal>
    </MoreShell>
  )
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  resource: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, flex: 1, textTransform: 'capitalize' },
  who: { fontSize: 12, fontWeight: '600', color: THEME.colors.text, marginTop: 4 },
  json: { fontSize: 11, fontFamily: 'monospace', color: THEME.colors.text, backgroundColor: THEME.colors.surfaceContainerLow, padding: 10, borderRadius: 8, marginTop: 8 },
})

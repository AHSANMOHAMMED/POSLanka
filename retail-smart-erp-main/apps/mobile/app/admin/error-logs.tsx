// Platform error log: list (entries or groups), detail with stack, and resolve / investigate /
// won't fix / reopen (needs `error_logs`). GET error-logs, GET error-logs/[id], PUT error-logs.
import React, { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, RefreshControl, TextInput, StyleSheet } from 'react-native'
import { adminGet, adminPut, useAdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Kpi, Pill, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'
import { Btn, Field, FilterChips, FormModal, ListFooter, MoreShell, Notice } from '../../src/components/admin/AdminForm'
import { alertIfFailed, fmtDateTime, titleCase, usePagedList } from '../../src/lib/adminForms'

interface LogRow {
  id: string
  level: 'error' | 'warning' | 'info' | string
  source: string
  message: string
  groupHash?: string | null
  errorSource?: string | null
  resolutionStatus: string
  occurrenceCount?: number | null
  createdAt: string
  lastOccurredAt?: string | null
  tenantName?: string | null
  tenantBusinessId?: string | null
  reportedByName?: string | null
}

interface LogDetail extends LogRow {
  stack?: string | null
  context?: unknown
  reportedUrl?: string | null
  userDescription?: string | null
  resolutionNotes?: string | null
  groupEntries?: number
  reportedByEmail?: string | null
}

type StatusFilter = 'unresolved' | 'closed' | 'all'
type LevelFilter = 'all' | 'error' | 'warning' | 'info'

const levelTone = (l: string): 'error' | 'warn' | 'muted' => (l === 'error' ? 'error' : l === 'warning' ? 'warn' : 'muted')
const statusTone = (s: string): 'ok' | 'warn' | 'error' | 'muted' => (s === 'resolved' ? 'ok' : s === 'investigating' ? 'warn' : s === 'wont_fix' ? 'muted' : 'error')

export default function AdminErrorLogsScreen() {
  const { can } = useAdminUser()
  const canResolve = can('error_logs')
  const [status, setStatus] = useState<StatusFilter>('unresolved')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])

  const list = usePagedList<LogRow>({
    path: (page) => {
      const p = new URLSearchParams({ view: 'list', page: String(page), pageSize: '25' })
      if (status !== 'all') p.set('status', status)
      if (level !== 'all') p.set('level', level)
      if (debounced) p.set('q', debounced)
      if (page === 1) p.set('includeStats', '1')
      return `/api/sys-control/error-logs?${p.toString()}`
    },
    pick: (b) => ({ rows: Array.isArray(b?.data) ? b.data : [], total: b?.pagination?.total }),
    deps: [status, level, debounced],
  })
  const stats = list.extra?.stats as { last24h: number; unresolved: number; userReports: number; occurrences24h: number } | undefined

  const [detail, setDetail] = useState<LogDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function open(row: LogRow) {
    setDetail({ ...row })
    setDetailError(null)
    setDetailLoading(true)
    const res = await adminGet<LogDetail>(`/api/sys-control/error-logs/${row.id}`)
    setDetailLoading(false)
    if (res.ok) {
      setDetail(res.data)
      setNotes(res.data.resolutionNotes || '')
    } else setDetailError(res.error)
  }

  async function setStatusFor(resolutionStatus: 'open' | 'investigating' | 'resolved' | 'wont_fix', group = false) {
    if (!detail) return
    setBusy(resolutionStatus + (group ? ':group' : ''))
    const body: Record<string, unknown> = { resolutionStatus }
    if (group && detail.groupHash) body.groupHash = detail.groupHash
    else body.id = detail.id
    if (notes.trim() !== (detail.resolutionNotes || '')) body.resolutionNotes = notes.trim()
    const res = await adminPut<{ updated: number }>('/api/sys-control/error-logs', body)
    setBusy(null)
    if (!alertIfFailed(res, 'Update failed')) return
    setDetail(null)
    list.silentReload()
  }

  async function saveNotes() {
    if (!detail) return
    setBusy('notes')
    const res = await adminPut('/api/sys-control/error-logs', { id: detail.id, resolutionNotes: notes.trim() })
    setBusy(null)
    if (alertIfFailed(res, 'Notes not saved')) setDetail({ ...detail, resolutionNotes: notes.trim() })
  }

  return (
    <MoreShell title="Error logs" subtitle={stats ? `${stats.unresolved} unresolved · ${stats.last24h} in 24h` : `${list.total} entries`}>
      <View style={styles.searchWrap}>
        <TextInput style={adminStyles.input} placeholder="Search message, source or URL…" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} />
      </View>
      <FilterChips value={status} onChange={setStatus} options={[{ value: 'unresolved', label: 'Unresolved', count: stats?.unresolved }, { value: 'closed', label: 'Resolved' }, { value: 'all', label: 'All' }]} />
      <FilterChips value={level} onChange={setLevel} options={(['all', 'error', 'warning', 'info'] as LevelFilter[]).map((l) => ({ value: l, label: titleCase(l) }))} />

      {list.loading ? (
        <LoadingView text="Loading error log…" />
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
          ListHeaderComponent={
            stats ? (
              <View style={adminStyles.kpiGrid}>
                <Kpi label="Unresolved" value={String(stats.unresolved)} tone={stats.unresolved > 0 ? 'error' : 'ok'} />
                <Kpi label="Last 24h" value={String(stats.last24h)} hint={`${stats.occurrences24h} occurrences`} />
                <Kpi label="User reports" value={String(stats.userReports)} tone={stats.userReports > 0 ? 'warn' : undefined} />
              </View>
            ) : null
          }
          ListEmptyComponent={<Text style={adminStyles.empty}>No error entries match.</Text>}
          ListFooterComponent={<ListFooter loadingMore={list.loadingMore} hasMore={list.hasMore} shown={list.rows.length} total={list.total} onMore={list.loadMore} />}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => open(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.message} numberOfLines={2}>{item.message}</Text>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {item.source}{item.tenantName ? ` · ${item.tenantName}` : ''} · {timeAgo(item.lastOccurredAt || item.createdAt)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <Pill text={item.level} tone={levelTone(item.level)} />
                  <Pill text={item.resolutionStatus.replace('_', ' ')} tone={statusTone(item.resolutionStatus)} />
                  {item.errorSource === 'user_report' ? <Pill text="user report" tone="primary" /> : null}
                  {(item.occurrenceCount ?? 1) > 1 ? <Pill text={`×${item.occurrenceCount}`} /> : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <FormModal visible={!!detail} title="Error entry" confirmLabel={null} onCancel={() => setDetail(null)}>
        {detail ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pill text={detail.level} tone={levelTone(detail.level)} />
              <Pill text={detail.resolutionStatus.replace('_', ' ')} tone={statusTone(detail.resolutionStatus)} />
              {(detail.groupEntries ?? 1) > 1 ? <Pill text={`${detail.groupEntries} in group`} /> : null}
            </View>
            <Text selectable style={styles.message}>{detail.message}</Text>
            <Text style={adminStyles.muted}>{detail.source} · {fmtDateTime(detail.lastOccurredAt || detail.createdAt)}</Text>
            {detail.tenantName ? <Text style={adminStyles.muted}>Vendor: {detail.tenantName}{detail.tenantBusinessId ? ` (${detail.tenantBusinessId})` : ''}</Text> : null}
            {detail.reportedByName || detail.reportedByEmail ? <Text style={adminStyles.muted}>Reported by {detail.reportedByName || detail.reportedByEmail}</Text> : null}
            {detail.userDescription ? <Text style={styles.message}>“{detail.userDescription}”</Text> : null}
            {detail.reportedUrl ? <Text selectable style={adminStyles.muted}>{detail.reportedUrl}</Text> : null}
            {detailLoading ? <LoadingView text="Loading details…" /> : null}
            {detailError ? <Notice tone="error" text={detailError} /> : null}
            {detail.stack ? <Text selectable style={styles.stack} numberOfLines={30}>{detail.stack}</Text> : null}

            {canResolve ? (
              <>
                <Field label="Resolution notes" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" maxLength={5000} style={{ marginTop: 8 }} />
                <Btn label="Save notes" tone="ghost" busy={busy === 'notes'} disabled={!!busy && busy !== 'notes'} onPress={saveNotes} />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {detail.resolutionStatus === 'resolved' || detail.resolutionStatus === 'wont_fix' ? (
                    <Btn label="Reopen" style={{ flex: 1 }} busy={busy === 'open'} disabled={!!busy} onPress={() => setStatusFor('open')} />
                  ) : (
                    <Btn label="Resolve" style={{ flex: 1 }} busy={busy === 'resolved'} disabled={!!busy} onPress={() => setStatusFor('resolved')} />
                  )}
                  {detail.resolutionStatus === 'open' ? <Btn label="Investigating" tone="ghost" style={{ flex: 1 }} busy={busy === 'investigating'} disabled={!!busy} onPress={() => setStatusFor('investigating')} /> : null}
                  {detail.resolutionStatus !== 'wont_fix' && detail.resolutionStatus !== 'resolved' ? <Btn label="Won't fix" tone="ghost" style={{ flex: 1 }} busy={busy === 'wont_fix'} disabled={!!busy} onPress={() => setStatusFor('wont_fix')} /> : null}
                </View>
                {detail.groupHash && (detail.groupEntries ?? 1) > 1 && detail.resolutionStatus !== 'resolved' ? (
                  <Btn label={`Resolve all ${detail.groupEntries} in this group`} tone="ghost" style={{ marginTop: 8 }} busy={busy === 'resolved:group'} disabled={!!busy} onPress={() => setStatusFor('resolved', true)} />
                ) : null}
              </>
            ) : (
              <Notice text="Resolving errors needs the Support or Owner role." />
            )}
          </View>
        ) : null}
      </FormModal>
    </MoreShell>
  )
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12 },
  row: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  message: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  stack: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.text, backgroundColor: THEME.colors.surfaceContainerLow, padding: 8, borderRadius: 8, marginTop: 6 },
})

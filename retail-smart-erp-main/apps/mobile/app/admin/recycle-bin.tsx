// Super admin → one vendor's recycle bin: what the vendor deleted. Restore (undo) or purge (delete for good).
// Server: /api/sys-control/vendors/[id]/recycle-bin (view: owner / support admins; restore / purge: owner admins).
// Route: /admin/recycle-bin?vendorId=…&vendorName=…
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, RefreshControl } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { adminApi, adminGet, adminPost, useAdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { AdminShell, Card, Pill, SectionTitle, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'

type Status = 'open' | 'restored' | 'purged' | 'all'
interface Entry {
  id: string
  entity_id: string
  display_name: string | null
  mode: 'archive' | 'delete'
  label: string
  status: 'open' | 'restored' | 'purged'
  deleted_by_name: string | null
  deleted_at: string
}
interface ListResponse { rows: Entry[]; total: number; page: number; pageSize: number }

const PAGE_SIZE = 30
const STATUSES: Array<{ value: Status; label: string }> = [
  { value: 'open', label: 'In bin' }, { value: 'restored', label: 'Restored' }, { value: 'purged', label: 'Purged' }, { value: 'all', label: 'All' },
]

export default function RecycleBinScreen() {
  const params = useLocalSearchParams<{ vendorId: string; vendorName?: string }>()
  const vendorId = params.vendorId
  const { can } = useAdminUser()
  const canManage = can('vendors.manage')

  const [status, setStatus] = useState<Status>('open')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (nextPage = 1) => {
    const p = new URLSearchParams({ status, page: String(nextPage), pageSize: String(PAGE_SIZE) })
    if (q) p.set('q', q)
    const r = await adminGet<ListResponse>(`/api/sys-control/vendors/${vendorId}/recycle-bin?${p.toString()}`)
    if (r.ok) {
      setRows((prev) => (nextPage === 1 ? r.data.rows : [...prev, ...r.data.rows]))
      setTotal(r.data.total)
      setPage(nextPage)
      setError(null)
    } else if (nextPage === 1) setError(r.error)
    else Alert.alert('Could not load', r.error)
    setLoading(false)
    setRefreshing(false)
  }, [vendorId, status, q])

  useEffect(() => { setLoading(true); load(1) }, [load])

  function name(e: Entry) {
    return e.display_name || e.entity_id
  }

  function restore(e: Entry) {
    Alert.alert('Restore', `Bring back ${e.label.toLowerCase()} “${name(e)}” for the vendor?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: async () => {
          setBusyId(e.id)
          const r = await adminPost(`/api/sys-control/vendors/${vendorId}/recycle-bin/${e.id}/restore`)
          setBusyId(null)
          if (!r.ok) return Alert.alert('Could not restore', r.error)
          load(1)
        },
      },
    ])
  }

  function purge(e: Entry) {
    const msg = e.mode === 'archive'
      ? `Permanently delete ${e.label.toLowerCase()} “${name(e)}”? This cannot be undone. It is refused while other records still use it.`
      : `Drop the saved copy of “${name(e)}”? It can no longer be restored.`
    Alert.alert('Purge', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Purge',
        style: 'destructive',
        onPress: async () => {
          setBusyId(e.id)
          const r = await adminApi(`/api/sys-control/vendors/${vendorId}/recycle-bin/${e.id}`, { method: 'DELETE' })
          setBusyId(null)
          if (!r.ok) return Alert.alert('Could not purge', r.error)
          load(1)
        },
      },
    ])
  }

  return (
    <AdminShell title="Recycle bin" subtitle={params.vendorName ? String(params.vendorName) : undefined} tab="vendors" back>
      <ScrollView
        style={adminStyles.scroll}
        contentContainerStyle={adminStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(1) }} />}
      >
        <Text style={{ color: THEME.colors.textMuted, fontSize: 13 }}>
          Records this vendor deleted. Master data is archived (hidden from the vendor); drafts are deleted with a copy kept.
        </Text>
        <View style={adminStyles.segment}>
          {STATUSES.map((s) => (
            <Pressable key={s.value} style={[adminStyles.segmentBtn, status === s.value && adminStyles.segmentBtnActive]} onPress={() => setStatus(s.value)}>
              <Text style={[adminStyles.segmentText, status === s.value && adminStyles.segmentTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={adminStyles.input}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => setQ(search.trim())}
          placeholder="Search name or deleted by"
          placeholderTextColor={THEME.colors.textMuted}
          returnKeyType="search"
        />
        {!canManage ? <Text style={{ color: THEME.colors.textMuted, fontSize: 12 }}>Restoring or purging needs an owner admin.</Text> : null}

        {loading ? <LoadingView /> : error ? <ErrorView message={error} onRetry={() => load(1)} /> : (
          <>
            <SectionTitle>{`${total} ${total === 1 ? 'entry' : 'entries'}`}</SectionTitle>
            {rows.length === 0 ? (
              <Card><Text style={{ color: THEME.colors.textMuted }}>{status === 'open' ? 'The recycle bin is empty.' : 'Nothing here.'}</Text></Card>
            ) : rows.map((e) => (
              <Card key={e.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: '800', color: THEME.colors.text }} numberOfLines={1}>{name(e)}</Text>
                  <Pill text={e.status === 'open' ? 'In bin' : e.status === 'restored' ? 'Restored' : 'Purged'} tone={e.status === 'open' ? 'warn' : e.status === 'restored' ? 'ok' : 'muted'} />
                </View>
                <Text style={{ color: THEME.colors.textMuted, fontSize: 12 }}>
                  {e.label}{e.mode === 'delete' ? ' · deleted, copy kept' : ' · archived'} · {timeAgo(e.deleted_at)}{e.deleted_by_name ? ` by ${e.deleted_by_name}` : ''}
                </Text>
                {canManage && e.status === 'open' ? (
                  busyId === e.id ? <ActivityIndicator /> : (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable style={[adminStyles.ghostBtn, { flex: 1, height: 40 }]} onPress={() => restore(e)}>
                        <Text style={adminStyles.ghostBtnText}>Restore</Text>
                      </Pressable>
                      <Pressable style={[adminStyles.dangerBtn, { flex: 1, height: 40 }]} onPress={() => purge(e)}>
                        <Text style={adminStyles.dangerBtnText}>Purge</Text>
                      </Pressable>
                    </View>
                  )
                ) : null}
              </Card>
            ))}
            {rows.length < total ? (
              <Pressable style={adminStyles.ghostBtn} onPress={() => load(page + 1)}>
                <Text style={adminStyles.ghostBtnText}>Load more</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </AdminShell>
  )
}

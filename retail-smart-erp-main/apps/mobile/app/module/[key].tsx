// Read-only list for a business module (quotations, hire purchase, deliveries, warranty claims,
// print jobs, recurring invoices, payments received, projects, customers) from its existing
// GET /api/<module> endpoint. Creating / editing happens on the web page ("Open on web").
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, RefreshControl, ActivityIndicator } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, asList, isNetworkError, qs } from '../../src/lib/api'
import { THEME, formatLKR } from '../../src/lib/theme'
import { useSessionUser } from '../../src/lib/session'
import { MODULE_LISTS, humanize, moduleRowView, openWeb, statusTone } from '../../src/lib/modules'
import { Badge, Banner, Card, EmptyState, IconButton, ListItem, ScreenHeader, Skeleton, uiStyles } from '../../src/components/ui'

const PAGE_SIZE = 30

export default function ModuleListScreen() {
  const { key } = useLocalSearchParams<{ key: string }>()
  const cfg = MODULE_LISTS[String(key)]
  const { user } = useSessionUser()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<unknown[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(
    async (p: number, append: boolean) => {
      if (!cfg) return
      const s = ++seq.current
      if (append) setMore(true)
      const params = cfg.paged ? { search: cfg.search ? query.trim() || undefined : undefined, page: p, pageSize: PAGE_SIZE } : {}
      const res = await apiGet<any>(`${cfg.endpoint}${qs(params)}`)
      if (s !== seq.current) return
      if (res.ok) {
        let list = asList<unknown>(res.data, ...cfg.listKeys)
        // Lists without server search (quotations): filter on the device
        if (!cfg.search && query.trim()) {
          const q = query.trim().toLowerCase()
          list = list.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
        }
        setRows((prev) => (append ? [...prev, ...list] : list))
        setPage(p)
        setTotalPages(res.data?.pagination?.totalPages || 1)
        setTotal(typeof res.data?.pagination?.total === 'number' ? res.data.pagination.total : list.length)
        setError(null)
      } else {
        if (!append) setRows([])
        setError(isNetworkError(res) ? 'Offline — this list needs a connection.' : res.status === 403 ? 'This module is not enabled for your role or business.' : res.error)
      }
      setLoading(false)
      setMore(false)
    },
    [cfg, query]
  )

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => load(1, false), 300)
    return () => clearTimeout(t)
  }, [load])

  if (!cfg) {
    return (
      <View style={uiStyles.screen}>
        <ScreenHeader title="Not found" />
        <EmptyState icon="help-circle-outline" title="Unknown module" />
      </View>
    )
  }

  return (
    <View style={uiStyles.screen}>
      <ScreenHeader
        title={cfg.title}
        subtitle={total !== null ? `${total} record${total === 1 ? '' : 's'}` : user?.tenantName}
        right={<IconButton name="open-outline" label="Open on web" color={THEME.colors.primary} onPress={() => openWeb(user, cfg.webPath)} />}
      />
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={THEME.colors.textMuted} />
          <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={`Search ${cfg.title.toLowerCase()}`} placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={THEME.colors.textSubtle} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {error ? <Banner text={error} tone="error" icon="alert-circle-outline" /> : null}

      {loading && rows.length === 0 ? (
        <View style={[uiStyles.content, { gap: 10 }]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={60} radius={12} />
          ))}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r, i) => moduleRowView(r, i).id}
          contentContainerStyle={[uiStyles.content, { paddingBottom: 24, flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (cfg.paged && !more && page < totalPages) load(page + 1, true)
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              colors={[THEME.colors.primary]}
              onRefresh={async () => {
                setRefreshing(true)
                await load(1, false)
                setRefreshing(false)
              }}
            />
          }
          ListEmptyComponent={
            error ? null : <EmptyState icon={cfg.icon} title={`No ${cfg.title.toLowerCase()} yet`} subtitle="Create them on the web — they show up here." actionLabel="Open on web" onAction={() => openWeb(user, cfg.webPath)} />
          }
          ListFooterComponent={more ? <ActivityIndicator style={{ padding: 16 }} color={THEME.colors.primary} /> : null}
          renderItem={({ item, index }) => {
            const v = moduleRowView(item, index)
            return (
              <Card style={styles.row}>
                <ListItem
                  icon={cfg.icon}
                  iconTone={statusTone(v.status)}
                  title={v.title}
                  subtitle={v.subtitle || undefined}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {v.amount !== null ? <Text style={styles.amount}>{formatLKR(v.amount)}</Text> : null}
                      {v.status ? <Badge text={humanize(v.status)} tone={statusTone(v.status)} /> : null}
                    </View>
                  }
                  onPress={() => openWeb(user, cfg.noDetailPage ? cfg.webPath : `${cfg.webPath}/${v.id}`)}
                  last
                />
              </Card>
            )
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  toolbar: { backgroundColor: THEME.colors.card, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.border },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, minHeight: 48, paddingHorizontal: 12, borderRadius: 12, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border },
  input: { flex: 1, fontSize: 15, color: THEME.colors.text, paddingVertical: 8 },
  row: { padding: 0, overflow: 'hidden', marginBottom: 8 },
  amount: { fontSize: 14, fontWeight: '800', color: THEME.colors.text, fontVariant: ['tabular-nums'] },
})

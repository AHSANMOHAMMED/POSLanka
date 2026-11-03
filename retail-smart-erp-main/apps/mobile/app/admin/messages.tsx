// Support conversations with vendor accounts. Tap one to read and reply (messages/[id]).
import React, { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, RefreshControl, TextInput, StyleSheet } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Pill, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'
import { FilterChips, ListFooter, MoreShell } from '../../src/components/admin/AdminForm'
import { titleCase, usePagedList } from '../../src/lib/adminForms'

interface Conversation {
  id: string
  subject: string
  status: 'open' | 'closed' | 'archived' | string
  priority: 'low' | 'normal' | 'high' | 'urgent' | string
  category?: string
  lastMessageAt?: string | null
  lastMessagePreview?: string | null
  unreadByAdmin?: boolean
  createdAt: string
  account?: { id: string; email: string; fullName?: string | null } | null
}

type Filter = 'open' | 'unread' | 'closed' | 'archived' | 'all'
const FILTERS: Filter[] = ['open', 'unread', 'closed', 'archived', 'all']

export default function AdminMessagesScreen() {
  const [filter, setFilter] = useState<Filter>('open')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const list = usePagedList<Conversation>({
    path: (page) => {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (filter === 'unread') p.set('unread', '1')
      else if (filter !== 'all') p.set('status', filter)
      if (debounced) p.set('search', debounced)
      return `/api/sys-control/messages?${p.toString()}`
    },
    pick: (b) => ({ rows: Array.isArray(b?.data) ? b.data : [], total: b?.pagination?.total }),
    deps: [filter, debounced],
  })
  const counts: Record<string, number> = list.extra?.counts || {}

  // Coming back from a thread: refresh read state
  useFocusEffect(
    React.useCallback(() => {
      list.silentReload()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  )

  return (
    <MoreShell title="Messages" subtitle={`${counts.unread ?? 0} unread · ${counts.open ?? 0} open`}>
      <View style={styles.searchWrap}>
        <TextInput
          style={adminStyles.input}
          placeholder="Search subject, message or vendor email…"
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FilterChips value={filter} onChange={(v) => setFilter(v)} options={FILTERS.map((f) => ({ value: f, label: titleCase(f), count: f === 'all' ? counts.all : counts[f] }))} />

      {list.loading ? (
        <LoadingView text="Loading conversations…" />
      ) : list.error ? (
        <ErrorView message={list.error} onRetry={list.reload} />
      ) : (
        <FlatList
          data={list.rows}
          keyExtractor={(c) => c.id}
          contentContainerStyle={adminStyles.content}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Text style={adminStyles.empty}>No conversations here.</Text>}
          ListFooterComponent={<ListFooter loadingMore={list.loadingMore} hasMore={list.hasMore} shown={list.rows.length} total={list.total} onMore={list.loadMore} />}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push({ pathname: '/admin/messages/[id]', params: { id: item.id } } as any)}>
              {item.unreadByAdmin ? <View style={styles.dot} /> : <View style={{ width: 10 }} />}
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[styles.subject, item.unreadByAdmin && { color: THEME.colors.primary }]} numberOfLines={1}>{item.subject}</Text>
                <Text style={adminStyles.muted} numberOfLines={1}>{item.account?.fullName || item.account?.email || 'Unknown account'}</Text>
                <Text style={styles.preview} numberOfLines={2}>{item.lastMessagePreview || ''}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  <Pill text={item.status} tone={item.status === 'open' ? 'ok' : 'muted'} />
                  {item.priority !== 'normal' ? <Pill text={item.priority} tone={item.priority === 'urgent' || item.priority === 'high' ? 'error' : 'muted'} /> : null}
                  {item.category && item.category !== 'general' ? <Pill text={item.category.replace(/_/g, ' ')} tone="primary" /> : null}
                </View>
              </View>
              <Text style={adminStyles.muted}>{timeAgo(item.lastMessageAt || item.createdAt)}</Text>
            </Pressable>
          )}
        />
      )}
    </MoreShell>
  )
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: THEME.colors.primary, marginTop: 5 },
  subject: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  preview: { fontSize: 12, color: THEME.colors.text, marginTop: 3 },
})

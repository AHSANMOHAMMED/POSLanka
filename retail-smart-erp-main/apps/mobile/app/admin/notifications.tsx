// Notification broadcasts to vendors: history list + compose (needs `notifications`).
import React, { useState } from 'react'
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native'
import { useAdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { EmptyView, ErrorView, LoadingView } from '../../src/components/StateViews'
import { Pill, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'
import { FormModal, ListFooter, MoreShell, formStyles } from '../../src/components/admin/AdminForm'
import { BroadcastForm, type AudienceTier } from '../../src/components/admin/BroadcastForm'
import { usePagedList } from '../../src/lib/adminForms'
import { Ionicons } from '@expo/vector-icons'

interface Broadcast {
  id: string
  title: string
  body: string
  category?: string
  channels?: string[]
  status?: string
  vendorCount?: number
  inAppCount?: number
  accountCount?: number
  emailSent?: number
  pushSent?: number
  pushFailed?: number
  createdAt: string
  sentBy?: string | null
  audience?: { mode?: string }
}

export default function AdminNotificationsScreen() {
  const { can } = useAdminUser()
  const canSend = can('notifications')
  const [composing, setComposing] = useState(false)
  const list = usePagedList<Broadcast>({
    path: (page) => `/api/sys-control/notifications?page=${page}&pageSize=15${page === 1 ? '&meta=1' : ''}`,
    pick: (b) => ({ rows: Array.isArray(b?.broadcasts) ? b.broadcasts : [], total: b?.pagination?.total }),
    deps: [],
  })
  const tiers: AudienceTier[] = Array.isArray(list.extra?.tiers) ? list.extra.tiers : []

  return (
    <MoreShell title="Notifications" subtitle={`${list.total} broadcasts sent`}>
      {list.loading ? (
        <LoadingView text="Loading broadcasts…" />
      ) : list.error ? (
        <ErrorView message={list.error} onRetry={list.reload} />
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={list.rows}
            keyExtractor={(b) => b.id}
            contentContainerStyle={[adminStyles.content, { paddingBottom: 88 }]}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="📣" title="No broadcasts yet" subtitle="Send a platform notification to vendors. Optional Sinhala and Tamil copies show on login and in their inbox." />}
            ListFooterComponent={<ListFooter loadingMore={list.loadingMore} hasMore={list.hasMore} shown={list.rows.length} total={list.total} onMore={list.loadMore} />}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {item.category ? <Pill text={item.category} tone="primary" /> : null}
                  {(item.channels || []).map((c) => <Pill key={c} text={c.replace('_', ' ')} />)}
                  {item.status && item.status !== 'sent' && item.status !== 'completed' ? <Pill text={item.status} tone="warn" /> : null}
                </View>
                <Text style={[adminStyles.muted, { marginTop: 6 }]}>
                  {item.vendorCount ?? 0} vendors{item.emailSent ? ` · ${item.emailSent} emails` : ''}{item.pushSent ? ` · ${item.pushSent} push` : ''}{item.sentBy ? ` · ${item.sentBy}` : ''} · {timeAgo(item.createdAt)}
                </Text>
              </View>
            )}
          />
          {canSend ? (
            <Pressable style={formStyles.fab} onPress={() => setComposing(true)} accessibilityLabel="New notification">
              <Ionicons name="megaphone-outline" size={20} color="#FFF" />
              <Text style={formStyles.fabText}>New</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <FormModal visible={composing} title="New notification" confirmLabel={null} onCancel={() => setComposing(false)}>
        <BroadcastForm kind="notification" tiers={tiers} canSend={canSend} onSent={() => { setComposing(false); list.silentReload() }} />
      </FormModal>
    </MoreShell>
  )
}

const styles = StyleSheet.create({
  row: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  title: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  body: { fontSize: 12, color: THEME.colors.text, marginTop: 3 },
})

// Send an email to vendors (owners / staff) or plain addresses via the system transport.
// POST /api/sys-control/send-email (needs `notifications`). Shows the recent sent emails.
import React from 'react'
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native'
import { useAdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Card, Pill, SectionTitle, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'
import { MoreShell, Notice } from '../../src/components/admin/AdminForm'
import { BroadcastForm, type AudienceTier } from '../../src/components/admin/BroadcastForm'
import { usePagedList } from '../../src/lib/adminForms'

interface SentEmail {
  id: string
  title: string
  status?: string
  vendorCount?: number
  emailSent?: number
  emailLogged?: number
  emailFailed?: number
  createdAt: string
  sentBy?: string | null
}

export default function AdminSendEmailScreen() {
  const { can } = useAdminUser()
  const canSend = can('notifications')
  const list = usePagedList<SentEmail>({
    path: (page) => `/api/sys-control/send-email?page=${page}&pageSize=10${page === 1 ? '&meta=1' : ''}`,
    pick: (b) => ({ rows: Array.isArray(b?.broadcasts) ? b.broadcasts : [], total: b?.pagination?.total }),
    deps: [],
  })
  const tiers: AudienceTier[] = Array.isArray(list.extra?.tiers) ? list.extra.tiers : []
  const emailConfigured = list.extra?.emailConfigured

  return (
    <MoreShell title="Send email" subtitle="System email to vendors or addresses">
      {list.loading ? (
        <LoadingView text="Loading…" />
      ) : list.error && list.rows.length === 0 && !list.extra ? (
        <ErrorView message={list.error} onRetry={list.reload} />
      ) : (
        <ScrollView
          style={adminStyles.scroll}
          contentContainerStyle={adminStyles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
        >
          {emailConfigured === false ? <Notice tone="warn" text="No email provider is configured on the server (RESEND_API_KEY). Emails are only logged, not delivered." /> : null}
          <Card style={{ padding: 14 }}>
            <BroadcastForm kind="email" tiers={tiers} canSend={canSend} onSent={list.silentReload} />
          </Card>

          <SectionTitle>Recently sent</SectionTitle>
          <Card>
            {list.rows.map((e) => (
              <View key={e.id} style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.title} numberOfLines={1}>{e.title}</Text>
                  <Text style={adminStyles.muted}>
                    {e.vendorCount ?? 0} vendors · {e.emailSent ?? 0} sent{e.emailLogged ? ` · ${e.emailLogged} logged` : ''}{e.emailFailed ? ` · ${e.emailFailed} failed` : ''}
                    {e.sentBy ? ` · ${e.sentBy}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {e.emailFailed ? <Pill text="failures" tone="error" /> : null}
                  <Text style={adminStyles.muted}>{timeAgo(e.createdAt)}</Text>
                </View>
              </View>
            ))}
            {list.rows.length === 0 ? <Text style={adminStyles.empty}>Nothing sent yet.</Text> : null}
          </Card>
        </ScrollView>
      )}
    </MoreShell>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  title: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
})

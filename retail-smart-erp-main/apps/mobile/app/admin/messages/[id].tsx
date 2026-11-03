// One support conversation: thread, reply (messages permission), close / reopen / archive.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, RefreshControl, StyleSheet } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { adminGet, adminPost, adminPut, useAdminUser } from '../../../src/lib/adminApi'
import { THEME } from '../../../src/lib/theme'
import { ErrorView, LoadingView } from '../../../src/components/StateViews'
import { AdminShell, Pill, adminStyles, timeAgo } from '../../../src/components/admin/AdminShell'
import { LinkButton, Notice } from '../../../src/components/admin/AdminForm'
import { alertIfFailed, confirmAction, fmtDateTime } from '../../../src/lib/adminForms'

interface Msg {
  id: string
  senderType: 'admin' | 'account' | string
  senderName?: string | null
  content: string
  createdAt: string
}

interface Thread {
  conversation: { id: string; subject: string; status: string; priority: string; category?: string }
  account: { id: string; email: string; fullName?: string | null; phone?: string | null }
  vendors: Array<{ id: string; name: string; businessId: string; status: string; isOwner?: boolean }>
  messages: Msg[]
}

export default function AdminMessageThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { can } = useAdminUser()
  const canReply = can('messages')
  const [data, setData] = useState<Thread | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const scroller = useRef<ScrollView>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!id) return
      if (!silent) setLoading(true)
      setError(null)
      const res = await adminGet<Thread>(`/api/sys-control/messages/${id}`)
      if (res.ok) setData(res.data)
      else setError(res.error)
      setLoading(false)
      setRefreshing(false)
    },
    [id]
  )

  useEffect(() => {
    load()
  }, [load])

  async function send() {
    const content = text.trim()
    if (!content || !id) return
    setSending(true)
    const res = await adminPost<Msg>(`/api/sys-control/messages/${id}`, { content })
    setSending(false)
    if (!alertIfFailed(res, 'Reply not sent')) return
    setText('')
    await load(true)
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 100)
  }

  async function setAction(action: 'close' | 'reopen' | 'archive') {
    const res = await adminPut(`/api/sys-control/messages/${id}`, { action })
    if (alertIfFailed(res, 'Update failed')) load(true)
  }

  const status = data?.conversation.status
  const archived = status === 'archived'

  return (
    <AdminShell title={data?.conversation.subject || 'Conversation'} subtitle={data ? data.account.fullName || data.account.email : undefined} tab="more" back tabs backHref="/admin/messages">
      {loading ? (
        <LoadingView text="Loading conversation…" />
      ) : error || !data ? (
        <ErrorView message={error || 'Conversation not found'} onRetry={() => load()} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scroller}
            style={adminStyles.scroll}
            contentContainerStyle={adminStyles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true) }} />}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
          >
            <View style={styles.meta}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <Pill text={data.conversation.status} tone={status === 'open' ? 'ok' : 'muted'} />
                <Pill text={data.conversation.priority} tone={data.conversation.priority === 'urgent' || data.conversation.priority === 'high' ? 'error' : 'muted'} />
                {data.conversation.category ? <Pill text={data.conversation.category.replace(/_/g, ' ')} tone="primary" /> : null}
                <View style={{ flex: 1 }} />
                {canReply ? (
                  status === 'open' ? (
                    <LinkButton label="Close" onPress={() => confirmAction('Close conversation?', 'The vendor can still reopen it by replying.', 'Close', () => setAction('close'))} />
                  ) : (
                    <LinkButton label="Reopen" onPress={() => setAction('reopen')} />
                  )
                ) : null}
                {canReply && !archived ? <LinkButton label="Archive" tone="danger" onPress={() => confirmAction('Archive conversation?', 'It moves to the Archived list. You cannot reply until it is restored.', 'Archive', () => setAction('archive'), true)} /> : null}
              </View>
              <Text style={adminStyles.muted}>{data.account.email}{data.account.phone ? ` · ${data.account.phone}` : ''}</Text>
              {data.vendors.map((v) => (
                <Pressable key={v.id} onPress={() => router.push({ pathname: '/admin/vendors/[id]', params: { id: v.id } } as any)}>
                  <Text style={[adminStyles.muted, { color: THEME.colors.primary, fontWeight: '700' }]}>
                    {v.name} ({v.businessId}){v.isOwner ? ' · owner' : ''}{v.status !== 'active' ? ` · ${v.status}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>

            {data.messages.map((m) => {
              const mine = m.senderType === 'admin'
              return (
                <View key={m.id} style={[styles.bubbleWrap, mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.sender, mine && { color: '#CFE0FF' }]}>{mine ? 'Support team' : m.senderName || data.account.fullName || 'Vendor'}</Text>
                    <Text selectable style={[styles.body, mine && { color: '#FFF' }]}>{m.content}</Text>
                    <Text style={[styles.time, mine && { color: '#CFE0FF' }]}>{fmtDateTime(m.createdAt)} · {timeAgo(m.createdAt)}</Text>
                  </View>
                </View>
              )
            })}
            {data.messages.length === 0 ? <Text style={adminStyles.empty}>No messages yet.</Text> : null}
          </ScrollView>

          {canReply ? (
            archived ? (
              <View style={styles.composer}><Notice tone="warn" text="This conversation is archived. Reopen it to reply." /></View>
            ) : (
              <View style={styles.composer}>
                <TextInput
                  style={[adminStyles.input, styles.composerInput]}
                  value={text}
                  onChangeText={setText}
                  placeholder="Write a reply…"
                  placeholderTextColor={THEME.colors.textSubtle}
                  multiline
                  maxLength={5000}
                />
                <Pressable style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]} disabled={!text.trim() || sending} onPress={send}>
                  <Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text>
                </Pressable>
              </View>
            )
          ) : (
            <View style={styles.composer}><Notice text="Replying needs the Support or Owner role." /></View>
          )}
        </KeyboardAvoidingView>
      )}
    </AdminShell>
  )
}

const styles = StyleSheet.create({
  meta: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, gap: 4 },
  bubbleWrap: { width: '100%' },
  bubble: { maxWidth: '86%', borderRadius: 14, padding: 10 },
  bubbleMine: { backgroundColor: THEME.colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.colors.border, borderBottomLeftRadius: 4 },
  sender: { fontSize: 10, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', marginBottom: 2 },
  body: { fontSize: 14, color: THEME.colors.text },
  time: { fontSize: 10, color: THEME.colors.textSubtle, marginTop: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: THEME.colors.border },
  composerInput: { flex: 1, maxHeight: 120 },
  sendBtn: { height: 46, paddingHorizontal: 16, borderRadius: 12, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#FFF', fontWeight: '800' },
})

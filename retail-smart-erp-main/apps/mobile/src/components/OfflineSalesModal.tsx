// W6: offline sales on this device — waiting to sync, rejected by the server ("Needs attention",
// Retry / Discard for managers) and recently synced (offline receipt number → real invoice number).
import React, { useCallback, useEffect, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native'
import { THEME, formatLKR } from '../lib/theme'
import {
  discardRejected,
  getQueuedSales,
  getSyncedSales,
  retryOne,
  subscribe,
  syncNow,
  type QueuedSale,
  type QueueState,
  type SyncedSale,
} from '../lib/offlineQueue'

interface Props {
  visible: boolean
  onClose: () => void
  /** managers may discard rejected sales */
  canDiscard: boolean
}

function when(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function label(s: QueuedSale): string {
  return s.offlineRef || `Sale ${s.clientSaleId.slice(0, 8).toUpperCase()}`
}

export function OfflineSalesModal({ visible, onClose, canDiscard }: Props) {
  const [queued, setQueued] = useState<QueuedSale[]>([])
  const [synced, setSynced] = useState<SyncedSale[]>([])
  const [state, setState] = useState<QueueState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [q, s] = await Promise.all([getQueuedSales(), getSyncedSales()])
    setQueued(q)
    setSynced(s)
  }, [])

  useEffect(() => {
    if (!visible) return
    reload()
    return subscribe((st) => {
      setState(st)
      reload()
    })
  }, [visible, reload])

  const pending = queued.filter((s) => !s.rejected)
  const rejected = queued.filter((s) => s.rejected)

  async function onRetry(s: QueuedSale) {
    setBusy(s.clientSaleId)
    try {
      await retryOne(s.clientSaleId)
    } finally {
      setBusy(null)
      reload()
    }
  }

  function onDiscard(s: QueuedSale) {
    Alert.alert(
      'Discard offline sale?',
      `${label(s)} (${formatLKR(Number(s.payload.total) || 0)}) will be removed from this device and will NOT be recorded on the server. The money collected must be handled manually.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await discardRejected(s.clientSaleId)
            reload()
          },
        },
      ]
    )
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <Text style={styles.title}>Offline sales</Text>
          <Pressable
            style={styles.syncBtn}
            disabled={!!state?.syncing}
            onPress={() => syncNow().finally(reload)}
          >
            {state?.syncing ? <ActivityIndicator size="small" color={THEME.colors.onPrimary} /> : <Text style={styles.syncText}>Sync now</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {state && !state.online ? (
            <Text style={styles.note}>Offline — sales are kept on this device and sync automatically when the connection returns.</Text>
          ) : null}

          <Text style={styles.section}>Needs attention ({rejected.length})</Text>
          {rejected.length === 0 ? <Text style={styles.muted}>Nothing rejected.</Text> : null}
          {rejected.map((s) => (
            <View key={s.clientSaleId} style={[styles.card, styles.cardError]}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{label(s)}</Text>
                <Text style={styles.amount}>{formatLKR(Number(s.payload.total) || 0)}</Text>
              </View>
              <Text style={styles.muted}>Sold {when(s.queuedAt)}</Text>
              <Text style={styles.errorText}>{s.lastError || 'Rejected by the server'}</Text>
              <View style={styles.actions}>
                <Pressable style={styles.actionBtn} disabled={busy === s.clientSaleId} onPress={() => onRetry(s)}>
                  {busy === s.clientSaleId ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : <Text style={styles.actionText}>Retry</Text>}
                </Pressable>
                {canDiscard ? (
                  <Pressable style={[styles.actionBtn, styles.discardBtn]} onPress={() => onDiscard(s)}>
                    <Text style={[styles.actionText, { color: THEME.colors.error }]}>Discard</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.mutedSmall}>A manager can discard this sale.</Text>
                )}
              </View>
            </View>
          ))}

          <Text style={styles.section}>Waiting to sync ({pending.length})</Text>
          {pending.length === 0 ? <Text style={styles.muted}>All offline sales are synced.</Text> : null}
          {pending.map((s) => (
            <View key={s.clientSaleId} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{label(s)}</Text>
                <Text style={styles.amount}>{formatLKR(Number(s.payload.total) || 0)}</Text>
              </View>
              <Text style={styles.muted}>
                Sold {when(s.queuedAt)}
                {s.attempts > 0 ? ` · ${s.attempts} attempt(s)` : ''}
                {s.nextAttemptAt && s.nextAttemptAt > Date.now() ? ` · retry ${new Date(s.nextAttemptAt).toLocaleTimeString()}` : ''}
              </Text>
              {s.lastError ? <Text style={styles.mutedSmall}>{s.lastError}</Text> : null}
            </View>
          ))}

          <Text style={styles.section}>Synced sales ({synced.length})</Text>
          {synced.length === 0 ? <Text style={styles.muted}>None yet.</Text> : null}
          {synced.map((s) => (
            <View key={s.clientSaleId} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>
                  {s.offlineRef || s.clientSaleId.slice(0, 8).toUpperCase()} → {s.invoiceNo}
                </Text>
                <Text style={styles.amount}>{formatLKR(s.total)}</Text>
              </View>
              <Text style={styles.muted}>Synced {when(s.syncedAt)}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: THEME.spacing.lg,
    paddingTop: 48,
    paddingBottom: THEME.spacing.md,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    gap: THEME.spacing.md,
  },
  backBtn: { padding: 6 },
  backText: { fontSize: 22, color: THEME.colors.text },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: THEME.colors.text },
  syncBtn: { backgroundColor: THEME.colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: THEME.radius.md, minWidth: 90, alignItems: 'center' },
  syncText: { color: THEME.colors.onPrimary, fontWeight: '700' },
  body: { padding: THEME.spacing.lg, gap: THEME.spacing.sm, paddingBottom: 60 },
  note: { backgroundColor: THEME.colors.secondaryLight, color: THEME.colors.onSecondaryContainer, padding: 10, borderRadius: THEME.radius.md, fontSize: 12 },
  section: { marginTop: THEME.spacing.md, fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  card: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border, padding: THEME.spacing.md, gap: 4 },
  cardError: { borderColor: THEME.colors.error, backgroundColor: THEME.colors.errorLight },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text, flexShrink: 1 },
  amount: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  muted: { fontSize: 12, color: THEME.colors.textMuted },
  mutedSmall: { fontSize: 11, color: THEME.colors.textMuted },
  errorText: { fontSize: 12, color: THEME.colors.error, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  actionBtn: { borderWidth: 1, borderColor: THEME.colors.primary, borderRadius: THEME.radius.md, paddingHorizontal: 14, paddingVertical: 6, minWidth: 70, alignItems: 'center' },
  discardBtn: { borderColor: THEME.colors.error },
  actionText: { color: THEME.colors.primary, fontWeight: '700' },
})

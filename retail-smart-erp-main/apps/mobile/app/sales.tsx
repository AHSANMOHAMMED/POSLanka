// Sales history: GET /api/sales (branch-scoped by the server) with search, status filter and
// paging. Tapping a sale opens it on the web (full invoice, print / email / credit note).
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, RefreshControl, ActivityIndicator, ScrollView } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, asList, isNetworkError, qs } from '../src/lib/api'
import { THEME, formatLKR } from '../src/lib/theme'
import { useSessionUser } from '../src/lib/session'
import { openWeb, humanize, statusTone } from '../src/lib/modules'
import { saleCustomer, timeOf, type SaleRow } from '../src/lib/dashboard'
import { paymentMethodLabel } from '../src/lib/shift'
import { Badge, Card, EmptyState, ListItem, ScreenHeader, Skeleton, Banner, uiStyles } from '../src/components/ui'

const STATUSES = ['all', 'completed', 'partial', 'pending', 'void'] as const
const PAGE_SIZE = 30

export default function SalesHistoryScreen() {
  const params = useLocalSearchParams<{ q?: string }>()
  const { user } = useSessionUser()
  const [query, setQuery] = useState(params.q ? String(params.q) : '')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const [rows, setRows] = useState<SaleRow[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(
    async (p: number, append: boolean) => {
      const s = ++seq.current
      if (append) setMore(true)
      const res = await apiGet<any>(`/api/sales${qs({ search: query.trim() || undefined, status: status === 'all' ? undefined : status, page: p, pageSize: PAGE_SIZE })}`)
      if (s !== seq.current) return
      if (res.ok) {
        const list = asList<SaleRow>(res.data)
        setRows((prev) => (append ? [...prev, ...list] : list))
        setPage(p)
        setTotalPages(res.data?.pagination?.totalPages || 1)
        setError(null)
      } else {
        if (!append) setRows([])
        setError(isNetworkError(res) ? 'Offline — sales history needs a connection.' : res.error)
      }
      setLoading(false)
      setMore(false)
    },
    [query, status]
  )

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => load(1, false), 300)
    return () => clearTimeout(t)
  }, [load])

  return (
    <View style={uiStyles.screen}>
      <ScreenHeader title="Sales history" subtitle={user?.tenantName} />
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={THEME.colors.textMuted} />
          <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Invoice no. or customer" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={THEME.colors.textSubtle} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {STATUSES.map((s) => (
            <Pressable key={s} onPress={() => setStatus(s)} style={[styles.chip, status === s && styles.chipActive]}>
              <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s === 'all' ? 'All' : humanize(s)}</Text>
            </Pressable>
          ))}
        </ScrollView>
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
          keyExtractor={(s) => s.id}
          contentContainerStyle={[uiStyles.content, { paddingBottom: 24, flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!more && page < totalPages) load(page + 1, true)
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
          ListEmptyComponent={<EmptyState icon="receipt-outline" title="No sales found" subtitle={query ? 'Try another invoice number or name.' : 'Sales appear here as they are made.'} />}
          ListFooterComponent={more ? <ActivityIndicator style={{ padding: 16 }} color={THEME.colors.primary} /> : null}
          renderItem={({ item: s }) => (
            <Card style={styles.row}>
              <ListItem
                icon={s.isReturn ? 'return-down-back-outline' : 'receipt-outline'}
                iconTone={s.isReturn ? 'error' : statusTone(s.status)}
                title={s.invoiceNo}
                subtitle={`${saleCustomer(s)} · ${timeOf(s.createdAt)}${s.paymentMethod ? ` · ${paymentMethodLabel(s.paymentMethod)}` : ''}`}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[styles.amount, s.isReturn && { color: THEME.colors.error }]}>{formatLKR(s.total)}</Text>
                    {s.status !== 'completed' ? <Badge text={humanize(s.status)} tone={statusTone(s.status)} /> : null}
                  </View>
                }
                onPress={() => openWeb(user, `/sales/${s.id}`)}
                last
              />
            </Card>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  toolbar: { backgroundColor: THEME.colors.card, paddingTop: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.border },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, minHeight: 48, paddingHorizontal: 12, borderRadius: 12, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border },
  input: { flex: 1, fontSize: 15, color: THEME.colors.text, paddingVertical: 8 },
  chips: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: THEME.colors.border, justifyContent: 'center', backgroundColor: THEME.colors.card },
  chipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  chipTextActive: { color: THEME.colors.onPrimary },
  row: { padding: 0, overflow: 'hidden', marginBottom: 8 },
  amount: { fontSize: 14, fontWeight: '800', color: THEME.colors.text, fontVariant: ['tabular-nums'] },
})

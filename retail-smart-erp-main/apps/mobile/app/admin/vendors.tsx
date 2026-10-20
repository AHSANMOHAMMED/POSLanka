import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, FlatList, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { adminGet } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { AdminShell, Pill, adminStyles, businessTypeLabel, statusTone } from '../../src/components/admin/AdminShell'

const PAGE_SIZE = 30

interface VendorRow {
  id: string
  name: string
  slug: string
  email?: string | null
  phone?: string | null
  businessType: string
  country?: string | null
  currency?: string | null
  status: 'active' | 'suspended' | 'cancelled' | 'locked' | string
  plan?: string | null
  createdAt: string
  setupCompletedAt?: string | null
  featureFlags?: Record<string, boolean>
  userCount?: number
  subscriptionStatus?: string | null
  subscriptionPeriodEnd?: string | null
}

interface VendorsResponse {
  vendors: VendorRow[]
  pagination: { page: number; pageSize: number; total: number }
}

export default function AdminVendorsScreen() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [rows, setRows] = useState<VendorRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const fetchPage = useCallback(
    async (p: number, append: boolean) => {
      const mySeq = ++seq.current
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) })
      if (debounced) params.set('q', debounced)
      const res = await adminGet<VendorsResponse>(`/api/sys-control/vendors?${params.toString()}`)
      if (mySeq !== seq.current) return
      if (!res.ok) {
        setError(res.error)
        if (!append) setRows([])
      } else {
        const list = res.data.vendors || []
        setRows((prev) => (append ? [...prev, ...list] : list))
        setTotal(res.data.pagination?.total ?? list.length)
        setPage(p)
      }
      setLoading(false)
      setLoadingMore(false)
    },
    [debounced]
  )

  useEffect(() => {
    fetchPage(1, false)
  }, [fetchPage])

  const hasMore = rows.length < total

  return (
    <AdminShell title="Vendors" subtitle={`${total} companies on the platform`} tab="vendors">
      <View style={styles.searchWrap}>
        <TextInput
          style={adminStyles.input}
          placeholder="Search by name, slug or email…"
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <LoadingView text="Loading vendors…" />
      ) : error && rows.length === 0 ? (
        <ErrorView message={error} onRetry={() => fetchPage(1, false)} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(v) => v.id}
          contentContainerStyle={adminStyles.content}
          onEndReached={() => {
            if (hasMore && !loadingMore) fetchPage(page + 1, true)
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Text style={adminStyles.empty}>No vendors match "{debounced}".</Text>}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={THEME.colors.primary} style={{ padding: 12 }} />
            ) : hasMore ? (
              <Pressable style={adminStyles.ghostBtn} onPress={() => fetchPage(page + 1, true)}>
                <Text style={adminStyles.ghostBtnText}>
                  Load more ({rows.length} of {total})
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push({ pathname: '/admin/vendors/[id]', params: { id: item.id } } as any)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(item.name || '?').slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {item.slug} • {businessTypeLabel(item.businessType)} • {item.userCount ?? 0} users
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <Pill text={item.status} tone={statusTone(item.status)} />
                  {item.subscriptionStatus ? <Pill text={`sub: ${item.subscriptionStatus}`} tone={statusTone(item.subscriptionStatus)} /> : null}
                  {item.plan ? <Pill text={item.plan} tone="primary" /> : null}
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}
    </AdminShell>
  )
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  avatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: THEME.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: THEME.colors.primary, fontWeight: '900', fontSize: 13 },
  name: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  chevron: { fontSize: 22, color: THEME.colors.textSubtle, fontWeight: '700' },
})

import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View, Pressable } from 'react-native'
import { apiGet, asList, qs } from '../src/lib/api'
import { THEME } from '../src/lib/theme'
import { ScreenHeader } from '../src/components/ui'
import { EmptyView, ErrorView, LoadingView } from '../src/components/StateViews'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSessionUser } from '../src/lib/session'
import { openWeb } from '../src/lib/modules'

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useSessionUser()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    let res = await apiGet<any>(`/api/hr/attendance${qs({ pageSize: 50 })}`)
    if (!res.ok) res = await apiGet<any>(`/api/attendance${qs({ pageSize: 50 })}`)
    if (!res.ok) res = await apiGet<any>(`/api/employees/attendance${qs({ pageSize: 50 })}`)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRows(asList(res.data, 'attendance', 'punches', 'data', 'rows'))
    setError(null)
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  return (
    <View style={{ flex: 1, backgroundColor: THEME.colors.background, paddingTop: insets.top }}>
      <ScreenHeader
        title="Attendance"
        right={
          <Pressable onPress={() => openWeb(user, '/hr/attendance')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open on web">
            <Text style={{ color: THEME.colors.primary, fontWeight: '700', fontSize: 13 }}>Web</Text>
          </Pressable>
        }
      />
      {loading ? (
        <LoadingView text="Loading punches…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => { setLoading(true); load().finally(() => setLoading(false)) }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r, i) => String(r.id || i)}
          contentContainerStyle={rows.length === 0 ? { flex: 1 } : { padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)) }} />}
          ListEmptyComponent={<EmptyView icon="🕒" title="No attendance yet" subtitle="Punches from fingerprint devices appear here. Open on the web for full HR tools." />}
          renderItem={({ item }) => (
            <View style={styles.row} accessibilityRole="summary">
              <Text style={styles.name}>{item.employeeName || item.userName || item.name || 'Staff'}</Text>
              <Text style={styles.meta}>
                {item.checkIn || item.punchIn || item.timestamp
                  ? new Date(item.checkIn || item.punchIn || item.timestamp).toLocaleString()
                  : '—'}
                {item.checkOut || item.punchOut ? ` → ${new Date(item.checkOut || item.punchOut).toLocaleString()}` : ''}
              </Text>
              {item.status ? <Text style={styles.meta}>{item.status}</Text> : null}
            </View>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 12,
    marginBottom: 8,
  },
  name: { fontWeight: '800', color: THEME.colors.text },
  meta: { color: THEME.colors.textMuted, marginTop: 4, fontSize: 12 },
})

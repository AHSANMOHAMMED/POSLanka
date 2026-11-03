import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, Alert, ScrollView, StyleSheet } from 'react-native'
import { apiGet, apiPut } from '../src/lib/api'
import { THEME } from '../src/lib/theme'
import { ScreenHeader } from '../src/components/ui'
import { ErrorView, LoadingView } from '../src/components/StateViews'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function ShopSettingsScreen() {
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiGet<any>('/api/tenant')
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const t = res.data?.tenant || res.data || {}
    setName(t.name || '')
    setPhone(t.phone || '')
    setAddress(t.address || '')
    setError(null)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    const res = await apiPut('/api/tenant', { name: name.trim(), phone: phone.trim(), address: address.trim() })
    if (!res.ok) {
      // Some installs use /api/settings/business-profile
      const res2 = await apiPut('/api/settings/business-profile', { name: name.trim(), phone: phone.trim(), address: address.trim() })
      if (!res2.ok) Alert.alert('Save failed', res2.error || res.error)
      else Alert.alert('Saved')
      return
    }
    Alert.alert('Saved')
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME.colors.background, paddingTop: insets.top }}>
      <ScreenHeader title="Business settings" />
      {loading ? (
        <LoadingView text="Loading…" />
      ) : error ? (
        <ErrorView message={error} onRetry={load} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <Text style={styles.label}>Business name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Text style={styles.label}>Address</Text>
          <TextInput style={[styles.input, { minHeight: 80 }]} value={address} onChangeText={setAddress} multiline />
          <Pressable style={styles.btn} onPress={save}>
            <Text style={styles.btnText}>Save</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 10,
    padding: 12,
    color: THEME.colors.text,
  },
  btn: { backgroundColor: THEME.colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#FFF', fontWeight: '800' },
})

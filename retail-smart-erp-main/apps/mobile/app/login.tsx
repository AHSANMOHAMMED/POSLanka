import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import { apiFetch, setApiBase, setToken } from '../src/lib/api'
import { THEME } from '../src/lib/theme'

export default function LoginScreen() {
  const [apiUrl, setApiUrl] = useState('http://localhost:3000')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [busy, setBusy] = useState(false)

  async function onLogin() {
    if (!email || !password) {
      Alert.alert('Required Fields', 'Please enter your email and password.')
      return
    }

    setBusy(true)
    try {
      setApiBase(apiUrl)
      const res = await apiFetch('/api/auth/mobile-login', {
        method: 'POST',
        body: JSON.stringify({ email, password, tenantSlug }),
      })
      const data = await res.json()
      if (!res.ok) {
        Alert.alert('Login Failed', data.error || 'Invalid credentials or company slug.')
        return
      }
      await setToken(data.token)
      router.replace('/pos')
    } catch (e) {
      Alert.alert('Network Error', e instanceof Error ? e.message : 'Connection to POSLanka server failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.brandBox}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoBadgeText}>PL</Text>
        </View>
        <Text style={styles.title}>POSLanka</Text>
        <Text style={styles.sub}>Cloud ERP & Mobile POS Terminal</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Cashier Station Authentication</Text>

        <Text style={styles.label}>SERVER API ENDPOINT</Text>
        <TextInput
          style={styles.input}
          placeholder="http://localhost:3000"
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          value={apiUrl}
          onChangeText={setApiUrl}
        />

        <Text style={styles.label}>COMPANY SLUG (SUBDOMAIN)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. lanka-super"
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          value={tenantSlug}
          onChangeText={setTenantSlug}
        />

        <Text style={styles.label}>CASHIER EMAIL</Text>
        <TextInput
          style={styles.input}
          placeholder="cashier@poslanka.lk"
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>PASSCODE / PASSWORD</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor={THEME.colors.textSubtle}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Pressable
          style={[styles.button, busy && { opacity: 0.6 }]}
          onPress={onLogin}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>Sign In to Register →</Text>
          )}
        </Pressable>

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            🔒 Protected by Row-Level Security & Role-Based Access Control
          </Text>
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  content: { padding: 24, justifyContent: 'center', minHeight: '100%' },
  brandBox: { alignItems: 'center', marginBottom: 28 },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  logoBadgeText: { color: '#FFF', fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: '900', color: THEME.colors.primary, letterSpacing: -0.5 },
  sub: { marginTop: 4, color: THEME.colors.textMuted, fontSize: 13, fontWeight: '500' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    paddingBottom: 10,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: THEME.colors.text,
    marginBottom: 14,
  },
  button: {
    backgroundColor: THEME.colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  footerNote: { marginTop: 16, alignItems: 'center' },
  footerNoteText: { fontSize: 11, color: THEME.colors.textSubtle, textAlign: 'center' },
})

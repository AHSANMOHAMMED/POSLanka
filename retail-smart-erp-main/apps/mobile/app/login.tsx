import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native'
import { router } from 'expo-router'
import {
  api,
  DEFAULT_API_URL,
  loadSavedSettings,
  saveSettings,
  setToken,
  setUser,
  type AuthUser,
} from '../src/lib/api'
import { syncNow } from '../src/lib/offlineQueue'
import { uploadAllPending } from '../src/lib/intakeStore'
import { fetchCurrentShift } from '../src/lib/shift'
import { THEME } from '../src/lib/theme'
import { adminLogin, setAdminSession } from '../src/lib/adminApi'
import { registerPushToken } from '../src/lib/notifications'

interface LoginResponse {
  token: string
  user: AuthUser
}

export default function LoginScreen() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // Platform admin (super-admin console) mode: separate endpoint, separate token.
  const [adminMode, setAdminMode] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)

  // Company slug + server URL are remembered on the device.
  useEffect(() => {
    loadSavedSettings()
      .then((s) => {
        setApiUrl(s.apiUrl || DEFAULT_API_URL)
        setTenantSlug(s.tenantSlug || '')
      })
      .finally(() => setSettingsLoaded(true))
  }, [])

  async function onAdminLogin(url: string) {
    if (!email.trim() || !password) {
      Alert.alert('Required Fields', 'Please enter your admin email and password.')
      return
    }
    if (needsTotp && !/^\d{6}$/.test(totpCode.trim())) {
      Alert.alert('Authenticator Code', 'Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    try {
      await saveSettings({ apiUrl: url, tenantSlug: tenantSlug.trim().toLowerCase() })
      const res = await adminLogin(email.trim(), password, needsTotp ? totpCode.trim() : undefined)
      if (res.requires2fa) {
        setNeedsTotp(true)
        setTotpCode('')
        return
      }
      if (!res.ok) {
        Alert.alert(
          res.status === 0 ? 'Network Error' : 'Admin Login Failed',
          res.status === 401 ? (needsTotp ? 'Invalid credentials or authenticator code.' : 'Invalid admin credentials.') : res.error
        )
        if (res.status === 401 && needsTotp) setTotpCode('')
        return
      }
      const admin = res.data.admin || { name: 'Platform admin', email: email.trim() }
      await setAdminSession(res.data.token, { name: admin.name || 'Platform admin', email: admin.email || email.trim() })
      setPassword('')
      setTotpCode('')
      setNeedsTotp(false)
      router.replace('/admin/pulse')
    } finally {
      setBusy(false)
    }
  }

  async function onLogin() {
    const slug = tenantSlug.trim().toLowerCase()
    const url = apiUrl.trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      Alert.alert('Server URL', 'Enter the server address including http:// or https://.')
      return
    }
    if (adminMode) {
      await onAdminLogin(url)
      return
    }
    if (!slug) {
      Alert.alert('Company Slug', 'Enter your company slug (subdomain).')
      return
    }
    if (!email.trim() || !password) {
      Alert.alert('Required Fields', 'Please enter your email and password.')
      return
    }

    setBusy(true)
    try {
      await saveSettings({ apiUrl: url, tenantSlug: slug })

      const res = await api<LoginResponse>(
        '/api/auth/mobile-login',
        {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), password, tenantSlug: slug }),
        },
        { skipUnauthorizedHandler: true }
      )

      if (!res.ok) {
        Alert.alert(
          res.status === 0 ? 'Network Error' : 'Login Failed',
          res.status === 401 ? 'Invalid credentials or company slug.' : res.error
        )
        return
      }

      await setToken(res.data.token)
      await setUser(res.data.user)
      setPassword('')

      // Push registration (permission prompt + POST /api/account/devices); never blocks login.
      registerPushToken().catch(() => undefined)
      // Work saved while the previous session expired (offline sales stopped on 401, intake scans)
      // is replayed right away instead of waiting for the next connectivity change.
      syncNow().catch(() => undefined)
      uploadAllPending().catch(() => undefined)

      // Route by shift state: open shift -> POS, otherwise -> open a shift first.
      const shiftRes = await fetchCurrentShift()
      if (shiftRes.ok && shiftRes.data.hasOpenShift) {
        router.replace('/pos')
      } else {
        router.replace('/shifts')
      }
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
        <Text style={styles.cardHeader}>{adminMode ? 'Platform Admin Console' : 'Cashier Station Authentication'}</Text>

        <View style={styles.modeRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.modeTitle}>Platform admin</Text>
            <Text style={styles.modeSub}>Super-admin companion: pulse, live feed, vendors, approvals</Text>
          </View>
          <Switch
            value={adminMode}
            onValueChange={(v) => {
              setAdminMode(v)
              setNeedsTotp(false)
              setTotpCode('')
            }}
            trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
          />
        </View>

        <Text style={styles.label}>SERVER API ENDPOINT</Text>
        <TextInput
          style={styles.input}
          placeholder={DEFAULT_API_URL}
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={apiUrl}
          onChangeText={setApiUrl}
        />

        {!adminMode && (
          <>
            <Text style={styles.label}>COMPANY SLUG (SUBDOMAIN)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. lanka-super"
              placeholderTextColor={THEME.colors.textSubtle}
              autoCapitalize="none"
              value={tenantSlug}
              onChangeText={setTenantSlug}
            />
          </>
        )}

        <Text style={styles.label}>{adminMode ? 'ADMIN EMAIL' : 'CASHIER EMAIL'}</Text>
        <TextInput
          style={styles.input}
          placeholder={adminMode ? 'admin@poslanka.lk' : 'cashier@poslanka.lk'}
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

        {adminMode && needsTotp && (
          <>
            <Text style={styles.label}>AUTHENTICATOR CODE (6 DIGITS)</Text>
            <TextInput
              style={[styles.input, styles.totpInput]}
              placeholder="123456"
              placeholderTextColor={THEME.colors.textSubtle}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              value={totpCode}
              onChangeText={(v) => setTotpCode(v.replace(/[^0-9]/g, ''))}
              onSubmitEditing={onLogin}
            />
          </>
        )}

        <Pressable
          style={[styles.button, busy && { opacity: 0.6 }]}
          onPress={onLogin}
          disabled={busy || !settingsLoaded}
        >
          {busy || !settingsLoaded ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>{adminMode ? (needsTotp ? 'Verify Code & Open Console →' : 'Sign In to Admin Console →') : 'Sign In to Register →'}</Text>
          )}
        </Pressable>

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Server address and company slug are remembered on this device.
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
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  modeTitle: { fontSize: 13, fontWeight: '800', color: THEME.colors.text },
  modeSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 1 },
  totpInput: { fontFamily: 'monospace', fontSize: 22, letterSpacing: 6, textAlign: 'center' },
  footerNote: { marginTop: 16, alignItems: 'center' },
  footerNoteText: { fontSize: 11, color: THEME.colors.textSubtle, textAlign: 'center' },
})

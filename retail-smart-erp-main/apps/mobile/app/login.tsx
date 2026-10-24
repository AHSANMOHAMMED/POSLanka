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
  Image,
} from 'react-native'
import { router } from 'expo-router'
import {
  api,
  DEFAULT_API_URL,
  loadSavedSettings,
  saveSettings,
  setToken,
  setUser,
  normalizeBusinessId,
  formatBusinessId,
  type AuthUser,
} from '../src/lib/api'
import { hasPermission } from '../src/lib/roles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { syncNow } from '../src/lib/offlineQueue'
import { uploadAllPending } from '../src/lib/intakeStore'
import { fetchCurrentShift } from '../src/lib/shift'
import { THEME } from '../src/lib/theme'
import { adminLogin, setAdminSession, type AdminUser } from '../src/lib/adminApi'
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
  const [businessId, setBusinessId] = useState('')
  // Older installs signed in with the company slug; keep that path available.
  const [useSlug, setUseSlug] = useState(false)
  const insets = useSafeAreaInsets()
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
        setBusinessId(formatBusinessId(s.businessId || ''))
        // Remembered slug but no Business ID yet (install from before Business IDs): keep slug mode.
        if (!s.businessId && s.tenantSlug) setUseSlug(true)
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
      await setAdminSession(res.data.token, {
        name: admin.name || 'Platform admin',
        email: admin.email || email.trim(),
        role: (admin as { role?: AdminUser['role'] }).role,
        permissions: Array.isArray(res.data.permissions) ? res.data.permissions : undefined,
      })
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
    const bid = normalizeBusinessId(businessId)
    if (useSlug && !slug) {
      Alert.alert('Company Slug', 'Enter your company slug (subdomain).')
      return
    }
    if (!useSlug && !bid) {
      Alert.alert('Business ID', 'Enter your Business ID — it looks like PL-123456. Ask your manager or owner, it is shown on the Staff page.')
      return
    }
    if (!email.trim() || !password) {
      Alert.alert('Required Fields', 'Please enter your email and password.')
      return
    }

    setBusy(true)
    try {
      await saveSettings({ apiUrl: url, tenantSlug: slug, ...(useSlug ? {} : { businessId: bid || '' }) })

      const res = await api<LoginResponse>(
        '/api/auth/mobile-login',
        {
          method: 'POST',
          body: JSON.stringify(
            useSlug
              ? { email: email.trim(), password, tenantSlug: slug }
              : { email: email.trim(), password, businessId: bid }
          ),
        },
        { skipUnauthorizedHandler: true }
      )

      if (!res.ok) {
        Alert.alert(
          res.status === 0 ? 'Network Error' : 'Login Failed',
          res.status === 401 ? `Invalid credentials or ${useSlug ? 'company slug' : 'Business ID'}.` : res.error
        )
        return
      }

      await setToken(res.data.token)
      await setUser(res.data.user)
      setPassword('')
      // Remember what the server resolved so next time the Business ID is pre-filled.
      if (res.data.user?.businessId || res.data.user?.tenantSlug) {
        await saveSettings({
          apiUrl: url,
          tenantSlug: res.data.user.tenantSlug || slug,
          ...(res.data.user.businessId ? { businessId: res.data.user.businessId } : {}),
        })
        if (res.data.user.businessId) setBusinessId(formatBusinessId(res.data.user.businessId))
      }

      // Push registration (permission prompt + POST /api/account/devices); never blocks login.
      registerPushToken().catch(() => undefined)
      // Work saved while the previous session expired (offline sales stopped on 401, intake scans)
      // is replayed right away instead of waiting for the next connectivity change.
      syncNow().catch(() => undefined)
      uploadAllPending().catch(() => undefined)

      // Roles that cannot sell (stock, purchasing, reports, HR...) land on the hub.
      if (!hasPermission(res.data.user, 'createSales')) {
        router.replace('/home')
        return
      }
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.brandBox}>
        <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="skyERPOS" />
        <Text style={styles.sub}>All-in-one POS & ERP</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>{adminMode ? 'Platform Admin Console' : 'Staff Sign In'}</Text>

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

        {!adminMode && !useSlug && (
          <>
            <Text style={styles.label}>BUSINESS ID</Text>
            <TextInput
              style={[styles.input, styles.businessIdInput]}
              placeholder="PL-123456"
              placeholderTextColor={THEME.colors.textSubtle}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              value={businessId}
              onChangeText={(v) => setBusinessId(v.toUpperCase())}
              onBlur={() => {
                const n = normalizeBusinessId(businessId)
                if (n) setBusinessId(formatBusinessId(n))
              }}
            />
            <Text style={styles.hint}>Your company&apos;s Business ID — shown to the owner on the Staff page.</Text>
          </>
        )}
        {!adminMode && useSlug && (
          <>
            <Text style={styles.label}>COMPANY SLUG (SUBDOMAIN)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. lanka-super"
              placeholderTextColor={THEME.colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              value={tenantSlug}
              onChangeText={setTenantSlug}
            />
          </>
        )}
        {!adminMode && (
          <Pressable onPress={() => setUseSlug((v) => !v)} style={styles.linkBtn} hitSlop={8}>
            <Text style={styles.linkText}>
              {useSlug ? 'Use Business ID instead' : 'Use company slug instead (older setups)'}
            </Text>
          </Pressable>
        )}

        <Text style={styles.label}>{adminMode ? 'ADMIN EMAIL' : 'STAFF EMAIL'}</Text>
        <TextInput
          style={styles.input}
          placeholder={adminMode ? 'admin@poslanka.lk' : 'you@company.lk'}
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
            <Text style={styles.buttonText}>{adminMode ? (needsTotp ? 'Verify Code & Open Console →' : 'Sign In to Admin Console →') : 'Sign In →'}</Text>
          )}
        </Pressable>

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Server address and Business ID are remembered on this device.
          </Text>
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  content: { padding: 24, justifyContent: 'center', minHeight: '100%', width: '100%', maxWidth: 520, alignSelf: 'center' },
  businessIdInput: { fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, marginBottom: 4 },
  hint: { fontSize: 11, color: THEME.colors.textSubtle, marginBottom: 10 },
  linkBtn: { alignSelf: 'flex-start', marginBottom: 14 },
  linkText: { fontSize: 12, fontWeight: '700', color: THEME.colors.primary },
  brandBox: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 230, height: 105, marginBottom: 4 },
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

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
import { IS_ADMIN_APP } from '../src/lib/appVariant'

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
  // This build's sign-in: platform admins (skyERPOS Admin app) or shop staff (skyERPOS app)
  const adminMode = IS_ADMIN_APP
  const [showPassword, setShowPassword] = useState(false)
  const [showServer, setShowServer] = useState(false)
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

  const title = IS_ADMIN_APP ? (needsTotp ? 'Two-step verification' : 'Admin sign in') : 'Staff sign in'
  const subtitle = IS_ADMIN_APP
    ? needsTotp ? 'Enter the 6-digit code from your authenticator app.' : 'Platform console for skyERPOS administrators.'
    : 'Sign in with your company’s Business ID.'

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 + insets.bottom }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Brand header in the logo blue */}
      <View style={[styles.hero, { paddingTop: 36 + insets.top }]}>
        <View style={styles.logoCard}>
          <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="skyERPOS" />
        </View>
        <Text style={styles.heroTitle}>{IS_ADMIN_APP ? 'Admin Console' : 'Point of Sale'}</Text>
        <Text style={styles.heroSub}>{IS_ADMIN_APP ? 'Vendors, sales and approvals across the platform' : 'Powerful. Reliable. Complete POS solution.'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{subtitle}</Text>

        {!IS_ADMIN_APP && !useSlug && (
          <>
            <Text style={styles.label}>Business ID</Text>
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
            <Text style={styles.hint}>Ask your manager or owner — it’s on the Staff page.</Text>
          </>
        )}
        {!IS_ADMIN_APP && useSlug && (
          <>
            <Text style={styles.label}>Company web address</Text>
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

        {!(IS_ADMIN_APP && needsTotp) && (
          <>
            <Text style={styles.label}>{IS_ADMIN_APP ? 'Admin email' : 'Email or username'}</Text>
            <TextInput
              style={styles.input}
              placeholder={IS_ADMIN_APP ? 'admin@company.lk' : 'you@company.lk'}
              placeholderTextColor={THEME.colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0, paddingRight: 64 }]}
                placeholder="Password"
                placeholderTextColor={THEME.colors.textSubtle}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={onLogin}
                returnKeyType="go"
              />
              <Pressable style={styles.showBtn} onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <Text style={styles.showBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
          </>
        )}

        {IS_ADMIN_APP && needsTotp && (
          <>
            <Text style={styles.label}>Authenticator code</Text>
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
            <Pressable onPress={() => { setNeedsTotp(false); setTotpCode('') }} style={styles.linkBtn} hitSlop={8}>
              <Text style={styles.linkText}>‹ Back to email and password</Text>
            </Pressable>
          </>
        )}

        <Pressable
          style={[styles.button, (busy || !settingsLoaded) && { opacity: 0.6 }]}
          onPress={onLogin}
          disabled={busy || !settingsLoaded}
          accessibilityRole="button"
        >
          {busy || !settingsLoaded ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>{IS_ADMIN_APP ? (needsTotp ? 'Verify and continue' : 'Sign in to console') : 'Sign in'}</Text>
          )}
        </Pressable>

        {/* Server address (and the old company-slug sign-in) — set once, rarely changed */}
        <Pressable onPress={() => setShowServer((v) => !v)} style={styles.settingsToggle} hitSlop={8}>
          <Text style={styles.settingsToggleText}>{showServer ? '▾' : '▸'} Server settings</Text>
          {!showServer && <Text style={styles.settingsValue} numberOfLines={1}>{apiUrl.replace(/^https?:\/\//, '')}</Text>}
        </Pressable>
        {showServer && (
          <View style={styles.settingsBox}>
            <Text style={styles.label}>Server address</Text>
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
            {!IS_ADMIN_APP && (
              <Pressable onPress={() => setUseSlug((v) => !v)} style={styles.linkBtn} hitSlop={8}>
                <Text style={styles.linkText}>{useSlug ? 'Sign in with Business ID' : 'Sign in with company web address (older setups)'}</Text>
              </Pressable>
            )}
            <Text style={styles.hint}>Remembered on this device.</Text>
          </View>
        )}
      </View>

      <Text style={styles.footer}>© {new Date().getFullYear()} skyERPOS</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  hero: {
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 64,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  logoCard: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10, marginBottom: 14, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  logo: { width: 190, height: 87 },
  heroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4, textAlign: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    marginHorizontal: 20,
    marginTop: -40,
    width: '90%',
    maxWidth: 480,
    alignSelf: 'center',
    borderTopWidth: 4,
    borderTopColor: THEME.colors.secondaryAmber,
    shadowColor: '#0B2A66',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.text },
  cardSub: { fontSize: 13, color: THEME.colors.textMuted, marginTop: 4, marginBottom: 18 },
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: THEME.colors.text,
    marginBottom: 14,
  },
  businessIdInput: { fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, marginBottom: 4 },
  totpInput: { fontFamily: 'monospace', fontSize: 22, letterSpacing: 6, textAlign: 'center' },
  hint: { fontSize: 11.5, color: THEME.colors.textMuted, marginBottom: 14 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  showBtn: { position: 'absolute', right: 12, paddingVertical: 6, paddingHorizontal: 6 },
  showBtnText: { color: THEME.colors.primary, fontWeight: '700', fontSize: 13 },
  linkBtn: { alignSelf: 'flex-start', marginBottom: 12 },
  linkText: { fontSize: 12.5, fontWeight: '700', color: THEME.colors.primary },
  button: {
    backgroundColor: THEME.colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  settingsToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  settingsToggleText: { fontSize: 12.5, fontWeight: '700', color: THEME.colors.textMuted },
  settingsValue: { flex: 1, fontSize: 12, color: THEME.colors.textSubtle, textAlign: 'right' },
  settingsBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: THEME.colors.border },
  footer: { textAlign: 'center', color: THEME.colors.textSubtle, fontSize: 11.5, marginTop: 24 },
})

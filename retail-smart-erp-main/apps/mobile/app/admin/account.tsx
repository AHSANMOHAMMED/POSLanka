// My admin account: profile, change password (POST users/me/password) and two-factor
// authentication setup / disable (auth/2fa). Everyone with an admin session may use this.
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, Image, Linking, Alert } from 'react-native'
import { adminGet, adminLogout, adminPost, ADMIN_ROLE_LABEL, useAdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Card, ListRow, Pill, SectionTitle, adminStyles } from '../../src/components/admin/AdminShell'
import { Btn, Field, MoreShell, Notice } from '../../src/components/admin/AdminForm'
import { alertIfFailed, confirmAction } from '../../src/lib/adminForms'

interface TwoFactor { enabled: boolean; required: boolean; email?: string }
interface Setup { secret: string; otpauthUrl: string; qrDataUrl?: string }

export default function AdminAccountScreen() {
  const { admin } = useAdminUser()
  const [tf, setTf] = useState<TwoFactor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTf = useCallback(async () => {
    setError(null)
    const res = await adminGet<TwoFactor>('/api/sys-control/auth/2fa')
    if (res.ok) setTf(res.data)
    else setError(res.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadTf()
  }, [loadTf])

  // Change password
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  async function changePassword() {
    if (!current) return setPwError('Enter your current password.')
    if (next.length < 10) return setPwError('Use at least 10 characters.')
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return setPwError('Use at least one letter and one number.')
    if (next !== confirm) return setPwError('The new passwords do not match.')
    if (next === current) return setPwError('Choose a password different from the current one.')
    setPwError(null)
    setPwBusy(true)
    const res = await adminPost('/api/sys-control/users/me/password', { currentPassword: current, newPassword: next })
    setPwBusy(false)
    if (!alertIfFailed(res, 'Password not changed')) return
    setCurrent('')
    setNext('')
    setConfirm('')
    Alert.alert('Password changed', 'Your other sessions were signed out.')
  }

  // Two-factor
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [tfBusy, setTfBusy] = useState<string | null>(null)
  const [tfError, setTfError] = useState<string | null>(null)

  async function startSetup() {
    setTfError(null)
    setTfBusy('setup')
    const res = await adminPost<Setup>('/api/sys-control/auth/2fa', { action: 'setup' })
    setTfBusy(null)
    if (!alertIfFailed(res, '2FA setup failed')) return
    setSetup(res.data)
    setCode('')
  }

  async function confirmCode(action: 'enable' | 'disable') {
    if (!/^\d{6}$/.test(code.trim())) return setTfError('Enter the 6-digit code from your authenticator app.')
    setTfError(null)
    setTfBusy(action)
    const res = await adminPost<{ enabled: boolean }>('/api/sys-control/auth/2fa', { action, code: code.trim() })
    setTfBusy(null)
    if (!res.ok) return setTfError(res.error)
    setSetup(null)
    setCode('')
    Alert.alert(action === 'enable' ? 'Two-factor enabled' : 'Two-factor disabled')
    loadTf()
  }

  function openAuthenticator() {
    if (!setup?.otpauthUrl) return
    Linking.openURL(setup.otpauthUrl).catch(() => Alert.alert('No authenticator app found', 'Type the key into your authenticator app instead.'))
  }

  return (
    <MoreShell title="My account" subtitle={admin?.email}>
      {loading ? (
        <LoadingView />
      ) : (
        <ScrollView style={adminStyles.scroll} contentContainerStyle={adminStyles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <ListRow title={admin?.name || 'Platform admin'} subtitle={admin?.email} right={admin?.role ? <Pill text={ADMIN_ROLE_LABEL[admin.role] ?? admin.role} tone="primary" /> : undefined} />
          </Card>

          <SectionTitle>Change password</SectionTitle>
          <Card style={{ padding: 14 }}>
            <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry />
            <Field label="New password" value={next} onChangeText={setNext} secureTextEntry hint="At least 10 characters with a letter and a number." />
            <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry />
            {pwError ? <Notice tone="error" text={pwError} /> : null}
            <Btn label="Change password" style={{ marginTop: 10 }} busy={pwBusy} onPress={changePassword} />
          </Card>

          <SectionTitle>Two-factor authentication</SectionTitle>
          {error ? (
            <ErrorView message={error} onRetry={loadTf} />
          ) : (
            <Card style={{ padding: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pill text={tf?.enabled ? '2FA on' : '2FA off'} tone={tf?.enabled ? 'ok' : 'warn'} />
                {tf?.required ? <Pill text="required for your account" tone="primary" /> : null}
              </View>

              {!tf?.enabled && !setup ? (
                <>
                  <Text style={adminStyles.muted}>Add a second step to your sign-in with an authenticator app (Google Authenticator, Authy, Microsoft Authenticator…).</Text>
                  <Btn label="Set up two-factor" busy={tfBusy === 'setup'} onPress={startSetup} />
                </>
              ) : null}

              {setup ? (
                <>
                  <Text style={adminStyles.muted}>1. Scan the QR code or enter the key in your authenticator app.</Text>
                  {setup.qrDataUrl ? <Image source={{ uri: setup.qrDataUrl }} style={{ width: 200, height: 200, alignSelf: 'center' }} accessibilityLabel="Two-factor QR code" /> : null}
                  <Text selectable style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: '800', color: THEME.colors.text, textAlign: 'center' }}>{setup.secret}</Text>
                  <Btn label="Open in authenticator app" tone="ghost" onPress={openAuthenticator} />
                  <Text style={adminStyles.muted}>2. Enter the 6-digit code it shows.</Text>
                  <Field label="Code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
                  {tfError ? <Notice tone="error" text={tfError} /> : null}
                  <Btn label="Turn on two-factor" busy={tfBusy === 'enable'} onPress={() => confirmCode('enable')} />
                  <Btn label="Cancel" tone="ghost" onPress={() => { setSetup(null); setTfError(null) }} />
                </>
              ) : null}

              {tf?.enabled && !setup ? (
                tf.required ? (
                  <Notice text="Two-factor is required for your account. Another Owner must waive the requirement before you can turn it off." />
                ) : (
                  <>
                    <Field label="Code to turn it off" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
                    {tfError ? <Notice tone="error" text={tfError} /> : null}
                    <Btn label="Turn off two-factor" tone="danger" busy={tfBusy === 'disable'} onPress={() => confirmAction('Turn off 2FA?', 'Your sign-in will only need your password.', 'Turn off', () => confirmCode('disable'), true)} />
                  </>
                )
              ) : null}
            </Card>
          )}

          <Btn label="Sign out" tone="danger" onPress={() => confirmAction('Sign out', 'Sign out of the platform console?', 'Sign out', () => adminLogout(), true)} />
        </ScrollView>
      )}
    </MoreShell>
  )
}

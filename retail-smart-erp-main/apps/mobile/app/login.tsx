import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native'
import { router } from 'expo-router'
import { apiFetch, setApiBase, setToken } from '../src/lib/api'

export default function LoginScreen() {
  const [apiUrl, setApiUrl] = useState('http://localhost:3000')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [busy, setBusy] = useState(false)

  async function onLogin() {
    setBusy(true)
    try {
      setApiBase(apiUrl)
      const res = await apiFetch('/api/auth/mobile-login', {
        method: 'POST',
        body: JSON.stringify({ email, password, tenantSlug }),
      })
      const data = await res.json()
      if (!res.ok) {
        Alert.alert('Login failed', data.error || 'Invalid credentials')
        return
      }
      await setToken(data.token)
      router.replace('/pos')
    } catch (e) {
      Alert.alert('Network error', e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>POSLanka</Text>
      <Text style={styles.sub}>Cashier login</Text>
      <TextInput
        style={styles.input}
        placeholder="API URL"
        autoCapitalize="none"
        value={apiUrl}
        onChangeText={setApiUrl}
      />
      <TextInput
        style={styles.input}
        placeholder="Company slug"
        autoCapitalize="none"
        value={tenantSlug}
        onChangeText={setTenantSlug}
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={styles.button} onPress={onLogin} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#f8fafc' },
  title: { fontSize: 28, fontWeight: '700', color: '#0f766e' },
  sub: { marginBottom: 24, color: '#64748b' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#0f766e',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
})

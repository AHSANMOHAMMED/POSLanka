// Super admin → one vendor's staff: list, add (only name + role required), new password, deactivate / activate.
// Server: POST / PATCH /api/sys-control/vendors/[id]/staff (vendors.manage).
import React, { useState } from 'react'
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator, Share, StyleSheet, ScrollView } from 'react-native'
import { adminApi, adminPost } from '../../lib/adminApi'
import { THEME } from '../../lib/theme'
import { Card, ListRow, Pill, SectionTitle, adminStyles, timeAgo } from './AdminShell'
import { displayLogin } from '../../lib/displayLogin'

export interface AdminStaffRow {
  id: string
  fullName: string
  email: string
  role: string
  isActive: boolean
  lastLoginAt: string | null
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', manager: 'Manager (admin)', cashier: 'Cashier', technician: 'Technician', chef: 'Chef', waiter: 'Waiter',
  system_manager: 'System manager', accounts_manager: 'Accounts manager', sales_manager: 'Sales manager',
  purchase_manager: 'Purchase manager', hr_manager: 'HR manager', stock_manager: 'Stock manager',
  pos_user: 'POS user', report_user: 'Report user', dealer_sales: 'Dealer sales',
}

function showLogin(title: string, name: string, login: string, password: string | null) {
  const text = `Login: ${login}${password ? `\nPassword: ${password}` : ''}`
  Alert.alert(title, `${name} signs in with the Business ID and\n\n${text}${password ? '\n\nThe password is shown only once.' : ''}`, [
    { text: 'Share', onPress: () => { Share.share({ message: `${name}\n${text}` }).catch(() => undefined) } },
    { text: 'Done', style: 'cancel' },
  ])
}

export function AdminVendorStaff({ vendorId, staff, roles, canManage, onChanged }: {
  vendorId: string
  staff: AdminStaffRow[]
  roles: string[]
  canManage: boolean
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState(roles.includes('cashier') ? 'cashier' : roles[0] || 'cashier')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')

  function resetForm() {
    setFullName(''); setEmail(''); setPassword(''); setPin('')
  }

  async function create() {
    if (fullName.trim().length < 2) return Alert.alert('Missing name', 'Enter the staff member’s name.')
    setSaving(true)
    const res = await adminPost<{ user: AdminStaffRow; generatedPassword: string | null }>(`/api/sys-control/vendors/${vendorId}/staff`, {
      fullName: fullName.trim(), role, email: email.trim() || undefined, password: password || undefined, pin: pin || undefined,
    })
    setSaving(false)
    if (!res.ok) return Alert.alert('Could not add staff', res.error)
    setAdding(false)
    resetForm()
    showLogin('Staff added', res.data.user.fullName, displayLogin(res.data.user.email), res.data.generatedPassword)
    onChanged()
  }

  async function act(u: AdminStaffRow, action: 'deactivate' | 'activate' | 'reset_password') {
    setBusyId(u.id)
    const res = await adminApi<{ email: string; temporaryPassword: string | null }>(`/api/sys-control/vendors/${vendorId}/staff`, {
      method: 'PATCH',
      body: JSON.stringify({ userId: u.id, action }),
    })
    setBusyId(null)
    if (!res.ok) return Alert.alert('Update failed', res.error)
    if (res.data.temporaryPassword) showLogin('New password', u.fullName, displayLogin(res.data.email), res.data.temporaryPassword)
    onChanged()
  }

  function openRow(u: AdminStaffRow) {
    if (!canManage || u.role === 'owner') return
    Alert.alert(u.fullName, `${ROLE_LABEL[u.role] ?? u.role} · ${displayLogin(u.email)}`, [
      { text: 'New password', onPress: () => act(u, 'reset_password') },
      u.isActive
        ? { text: 'Deactivate', style: 'destructive', onPress: () => act(u, 'deactivate') }
        : { text: 'Activate', onPress: () => act(u, 'activate') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  return (
    <>
      <View style={styles.titleRow}>
        <SectionTitle>Staff ({staff.length})</SectionTitle>
        {canManage && !adding ? (
          <Pressable style={styles.addBtn} onPress={() => setAdding(true)} accessibilityRole="button">
            <Text style={styles.addBtnText}>+ Add staff</Text>
          </Pressable>
        ) : null}
      </View>

      {adding ? (
        <Card style={{ padding: 14, gap: 8 }}>
          <Text style={styles.label}>Name *</Text>
          <TextInput style={adminStyles.input} value={fullName} onChangeText={setFullName} placeholder="e.g. Nimal Perera" />
          <Text style={styles.label}>Role *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {roles.map((r) => (
              <Pressable key={r} onPress={() => setRole(r)} style={[styles.chip, role === r && styles.chipActive]}>
                <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{ROLE_LABEL[r] ?? r}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.label}>Username or email (optional)</Text>
          <TextInput style={adminStyles.input} value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="e.g. cashier1 — blank = made from the name" />
          <Text style={styles.label}>Password (optional)</Text>
          <TextInput style={adminStyles.input} value={password} onChangeText={setPassword} autoCapitalize="none" secureTextEntry placeholder="Blank = generated and shown once" />
          <Text style={styles.label}>POS PIN (optional, 4–6 digits)</Text>
          <TextInput style={adminStyles.input} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <Pressable style={[adminStyles.ghostBtn, { flex: 1 }]} onPress={() => { setAdding(false); resetForm() }} disabled={saving}>
              <Text style={adminStyles.ghostBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={[adminStyles.primaryBtn, { flex: 1 }, saving && { opacity: 0.6 }]} onPress={create} disabled={saving}>
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={adminStyles.primaryBtnText}>Add staff</Text>}
            </Pressable>
          </View>
        </Card>
      ) : null}

      <Card>
        {staff.length === 0 ? <Text style={adminStyles.empty}>No staff yet</Text> : staff.map((u) => (
          <ListRow
            key={u.id}
            title={u.fullName}
            subtitle={`${ROLE_LABEL[u.role] ?? u.role} • ${displayLogin(u.email)}${u.lastLoginAt ? ` • ${timeAgo(u.lastLoginAt)}` : ' • never signed in'}`}
            right={busyId === u.id ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : <Pill text={u.isActive ? 'active' : 'off'} tone={u.isActive ? 'ok' : 'muted'} />}
            onPress={canManage && u.role !== 'owner' ? () => openRow(u) : undefined}
          />
        ))}
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: THEME.colors.primary },
  addBtnText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.text, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  chipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  chipTextActive: { color: '#FFF' },
})

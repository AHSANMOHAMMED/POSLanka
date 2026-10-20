import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { router } from 'expo-router'
import { api, apiGet, apiPost, asList, getUser, type AuthUser } from '../src/lib/api'
import { hasPermission, roleLabel, canModifyUser, assignableRoles } from '../src/lib/roles'
import { THEME } from '../src/lib/theme'
import { LoadingView, EmptyView, ErrorView, InlineNotice } from '../src/components/StateViews'

interface StaffRow {
  id: string
  email: string
  fullName: string
  role: string
  isActive: boolean
  updatedAt?: string
  lastLoginAt?: string | null
  warehouses?: Array<{ warehouseId: string; warehouse: { name: string } }>
  posProfiles?: Array<{ posProfileId: string; name: string; warehouseId: string | null; isDefault: boolean }>
}

interface Branch {
  id: string
  name: string
}

interface Counter {
  id: string
  name: string
  warehouseId: string | null
  status?: string
}

type ResetKind = 'pin' | 'password'

const PASSWORD_RULE = 'Min 8 characters with upper-case, lower-case and a number'

function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters'
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter'
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter'
  if (!/[0-9]/.test(pw)) return 'Password must contain a number'
  return null
}

const emptyForm = {
  fullName: '',
  email: '',
  role: 'cashier',
  password: '',
  confirm: '',
  pin: '',
}

export default function StaffScreen() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [counters, setCounters] = useState<Counter[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Create form
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formBranches, setFormBranches] = useState<string[]>([])
  const [formCounters, setFormCounters] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Reset PIN / password
  const [resetTarget, setResetTarget] = useState<StaffRow | null>(null)
  const [resetKind, setResetKind] = useState<ResetKind>('pin')
  const [resetValue, setResetValue] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')

  const canManage = hasPermission(user ?? null, 'manageUsers')
  const actorRole = user?.role || ''
  const roles = useMemo(() => assignableRoles(actorRole, user?.businessType), [actorRole, user?.businessType])

  useEffect(() => {
    getUser().then((u) => setUser(u))
  }, [])

  const load = useCallback(
    async (silent = false) => {
      if (user === undefined) return
      if (!canManage) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      setNotice(null)
      const [usersRes, whRes, ppRes] = await Promise.all([
        apiGet<StaffRow[]>('/api/users?includeWarehouses=true'),
        apiGet<any>('/api/warehouses?all=true&activeOnly=true'),
        apiGet<any>('/api/pos-profiles?all=true'),
      ])
      if (!usersRes.ok) {
        setError(usersRes.error)
      } else {
        setStaff(asList<StaffRow>(usersRes.data))
      }
      if (whRes.ok) setBranches(asList<Branch>(whRes.data))
      if (ppRes.ok) setCounters(asList<Counter>(ppRes.data, 'profiles').filter((c) => !c.status || c.status === 'active'))
      if (usersRes.ok && (!whRes.ok || !ppRes.ok)) setNotice('Branches or counters could not be loaded.')
      setLoading(false)
      setRefreshing(false)
    },
    [user, canManage]
  )

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => (showInactive ? staff : staff.filter((s) => s.isActive)), [staff, showInactive])

  const visibleCounters = useMemo(
    () => (formBranches.length === 0 ? counters : counters.filter((c) => !c.warehouseId || formBranches.includes(c.warehouseId))),
    [counters, formBranches]
  )

  function openCreate() {
    setForm({ ...emptyForm, role: roles.includes('cashier') ? 'cashier' : roles[0] || 'cashier' })
    setFormBranches(branches.length === 1 ? [branches[0].id] : [])
    setFormCounters([])
    setCreateOpen(true)
  }

  function toggleBranch(id: string) {
    const next = formBranches.includes(id) ? formBranches.filter((b) => b !== id) : [...formBranches, id]
    setFormBranches(next)
    if (next.length > 0) {
      setFormCounters((prev) =>
        prev.filter((cid) => {
          const c = counters.find((o) => o.id === cid)
          return !c || !c.warehouseId || next.includes(c.warehouseId)
        })
      )
    }
  }

  function toggleCounter(id: string) {
    setFormCounters((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  async function submitCreate() {
    if (!form.fullName.trim()) return Alert.alert('Missing name', 'Enter the staff member’s full name.')
    if (!form.email.trim()) return Alert.alert('Missing email', 'Enter an email address used to sign in.')
    const pwProblem = passwordProblem(form.password)
    if (pwProblem) return Alert.alert('Weak password', pwProblem)
    if (form.password !== form.confirm) return Alert.alert('Passwords differ', 'The two passwords do not match.')
    if (form.pin && !/^\d{4,6}$/.test(form.pin)) return Alert.alert('Invalid PIN', 'PIN must be 4-6 digits.')

    setSaving(true)
    const res = await apiPost<{ mode: string; user: StaffRow }>('/api/users', {
      mode: 'create',
      email: form.email.trim(),
      fullName: form.fullName.trim(),
      role: form.role,
      password: form.password,
      pin: form.pin || undefined,
      warehouseIds: formBranches,
      posProfileIds: formCounters,
    })
    setSaving(false)
    if (!res.ok) {
      Alert.alert('Could not create staff', res.error)
      return
    }
    setCreateOpen(false)
    Alert.alert('Staff created', `${res.data.user?.fullName || 'The staff member'} can now sign in with ${form.email.trim()}.`)
    load(true)
  }

  async function updateUser(target: StaffRow, body: Record<string, unknown>) {
    setBusyId(target.id)
    const res = await api(`/api/users/${target.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, expectedUpdatedAt: target.updatedAt }),
    })
    setBusyId(null)
    if (!res.ok) {
      Alert.alert('Update failed', res.status === 409 ? 'This staff member was changed elsewhere. Pull to refresh.' : res.error)
      return false
    }
    load(true)
    return true
  }

  function confirmToggle(target: StaffRow) {
    const verb = target.isActive ? 'Deactivate' : 'Activate'
    Alert.alert(`${verb} ${target.fullName}?`, target.isActive ? 'They will no longer be able to sign in.' : 'They will be able to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb,
        style: target.isActive ? 'destructive' : 'default',
        onPress: () => updateUser(target, { isActive: !target.isActive }),
      },
    ])
  }

  function openReset(target: StaffRow, kind: ResetKind) {
    setResetTarget(target)
    setResetKind(kind)
    setResetValue('')
    setResetConfirm('')
  }

  async function submitReset() {
    if (!resetTarget) return
    if (resetKind === 'pin') {
      if (!/^\d{4,6}$/.test(resetValue)) return Alert.alert('Invalid PIN', 'PIN must be 4-6 digits.')
    } else {
      const problem = passwordProblem(resetValue)
      if (problem) return Alert.alert('Weak password', problem)
    }
    if (resetValue !== resetConfirm) return Alert.alert('Mismatch', 'The two entries do not match.')
    const target = resetTarget
    const ok = await updateUser(target, resetKind === 'pin' ? { pin: resetValue } : { password: resetValue })
    if (ok) {
      setResetTarget(null)
      Alert.alert('Done', resetKind === 'pin' ? `PIN updated for ${target.fullName}.` : `Password updated for ${target.fullName}.`)
    }
  }

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name

  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/pos'))} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.storeName} numberOfLines={1}>
            {user?.tenantName || 'POSLanka'}
          </Text>
          <Text style={styles.branchSub}>Staff accounts</Text>
        </View>
        {canManage ? (
          <TouchableOpacity onPress={openCreate} style={styles.addBtn}>
            <Text style={styles.addBtnText}>＋ Add</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      {user === undefined ? (
        <LoadingView />
      ) : !canManage ? (
        <EmptyView icon="🔒" title="Not available for your role" subtitle={`${roleLabel(user?.role)} accounts cannot manage staff.`} />
      ) : loading ? (
        <LoadingView text="Loading staff…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentInner}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                load(true)
              }}
            />
          }
        >
          {notice ? <InlineNotice text={notice} tone="warn" /> : null}
          <View style={styles.filterRow}>
            <Text style={styles.countText}>
              {visible.length} {showInactive ? 'staff' : 'active staff'}
            </Text>
            <TouchableOpacity onPress={() => setShowInactive((v) => !v)} style={[styles.chip, showInactive && styles.chipOn]}>
              <Text style={[styles.chipText, showInactive && styles.chipTextOn]}>Show inactive</Text>
            </TouchableOpacity>
          </View>

          {visible.length === 0 ? (
            <EmptyView icon="👥" title="No staff yet" subtitle="Tap ＋ Add to create a cashier or admin account." />
          ) : (
            visible.map((s) => {
              const isSelf = s.id === user?.id
              const editable = canModifyUser(actorRole, s.role)
              const busy = busyId === s.id
              return (
                <View key={s.id} style={[styles.card, !s.isActive && styles.cardInactive]}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>
                        {s.fullName}
                        {isSelf ? <Text style={styles.muted}> (you)</Text> : null}
                      </Text>
                      <Text style={styles.muted}>{s.email}</Text>
                    </View>
                    <View style={styles.rolePill}>
                      <Text style={styles.rolePillText}>{roleLabel(s.role)}</Text>
                    </View>
                  </View>
                  <View style={styles.tagRow}>
                    {!s.isActive ? (
                      <View style={[styles.tag, { backgroundColor: THEME.colors.errorLight }]}>
                        <Text style={[styles.tagText, { color: THEME.colors.error }]}>Inactive</Text>
                      </View>
                    ) : null}
                    {s.role === 'owner' ? (
                      <View style={styles.tag}>
                        <Text style={styles.tagText}>All branches</Text>
                      </View>
                    ) : (s.warehouses || []).length === 0 ? (
                      <View style={styles.tag}>
                        <Text style={styles.tagText}>No branch</Text>
                      </View>
                    ) : (
                      (s.warehouses || []).map((w) => (
                        <View key={w.warehouseId} style={styles.tag}>
                          <Text style={styles.tagText}>🏬 {w.warehouse.name}</Text>
                        </View>
                      ))
                    )}
                    {(s.posProfiles || []).map((p) => (
                      <View key={p.posProfileId} style={[styles.tag, { backgroundColor: THEME.colors.primaryLight }]}>
                        <Text style={[styles.tagText, { color: THEME.colors.primary }]}>🖥 {p.name}</Text>
                      </View>
                    ))}
                  </View>
                  {editable && !isSelf ? (
                    <View style={styles.actionRow}>
                      {busy ? (
                        <ActivityIndicator color={THEME.colors.primary} />
                      ) : (
                        <>
                          <Pressable style={styles.actionBtn} onPress={() => openReset(s, 'pin')}>
                            <Text style={styles.actionText}>Reset PIN</Text>
                          </Pressable>
                          <Pressable style={styles.actionBtn} onPress={() => openReset(s, 'password')}>
                            <Text style={styles.actionText}>Reset password</Text>
                          </Pressable>
                          <Pressable style={[styles.actionBtn, s.isActive && styles.actionDanger]} onPress={() => confirmToggle(s)}>
                            <Text style={[styles.actionText, s.isActive && { color: THEME.colors.error }]}>
                              {s.isActive ? 'Deactivate' : 'Activate'}
                            </Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              )
            })
          )}
        </ScrollView>
      )}

      {/* Create staff */}
      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New staff member</Text>
              <TouchableOpacity onPress={() => setCreateOpen(false)}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Full name *</Text>
              <TextInput style={styles.input} value={form.fullName} onChangeText={(v) => setForm({ ...form, fullName: v })} placeholder="e.g. Nimal Perera" />
              <Text style={styles.label}>Email (sign-in) *</Text>
              <TextInput
                style={styles.input}
                value={form.email}
                onChangeText={(v) => setForm({ ...form, email: v })}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="cashier@shop.lk"
              />
              <Text style={styles.label}>Role *</Text>
              <View style={styles.chipWrap}>
                {roles.map((r) => (
                  <TouchableOpacity key={r} onPress={() => setForm({ ...form, role: r })} style={[styles.chip, form.role === r && styles.chipOn]}>
                    <Text style={[styles.chipText, form.role === r && styles.chipTextOn]}>{roleLabel(r)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Password *</Text>
              <TextInput style={styles.input} value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry autoCapitalize="none" />
              <Text style={styles.label}>Confirm password *</Text>
              <TextInput style={styles.input} value={form.confirm} onChangeText={(v) => setForm({ ...form, confirm: v })} secureTextEntry autoCapitalize="none" />
              <Text style={[styles.hint, form.password && passwordProblem(form.password) ? { color: THEME.colors.secondary } : null]}>{PASSWORD_RULE}</Text>
              <Text style={styles.label}>POS PIN (optional, 4-6 digits)</Text>
              <TextInput
                style={styles.input}
                value={form.pin}
                onChangeText={(v) => setForm({ ...form, pin: v.replace(/\D/g, '').slice(0, 6) })}
                keyboardType="number-pad"
                secureTextEntry
              />
              <Text style={styles.label}>Branches</Text>
              {branches.length === 0 ? (
                <Text style={styles.hint}>No branches found.</Text>
              ) : (
                <View style={styles.chipWrap}>
                  {branches.map((b) => {
                    const on = formBranches.includes(b.id)
                    return (
                      <TouchableOpacity key={b.id} onPress={() => toggleBranch(b.id)} style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {on ? '✓ ' : ''}
                          {b.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}
              <Text style={styles.label}>POS counters</Text>
              {visibleCounters.length === 0 ? (
                <Text style={styles.hint}>No counters for the selected branches.</Text>
              ) : (
                <View style={styles.chipWrap}>
                  {visibleCounters.map((c) => {
                    const on = formCounters.includes(c.id)
                    const bn = formBranches.length !== 1 ? branchName(c.warehouseId) : undefined
                    return (
                      <TouchableOpacity key={c.id} onPress={() => toggleCounter(c.id)} style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {on ? '✓ ' : ''}
                          {c.name}
                          {bn ? ` · ${bn}` : ''}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}
              <Text style={styles.hint}>Cashiers get the branch’s only counter automatically if none is chosen.</Text>
              <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={submitCreate} disabled={saving}>
                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Create staff account</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reset PIN / password */}
      <Modal visible={!!resetTarget} animationType="fade" transparent onRequestClose={() => setResetTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdropCenter}>
          <View style={styles.dialog}>
            <Text style={styles.sheetTitle}>
              {resetKind === 'pin' ? 'Reset PIN' : 'Reset password'} — {resetTarget?.fullName}
            </Text>
            <Text style={styles.label}>{resetKind === 'pin' ? 'New PIN (4-6 digits)' : 'New password'}</Text>
            <TextInput
              style={styles.input}
              value={resetValue}
              onChangeText={(v) => setResetValue(resetKind === 'pin' ? v.replace(/\D/g, '').slice(0, 6) : v)}
              keyboardType={resetKind === 'pin' ? 'number-pad' : 'default'}
              secureTextEntry
              autoCapitalize="none"
            />
            <Text style={styles.label}>Confirm</Text>
            <TextInput
              style={styles.input}
              value={resetConfirm}
              onChangeText={(v) => setResetConfirm(resetKind === 'pin' ? v.replace(/\D/g, '').slice(0, 6) : v)}
              keyboardType={resetKind === 'pin' ? 'number-pad' : 'default'}
              secureTextEntry
              autoCapitalize="none"
            />
            {resetKind === 'password' ? <Text style={styles.hint}>{PASSWORD_RULE}</Text> : null}
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setResetTarget(null)}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]} onPress={submitReset} disabled={!!busyId}>
                {busyId ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 44,
    paddingBottom: 12,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { fontSize: 22, color: THEME.colors.text },
  headerCenter: { flex: 1, marginHorizontal: 8 },
  storeName: { fontSize: 16, fontWeight: '800', color: THEME.colors.text },
  branchSub: { fontSize: 12, color: THEME.colors.textMuted },
  addBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: THEME.colors.primary },
  addBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  content: { flex: 1 },
  contentInner: { padding: 16, gap: 10 },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countText: { fontSize: 13, color: THEME.colors.textMuted, fontWeight: '600' },
  card: { backgroundColor: THEME.colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: THEME.colors.border },
  cardInactive: { opacity: 0.7 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  name: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  muted: { fontSize: 12, color: THEME.colors.textMuted, fontWeight: '400' },
  rolePill: { backgroundColor: THEME.colors.surfaceContainer, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rolePillText: { fontSize: 11, fontWeight: '700', color: THEME.colors.text },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { backgroundColor: THEME.colors.surfaceContainerLow, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 11, fontWeight: '600', color: THEME.colors.text },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  actionBtn: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  actionDanger: { borderColor: THEME.colors.errorLight },
  actionText: { fontSize: 12, fontWeight: '700', color: THEME.colors.primary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: THEME.colors.card },
  chipOn: { borderColor: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight },
  chipText: { fontSize: 12, fontWeight: '600', color: THEME.colors.text },
  chipTextOn: { color: THEME.colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBackdropCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: THEME.colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '92%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: THEME.colors.text },
  close: { fontSize: 18, color: THEME.colors.textMuted, padding: 4 },
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME.colors.text,
    backgroundColor: THEME.colors.card,
  },
  hint: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 6 },
  primaryBtn: { marginTop: 18, backgroundColor: THEME.colors.primary, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  primaryBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  secondaryBtn: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center' },
  secondaryBtnText: { color: THEME.colors.text, fontWeight: '700', fontSize: 14 },
  dialog: { backgroundColor: THEME.colors.card, borderRadius: 14, padding: 18 },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
})

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
  Share,
} from 'react-native'
import { router } from 'expo-router'
import { api, apiGet, apiPost, asList, getUser, formatBusinessId, type AuthUser } from '../src/lib/api'
import { hasPermission, roleLabel, canModifyUser, assignableRoles, displayRole } from '../src/lib/roles'
import { THEME } from '../src/lib/theme'
import { LoadingView, EmptyView, ErrorView, InlineNotice } from '../src/components/StateViews'
import { useHeaderPad, useBottomPad } from '../src/lib/safeArea'
import { goBack } from '../src/lib/nav'

interface StaffRow {
  id: string
  email: string
  fullName: string
  role: string
  customRoleId?: string | null
  customRoleName?: string | null
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

interface CustomRole {
  id: string
  name: string
  baseRole: string
  isActive: boolean
}

/** Role choice in the forms: a built-in role, optionally refined by a custom role. */
interface RoleChoice {
  role: string
  customRoleId: string
}

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
  customRoleId: '',
  password: '',
  confirm: '',
  pin: '',
}

export default function StaffScreen() {
  const headerPad = useHeaderPad()
  const bottomPad = useBottomPad()
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([])
  const [roleTarget, setRoleTarget] = useState<StaffRow | null>(null)
  const [roleChoice, setRoleChoice] = useState<RoleChoice>({ role: 'cashier', customRoleId: '' })
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
      const [usersRes, whRes, ppRes, crRes] = await Promise.all([
        apiGet<StaffRow[]>('/api/users?includeWarehouses=true'),
        apiGet<any>('/api/warehouses?all=true&activeOnly=true'),
        apiGet<any>('/api/pos-profiles?all=true'),
        apiGet<any>('/api/custom-roles'),
      ])
      if (crRes.ok) setCustomRoles(asList<CustomRole>(crRes.data, 'customRoles', 'roles').filter((r) => r.isActive !== false))
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

  // Custom roles the actor may hand out: their base role must itself be assignable.
  const assignableCustomRoles = useMemo(() => customRoles.filter((r) => roles.includes(r.baseRole)), [customRoles, roles])

  function renderRolePicker(value: RoleChoice, onChange: (v: RoleChoice) => void) {
    return (
      <>
        <View style={styles.chipWrap}>
          {roles.map((r) => {
            const on = value.role === r && !value.customRoleId
            return (
              <TouchableOpacity key={r} onPress={() => onChange({ role: r, customRoleId: '' })} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{roleLabel(r)}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        {assignableCustomRoles.length > 0 ? (
          <>
            <Text style={styles.hint}>Custom roles (set up by the owner on the web: Settings → Role Permissions)</Text>
            <View style={styles.chipWrap}>
              {assignableCustomRoles.map((cr) => {
                const on = value.customRoleId === cr.id
                return (
                  <TouchableOpacity key={cr.id} onPress={() => onChange({ role: cr.baseRole, customRoleId: cr.id })} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      ★ {cr.name} · {roleLabel(cr.baseRole)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </>
        ) : null}
      </>
    )
  }

  function openRoleChange(target: StaffRow) {
    setRoleTarget(target)
    setRoleChoice({ role: target.role, customRoleId: target.customRoleId || '' })
  }

  async function submitRoleChange() {
    if (!roleTarget) return
    const target = roleTarget
    const ok = await updateUser(target, { role: roleChoice.role, customRoleId: roleChoice.customRoleId || null })
    if (ok) setRoleTarget(null)
  }

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
    // Only name and role are required: no email → login made from the name, no password → generated
    const pwProblem = form.password ? passwordProblem(form.password) : null
    if (pwProblem) return Alert.alert('Weak password', pwProblem)
    if (form.password && form.password !== form.confirm) return Alert.alert('Passwords differ', 'The two passwords do not match.')
    if (form.pin && !/^\d{4,6}$/.test(form.pin)) return Alert.alert('Invalid PIN', 'PIN must be 4-6 digits.')

    setSaving(true)
    const res = await apiPost<{ mode: string; user: StaffRow; generatedPassword?: string | null }>('/api/users', {
      mode: 'create',
      email: form.email.trim() || undefined,
      fullName: form.fullName.trim(),
      role: form.role,
      ...(form.customRoleId ? { customRoleId: form.customRoleId } : {}),
      password: form.password || undefined,
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
    showNewLogin(res.data.user?.fullName || 'The staff member', res.data.user?.email || form.email.trim(), res.data.generatedPassword || null)
    load(true)
  }

  /** Login (and a generated password, shown once) of someone just created, with a Share button */
  function showNewLogin(name: string, login: string, password: string | null) {
    const text = `Login: ${login}${password ? `\nPassword: ${password}` : ''}`
    Alert.alert(
      password ? 'Staff created — password shown once' : 'Staff created',
      `${name} can now sign in with the Business ID and\n\n${text}`,
      [
        { text: 'Share', onPress: () => { Share.share({ message: `${name}\n${text}` }).catch(() => undefined) } },
        { text: 'Done', style: 'cancel' },
      ],
    )
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
      <View style={[styles.header, headerPad]}>
        <TouchableOpacity onPress={() => goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.storeName} numberOfLines={1}>
            {user?.tenantName || 'skyERPOS'}
          </Text>
          <Text style={styles.branchSub} numberOfLines={1}>Staff accounts</Text>
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
        <EmptyView icon="🔒" title="Not available for your role" subtitle={`${displayRole(user)} accounts cannot manage staff.`} />
      ) : loading ? (
        <LoadingView text="Loading staff…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={[styles.contentInner, { paddingBottom: 24 + bottomPad }]}
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
          {user?.businessId ? (
            <View style={styles.bizBanner}>
              <Text style={styles.bizBannerText}>
                Staff sign in with Business ID <Text style={styles.bizBannerId}>{formatBusinessId(user.businessId)}</Text>
              </Text>
            </View>
          ) : null}
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
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={2}>
                        {s.fullName}
                        {isSelf ? <Text style={styles.muted}> (you)</Text> : null}
                      </Text>
                      <Text style={styles.muted} numberOfLines={1}>{s.email}</Text>
                    </View>
                    <View style={styles.rolePill}>
                      <Text style={styles.rolePillText} numberOfLines={1}>{s.customRoleName ? `★ ${s.customRoleName}` : roleLabel(s.role)}</Text>
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
                          {s.role !== 'owner' ? (
                            <Pressable style={styles.actionBtn} onPress={() => openRoleChange(s)}>
                              <Text style={styles.actionText}>Change role</Text>
                            </Pressable>
                          ) : null}
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
            <ScrollView contentContainerStyle={{ paddingBottom: 24 + bottomPad }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Full name *</Text>
              <TextInput style={styles.input} value={form.fullName} onChangeText={(v) => setForm({ ...form, fullName: v })} placeholder="e.g. Nimal Perera" />
              <Text style={styles.label}>Email (sign-in, optional)</Text>
              <TextInput
                style={styles.input}
                value={form.email}
                onChangeText={(v) => setForm({ ...form, email: v })}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Blank = login made from the name"
              />
              <Text style={styles.label}>Role *</Text>
              {renderRolePicker({ role: form.role, customRoleId: form.customRoleId }, (v) => setForm({ ...form, role: v.role, customRoleId: v.customRoleId }))}
              <Text style={styles.label}>Password (optional)</Text>
              <TextInput style={styles.input} value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry autoCapitalize="none" placeholder="Blank = generated and shown once" />
              <Text style={styles.label}>Confirm password</Text>
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

      {/* Change role (built-in or custom). The server re-checks rank + permissions held. */}
      <Modal visible={!!roleTarget} animationType="fade" transparent onRequestClose={() => setRoleTarget(null)}>
        <View style={styles.modalBackdropCenter}>
          <View style={styles.dialog}>
            <Text style={styles.sheetTitle} numberOfLines={2}>Role — {roleTarget?.fullName}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {renderRolePicker(roleChoice, setRoleChoice)}
            </ScrollView>
            <Text style={styles.hint}>Their open sessions pick up the new role on the next request.</Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setRoleTarget(null)}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]} onPress={submitRoleChange} disabled={!!busyId}>
                {busyId ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Save role</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  bizBanner: {
    backgroundColor: THEME.colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  bizBannerText: { fontSize: 12, color: THEME.colors.primary },
  bizBannerId: { fontFamily: 'monospace', fontWeight: '800', fontSize: 13 },
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
  rolePill: { backgroundColor: THEME.colors.surfaceContainer, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '45%' },
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
  sheet: { backgroundColor: THEME.colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '92%', width: '100%', maxWidth: 720, alignSelf: 'center' },
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
  dialog: { backgroundColor: THEME.colors.card, borderRadius: 14, padding: 18, width: '100%', maxWidth: 520, alignSelf: 'center' },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
})

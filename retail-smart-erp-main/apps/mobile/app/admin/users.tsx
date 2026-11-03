// Users: vendor owner accounts (activate / deactivate, needs vendors.manage) and platform admins
// (create + role / 2FA / password actions; owners only — permission `admins`).
// APIs: users, users/[id] (PUT), users/admins, users/admins (POST), users/admins/[id] (POST).
import React, { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, RefreshControl, TextInput, StyleSheet, Alert } from 'react-native'
import { adminGet, adminPost, adminPut, ADMIN_ROLE_LABEL, useAdminUser, type AdminRole } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Pill, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'
import { Btn, Choice, Field, FilterChips, FormModal, ListFooter, MoreShell, Notice, SwitchRow } from '../../src/components/admin/AdminForm'
import { alertIfFailed, confirmAction, fmtDateTime, pickList, usePagedList } from '../../src/lib/adminForms'

type Segment = 'owners' | 'admins'

interface Account {
  id: string
  email: string
  fullName?: string | null
  phone?: string | null
  isActive: boolean
  emailVerified?: boolean
  lastLoginAt?: string | null
  companies?: number
  deactivationReason?: string | null
}

interface PlatformAdmin {
  id: string
  email: string
  fullName: string
  phone?: string | null
  role: AdminRole
  isActive: boolean
  lastLoginAt?: string | null
  totpEnabled?: boolean
  totpRequired?: boolean
  mustChangePassword?: boolean
  activeSessions?: number
}

const ROLES: Array<{ value: AdminRole; label: string }> = (['owner', 'support', 'billing', 'viewer'] as AdminRole[]).map((r) => ({ value: r, label: ADMIN_ROLE_LABEL[r] }))

export default function AdminUsersScreen() {
  const { can } = useAdminUser()
  const canManageOwners = can('vendors.manage')
  const canAdmins = can('admins')
  const [segment, setSegment] = useState<Segment>('owners')

  return (
    <MoreShell title="Users" subtitle={segment === 'owners' ? 'Vendor owner accounts' : 'Platform admins'}>
      <View style={[adminStyles.segment, { paddingHorizontal: 16, paddingTop: 12 }]}>
        {(['owners', 'admins'] as Segment[]).map((s) => (
          <Pressable key={s} style={[adminStyles.segmentBtn, segment === s && adminStyles.segmentBtnActive]} onPress={() => setSegment(s)}>
            <Text style={[adminStyles.segmentText, segment === s && adminStyles.segmentTextActive]}>{s === 'owners' ? 'Vendor owners' : 'Platform admins'}</Text>
          </Pressable>
        ))}
      </View>
      {segment === 'owners' ? <OwnersList canManage={canManageOwners} /> : <AdminsList canManage={canAdmins} />}
    </MoreShell>
  )
}

function OwnersList({ canManage }: { canManage: boolean }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const list = usePagedList<Account>({
    path: (page) => {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (debounced) p.set('q', debounced)
      if (status !== 'all') p.set('status', status)
      return `/api/sys-control/users?${p.toString()}`
    },
    pick: (b) => ({ rows: Array.isArray(b?.accounts) ? b.accounts : [], total: b?.pagination?.total }),
    deps: [debounced, status],
  })

  const [target, setTarget] = useState<Account | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function setActive(a: Account, isActive: boolean, why?: string) {
    setBusy(true)
    const res = await adminPut(`/api/sys-control/users/${a.id}`, { isActive, ...(why ? { deactivationReason: why } : {}) })
    setBusy(false)
    if (!alertIfFailed(res, 'Update failed')) return
    setTarget(null)
    list.silentReload()
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <TextInput style={adminStyles.input} placeholder="Search name, email or phone…" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} />
      </View>
      <FilterChips value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Deactivated' }]} />
      {list.loading ? (
        <LoadingView text="Loading accounts…" />
      ) : list.error ? (
        <ErrorView message={list.error} onRetry={list.reload} />
      ) : (
        <FlatList
          data={list.rows}
          keyExtractor={(a) => a.id}
          contentContainerStyle={adminStyles.content}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Text style={adminStyles.empty}>No accounts match.</Text>}
          ListFooterComponent={<ListFooter loadingMore={list.loadingMore} hasMore={list.hasMore} shown={list.rows.length} total={list.total} onMore={list.loadMore} />}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => { setTarget(item); setReason('') }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.name} numberOfLines={1}>{item.fullName || item.email}</Text>
                <Text style={adminStyles.muted} numberOfLines={1}>{item.email}{item.phone && !item.phone.startsWith('unset-') ? ` · ${item.phone}` : ''}</Text>
                <Text style={adminStyles.muted}>{item.companies ?? 0} business(es){item.lastLoginAt ? ` · last sign-in ${timeAgo(item.lastLoginAt)}` : ' · never signed in'}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  <Pill text={item.isActive ? 'active' : 'deactivated'} tone={item.isActive ? 'ok' : 'error'} />
                  {item.emailVerified === false ? <Pill text="email unverified" tone="warn" /> : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <FormModal
        visible={!!target}
        title={target?.fullName || target?.email || 'Account'}
        message={target ? `${target.email}${target.deactivationReason ? `\nDeactivated: ${target.deactivationReason}` : ''}` : undefined}
        confirmLabel={canManage && target ? (target.isActive ? 'Deactivate' : 'Reactivate') : null}
        danger={!!target?.isActive}
        busy={busy}
        disabled={!!target?.isActive && reason.trim().length < 3}
        onCancel={() => setTarget(null)}
        onConfirm={() => target && (target.isActive ? setActive(target, false, reason.trim()) : setActive(target, true))}
      >
        {!canManage ? <Notice text="Changing accounts needs the Owner role." /> : null}
        {canManage && target?.isActive ? (
          <>
            <Field label="Reason *" value={reason} onChangeText={setReason} autoCapitalize="sentences" />
            <Notice tone="warn" text="The owner cannot sign in to the account portal while deactivated." />
          </>
        ) : null}
      </FormModal>
    </View>
  )
}

function AdminsList({ canManage }: { canManage: boolean }) {
  const [admins, setAdmins] = useState<PlatformAdmin[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    const res = await adminGet<any>('/api/sys-control/users/admins')
    if (res.ok) {
      setAdmins(pickList<PlatformAdmin>(res.data, 'admins'))
      setMeId(res.data?.meId ?? null)
    } else setError(res.error)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<AdminRole>('viewer')
  const [requireTotp, setRequireTotp] = useState(true)
  const [sendEmail, setSendEmail] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [secret, setSecret] = useState<{ title: string; password: string; note?: string } | null>(null)

  async function create() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setFormError('Enter a valid email.')
    if (fullName.trim().length < 2) return setFormError('Enter the full name.')
    setFormError(null)
    setBusy('create')
    const res = await adminPost<{ admin: PlatformAdmin; tempPassword: string; emailStatus?: string }>('/api/sys-control/users/admins', {
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      role,
      requireTotp,
      sendEmail,
    })
    setBusy(null)
    if (!alertIfFailed(res, 'Could not create admin')) return
    setCreating(false)
    setEmail('')
    setFullName('')
    setPhone('')
    setSecret({ title: `${res.data.admin.fullName} created`, password: res.data.tempPassword, note: res.data.emailStatus === 'sent' ? 'The sign-in details were also emailed.' : undefined })
    load(true)
  }

  const [selected, setSelected] = useState<PlatformAdmin | null>(null)
  const [pendingRole, setPendingRole] = useState<AdminRole>('viewer')
  const [deactReason, setDeactReason] = useState('')

  function openAdmin(a: PlatformAdmin) {
    setSelected(a)
    setPendingRole(a.role)
    setDeactReason('')
  }

  async function runAdminAction(a: PlatformAdmin, body: Record<string, unknown>, label: string) {
    setBusy(label)
    const res = await adminPost<{ admin: PlatformAdmin; tempPassword?: string }>(`/api/sys-control/users/admins/${a.id}`, body)
    setBusy(null)
    if (!alertIfFailed(res, 'Action failed')) return
    setSelected(null)
    if (res.data?.tempPassword) setSecret({ title: `New password for ${a.fullName}`, password: res.data.tempPassword, note: 'They must change it at next sign-in.' })
    else Alert.alert('Done', label)
    load(true)
  }

  const isSelf = !!selected && selected.id === meId

  return (
    <View style={{ flex: 1 }}>
      {loading ? (
        <LoadingView text="Loading admins…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={admins}
          keyExtractor={(a) => a.id}
          contentContainerStyle={adminStyles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true) }} />}
          ListHeaderComponent={
            <View style={{ gap: 8 }}>
              {!canManage ? <Notice text="Only Owner admins can add or change platform admins." /> : <Btn label="+ Add platform admin" onPress={() => { setFormError(null); setCreating(true) }} />}
            </View>
          }
          ListEmptyComponent={<Text style={adminStyles.empty}>No platform admins.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => openAdmin(item)}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.name} numberOfLines={1}>{item.fullName}{item.id === meId ? ' (you)' : ''}</Text>
                <Text style={adminStyles.muted} numberOfLines={1}>{item.email}</Text>
                <Text style={adminStyles.muted}>{item.lastLoginAt ? `Last sign-in ${fmtDateTime(item.lastLoginAt)}` : 'Never signed in'}{item.activeSessions ? ` · ${item.activeSessions} session(s)` : ''}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <Pill text={ADMIN_ROLE_LABEL[item.role] ?? item.role} tone="primary" />
                  <Pill text={item.isActive ? 'active' : 'deactivated'} tone={item.isActive ? 'ok' : 'error'} />
                  <Pill text={item.totpEnabled ? '2FA on' : item.totpRequired ? '2FA required' : '2FA off'} tone={item.totpEnabled ? 'ok' : item.totpRequired ? 'warn' : 'muted'} />
                  {item.mustChangePassword ? <Pill text="must change password" tone="warn" /> : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <FormModal visible={creating} title="Add platform admin" confirmLabel="Create" busy={busy === 'create'} onCancel={() => setCreating(false)} onConfirm={create}>
        <Field label="Email *" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <Field label="Full name *" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Choice label="Role" value={role} onChange={setRole} options={ROLES} />
        <SwitchRow label="Require two-factor sign-in" value={requireTotp} onValueChange={setRequireTotp} />
        <SwitchRow label="Email the temporary password" value={sendEmail} onValueChange={setSendEmail} />
        <Notice text="A temporary password is shown once. They must change it at first sign-in." />
        {formError ? <View style={{ marginTop: 8 }}><Notice tone="error" text={formError} /></View> : null}
      </FormModal>

      <FormModal visible={!!selected} title={selected?.fullName || 'Admin'} message={selected ? `${selected.email} · ${ADMIN_ROLE_LABEL[selected.role] ?? selected.role}` : undefined} confirmLabel={null} onCancel={() => setSelected(null)}>
        {selected && !canManage ? <Notice text="Only Owner admins can change platform admins." /> : null}
        {selected && canManage ? (
          <View style={{ gap: 8 }}>
            {isSelf ? <Notice text="This is your own account. Use Account to change your password; role and deactivation changes to yourself are refused by the server." /> : null}
            <Choice label="Role" value={pendingRole} onChange={setPendingRole} options={ROLES} />
            <Btn label="Change role" tone="ghost" disabled={pendingRole === selected.role || !!busy} busy={busy === 'Role changed'} onPress={() => runAdminAction(selected, { action: 'change_role', role: pendingRole }, 'Role changed')} />
            <Btn label="Reset password (shows temporary password)" tone="ghost" disabled={!!busy} busy={busy === 'Password reset'} onPress={() => confirmAction('Reset password?', `${selected.fullName} is signed out everywhere and gets a new temporary password.`, 'Reset', () => runAdminAction(selected, { action: 'reset_password', sendEmail: true }, 'Password reset'))} />
            {selected.totpRequired ? (
              <Btn label="Waive 2FA requirement" tone="ghost" disabled={!!busy} onPress={() => runAdminAction(selected, { action: 'waive_2fa' }, '2FA requirement waived')} />
            ) : (
              <Btn label="Require 2FA" tone="ghost" disabled={!!busy} onPress={() => runAdminAction(selected, { action: 'require_2fa' }, '2FA now required')} />
            )}
            {selected.totpEnabled ? <Btn label="Reset 2FA enrolment" tone="ghost" disabled={!!busy} onPress={() => confirmAction('Reset 2FA?', 'They must enrol an authenticator again.', 'Reset', () => runAdminAction(selected, { action: 'reset_2fa' }, '2FA reset'), true)} /> : null}
            {selected.isActive ? (
              <>
                <Field label="Deactivation reason" value={deactReason} onChangeText={setDeactReason} autoCapitalize="sentences" />
                <Btn label="Deactivate admin" tone="danger" disabled={!!busy || isSelf} busy={busy === 'Admin deactivated'} onPress={() => confirmAction('Deactivate admin?', `${selected.fullName} will be signed out and blocked.`, 'Deactivate', () => runAdminAction(selected, { action: 'deactivate', ...(deactReason.trim() ? { reason: deactReason.trim() } : {}) }, 'Admin deactivated'), true)} />
              </>
            ) : (
              <Btn label="Reactivate admin" disabled={!!busy} onPress={() => runAdminAction(selected, { action: 'reactivate' }, 'Admin reactivated')} />
            )}
          </View>
        ) : null}
      </FormModal>

      <FormModal visible={!!secret} title={secret?.title || ''} confirmLabel={null} onCancel={() => setSecret(null)}>
        <Text style={styles.warn}>Temporary password (shown once)</Text>
        <Text selectable style={styles.password}>{secret?.password}</Text>
        <Text style={adminStyles.muted}>{secret?.note || 'Hand it over securely. It cannot be shown again.'}</Text>
      </FormModal>
    </View>
  )
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  name: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  warn: { fontSize: 12, fontWeight: '800', color: THEME.colors.secondary, textTransform: 'uppercase' },
  password: { fontSize: 20, fontWeight: '900', color: THEME.colors.text, fontFamily: 'monospace', letterSpacing: 1, marginVertical: 8 },
})

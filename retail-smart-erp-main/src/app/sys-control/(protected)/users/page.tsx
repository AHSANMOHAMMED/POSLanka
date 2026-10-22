'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  AdminTable,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  SearchInput,
  SegmentedControl,
  Select,
  StatCard,
  StatGrid,
  Textarea,
  fmtDateTime,
  fmtNumber,
  timeAgo,
  type AdminColumn,
  type Tone,
} from '@/components/admin/kit'
import { CopyButton, Pager, adminFetch, fmtDate } from '@/components/admin/console-helpers'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { ADMIN_ROLES, ADMIN_ROLE_DESCRIPTIONS, ADMIN_ROLE_LABELS, type AdminRole } from '@/lib/admin/roles'

/* ------------------------------------------------------------------ types */

interface PlatformAdmin {
  id: string
  email: string
  fullName: string
  phone: string | null
  isActive: boolean
  deactivatedAt: string | null
  lastLoginAt: string | null
  lastLoginIp: string | null
  lockedUntil: string | null
  failedLoginAttempts: number
  totpEnabled: boolean
  totpRequired: boolean
  mustChangePassword: boolean
  role: AdminRole
  createdAt: string
  activeSessions: number
}

const ROLE_TONE: Record<AdminRole, Tone> = { owner: 'primary', support: 'info', billing: 'warning', viewer: 'neutral' }

interface CustomerAccount {
  id: string
  email: string
  fullName: string
  phone: string | null
  emailVerified: boolean
  isActive: boolean
  deactivatedAt: string | null
  deactivationReason: string | null
  lastLoginAt: string | null
  createdAt: string
  companies: number
}

type Tab = 'admins' | 'accounts'
type EmailStatus = 'sent' | 'logged' | 'failed' | 'skipped'
const PAGE_SIZE = 25

const EMAIL_STATUS_TEXT: Record<EmailStatus, string> = {
  sent: 'The sign-in details were emailed.',
  logged: 'Email is not configured on this server, so nothing was sent — share the password yourself.',
  failed: 'The email could not be sent — share the password yourself.',
  skipped: 'No email was sent — share the password yourself.',
}

function adminState(a: PlatformAdmin): { label: string; tone: Tone } {
  if (!a.isActive) return { label: 'Deactivated', tone: 'neutral' }
  if (a.lockedUntil && new Date(a.lockedUntil) > new Date()) return { label: 'Locked out', tone: 'danger' }
  if (a.mustChangePassword) return { label: 'Password change pending', tone: 'warning' }
  return { label: 'Active', tone: 'success' }
}

function twoFactorState(a: PlatformAdmin): { label: string; tone: Tone } {
  if (a.totpEnabled) return { label: a.totpRequired ? 'On · required' : 'On', tone: 'success' }
  if (a.totpRequired) return { label: 'Required · not set up', tone: 'warning' }
  return { label: 'Off', tone: 'neutral' }
}

/* ------------------------------------------------------------------ page */

export default function PlatformUsersPage() {
  const [tab, setTab] = useState<Tab>('admins')
  return (
    <AdminPage
      title="Platform users"
      description="Console administrators and the customer accounts that sign in to the account portal."
    >
      <SegmentedControl
        ariaLabel="User type"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'admins', label: 'Console admins' },
          { value: 'accounts', label: 'Customer accounts' },
        ]}
      />
      {tab === 'admins' ? <AdminsTab /> : <AccountsTab />}
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ console admins */

function AdminsTab() {
  const [admins, setAdmins] = useState<PlatformAdmin[] | null>(null)
  const [meId, setMeId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState<PlatformAdmin | null>(null)
  const [secret, setSecret] = useState<{ email: string; password: string; emailStatus: EmailStatus } | null>(null)
  const canManage = useAdminCan('admins')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch<{ admins: PlatformAdmin[]; meId: string }>('/api/sys-control/users/admins')
      setAdmins(data.admins)
      setMeId(data.meId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load platform admins')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const rows = admins ?? []
  const active = rows.filter((a) => a.isActive)
  const withTotp = active.filter((a) => a.totpEnabled).length

  const columns: AdminColumn<PlatformAdmin>[] = [
    {
      key: 'admin',
      header: 'Admin',
      primary: true,
      cell: (a) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-adm-fg">{a.fullName}</span>
            {a.id === meId && <Badge tone="primary">You</Badge>}
          </div>
          <p className="truncate text-[12.5px] text-adm-subtle">{a.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', cell: (a) => <Badge tone={ROLE_TONE[a.role] ?? 'neutral'}>{ADMIN_ROLE_LABELS[a.role] ?? a.role}</Badge> },
    { key: 'status', header: 'Status', cell: (a) => { const s = adminState(a); return <Badge tone={s.tone} dot>{s.label}</Badge> } },
    { key: 'totp', header: 'Two-factor', cell: (a) => { const s = twoFactorState(a); return <Badge tone={s.tone}>{s.label}</Badge> } },
    {
      key: 'login',
      header: 'Last sign-in',
      hideBelow: 'lg',
      cell: (a) => (
        <div className="min-w-0">
          <p className="text-adm-fg">{a.lastLoginAt ? timeAgo(a.lastLoginAt) : 'Never'}</p>
          {a.lastLoginIp && <p className="text-[12.5px] text-adm-subtle">{a.lastLoginIp}</p>}
        </div>
      ),
    },
    { key: 'sessions', header: 'Sessions', align: 'right', hideBelow: 'md', cell: (a) => <span className="adm-num">{a.activeSessions}</span> },
    { key: 'created', header: 'Added', hideBelow: 'xl', cell: (a) => <span className="text-adm-muted">{fmtDate(a.createdAt)}</span> },
  ]

  return (
    <div className="space-y-5">
      {flash && <Alert tone="success" action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash}</Alert>}

      <StatGrid cols={3}>
        <StatCard label="Active admins" value={admins ? fmtNumber(active.length) : '—'} loading={!admins && loading} icon={Users} hint={admins ? `${rows.length - active.length} deactivated` : undefined} />
        <StatCard label="Two-factor on" value={admins ? `${withTotp} of ${active.length}` : '—'} loading={!admins && loading} icon={ShieldCheck} tone={admins && withTotp < active.length ? 'warning' : 'success'} hint="Active admins with an authenticator app" />
        <StatCard label="Signed in now" value={admins ? fmtNumber(rows.filter((a) => a.activeSessions > 0).length) : '—'} loading={!admins && loading} icon={KeyRound} tone="info" hint="Admins with an unexpired session" />
      </StatGrid>

      <AdminCard
        flush
        title="Console admins"
        description={canManage ? 'People who can sign in to this console. Select an admin to manage access and role.' : 'People who can sign in to this console. Only owners can manage admins.'}
        actions={
          <>
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} loading={loading && !!admins}>Refresh</Button>
            {canManage && <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setCreating(true)}>Add admin</Button>}
          </>
        }
      >
        {error ? (
          <div className="p-4 sm:p-5">
            <Alert tone="danger" title="Could not load platform admins" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
          </div>
        ) : (
          <AdminTable
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            onRowClick={setManaging}
            loading={loading}
            minWidth={680}
            rowClassName={(a) => (a.isActive ? undefined : 'opacity-70')}
            empty={<EmptyState icon={Users} title="No platform admins" />}
          />
        )}
      </AdminCard>

      {creating && (
        <CreateAdminDialog
          onClose={() => setCreating(false)}
          onCreated={(admin, password, emailStatus) => {
            setCreating(false)
            setSecret({ email: admin.email, password, emailStatus })
            load()
          }}
        />
      )}

      {managing && (
        <ManageAdminDialog
          admin={managing}
          isSelf={managing.id === meId}
          activeCount={active.length}
          activeOwnerCount={active.filter((a) => a.role === 'owner').length}
          canManage={canManage}
          onClose={() => setManaging(null)}
          onChanged={(msg, updated, temp) => {
            setFlash(msg)
            setManaging(updated)
            if (temp) setSecret(temp)
            load()
          }}
        />
      )}

      {secret && (
        <AdminModal
          open
          onClose={() => setSecret(null)}
          title="Temporary password"
          description={secret.email}
          size="sm"
          footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-adm-border bg-adm-surface-2 px-3 py-2.5">
              <code className="break-all font-mono text-[15px] text-adm-fg">{secret.password}</code>
              <CopyButton text={secret.password} label="Copy password" />
            </div>
            <Alert tone={secret.emailStatus === 'sent' ? 'success' : 'warning'}>{EMAIL_STATUS_TEXT[secret.emailStatus]}</Alert>
            <p className="text-[13px] text-adm-muted">This password is shown only once. The admin must choose a new password when they first sign in.</p>
          </div>
        </AdminModal>
      )}
    </div>
  )
}

function CreateAdminDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (a: PlatformAdmin, password: string, emailStatus: EmailStatus) => void }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [requireTotp, setRequireTotp] = useState(true)
  const [sendEmail, setSendEmail] = useState(true)
  const [role, setRole] = useState<AdminRole>('viewer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const ok = emailOk && fullName.trim().length >= 2

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch<{ admin: PlatformAdmin; tempPassword: string; emailStatus: EmailStatus }>('/api/sys-control/users/admins', {
        method: 'POST',
        json: { email: email.trim(), fullName: fullName.trim(), phone: phone.trim() || undefined, role, requireTotp, sendEmail },
      })
      onCreated(res.admin, res.tempPassword, res.emailStatus)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the admin')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      title="Add a console admin"
      description="Choose what they may do in this console. A temporary password is created for them."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={submit}>Add admin</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ok) submit() }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Full name" htmlFor="na-name" required>
          <Input id="na-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Email" htmlFor="na-email" required error={email && !emailOk ? 'Enter a valid email address' : undefined}>
          <Input id="na-email" type="email" value={email} invalid={!!email && !emailOk} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Phone" htmlFor="na-phone" hint="Optional">
          <Input id="na-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="na-role" hint={ADMIN_ROLE_DESCRIPTIONS[role]}>
          <Select id="na-role" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            {ADMIN_ROLES.map((r) => <option key={r} value={r}>{ADMIN_ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
        <Checkbox
          label="Require two-factor authentication"
          description="They must set up an authenticator app before they can use the console."
          checked={requireTotp}
          onChange={(e) => setRequireTotp(e.target.checked)}
        />
        <Checkbox
          label="Email the sign-in details"
          description="The temporary password is also shown to you once."
          checked={sendEmail}
          onChange={(e) => setSendEmail(e.target.checked)}
        />
      </form>
    </AdminModal>
  )
}

type AdminAction = 'deactivate' | 'reactivate' | 'reset_password' | 'require_2fa' | 'waive_2fa' | 'reset_2fa'

const ACTION_COPY: Record<AdminAction, { title: string; body: string; confirm: string; danger?: boolean; done: string }> = {
  deactivate: { title: 'Deactivate admin?', body: 'They are signed out everywhere and can no longer sign in. You can reactivate them later.', confirm: 'Deactivate', danger: true, done: 'deactivated' },
  reactivate: { title: 'Reactivate admin?', body: 'They can sign in again with their existing password. Any lockout is cleared.', confirm: 'Reactivate', done: 'reactivated' },
  reset_password: { title: 'Reset password?', body: 'A new temporary password replaces the current one and they are signed out everywhere. They must choose a new password at sign-in.', confirm: 'Reset password', danger: true, done: 'password reset' },
  require_2fa: { title: 'Require two-factor authentication?', body: 'If they have not set up an authenticator app, the console stays blocked for them until they do.', confirm: 'Require', done: 'now requires two-factor authentication' },
  waive_2fa: { title: 'Make two-factor optional?', body: 'They can turn two-factor authentication off themselves. An enrolled app keeps working.', confirm: 'Make optional', done: 'two-factor is now optional' },
  reset_2fa: { title: 'Remove their authenticator app?', body: 'Use this when they lost their phone. They are signed out and sign in with their password only until they enrol again.', confirm: 'Remove app', danger: true, done: 'authenticator app removed' },
}

function ManageAdminDialog({
  admin,
  isSelf,
  activeCount,
  activeOwnerCount,
  canManage,
  onClose,
  onChanged,
}: {
  admin: PlatformAdmin
  isSelf: boolean
  activeCount: number
  activeOwnerCount: number
  canManage: boolean
  onClose: () => void
  onChanged: (msg: string, updated: PlatformAdmin, temp?: { email: string; password: string; emailStatus: EmailStatus }) => void
}) {
  const [pending, setPending] = useState<AdminAction | null>(null)
  const [reason, setReason] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [fullName, setFullName] = useState(admin.fullName)
  const [phone, setPhone] = useState(admin.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = adminState(admin)
  const tf = twoFactorState(admin)
  const lastActive = admin.isActive && activeCount <= 1
  const lastOwner = admin.isActive && admin.role === 'owner' && activeOwnerCount <= 1
  const [role, setRole] = useState<AdminRole>(admin.role)

  useEffect(() => { setFullName(admin.fullName); setPhone(admin.phone ?? ''); setRole(admin.role) }, [admin])

  async function run(body: Record<string, unknown>, msg: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch<{ admin: PlatformAdmin; tempPassword?: string; emailStatus?: EmailStatus }>(`/api/sys-control/users/admins/${admin.id}`, { method: 'POST', json: body })
      setPending(null)
      onChanged(msg, { ...res.admin, activeSessions: body.action === 'deactivate' || body.action === 'reset_password' ? 0 : admin.activeSessions },
        res.tempPassword ? { email: admin.email, password: res.tempPassword, emailStatus: res.emailStatus ?? 'skipped' } : undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  const detailsChanged = fullName.trim() !== admin.fullName || phone.trim() !== (admin.phone ?? '')

  return (
    <>
      <AdminModal
        open={!pending}
        onClose={onClose}
        title={admin.fullName}
        description={admin.email}
        size="lg"
        footer={<Button onClick={onClose}>Close</Button>}
      >
        <div className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <KeyValueList
            items={[
              { label: 'Role', value: <Badge tone={ROLE_TONE[admin.role] ?? 'neutral'}>{ADMIN_ROLE_LABELS[admin.role] ?? admin.role}</Badge> },
              { label: 'Status', value: <Badge tone={state.tone} dot>{state.label}</Badge> },
              { label: 'Two-factor', value: <Badge tone={tf.tone}>{tf.label}</Badge> },
              { label: 'Last sign-in', value: admin.lastLoginAt ? `${fmtDateTime(admin.lastLoginAt)}${admin.lastLoginIp ? ` · ${admin.lastLoginIp}` : ''}` : 'Never' },
              { label: 'Active sessions', value: admin.activeSessions },
              { label: 'Failed sign-in attempts', value: admin.failedLoginAttempts },
              ...(admin.deactivatedAt ? [{ label: 'Deactivated', value: fmtDateTime(admin.deactivatedAt) }] : []),
              { label: 'Added', value: fmtDateTime(admin.createdAt) },
            ]}
          />

          {!canManage && <Alert tone="info">Only owners can change platform admins.</Alert>}

          {canManage && (
          <section className="space-y-3">
            <h3 className="text-[14px] font-semibold text-adm-fg">Role</h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Platform role" htmlFor="ma-role" hint={ADMIN_ROLE_DESCRIPTIONS[role]} className="flex-1">
                <Select id="ma-role" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
                  {ADMIN_ROLES.map((r) => <option key={r} value={r} disabled={lastOwner && r !== 'owner'}>{ADMIN_ROLE_LABELS[r]}</option>)}
                </Select>
              </Field>
              <Button size="sm" disabled={role === admin.role} loading={busy && !pending}
                onClick={() => run({ action: 'change_role', role }, `${admin.fullName} is now ${ADMIN_ROLE_LABELS[role]}.`)}>
                Change role
              </Button>
            </div>
            {lastOwner && <p className="text-[12.5px] text-adm-subtle">This is the last active owner. Make another admin an owner before changing this role.</p>}
          </section>
          )}

          {canManage && (
          <section className="space-y-3">
            <h3 className="text-[14px] font-semibold text-adm-fg">Details</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Full name" htmlFor="ma-name">
                <Input id="ma-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="ma-phone">
                <Input id="ma-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <Button size="sm" disabled={!detailsChanged || fullName.trim().length < 2} loading={busy && !pending}
              onClick={() => run({ action: 'update', fullName: fullName.trim(), phone: phone.trim() }, `${fullName.trim()}: details saved.`)}>
              Save details
            </Button>
          </section>
          )}

          {canManage && (
          <section className="space-y-3">
            <h3 className="text-[14px] font-semibold text-adm-fg">Access</h3>
            <div className="flex flex-wrap gap-2">
              {admin.isActive ? (
                <Button variant="danger-soft" size="sm" disabled={isSelf || lastActive || lastOwner} onClick={() => setPending('deactivate')}>Deactivate</Button>
              ) : (
                <Button size="sm" onClick={() => setPending('reactivate')}>Reactivate</Button>
              )}
              <Button size="sm" disabled={isSelf} onClick={() => setPending('reset_password')}>Reset password</Button>
              {admin.totpRequired ? (
                <Button size="sm" onClick={() => setPending('waive_2fa')}>Make two-factor optional</Button>
              ) : (
                <Button size="sm" onClick={() => setPending('require_2fa')}>Require two-factor</Button>
              )}
              {admin.totpEnabled && <Button size="sm" disabled={isSelf} onClick={() => setPending('reset_2fa')}>Remove authenticator app</Button>}
            </div>
            {isSelf && <p className="text-[12.5px] text-adm-subtle">You cannot deactivate yourself or reset your own password here — use Settings → Security.</p>}
            {!isSelf && lastActive && <p className="text-[12.5px] text-adm-subtle">This is the last active admin, so it cannot be deactivated.</p>}
            {!isSelf && !lastActive && lastOwner && <p className="text-[12.5px] text-adm-subtle">This is the last active owner, so it cannot be deactivated.</p>}
          </section>
          )}
        </div>
      </AdminModal>

      {pending && (
        <ConfirmDialog
          open
          onCancel={() => setPending(null)}
          onConfirm={() => run(
            pending === 'deactivate' ? { action: pending, reason: reason.trim() || undefined }
              : pending === 'reset_password' ? { action: pending, sendEmail }
                : { action: pending },
            `${admin.fullName}: ${ACTION_COPY[pending].done}.`,
          )}
          title={ACTION_COPY[pending].title}
          description={ACTION_COPY[pending].body}
          confirmLabel={ACTION_COPY[pending].confirm}
          confirmVariant={ACTION_COPY[pending].danger ? 'danger' : 'primary'}
          loading={busy}
        >
          {pending === 'deactivate' && (
            <Field label="Reason" htmlFor="ma-reason" hint="Optional. Recorded in the audit log.">
              <Textarea id="ma-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {pending === 'reset_password' && (
            <Checkbox label="Email the new temporary password" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          )}
        </ConfirmDialog>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ customer accounts */

function AccountsTab() {
  const [data, setData] = useState<{ accounts: CustomerAccount[]; pagination: { total: number } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<CustomerAccount | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const canManageAccounts = useAdminCan('vendors.manage')

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])
  useEffect(() => { setPage(1) }, [debouncedQ, status])

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedQ) p.set('q', debouncedQ)
    if (status) p.set('status', status)
    return p.toString()
  }, [debouncedQ, status, page])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminFetch(`/api/sys-control/users?${params}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load accounts')
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])

  async function toggle() {
    if (!target) return
    setBusy(true)
    try {
      await adminFetch(`/api/sys-control/users/${target.id}`, {
        method: 'PUT',
        json: { isActive: !target.isActive, deactivationReason: target.isActive ? reason.trim() || undefined : undefined },
      })
      setFlash({ tone: 'success', text: `${target.fullName} ${target.isActive ? 'deactivated' : 'reactivated'}.` })
      setTarget(null)
      load()
    } catch (e) {
      setFlash({ tone: 'danger', text: e instanceof Error ? e.message : 'Update failed' })
      setTarget(null)
    } finally {
      setBusy(false)
    }
  }

  const columns: AdminColumn<CustomerAccount>[] = [
    {
      key: 'name',
      header: 'Account',
      primary: true,
      cell: (a) => (
        <div className="min-w-0">
          <p className="font-medium text-adm-fg">{a.fullName}</p>
          <p className="truncate text-[12.5px] text-adm-subtle">{a.email}</p>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', hideBelow: 'xl', cell: (a) => <span className="text-adm-muted">{a.phone || '—'}</span> },
    { key: 'companies', header: 'Businesses', align: 'right', hideBelow: 'md', cell: (a) => <span className="adm-num">{a.companies}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (a) => (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={a.isActive ? 'success' : 'neutral'} dot>{a.isActive ? 'Active' : 'Deactivated'}</Badge>
          {!a.emailVerified && <Badge tone="warning">Email not verified</Badge>}
        </div>
      ),
    },
    { key: 'login', header: 'Last sign-in', hideBelow: 'lg', cell: (a) => <span className="text-adm-muted">{a.lastLoginAt ? timeAgo(a.lastLoginAt) : 'Never'}</span> },
    { key: 'joined', header: 'Joined', hideBelow: 'xl', cell: (a) => <span className="text-adm-muted">{fmtDate(a.createdAt)}</span> },
    ...(canManageAccounts ? [{
      key: 'act',
      header: <span className="sr-only">Actions</span>,
      align: 'right' as const,
      mobileLabel: 'Action',
      cell: (a: CustomerAccount) => (
        <Button size="sm" variant={a.isActive ? 'danger-soft' : 'secondary'} onClick={(e) => { e.stopPropagation(); setReason(''); setTarget(a) }}>
          {a.isActive ? 'Deactivate' : 'Reactivate'}
        </Button>
      ),
    }] : []),
  ]

  const filtersActive = !!(debouncedQ || status)

  return (
    <div className="space-y-5">
      {flash && <Alert tone={flash.tone} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash.text}</Alert>}
      <AdminCard flush>
        <div className="border-b border-adm-border p-4 sm:p-5">
          <AdminToolbar end={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>}>
            <SearchInput size="sm" wrapperClassName="w-full sm:w-80" placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
            <Select size="sm" className="w-full min-[480px]:w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </Select>
          </AdminToolbar>
        </div>
        {error ? (
          <div className="p-4 sm:p-5">
            <Alert tone="danger" title="Could not load accounts" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
          </div>
        ) : (
          <AdminTable
            columns={columns}
            rows={data?.accounts ?? []}
            rowKey={(a) => a.id}
            loading={loading}
            minWidth={720}
            empty={
              <EmptyState
                icon={Users}
                title={filtersActive ? 'No accounts match these filters' : 'No customer accounts yet'}
                action={filtersActive ? <Button size="sm" onClick={() => { setQ(''); setStatus('') }}>Clear filters</Button> : undefined}
              />
            }
          />
        )}
        {data && data.pagination.total > 0 && (
          <div className="border-t border-adm-border px-4 py-3 sm:px-5">
            <Pager page={page} pageSize={PAGE_SIZE} total={data.pagination.total} onPage={setPage} />
          </div>
        )}
      </AdminCard>

      {target && (
        <ConfirmDialog
          open
          onCancel={() => setTarget(null)}
          onConfirm={toggle}
          loading={busy}
          title={target.isActive ? `Deactivate ${target.fullName}?` : `Reactivate ${target.fullName}?`}
          description={target.isActive
            ? 'They can no longer sign in to the account portal or any business they belong to.'
            : 'They can sign in again with their existing password.'}
          confirmLabel={target.isActive ? 'Deactivate' : 'Reactivate'}
          confirmVariant={target.isActive ? 'danger' : 'primary'}
        >
          {target.isActive && (
            <Field label="Reason" htmlFor="acc-reason" hint="Optional. Recorded in the audit log.">
              <Textarea id="acc-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}

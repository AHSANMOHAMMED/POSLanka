'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Tag } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminTable,
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
  fmtLKR,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { CopyButton, adminFetch, fmtDate } from '@/components/admin/console-helpers'

interface Coupon {
  id: string
  code: string
  description: string | null
  discountType: 'percentage' | 'fixed_amount' | string
  discountValue: string
  applicableTiers: string[] | null
  minBillingCycle: string | null
  maxUses: number | null
  usedCount: number
  maxUsesPerAccount: number
  validFrom: string | null
  validUntil: string | null
  isActive: boolean
}

interface FormState {
  code: string
  description: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  maxUses: string
  maxUsesPerAccount: string
  validFrom: string
  validUntil: string
  applicableTiers: string[]
  minBillingCycle: string
}

const EMPTY: FormState = {
  code: '', description: '', discountType: 'percentage', discountValue: '', maxUses: '', maxUsesPerAccount: '1',
  validFrom: '', validUntil: '', applicableTiers: [], minBillingCycle: '',
}

function couponState(c: Coupon): { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' } {
  if (!c.isActive) return { label: 'Off', tone: 'neutral' }
  if (c.validUntil && new Date(c.validUntil) < new Date()) return { label: 'Expired', tone: 'danger' }
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return { label: 'Used up', tone: 'warning' }
  if (c.validFrom && new Date(c.validFrom) > new Date()) return { label: 'Scheduled', tone: 'warning' }
  return { label: 'Active', tone: 'success' }
}

/** Coupon codes vendors enter at checkout (/api/sys-control/coupons). */
export function CouponsCard({ tiers }: { tiers: Array<{ id: string; displayName: string; isActive: boolean }> }) {
  const canBill = useAdminCan('billing')
  const [coupons, setCoupons] = useState<Coupon[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Coupon | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setCoupons(await adminFetch<Coupon[]>('/api/sys-control/coupons'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load coupons')
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function toggle(c: Coupon) {
    setBusy(c.id)
    try {
      await adminFetch(`/api/sys-control/coupons/${c.id}`, { method: 'PUT', json: { isActive: !c.isActive } })
      setFlash({ tone: 'success', text: `${c.code} turned ${c.isActive ? 'off' : 'on'}.` })
      load()
    } catch (e) {
      setFlash({ tone: 'danger', text: e instanceof Error ? e.message : 'Update failed' })
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!deleting) return
    setBusy(deleting.id)
    try {
      await adminFetch(`/api/sys-control/coupons/${deleting.id}`, { method: 'DELETE' })
      setFlash({ tone: 'success', text: `${deleting.code} deleted.` })
      setDeleting(null)
      load()
    } catch (e) {
      setFlash({ tone: 'danger', text: e instanceof Error ? e.message : 'Delete failed' })
      setDeleting(null)
    } finally {
      setBusy(null)
    }
  }

  const tierName = (id: string) => tiers.find((t) => t.id === id)?.displayName ?? 'plan'

  const columns: AdminColumn<Coupon>[] = [
    {
      key: 'code',
      header: 'Code',
      primary: true,
      cell: (c) => (
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1">
            <span className="font-mono font-semibold text-adm-fg">{c.code}</span>
            <CopyButton text={c.code} label="Copy code" />
          </span>
          {c.description && <p className="truncate text-[12.5px] text-adm-subtle">{c.description}</p>}
        </div>
      ),
    },
    {
      key: 'discount',
      header: 'Discount',
      cell: (c) => <span className="adm-num text-adm-fg">{c.discountType === 'percentage' ? `${Number(c.discountValue)}%` : fmtLKR(Number(c.discountValue))}</span>,
    },
    {
      key: 'uses',
      header: 'Used',
      align: 'right',
      hideBelow: 'md',
      cell: (c) => <span className="adm-num">{c.usedCount}{c.maxUses !== null ? <span className="text-adm-subtle"> / {c.maxUses}</span> : null}</span>,
    },
    {
      key: 'valid',
      header: 'Valid',
      hideBelow: 'lg',
      cell: (c) => <span className="text-adm-muted">{c.validFrom || c.validUntil ? `${c.validFrom ? fmtDate(c.validFrom) : 'now'} – ${c.validUntil ? fmtDate(c.validUntil) : 'no end'}` : 'Always'}</span>,
    },
    {
      key: 'plans',
      header: 'Plans',
      hideBelow: 'xl',
      cell: (c) => <span className="text-adm-muted">{c.applicableTiers?.length ? c.applicableTiers.map(tierName).join(', ') : 'All'}</span>,
    },
    { key: 'state', header: 'Status', cell: (c) => { const s = couponState(c); return <Badge tone={s.tone} dot>{s.label}</Badge> } },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      mobileLabel: 'Actions',
      cell: (c) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" disabled={!canBill} onClick={() => setEditing(c)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={!canBill} loading={busy === c.id} onClick={() => toggle(c)}>{c.isActive ? 'Turn off' : 'Turn on'}</Button>
          <Button size="sm" variant="danger-soft" onClick={() => setDeleting(c)} disabled={!canBill || c.usedCount > 0} title={c.usedCount > 0 ? 'Used coupons can only be turned off' : undefined}>Delete</Button>
        </div>
      ),
    },
  ]

  return (
    <AdminCard
      flush
      title="Coupon codes"
      description="Codes vendors enter at checkout for a discount on their subscription."
      icon={<Tag size={17} />}
      actions={canBill ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing('new')}>New coupon</Button> : undefined}
    >
      {flash && <div className="px-4 pt-4 sm:px-5"><Alert tone={flash.tone} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash.text}</Alert></div>}
      {error ? (
        <div className="p-4 sm:p-5"><Alert tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert></div>
      ) : (
        <AdminTable
          columns={columns}
          rows={coupons ?? []}
          rowKey={(c) => c.id}
          loading={coupons === null}
          minWidth={760}
          empty={<EmptyState icon={Tag} title="No coupons yet" description="Create a code to offer a discount at checkout." />}
        />
      )}

      {editing && (
        <CouponDialog
          coupon={editing === 'new' ? null : editing}
          tiers={tiers}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setFlash({ tone: 'success', text: msg }); load() }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
          loading={busy === deleting.id}
          title={`Delete ${deleting.code}?`}
          description="Vendors can no longer use this code. This cannot be undone."
          confirmLabel="Delete"
          confirmVariant="danger"
        />
      )}
    </AdminCard>
  )
}

function CouponDialog({ coupon, tiers, onClose, onSaved }: {
  coupon: Coupon | null
  tiers: Array<{ id: string; displayName: string; isActive: boolean }>
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [f, setF] = useState<FormState>(() => coupon ? {
    code: coupon.code,
    description: coupon.description ?? '',
    discountType: coupon.discountType === 'fixed_amount' ? 'fixed_amount' : 'percentage',
    discountValue: String(Number(coupon.discountValue)),
    maxUses: coupon.maxUses !== null ? String(coupon.maxUses) : '',
    maxUsesPerAccount: String(coupon.maxUsesPerAccount),
    validFrom: coupon.validFrom ? coupon.validFrom.slice(0, 10) : '',
    validUntil: coupon.validUntil ? coupon.validUntil.slice(0, 10) : '',
    applicableTiers: coupon.applicableTiers ?? [],
    minBillingCycle: coupon.minBillingCycle ?? '',
  } : EMPTY)
  const [active, setActive] = useState(coupon?.isActive ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))

  const value = Number(f.discountValue)
  const errs: Partial<Record<keyof FormState, string>> = {}
  if (!/^[A-Za-z0-9_-]{3,50}$/.test(f.code.trim())) errs.code = 'Use 3–50 letters, digits, - or _'
  if (!(value > 0)) errs.discountValue = 'Enter a value above 0'
  else if (f.discountType === 'percentage' && value > 100) errs.discountValue = 'At most 100%'
  if (f.maxUses && !(Number.isInteger(Number(f.maxUses)) && Number(f.maxUses) >= 1)) errs.maxUses = 'A whole number of 1 or more'
  if (!(Number.isInteger(Number(f.maxUsesPerAccount)) && Number(f.maxUsesPerAccount) >= 1)) errs.maxUsesPerAccount = 'A whole number of 1 or more'
  if (f.validFrom && f.validUntil && f.validUntil < f.validFrom) errs.validUntil = 'Ends before it starts'
  const ok = Object.keys(errs).length === 0

  async function submit() {
    setBusy(true)
    setError(null)
    const body = {
      code: f.code.trim().toUpperCase(),
      description: f.description.trim() || undefined,
      discountType: f.discountType,
      discountValue: value,
      maxUses: f.maxUses ? Number(f.maxUses) : undefined,
      maxUsesPerAccount: Number(f.maxUsesPerAccount),
      validFrom: f.validFrom ? new Date(`${f.validFrom}T00:00:00`).toISOString() : coupon ? '' : undefined,
      validUntil: f.validUntil ? new Date(`${f.validUntil}T23:59:59`).toISOString() : coupon ? '' : undefined,
      applicableTiers: f.applicableTiers,
      minBillingCycle: f.minBillingCycle || undefined,
      isActive: active,
    }
    try {
      if (coupon) await adminFetch(`/api/sys-control/coupons/${coupon.id}`, { method: 'PUT', json: body })
      else await adminFetch('/api/sys-control/coupons', { method: 'POST', json: body })
      onSaved(`${body.code} ${coupon ? 'saved' : 'created'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the coupon')
      setBusy(false)
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      title={coupon ? `Edit ${coupon.code}` : 'New coupon'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={submit}>{coupon ? 'Save' : 'Create coupon'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="cp-code" required error={f.code ? errs.code : undefined}>
            <Input id="cp-code" className="font-mono uppercase" value={f.code} invalid={!!f.code && !!errs.code} onChange={(e) => set('code', e.target.value)} placeholder="AVURUDU25" />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
            <Field label="Discount" htmlFor="cp-type">
              <Select id="cp-type" value={f.discountType} onChange={(e) => set('discountType', e.target.value as FormState['discountType'])}>
                <option value="percentage">Percentage</option>
                <option value="fixed_amount">Fixed amount (LKR)</option>
              </Select>
            </Field>
            <Field label={f.discountType === 'percentage' ? '%' : 'LKR'} htmlFor="cp-val" required error={f.discountValue ? errs.discountValue : undefined}>
              <Input id="cp-val" type="number" inputMode="decimal" min={0} value={f.discountValue} onChange={(e) => set('discountValue', e.target.value)} />
            </Field>
          </div>
          <Field label="Total uses" htmlFor="cp-max" hint="Empty = unlimited" error={errs.maxUses}>
            <Input id="cp-max" type="number" inputMode="numeric" min={1} value={f.maxUses} onChange={(e) => set('maxUses', e.target.value)} />
          </Field>
          <Field label="Uses per account" htmlFor="cp-per" error={errs.maxUsesPerAccount}>
            <Input id="cp-per" type="number" inputMode="numeric" min={1} value={f.maxUsesPerAccount} onChange={(e) => set('maxUsesPerAccount', e.target.value)} />
          </Field>
          <Field label="Starts" htmlFor="cp-from" hint="Empty = immediately">
            <Input id="cp-from" type="date" value={f.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
          </Field>
          <Field label="Ends" htmlFor="cp-until" hint="Empty = no end date" error={errs.validUntil}>
            <Input id="cp-until" type="date" value={f.validUntil} min={f.validFrom || undefined} onChange={(e) => set('validUntil', e.target.value)} />
          </Field>
          <Field label="Billing cycle" htmlFor="cp-cycle">
            <Select id="cp-cycle" value={f.minBillingCycle} onChange={(e) => set('minBillingCycle', e.target.value)}>
              <option value="">Monthly or yearly</option>
              <option value="annual">Yearly only</option>
            </Select>
          </Field>
          <Field label="Description" htmlFor="cp-desc" hint="Internal note, optional">
            <Textarea id="cp-desc" rows={1} maxLength={500} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <Field label="Plans" hint={f.applicableTiers.length ? undefined : 'None ticked: valid for every plan.'}>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {tiers.filter((t) => t.isActive).map((t) => (
              <Checkbox key={t.id} label={t.displayName} checked={f.applicableTiers.includes(t.id)}
                onChange={() => set('applicableTiers', f.applicableTiers.includes(t.id) ? f.applicableTiers.filter((x) => x !== t.id) : [...f.applicableTiers, t.id])} />
            ))}
          </div>
        </Field>
        <Switch checked={active} onChange={setActive} label="Coupon is on" description="Turned-off codes are refused at checkout." />
      </div>
    </AdminModal>
  )
}

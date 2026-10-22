'use client'

import { useCallback, useEffect, useState } from 'react'
import { Layers, Pencil, Plus, RefreshCw, Ticket, Trash2 } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
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
  Textarea,
  fmtLKR,
  fmtNumber,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { adminFetch, fmtBytes, fmtDate } from '@/components/admin/console-helpers'

interface Tier {
  id: string
  name: string
  displayName: string
  priceMonthly: string | null
  priceYearly: string | null
  currency: string
  maxUsers: number | null
  maxSalesMonthly: number | null
  maxDatabaseBytes: number | null
  maxFileStorageBytes: number | null
  features: Record<string, unknown> | null
  isActive: boolean
  sortOrder: number
  subscriberCount: number
}

interface Coupon {
  id: string
  code: string
  description: string | null
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  applicableTiers: string[] | null
  maxUses: number | null
  usedCount: number
  maxUsesPerAccount: number
  validFrom: string | null
  validUntil: string | null
  isActive: boolean
}

const GB = 1024 ** 3
const toGb = (b: number | null) => (b == null ? '' : String(+(b / GB).toFixed(2)))
const fromGb = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * GB))
const intOrNull = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)))

export default function PricingPage() {
  const canBill = useAdminCan('billing')
  const [tiers, setTiers] = useState<Tier[] | null>(null)
  const [coupons, setCoupons] = useState<Coupon[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)
  const [editingTier, setEditingTier] = useState<Tier | 'new' | null>(null)
  const [retiring, setRetiring] = useState<Tier | null>(null)
  const [editingCoupon, setEditingCoupon] = useState<Coupon | 'new' | null>(null)
  const [deletingCoupon, setDeletingCoupon] = useState<Coupon | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [t, c] = await Promise.all([
        adminFetch<Tier[]>('/api/sys-control/pricing-tiers'),
        adminFetch<Coupon[]>('/api/sys-control/coupons'),
      ])
      setTiers(t)
      setCoupons(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load plans')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function setTierActive(tier: Tier, isActive: boolean) {
    setBusy(true)
    try {
      if (isActive) await adminFetch(`/api/sys-control/pricing-tiers/${tier.id}`, { method: 'PUT', json: { isActive: true } })
      else await adminFetch(`/api/sys-control/pricing-tiers/${tier.id}`, { method: 'DELETE' })
      setFlash({ tone: 'success', text: isActive ? `${tier.displayName} is offered again.` : `${tier.displayName} is retired. Existing subscribers keep it.` })
      setRetiring(null)
      load()
    } catch (e) {
      setFlash({ tone: 'warning', text: e instanceof Error ? e.message : 'Update failed' })
    } finally {
      setBusy(false)
    }
  }

  async function deleteCoupon(c: Coupon) {
    setBusy(true)
    try {
      const res = await adminFetch<{ deactivated: boolean }>(`/api/sys-control/coupons/${c.id}`, { method: 'DELETE' })
      setFlash({ tone: 'success', text: res.deactivated ? `${c.code} has been used, so it was deactivated instead of deleted.` : `${c.code} deleted.` })
      setDeletingCoupon(null)
      load()
    } catch (e) {
      setFlash({ tone: 'warning', text: e instanceof Error ? e.message : 'Delete failed' })
    } finally {
      setBusy(false)
    }
  }

  const tierColumns: AdminColumn<Tier>[] = [
    {
      key: 'plan',
      header: 'Plan',
      primary: true,
      cell: (t) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-adm-fg">{t.displayName}</span>
            {!t.isActive && <Badge>Retired</Badge>}
          </div>
          <p className="text-[12.5px] text-adm-subtle">{t.name}</p>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      cell: (t) => Number(t.priceMonthly ?? 0) === 0 && Number(t.priceYearly ?? 0) === 0 ? (
        <span className="text-adm-fg">Free</span>
      ) : (
        <div className="adm-num">
          <p className="text-adm-fg">{fmtLKR(Number(t.priceMonthly))} <span className="text-[12px] text-adm-subtle">/ month</span></p>
          <p className="text-[12.5px] text-adm-subtle">{fmtLKR(Number(t.priceYearly))} / year</p>
        </div>
      ),
    },
    { key: 'users', header: 'Users', hideBelow: 'md', cell: (t) => (t.maxUsers ? fmtNumber(t.maxUsers) : 'Unlimited') },
    {
      key: 'storage',
      header: 'Storage',
      hideBelow: 'lg',
      cell: (t) => (
        <span className="text-adm-muted">
          {t.maxDatabaseBytes ? fmtBytes(t.maxDatabaseBytes) : 'No limit'} data · {t.maxFileStorageBytes ? fmtBytes(t.maxFileStorageBytes) : 'no limit'} files
        </span>
      ),
    },
    { key: 'subs', header: 'Subscribers', align: 'right', cell: (t) => <span className="adm-num">{fmtNumber(t.subscriberCount)}</span> },
    ...(!canBill ? [] : [{
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right' as const,
      mobileLabel: 'Actions',
      cell: (t: Tier) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditingTier(t)}>Edit</Button>
          {t.isActive ? (
            <Button size="sm" variant="ghost" onClick={() => setRetiring(t)} disabled={t.name === 'trial'}>Retire</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setTierActive(t, true)} disabled={busy}>Restore</Button>
          )}
        </div>
      ),
    }]),
  ]

  const couponColumns: AdminColumn<Coupon>[] = [
    {
      key: 'code',
      header: 'Code',
      primary: true,
      cell: (c) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="adm-num font-semibold text-adm-fg">{c.code}</span>
            <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
          </div>
          {c.description && <p className="truncate text-[12.5px] text-adm-subtle">{c.description}</p>}
        </div>
      ),
    },
    { key: 'discount', header: 'Discount', cell: (c) => (c.discountType === 'percentage' ? `${Number(c.discountValue)}%` : fmtLKR(Number(c.discountValue))) },
    { key: 'valid', header: 'Valid', hideBelow: 'md', cell: (c) => <span className="text-adm-muted">{c.validFrom || c.validUntil ? `${c.validFrom ? fmtDate(c.validFrom) : 'Now'} – ${c.validUntil ? fmtDate(c.validUntil) : 'no end'}` : 'Always'}</span> },
    { key: 'uses', header: 'Used', align: 'right', cell: (c) => <span className="adm-num">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ''}</span> },
    ...(!canBill ? [] : [{
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right' as const,
      mobileLabel: 'Actions',
      cell: (c: Coupon) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditingCoupon(c)}>Edit</Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setDeletingCoupon(c)} aria-label={`Delete ${c.code}`}><Trash2 size={14} aria-hidden /></Button>
        </div>
      ),
    }]),
  ]

  return (
    <AdminPage
      title="Plans & pricing"
      description="The plans vendors can subscribe to, their prices and limits, and promotional codes."
      actions={
        <>
          <Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading && !!tiers}>Refresh</Button>
          {canBill && <Button variant="primary" icon={Plus} onClick={() => setEditingTier('new')}>New plan</Button>}
        </>
      }
    >
      {flash && <Alert tone={flash.tone} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash.text}</Alert>}
      {error && <Alert tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>}

      <AdminCard
        title="Plans"
        description="Price changes apply to new sign-ups and plan changes. Current subscribers keep the price they signed up at; their billing period is not changed."
        icon={<Layers size={17} />}
        flush
      >
        <AdminTable
          columns={tierColumns}
          rows={tiers ?? []}
          rowKey={(t) => t.id}
          loading={loading}
          minWidth={760}
          rowClassName={(t) => (t.isActive ? undefined : 'opacity-70')}
          empty={<EmptyState icon={Layers} title="No plans yet" action={canBill ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditingTier('new')}>New plan</Button> : undefined} />}
        />
      </AdminCard>

      <AdminCard
        title="Promo codes"
        description="Discount codes vendors enter when they pay for a plan (card, wallet or bank transfer). A use is counted when the payment succeeds or the slip is approved."
        icon={<Ticket size={17} />}
        actions={canBill ? <Button size="sm" icon={Plus} onClick={() => setEditingCoupon('new')}>New code</Button> : undefined}
        flush
      >
        <AdminTable
          columns={couponColumns}
          rows={coupons ?? []}
          rowKey={(c) => c.id}
          loading={loading}
          minWidth={620}
          empty={<EmptyState icon={Ticket} title="No promo codes" compact />}
        />
      </AdminCard>

      {editingTier && (
        <TierDialog
          tier={editingTier === 'new' ? null : editingTier}
          onClose={() => setEditingTier(null)}
          onSaved={(text) => { setEditingTier(null); setFlash({ tone: 'success', text }); load() }}
        />
      )}
      {editingCoupon && tiers && (
        <CouponDialog
          coupon={editingCoupon === 'new' ? null : editingCoupon}
          tiers={tiers}
          onClose={() => setEditingCoupon(null)}
          onSaved={(text) => { setEditingCoupon(null); setFlash({ tone: 'success', text }); load() }}
        />
      )}
      <ConfirmDialog
        open={!!retiring}
        onCancel={() => setRetiring(null)}
        onConfirm={() => retiring && setTierActive(retiring, false)}
        loading={busy}
        title={`Retire ${retiring?.displayName ?? ''}?`}
        description="It is no longer offered to new sign-ups or plan changes. The vendors on it keep it until they change plan."
        confirmLabel="Retire plan"
        confirmVariant="danger"
      >
        {retiring && retiring.subscriberCount > 0 && (
          <p className="text-[13.5px] text-adm-muted">{fmtNumber(retiring.subscriberCount)} vendor{retiring.subscriberCount === 1 ? ' is' : 's are'} on this plan.</p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!deletingCoupon}
        onCancel={() => setDeletingCoupon(null)}
        onConfirm={() => deletingCoupon && deleteCoupon(deletingCoupon)}
        loading={busy}
        title={`Delete ${deletingCoupon?.code ?? ''}?`}
        description={deletingCoupon && deletingCoupon.usedCount > 0 ? 'This code has been used, so it will be deactivated and kept for the record.' : 'The code is removed permanently.'}
        confirmLabel={deletingCoupon && deletingCoupon.usedCount > 0 ? 'Deactivate' : 'Delete'}
        confirmVariant="danger"
      />
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ tier dialog */

function TierDialog({ tier, onClose, onSaved }: { tier: Tier | null; onClose: () => void; onSaved: (text: string) => void }) {
  const f = (tier?.features ?? {}) as Record<string, unknown>
  const [name, setName] = useState(tier?.name ?? '')
  const [displayName, setDisplayName] = useState(tier?.displayName ?? '')
  const [priceMonthly, setPriceMonthly] = useState(tier?.priceMonthly != null ? String(Number(tier.priceMonthly)) : '')
  const [priceYearly, setPriceYearly] = useState(tier?.priceYearly != null ? String(Number(tier.priceYearly)) : '')
  const [maxUsers, setMaxUsers] = useState(tier?.maxUsers != null ? String(tier.maxUsers) : '')
  const [maxSales, setMaxSales] = useState(tier?.maxSalesMonthly != null ? String(tier.maxSalesMonthly) : '')
  const [dbGb, setDbGb] = useState(toGb(tier?.maxDatabaseBytes ?? null))
  const [fileGb, setFileGb] = useState(toGb(tier?.maxFileStorageBytes ?? null))
  const [sortOrder, setSortOrder] = useState(String(tier?.sortOrder ?? 0))
  const [locations, setLocations] = useState(typeof f.locations === 'number' && f.locations > 0 ? String(f.locations) : '')
  const [supportType, setSupportType] = useState(typeof f.supportType === 'string' ? f.supportType : 'email')
  const [advancedReports, setAdvancedReports] = useState(!!f.advancedReports)
  const [customReports, setCustomReports] = useState(!!f.customReports)
  const [apiAccess, setApiAccess] = useState(!!f.apiAccess)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const num = (v: string) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0)
  const valid =
    displayName.trim().length > 0 &&
    (tier || /^[a-z0-9_-]{2,50}$/.test(name)) &&
    [priceMonthly, priceYearly, maxUsers, maxSales, dbGb, fileGb, sortOrder, locations].every(num) &&
    priceMonthly.trim() !== ''
  const priceChanged = tier && (Number(priceMonthly) !== Number(tier.priceMonthly) || Number(priceYearly || 0) !== Number(tier.priceYearly || 0))

  async function save() {
    setBusy(true)
    setError(null)
    const features = {
      ...f,
      locations: locations.trim() === '' ? -1 : Number(locations),
      supportType,
      advancedReports,
      customReports,
      apiAccess,
    }
    const body: Record<string, unknown> = {
      displayName: displayName.trim(),
      priceMonthly: Number(priceMonthly),
      priceYearly: priceYearly.trim() === '' ? undefined : Number(priceYearly),
      maxUsers: intOrNull(maxUsers),
      maxSalesMonthly: intOrNull(maxSales),
      maxDatabaseBytes: fromGb(dbGb),
      maxFileStorageBytes: fromGb(fileGb),
      sortOrder: Number(sortOrder || 0),
      features,
    }
    try {
      if (tier) {
        const res = await adminFetch<{ grandfatheredCount: number }>(`/api/sys-control/pricing-tiers/${tier.id}`, { method: 'PUT', json: body })
        onSaved(
          res.grandfatheredCount > 0
            ? `${displayName} saved. ${res.grandfatheredCount} current subscriber${res.grandfatheredCount === 1 ? ' keeps' : 's keep'} the previous price.`
            : `${displayName} saved.`
        )
      } else {
        // Create rejects nulls: leave unlimited limits out
        for (const k of ['maxUsers', 'maxSalesMonthly', 'maxDatabaseBytes', 'maxFileStorageBytes']) if (body[k] === null) delete body[k]
        await adminFetch('/api/sys-control/pricing-tiers', { method: 'POST', json: { ...body, name } })
        onSaved(`${displayName} created.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the plan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      size="lg"
      title={tier ? `Edit ${tier.displayName}` : 'New plan'}
      description="Leave a limit empty for unlimited."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!valid}>{tier ? 'Save plan' : 'Create plan'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {priceChanged && tier!.subscriberCount > 0 && (
          <Alert tone="info">The {fmtNumber(tier!.subscriberCount)} current subscriber{tier!.subscriberCount === 1 ? '' : 's'} keep their existing price. The new price applies to new sign-ups and plan changes.</Alert>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="t-display" required>
            <Input id="t-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Professional" />
          </Field>
          <Field label="Internal name" htmlFor="t-name" required={!tier} hint={tier ? 'Cannot be changed.' : 'Lowercase, e.g. professional.'}>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} disabled={!!tier} />
          </Field>
          <Field label="Monthly price (LKR)" htmlFor="t-pm" required>
            <Input id="t-pm" type="number" min={0} step="1" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} />
          </Field>
          <Field label="Yearly price (LKR)" htmlFor="t-py" hint={!tier ? 'Empty = 10 × monthly.' : undefined}>
            <Input id="t-py" type="number" min={0} step="1" value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} />
          </Field>
          <Field label="Max active users" htmlFor="t-users" hint="Enforced when staff are added.">
            <Input id="t-users" type="number" min={1} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="Sales per month" htmlFor="t-sales" hint="Shown on plan pages and usage; not enforced at the till.">
            <Input id="t-sales" type="number" min={1} value={maxSales} onChange={(e) => setMaxSales(e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="Database storage (GB)" htmlFor="t-db">
            <Input id="t-db" type="number" min={0} step="0.1" value={dbGb} onChange={(e) => setDbGb(e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="File storage (GB)" htmlFor="t-files">
            <Input id="t-files" type="number" min={0} step="0.1" value={fileGb} onChange={(e) => setFileGb(e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="Display order" htmlFor="t-sort">
            <Input id="t-sort" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
        </div>
        <fieldset className="space-y-3 rounded-lg border border-adm-border p-4">
          <legend className="px-1 text-[13px] font-medium text-adm-fg">Shown on the plans page</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Locations" htmlFor="t-loc">
              <Input id="t-loc" type="number" min={1} value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="Unlimited" />
            </Field>
            <Field label="Support" htmlFor="t-support">
              <Select id="t-support" value={supportType} onChange={(e) => setSupportType(e.target.value)}>
                <option value="email">Email</option>
                <option value="email_chat">Email + chat</option>
                <option value="phone_chat">Phone + chat</option>
                <option value="dedicated_manager">Dedicated manager</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label="Advanced reports" checked={advancedReports} onChange={(e) => setAdvancedReports(e.target.checked)} />
            <Checkbox label="Custom reports" checked={customReports} onChange={(e) => setCustomReports(e.target.checked)} />
            <Checkbox label="API access" checked={apiAccess} onChange={(e) => setApiAccess(e.target.checked)} />
          </div>
        </fieldset>
      </div>
    </AdminModal>
  )
}

/* ------------------------------------------------------------------ coupon dialog */

function CouponDialog({ coupon, tiers, onClose, onSaved }: { coupon: Coupon | null; tiers: Tier[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [code, setCode] = useState(coupon?.code ?? '')
  const [description, setDescription] = useState(coupon?.description ?? '')
  const [discountType, setDiscountType] = useState<Coupon['discountType']>(coupon?.discountType ?? 'percentage')
  const [discountValue, setDiscountValue] = useState(coupon ? String(Number(coupon.discountValue)) : '')
  const [maxUses, setMaxUses] = useState(coupon?.maxUses != null ? String(coupon.maxUses) : '')
  const [perAccount, setPerAccount] = useState(String(coupon?.maxUsesPerAccount ?? 1))
  const [validFrom, setValidFrom] = useState(coupon?.validFrom ? coupon.validFrom.slice(0, 10) : '')
  const [validUntil, setValidUntil] = useState(coupon?.validUntil ? coupon.validUntil.slice(0, 10) : '')
  const [tierIds, setTierIds] = useState<string[]>(coupon?.applicableTiers ?? [])
  const [isActive, setIsActive] = useState(coupon?.isActive ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = Number(discountValue)
  const valid =
    /^[A-Za-z0-9_-]{3,50}$/.test(code.trim()) &&
    Number.isFinite(value) && value > 0 && (discountType !== 'percentage' || value <= 100) &&
    (maxUses.trim() === '' || Number(maxUses) >= 1) && Number(perAccount) >= 1 &&
    (!validFrom || !validUntil || validFrom <= validUntil)

  async function save() {
    setBusy(true)
    setError(null)
    const body = {
      code: code.trim().toUpperCase(),
      description: description.trim() || (coupon ? null : undefined),
      discountType,
      discountValue: value,
      applicableTiers: tierIds,
      maxUses: maxUses.trim() === '' ? undefined : Number(maxUses),
      maxUsesPerAccount: Number(perAccount),
      validFrom: validFrom ? new Date(`${validFrom}T00:00:00`).toISOString() : '',
      validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : '',
      isActive,
    }
    try {
      if (coupon) await adminFetch(`/api/sys-control/coupons/${coupon.id}`, { method: 'PUT', json: body })
      else await adminFetch('/api/sys-control/coupons', { method: 'POST', json: body })
      onSaved(`${body.code} ${coupon ? 'saved' : 'created'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      size="lg"
      title={coupon ? `Edit ${coupon.code}` : 'New promo code'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!valid}>{coupon ? 'Save code' : 'Create code'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="c-code" required hint="Letters, numbers, - and _.">
            <Input id="c-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AVURUDU25" />
          </Field>
          <Field label="Discount" htmlFor="c-value" required>
            <div className="flex gap-2">
              <Select aria-label="Discount type" className="w-36 shrink-0" value={discountType} onChange={(e) => setDiscountType(e.target.value as Coupon['discountType'])}>
                <option value="percentage">Percent</option>
                <option value="fixed_amount">LKR off</option>
              </Select>
              <Input id="c-value" type="number" min={0} step="1" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
            </div>
          </Field>
          <Field label="Valid from" htmlFor="c-from">
            <Input id="c-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label="Valid until" htmlFor="c-until">
            <Input id="c-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <Field label="Total uses" htmlFor="c-max" hint="Empty = unlimited.">
            <Input id="c-max" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="Uses per account" htmlFor="c-per">
            <Input id="c-per" type="number" min={1} value={perAccount} onChange={(e) => setPerAccount(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="c-desc" className="sm:col-span-2">
            <Textarea id="c-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-adm-fg">Plans (none ticked = all plans)</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {tiers.filter((t) => t.isActive).map((t) => (
              <Checkbox
                key={t.id}
                label={t.displayName}
                checked={tierIds.includes(t.id)}
                onChange={(e) => setTierIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
              />
            ))}
          </div>
        </fieldset>
        <Checkbox label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
      </div>
    </AdminModal>
  )
}

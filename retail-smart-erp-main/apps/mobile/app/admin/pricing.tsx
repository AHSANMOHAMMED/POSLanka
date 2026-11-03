// Pricing tiers (monthly / yearly / lifetime prices) and coupon codes.
// APIs: pricing-tiers (+ /[id]), coupons (+ /[id]). Reads need read; writes need billing.
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, RefreshControl } from 'react-native'
import { adminApi, adminGet, adminPost, adminPut, useAdminUser } from '../../src/lib/adminApi'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Card, ListRow, Pill, SectionTitle, adminStyles } from '../../src/components/admin/AdminShell'
import { Btn, Choice, Field, FormModal, LinkButton, MoreShell, Notice, SwitchRow } from '../../src/components/admin/AdminForm'
import { alertIfFailed, confirmAction, fmtDate, fmtMoney, isDateOnly, parseIntStrict, parseNum, pickList } from '../../src/lib/adminForms'

interface Tier {
  id: string
  name: string
  displayName: string
  priceMonthly?: string | number | null
  priceYearly?: string | number | null
  priceLifetime?: string | number | null
  currency?: string | null
  maxUsers?: number | null
  maxSalesMonthly?: number | null
  sortOrder?: number | null
  isActive: boolean
  subscriberCount?: number
}

interface Coupon {
  id: string
  code: string
  description?: string | null
  discountType: 'percentage' | 'fixed_amount' | string
  discountValue: string | number
  maxUses?: number | null
  usedCount?: number
  maxUsesPerAccount?: number
  validUntil?: string | null
  isActive: boolean
}

interface TierForm {
  id: string | null
  name: string
  displayName: string
  priceMonthly: string
  priceYearly: string
  priceLifetime: string
  maxUsers: string
  sortOrder: string
  isActive: boolean
}

interface CouponForm {
  id: string | null
  code: string
  description: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  maxUses: string
  maxUsesPerAccount: string
  validUntil: string
  isActive: boolean
}

const blankTier = (): TierForm => ({ id: null, name: '', displayName: '', priceMonthly: '', priceYearly: '', priceLifetime: '', maxUsers: '', sortOrder: '0', isActive: true })
const blankCoupon = (): CouponForm => ({ id: null, code: '', description: '', discountType: 'percentage', discountValue: '', maxUses: '', maxUsesPerAccount: '1', validUntil: '', isActive: true })

const money = (v: string | number | null | undefined, cur?: string | null) => (v == null || v === '' ? '—' : Number(v) === 0 ? 'Free' : fmtMoney(v, cur))

export default function AdminPricingScreen() {
  const { can } = useAdminUser()
  const canBill = can('billing')
  const [tiers, setTiers] = useState<Tier[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [tierForm, setTierForm] = useState<TierForm | null>(null)
  const [couponForm, setCouponForm] = useState<CouponForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    setNotice(null)
    const [t, c] = await Promise.all([adminGet<any>('/api/sys-control/pricing-tiers'), adminGet<any>('/api/sys-control/coupons')])
    if (t.ok) setTiers(pickList<Tier>(t.data, 'tiers'))
    if (c.ok) setCoupons(pickList<Coupon>(c.data, 'coupons'))
    if (!t.ok && !c.ok) setError(t.error)
    else if (!t.ok) setNotice(`Plans: ${t.error}`)
    else if (!c.ok) setNotice(`Coupons: ${c.error}`)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function editTier(t: Tier) {
    setFormError(null)
    setTierForm({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      priceMonthly: t.priceMonthly != null ? String(Number(t.priceMonthly)) : '',
      priceYearly: t.priceYearly != null ? String(Number(t.priceYearly)) : '',
      priceLifetime: t.priceLifetime != null ? String(Number(t.priceLifetime)) : '',
      maxUsers: t.maxUsers != null ? String(t.maxUsers) : '',
      sortOrder: String(t.sortOrder ?? 0),
      isActive: t.isActive,
    })
  }

  async function saveTier() {
    if (!tierForm) return
    const f = tierForm
    if (!f.displayName.trim()) return setFormError('Enter a display name.')
    if (!f.id && !/^[a-z0-9_-]{2,40}$/.test(f.name.trim())) return setFormError('The plan key is 2–40 lowercase letters, digits, - or _.')
    const prices: Record<string, number | undefined> = { priceMonthly: parseNum(f.priceMonthly), priceYearly: parseNum(f.priceYearly), priceLifetime: parseNum(f.priceLifetime) }
    for (const [k, v] of Object.entries(prices)) {
      const raw = f[k as keyof TierForm] as string
      if (raw.trim() && (v === undefined || v < 0)) return setFormError(`${k.replace('price', '')} price must be a number of 0 or more.`)
    }
    const maxUsers = f.maxUsers.trim() ? parseIntStrict(f.maxUsers) : null
    if (f.maxUsers.trim() && (maxUsers == null || maxUsers < 1)) return setFormError('Max users must be a whole number of 1 or more (blank = unlimited).')
    const sortOrder = parseIntStrict(f.sortOrder || '0')
    if (sortOrder == null || sortOrder < 0) return setFormError('Sort order must be 0 or more.')

    setBusy(true)
    let res
    if (f.id) {
      res = await adminPut(`/api/sys-control/pricing-tiers/${f.id}`, {
        displayName: f.displayName.trim(),
        ...(prices.priceMonthly !== undefined ? { priceMonthly: prices.priceMonthly } : {}),
        ...(prices.priceYearly !== undefined ? { priceYearly: prices.priceYearly } : {}),
        priceLifetime: prices.priceLifetime ?? null,
        maxUsers,
        sortOrder,
        isActive: f.isActive,
      })
    } else {
      res = await adminPost('/api/sys-control/pricing-tiers', {
        name: f.name.trim(),
        displayName: f.displayName.trim(),
        ...(prices.priceMonthly !== undefined ? { priceMonthly: prices.priceMonthly } : {}),
        ...(prices.priceYearly !== undefined ? { priceYearly: prices.priceYearly } : {}),
        ...(prices.priceLifetime !== undefined ? { priceLifetime: prices.priceLifetime } : {}),
        ...(maxUsers != null ? { maxUsers } : {}),
        sortOrder,
      })
    }
    setBusy(false)
    if (!alertIfFailed(res, 'Could not save plan')) return
    const grand = (res.data as any)?.grandfatheredCount
    setTierForm(null)
    if (grand) setNotice(`Saved. ${grand} existing subscriber(s) keep their old price.`)
    load(true)
  }

  function deactivateTier(t: Tier) {
    confirmAction('Deactivate plan?', `${t.displayName} will no longer be offered to new vendors. Existing subscribers keep it.`, 'Deactivate', async () => {
      const res = await adminApi(`/api/sys-control/pricing-tiers/${t.id}`, { method: 'DELETE' })
      if (alertIfFailed(res, 'Could not deactivate')) load(true)
    }, true)
  }

  function editCoupon(c: Coupon) {
    setFormError(null)
    setCouponForm({
      id: c.id,
      code: c.code,
      description: c.description || '',
      discountType: c.discountType === 'fixed_amount' ? 'fixed_amount' : 'percentage',
      discountValue: String(Number(c.discountValue)),
      maxUses: c.maxUses != null ? String(c.maxUses) : '',
      maxUsesPerAccount: String(c.maxUsesPerAccount ?? 1),
      validUntil: c.validUntil ? c.validUntil.slice(0, 10) : '',
      isActive: c.isActive,
    })
  }

  async function saveCoupon() {
    if (!couponForm) return
    const f = couponForm
    if (!f.code.trim()) return setFormError('Enter the coupon code.')
    const value = parseNum(f.discountValue)
    if (value === undefined || value <= 0) return setFormError('The discount must be greater than 0.')
    if (f.discountType === 'percentage' && value > 100) return setFormError('A percentage discount is at most 100.')
    const maxUses = f.maxUses.trim() ? parseIntStrict(f.maxUses) : undefined
    if (f.maxUses.trim() && (!maxUses || maxUses < 1)) return setFormError('Max uses must be 1 or more (blank = unlimited).')
    const perAccount = parseIntStrict(f.maxUsesPerAccount || '1')
    if (!perAccount || perAccount < 1) return setFormError('Uses per account must be 1 or more.')
    if (f.validUntil.trim() && !isDateOnly(f.validUntil.trim())) return setFormError('Valid until: use YYYY-MM-DD.')

    const body: Record<string, unknown> = {
      code: f.code.trim().toUpperCase(),
      description: f.description.trim() || (f.id ? null : undefined),
      discountType: f.discountType,
      discountValue: value,
      maxUsesPerAccount: perAccount,
      isActive: f.isActive,
    }
    if (maxUses) body.maxUses = maxUses
    if (f.validUntil.trim()) body.validUntil = new Date(`${f.validUntil.trim()}T23:59:59`).toISOString()
    setBusy(true)
    const res = f.id ? await adminPut(`/api/sys-control/coupons/${f.id}`, body) : await adminPost('/api/sys-control/coupons', body)
    setBusy(false)
    if (!alertIfFailed(res, 'Could not save coupon')) return
    setCouponForm(null)
    load(true)
  }

  async function toggleCoupon(c: Coupon) {
    const res = await adminPut(`/api/sys-control/coupons/${c.id}`, { isActive: !c.isActive })
    if (alertIfFailed(res, 'Could not update coupon')) load(true)
  }

  return (
    <MoreShell title="Pricing & coupons" subtitle={`${tiers.length} plans · ${coupons.length} coupons`}>
      {loading ? (
        <LoadingView text="Loading pricing…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <ScrollView
          style={adminStyles.scroll}
          contentContainerStyle={adminStyles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true) }} />}
        >
          {notice ? <Notice tone="warn" text={notice} /> : null}
          {!canBill ? <Notice text="Read-only: editing prices and coupons needs the Billing or Owner role." /> : null}

          <SectionTitle right={canBill ? <LinkButton label="+ New plan" onPress={() => { setFormError(null); setTierForm(blankTier()) }} /> : undefined}>Plans</SectionTitle>
          <Card>
            {tiers.map((t) => (
              <ListRow
                key={t.id}
                title={`${t.displayName}${t.isActive ? '' : ' (inactive)'}`}
                subtitle={`Monthly ${money(t.priceMonthly, t.currency)} · Yearly ${money(t.priceYearly, t.currency)} · Lifetime ${money(t.priceLifetime, t.currency)}\n${t.subscriberCount ?? 0} subscribers${t.maxUsers ? ` · ${t.maxUsers} users` : ''}`}
                right={<Pill text={t.isActive ? 'active' : 'off'} tone={t.isActive ? 'ok' : 'muted'} />}
                onPress={canBill ? () => editTier(t) : undefined}
              />
            ))}
            {tiers.length === 0 ? <Text style={adminStyles.empty}>No plans yet.</Text> : null}
          </Card>

          <SectionTitle right={canBill ? <LinkButton label="+ New coupon" onPress={() => { setFormError(null); setCouponForm(blankCoupon()) }} /> : undefined}>Coupons</SectionTitle>
          <Card>
            {coupons.map((c) => (
              <ListRow
                key={c.id}
                title={c.code}
                subtitle={`${c.discountType === 'fixed_amount' ? fmtMoney(c.discountValue) : `${Number(c.discountValue)}%`} off · used ${c.usedCount ?? 0}${c.maxUses ? `/${c.maxUses}` : ''}${c.validUntil ? ` · until ${fmtDate(c.validUntil)}` : ''}`}
                right={
                  canBill ? (
                    <LinkButton label={c.isActive ? 'Disable' : 'Enable'} tone={c.isActive ? 'danger' : 'primary'} onPress={() => toggleCoupon(c)} />
                  ) : (
                    <Pill text={c.isActive ? 'active' : 'off'} tone={c.isActive ? 'ok' : 'muted'} />
                  )
                }
                onPress={canBill ? () => editCoupon(c) : undefined}
              />
            ))}
            {coupons.length === 0 ? <Text style={adminStyles.empty}>No coupons yet.</Text> : null}
          </Card>
        </ScrollView>
      )}

      <FormModal
        visible={!!tierForm}
        title={tierForm?.id ? 'Edit plan' : 'New plan'}
        confirmLabel={tierForm?.id ? 'Save' : 'Create'}
        busy={busy}
        onCancel={() => setTierForm(null)}
        onConfirm={saveTier}
      >
        {tierForm ? (
          <>
            {!tierForm.id ? <Field label="Plan key *" value={tierForm.name} onChangeText={(v) => setTierForm({ ...tierForm, name: v.toLowerCase() })} placeholder="growth" hint="Unique, lowercase. Cannot be changed later." /> : null}
            <Field label="Display name *" value={tierForm.displayName} onChangeText={(v) => setTierForm({ ...tierForm, displayName: v })} autoCapitalize="words" />
            <Field label="Monthly price (LKR)" value={tierForm.priceMonthly} onChangeText={(v) => setTierForm({ ...tierForm, priceMonthly: v })} keyboardType="decimal-pad" />
            <Field label="Yearly price (LKR)" value={tierForm.priceYearly} onChangeText={(v) => setTierForm({ ...tierForm, priceYearly: v })} keyboardType="decimal-pad" hint="Blank on create = 10 × monthly." />
            <Field label="Lifetime price (LKR)" value={tierForm.priceLifetime} onChangeText={(v) => setTierForm({ ...tierForm, priceLifetime: v })} keyboardType="decimal-pad" hint="Blank = lifetime not offered." />
            <Field label="Max users" value={tierForm.maxUsers} onChangeText={(v) => setTierForm({ ...tierForm, maxUsers: v })} keyboardType="number-pad" hint="Blank = unlimited." />
            <Field label="Sort order" value={tierForm.sortOrder} onChangeText={(v) => setTierForm({ ...tierForm, sortOrder: v })} keyboardType="number-pad" />
            {tierForm.id ? <SwitchRow label="Offered to new vendors" value={tierForm.isActive} onValueChange={(v) => setTierForm({ ...tierForm, isActive: v })} /> : null}
            {tierForm.id ? <Notice text="Changing a price never changes what current subscribers pay; they keep their locked-in price." /> : null}
            {formError ? <View style={{ marginTop: 8 }}><Notice tone="error" text={formError} /></View> : null}
            {tierForm.id && tierForm.isActive ? (
              <Btn label="Deactivate plan" tone="danger" style={{ marginTop: 10 }} onPress={() => { const t = tiers.find((x) => x.id === tierForm.id); setTierForm(null); if (t) deactivateTier(t) }} />
            ) : null}
          </>
        ) : null}
      </FormModal>

      <FormModal
        visible={!!couponForm}
        title={couponForm?.id ? 'Edit coupon' : 'New coupon'}
        confirmLabel={couponForm?.id ? 'Save' : 'Create'}
        busy={busy}
        onCancel={() => setCouponForm(null)}
        onConfirm={saveCoupon}
      >
        {couponForm ? (
          <>
            <Field label="Code *" value={couponForm.code} onChangeText={(v) => setCouponForm({ ...couponForm, code: v.toUpperCase() })} autoCapitalize="characters" placeholder="WELCOME20" />
            <Field label="Description" value={couponForm.description} onChangeText={(v) => setCouponForm({ ...couponForm, description: v })} autoCapitalize="sentences" />
            <Choice label="Discount type" value={couponForm.discountType} onChange={(v) => setCouponForm({ ...couponForm, discountType: v })} options={[{ value: 'percentage', label: 'Percentage' }, { value: 'fixed_amount', label: 'Fixed amount' }]} />
            <Field label={couponForm.discountType === 'percentage' ? 'Discount (%) *' : 'Discount (LKR) *'} value={couponForm.discountValue} onChangeText={(v) => setCouponForm({ ...couponForm, discountValue: v })} keyboardType="decimal-pad" />
            <Field label="Max total uses" value={couponForm.maxUses} onChangeText={(v) => setCouponForm({ ...couponForm, maxUses: v })} keyboardType="number-pad" hint="Blank = unlimited." />
            <Field label="Uses per account" value={couponForm.maxUsesPerAccount} onChangeText={(v) => setCouponForm({ ...couponForm, maxUsesPerAccount: v })} keyboardType="number-pad" />
            <Field label="Valid until" value={couponForm.validUntil} onChangeText={(v) => setCouponForm({ ...couponForm, validUntil: v })} placeholder="2027-03-31" keyboardType="numbers-and-punctuation" hint="Blank = no end date." />
            <SwitchRow label="Active" value={couponForm.isActive} onValueChange={(v) => setCouponForm({ ...couponForm, isActive: v })} />
            {formError ? <Notice tone="error" text={formError} /> : null}
          </>
        ) : null}
      </FormModal>
    </MoreShell>
  )
}


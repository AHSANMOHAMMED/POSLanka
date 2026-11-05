// Create a vendor (company) from the Admin app: business → plan → owner → review.
// APIs: GET pricing-tiers, GET vendors/slug-check, POST vendors (needs vendors.manage).
import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, Alert, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { adminGet, adminPost, useAdminUser } from '../../../src/lib/adminApi'
import { THEME } from '../../../src/lib/theme'
import { ErrorView, LoadingView } from '../../../src/components/StateViews'
import { AdminShell, Card, ListRow, Pill, SectionTitle, adminStyles, businessTypeLabel } from '../../../src/components/admin/AdminShell'
import { Btn, Choice, Field, MultiChoice, Notice, SwitchRow } from '../../../src/components/admin/AdminForm'
import { BILLING_CYCLES, BUSINESS_TYPES, alertIfFailed, fmtMoney, pickList, type BillingCycle } from '../../../src/lib/adminForms'
import { DEFAULT_MALL_SEGMENTS, MALL, SEGMENT_TYPES, cleanSegments } from '../../../src/lib/businessScope'
import { MALL_DESCRIPTION } from '../../../src/lib/businessTypeLabels'

interface Tier {
  id: string
  name: string
  displayName: string
  priceMonthly?: string | number | null
  priceYearly?: string | number | null
  priceLifetime?: string | number | null
  currency?: string | null
  isActive?: boolean
}

interface CreateResult {
  vendor?: { id: string; name: string; slug: string }
  businessId?: string
  owner?: { id: string; email: string }
  generatedPassword?: string | null
  existingOwner?: boolean
  plan?: { id: string; name: string }
  loginUrl?: string
  inviteSent?: boolean
  inviteEmailFailed?: boolean
}

const STEPS = ['Business', 'Plan', 'Owner', 'Review'] as const
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,24}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function cyclePrice(t: Tier, cycle: BillingCycle): string {
  const v = cycle === 'monthly' ? t.priceMonthly : cycle === 'yearly' ? t.priceYearly : t.priceLifetime
  if (v == null || v === '') return cycle === 'lifetime' ? 'Not offered' : '—'
  return Number(v) === 0 ? 'Free' : fmtMoney(v, t.currency)
}

export default function AdminVendorCreateScreen() {
  const { admin, can } = useAdminUser()
  const canManage = can('vendors.manage')

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [businessType, setBusinessType] = useState<(typeof BUSINESS_TYPES)[number]>('retail')
  /** Mall only: the business types it runs */
  const [segments, setSegments] = useState<string[]>([...DEFAULT_MALL_SEGMENTS])
  const [slug, setSlug] = useState('')
  const [slugState, setSlugState] = useState<{ checking: boolean; available?: boolean; reason?: string }>({ checking: false })
  const [vatRegistered, setVatRegistered] = useState(false)
  const [taxId, setTaxId] = useState('')

  const [tiers, setTiers] = useState<Tier[]>([])
  const [tiersLoading, setTiersLoading] = useState(true)
  const [tiersError, setTiersError] = useState<string | null>(null)
  const [tierId, setTierId] = useState<string | null>(null)
  const [cycle, setCycle] = useState<BillingCycle>('monthly')

  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [businessEmail, setBusinessEmail] = useState('')
  const [useInvite, setUseInvite] = useState(false)
  const [ownerPassword, setOwnerPassword] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CreateResult | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)

  async function loadTiers() {
    setTiersLoading(true)
    setTiersError(null)
    const res = await adminGet<any>('/api/sys-control/pricing-tiers')
    setTiersLoading(false)
    if (!res.ok) {
      setTiersError(res.error)
      return
    }
    const list = pickList<Tier>(res.data, 'tiers').filter((t) => t.isActive !== false)
    setTiers(list)
    setTierId((prev) => prev ?? list[0]?.id ?? null)
  }

  useEffect(() => {
    loadTiers()
  }, [])

  // Live availability of the web address
  useEffect(() => {
    const s = slug.trim().toLowerCase()
    if (s.length < 3) {
      setSlugState({ checking: false })
      return
    }
    if (!SLUG_RE.test(s)) {
      setSlugState({ checking: false, available: false, reason: 'Use lowercase letters, numbers and single hyphens' })
      return
    }
    setSlugState({ checking: true })
    let alive = true
    const t = setTimeout(async () => {
      const res = await adminGet<{ available: boolean; reason?: string }>(`/api/sys-control/vendors/slug-check?slug=${encodeURIComponent(s)}`)
      if (!alive) return
      if (!res.ok) setSlugState({ checking: false, available: undefined, reason: res.error })
      else setSlugState({ checking: false, available: res.data.available, reason: res.data.reason })
    }, 450)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [slug])

  const tier = useMemo(() => tiers.find((t) => t.id === tierId) || null, [tiers, tierId])
  const ownerLogin = ownerEmail.trim() || businessEmail.trim()

  function validate(s: number): string | null {
    if (s === 0) {
      if (name.trim().length < 2) return 'Enter the business name.'
      if (!PHONE_RE.test(phone.trim())) return 'Enter a valid phone number (digits, spaces, + ( ) -).'
      if (address.trim().length < 3) return 'Enter the business address.'
      if (slug.trim() && slugState.available === false) return slugState.reason || 'That web address is not available.'
      if (slug.trim() && slugState.checking) return 'Still checking the web address…'
      if (vatRegistered && !taxId.trim()) return 'A VAT-registered business needs its TIN / VAT number.'
      if (businessType === MALL && cleanSegments(segments).length === 0) return 'Tick at least one shop type the mall runs.'
    }
    if (s === 1) {
      if (!tierId) return 'Choose a plan.'
      if (cycle === 'lifetime' && (tier?.priceLifetime == null || tier.priceLifetime === '')) return 'This plan has no lifetime price. Pick another cycle.'
    }
    if (s === 2) {
      if (useInvite && !ownerLogin) return 'An email invitation needs the owner or business email.'
      if (ownerEmail.trim() && ownerEmail.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) return 'The owner email looks invalid.'
      if (businessEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail.trim())) return 'The business email looks invalid.'
      if (!useInvite && ownerPassword && ownerPassword.length < 4) return 'The owner password needs at least 4 characters.'
    }
    return null
  }

  function next() {
    const err = validate(step)
    setStepError(err)
    if (!err) setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  async function submit() {
    for (let i = 0; i < 3; i++) {
      const err = validate(i)
      if (err) {
        setStep(i)
        setStepError(err)
        return
      }
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      businessType,
      ...(businessType === MALL ? { businessSegments: cleanSegments(segments) } : {}),
      billingCycle: cycle,
      vatRegistered,
    }
    if (tierId) body.tierId = tierId
    if (slug.trim()) body.slug = slug.trim().toLowerCase()
    if (businessEmail.trim()) body.email = businessEmail.trim()
    if (ownerName.trim()) body.ownerName = ownerName.trim()
    if (ownerEmail.trim()) body.ownerEmail = ownerEmail.trim()
    if (vatRegistered && taxId.trim()) body.taxId = taxId.trim()
    if (useInvite) body.sendInvite = true
    else if (ownerPassword) body.ownerPassword = ownerPassword

    setSubmitting(true)
    const res = await adminPost<CreateResult>('/api/sys-control/vendors', body)
    setSubmitting(false)
    if (!alertIfFailed(res, 'Could not create vendor')) return
    setResult(res.data)
  }

  if (!admin) return <AdminShell title="New vendor" tab="vendors" back backHref="/admin/vendors"><LoadingView /></AdminShell>

  if (!canManage) {
    return (
      <AdminShell title="New vendor" tab="vendors" back backHref="/admin/vendors">
        <View style={adminStyles.content}>
          <Notice tone="warn" text="Creating vendors needs the Owner admin role (vendors.manage). Your role can view vendors only." />
        </View>
      </AdminShell>
    )
  }

  if (result) {
    return (
      <AdminShell title="Vendor created" tab="vendors" back backHref="/admin/vendors">
        <ScrollView style={adminStyles.scroll} contentContainerStyle={adminStyles.content}>
          <Card style={{ padding: 14, gap: 6 }}>
            <Pill text="created" tone="ok" />
            <Text style={styles.resultName}>{result.vendor?.name}</Text>
            <Text style={adminStyles.muted}>Business ID: {result.businessId || '—'}</Text>
            <Text style={adminStyles.muted}>Web address: {result.vendor?.slug}</Text>
            <Text style={adminStyles.muted}>Plan: {result.plan?.name || tier?.displayName || '—'} · {cycle}</Text>
            <Text style={adminStyles.muted}>Owner login: {result.owner?.email || '—'}</Text>
          </Card>

          {result.generatedPassword ? (
            <Card style={{ padding: 14, gap: 6, borderColor: THEME.colors.secondary }}>
              <Text style={styles.warnTitle}>Temporary owner password (shown once)</Text>
              <Text selectable style={styles.password}>{result.generatedPassword}</Text>
              <Text style={adminStyles.muted}>Hand it to the owner now. It cannot be shown again; use “Reset password” on the vendor if lost.</Text>
            </Card>
          ) : null}
          {result.existingOwner ? <Notice text="This owner already had a skyERPOS account. The business was added to it and they sign in with their current password." /> : null}
          {result.inviteSent ? <Notice tone="ok" text={`Invitation email sent to ${ownerLogin}.`} /> : null}
          {result.inviteEmailFailed ? <Notice tone="warn" text="The invitation email could not be sent. Open the vendor and use “Resend welcome”." /> : null}

          {result.vendor?.id ? <Btn label="Open vendor" onPress={() => router.replace({ pathname: '/admin/vendors/[id]', params: { id: result.vendor!.id } } as any)} /> : null}
          <Btn label="Back to vendors" tone="ghost" onPress={() => router.replace('/admin/vendors' as any)} />
        </ScrollView>
      </AdminShell>
    )
  }

  return (
    <AdminShell title="New vendor" subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} tab="vendors" back backHref="/admin/vendors">
      <ScrollView style={adminStyles.scroll} contentContainerStyle={adminStyles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.stepBar}>
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.stepDot, i <= step && styles.stepDotOn]}>
              <Text style={[styles.stepDotText, i <= step && { color: '#FFF' }]}>{i + 1}</Text>
            </View>
          ))}
        </View>

        {stepError ? <Notice tone="error" text={stepError} /> : null}

        {step === 0 ? (
          <Card style={styles.pad}>
            <Field label="Business name *" value={name} onChangeText={setName} placeholder="Sunrise Foods" autoCapitalize="words" />
            <Field label="Phone *" value={phone} onChangeText={setPhone} placeholder="+94 77 123 4567" keyboardType="phone-pad" />
            <Field label="Address *" value={address} onChangeText={setAddress} placeholder="12 Galle Road, Colombo 03" multiline autoCapitalize="sentences" />
            <Choice label="Business type" value={businessType} onChange={(v) => setBusinessType(v)} options={BUSINESS_TYPES.map((t) => ({ value: t, label: businessTypeLabel(t) }))} />
            {businessType === MALL ? (
              <>
                <Text style={adminStyles.muted}>{MALL_DESCRIPTION}. Tick every kind of shop it runs; it gets the menus and features of all of them.</Text>
                <MultiChoice label="Shop types in this mall *" values={segments} onChange={setSegments} options={SEGMENT_TYPES.map((t) => ({ value: t, label: businessTypeLabel(t) }))} />
              </>
            ) : null}
            <Field
              label="Web address (optional)"
              value={slug}
              onChangeText={(v) => setSlug(v.toLowerCase())}
              placeholder="sunrise-foods"
              hint={
                slug.trim().length < 3
                  ? 'Leave blank to generate one from the name.'
                  : slugState.checking
                    ? 'Checking…'
                    : slugState.available === true
                      ? '✓ Available'
                      : slugState.reason || 'Not available'
              }
            />
            <SwitchRow label="VAT registered" hint="Seeds the country's standard VAT as the default sales tax." value={vatRegistered} onValueChange={setVatRegistered} />
            {vatRegistered ? <Field label="TIN / VAT number *" value={taxId} onChangeText={setTaxId} /> : null}
          </Card>
        ) : null}

        {step === 1 ? (
          tiersLoading ? (
            <LoadingView text="Loading plans…" />
          ) : tiersError ? (
            <ErrorView message={tiersError} onRetry={loadTiers} />
          ) : (
            <>
              <SectionTitle>Plan</SectionTitle>
              <Card>
                {tiers.map((t) => (
                  <ListRow
                    key={t.id}
                    title={t.displayName}
                    subtitle={`${cyclePrice(t, cycle)} · ${cycle}`}
                    right={<Pill text={tierId === t.id ? 'selected' : 'choose'} tone={tierId === t.id ? 'primary' : 'muted'} />}
                    onPress={() => setTierId(t.id)}
                  />
                ))}
                {tiers.length === 0 ? <Text style={adminStyles.empty}>No active plans. Create one under Pricing.</Text> : null}
              </Card>
              <Card style={styles.pad}>
                <Choice label="Billing cycle" value={cycle} onChange={(v) => setCycle(v)} options={BILLING_CYCLES.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} />
                <Text style={adminStyles.muted}>The vendor starts with a complimentary first period; free plans never expire. Lifetime never expires.</Text>
              </Card>
            </>
          )
        ) : null}

        {step === 2 ? (
          <Card style={styles.pad}>
            <Field label="Owner name" value={ownerName} onChangeText={setOwnerName} placeholder="Defaults to the business name" autoCapitalize="words" />
            <Field label="Owner email / login" value={ownerEmail} onChangeText={setOwnerEmail} placeholder="owner@example.com" keyboardType="email-address" />
            <Field label="Business email (optional)" value={businessEmail} onChangeText={setBusinessEmail} placeholder="info@example.com" keyboardType="email-address" />
            <SwitchRow label="Send email invitation" hint="The owner sets their own password from the invite (needs an email)." value={useInvite} onValueChange={setUseInvite} />
            {!useInvite ? (
              <Field label="Owner password (optional)" value={ownerPassword} onChangeText={setOwnerPassword} secureTextEntry hint="Leave blank to generate one — it is shown once after creation." />
            ) : null}
          </Card>
        ) : null}

        {step === 3 ? (
          <>
            <SectionTitle>Review</SectionTitle>
            <Card>
              <ListRow title={name.trim()} subtitle={`${businessTypeLabel(businessType)} · ${phone.trim()}`} />
              {businessType === MALL ? <ListRow title="Shop types" subtitle={cleanSegments(segments).map(businessTypeLabel).join(', ')} /> : null}
              <ListRow title="Address" subtitle={address.trim()} />
              <ListRow title="Web address" subtitle={slug.trim() || 'Generated from the name'} />
              <ListRow title="Plan" subtitle={`${tier?.displayName || '—'} · ${cycle} · ${tier ? cyclePrice(tier, cycle) : ''}`} />
              <ListRow title="Owner" subtitle={`${ownerName.trim() || name.trim()} · ${ownerLogin || 'generated login'}`} />
              <ListRow title="Access" subtitle={useInvite ? 'Email invitation' : ownerPassword ? 'Password set by you' : 'Generated password (shown once)'} />
              {vatRegistered ? <ListRow title="VAT" subtitle={`Registered · ${taxId.trim()}`} /> : null}
            </Card>
          </>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          {step > 0 ? <Btn label="Back" tone="ghost" style={{ flex: 1 }} onPress={() => { setStepError(null); setStep(step - 1) }} /> : null}
          {step < STEPS.length - 1 ? (
            <Btn label="Next" style={{ flex: 1 }} onPress={next} />
          ) : (
            <Btn
              label="Create vendor"
              style={{ flex: 1 }}
              busy={submitting}
              onPress={() => Alert.alert('Create vendor?', `${name.trim()} will be created on ${tier?.displayName || 'the free plan'} (${cycle}).`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Create', onPress: submit }])}
            />
          )}
        </View>
      </ScrollView>
    </AdminShell>
  )
}

const styles = StyleSheet.create({
  pad: { padding: 14 },
  stepBar: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: THEME.colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  stepDotOn: { backgroundColor: THEME.colors.primary },
  stepDotText: { fontSize: 12, fontWeight: '800', color: THEME.colors.textMuted },
  resultName: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  warnTitle: { fontSize: 12, fontWeight: '800', color: THEME.colors.secondary, textTransform: 'uppercase' },
  password: { fontSize: 20, fontWeight: '900', color: THEME.colors.text, fontFamily: 'monospace', letterSpacing: 1 },
})

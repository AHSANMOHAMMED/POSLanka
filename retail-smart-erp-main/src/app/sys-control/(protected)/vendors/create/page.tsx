'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, KeyRound, Loader2, Mail, Plus, Wand2, XCircle } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  KeyValueList,
  LinkButton,
  PasswordInput,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  BUSINESS_TYPE_LABELS,
  businessTypeLabel,
  fmtLKR,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { CopyButton, adminFetch, fmtBytes } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'
import { cn } from '@/lib/utils'

interface Tier {
  id: string
  name: string
  displayName: string
  priceMonthly: string | null
  priceYearly: string | null
  maxUsers: number | null
  maxSalesMonthly: number | null
  maxDatabaseBytes: number | null
  maxFileStorageBytes: number | null
  isActive: boolean
  sortOrder: number
}

interface CreateResult {
  vendor: { id: string; name: string; slug: string }
  businessId: string
  owner: { email: string }
  plan: { name: string }
  loginUrl: string
  signInUrl: string
  inviteSent: boolean
  inviteEmailFailed: boolean
  /** Set when no password was given and no invite sent — shown once */
  generatedPassword?: string | null
}

type Step = 0 | 1 | 2
const STEPS = ['Business', 'Plan & owner', 'Review']

const SLUG_RE = /^(?=.{3,50}$)[a-z0-9]+(?:-[a-z0-9]+)*$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,24}$/

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '')
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(14)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}

const isFree = (t: Tier) => Number(t.priceMonthly ?? 0) === 0 && Number(t.priceYearly ?? 0) === 0

type SlugState = { state: 'idle' | 'checking' | 'ok' | 'taken'; reason?: string }

export default function CreateVendorPage() {
  const canCreate = useAdminCan('vendors.manage')
  if (!canCreate) {
    return (
      <AdminPage title="New vendor">
        <Alert tone="info">Only owners can create vendors.</Alert>
      </AdminPage>
    )
  }
  return <CreateVendorForm />
}

function CreateVendorForm() {
  const [step, setStep] = useState<Step>(0)
  const [tiers, setTiers] = useState<Tier[] | null>(null)
  const [tierError, setTierError] = useState<string | null>(null)

  // Business
  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [businessType, setBusinessType] = useState('retail')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugState, setSlugState] = useState<SlugState>({ state: 'idle' })
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [brn, setBrn] = useState('')
  const [taxId, setTaxId] = useState('')
  const [vatRegistered, setVatRegistered] = useState(false)

  // Plan & owner
  const [tierId, setTierId] = useState('')
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [access, setAccess] = useState<'password' | 'invite'>('password')
  const [ownerPassword, setOwnerPassword] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateResult | null>(null)

  useEffect(() => {
    adminFetch<Tier[]>('/api/sys-control/pricing-tiers')
      .then((all) => {
        const active = all.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder || Number(a.priceMonthly) - Number(b.priceMonthly))
        setTiers(active)
        const free = active.find((t) => t.name === 'trial') ?? active.find(isFree)
        setTierId((cur) => cur || free?.id || active[0]?.id || '')
      })
      .catch((e) => setTierError(e instanceof Error ? e.message : 'Could not load plans'))
  }, [])

  // Web address follows the name until edited by hand
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  // Live availability (debounced)
  useEffect(() => {
    if (!slug) { setSlugState({ state: 'idle' }); return }
    if (!SLUG_RE.test(slug)) { setSlugState({ state: 'taken', reason: 'Use 3–50 lowercase letters, numbers and single hyphens.' }); return }
    setSlugState({ state: 'checking' })
    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const r = await adminFetch<{ available: boolean; reason?: string }>(`/api/sys-control/vendors/slug-check?slug=${encodeURIComponent(slug)}`, { signal: ctrl.signal })
        setSlugState(r.available ? { state: 'ok' } : { state: 'taken', reason: r.reason })
      } catch {
        if (!ctrl.signal.aborted) setSlugState({ state: 'idle' })
      }
    }, 350)
    return () => { window.clearTimeout(t); ctrl.abort() }
  }, [slug])

  const tier = useMemo(() => tiers?.find((t) => t.id === tierId) ?? null, [tiers, tierId])
  const paid = tier ? !isFree(tier) : false

  function validate(s: Step): Record<string, string> {
    const e: Record<string, string> = {}
    if (s === 0) {
      if (name.trim().length < 2) e.name = 'Enter the business name.'
      if (!PHONE_RE.test(phone.trim())) e.phone = 'Enter a valid phone number.'
      if (address.trim().length < 3) e.address = 'Enter the business address.'
      // Web address and email are optional; an address typed by hand must be valid and free
      if (slugTouched && slug) {
        if (!SLUG_RE.test(slug)) e.slug = 'Use 3–50 lowercase letters, numbers and single hyphens.'
        else if (slugState.state === 'taken') e.slug = slugState.reason || 'This address is not available.'
      }
      if (email.trim() && !EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.'
      if (vatRegistered && !taxId.trim()) e.taxId = 'A VAT-registered business needs its TIN / VAT number.'
    }
    if (s === 1) {
      if (!tierId) e.tier = 'Choose a plan.'
      if (ownerName.trim() && ownerName.trim().length < 2) e.ownerName = 'At least 2 characters, or leave blank.'
      if (ownerEmail.trim() && !EMAIL_RE.test(ownerEmail.trim())) e.ownerEmail = 'Enter a valid email address.'
      if (access === 'password' && ownerPassword && ownerPassword.length < 8) e.ownerPassword = 'At least 8 characters, or leave blank to generate one.'
      if (access === 'invite' && !ownerEmail.trim() && !email.trim()) e.ownerEmail = 'An invitation needs an email address.'
    }
    return e
  }

  function next() {
    const e = validate(step)
    setErrors(e)
    if (Object.keys(e).length === 0) setStep((s) => Math.min(2, s + 1) as Step)
  }

  async function submit() {
    const e = { ...validate(0), ...validate(1) }
    setErrors(e)
    if (Object.keys(e).length) {
      setStep(Object.keys(validate(0)).length ? 0 : 1)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await adminFetch<CreateResult>('/api/sys-control/vendors', {
        method: 'POST',
        json: {
          name: name.trim(),
          legalName: legalName.trim() || undefined,
          // An auto-filled address that is taken or too short is left to the server to pick
          slug: slug && SLUG_RE.test(slug) && (slugTouched || slugState.state !== 'taken') ? slug : undefined,
          email: email.trim() || undefined,
          phone: phone.trim(),
          address: address.trim(),
          businessType,
          brn: brn.trim() || undefined,
          taxId: taxId.trim() || undefined,
          vatRegistered,
          tierId,
          billingCycle,
          ownerName: ownerName.trim() || undefined,
          ownerEmail: ownerEmail.trim() || undefined,
          ownerPassword: access === 'password' ? ownerPassword || undefined : undefined,
          sendInvite: access === 'invite',
        },
      })
      setResult(res)
      window.scrollTo({ top: 0 })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create the vendor')
    } finally {
      setSubmitting(false)
    }
  }

  /* ------------------------------------------------------------------ success */
  if (result) {
    const bid = formatBusinessId(result.businessId)
    const instructions = [
      `${result.vendor.name} is ready on POSLanka.`,
      '',
      `1. Open ${result.signInUrl}`,
      `2. Choose “Staff sign-in” and enter Business ID: ${bid}`,
      `3. Sign in with ${result.owner.email}${access === 'invite' ? ' after accepting the emailed invitation' : result.generatedPassword ? ` and the password ${result.generatedPassword}` : ' and the password you were given'}.`,
      '',
      `Direct link: ${result.loginUrl}`,
    ].join('\n')
    return (
      <AdminPage
        title="Vendor created"
        breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: 'New vendor' }]}
      >
        <AdminCard>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-adm-success-soft text-adm-success">
                <CheckCircle2 size={22} aria-hidden />
              </span>
              <div>
                <h2 className="text-[17px] font-semibold text-adm-fg">{result.vendor.name}</h2>
                <p className="text-[13.5px] text-adm-muted">On the {result.plan.name} plan · owner {result.owner.email}</p>
              </div>
            </div>
            <div className="rounded-lg border border-adm-border bg-adm-surface-2 px-4 py-2.5">
              <p className="text-[12px] font-medium text-adm-subtle">Business ID</p>
              <div className="flex items-center gap-1">
                <span className="adm-num text-[24px] font-semibold tracking-[0.04em] text-adm-fg">{bid}</span>
                <CopyButton text={bid} label="Copy Business ID" />
              </div>
            </div>
          </div>
        </AdminCard>

        {result.generatedPassword && (
          <Alert tone="warning" title="Owner password (shown once)">
            <span className="inline-flex flex-wrap items-center gap-2">
              Login <span className="font-mono">{result.owner.email}</span> · password <span className="font-mono font-semibold">{result.generatedPassword}</span>
              <CopyButton text={result.generatedPassword} label="Copy password" />
            </span>
            <span className="mt-1 block">Hand it to the owner now — it is not stored anywhere readable. They can change it after signing in.</span>
          </Alert>
        )}

        {access === 'invite' && (
          result.inviteSent
            ? <Alert tone="success" title="Invitation sent">The owner was emailed a link to set their password. It expires in 7 days.</Alert>
            : <Alert tone="warning" title="Invitation email not sent">The vendor was created, but the email failed. Use “Resend invitation” on the vendor page.</Alert>
        )}

        <AdminCard
          title="Owner sign-in instructions"
          description="Copy and send these to the owner."
          actions={<CopyButton text={instructions} label="Copy instructions" />}
        >
          <pre className="adm-scroll overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-adm-surface-2 p-4 font-sans text-[13.5px] leading-relaxed text-adm-fg">{instructions}</pre>
        </AdminCard>

        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/sys-control/vendors/${result.vendor.id}`} variant="primary" iconRight={ArrowRight}>Open vendor</LinkButton>
          <Button icon={Plus} onClick={() => window.location.reload()}>Create another</Button>
        </div>
      </AdminPage>
    )
  }

  /* ------------------------------------------------------------------ wizard */
  const slugHint =
    slugState.state === 'checking' ? (
      <span className="inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" aria-hidden /> Checking…</span>
    ) : slugState.state === 'ok' ? (
      <span className="inline-flex items-center gap-1 text-adm-success"><Check size={13} aria-hidden /> Available — staff can also use /c/{slug}/login</span>
    ) : !slugTouched && (slugState.state === 'taken' || !slug) ? (
      'Optional — a free address is picked from the name when you finish.'
    ) : (
      'Optional — made from the name. Lowercase letters, numbers and hyphens.'
    )

  return (
    <AdminPage
      title="New vendor"
      description="Create a business, its owner and its plan. The Business ID is generated when you finish."
      breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: 'New vendor' }]}
    >
      {/* Steps */}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-adm-border-strong sm:w-10" aria-hidden />}
            <span
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold',
                i < step ? 'bg-adm-primary text-adm-primary-fg' : i === step ? 'bg-adm-primary-soft text-adm-primary-soft-fg ring-1 ring-adm-primary' : 'bg-adm-surface-3 text-adm-subtle'
              )}
            >
              {i < step ? <Check size={14} aria-hidden /> : i + 1}
            </span>
            <span className={cn('text-[13.5px]', i === step ? 'font-medium text-adm-fg' : 'text-adm-muted')}>{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <AdminCard title="Business details" description="As it should appear on receipts and invoices.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Business name" htmlFor="v-name" required error={errors.name}>
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunrise Foods" autoFocus />
            </Field>
            <Field label="Legal name" htmlFor="v-legal" hint="Registered company name, if different.">
              <Input id="v-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Sunrise Foods (Private) Limited" />
            </Field>
            <Field label="Business type" htmlFor="v-type" hint="Sets the modules and terminology the vendor sees.">
              <Select id="v-type" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                {Object.entries(BUSINESS_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Web address" htmlFor="v-slug" error={errors.slug ?? (slugTouched && slugState.state === 'taken' ? slugState.reason : undefined)} hint={slugHint}>
              <Input
                id="v-slug"
                value={slug}
                onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')) }}
                placeholder="sunrise-foods"
                invalid={slugTouched && slugState.state === 'taken'}
                rightSlot={slugTouched && slugState.state === 'taken' ? <XCircle size={16} className="mr-2 text-adm-danger" aria-hidden /> : undefined}
              />
            </Field>
            <Field label="Business email" htmlFor="v-email" error={errors.email}>
              <Input id="v-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="accounts@sunrisefoods.lk" />
            </Field>
            <Field label="Phone" htmlFor="v-phone" required error={errors.phone}>
              <Input id="v-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+94 77 123 4567" />
            </Field>
            <Field label="Address" htmlFor="v-address" required error={errors.address} className="md:col-span-2">
              <Textarea id="v-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="No. 12, Galle Road, Colombo 03" />
            </Field>
            <Field label="Business registration no. (BRN)" htmlFor="v-brn">
              <Input id="v-brn" value={brn} onChange={(e) => setBrn(e.target.value)} placeholder="PV 00123456" />
            </Field>
            <Field label="TIN / VAT number" htmlFor="v-tin" error={errors.taxId}>
              <Input id="v-tin" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="123456789-7000" />
            </Field>
            <Checkbox
              className="md:col-span-2"
              checked={vatRegistered}
              onChange={(e) => setVatRegistered(e.target.checked)}
              label="VAT registered"
              description="Makes VAT 18% the default sales tax. Leave unticked if the business does not charge VAT — it can be changed later in its tax settings."
            />
          </div>
        </AdminCard>
      )}

      {step === 1 && (
        <>
          <AdminCard title="Plan" description="Prices and limits come from Plans & features.">
            {tierError ? (
              <Alert tone="danger">{tierError}</Alert>
            ) : !tiers ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
              </div>
            ) : (
              <div className="space-y-4">
                <div role="radiogroup" aria-label="Plan" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {tiers.map((t) => {
                    const selected = t.id === tierId
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setTierId(t.id)}
                        className={cn(
                          'adm-focus rounded-xl border p-4 text-left transition-colors',
                          selected ? 'border-adm-primary bg-adm-primary-soft' : 'border-adm-border bg-adm-surface hover:border-adm-border-strong'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-adm-fg">{t.displayName}</span>
                          {selected && <Check size={16} className="text-adm-primary" aria-hidden />}
                        </div>
                        <p className="adm-num mt-1 text-[15px] text-adm-fg">
                          {isFree(t) ? 'Free' : <>{fmtLKR(Number(t.priceMonthly))}<span className="text-[12.5px] text-adm-subtle"> / month</span></>}
                        </p>
                        {!isFree(t) && t.priceYearly && (
                          <p className="adm-num text-[12.5px] text-adm-subtle">{fmtLKR(Number(t.priceYearly))} / year</p>
                        )}
                        <ul className="mt-2 space-y-0.5 text-[12.5px] text-adm-muted">
                          <li>{t.maxUsers ? `Up to ${t.maxUsers} users` : 'Unlimited users'}</li>
                          <li>{t.maxDatabaseBytes ? `${fmtBytes(t.maxDatabaseBytes)} data` : 'Unlimited data'}{t.maxFileStorageBytes ? ` · ${fmtBytes(t.maxFileStorageBytes)} files` : ''}</li>
                          {t.maxSalesMonthly ? <li>{t.maxSalesMonthly.toLocaleString()} sales / month</li> : null}
                        </ul>
                      </button>
                    )
                  })}
                </div>
                {errors.tier && <p className="text-[12.5px] text-adm-danger">{errors.tier}</p>}
                {paid && (
                  <div className="space-y-2">
                    <SegmentedControl
                      ariaLabel="Billing cycle"
                      value={billingCycle}
                      onChange={setBillingCycle}
                      options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]}
                      size="sm"
                    />
                    <p className="text-[13px] text-adm-muted">
                      The first {billingCycle === 'yearly' ? 'year' : 'month'} starts today at no charge. After that the owner renews from their account (PayHere or bank transfer).
                    </p>
                  </div>
                )}
                {tier && !paid && <p className="text-[13px] text-adm-muted">The free plan does not expire. The owner can upgrade from their account at any time.</p>}
              </div>
            )}
          </AdminCard>

          <AdminCard title="Owner" description="The owner can manage billing, staff and settings.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Owner name" htmlFor="o-name" error={errors.ownerName} hint={!ownerName ? `Leave blank to use ${name.trim() || 'the business name'}.` : undefined}>
                <Input id="o-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder={name.trim() || 'Nimal Perera'} />
              </Field>
              <Field label="Owner email" htmlFor="o-email" error={errors.ownerEmail} hint={!ownerEmail ? (email.trim() ? `Leave blank to use ${email.trim()}.` : 'Optional. Without any email the owner signs in with a login made from the web address.') : undefined}>
                <Input id="o-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder={email || 'owner@example.lk'} />
              </Field>
              <div className="space-y-3 md:col-span-2">
                <SegmentedControl
                  ariaLabel="Owner access"
                  value={access}
                  onChange={setAccess}
                  options={[
                    { value: 'password', label: <span className="inline-flex items-center gap-1.5"><KeyRound size={14} aria-hidden /> Set a password</span> },
                    { value: 'invite', label: <span className="inline-flex items-center gap-1.5"><Mail size={14} aria-hidden /> Email an invitation</span> },
                  ]}
                />
                {access === 'password' ? (
                  <Field label="Owner password" htmlFor="o-pass" error={errors.ownerPassword} hint="Leave blank and one is generated and shown after creating. Share it with the owner securely; they can change it after signing in.">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <PasswordInput id="o-pass" wrapperClassName="flex-1" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} autoComplete="new-password" />
                      <Button icon={Wand2} onClick={() => setOwnerPassword(generatePassword())}>Generate</Button>
                    </div>
                  </Field>
                ) : (
                  <p className="text-[13px] text-adm-muted">The owner gets an email to set their own password. The link is valid for 7 days and can be resent from the vendor page.</p>
                )}
              </div>
            </div>
          </AdminCard>
        </>
      )}

      {step === 2 && (
        <AdminCard title="Review" description="Check the details, then create the vendor.">
          <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
            <KeyValueList
              items={[
                { label: 'Business name', value: name },
                { label: 'Legal name', value: legalName || '—' },
                { label: 'Business type', value: businessTypeLabel(businessType) },
                { label: 'Web address', value: slug && SLUG_RE.test(slug) && (slugTouched || slugState.state !== 'taken') ? slug : 'Generated from the name' },
                { label: 'Email', value: email || '—' },
                { label: 'Phone', value: phone || '—' },
                { label: 'BRN', value: brn || '—' },
                { label: 'TIN / VAT no.', value: taxId || '—' },
                { label: 'VAT', value: vatRegistered ? <Badge tone="info">VAT registered · 18% default</Badge> : 'Not registered' },
              ]}
            />
            <KeyValueList
              items={[
                { label: 'Plan', value: tier ? `${tier.displayName}${paid ? ` · ${billingCycle}` : ''}` : '—' },
                { label: 'Price', value: tier ? (paid ? fmtLKR(Number(billingCycle === 'yearly' ? tier.priceYearly : tier.priceMonthly)) : 'Free') : '—' },
                { label: 'Owner', value: ownerName || name },
                { label: 'Owner email', value: ownerEmail || email || 'Generated login' },
                { label: 'Owner access', value: access === 'invite' ? 'Email invitation' : ownerPassword ? 'Password set now' : 'Password generated on create' },
                { label: 'Address', value: address || '—' },
              ]}
            />
          </div>
          {submitError && <Alert tone="danger" className="mt-4" title="Could not create the vendor">{submitError}</Alert>}
        </AdminCard>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {step > 0 ? (
          <Button icon={ArrowLeft} onClick={() => setStep((s) => (s - 1) as Step)} disabled={submitting}>Back</Button>
        ) : (
          <LinkButton href="/sys-control/vendors" variant="ghost" icon={ArrowLeft}>Cancel</LinkButton>
        )}
        {step < 2 ? (
          <Button variant="primary" iconRight={ArrowRight} onClick={next} disabled={step === 0 && slugTouched && slugState.state === 'checking'}>Continue</Button>
        ) : (
          <Button variant="primary" icon={Check} onClick={submit} loading={submitting}>Create vendor</Button>
        )}
      </div>
    </AdminPage>
  )
}

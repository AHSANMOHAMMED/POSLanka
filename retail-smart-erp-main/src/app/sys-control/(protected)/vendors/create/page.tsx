'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Building2,
  Store,
  ShieldCheck,
  CreditCard,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Cpu,
  Database,
  Globe,
  Sliders,
  KeyRound,
  Copy,
  ExternalLink,
} from 'lucide-react'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  type FeatureFlag,
  type FeatureFlagsMap,
  DEFAULT_VENDOR_FEATURE_FLAGS,
} from '@/lib/features/flags'

type PlanId = 'trial' | 'basic' | 'standard' | 'premium'
type BusinessTypeId = 'retail' | 'restaurant' | 'supermarket' | 'auto_service' | 'dealership'

interface ProvisionResult {
  vendor: { id: string; name: string; slug: string }
  owner: { id: string; email: string }
  loginUrl: string
  inviteSent?: boolean
}

export default function CreateVendorWizardPage() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const [copied, setCopied] = useState(false)

  // Form State
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [businessType, setBusinessType] = useState<BusinessTypeId>('retail')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [province, setProvince] = useState('Western')
  const [city, setCity] = useState('')
  const [brn, setBrn] = useState('')
  const [tin, setTin] = useState('')
  const [vatRegistered, setVatRegistered] = useState(true)

  // Owner account
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [sendInvite, setSendInvite] = useState(false)

  // Plan & Hardware State
  const [plan, setPlan] = useState<PlanId>('standard')
  const [countersQuota, setCountersQuota] = useState(4)
  const [storageGb, setStorageGb] = useState(25)

  // Flags State
  const [flags, setFlags] = useState<FeatureFlagsMap>({
    ...DEFAULT_VENDOR_FEATURE_FLAGS,
  })

  const handleSlugChange = (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setSlug(cleaned)
  }

  const toggleFlag = (flag: FeatureFlag) => {
    setFlags((prev) => ({ ...prev, [flag]: !prev[flag] }))
  }

  const validate = (): string | null => {
    if (name.trim().length < 2) return 'Company name is required'
    if (!/^[a-z0-9-]{3,50}$/.test(slug)) return 'Slug must be 3-50 characters: a-z, 0-9 and hyphens'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'A valid administrative email is required'
    if (ownerName.trim().length < 2) return 'Owner full name is required'
    if (ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return 'Owner email is invalid'
    if (!sendInvite && ownerPassword.length < 8) return 'Owner password must be at least 8 characters (or send an invite instead)'
    return null
  }

  const handleSubmit = async () => {
    setError('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setLoading(true)

    try {
      const res = await fetch('/api/sys-control/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          email: email.trim(),
          phone: phone.trim() || undefined,
          address: [address.trim(), city.trim(), province ? `${province} Province` : ''].filter(Boolean).join(', ') || undefined,
          businessType,
          plan,
          country: 'LK',
          currency: 'LKR',
          tin: tin.trim() || undefined,
          brn: brn.trim() || undefined,
          vatRegistered,
          featureFlags: flags,
          limits: { countersQuota, storageGb },
          location: { province, city: city.trim() || undefined },
          ownerName: ownerName.trim(),
          ownerEmail: ownerEmail.trim() || undefined,
          ownerPassword: sendInvite ? undefined : ownerPassword,
          sendInvite,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const details = Array.isArray(data.details)
          ? data.details.map((d: { message?: string; path?: string }) => d.message || d.path).filter(Boolean).join('; ')
          : typeof data.details === 'object' && data.details
            ? Object.values(data.details as Record<string, unknown>).flat().join('; ')
            : ''
        setError(data.error ? `${data.error}${details ? `: ${details}` : ''}` : 'Failed to provision vendor')
        setLoading(false)
        return
      }

      setResult(data as ProvisionResult)
    } catch {
      setError('Network communication failed during tenant provisioning.')
    } finally {
      setLoading(false)
    }
  }

  const copyLoginUrl = async () => {
    if (!result?.loginUrl) return
    try {
      await navigator.clipboard.writeText(result.loginUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable
    }
  }

  const planPricing: Record<PlanId, { price: number; label: string }> = {
    trial: { price: 0, label: 'Trial Period (14 Days)' },
    basic: { price: 4500, label: 'Basic Single Till' },
    standard: { price: 12500, label: 'Standard (Multi-Till)' },
    premium: { price: 34500, label: 'Premium Enterprise' },
  }

  if (result) {
    return (
      <div className="max-w-2xl mx-auto py-10 space-y-6">
        <div className="bg-[#131b2e] border border-[#6bd8cb]/40 rounded-xl p-8 shadow-xl space-y-5 text-center">
          <CheckCircle2 className="w-14 h-14 text-[#4fdbc8] mx-auto" />
          <div>
            <h1 className="text-2xl font-bold text-white">Tenant Provisioned</h1>
            <p className="text-xs text-[#bcc9c6] mt-1">
              <strong className="text-white">{result.vendor.name}</strong> is live with a default warehouse, POS counter and owner account.
            </p>
          </div>

          <div className="bg-[#060e20] border border-[#2d3449] rounded-lg p-4 text-left font-mono text-xs space-y-3">
            <div className="flex justify-between gap-4">
              <span className="text-[#879391] uppercase text-[10px]">Tenant login URL</span>
              <button
                type="button"
                onClick={copyLoginUrl}
                className="flex items-center gap-1 text-[#6bd8cb] hover:underline"
              >
                <Copy className="w-3 h-3" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <a
              href={result.loginUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-[#4fdbc8] font-bold break-all hover:underline"
            >
              {result.loginUrl}
            </a>
            <div className="pt-3 border-t border-[#2d3449] grid grid-cols-1 sm:grid-cols-2 gap-2 text-[#bcc9c6]">
              <div>
                <div className="text-[#879391] uppercase text-[10px]">Owner email</div>
                <div className="text-white">{result.owner.email}</div>
              </div>
              <div>
                <div className="text-[#879391] uppercase text-[10px]">Credentials</div>
                <div className="text-white">
                  {result.inviteSent ? 'Invite email sent (owner sets password)' : 'Password as entered in wizard'}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <Link
              href={`/sys-control/vendors/${result.vendor.id}`}
              className="flex items-center gap-2 px-5 py-2 bg-[#6bd8cb] hover:bg-[#89f5e7] text-[#003732] font-bold text-xs rounded-lg"
            >
              <Store className="w-4 h-4" />
              Open Vendor Dossier
            </Link>
            <a
              href={result.loginUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-5 py-2 bg-[#222a3d] hover:bg-[#2d3449] text-white font-semibold text-xs rounded-lg"
            >
              <ExternalLink className="w-4 h-4" />
              Open Login Page
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Top Progress & Meta Header Bar (Stitch S5) */}
      <div className="relative w-full bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-xl overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs text-[#879391] uppercase tracking-wider mb-1">
              <Link href="/sys-control/vendors" className="hover:text-[#6bd8cb] transition-colors">
                Tenants
              </Link>
              <span>/</span>
              <span>Provisioning</span>
              <span>/</span>
              <span className="text-[#6bd8cb] font-semibold">New Vendor Setup</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2 h-7 rounded-sm bg-[#6bd8cb]"></div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Provision New Tenant / Vendor Wizard
                </h1>
                <p className="text-xs text-[#bcc9c6] mt-0.5">
                  Step-by-step cryptographic provisioning, quota assignment, and hardware permissioning
                </p>
              </div>
            </div>
          </div>

          {/* Quick Partition Indicator */}
          <div className="flex items-center gap-4 bg-[#060e20] border border-[#2d3449] px-4 py-2 rounded-lg font-mono text-xs">
            <div className="text-right">
              <div className="text-[10px] text-[#879391] uppercase">TARGET PARTITION</div>
              <div className="text-[#4fdbc8] font-semibold">pg_part_sl_west_04</div>
            </div>
            <div className="w-px h-6 bg-[#2d3449]"></div>
            <div>
              <div className="text-[10px] text-[#879391] uppercase">ISOLATION TIER</div>
              <div className="text-[#6bd8cb] font-semibold">ROW_SECURITY_RLS_L3</div>
            </div>
          </div>
        </div>

        {/* Stepper Navigation */}
        <div className="mt-6 pt-4 border-t border-[#2d3449]/60 grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { num: 1, title: 'Company & Fiscal', desc: 'Identity, TIN, BRN' },
            { num: 2, title: 'Tenant Domain', desc: 'Subdomain & Location' },
            { num: 3, title: 'Plan & Hardware', desc: 'Tills, Storage, Tiers' },
            { num: 4, title: 'Feature Flags', desc: 'Modules & Entitlements' },
          ].map((s) => {
            const isCompleted = step > s.num
            const isActive = step === s.num

            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setStep(s.num)}
                className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                  isActive
                    ? 'bg-[#29a195]/20 border-[#6bd8cb] shadow-md'
                    : isCompleted
                    ? 'bg-[#060e20] border-[#2d3449] text-[#bcc9c6]'
                    : 'bg-[#060e20]/50 border-[#2d3449]/40 opacity-60'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs font-bold ${
                    isActive
                      ? 'bg-[#6bd8cb] text-[#003732] shadow-sm'
                      : isCompleted
                      ? 'bg-[#4fdbc8] text-[#00302b]'
                      : 'bg-[#222a3d] text-[#879391]'
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                </div>
                <div className="min-w-0">
                  <div
                    className={`text-[10px] font-mono uppercase ${
                      isActive ? 'text-[#6bd8cb] font-bold' : 'text-[#879391]'
                    }`}
                  >
                    Step 0{s.num} • {isCompleted ? 'Done' : isActive ? 'Active' : 'Pending'}
                  </div>
                  <div className="text-xs font-semibold text-white truncate">{s.title}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[#93000a]/40 border border-[#ff5451] rounded-xl text-xs text-[#ffdad6] flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-[#ffb4ab] flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Multi-Panel Wizard Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Configuration Column (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* STEP 1: Company Profile & Fiscal Identity */}
          {step === 1 && (
            <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-xl space-y-5 animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/60">
                <div className="flex items-center gap-2.5">
                  <Building2 className="w-5 h-5 text-[#6bd8cb]" />
                  <div>
                    <h2 className="font-bold text-base text-white">
                      1. Legal Entity &amp; Fiscal Credentials
                    </h2>
                    <p className="text-xs text-[#bcc9c6]">
                      Legal registration, Inland Revenue RAMIS integration, and business vertical
                    </p>
                  </div>
                </div>
                <span className="font-mono text-[11px] bg-[#060e20] text-[#4fdbc8] px-2.5 py-0.5 rounded font-bold border border-[#2d3449]">
                  SEC-ID: LK-TEN-NEW
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Legal Name */}
                <div className="md:col-span-2 space-y-1.5">
                  <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                    Company Legal Entity Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Lanka Agro Mart (Pvt) Ltd"
                    required
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white font-medium text-sm focus:border-[#6bd8cb] outline-none"
                  />
                </div>

                {/* Business Vertical */}
                <div className="space-y-1.5">
                  <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                    Retail Vertical / Sector *
                  </label>
                  <select
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value as BusinessTypeId)}
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white text-sm outline-none font-medium"
                  >
                    <option value="retail">General Retail (incl. Pharmacy)</option>
                    <option value="supermarket">Supermarket / Grocery Chain</option>
                    <option value="restaurant">Restaurant / F&amp;B Quick Serve</option>
                    <option value="auto_service">Automotive Workshop &amp; Spares</option>
                    <option value="dealership">Vehicle Dealership</option>
                  </select>
                </div>

                {/* BRN */}
                <div className="space-y-1.5">
                  <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                    Business Registration No (BRN) *
                  </label>
                  <input
                    type="text"
                    value={brn}
                    onChange={(e) => setBrn(e.target.value)}
                    placeholder="e.g. PV-0029148"
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white font-mono text-sm focus:border-[#6bd8cb] outline-none"
                  />
                </div>

                {/* RAMIS TIN */}
                <div className="space-y-1.5">
                  <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                    RAMIS Tax Identification No (TIN)
                  </label>
                  <input
                    type="text"
                    value={tin}
                    onChange={(e) => setTin(e.target.value)}
                    placeholder="e.g. RAMIS-8941203"
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white font-mono text-sm focus:border-[#6bd8cb] outline-none"
                  />
                </div>

                {/* VAT Status */}
                <div className="flex items-center gap-3 pt-6">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={vatRegistered}
                      onChange={(e) => setVatRegistered(e.target.checked)}
                      className="rounded bg-[#060e20] border-[#2d3449] text-[#6bd8cb] w-4 h-4"
                    />
                    <span>18% VAT Registered Merchant</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-[#2d3449]/50">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-5 py-2 bg-[#6bd8cb] hover:bg-[#89f5e7] text-[#003732] font-bold text-xs rounded-lg transition-all"
                >
                  <span>Continue to Tenant Domain</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Tenant Domain & Store Partitioning */}
          {step === 2 && (
            <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-xl space-y-5 animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/60">
                <div className="flex items-center gap-2.5">
                  <Globe className="w-5 h-5 text-[#4fdbc8]" />
                  <div>
                    <h2 className="font-bold text-base text-white">
                      2. Subdomain &amp; Geographic Partitioning
                    </h2>
                    <p className="text-xs text-[#bcc9c6]">
                      Dedicated tenant routing on poslanka.lk and regional distribution
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {/* Subdomain Slug */}
                <div className="space-y-1.5">
                  <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                    Tenant Subdomain Slug *
                  </label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      required
                      placeholder="e.g. lanka-agro"
                      className="flex-1 bg-[#060e20] border border-[#2d3449] rounded-l-lg px-3.5 py-2 text-white font-mono text-sm focus:border-[#6bd8cb] outline-none"
                    />
                    <div className="bg-[#222a3d] border-y border-r border-[#2d3449] px-3.5 py-2 rounded-r-lg font-mono text-xs text-[#6bd8cb] font-semibold">
                      .poslanka.lk
                    </div>
                  </div>
                  <div className="text-[11px] text-[#879391]">
                    Login URL will be: <span className="text-[#4fdbc8]">/c/{slug || 'vendor'}/login</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Primary Email */}
                  <div className="space-y-1.5">
                    <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                      Primary Administrative Email *
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white font-mono text-sm focus:border-[#6bd8cb] outline-none"
                    />
                  </div>

                  {/* Phone */}
                  <div className="space-y-1.5">
                    <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                      Support Phone Number
                    </label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white font-mono text-sm focus:border-[#6bd8cb] outline-none"
                    />
                  </div>

                  {/* Province */}
                  <div className="space-y-1.5">
                    <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                      Primary Province
                    </label>
                    <select
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white text-sm outline-none font-medium"
                    >
                      <option value="Western">Western (Colombo, Gampaha)</option>
                      <option value="Central">Central (Kandy, Matale)</option>
                      <option value="Southern">Southern (Galle, Matara)</option>
                      <option value="North Western">North Western (Kurunegala)</option>
                      <option value="Eastern">Eastern Province</option>
                      <option value="Northern">Northern Province</option>
                    </select>
                  </div>

                  {/* City */}
                  <div className="space-y-1.5">
                    <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                      City / Municipal Area
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white text-sm focus:border-[#6bd8cb] outline-none"
                    />
                  </div>

                  {/* Full Address */}
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                      Registered Address
                    </label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white text-sm focus:border-[#6bd8cb] outline-none"
                    />
                  </div>
                </div>

                {/* Owner Account */}
                <div className="pt-4 border-t border-[#2d3449]/60 space-y-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#6bd8cb]" />
                    <div>
                      <h3 className="font-bold text-sm text-white">Owner Account</h3>
                      <p className="text-[11px] text-[#bcc9c6]">
                        The first login for this tenant (role: owner). Defaults to the administrative email.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                        Owner Full Name *
                      </label>
                      <input
                        type="text"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        placeholder="e.g. Nimal Perera"
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white text-sm focus:border-[#6bd8cb] outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                        Owner Login Email (optional)
                      </label>
                      <input
                        type="email"
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        placeholder={email || 'Same as administrative email'}
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white font-mono text-sm focus:border-[#6bd8cb] outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                        Owner Password {sendInvite ? '(not needed)' : '* (min 8 chars)'}
                      </label>
                      <input
                        type="password"
                        value={ownerPassword}
                        onChange={(e) => setOwnerPassword(e.target.value)}
                        disabled={sendInvite}
                        autoComplete="new-password"
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3.5 py-2 text-white font-mono text-sm focus:border-[#6bd8cb] outline-none disabled:opacity-40"
                      />
                    </div>
                    <div className="flex items-center pt-6">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-white">
                        <input
                          type="checkbox"
                          checked={sendInvite}
                          onChange={(e) => setSendInvite(e.target.checked)}
                          className="rounded bg-[#060e20] border-[#2d3449] text-[#6bd8cb] w-4 h-4"
                        />
                        <span>Email an invite instead (owner sets own password)</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-[#2d3449]/50">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#222a3d] text-white hover:bg-[#2d3449] text-xs font-semibold rounded-lg"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex items-center gap-2 px-5 py-2 bg-[#6bd8cb] hover:bg-[#89f5e7] text-[#003732] font-bold text-xs rounded-lg transition-all"
                >
                  <span>Continue to Plan &amp; Hardware</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Plan, Storage & Hardware Quotas */}
          {step === 3 && (
            <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-xl space-y-5 animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/60">
                <div className="flex items-center gap-2.5">
                  <CreditCard className="w-5 h-5 text-[#6bd8cb]" />
                  <div>
                    <h2 className="font-bold text-base text-white">
                      3. Subscription Tier &amp; Hardware Quotas
                    </h2>
                    <p className="text-xs text-[#bcc9c6]">
                      Tier entitlements, licensed counter terminals, and cloud storage allocation
                    </p>
                  </div>
                </div>
              </div>

              {/* Plan Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    id: 'trial',
                    name: 'Trial Period',
                    price: 'Free 14-Day',
                    desc: 'Full access for evaluation and pilot counter launch.',
                  },
                  {
                    id: 'basic',
                    name: 'Basic Single Till',
                    price: 'LKR 4,500 / mo',
                    desc: 'Single checkout till for small retail and boutique shops.',
                  },
                  {
                    id: 'standard',
                    name: 'Standard Multi-Till',
                    price: 'LKR 12,500 / mo',
                    desc: 'Multi-counter retail with warehouse and reporting.',
                    popular: true,
                  },
                  {
                    id: 'premium',
                    name: 'Premium Enterprise',
                    price: 'LKR 34,500 / mo',
                    desc: 'Unlimited tills, priority support, multi-branch.',
                  },
                ].map((p) => {
                  const selected = plan === p.id
                  return (
                    <div
                      key={p.id}
                      onClick={() => setPlan(p.id as PlanId)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all relative ${
                        selected
                          ? 'bg-[#29a195]/20 border-[#6bd8cb] shadow-lg'
                          : 'bg-[#060e20] border-[#2d3449] hover:border-[#3d4947]'
                      }`}
                    >
                      {p.popular && (
                        <span className="absolute top-3 right-3 font-mono text-[9px] bg-[#6bd8cb] text-[#003732] px-1.5 py-0.5 rounded font-bold">
                          RECOMMENDED
                        </span>
                      )}
                      <div className="font-bold text-sm text-white">{p.name}</div>
                      <div className="font-mono text-sm text-[#4fdbc8] font-semibold my-1">
                        {p.price}
                      </div>
                      <div className="text-[11px] text-[#bcc9c6] leading-relaxed">{p.desc}</div>
                    </div>
                  )
                })}
              </div>

              {/* Hardware Quotas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#2d3449]/50">
                <div className="space-y-1.5">
                  <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                    Licensed Counter Tills
                  </label>
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#4fdbc8]" />
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={countersQuota}
                      onChange={(e) => setCountersQuota(Number(e.target.value))}
                      className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3 py-1.5 text-white font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-mono text-[11px] uppercase text-[#bcc9c6] font-semibold">
                    Database Storage Quota (GB)
                  </label>
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#6bd8cb]" />
                    <input
                      type="number"
                      min={5}
                      max={200}
                      value={storageGb}
                      onChange={(e) => setStorageGb(Number(e.target.value))}
                      className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3 py-1.5 text-white font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-[#2d3449]/50">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#222a3d] text-white hover:bg-[#2d3449] text-xs font-semibold rounded-lg"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="flex items-center gap-2 px-5 py-2 bg-[#6bd8cb] hover:bg-[#89f5e7] text-[#003732] font-bold text-xs rounded-lg transition-all"
                >
                  <span>Continue to Feature Flags</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Feature Flags & Provisioning Finalization */}
          {step === 4 && (
            <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-xl space-y-5 animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/60">
                <div className="flex items-center gap-2.5">
                  <Sliders className="w-5 h-5 text-[#6bd8cb]" />
                  <div>
                    <h2 className="font-bold text-base text-white">
                      4. Feature Matrix &amp; Operational Permissions
                    </h2>
                    <p className="text-xs text-[#bcc9c6]">
                      Toggle hardware capabilities and module permissions for this tenant
                    </p>
                  </div>
                </div>
              </div>

              {/* Flags List */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {FEATURE_FLAGS.map((flag) => {
                  const enabled = !!flags[flag]
                  return (
                    <div
                      key={flag}
                      onClick={() => toggleFlag(flag)}
                      className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between transition-all ${
                        enabled
                          ? 'bg-[#29a195]/20 border-[#6bd8cb]'
                          : 'bg-[#060e20] border-[#2d3449] opacity-75'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold text-white">
                          {FEATURE_FLAG_LABELS[flag]}
                        </div>
                        <div className="font-mono text-[10px] text-[#879391]">{flag}</div>
                      </div>
                      <div
                        className={`w-9 h-5 rounded-full p-0.5 flex transition-colors ${
                          enabled ? 'bg-[#6bd8cb] justify-end' : 'bg-[#222a3d] justify-start'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full ${
                            enabled ? 'bg-[#003732]' : 'bg-[#879391]'
                          }`}
                        ></div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex justify-between pt-4 border-t border-[#2d3449]/50">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#222a3d] text-white hover:bg-[#2d3449] text-xs font-semibold rounded-lg"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSubmit}
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#6bd8cb] hover:bg-[#89f5e7] text-[#003732] font-bold text-sm rounded-lg shadow-lg shadow-[#6bd8cb]/20 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Provisioning Encrypted Tenant...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Execute Cryptographic Provisioning</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Configuration Summary Dossier (4 cols) */}
        <div className="lg:col-span-4 bg-[#131b2e] border border-[#2d3449] p-5 rounded-xl shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/60">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Store className="w-4 h-4 text-[#6bd8cb]" />
              Provisioning Summary
            </h3>
            <span className="font-mono text-[10px] text-[#4fdbc8] font-bold">PREVIEW</span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="bg-[#060e20] p-3 rounded-lg border border-[#2d3449]/50 space-y-2">
              <div className="text-[10px] text-[#879391] uppercase">MERCHANT IDENTITY</div>
              <div className="font-sans font-bold text-white text-sm truncate">{name || 'Company name'}</div>
              <div className="text-[#4fdbc8]">/c/{slug || 'slug'}</div>
              <div className="text-[11px] text-[#bcc9c6]">{email || 'admin email'}</div>
              <div className="text-[11px] text-[#bcc9c6]">Owner: {ownerName || '—'}</div>
            </div>

            <div className="bg-[#060e20] p-3 rounded-lg border border-[#2d3449]/50 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#879391]">Vertical:</span>
                <span className="text-white capitalize">{businessType.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#879391]">BRN:</span>
                <span className="text-white">{brn || 'Pending'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#879391]">RAMIS TIN:</span>
                <span className="text-[#4fdbc8] font-semibold">{tin || 'Pending'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#879391]">VAT Rate:</span>
                <span className="text-white">{vatRegistered ? '18% Standard' : 'Exempt'}</span>
              </div>
            </div>

            <div className="bg-[#060e20] p-3 rounded-lg border border-[#2d3449]/50 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#879391]">Plan Tier:</span>
                <span className="text-[#6bd8cb] font-bold capitalize">{plan}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#879391]">Monthly Price:</span>
                <span className="text-white font-bold">
                  {planPricing[plan].price === 0
                    ? 'Free Trial'
                    : `LKR ${planPricing[plan].price.toLocaleString()}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#879391]">Tills Limit:</span>
                <span className="text-white">{countersQuota} Hardware Tills</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#879391]">Cloud Quota:</span>
                <span className="text-white">{storageGb} GB</span>
              </div>
            </div>

            <div className="p-3 bg-[#29a195]/15 border border-[#6bd8cb]/30 rounded-lg text-[11px] text-[#dae2fd] space-y-1">
              <div className="font-bold text-[#6bd8cb] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Row-Level Security Guaranteed
              </div>
              <p className="text-[10px] text-[#bcc9c6]">
                Tenant isolation verified. Automatic backup snapshots configured for Colombo Primary DC.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { ChevronRight, Home, Receipt, Building2, Image as ImageIcon, Loader2, Save } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { SectionCard } from '@/components/ui/section-card'
import { LogoUpload } from '@/components/ui/logo-upload'
import { Button } from '@/components/ui/button'
import { FormInput, FormField, FormSelect, FormCheckbox, FormTextarea } from '@/components/ui/form-elements'
import { hasPermission } from '@/lib/auth/roles'
import {
  DEFAULT_RECEIPT_SETTINGS,
  INVOICE_CODE_TYPES,
  resolveReceiptSettings,
  type InvoiceCodeType,
  type ReceiptSettings,
} from '@/lib/print/receipt-settings'
import { buildReceiptModel, SAMPLE_RECEIPT_SALE } from '@/lib/print/receipt-model'
import { renderReceiptHtml } from '@/lib/print/receipt-html'
import { invalidateTenantInfo } from '@/lib/print/receipt-loader'
import { ReturnsSettingsCard } from '@/components/settings/ReturnsSettingsCard'
import { BusinessIdBadge } from '@/components/settings/BusinessIdBadge'

interface BusinessForm {
  name: string
  legalName: string
  address: string
  phone: string
  email: string
  website: string
  taxId: string
  brn: string
}

const EMPTY_BUSINESS: BusinessForm = { name: '', legalName: '', address: '', phone: '', email: '', website: '', taxId: '', brn: '' }

const INVOICE_CODE_LABELS: Record<InvoiceCodeType, string> = {
  both: 'Barcode + QR code',
  barcode: 'Barcode (CODE128) only',
  qr: 'QR code only',
  none: 'None',
}

const TOGGLES: Array<{ key: keyof ReceiptSettings; label: string }> = [
  { key: 'showLogo', label: 'Logo' },
  { key: 'showLegalName', label: 'Legal / registered name' },
  { key: 'showAddress', label: 'Address' },
  { key: 'showPhone', label: 'Phone' },
  { key: 'showEmail', label: 'Email' },
  { key: 'showWebsite', label: 'Website' },
  { key: 'showTaxId', label: 'VAT / TIN number' },
  { key: 'showBrn', label: 'Business registration (BRN)' },
  { key: 'showCounter', label: 'Counter name' },
  { key: 'showCashier', label: 'Cashier name' },
  { key: 'showCustomer', label: 'Customer name & phone' },
  { key: 'showItemSku', label: 'Item SKU under each line' },
]

const linesToText = (l: string[]) => l.join('\n')
const textToLines = (t: string) =>
  t
    .split('\n')
    .map((s) => s.slice(0, 120))
    .slice(0, 5)

export default function ReceiptSettingsPage() {
  const { data: session, update } = useSession()
  const { tenantSlug } = useCompany()
  const canEdit = hasPermission(session?.user?.role || '', 'manageSettings')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [business, setBusiness] = useState<BusinessForm>(EMPTY_BUSINESS)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [settings, setSettings] = useState<ReceiptSettings>(DEFAULT_RECEIPT_SETTINGS)
  const [headerText, setHeaderText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [currency, setCurrency] = useState<string>('LKR')
  const [previewWidth, setPreviewWidth] = useState<58 | 80>(80)
  const [previewHtml, setPreviewHtml] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/tenant')
        if (!res.ok) throw new Error('Failed to load')
        const t = await res.json()
        if (cancelled) return
        setBusinessId(t.businessId || null)
        setBusiness({
          name: t.name || '',
          legalName: t.legalName || '',
          address: t.address || '',
          phone: t.phone || '',
          email: t.email || '',
          website: t.website || '',
          taxId: t.taxId || '',
          brn: t.brn || '',
        })
        const s = resolveReceiptSettings(t.receiptSettingsRaw ?? t.receiptSettings ?? {})
        setSettings(s)
        setHeaderText(linesToText(s.headerLines))
        setFooterText(linesToText(s.footerLines))
        setLogoUrl(t.logoUrl || null)
        setCurrency(t.currency || 'LKR')
      } catch {
        toast.error('Failed to load business profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const effective: ReceiptSettings = useMemo(
    () => ({
      ...settings,
      headerLines: textToLines(headerText).map((l) => l.trim()).filter(Boolean),
      footerLines: textToLines(footerText).map((l) => l.trim()).filter(Boolean),
    }),
    [settings, headerText, footerText]
  )

  // Live preview
  useEffect(() => {
    let cancelled = false
    const model = buildReceiptModel({
      sale: SAMPLE_RECEIPT_SALE,
      tenant: { ...business, logoUrl, currency },
      settings: effective,
      cashier: session?.user?.name || 'Cashier',
      counter: 'Counter 1',
    })
    renderReceiptHtml(model, previewWidth, { logoSrc: logoUrl }).then((html) => {
      if (!cancelled) setPreviewHtml(html)
    })
    return () => {
      cancelled = true
    }
  }, [business, effective, logoUrl, currency, previewWidth, session?.user?.name])

  const set = <K extends keyof ReceiptSettings>(key: K, value: ReceiptSettings[K]) => setSettings((s) => ({ ...s, [key]: value }))
  const setB = (key: keyof BusinessForm, value: string) => setBusiness((b) => ({ ...b, [key]: value }))

  async function save() {
    if (!business.name.trim()) {
      toast.error('Business name is required')
      return
    }
    if (business.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email.trim())) {
      toast.error('Enter a valid email address')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: business.name.trim(),
          legalName: business.legalName.trim() || null,
          address: business.address.trim() || null,
          phone: business.phone.trim() || null,
          ...(business.email.trim() ? { email: business.email.trim() } : {}),
          website: business.website.trim() || null,
          taxId: business.taxId.trim() || null,
          brn: business.brn.trim() || null,
          receiptSettings: { ...effective, returnPolicy: effective.returnPolicy.trim() },
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to save')
        return
      }
      invalidateTenantInfo()
      toast.success('Business profile & receipt saved')
      if (business.name.trim() !== session?.user?.tenantName) update().catch(() => {})
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}`} className="hover:text-gray-700 dark:hover:text-gray-300">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/settings`} className="hover:text-gray-700 dark:hover:text-gray-300">
          Settings
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Business Profile &amp; Receipt</span>
      </nav>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Business Profile &amp; Receipt</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Details printed on receipts and invoices. POS profiles can override header, footer, logo and invoice code per counter.
          </p>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
            Save
          </Button>
        )}
      </div>

      {!canEdit && (
        <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm p-3">
          You can view these settings but need the Manage Settings permission to change them.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6">
          <SectionCard title="Business details" icon={<Building2 size={16} />}>
            {businessId && (
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Business ID</div>
                <BusinessIdBadge businessId={businessId} variant="field" />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Permanent ID of this business. Staff enter it to sign in on the web and in the mobile app. It never changes.
                </p>
              </div>
            )}
            <fieldset disabled={!canEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Trading name" required>
                <FormInput value={business.name} onChange={(e) => setB('name', e.target.value)} maxLength={255} />
              </FormField>
              <FormField label="Legal / registered name" optional>
                <FormInput value={business.legalName} onChange={(e) => setB('legalName', e.target.value)} maxLength={255} placeholder="e.g. ABC Traders (Pvt) Ltd" />
              </FormField>
              <FormField label="Address" className="sm:col-span-2">
                <FormTextarea value={business.address} onChange={(e) => setB('address', e.target.value)} maxLength={500} rows={2} />
              </FormField>
              <FormField label="Phone">
                <FormInput value={business.phone} onChange={(e) => setB('phone', e.target.value)} maxLength={50} />
              </FormField>
              <FormField label="Email">
                <FormInput type="email" value={business.email} onChange={(e) => setB('email', e.target.value)} maxLength={255} />
              </FormField>
              <FormField label="Website" optional>
                <FormInput value={business.website} onChange={(e) => setB('website', e.target.value)} maxLength={255} placeholder="www.example.lk" />
              </FormField>
              <FormField label="VAT / TIN number" optional>
                <FormInput value={business.taxId} onChange={(e) => setB('taxId', e.target.value)} maxLength={50} />
              </FormField>
              <FormField label="Business registration no. (BRN)" optional>
                <FormInput value={business.brn} onChange={(e) => setB('brn', e.target.value)} maxLength={50} />
              </FormField>
            </fieldset>
          </SectionCard>

          <SectionCard title="Logo" icon={<ImageIcon size={16} />}>
            {canEdit ? (
              <LogoUpload
                currentLogoUrl={logoUrl}
                onLogoUploaded={(url) => {
                  setLogoUrl(url)
                  invalidateTenantInfo()
                  update().catch(() => {})
                  toast.success('Logo uploaded')
                }}
                onLogoRemoved={() => {
                  setLogoUrl(null)
                  invalidateTenantInfo()
                  update().catch(() => {})
                  toast.success('Logo removed')
                }}
                maxSizeMB={2}
              />
            ) : (
              <p className="text-sm text-gray-500">{logoUrl ? 'Logo uploaded.' : 'No logo.'}</p>
            )}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label={`Logo width on receipt: ${settings.logoWidthPct}%`}>
                <input
                  type="range"
                  min={40}
                  max={100}
                  step={5}
                  disabled={!canEdit}
                  value={settings.logoWidthPct}
                  onChange={(e) => set('logoWidthPct', Number(e.target.value))}
                  className="w-full"
                />
              </FormField>
              <p className="text-xs text-gray-500 dark:text-gray-400 self-end">
                Thermal printers print the logo in black &amp; white (dithered). High-contrast logos on a white or transparent
                background work best.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Receipt layout" icon={<Receipt size={16} />}>
            <fieldset disabled={!canEdit} className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Show on receipt</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TOGGLES.map((t) => (
                    <FormCheckbox
                      key={t.key}
                      label={t.label}
                      checked={!!settings[t.key]}
                      onChange={(e) => set(t.key, e.target.checked as never)}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Header lines" hint="Up to 5 lines, printed under the business details">
                  <FormTextarea value={headerText} onChange={(e) => setHeaderText(linesToText(textToLines(e.target.value)))} rows={3} />
                </FormField>
                <FormField label="Footer lines" hint="Up to 5 lines (default: Thank you for your purchase!)">
                  <FormTextarea value={footerText} onChange={(e) => setFooterText(linesToText(textToLines(e.target.value)))} rows={3} />
                </FormField>
              </div>
              <FormField label="Return / exchange policy" hint={`${settings.returnPolicy.length}/300`}>
                <FormTextarea
                  value={settings.returnPolicy}
                  onChange={(e) => set('returnPolicy', e.target.value.slice(0, 300))}
                  rows={2}
                  placeholder="e.g. Exchanges within 7 days with this receipt. No cash refunds."
                />
              </FormField>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Invoice number code">
                  <FormSelect value={settings.invoiceCode} onChange={(e) => set('invoiceCode', e.target.value as InvoiceCodeType)}>
                    {INVOICE_CODE_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {INVOICE_CODE_LABELS[c]}
                      </option>
                    ))}
                  </FormSelect>
                </FormField>
                <FormField label="Font size">
                  <FormSelect value={settings.fontSize} onChange={(e) => set('fontSize', e.target.value === 'large' ? 'large' : 'normal')}>
                    <option value="normal">Normal</option>
                    <option value="large">Large (easier to read)</option>
                  </FormSelect>
                </FormField>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                The barcode / QR encodes the invoice number so returns can be looked up by scanning the receipt.
              </p>
            </fieldset>
          </SectionCard>

          <ReturnsSettingsCard canEdit={canEdit} />
        </div>

        {/* Live preview */}
        <div className="xl:sticky xl:top-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Live preview</h2>
            <div className="inline-flex rounded border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
              {([58, 80] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setPreviewWidth(w)}
                  className={`px-3 py-1 ${previewWidth === w ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-white dark:bg-gray-800'}`}
                >
                  {w}mm
                </button>
              ))}
            </div>
          </div>
          <div className="bg-gray-100 dark:bg-gray-900 rounded p-4 flex justify-center overflow-x-auto">
            <div
              className="bg-white shadow-md p-3"
              style={{ width: previewWidth === 58 ? 220 : 302 }}
              // Receipt HTML escapes all tenant text; SVGs are generated by bwip-js.
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Sample sale. Raw thermal printers print the same content in their own fonts.</p>
        </div>
      </div>
    </div>
  )
}

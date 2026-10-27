'use client'

/**
 * Print template designer (drizzle/0179): Zoho-style editor for invoice / quotation templates.
 * Left: icon rail + settings panel; right: live preview (iframe srcdoc of renderInvoiceHtml) of
 * sample data or a real recent sale / quotation. Saves print_templates.config via PUT /api/print-templates/[id].
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Settings2, PanelTop, Building2, Table2, Calculator, StickyNote, RefreshCw, Save, X, Loader2, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import {
  INVOICE_COLUMN_KEYS,
  INVOICE_DATE_FORMATS,
  INVOICE_FONT_STACKS,
  INVOICE_PAPER_MM,
  renderInvoiceHtml,
  sampleInvoiceDoc,
  templateConfigFromRow,
  type InvoiceColumnKey,
  type InvoiceCompany,
  type InvoiceDoc,
  type InvoiceDocKind,
  type InvoiceTemplateConfig,
  type LabeledToggle,
} from '@/lib/print/invoice-template'
import { companyFromTenant, loadSaleDocument, quotationToDoc, type PrintTemplateRow, type QuotationApi } from '@/lib/print/invoice-document'
import { fetchTenantInfo } from '@/lib/print/receipt-loader'

type TabKey = 'general' | 'header' | 'details' | 'table' | 'totals' | 'other'

const TABS: Array<{ key: TabKey; label: string; icon: typeof Settings2 }> = [
  { key: 'general', label: 'General', icon: Settings2 },
  { key: 'header', label: 'Header & Footer', icon: PanelTop },
  { key: 'details', label: 'Transaction Details', icon: Building2 },
  { key: 'table', label: 'Table', icon: Table2 },
  { key: 'totals', label: 'Total', icon: Calculator },
  { key: 'other', label: 'Other Details', icon: StickyNote },
]

const COLUMN_LABELS: Record<InvoiceColumnKey, string> = {
  lineNo: 'Line #', item: 'Item', description: 'Description', sku: 'Item code / SKU', serial: 'Serial No.',
  warranty: 'Warranty', qty: 'Quantity', unit: 'Unit', rate: 'Rate', discount: 'Discount', taxRate: 'Tax %',
  taxAmount: 'Tax amount', amount: 'Amount',
}

const MAX_IMAGE_BYTES = 1024 * 1024

/** Immutable set of a dotted path. */
function setIn<T>(obj: T, path: string[], value: unknown): T {
  if (!path.length) return value as T
  const [k, ...rest] = path
  const src = (obj ?? {}) as Record<string, unknown>
  return { ...src, [k]: setIn(src[k], rest, value) } as T
}

function getIn(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-4 last:border-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" />
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
    </label>
  )
}

function ColorInput({ value, onChange, placeholder = 'auto' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 rounded border border-gray-300 dark:border-gray-600 bg-transparent" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      {value && <button type="button" onClick={() => onChange('')} className="text-xs text-gray-400 hover:text-red-500" title="Clear">✕</button>}
    </div>
  )
}

function ImageInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.type)) { toast.error('Use a PNG, JPG, GIF, WebP or SVG image'); return }
    if (file.size > MAX_IMAGE_BYTES) { toast.error('Image must be under 1 MB'); return }
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result || ''))
    reader.onerror = () => toast.error('Could not read the image')
    reader.readAsDataURL(file)
  }
  return (
    <div className="space-y-2">
      {value && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={value} alt="" className="max-h-16 max-w-full rounded border border-gray-200 dark:border-gray-700 bg-white" />
      )}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">
          <ImagePlus size={14} /> Upload
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange('')} className="flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 size={12} /> Remove</button>
        )}
      </div>
      <input
        value={value.startsWith('data:') ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={value.startsWith('data:') ? 'Uploaded image (max 1 MB)' : 'or image URL: https://…'}
        className={inputCls}
      />
    </div>
  )
}

/** Zoom the preview's paper sheet down so the whole page width fits the preview pane. */
function fitPreview(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument
  const sheet = doc?.querySelector<HTMLElement>('.sheet')
  if (!doc || !sheet) return
  doc.documentElement.style.zoom = ''
  const z = Math.min(1, frame.clientWidth / (sheet.offsetWidth + 32))
  doc.documentElement.style.zoom = z < 1 ? String(Math.floor(z * 1000) / 1000) : ''
}

/** Callback ref: refit whenever the pane is resized. */
function observePreview(frame: HTMLIFrameElement | null) {
  if (!frame) return
  const ro = new ResizeObserver(() => fitPreview(frame))
  ro.observe(frame)
  return () => ro.disconnect()
}

export default function PrintTemplateDesignerPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const id = params.id as string

  const [row, setRow] = useState<PrintTemplateRow | null>(null)
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<InvoiceTemplateConfig | null>(null)
  const [tab, setTab] = useState<TabKey>('general')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const [company, setCompany] = useState<InvoiceCompany>({})
  const [source, setSource] = useState('sample:invoice')
  const [realDoc, setRealDoc] = useState<InvoiceDoc | null>(null)
  const [recentSales, setRecentSales] = useState<Array<{ id: string; invoiceNo: string; customerName?: string | null }>>([])
  const [recentQuotes, setRecentQuotes] = useState<QuotationApi[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [previewCfg, setPreviewCfg] = useState<InvoiceTemplateConfig | null>(null)
  const [previewNonce, setPreviewNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/print-templates/${id}`)
        const data = await res.json()
        if (!res.ok) { if (!cancelled) setLoadError(data.error || 'Template not found'); return }
        const t = data as PrintTemplateRow
        const c = templateConfigFromRow(t)
        if (cancelled) return
        setRow(t)
        setName(t.name)
        setCfg(c)
        setPreviewCfg(c)
        if (t.documentType === 'quotation' || t.documentType === 'estimate') setSource('sample:quotation')
      } catch {
        if (!cancelled) setLoadError('Failed to load template')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    fetchTenantInfo().then((t) => { if (!cancelled) setCompany(companyFromTenant(t)) }).catch(() => {})
    fetch('/api/sales?pageSize=10')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setRecentSales((Array.isArray(d) ? d : d.data || []).slice(0, 10)) })
      .catch(() => {})
    fetch('/api/quotations')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.quotations) setRecentQuotes((d.quotations as QuotationApi[]).slice(0, 10)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [id])

  // Real document for the preview
  useEffect(() => {
    let cancelled = false
    const [kind, ref] = source.split(':')
    if (kind === 'sale' && ref) {
      loadSaleDocument(ref)
        .then(({ doc }) => { if (!cancelled) setRealDoc(doc) })
        .catch((e) => { if (!cancelled) { toast.error(e instanceof Error ? e.message : 'Failed to load sale'); setSource('sample:invoice') } })
    } else if (kind === 'quote' && ref) {
      const q = recentQuotes.find((x) => x.id === ref)
      if (q) Promise.resolve().then(() => { if (!cancelled) setRealDoc(quotationToDoc(q)) })
    }
    return () => { cancelled = true }
  }, [source, recentQuotes, previewNonce])

  const update = useCallback((path: string, value: unknown) => {
    setCfg((prev) => (prev ? setIn(prev, path.split('.'), value) : prev))
    setDirty(true)
  }, [])

  const deferredCfg = useDeferredValue(cfg)
  const shownCfg = autoRefresh ? deferredCfg : previewCfg
  const doc = useMemo<InvoiceDoc>(() => {
    const [kind, ref] = source.split(':')
    if ((kind === 'sale' || kind === 'quote') && ref && realDoc) return realDoc
    return sampleInvoiceDoc((kind === 'sample' ? ref : 'invoice') as InvoiceDocKind)
  }, [source, realDoc])
  const html = useMemo(
    () => (shownCfg ? renderInvoiceHtml(shownCfg, doc, company, { preview: true }) : ''),
    // previewNonce forces a re-render on "Refresh Preview"
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownCfg, doc, company, previewNonce],
  )

  function refreshPreview() {
    setPreviewCfg(cfg)
    setPreviewNonce((n) => n + 1)
  }

  async function save() {
    if (!cfg) return
    if (!name.trim()) { toast.error('Template name is required'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/print-templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          paperSize: cfg.general.paperSize,
          orientation: cfg.general.orientation,
          showLogo: cfg.organization.showLogo,
          showHeader: cfg.header.show,
          showFooter: cfg.footer.show,
          // JSON string: keeps intentionally empty labels / texts (see printTemplateConfigSchema)
          config: JSON.stringify(cfg),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Failed to save template')
        return
      }
      toast.success('Template saved')
      setDirty(false)
      refreshPreview()
    } catch {
      toast.error('Error saving template')
    } finally {
      setSaving(false)
    }
  }

  function close() {
    if (dirty && !confirm('Discard unsaved changes?')) return
    router.push(`/c/${slug}/settings/print-templates`)
  }

  if (loading) {
    return <div className="p-10 text-center"><Loader2 size={24} className="animate-spin mx-auto text-gray-400" /></div>
  }
  if (loadError || !cfg || !row) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-gray-600 dark:text-gray-300">{loadError || 'Template not found'}</p>
        <Link href={`/c/${slug}/settings/print-templates`} className="text-blue-600 hover:underline text-sm">Back to print templates</Link>
      </div>
    )
  }

  // Bound helpers for the current config
  const str = (path: string) => String(getIn(cfg, path) ?? '')
  const numv = (path: string) => Number(getIn(cfg, path) ?? 0)
  const bool = (path: string) => !!getIn(cfg, path)
  const T = (path: string, label: string) => <Toggle label={label} checked={bool(path)} onChange={(v) => update(path, v)} />
  const Txt = (path: string, label: string, placeholder?: string) => (
    <Field label={label}><input value={str(path)} placeholder={placeholder} onChange={(e) => update(path, e.target.value)} className={inputCls} /></Field>
  )
  const Num = (path: string, label: string, step = 1, min = 0, max = 100, hint?: string) => (
    <Field label={label} hint={hint}>
      <input type="number" value={numv(path)} step={step} min={min} max={max} onChange={(e) => update(path, e.target.value === '' ? min : Number(e.target.value))} className={inputCls} />
    </Field>
  )
  const Area = (path: string, label: string, rows = 3, placeholder?: string, hint?: string) => (
    <Field label={label} hint={hint}><textarea rows={rows} value={str(path)} placeholder={placeholder} onChange={(e) => update(path, e.target.value)} className={inputCls} /></Field>
  )
  const Color = (path: string, label: string) => <Field label={label}><ColorInput value={str(path)} onChange={(v) => update(path, v)} /></Field>
  const Sel = (path: string, label: string, options: Array<{ value: string; label: string }>) => (
    <Field label={label}>
      <select value={str(path)} onChange={(e) => update(path, e.target.value)} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
  const Img = (path: string, label: string) => <Field label={label}><ImageInput value={str(path)} onChange={(v) => update(path, v)} /></Field>
  const LT = (path: string, title: string) => {
    const v = getIn(cfg, path) as LabeledToggle
    return (
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={v.show} onChange={(e) => update(`${path}.show`, e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" title={`Show ${title}`} />
        <span className="w-28 shrink-0 text-sm text-gray-700 dark:text-gray-300">{title}</span>
        <input value={v.label} onChange={(e) => update(`${path}.label`, e.target.value)} disabled={!v.show} placeholder="Label" className={`${inputCls} disabled:opacity-50`} />
      </div>
    )
  }
  const band = (key: 'header' | 'footer') => (
    <Section title={key === 'header' ? 'Header' : 'Footer'}>
      {T(`${key}.show`, key === 'header' ? 'Show page header' : 'Show page footer')}
      {bool(`${key}.show`) && (
        <>
          {Img(`${key}.backgroundImage`, 'Image')}
          {Sel(`${key}.imagePosition`, 'Image position', [
            { value: 'cover', label: 'Fill (background)' }, { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' },
          ])}
          {Color(`${key}.backgroundColor`, 'Background colour')}
          {Color(`${key}.textColor`, 'Text colour')}
          {Area(`${key}.text`, key === 'header' ? 'Header text' : 'Footer text', 2)}
          <div className="grid grid-cols-3 gap-2">
            {Sel(`${key}.textAlign`, 'Align', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }])}
            {Num(`${key}.fontSize`, 'Font (pt)', 1, 5, 40)}
            {Num(`${key}.height`, 'Height (in)', 0.1, 0, 6)}
          </div>
          {T(`${key}.firstPageOnly`, key === 'header' ? 'Apply to first page only' : 'Only at the end of the document (not on every page)')}
          {key === 'footer' && T('footer.showPageNumber', 'Show page number')}
        </>
      )}
    </Section>
  )

  const panels: Record<TabKey, React.ReactNode> = {
    general: (
      <>
        <Section title="Template">
          <Field label="Template name"><input value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-2">
            {Sel('general.paperSize', 'Paper size', Object.entries(INVOICE_PAPER_MM).map(([value, p]) => ({ value, label: p.label })))}
            {Sel('general.orientation', 'Orientation', [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }])}
          </div>
        </Section>
        <Section title="Margins (inches)">
          <div className="grid grid-cols-4 gap-2">
            {Num('general.margins.top', 'Top', 0.05, 0, 3)}
            {Num('general.margins.bottom', 'Bottom', 0.05, 0, 3)}
            {Num('general.margins.left', 'Left', 0.05, 0, 3)}
            {Num('general.margins.right', 'Right', 0.05, 0, 3)}
          </div>
        </Section>
        <Section title="Font & colours">
          <div className="grid grid-cols-2 gap-2">
            {Sel('general.fontFamily', 'Font', Object.entries(INVOICE_FONT_STACKS).map(([value, f]) => ({ value, label: f.label })))}
            {Num('general.fontSize', 'Font size (pt)', 0.5, 5, 40)}
          </div>
          {Color('general.textColor', 'Text colour')}
          {Color('general.accentColor', 'Accent colour')}
          {Sel('general.dateFormat', 'Date format', INVOICE_DATE_FORMATS.map((f) => ({ value: f, label: f })))}
        </Section>
        <Section title="Background">
          {Color('general.backgroundColor', 'Background colour')}
          {Img('general.backgroundImage', 'Background image')}
        </Section>
        <Section title="Document title">
          {T('titles.show', 'Show document title')}
          <div className="grid grid-cols-2 gap-2">
            {Txt('titles.invoice', 'Invoice')}
            {Txt('titles.taxInvoice', 'Tax invoice')}
            {Txt('titles.quotation', 'Quotation')}
            {Txt('titles.creditNote', 'Credit note')}
            {Num('titles.fontSize', 'Title size (pt)', 1, 5, 40)}
          </div>
          {Color('titles.color', 'Title colour')}
        </Section>
        <Section title="Payment stub">
          {T('general.includePaymentStub', 'Include payment stub (tear-off slip at the end of invoices)')}
        </Section>
        <Section title="Advanced">
          {Area('customCss', 'Custom CSS', 4, '.org-name { letter-spacing: 1px; }')}
        </Section>
      </>
    ),
    header: <>{band('header')}{band('footer')}</>,
    details: (
      <>
        <Section title="Organisation">
          {T('organization.showLogo', 'Show logo')}
          {bool('organization.showLogo') && (
            <>
              {Img('organization.logoUrl', 'Logo (empty = company logo)')}
              {Num('organization.logoHeight', 'Logo height (px)', 2, 10, 300)}
            </>
          )}
          {T('organization.showName', 'Show organisation name')}
          {bool('organization.showName') && (
            <div className="grid grid-cols-2 gap-2">
              {Num('organization.nameFontSize', 'Name size (pt)', 1, 6, 48)}
              {Color('organization.nameColor', 'Name colour')}
            </div>
          )}
          {T('organization.showLegalName', 'Show legal name (when different)')}
          {T('organization.showAddress', 'Show address')}
          {bool('organization.showAddress') && Area('organization.addressFormat', 'Address format', 5, undefined, 'Placeholders: {address} {phone} {email} {website} {taxId} {brn}. Lines without data are left out.')}
        </Section>
        <Section title="Customer">
          {T('customer.showBillTo', 'Show Bill To')}
          {bool('customer.showBillTo') && Txt('customer.billToLabel', 'Bill To label')}
          {T('customer.showShipTo', 'Show Ship To')}
          {bool('customer.showShipTo') && Txt('customer.shipToLabel', 'Ship To label')}
          {T('customer.showPhone', 'Customer phone')}
          {T('customer.showEmail', 'Customer email')}
          {T('customer.showTaxId', 'Customer VAT / tax number')}
          {bool('customer.showTaxId') && Txt('customer.taxIdLabel', 'Tax number label')}
        </Section>
        <Section title="Document details (tick to show, edit label)">
          {LT('documentDetails.number', 'Number')}
          {LT('documentDetails.date', 'Date')}
          {LT('documentDetails.terms', 'Terms')}
          {LT('documentDetails.dueDate', 'Due date')}
          {LT('documentDetails.validUntil', 'Valid until')}
          {LT('documentDetails.reference', 'P.O. / Reference')}
          {LT('documentDetails.salesperson', 'Sales person')}
          {LT('documentDetails.originalInvoice', 'Original invoice')}
          {LT('documentDetails.status', 'Status')}
        </Section>
      </>
    ),
    table: (
      <>
        <Section title="Columns (show, width %, label)">
          {INVOICE_COLUMN_KEYS.map((k) => {
            const c = cfg.table.columns[k]
            return (
              <div key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={c.show} onChange={(e) => update(`table.columns.${k}.show`, e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" />
                <span className="w-24 shrink-0 text-xs text-gray-700 dark:text-gray-300">{COLUMN_LABELS[k]}</span>
                <input type="number" min={0} max={100} value={c.width} disabled={!c.show} title="Width % (0 = auto)"
                  onChange={(e) => update(`table.columns.${k}.width`, Number(e.target.value) || 0)}
                  className={`${inputCls} !w-16 disabled:opacity-50`} />
                <input value={c.label} disabled={!c.show} onChange={(e) => update(`table.columns.${k}.label`, e.target.value)} className={`${inputCls} disabled:opacity-50`} />
              </div>
            )
          })}
          <p className="text-[11px] text-gray-400">
            Width 0 = automatic. Total width in use: {INVOICE_COLUMN_KEYS.filter((k) => cfg.table.columns[k].show).reduce((s, k) => s + cfg.table.columns[k].width, 0)}%
          </p>
          {T('table.extrasUnderItem', 'Print serial numbers / warranty under the item name when their columns are hidden')}
        </Section>
        <Section title="Style">
          {Color('table.headerBackground', 'Header background')}
          {Color('table.headerTextColor', 'Header text colour')}
          {Color('table.borderColor', 'Row border colour')}
          {T('table.striped', 'Striped rows')}
          {bool('table.striped') && Color('table.stripeColor', 'Stripe colour')}
          {Num('table.fontSize', 'Font size (pt)', 0.5, 5, 40)}
        </Section>
      </>
    ),
    totals: (
      <>
        <Section title="Rows (tick to show, edit label)">
          {LT('totals.subTotal', 'Sub total')}
          {LT('totals.shipping', 'Shipping')}
          {LT('totals.discount', 'Discount')}
          {LT('totals.taxableAmount', 'Taxable amount')}
          {LT('totals.taxDetails', 'Tax details')}
          {LT('totals.total', 'Total')}
        </Section>
        <Section title="Payment details (invoices)">
          {LT('totals.paymentMade', 'Payment made')}
          {LT('totals.credits', 'Credits')}
          {LT('totals.balanceDue', 'Balance due')}
        </Section>
        <Section title="Currency & words">
          <div className="grid grid-cols-2 gap-2">
            {Txt('totals.currencySymbol', 'Currency symbol', company.currency || 'LKR')}
            {Sel('totals.symbolPosition', 'Symbol position', [{ value: 'before', label: 'Before amount' }, { value: 'after', label: 'After amount' }])}
          </div>
          {LT('totals.amountInWords', 'Amount in words')}
          {Color('totals.totalBackground', 'Total row background')}
          {Color('totals.totalTextColor', 'Total row text colour')}
        </Section>
      </>
    ),
    other: (
      <>
        <Section title="Notes">
          {T('other.notes.show', 'Show document notes')}
          <div className="grid grid-cols-2 gap-2">
            {Txt('other.notes.label', 'Label')}
            {Num('other.notes.fontSize', 'Font size (pt)', 0.5, 5, 40)}
          </div>
        </Section>
        <Section title="Payment options / bank details">
          {T('other.paymentOptions.show', 'Show')}
          {Txt('other.paymentOptions.label', 'Label')}
          {Area('other.paymentOptions.text', 'Text', 4, 'Bank: Commercial Bank\nA/C name: …\nA/C no: …\nBranch: …')}
        </Section>
        <Section title="Terms & conditions">
          {T('other.terms.show', 'Show')}
          <div className="grid grid-cols-2 gap-2">
            {Txt('other.terms.label', 'Label')}
            {Num('other.terms.fontSize', 'Font size (pt)', 0.5, 5, 40)}
          </div>
          {Area('other.terms.text', 'Text', 5, 'Warranty covers manufacturing defects only. Physical / water damage not covered. Keep this invoice for warranty claims.')}
        </Section>
        <Section title="Signature">
          {T('other.signature.show', 'Show signature')}
          {Txt('other.signature.label', 'Label')}
          {Txt('other.signature.name', 'Name / designation (optional)')}
          {Img('other.signature.imageUrl', 'Signature image (optional)')}
        </Section>
        <Section title="Annexure">
          {T('other.annexure.show', 'Print an annexure page')}
          {Txt('other.annexure.label', 'Title')}
          {Area('other.annexure.text', 'Text', 5)}
        </Section>
      </>
    ),
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] min-h-[600px] bg-gray-50 dark:bg-gray-900">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="min-w-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <Link href={`/c/${slug}/settings/print-templates`} className="hover:text-blue-600">Print Templates</Link> / Designer
          </div>
          <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate">{name || 'Untitled template'}{dirty ? ' •' : ''}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={refreshPreview} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <RefreshCw size={14} /> Refresh Preview
          </button>
          <button type="button" onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button type="button" onClick={close} className="p-1.5 text-gray-500 hover:text-gray-800 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Icon rail */}
        <nav className="flex lg:flex-col gap-1 p-2 bg-white dark:bg-gray-800 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} title={t.label}
                className={`flex flex-col items-center gap-0.5 w-20 shrink-0 px-1 py-2 rounded text-[10px] leading-tight text-center transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                <Icon size={18} />
                {t.label}
              </button>
            )
          })}
        </nav>

        {/* Settings panel */}
        <div className="w-full lg:w-[360px] shrink-0 overflow-y-auto p-4 bg-white dark:bg-gray-800 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 max-h-[50vh] lg:max-h-none">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{TABS.find((t) => t.key === tab)?.label}</h2>
          {panels[tab]}
        </div>

        {/* Preview */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Preview with</span>
            <select value={source} onChange={(e) => { setRealDoc(null); setSource(e.target.value) }} className={`${inputCls} !w-auto`}>
              <optgroup label="Sample data">
                <option value="sample:invoice">Sample invoice</option>
                <option value="sample:tax_invoice">Sample tax invoice</option>
                <option value="sample:quotation">Sample quotation</option>
                <option value="sample:credit_note">Sample credit note</option>
              </optgroup>
              {recentSales.length > 0 && (
                <optgroup label="Recent sales">
                  {recentSales.map((s) => <option key={s.id} value={`sale:${s.id}`}>{s.invoiceNo}{s.customerName ? ` — ${s.customerName}` : ''}</option>)}
                </optgroup>
              )}
              {recentQuotes.length > 0 && (
                <optgroup label="Recent quotations">
                  {recentQuotes.map((q) => <option key={q.id} value={`quote:${q.id}`}>{q.quotationNo}{q.customerName ? ` — ${q.customerName}` : ''}</option>)}
                </optgroup>
              )}
            </select>
            <Toggle label="Live preview" checked={autoRefresh} onChange={(v) => { setAutoRefresh(v); if (!v) setPreviewCfg(cfg) }} />
          </div>
          <iframe
            key={previewNonce}
            title="Template preview"
            srcDoc={html}
            sandbox="allow-same-origin"
            onLoad={(e) => fitPreview(e.currentTarget)}
            ref={observePreview}
            className="flex-1 w-full border-0 bg-gray-200 min-h-[500px]"
          />
        </div>
      </div>
    </div>
  )
}

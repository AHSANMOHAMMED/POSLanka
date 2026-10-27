'use client'

/**
 * Browser-side loaders for A4 document printing (drizzle/0179): a sale or quotation turned into
 * the InvoiceDoc shape of invoice-template.ts, the print template to use, and a print helper.
 *
 * Data comes from the existing tenant-scoped APIs (GET /api/sales/[id] applies the K4 branch
 * check; /api/quotations/[id]; /api/serial-numbers/by-ids; /api/tenant), so no extra access
 * rules live here.
 */
import { fetchTenantInfo, type TenantReceiptInfo } from './receipt-loader'
import {
  renderInvoiceHtml,
  templateConfigFromRow,
  type InvoiceCompany,
  type InvoiceDoc,
  type InvoiceDocLine,
  type InvoiceTemplateConfig,
} from './invoice-template'

type Num = string | number | null | undefined
const n = (v: Num): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

export interface PrintTemplateRow {
  id: string
  name: string
  documentType: string
  isDefault: boolean
  isActive: boolean
  paperSize?: string | null
  orientation?: string | null
  margins?: { top: number; right: number; bottom: number; left: number } | null
  showLogo?: boolean | null
  showHeader?: boolean | null
  showFooter?: boolean | null
  customCss?: string | null
  config?: unknown
}

/** Template document types used for each printable document (first match wins). */
export const TEMPLATE_DOC_TYPES = {
  sale: ['invoice', 'sales_invoice'],
  quotation: ['quotation', 'estimate'],
} as const

/** Active templates of the given document types (in the given type order, defaults first). */
export async function fetchPrintTemplates(documentTypes: readonly string[]): Promise<PrintTemplateRow[]> {
  const lists = await Promise.all(documentTypes.map(async (dt) => {
    try {
      const res = await fetch(`/api/print-templates?documentType=${encodeURIComponent(dt)}`)
      if (!res.ok) return []
      const rows = (await res.json()) as PrintTemplateRow[]
      return Array.isArray(rows) ? rows.filter((r) => r.isActive !== false) : []
    } catch {
      return []
    }
  }))
  return lists.flatMap((rows) => [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)))
}

/** The template config to print with: the chosen template, else the default, else built-in defaults. */
export function pickTemplateConfig(templates: PrintTemplateRow[], templateId?: string | null): InvoiceTemplateConfig {
  const row = (templateId && templates.find((t) => t.id === templateId)) || templates.find((t) => t.isDefault) || templates[0]
  return templateConfigFromRow(row)
}

export function companyFromTenant(t: TenantReceiptInfo | Record<string, unknown> | null | undefined): InvoiceCompany {
  const x = (t || {}) as unknown as Record<string, unknown>
  const s = (k: string) => (typeof x[k] === 'string' ? (x[k] as string) : null)
  return {
    name: s('name'),
    legalName: s('legalName'),
    address: s('address'),
    phone: s('phone'),
    email: s('email'),
    website: s('website'),
    taxId: s('taxId'),
    brn: s('brn'),
    logoUrl: s('logoUrl'),
    currency: s('currency') || 'LKR',
  }
}

// ─── Sale → InvoiceDoc ─────────────────────────────────────────────────────

interface SaleItemApi {
  itemName: string
  quantity: Num
  unitPrice: Num
  discount?: Num
  taxRate?: Num
  taxAmount?: Num
  total: Num
  uom?: string | null
  serialNumberIds?: string[] | null
  warrantyMonths?: number | null
  warrantyUntil?: string | null
  item?: { sku?: string | null; unit?: string | null; description?: string | null } | null
}

interface SaleApi {
  id: string
  invoiceNo: string
  createdAt: string
  status?: string | null
  isReturn?: boolean
  returnAgainst?: string | null
  customerName?: string | null
  customer?: {
    name?: string | null; phone?: string | null; mobilePhone?: string | null; email?: string | null; taxId?: string | null
    address?: string | null; addressLine1?: string | null; addressLine2?: string | null; city?: string | null
  } | null
  subtotal: Num
  discountAmount?: Num
  taxAmount?: Num
  taxBreakdown?: Array<{ taxName?: string; rate?: number; amount?: number }> | null
  total: Num
  paidAmount?: Num
  notes?: string | null
  user?: { fullName?: string | null } | null
  items?: SaleItemApi[]
}

async function fetchSerials(ids: string[]): Promise<Map<string, { serialNumber: string; warrantyEndDate?: string | null }>> {
  const map = new Map<string, { serialNumber: string; warrantyEndDate?: string | null }>()
  if (!ids.length) return map
  try {
    // by-ids caps at 100 per request
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const res = await fetch(`/api/serial-numbers/by-ids?ids=${chunk.map(encodeURIComponent).join(',')}`)
      if (!res.ok) continue
      const rows = (await res.json()) as Array<{ id: string; serialNumber: string; warrantyEndDate?: string | null }>
      rows.forEach((r) => map.set(r.id, r))
    }
  } catch {
    /* non-critical */
  }
  return map
}

function addressOf(c: SaleApi['customer']): string | null {
  if (!c) return null
  const parts = [c.addressLine1, c.addressLine2, c.city].filter((p) => p && p.trim())
  return parts.length ? parts.join('\n') : c.address || null
}

export async function loadSaleDocument(saleId: string): Promise<{ doc: InvoiceDoc; company: InvoiceCompany; tenant: TenantReceiptInfo }> {
  const [res, tenant] = await Promise.all([fetch(`/api/sales/${saleId}`), fetchTenantInfo()])
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Failed to load sale')
  }
  const sale = (await res.json()) as SaleApi
  const items = sale.items || []
  const serials = await fetchSerials(items.flatMap((i) => i.serialNumberIds || []))

  let originalInvoiceNo: string | null = null
  if (sale.isReturn && sale.returnAgainst) {
    try {
      const o = await fetch(`/api/sales/${sale.returnAgainst}`)
      if (o.ok) originalInvoiceNo = ((await o.json()) as SaleApi).invoiceNo
    } catch {
      /* ignore */
    }
  }

  const lines: InvoiceDocLine[] = items.map((it) => {
    const sns = (it.serialNumberIds || []).map((id) => serials.get(id)).filter(Boolean) as Array<{ serialNumber: string; warrantyEndDate?: string | null }>
    const serialUntil = sns.map((s) => s.warrantyEndDate).filter(Boolean).sort().pop() || null
    return {
      name: it.itemName,
      description: it.item?.description || null,
      sku: it.item?.sku || null,
      quantity: n(it.quantity),
      unit: it.uom || it.item?.unit || null,
      unitPrice: n(it.unitPrice),
      discount: n(it.discount),
      taxRate: n(it.taxRate),
      taxAmount: n(it.taxAmount),
      amount: n(it.total),
      serialNumbers: sns.map((s) => s.serialNumber),
      warrantyMonths: it.warrantyMonths ?? null,
      warrantyUntil: it.warrantyUntil || serialUntil,
    }
  })

  const tax = n(sale.taxAmount)
  const total = n(sale.total)
  const paid = n(sale.paidAmount)
  const isTaxInvoice = !!tenant.taxId && Math.abs(tax) >= 0.005
  const c = sale.customer
  const doc: InvoiceDoc = {
    kind: sale.isReturn ? 'credit_note' : isTaxInvoice ? 'tax_invoice' : 'invoice',
    number: sale.invoiceNo,
    date: sale.createdAt,
    status: sale.status || null,
    salesperson: sale.user?.fullName || null,
    originalInvoiceNo,
    customer: (sale.customerName || c)
      ? { name: sale.customerName || c?.name || null, address: addressOf(c), phone: c?.phone || c?.mobilePhone || null, email: c?.email || null, taxId: c?.taxId || null }
      : null,
    lines,
    subtotal: n(sale.subtotal),
    discount: n(sale.discountAmount),
    tax,
    taxBreakdown: Array.isArray(sale.taxBreakdown)
      ? sale.taxBreakdown.map((b) => ({ name: b.taxName || 'Tax', rate: b.rate ?? null, amount: n(b.amount) }))
      : null,
    taxInclusive: !!tenant.taxInclusive,
    total,
    paid: sale.isReturn ? null : paid,
    balanceDue: sale.isReturn ? null : Math.max(0, Math.round((total - paid) * 100) / 100),
    notes: sale.notes || null,
  }
  return { doc, company: companyFromTenant(tenant), tenant }
}

// ─── Quotation → InvoiceDoc ────────────────────────────────────────────────

export interface QuotationApiItem {
  id?: string
  itemId?: string | null
  itemName: string
  quantity: Num
  unitPrice: Num
  discount?: Num
  tax?: Num
  taxRate?: Num
  total?: Num
  uom?: string | null
  uomFactor?: Num
  warrantyMonths?: number | null
}

export interface QuotationApi {
  id: string
  quotationNo: string
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  validUntil?: string | null
  notes?: string | null
  status: string
  subtotal: Num
  discount?: Num
  tax?: Num
  total: Num
  createdAt: string
  items: QuotationApiItem[]
}

export function quotationToDoc(q: QuotationApi, opts: { taxInclusive?: boolean } = {}): InvoiceDoc {
  const lines: InvoiceDocLine[] = (q.items || []).map((i) => {
    const gross = n(i.quantity) * n(i.unitPrice)
    return {
      name: i.itemName,
      quantity: n(i.quantity),
      unit: i.uom || null,
      unitPrice: n(i.unitPrice),
      discount: n(i.discount),
      taxRate: n(i.taxRate),
      taxAmount: n(i.tax),
      amount: Math.round((gross - n(i.discount)) * 100) / 100,
      warrantyMonths: i.warrantyMonths ?? null,
    }
  })
  const lineNet = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const lineDiscounts = (q.items || []).reduce((s, i) => s + n(i.discount), 0)
  const extraDiscount = Math.max(0, Math.round((n(q.discount) - lineDiscounts) * 100) / 100)
  const tax = n(q.tax)
  return {
    kind: 'quotation',
    number: q.quotationNo,
    date: q.createdAt,
    validUntil: q.validUntil || null,
    status: q.status,
    customer: q.customerName || q.customerPhone || q.customerEmail
      ? { name: q.customerName || null, phone: q.customerPhone || null, email: q.customerEmail || null }
      : null,
    lines,
    subtotal: lineNet,
    discount: extraDiscount,
    tax,
    taxInclusive: !!opts.taxInclusive,
    total: n(q.total),
    notes: q.notes || null,
  }
}

// ─── Printing ──────────────────────────────────────────────────────────────

/**
 * Print a full HTML document through a hidden iframe (same pattern as print-executor: never
 * blocked by popup blockers). Waits for images (logos / data URLs) before opening the dialog.
 */
export function printHtmlDocument(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1000px;height:1000px;border:0;opacity:0;pointer-events:none;z-index:-9999;'
      iframe.setAttribute('title', 'Print Frame')
      document.body.appendChild(iframe)
      const win = iframe.contentWindow
      const doc = iframe.contentDocument || win?.document
      if (!win || !doc) {
        iframe.remove()
        resolve(openInWindow(html))
        return
      }
      doc.open()
      doc.write(html)
      doc.close()
      const cleanup = () => { if (iframe.parentNode) iframe.remove() }
      let triggered = false
      const go = async () => {
        if (triggered) return
        triggered = true
        const imgs = Array.from(doc.querySelectorAll('img'))
        await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth > 0)
          ? Promise.resolve()
          : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); setTimeout(r, 3000) })))
        await new Promise((r) => setTimeout(r, 200))
        try {
          win.onafterprint = () => setTimeout(cleanup, 500)
          win.focus()
          win.print()
          resolve(true)
          setTimeout(cleanup, 60000)
        } catch {
          cleanup()
          resolve(openInWindow(html))
        }
      }
      if (doc.readyState === 'complete') requestAnimationFrame(() => { void go() })
      else {
        iframe.onload = () => { void go() }
        setTimeout(() => { void go() }, 1500)
      }
    } catch {
      resolve(openInWindow(html))
    }
  })
}

function openInWindow(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html.replace('</body>', `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)})</script></body>`))
  w.document.close()
  return true
}

/** Load a sale, pick its template and print it on A4 (or the template's paper). */
export async function printSaleInvoice(saleId: string, templateId?: string | null): Promise<boolean> {
  const [{ doc, company }, templates] = await Promise.all([loadSaleDocument(saleId), fetchPrintTemplates(TEMPLATE_DOC_TYPES.sale)])
  return printHtmlDocument(renderInvoiceHtml(pickTemplateConfig(templates, templateId), doc, company))
}

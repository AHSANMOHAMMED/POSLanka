/**
 * Canonical e-invoice payload builders (H2) for sales (invoices), sales returns and customer
 * credit notes (credit notes), and customer debit notes. Run inside a tenant-scoped (RLS) db.
 */
import { eq, inArray } from 'drizzle-orm'
import { accountingSettings, creditNotes, debitNotes, items, sales, taxTemplates, tenants } from '@/lib/db/schema'
import { roundCurrency } from '@/lib/utils/currency'
import { isTaxCategory, type TaxCategory } from '@/lib/utils/tax-category'
import { EINVOICE_SCHEMA_VERSION, type EInvoiceLine, type EInvoiceParty, type EInvoicePayload, type EInvoiceVatBreakdown } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return Number.isFinite(n) ? n : 0
}

/** Tenant-local calendar date of an instant. */
export function localDate(at: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

async function supplierOf(db: DbOrTx, tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!t) throw new Error('Tenant not found')
  const supplier: EInvoiceParty = {
    name: t.name,
    legalName: t.legalName || null,
    tin: t.taxId || null,
    brn: t.brn || null,
    address: t.address || null,
    phone: t.phone || null,
    email: t.email || null,
  }
  return { supplier, currency: t.currency || 'LKR', tz: t.timezone || 'Asia/Colombo', taxInclusive: !!t.taxInclusive }
}

function buyerOf(customer: { name: string; taxId?: string | null; address?: string | null; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; phone?: string | null; email?: string | null } | null | undefined, fallbackName?: string | null): EInvoiceParty | null {
  if (!customer) return fallbackName ? { name: fallbackName, tin: null } : null
  const address = customer.address || [customer.addressLine1, customer.addressLine2, customer.city].filter(Boolean).join(', ') || null
  return { name: customer.name, tin: customer.taxId || null, address, phone: customer.phone || null, email: customer.email || null }
}

/** Template id → category for a set of template ids. */
async function categoriesFor(db: DbOrTx, ids: Array<string | null | undefined>): Promise<Map<string, TaxCategory>> {
  const unique = [...new Set(ids.filter(Boolean) as string[])]
  const map = new Map<string, TaxCategory>()
  if (!unique.length) return map
  const rows = await db.select({ id: taxTemplates.id, taxCategory: taxTemplates.taxCategory }).from(taxTemplates).where(inArray(taxTemplates.id, unique))
  for (const r of rows) if (isTaxCategory(r.taxCategory)) map.set(r.id, r.taxCategory)
  return map
}

function lineCategory(vatAmount: number, category: TaxCategory | undefined, customerExempt: boolean): TaxCategory {
  if (Math.abs(vatAmount) >= 0.005) return 'standard'
  if (category && category !== 'standard') return category
  return customerExempt ? 'exempt' : 'out_of_scope'
}

function vatBreakdown(lines: EInvoiceLine[]): EInvoiceVatBreakdown[] {
  const map = new Map<string, EInvoiceVatBreakdown>()
  for (const l of lines) {
    const key = `${l.vatCategory}|${l.vatRate}`
    const cur = map.get(key) || { category: l.vatCategory, rate: l.vatRate, taxableAmount: 0, vatAmount: 0 }
    cur.taxableAmount = roundCurrency(cur.taxableAmount + l.netAmount)
    cur.vatAmount = roundCurrency(cur.vatAmount + l.vatAmount)
    map.set(key, cur)
  }
  return [...map.values()]
}

/** Make Σ line net equal the document net (rounding / cart-level differences) on the largest line. */
function balanceLines(lines: EInvoiceLine[], docNet: number) {
  if (!lines.length) return
  const diff = roundCurrency(docNet - lines.reduce((s, l) => s + l.netAmount, 0))
  if (Math.abs(diff) < 0.005 || Math.abs(diff) > Math.max(1, Math.abs(docNet) * 0.05)) return
  const target = lines.reduce((m, l) => (Math.abs(l.netAmount) > Math.abs(m.netAmount) ? l : m), lines[0])
  target.netAmount = roundCurrency(target.netAmount + diff)
  target.grossAmount = roundCurrency(target.netAmount + target.vatAmount)
}

/** Invoice (sale) or credit note (sales return) payload. Amounts are positive magnitudes. */
export async function buildSalePayload(db: DbOrTx, tenantId: string, saleId: string): Promise<EInvoicePayload> {
  const sale = await db.query.sales.findFirst({
    where: eq(sales.id, saleId),
    with: { items: true, customer: true, payments: true },
  })
  if (!sale) throw new Error(`Sale ${saleId} not found`)
  const { supplier, currency, tz, taxInclusive } = await supplierOf(db, tenantId)

  const itemIds = sale.items.map((i: { itemId: string | null }) => i.itemId).filter(Boolean) as string[]
  const itemRows: Array<{ id: string; sku: string | null; itemCode: string | null; unit: string | null; taxTemplateId: string | null }> = itemIds.length
    ? await db.select({ id: items.id, sku: items.sku, itemCode: items.itemCode, unit: items.unit, taxTemplateId: items.taxTemplateId }).from(items).where(inArray(items.id, itemIds))
    : []
  const itemMap = new Map(itemRows.map((r) => [r.id, r]))
  const [settings] = await db.select({ defaultTaxTemplateId: accountingSettings.defaultTaxTemplateId }).from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  const templateOf = (l: { taxTemplateId: string | null; itemId: string | null }) =>
    l.taxTemplateId || (l.itemId ? itemMap.get(l.itemId)?.taxTemplateId : null) || settings?.defaultTaxTemplateId || null
  const cats = await categoriesFor(db, sale.items.map(templateOf))

  const subtotal = Math.abs(num(sale.subtotal))
  const discount = Math.abs(num(sale.discountAmount))
  const ratio = subtotal > 0 ? Math.max(0, 1 - discount / subtotal) : 1
  const customerExempt = !!sale.customer?.taxExempt

  const lines: EInvoiceLine[] = sale.items.map((l: Record<string, unknown> & { itemId: string | null; taxTemplateId: string | null }, idx: number) => {
    const vat = Math.abs(num(l.taxAmount))
    const gross = Math.abs(num(l.total)) * ratio
    const bd = Array.isArray(l.taxBreakdown) ? (l.taxBreakdown as Array<{ includedInPrice?: boolean }>) : null
    const inclusive = bd && bd.length ? bd.every((b) => b.includedInPrice) : taxInclusive
    const net = roundCurrency(inclusive ? gross - vat : gross)
    const tpl = templateOf(l)
    const it = l.itemId ? itemMap.get(l.itemId) : undefined
    return {
      lineNo: idx + 1,
      description: String(l.itemName),
      itemCode: it?.itemCode || it?.sku || null,
      quantity: Math.abs(num(l.quantity)),
      unit: it?.unit || null,
      unitPrice: Math.abs(num(l.unitPrice)),
      netAmount: net,
      vatCategory: lineCategory(vat, tpl ? cats.get(tpl) : undefined, customerExempt),
      vatRate: num(l.taxRate) || (net > 0 && vat > 0 ? roundCurrency((vat / net) * 100) : 0),
      vatAmount: roundCurrency(vat),
      grossAmount: roundCurrency(net + vat),
    }
  })
  const vatTotal = roundCurrency(Math.abs(num(sale.taxAmount)))
  const grossTotal = roundCurrency(Math.abs(num(sale.total)))
  balanceLines(lines, roundCurrency(grossTotal - vatTotal))

  let original: EInvoicePayload['originalDocument'] = null
  if (sale.isReturn && sale.returnAgainst) {
    const orig = await db.query.sales.findFirst({ where: eq(sales.id, sale.returnAgainst), columns: { invoiceNo: true, createdAt: true } })
    if (orig) original = { documentNo: orig.invoiceNo, issueDate: localDate(new Date(orig.createdAt), tz) }
  }
  const buyer = buyerOf(sale.customer, sale.customerName)
  return {
    schemaVersion: EINVOICE_SCHEMA_VERSION,
    documentType: sale.isReturn ? 'credit_note' : 'invoice',
    documentNo: sale.invoiceNo,
    issueDate: localDate(new Date(sale.createdAt), tz),
    issuedAt: new Date(sale.createdAt).toISOString(),
    currency,
    originalDocument: original,
    reason: sale.isReturn ? sale.returnReason || sale.returnNotes || null : null,
    supplier,
    buyer,
    isB2B: !!buyer?.tin,
    lines,
    vatBreakdown: vatBreakdown(lines),
    totals: { netAmount: roundCurrency(grossTotal - vatTotal), vatAmount: vatTotal, grossAmount: grossTotal, discount: roundCurrency(discount) },
    payments: (sale.payments || [])
      .filter((p: { voidedAt: Date | null }) => !p.voidedAt)
      .map((p: { method: string; amount: string }) => ({ method: p.method, amount: roundCurrency(Math.abs(num(p.amount))) })),
    source: { type: sale.isReturn ? 'sale_return' : 'sale', id: sale.id },
  }
}

/** Credit-note or debit-note payload (customer notes tables). */
export async function buildNotePayload(db: DbOrTx, tenantId: string, kind: 'credit_note' | 'debit_note', noteId: string): Promise<EInvoicePayload> {
  const note = kind === 'credit_note'
    ? await db.query.creditNotes.findFirst({ where: eq(creditNotes.id, noteId), with: { items: true, customer: true, sale: { columns: { invoiceNo: true, createdAt: true } } } })
    : await db.query.debitNotes.findFirst({ where: eq(debitNotes.id, noteId), with: { items: true, customer: true, sale: { columns: { invoiceNo: true, createdAt: true } } } })
  if (!note) throw new Error(`${kind} ${noteId} not found`)
  const { supplier, currency, tz } = await supplierOf(db, tenantId)
  const cats = await categoriesFor(db, note.items.map((i: { taxTemplateId: string | null }) => i.taxTemplateId))
  const customerExempt = !!note.customer?.taxExempt
  const lines: EInvoiceLine[] = note.items.map((l: { itemName: string; quantity: string; unitPrice: string; total: string; tax: string; taxRate: string; taxTemplateId: string | null }, idx: number) => {
    const net = roundCurrency(num(l.total))
    const vat = roundCurrency(num(l.tax))
    return {
      lineNo: idx + 1,
      description: l.itemName,
      itemCode: null,
      quantity: num(l.quantity),
      unit: null,
      unitPrice: num(l.unitPrice),
      netAmount: net,
      vatCategory: lineCategory(vat, l.taxTemplateId ? cats.get(l.taxTemplateId) : undefined, customerExempt),
      vatRate: num(l.taxRate),
      vatAmount: vat,
      grossAmount: roundCurrency(net + vat),
    }
  })
  const docNo = kind === 'credit_note' ? (note as { creditNoteNo: string }).creditNoteNo : (note as { debitNoteNo: string }).debitNoteNo
  const buyer = buyerOf(note.customer, note.customerName)
  return {
    schemaVersion: EINVOICE_SCHEMA_VERSION,
    documentType: kind,
    documentNo: docNo,
    issueDate: note.postingDate || localDate(new Date(note.createdAt), tz),
    issuedAt: new Date(note.createdAt).toISOString(),
    currency,
    originalDocument: note.sale ? { documentNo: note.sale.invoiceNo, issueDate: localDate(new Date(note.sale.createdAt), tz) } : null,
    reason: note.reason || null,
    supplier,
    buyer,
    isB2B: !!buyer?.tin,
    lines,
    vatBreakdown: vatBreakdown(lines),
    totals: { netAmount: roundCurrency(num(note.subtotal)), vatAmount: roundCurrency(num(note.tax)), grossAmount: roundCurrency(num(note.total)), discount: 0 },
    payments: [],
    source: { type: kind, id: note.id },
  }
}

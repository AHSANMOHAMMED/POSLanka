/**
 * Print job orders (drizzle/0182) — server helpers shared by /api/print-jobs/*.
 *  - line pricing: calculateSizeLine() with the item's pricing defaults (mode, area unit, min charge)
 *  - totals: one invoice line per print line plus one per finishing add-on; the job discount is
 *    spread over them pro rata and tax comes from the tenant's tax templates (same lines at save
 *    time and at invoicing, so the invoice equals the job)
 *  - advances: Dr Cash/Bank (Modes of Payment) / Cr Customer Advance, like layaway deposits; each
 *    payment is its own GL voucher ('print_job_advance', payment id) so it can be refunded alone
 * Server-only.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { accountingSettings, glEntries, items, modesOfPayment, printJobItems, type PrintJobFinishing } from '@/lib/db/schema'
import { createGLEntries, reverseGLEntries, type GLEntryInput } from '@/lib/accounting/gl'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateSizeLine, formatSize, AREA_UNIT_LABEL, LENGTH_UNIT_LABEL, type AreaUnit, type PricingMode, type SizeUnit } from './size-pricing'
import type { PrintJobLineInput } from '@/lib/validation/schemas/print-jobs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any

export const PRINT_JOB_ADVANCE_VOUCHER = 'print_job_advance'

/** Production pipeline order (cancelled / delivered are terminal). */
export const PRINT_JOB_PIPELINE = ['received', 'designing', 'proof_sent', 'approved', 'printing', 'finishing', 'ready', 'delivered'] as const
export const OPEN_PRINT_JOB_STATUSES = ['received', 'designing', 'proof_sent', 'approved', 'printing', 'finishing', 'ready'] as const

export interface ComputedPrintLine {
  sortOrder: number
  itemId: string | null
  description: string
  pricingMode: PricingMode
  width: string | null
  height: string | null
  sizeUnit: SizeUnit | null
  quantity: string
  material: string | null
  sides: number
  areaUnit: AreaUnit | null
  areaPerPiece: string | null
  billableArea: string | null
  rate: string
  baseAmount: string
  finishing: PrintJobFinishing[]
  finishingAmount: string
  amount: string
  notes: string | null
  /** quantity the invoice line / stock movement uses (billable area or length for size-priced items) */
  billQty: number
}

/** Price the lines with the items' defaults. Unknown item ids are refused (RLS-scoped lookup). */
export async function computePrintLines(db: DbLike, lines: PrintJobLineInput[]): Promise<ComputedPrintLine[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => !!id))]
  const itemRows: Array<{ id: string; pricingMode: string; areaUnit: string; minChargeArea: string | null }> = itemIds.length
    ? await db.select({ id: items.id, pricingMode: items.pricingMode, areaUnit: items.areaUnit, minChargeArea: items.minChargeArea })
      .from(items).where(inArray(items.id, itemIds))
    : []
  const byId = new Map(itemRows.map((r) => [r.id, r]))
  for (const id of itemIds) if (!byId.has(id)) throw new Error('INVALID_ITEM')

  return lines.map((l, idx) => {
    const item = l.itemId ? byId.get(l.itemId) : undefined
    // the item decides how it is priced; free-text lines use what the form sent
    const pricingMode = ((item?.pricingMode as PricingMode) || l.pricingMode || 'unit') as PricingMode
    const areaUnit = ((l.areaUnit || item?.areaUnit || 'sqft') as AreaUnit)
    const minChargeArea = l.minChargeArea ?? (item?.minChargeArea != null ? parseFloat(item.minChargeArea) : null)
    const sizeUnit = (l.sizeUnit || (l.width || l.height ? 'inch' : null)) as SizeUnit | null
    if (pricingMode === 'area' && !((l.width ?? 0) > 0 && (l.height ?? 0) > 0)) throw new Error(`SIZE_REQUIRED:${l.description}`)
    if (pricingMode === 'length' && !((l.width ?? 0) > 0)) throw new Error(`SIZE_REQUIRED:${l.description}`)
    const calc = calculateSizeLine({
      pricingMode,
      width: l.width ?? null,
      height: l.height ?? null,
      sizeUnit,
      quantity: l.quantity,
      rate: l.rate,
      areaUnit,
      minChargeArea,
      sides: l.sides,
      finishing: l.finishing,
    })
    const hasSize = (l.width ?? 0) > 0 || (l.height ?? 0) > 0
    return {
      sortOrder: idx,
      itemId: l.itemId || null,
      description: l.description,
      pricingMode,
      width: hasSize && l.width != null ? String(l.width) : null,
      height: hasSize && l.height != null ? String(l.height) : null,
      sizeUnit: hasSize ? sizeUnit : null,
      quantity: String(l.quantity),
      material: l.material || null,
      sides: l.sides || 1,
      areaUnit: pricingMode === 'unit' && !hasSize ? null : areaUnit,
      areaPerPiece: hasSize ? String(calc.areaPerPiece) : null,
      billableArea: pricingMode === 'unit' ? (hasSize ? String(calc.billableTotal) : null) : String(calc.billQty),
      rate: String(roundCurrency(l.rate)),
      baseAmount: String(calc.baseAmount),
      finishing: calc.finishing,
      finishingAmount: String(calc.finishingAmount),
      amount: String(calc.amount),
      notes: l.notes || null,
      billQty: calc.billQty,
    }
  })
}

/** Invoice line text: "Flex banner — 6 × 3 ft × 2 (36 sq ft)". */
export function printLineName(l: { description: string; width: string | null; height: string | null; sizeUnit: string | null; quantity: string; pricingMode: string; areaUnit: string | null; billableArea: string | null; material?: string | null; sides?: number }): string {
  const parts: string[] = []
  const size = formatSize(l.width, l.height, l.sizeUnit)
  if (size) parts.push(size)
  const qty = parseFloat(l.quantity)
  if (l.pricingMode !== 'unit' && qty > 0) parts.push(`× ${qty}`)
  if ((l.sides || 1) > 1) parts.push('2-sided')
  let text = parts.length ? `${l.description} — ${parts.join(' ')}` : l.description
  if (l.pricingMode !== 'unit' && l.billableArea) {
    const u = (l.areaUnit || 'sqft') as AreaUnit
    text += ` (${l.billableArea} ${l.pricingMode === 'length' ? LENGTH_UNIT_LABEL[u] : AREA_UNIT_LABEL[u]})`
  }
  return text.slice(0, 255)
}

export interface InvoiceLine {
  /** index of the print line it comes from */
  lineIndex: number
  kind: 'print' | 'finishing'
  itemId: string | null
  itemName: string
  quantity: number
  unitPrice: number
  gross: number
  discount: number
  taxRate: number
  taxAmount: number
  exclusiveTax: number
  taxBreakdown: TaxBreakdownItem[] | null
  total: number
}

export interface PrintJobTotals {
  subtotal: number
  discountAmount: number
  taxAmount: number
  taxBreakdown: TaxBreakdownItem[] | null
  total: number
  invoiceLines: InvoiceLine[]
}

/**
 * Totals of a job: lines → invoice lines (print + finishing), discount spread pro rata (the last
 * line takes the rounding), tax from the templates on the discounted amounts. Add-on lines are
 * taxed with their print line's item. total = subtotal − discount + exclusive tax.
 */
export async function computePrintJobTotals(db: DbLike, tenantId: string, lines: ComputedPrintLine[], discountRequested: number): Promise<PrintJobTotals> {
  const inv: InvoiceLine[] = []
  lines.forEach((l, i) => {
    const base = parseFloat(l.baseAmount)
    inv.push({
      lineIndex: i, kind: 'print', itemId: l.itemId, itemName: printLineName(l),
      quantity: l.billQty, unitPrice: parseFloat(l.rate), gross: base,
      discount: 0, taxRate: 0, taxAmount: 0, exclusiveTax: 0, taxBreakdown: null, total: base,
    })
    for (const f of l.finishing) {
      if (!(f.amount > 0)) continue
      inv.push({
        lineIndex: i, kind: 'finishing', itemId: l.itemId, itemName: `  + ${f.label} (${f.qty} × ${f.rate})`.slice(0, 255),
        quantity: f.qty || 1, unitPrice: f.qty > 0 ? f.rate : f.amount, gross: f.amount,
        discount: 0, taxRate: 0, taxAmount: 0, exclusiveTax: 0, taxBreakdown: null, total: f.amount,
      })
    }
  })
  const subtotal = roundCurrency(inv.reduce((s, l) => s + l.gross, 0))
  const discountAmount = roundCurrency(Math.min(Math.max(0, discountRequested || 0), subtotal))

  // spread the discount
  let left = discountAmount
  const lastPositive = inv.map((l) => l.gross > 0).lastIndexOf(true)
  inv.forEach((l, idx) => {
    if (discountAmount <= 0 || subtotal <= 0 || l.gross <= 0) return
    const share = idx === lastPositive ? left : roundCurrency(discountAmount * (l.gross / subtotal))
    l.discount = roundCurrency(Math.min(share, l.gross, left))
    left = roundCurrency(left - l.discount)
  })

  const tax = await recalculateDocumentTax(db, tenantId, inv.map((l) => ({ itemId: l.itemId, lineTotal: roundCurrency(l.gross - l.discount) })), { type: 'sales' })
  inv.forEach((l, idx) => {
    const t = tax.perItemTax[idx]
    const net = roundCurrency(l.gross - l.discount)
    l.taxAmount = t ? roundCurrency(t.taxAmount) : 0
    l.taxBreakdown = t?.taxBreakdown || null
    l.exclusiveTax = roundCurrency((t?.taxBreakdown || []).filter((b) => !b.includedInPrice).reduce((s, b) => s + b.amount, 0))
    l.taxRate = t ? roundCurrency(t.taxRate) : 0
    l.total = roundCurrency(net + l.exclusiveTax)
  })

  return {
    subtotal,
    discountAmount,
    taxAmount: roundCurrency(tax.totalTax),
    taxBreakdown: tax.taxBreakdown,
    total: roundCurrency(subtotal - discountAmount + tax.exclusiveTax),
    invoiceLines: inv,
  }
}

// ==================== ADVANCES → GL ====================

async function advanceConfig(db: DbLike, tenantId: string) {
  const [s] = await db.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  if (!s || !s.autoPostSales || !s.currentFiscalYearId || !s.defaultAdvanceReceivedAccountId || !s.defaultCashAccountId) return null
  return s as typeof accountingSettings.$inferSelect
}

async function receiptAccount(db: DbLike, tenantId: string, cfg: typeof accountingSettings.$inferSelect, method: string): Promise<string> {
  const [mode] = await db.select({ accountId: modesOfPayment.defaultAccountId }).from(modesOfPayment)
    .where(and(eq(modesOfPayment.tenantId, tenantId), eq(modesOfPayment.methodKey, method), eq(modesOfPayment.isEnabled, true))).limit(1)
  if (mode?.accountId) return mode.accountId
  if (method === 'cash') return cfg.defaultCashAccountId!
  return cfg.defaultBankAccountId || cfg.defaultCashAccountId!
}

/**
 * Advance received: Dr Cash/Bank, Cr Customer Advance. Skipped (returns false) when accounting
 * auto-posting or the advance account is not set up — the invoice then books that money as a
 * normal payment instead (see postedAdvanceIds()).
 */
export async function postPrintJobAdvanceToGL(db: DbLike, tenantId: string, data: {
  paymentId: string; jobNo: string; amount: number; paymentMethod: string; customerId: string | null; date?: string
}): Promise<boolean> {
  const cfg = await advanceConfig(db, tenantId)
  if (!cfg) return false
  const amount = roundCurrency(data.amount)
  if (amount <= 0) return false
  const costCenterId = cfg.defaultCostCenterId || null
  const entries: GLEntryInput[] = [
    { accountId: await receiptAccount(db, tenantId, cfg, data.paymentMethod), debit: amount, costCenterId, remarks: `Print job advance received (${data.paymentMethod})` },
    {
      accountId: cfg.defaultAdvanceReceivedAccountId!, credit: amount,
      partyType: data.customerId ? 'customer' : null, partyId: data.customerId || null,
      costCenterId, remarks: `Advance for print job ${data.jobNo}`,
    },
  ]
  await createGLEntries(db, {
    tenantId,
    postingDate: data.date || new Date().toISOString().split('T')[0],
    voucherType: PRINT_JOB_ADVANCE_VOUCHER,
    voucherId: data.paymentId,
    voucherNumber: data.jobNo,
    fiscalYearId: cfg.currentFiscalYearId!,
    entries,
  })
  return true
}

/** Refund of an advance (job cancelled): reverses its GL voucher, if it was posted. */
export async function reversePrintJobAdvance(db: DbLike, tenantId: string, paymentId: string): Promise<void> {
  await reverseGLEntries(db, tenantId, PRINT_JOB_ADVANCE_VOUCHER, paymentId)
}

/** Ids of the advance payments that were posted to the Customer Advance account. */
export async function postedAdvanceIds(db: DbLike, tenantId: string, paymentIds: string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set()
  const rows: Array<{ voucherId: string }> = await db.selectDistinct({ voucherId: glEntries.voucherId }).from(glEntries)
    .where(and(eq(glEntries.tenantId, tenantId), eq(glEntries.voucherType, PRINT_JOB_ADVANCE_VOUCHER), inArray(glEntries.voucherId, paymentIds)))
  return new Set(rows.map((r) => r.voucherId))
}

/** Start of today / tomorrow in Sri Lanka time (due-today and overdue filters). */
export function colomboDayBounds(now = new Date()): { start: Date; end: Date } {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const start = new Date(`${day}T00:00:00+05:30`)
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

/** Row values of print_job_items for computed lines. */
export function lineRows(tenantId: string, printJobId: string, lines: ComputedPrintLine[]) {
  return lines.map((l) => ({
    tenantId,
    printJobId,
    sortOrder: l.sortOrder,
    itemId: l.itemId,
    description: l.description,
    pricingMode: l.pricingMode,
    width: l.width,
    height: l.height,
    sizeUnit: l.sizeUnit,
    quantity: l.quantity,
    material: l.material,
    sides: l.sides,
    areaUnit: l.areaUnit,
    areaPerPiece: l.areaPerPiece,
    billableArea: l.billableArea,
    rate: l.rate,
    baseAmount: l.baseAmount,
    finishing: l.finishing,
    finishingAmount: l.finishingAmount,
    amount: l.amount,
    notes: l.notes,
  }))
}

/** Rebuild the ComputedPrintLine shape from stored rows (for invoicing exactly what is stored). */
export function storedLinesToComputed(rows: Array<typeof printJobItems.$inferSelect>): ComputedPrintLine[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => {
    const qty = parseFloat(r.quantity)
    return {
      sortOrder: r.sortOrder,
      itemId: r.itemId,
      description: r.description,
      pricingMode: r.pricingMode,
      width: r.width,
      height: r.height,
      sizeUnit: r.sizeUnit,
      quantity: r.quantity,
      material: r.material,
      sides: r.sides,
      areaUnit: r.areaUnit,
      areaPerPiece: r.areaPerPiece,
      billableArea: r.billableArea,
      rate: r.rate,
      baseAmount: r.baseAmount,
      finishing: (r.finishing || []) as PrintJobFinishing[],
      finishingAmount: r.finishingAmount,
      amount: r.amount,
      notes: r.notes,
      billQty: r.pricingMode === 'unit' ? qty : parseFloat(r.billableArea || '0'),
    }
  })
}

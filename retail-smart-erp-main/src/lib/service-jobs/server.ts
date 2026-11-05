/**
 * Service jobs (drizzle/0193) — server helpers shared by /api/service-jobs/*.
 *  - lines: parts (stock items, deducted when the job is invoiced), labour and other charges;
 *    amount = qty × unit price (quantities up to 4 decimals: fabric by the metre)
 *  - totals: the job discount spread pro rata over the lines, tax from the tenant's tax templates
 *    (same lines at save time and at invoicing, so the invoice equals the job)
 *  - advances: Dr Cash/Bank (Modes of Payment) / Cr Customer Advance, one GL voucher per payment
 *    ('service_job_advance', payment id) so each can be refunded alone — like print job advances
 *  - warranty check: the shop's own sale of the unit, by serial / IMEI (installments/sale-lookup)
 * Server-only.
 */
import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import {
  accountingSettings, glEntries, items, modesOfPayment, serviceJobHistory, serviceJobItems,
} from '@/lib/db/schema'
import { createGLEntries, reverseGLEntries, tenantToday, type GLEntryInput } from '@/lib/accounting/gl'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'
import { roundCurrency } from '@/lib/utils/currency'
import type { ServiceJobLineInput } from '@/lib/validation/schemas/service-jobs'
import type { Permission } from '@/lib/auth/roles'
import { hasAnyPermission } from '@/lib/auth/field-access'
import type { BranchScope } from '@/lib/auth/branch-access'
import { warrantyEndOf, warrantyLookup } from '@/lib/installments/sale-lookup'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { toApiError } from '@/lib/db/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any
type PermSession = Parameters<typeof hasAnyPermission>[0]

export const SERVICE_JOB_ADVANCE_VOUCHER = 'service_job_advance'

/** Counter staff, managers and technicians / tailors work on jobs. */
export const SERVICE_JOB_VIEW: readonly Permission[] = ['createSales', 'manageSales', 'manageWorkOrders']
/** Money: advances and converting to an invoice (counter staff / managers). */
export const SERVICE_JOB_MONEY: readonly Permission[] = ['createSales', 'manageSales']
/** Who sees a device's passcode / pattern: the people who repair it and managers. */
export const SERVICE_JOB_PASSCODE: readonly Permission[] = ['manageWorkOrders', 'manageSales']

export function requireAnyPermission(session: PermSession, perms: readonly Permission[]): NextResponse | null {
  return hasAnyPermission(session, perms) ? null : NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
}

export function canSeePasscode(session: PermSession): boolean {
  return hasAnyPermission(session, SERVICE_JOB_PASSCODE)
}

/** Business errors thrown inside the routes → API responses (null = unexpected → 500). */
export function serviceJobErrorResponse(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : ''
  if (message === 'USER_NOT_FOUND') {
    return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
  }
  if (message === 'INVALID_ITEM') return NextResponse.json({ error: 'One of the parts was not found' }, { status: 400 })
  if (message === 'ALREADY_INVOICED') return NextResponse.json({ error: 'This job has already been invoiced' }, { status: 400 })
  if (message === 'INVALID_STATUS') return NextResponse.json({ error: 'The job cannot be changed in its current status' }, { status: 400 })
  if (message === 'CUSTOMER_REQUIRED') return NextResponse.json({ error: 'Select a saved customer to put the balance on account' }, { status: 400 })
  if (message === 'SERIAL_NOT_SUPPORTED') {
    return NextResponse.json({ error: 'Serial-numbered items cannot be used as parts on a job — sell them at the POS' }, { status: 400 })
  }
  const stock = stockErrorResponse(error)
  if (stock) return stock
  return toApiError(error)
}

// ==================== LINES & TOTALS ====================

export interface ComputedServiceLine {
  sortOrder: number
  lineType: 'part' | 'labour' | 'other'
  itemId: string | null
  description: string
  quantity: number
  unitPrice: number
  amount: number
  notes: string | null
}

/** Round to 4 dp (stock quantities, 0189). */
const q4 = (n: number) => Math.round(n * 10000) / 10000

/** Validate item ids (RLS-scoped) and price the lines. Labour / other lines may still name an item (a service item). */
export async function computeServiceLines(db: DbLike, lines: ServiceJobLineInput[]): Promise<ComputedServiceLine[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => !!id))]
  if (itemIds.length) {
    const rows: Array<{ id: string }> = await db.select({ id: items.id }).from(items).where(inArray(items.id, itemIds))
    const found = new Set(rows.map((r) => r.id))
    for (const id of itemIds) if (!found.has(id)) throw new Error('INVALID_ITEM')
  }
  return lines.map((l, idx) => {
    const quantity = q4(l.quantity)
    const unitPrice = roundCurrency(l.unitPrice)
    return {
      sortOrder: idx,
      lineType: l.lineType,
      itemId: l.itemId || null,
      description: l.description,
      quantity,
      unitPrice,
      amount: roundCurrency(quantity * unitPrice),
      notes: l.notes || null,
    }
  })
}

export function serviceLineRows(tenantId: string, serviceJobId: string, lines: ComputedServiceLine[]) {
  return lines.map((l) => ({
    tenantId,
    serviceJobId,
    sortOrder: l.sortOrder,
    lineType: l.lineType,
    itemId: l.itemId,
    description: l.description,
    quantity: String(l.quantity),
    unitPrice: String(l.unitPrice),
    amount: String(l.amount),
    notes: l.notes,
  }))
}

export function storedServiceLines(rows: Array<typeof serviceJobItems.$inferSelect>): ComputedServiceLine[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({
    sortOrder: r.sortOrder,
    lineType: r.lineType,
    itemId: r.itemId,
    description: r.description,
    quantity: parseFloat(r.quantity),
    unitPrice: parseFloat(r.unitPrice),
    amount: parseFloat(r.amount),
    notes: r.notes,
  }))
}

export interface ServiceInvoiceLine extends ComputedServiceLine {
  discount: number
  taxRate: number
  taxAmount: number
  taxBreakdown: TaxBreakdownItem[] | null
  total: number
}

export interface ServiceJobTotals {
  subtotal: number
  discountAmount: number
  taxAmount: number
  taxBreakdown: TaxBreakdownItem[] | null
  total: number
  lines: ServiceInvoiceLine[]
}

/** total = subtotal − discount + exclusive tax; discount spread pro rata (last line takes the rounding). */
export async function computeServiceJobTotals(db: DbLike, tenantId: string, lines: ComputedServiceLine[], discountRequested: number): Promise<ServiceJobTotals> {
  const inv: ServiceInvoiceLine[] = lines.map((l) => ({ ...l, discount: 0, taxRate: 0, taxAmount: 0, taxBreakdown: null, total: l.amount }))
  const subtotal = roundCurrency(inv.reduce((s, l) => s + l.amount, 0))
  const discountAmount = roundCurrency(Math.min(Math.max(0, discountRequested || 0), subtotal))
  let left = discountAmount
  const lastPositive = inv.map((l) => l.amount > 0).lastIndexOf(true)
  inv.forEach((l, idx) => {
    if (discountAmount <= 0 || subtotal <= 0 || l.amount <= 0) return
    const share = idx === lastPositive ? left : roundCurrency(discountAmount * (l.amount / subtotal))
    l.discount = roundCurrency(Math.min(share, l.amount, left))
    left = roundCurrency(left - l.discount)
  })
  if (inv.length === 0) {
    return { subtotal: 0, discountAmount: 0, taxAmount: 0, taxBreakdown: null, total: 0, lines: [] }
  }
  const tax = await recalculateDocumentTax(db, tenantId, inv.map((l) => ({ itemId: l.itemId, lineTotal: roundCurrency(l.amount - l.discount) })), { type: 'sales' })
  inv.forEach((l, idx) => {
    const t = tax.perItemTax[idx]
    const net = roundCurrency(l.amount - l.discount)
    l.taxAmount = t ? roundCurrency(t.taxAmount) : 0
    l.taxBreakdown = t?.taxBreakdown || null
    const excl = roundCurrency((t?.taxBreakdown || []).filter((b) => !b.includedInPrice).reduce((s, b) => s + b.amount, 0))
    l.taxRate = t ? roundCurrency(t.taxRate) : 0
    l.total = roundCurrency(net + excl)
  })
  return {
    subtotal,
    discountAmount,
    taxAmount: roundCurrency(tax.totalTax),
    taxBreakdown: tax.taxBreakdown,
    total: roundCurrency(subtotal - discountAmount + tax.exclusiveTax),
    lines: inv,
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
 * Advance received: Dr Cash/Bank, Cr Customer Advance. Returns false (nothing posted) when
 * auto-posting or the advance account is not set up — the invoice then books it as money received.
 */
export async function postServiceJobAdvanceToGL(db: DbLike, tenantId: string, data: {
  paymentId: string; jobNo: string; amount: number; paymentMethod: string; customerId: string | null
}): Promise<boolean> {
  const cfg = await advanceConfig(db, tenantId)
  if (!cfg) return false
  const amount = roundCurrency(data.amount)
  if (amount <= 0) return false
  const costCenterId = cfg.defaultCostCenterId || null
  const entries: GLEntryInput[] = [
    { accountId: await receiptAccount(db, tenantId, cfg, data.paymentMethod), debit: amount, costCenterId, remarks: `Job advance received (${data.paymentMethod})` },
    {
      accountId: cfg.defaultAdvanceReceivedAccountId!, credit: amount,
      partyType: data.customerId ? 'customer' : null, partyId: data.customerId || null,
      costCenterId, remarks: `Advance for job ${data.jobNo}`,
    },
  ]
  await createGLEntries(db, {
    tenantId,
    postingDate: await tenantToday(tenantId),
    voucherType: SERVICE_JOB_ADVANCE_VOUCHER,
    voucherId: data.paymentId,
    voucherNumber: data.jobNo,
    fiscalYearId: cfg.currentFiscalYearId!,
    entries,
  })
  return true
}

export async function reverseServiceJobAdvance(db: DbLike, tenantId: string, paymentId: string): Promise<void> {
  await reverseGLEntries(db, tenantId, SERVICE_JOB_ADVANCE_VOUCHER, paymentId)
}

/** Ids of the advances that were posted to Customer Advance. */
export async function postedServiceAdvanceIds(db: DbLike, tenantId: string, paymentIds: string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set()
  const rows: Array<{ voucherId: string }> = await db.selectDistinct({ voucherId: glEntries.voucherId }).from(glEntries)
    .where(and(eq(glEntries.tenantId, tenantId), eq(glEntries.voucherType, SERVICE_JOB_ADVANCE_VOUCHER), inArray(glEntries.voucherId, paymentIds)))
  return new Set(rows.map((r) => r.voucherId))
}

// ==================== HISTORY ====================

export async function addServiceJobHistory(db: DbLike, row: {
  tenantId: string; serviceJobId: string; fromStatus?: string | null; toStatus?: string | null; note?: string | null; changedBy?: string | null
}): Promise<void> {
  await db.insert(serviceJobHistory).values({
    tenantId: row.tenantId,
    serviceJobId: row.serviceJobId,
    fromStatus: row.fromStatus ?? null,
    toStatus: row.toStatus ?? null,
    note: row.note ? row.note.slice(0, 2000) : null,
    changedBy: row.changedBy ?? null,
  })
}

// ==================== WARRANTY CHECK ====================

export interface ServiceWarrantyCheck {
  found: boolean
  inWarranty: boolean
  warrantyUntil: string | null
  serialNumberId: string | null
  serialNumber: string | null
  itemId: string | null
  itemName: string | null
  saleId: string | null
  invoiceNo: string | null
  saleDate: string | null
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  today: string
}

/**
 * Was this unit sold by the shop, and is it still under the shop's warranty? Looks the term up
 * as a serial / IMEI (or invoice / phone) and takes the first unit match: the unit's own warranty
 * end, else the sale line's warranty_until.
 */
export async function checkServiceWarranty(db: DbLike, tenantId: string, term: string, scope: BranchScope): Promise<ServiceWarrantyCheck> {
  const today = await tenantToday(tenantId)
  const empty: ServiceWarrantyCheck = {
    found: false, inWarranty: false, warrantyUntil: null, serialNumberId: null, serialNumber: null, itemId: null, itemName: null,
    saleId: null, invoiceNo: null, saleDate: null, customerId: null, customerName: null, customerPhone: null, today,
  }
  const hits = await warrantyLookup(db, term, scope)
  const hit = hits.find((h) => h.serial) || hits[0]
  if (!hit) return empty
  const sale = hit.sale
  const line = sale?.lines.find((l) => hit.serial && l.serialNumbers.some((s) => s.id === hit.serial!.id)) || null
  const end = hit.serial ? warrantyEndOf(line, hit.serial.warrantyEndDate) : null
  return {
    found: true,
    inWarranty: !!end && end >= today,
    warrantyUntil: end,
    serialNumberId: hit.serial?.id ?? null,
    serialNumber: hit.serial?.serialNumber ?? null,
    itemId: hit.serial?.itemId ?? line?.itemId ?? null,
    itemName: hit.serial?.itemName ?? line?.itemName ?? null,
    saleId: sale?.id ?? null,
    invoiceNo: sale?.invoiceNo ?? null,
    saleDate: sale?.saleDate ?? null,
    customerId: sale?.customerId ?? null,
    customerName: sale?.customerName ?? null,
    customerPhone: sale?.customerPhone ?? null,
    today,
  }
}

/** Start of today / tomorrow in Sri Lanka time (due-today and overdue filters). */
export function colomboDayBounds(now = new Date()): { start: Date; end: Date } {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const start = new Date(`${day}T00:00:00+05:30`)
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

/** yyyy-mm-dd + days */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

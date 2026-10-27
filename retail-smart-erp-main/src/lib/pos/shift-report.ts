/**
 * H1 — POS shift cash control helpers shared by the shift, close, cash-movement and daily
 * summary routes: drawer cash movements (paid in / out) and the Z-report detail snapshot
 * (tax summary, discounts, voids, returns, cash movements, ledger tie-out).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { glEntries, posCashMovements, saleItems, users } from '@/lib/db/schema'
import { resolvePosTenderAccount } from '@/lib/accounting/auto-post'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import type { ShiftOutsideCollections } from '@/lib/pos/shift-collections'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Paid-in at or above this amount needs a supervisor (tenants.settings.pos.paidInApprovalThreshold overrides). */
export const DEFAULT_PAID_IN_APPROVAL_THRESHOLD = 5000

export const CASH_MOVEMENT_CATEGORY_LABELS: Record<string, string> = {
  petty_expense: 'Petty expense',
  supplier_payment: 'Supplier payment',
  bank_drop: 'Bank drop / safe drop',
  float_top_up: 'Float top-up',
  /** system: cash handed back for a void of a closed shift's sale (see PUT /api/sales/[id]) */
  void_refund: 'Refund of voided sale',
  other: 'Other',
}

export const SHIFT_VARIANCE_REASON_LABELS: Record<string, string> = {
  counting_error: 'Counting error',
  change_error: 'Wrong change given',
  unrecorded_sale: 'Sale not recorded',
  unrecorded_expense: 'Expense paid without a paid-out',
  card_terminal_mismatch: 'Card terminal / settlement mismatch',
  theft_suspected: 'Suspected theft',
  other: 'Other',
}

export interface ShiftCashMovementTotals {
  paidIn: number
  paidOut: number
  /** paidIn − paidOut: what the movements add to the expected drawer cash */
  net: number
  count: number
}

/** Posted (not voided) paid-in / paid-out totals of a shift. */
export async function shiftCashMovementTotals(db: Db, openingEntryId: string): Promise<ShiftCashMovementTotals> {
  const [row] = await db.select({
    paidIn: sql<string>`COALESCE(SUM(CASE WHEN ${posCashMovements.type} = 'paid_in' THEN ${posCashMovements.amount} ELSE 0 END), 0)`,
    paidOut: sql<string>`COALESCE(SUM(CASE WHEN ${posCashMovements.type} = 'paid_out' THEN ${posCashMovements.amount} ELSE 0 END), 0)`,
    count: sql<number>`count(*)::int`,
  })
    .from(posCashMovements)
    .where(and(eq(posCashMovements.openingEntryId, openingEntryId), eq(posCashMovements.status, 'posted')))
  const paidIn = roundCurrency(parseCurrency(row?.paidIn))
  const paidOut = roundCurrency(parseCurrency(row?.paidOut))
  return { paidIn, paidOut, net: roundCurrency(paidIn - paidOut), count: row?.count || 0 }
}

export async function listShiftCashMovements(db: Db, openingEntryId: string) {
  return db.select({
    id: posCashMovements.id,
    movementNo: posCashMovements.movementNo,
    type: posCashMovements.type,
    category: posCashMovements.category,
    amount: posCashMovements.amount,
    accountId: posCashMovements.accountId,
    note: posCashMovements.note,
    status: posCashMovements.status,
    createdBy: posCashMovements.createdBy,
    createdByName: users.fullName,
    approvedBy: posCashMovements.approvedBy,
    voidedAt: posCashMovements.voidedAt,
    voidedBy: posCashMovements.voidedBy,
    voidReason: posCashMovements.voidReason,
    createdAt: posCashMovements.createdAt,
  })
    .from(posCashMovements)
    .leftJoin(users, eq(users.id, posCashMovements.createdBy))
    .where(eq(posCashMovements.openingEntryId, openingEntryId))
    .orderBy(posCashMovements.createdAt)
}

interface ShiftSaleLike {
  id: string
  invoiceNo: string
  status: string
  isReturn: boolean
  total: string
  taxAmount: string
  discountAmount: string
  taxBreakdown?: unknown
  paymentMethod?: string | null
  returnReason?: string | null
  voidReason?: string | null
  voidedAt?: Date | null
  voidedBy?: string | null
  approvedBy?: string | null
  payments?: Array<{ method: string; amount: string }>
}

export interface ShiftReportData {
  tax: { total: number; sales: number; returns: number; byName: Array<{ taxName: string; rate: number | null; amount: number }> }
  discounts: { total: number; cart: number; line: number; count: number }
  voids: { count: number; total: number; items: Array<{ invoiceNo: string; total: number; reason: string | null; voidedAt: string | null; voidedBy: string | null }> }
  returns: { count: number; total: number; items: Array<{ invoiceNo: string; total: number; method: string | null; reason: string | null }> }
  cashMovements: ShiftCashMovementTotals & {
    byCategory: Record<string, number>
    voidedCount: number
    items: Array<{ movementNo: string; type: string; category: string; amount: number; note: string | null; status: string; approvedBy: string | null }>
  }
  /** 0187: money taken outside the POS sale screen (included in the expected amounts), by source */
  outsideCollections: ShiftOutsideCollections
  approvals: { count: number }
  ledger: {
    posted: boolean
    cashAccountId: string | null
    /** Net cash-account postings (Dr − Cr) of the shift's sales, returns and cash movements */
    ledgerCash: number
    /** Expected drawer cash minus the opening float */
    expectedCashMovement: number
    difference: number
    tiesOut: boolean
  }
}

/**
 * Z-report details for a shift. `expectedCash` / `openingCash` are the drawer figures of the
 * reconciliation (opening float + cash sales − cash refunds + paid in − paid out).
 */
export async function buildShiftReport(db: Db, tenantId: string, input: {
  openingEntryId: string
  sales: ShiftSaleLike[]
  openingCash: number
  expectedCash: number
  outsideCollections?: ShiftOutsideCollections
}): Promise<ShiftReportData> {
  const live = input.sales.filter((s) => s.status !== 'void')

  // Tax summary (returns reverse their tax)
  const byName = new Map<string, { taxName: string; rate: number | null; amount: number }>()
  let taxSales = 0
  let taxReturns = 0
  for (const s of live) {
    const amount = Math.abs(parseCurrency(s.taxAmount))
    if (s.isReturn) taxReturns += amount
    else taxSales += amount
    const breakdown = Array.isArray(s.taxBreakdown) ? s.taxBreakdown as Array<{ taxName?: string; rate?: number; amount?: number }> : []
    for (const b of breakdown) {
      const key = `${b.taxName || 'Tax'}|${b.rate ?? ''}`
      const row = byName.get(key) || { taxName: b.taxName || 'Tax', rate: b.rate ?? null, amount: 0 }
      row.amount = roundCurrency(row.amount + (s.isReturn ? -Math.abs(Number(b.amount) || 0) : Math.abs(Number(b.amount) || 0)))
      byName.set(key, row)
    }
  }

  // Discounts: cart discount on the sale + line discounts
  const saleIds = live.filter((s) => !s.isReturn).map((s) => s.id)
  const lineDiscountBySale = new Map<string, number>()
  if (saleIds.length > 0) {
    const rows = await db.select({ saleId: saleItems.saleId, d: sql<string>`COALESCE(SUM(${saleItems.discount}), 0)` })
      .from(saleItems)
      .where(inArray(saleItems.saleId, saleIds))
      .groupBy(saleItems.saleId)
    for (const r of rows) lineDiscountBySale.set(r.saleId, parseCurrency(r.d))
  }
  let cart = 0
  let line = 0
  let discountedCount = 0
  for (const s of live) {
    if (s.isReturn) continue
    const c = parseCurrency(s.discountAmount)
    const l = lineDiscountBySale.get(s.id) || 0
    cart += c
    line += l
    if (c + l > 0.004) discountedCount++
  }

  const voided = input.sales.filter((s) => s.status === 'void' && !s.isReturn)
  const returns = live.filter((s) => s.isReturn)

  const movements = await listShiftCashMovements(db, input.openingEntryId)
  const posted = movements.filter((m: { status: string }) => m.status === 'posted')
  const byCategory: Record<string, number> = {}
  let paidIn = 0
  let paidOut = 0
  for (const m of posted) {
    const amount = parseCurrency(m.amount)
    const signed = m.type === 'paid_out' ? -amount : amount
    byCategory[`${m.type}:${m.category}`] = roundCurrency((byCategory[`${m.type}:${m.category}`] || 0) + signed)
    if (m.type === 'paid_out') paidOut += amount
    else paidIn += amount
  }

  // Ledger tie-out: the cash account must have moved by exactly what the drawer should hold
  // beyond its opening float (the float itself is not a GL posting).
  const cashAccountId = await resolvePosTenderAccount(db, tenantId, 'cash')
  const voucherIds = [...input.sales.map((s) => s.id), ...movements.map((m: { id: string }) => m.id)]
  let ledgerCash = 0
  let glRows = 0
  if (cashAccountId && voucherIds.length > 0) {
    const [row] = await db.select({
      net: sql<string>`COALESCE(SUM(CASE WHEN ${glEntries.accountId} = ${cashAccountId} THEN ${glEntries.debit} - ${glEntries.credit} ELSE 0 END), 0)`,
      n: sql<number>`count(*)::int`,
    })
      .from(glEntries)
      .where(and(
        eq(glEntries.tenantId, tenantId),
        inArray(glEntries.voucherId, voucherIds),
        ne(glEntries.voucherType, 'pos_shift_closing'),
      ))
    ledgerCash = roundCurrency(parseCurrency(row?.net))
    glRows = row?.n || 0
  }
  // No GL postings at all (auto-posting off / accounting not set up): nothing to tie out
  const ledgerPosted = !!cashAccountId && glRows > 0
  // A void_refund movement has no GL of its own: the voided sale's reversal (booked under the
  // original sale, another shift) is what credited Cash for it.
  const glLessOut = posted
    .filter((m: { category: string; type: string }) => m.category === 'void_refund' && m.type === 'paid_out')
    .reduce((sum: number, m: { amount: string }) => sum + parseCurrency(m.amount), 0)
  if (glLessOut > 0) ledgerCash = roundCurrency(ledgerCash - glLessOut)
  // The tie-out covers the shift's POS vouchers (sales, returns, movements); cash taken outside
  // the POS (0187) is posted under its own vouchers (advance / layaway / invoice), so it is left
  // out of both sides.
  const outside: ShiftOutsideCollections = input.outsideCollections || { total: 0, byMethod: {}, bySource: {}, count: 0, items: [] }
  const expectedCashMovement = roundCurrency(input.expectedCash - input.openingCash - (outside.byMethod.cash || 0))
  const difference = roundCurrency(ledgerCash - expectedCashMovement)

  return {
    tax: {
      total: roundCurrency(taxSales - taxReturns),
      sales: roundCurrency(taxSales),
      returns: roundCurrency(taxReturns),
      byName: [...byName.values()],
    },
    discounts: { total: roundCurrency(cart + line), cart: roundCurrency(cart), line: roundCurrency(line), count: discountedCount },
    voids: {
      count: voided.length,
      total: roundCurrency(voided.reduce((sum, s) => sum + Math.abs(parseCurrency(s.total)), 0)),
      items: voided.map((s) => ({
        invoiceNo: s.invoiceNo,
        total: roundCurrency(Math.abs(parseCurrency(s.total))),
        reason: s.voidReason || null,
        voidedAt: s.voidedAt ? new Date(s.voidedAt).toISOString() : null,
        voidedBy: s.voidedBy || null,
      })),
    },
    returns: {
      count: returns.length,
      total: roundCurrency(returns.reduce((sum, s) => sum + Math.abs(parseCurrency(s.total)), 0)),
      items: returns.map((s) => ({
        invoiceNo: s.invoiceNo,
        total: roundCurrency(Math.abs(parseCurrency(s.total))),
        method: s.payments?.[0]?.method || s.paymentMethod || null,
        reason: s.returnReason || null,
      })),
    },
    cashMovements: {
      paidIn: roundCurrency(paidIn),
      paidOut: roundCurrency(paidOut),
      net: roundCurrency(paidIn - paidOut),
      count: posted.length,
      voidedCount: movements.length - posted.length,
      byCategory,
      items: movements.map((m: { movementNo: string; type: string; category: string; amount: string; note: string | null; status: string; approvedBy: string | null }) => ({
        movementNo: m.movementNo, type: m.type, category: m.category, amount: roundCurrency(parseCurrency(m.amount)),
        note: m.note, status: m.status, approvedBy: m.approvedBy,
      })),
    },
    outsideCollections: outside,
    approvals: { count: live.filter((s) => !!s.approvedBy).length },
    ledger: {
      posted: ledgerPosted,
      cashAccountId,
      ledgerCash,
      expectedCashMovement,
      difference,
      tiesOut: !ledgerPosted || Math.abs(difference) < 0.01,
    },
  }
}

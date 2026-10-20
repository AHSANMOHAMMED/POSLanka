// Turns server responses (POST /api/sales, shift close) into the printer's
// ReceiptInput / ZReportInput documents. Business details come from
// GET /api/tenant (cached for the session), header/footer from the shift's
// POS profile.
import { apiGet, getUser } from './api'
import type { ReceiptInput, ReceiptLine, ReceiptPayment, ZReportInput } from './escpos'
import { shiftCounterName, type Shift } from './shift'

export interface BusinessInfo {
  name: string
  address?: string | null
  phone?: string | null
}

let cachedBusiness: BusinessInfo | null = null

/** GET /api/tenant → { name, address, phone }. Falls back to the login's tenant name. */
export async function loadBusinessInfo(force = false): Promise<BusinessInfo> {
  if (cachedBusiness && !force) return cachedBusiness
  const user = await getUser()
  const fallback: BusinessInfo = { name: user?.tenantName || 'POSLanka', address: null, phone: null }
  const res = await apiGet<{ name?: string; address?: string | null; phone?: string | null }>('/api/tenant')
  if (res.ok && res.data) {
    cachedBusiness = {
      name: res.data.name || fallback.name,
      address: res.data.address || null,
      phone: res.data.phone || null,
    }
    return cachedBusiness
  }
  return fallback
}

export function clearBusinessInfoCache() {
  cachedBusiness = null
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return isNaN(n) ? 0 : n
}

/** Shape of the relevant parts of the POST /api/sales (and GET /api/sales rows) response. */
export interface SaleResponseLike {
  id?: string
  invoiceNo: string
  items?: Array<{ itemName?: string; name?: string; quantity: string | number; unitPrice: string | number; total?: string | number; unit?: string | null }>
  payments?: Array<{ method?: string; paymentMethod?: string; amount: string | number; reference?: string | null }>
  paymentMethod?: string | null
  subtotal?: string | number
  discountAmount?: string | number
  discount?: string | number
  taxAmount?: string | number
  tax?: string | number
  taxBreakdown?: Array<{ taxName?: string; name?: string; amount: string | number }> | null
  total: string | number
  paidAmount?: string | number
  createdAt?: string
  isReturn?: boolean
  customerName?: string | null
  customer?: { name?: string } | null
}

export interface ReceiptContext {
  business: BusinessInfo
  shift?: Shift | null
  cashier?: string | null
  customerName?: string | null
  /** Change handed back (cash sales). */
  change?: number
  /** Fallback payment when the response has no `payments` (e.g. offline). */
  fallbackPayment?: { method: string; amount: number; reference?: string | null }
}

export function receiptFromSale(sale: SaleResponseLike, ctx: ReceiptContext): ReceiptInput {
  const lines: ReceiptLine[] = (sale.items || []).map((i) => {
    const qty = num(i.quantity)
    const unitPrice = num(i.unitPrice)
    return {
      name: i.itemName || i.name || 'Item',
      qty,
      unit: i.unit || null,
      unitPrice,
      total: i.total !== undefined ? num(i.total) : qty * unitPrice,
    }
  })

  let payments: ReceiptPayment[] = (sale.payments || [])
    .map((p) => ({ method: p.method || p.paymentMethod || 'cash', amount: num(p.amount), reference: p.reference || null }))
    .filter((p) => p.amount !== 0)
  if (payments.length === 0) {
    if (ctx.fallbackPayment) payments = [ctx.fallbackPayment]
    else payments = [{ method: sale.paymentMethod || 'cash', amount: num(sale.paidAmount ?? sale.total) }]
  }

  const taxAmount = num(sale.taxAmount ?? sale.tax)
  const taxLines =
    Array.isArray(sale.taxBreakdown) && sale.taxBreakdown.length
      ? sale.taxBreakdown.map((t) => ({ name: t.taxName || t.name || 'Tax', amount: num(t.amount) }))
      : taxAmount
        ? [{ name: 'Tax', amount: taxAmount }]
        : []

  const profile = ctx.shift?.posProfile
  return {
    business: ctx.business,
    header: profile?.receiptHeader || null,
    footer: profile?.receiptFooter || null,
    invoiceNo: sale.invoiceNo,
    dateTime: sale.createdAt || new Date(),
    cashier: ctx.cashier || null,
    counter: shiftCounterName(ctx.shift) || null,
    customer: ctx.customerName || sale.customerName || sale.customer?.name ? { name: ctx.customerName || sale.customerName || sale.customer?.name || '' } : null,
    lines,
    subtotal: num(sale.subtotal),
    discount: num(sale.discountAmount ?? sale.discount),
    taxLines,
    total: num(sale.total),
    payments,
    change: ctx.change && ctx.change > 0 ? ctx.change : undefined,
    isReturn: Boolean(sale.isReturn) || num(sale.total) < 0,
    // The QR carries the invoice number so a later return can be started by scanning the slip.
    qrPayload: /^(INV|RTN)-/i.test(sale.invoiceNo) ? sale.invoiceNo : null,
  }
}

export interface ShiftCloseLike {
  closingEntry?: { entryNumber?: string; closingTime?: string } | null
  reconciliation?: Array<{
    paymentMethod: string
    openingAmount?: string | number
    expectedAmount?: string | number
    actualAmount?: string | number
    variance?: number
    difference?: number
  }>
  summary?: { totalSales: number; totalReturns: number; netSales: number; totalTransactions: number; totalVariance: number }
}

export function zReportFromClose(result: ShiftCloseLike, ctx: { business: BusinessInfo; shift?: Shift | null; cashier?: string | null; notes?: string | null }): ZReportInput {
  const rows = result.reconciliation || []
  const tenders = rows.map((r) => ({
    method: r.paymentMethod,
    opening: r.openingAmount !== undefined ? num(r.openingAmount) : undefined,
    expected: num(r.expectedAmount),
    actual: num(r.actualAmount),
    variance: r.variance ?? r.difference ?? num(r.actualAmount) - num(r.expectedAmount),
  }))
  const summary = result.summary || {
    totalSales: 0,
    totalReturns: 0,
    netSales: 0,
    totalTransactions: 0,
    totalVariance: tenders.reduce((s, t) => s + (t.variance || 0), 0),
  }
  return {
    business: ctx.business,
    entryNumber: result.closingEntry?.entryNumber || null,
    counter: shiftCounterName(ctx.shift) || null,
    cashier: ctx.cashier || null,
    openedAt: ctx.shift?.openingTime || null,
    closedAt: result.closingEntry?.closingTime || new Date(),
    summary,
    tenders,
    notes: ctx.notes || null,
  }
}

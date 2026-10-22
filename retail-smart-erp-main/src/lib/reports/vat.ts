/**
 * Sri Lanka VAT schedules (H2): per-document Output VAT and Input VAT schedules for a period and
 * a summary that reconciles them to the GL tax accounts.
 *
 * Output VAT schedule rows: invoices (positive), sales returns and credit notes (negative,
 * referencing the original invoice) and debit notes (positive). Each document's value excl. VAT
 * is split into standard-rated / zero-rated / exempt / other via the line's tax template category
 * (sale_items.tax_template_id → item's template → default template, see classifyVatLine).
 *
 * Dates: sales by the tenant-local day of created_at (same as the other sales reports), notes by
 * posting_date, purchases by the supplier bill date (else the local day recorded).
 */
import { sql } from 'drizzle-orm'
import { tenantDayRange, localTs } from './date-range'
import { classifyVatLine, isTaxCategory, type VatBucket } from '@/lib/utils/tax-category'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return Number.isFinite(n) ? n : 0
}
const rowsOf = <T>(res: unknown): T[] => ((res as { rows?: T[] }).rows ?? (res as T[]))
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))

export type OutputDocType = 'invoice' | 'return' | 'credit_note' | 'debit_note'

export interface OutputVatRow {
  date: string
  docType: OutputDocType
  docId: string
  docNo: string
  /** Original invoice for returns / credit notes / debit notes. */
  refDocNo: string | null
  buyerTin: string | null
  buyerName: string | null
  taxableValue: number
  vat: number
  zeroRatedValue: number
  exemptValue: number
  otherValue: number
  total: number
}

export interface InputVatRow {
  date: string
  purchaseId: string
  purchaseNo: string
  supplierInvoiceNo: string | null
  supplierName: string | null
  supplierTin: string | null
  isReturn: boolean
  value: number
  vat: number
  total: number
}

type Buckets = Record<VatBucket, number>
const emptyBuckets = (): Buckets => ({ standard: 0, zero_rated: 0, exempt: 0, other: 0 })

interface Period { fromDate: string; toDate: string }

export async function getOutputVatSchedule(db: DbInstance, tenantId: string, period: Period) {
  const range = await tenantDayRange(tenantId, period.fromDate, period.toDate)
  const local = localTs(sql.raw('s.created_at'), range.tz)

  // ── Sales & returns (one row per line; folded per document below)
  const saleLines = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT s.id, s.invoice_no, (${local})::date AS doc_date, s.is_return, o.invoice_no AS original_no,
           COALESCE(c.name, s.customer_name) AS buyer_name, c.tax_id AS buyer_tin, c.tax_exempt AS customer_exempt,
           s.subtotal, s.discount_amount, s.tax_amount, s.total,
           si.id AS line_id, si.total AS line_total, si.tax_amount AS line_tax,
           COALESCE(tt.tax_category, itt.tax_category, dtt.tax_category) AS category
    FROM sales s
    LEFT JOIN sales o ON o.id = s.return_against
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    LEFT JOIN tax_templates tt ON tt.id = si.tax_template_id
    LEFT JOIN items it ON it.id = si.item_id
    LEFT JOIN tax_templates itt ON itt.id = it.tax_template_id
    LEFT JOIN accounting_settings ast ON ast.tenant_id = s.tenant_id
    LEFT JOIN tax_templates dtt ON dtt.id = ast.default_tax_template_id
    WHERE s.tenant_id = ${tenantId}
      AND s.created_at >= ${range.from.toISOString()} AND s.created_at <= ${range.to.toISOString()}
      AND s.status <> 'void'
    ORDER BY s.created_at, s.invoice_no, si.id
  `))

  const rows: OutputVatRow[] = []
  const docs = new Map<string, { head: Record<string, unknown>; lines: Record<string, unknown>[] }>()
  for (const l of saleLines) {
    const id = String(l.id)
    if (!docs.has(id)) docs.set(id, { head: l, lines: [] })
    if (l.line_id) docs.get(id)!.lines.push(l)
  }
  for (const { head, lines } of docs.values()) {
    const isReturn = !!head.is_return
    const sign = isReturn ? -1 : 1
    const total = Math.abs(num(head.total))
    const vat = Math.abs(num(head.tax_amount))
    const subtotal = Math.abs(num(head.subtotal))
    const ratio = subtotal > 0 ? Math.max(0, 1 - Math.abs(num(head.discount_amount)) / subtotal) : 1
    const b = emptyBuckets()
    let hasStandard = false
    for (const l of lines) {
      const bucket = classifyVatLine({
        taxAmount: Math.abs(num(l.line_tax)),
        category: isTaxCategory(l.category) ? l.category : null,
        customerTaxExempt: !!head.customer_exempt,
      })
      if (bucket === 'standard') hasStandard = true
      else b[bucket] += Math.abs(num(l.line_total)) * ratio
    }
    // Document value excl. VAT is exact (total − VAT); standard-rated takes the remainder
    finalizeBuckets(b, r2(total - vat), hasStandard || vat > 0)
    rows.push({
      date: ymd(head.doc_date),
      docType: isReturn ? 'return' : 'invoice',
      docId: String(head.id),
      docNo: String(head.invoice_no),
      refDocNo: isReturn ? (head.original_no as string | null) ?? null : null,
      buyerTin: (head.buyer_tin as string | null) || null,
      buyerName: (head.buyer_name as string | null) || null,
      taxableValue: r2(sign * b.standard),
      vat: r2(sign * vat),
      zeroRatedValue: r2(sign * b.zero_rated),
      exemptValue: r2(sign * b.exempt),
      otherValue: r2(sign * b.other),
      total: r2(sign * total),
    })
  }

  // ── Credit notes (negative) and debit notes (positive)
  for (const kind of ['credit_note', 'debit_note'] as const) {
    const isCredit = kind === 'credit_note'
    const t = sql.raw(isCredit ? 'credit_notes' : 'debit_notes')
    const ti = sql.raw(isCredit ? 'credit_note_items ni ON ni.credit_note_id = n.id' : 'debit_note_items ni ON ni.debit_note_id = n.id')
    const noCol = sql.raw(isCredit ? 'n.credit_note_no' : 'n.debit_note_no')
    const statusFilter = isCredit ? sql`n.status IN ('issued', 'applied')` : sql`n.status = 'issued'`
    const docDate = sql`COALESCE(n.posting_date, (${localTs(sql.raw('n.created_at'), range.tz)})::date)`
    const noteLines = rowsOf<Record<string, unknown>>(await db.execute(sql`
      SELECT n.id, ${noCol} AS doc_no, ${docDate} AS doc_date, n.tax, n.total, s.invoice_no AS original_no,
             COALESCE(c.name, n.customer_name) AS buyer_name, c.tax_id AS buyer_tin, c.tax_exempt AS customer_exempt,
             ni.id AS line_id, ni.total AS line_total, ni.tax AS line_tax, tt.tax_category AS category
      FROM ${t} n
      LEFT JOIN ${ti}
      LEFT JOIN sales s ON s.id = n.sale_id
      LEFT JOIN customers c ON c.id = n.customer_id
      LEFT JOIN tax_templates tt ON tt.id = ni.tax_template_id
      WHERE n.tenant_id = ${tenantId} AND ${statusFilter}
        AND ${docDate} BETWEEN ${period.fromDate}::date AND ${period.toDate}::date
      ORDER BY doc_date, doc_no, ni.id
    `))
    const notes = new Map<string, { head: Record<string, unknown>; lines: Record<string, unknown>[] }>()
    for (const l of noteLines) {
      const id = String(l.id)
      if (!notes.has(id)) notes.set(id, { head: l, lines: [] })
      if (l.line_id) notes.get(id)!.lines.push(l)
    }
    const sign = isCredit ? -1 : 1
    for (const { head, lines } of notes.values()) {
      const total = Math.abs(num(head.total))
      const vat = Math.abs(num(head.tax))
      const b = emptyBuckets()
      let hasStandard = false
      for (const l of lines) {
        const bucket = classifyVatLine({
          taxAmount: Math.abs(num(l.line_tax)),
          category: isTaxCategory(l.category) ? l.category : null,
          customerTaxExempt: !!head.customer_exempt,
        })
        if (bucket === 'standard') hasStandard = true
        else b[bucket] += Math.abs(num(l.line_total))
      }
      finalizeBuckets(b, r2(total - vat), hasStandard || vat > 0)
      rows.push({
        date: ymd(head.doc_date),
        docType: kind,
        docId: String(head.id),
        docNo: String(head.doc_no),
        refDocNo: (head.original_no as string | null) || null,
        buyerTin: (head.buyer_tin as string | null) || null,
        buyerName: (head.buyer_name as string | null) || null,
        taxableValue: r2(sign * b.standard),
        vat: r2(sign * vat),
        zeroRatedValue: r2(sign * b.zero_rated),
        exemptValue: r2(sign * b.exempt),
        otherValue: r2(sign * b.other),
        total: r2(sign * total),
      })
    }
  }

  rows.sort((a, b) => (a.date === b.date ? a.docNo.localeCompare(b.docNo) : a.date.localeCompare(b.date)))
  return { rows, totals: sumOutput(rows), period }
}

function finalizeBuckets(b: Buckets, netValue: number, hasStandard: boolean) {
  const nonStd = b.zero_rated + b.exempt + b.other
  if (hasStandard) {
    b.standard = netValue - nonStd
    if (b.standard < 0) { b.other += b.standard; b.standard = 0 }
    return
  }
  // No VAT on the document: rounding / charges outside the lines go to the largest bucket
  const residual = netValue - nonStd
  const largest = (['zero_rated', 'exempt', 'other'] as const).reduce((m, k) => (b[k] > b[m] ? k : m), 'other' as 'zero_rated' | 'exempt' | 'other')
  b[largest] += residual
}

function sumOutput(rows: OutputVatRow[]) {
  const t = { taxableValue: 0, vat: 0, zeroRatedValue: 0, exemptValue: 0, otherValue: 0, total: 0, documents: rows.length }
  for (const r of rows) {
    t.taxableValue += r.taxableValue; t.vat += r.vat; t.zeroRatedValue += r.zeroRatedValue
    t.exemptValue += r.exemptValue; t.otherValue += r.otherValue; t.total += r.total
  }
  return { ...t, taxableValue: r2(t.taxableValue), vat: r2(t.vat), zeroRatedValue: r2(t.zeroRatedValue), exemptValue: r2(t.exemptValue), otherValue: r2(t.otherValue), total: r2(t.total) }
}

export async function getInputVatSchedule(db: DbInstance, tenantId: string, period: Period) {
  const range = await tenantDayRange(tenantId, period.fromDate, period.toDate)
  const docDate = sql`COALESCE(p.supplier_bill_date, (${localTs(sql.raw('p.created_at'), range.tz)})::date)`
  const res = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT p.id, p.purchase_no, p.supplier_invoice_no, ${docDate} AS doc_date, p.is_return, p.tax_amount, p.total,
           sp.name AS supplier_name, sp.tax_id AS supplier_tin
    FROM purchases p
    LEFT JOIN suppliers sp ON sp.id = p.supplier_id
    WHERE p.tenant_id = ${tenantId}
      AND p.status NOT IN ('cancelled', 'draft')
      AND ${docDate} BETWEEN ${period.fromDate}::date AND ${period.toDate}::date
    ORDER BY doc_date, p.purchase_no
  `))
  const rows: InputVatRow[] = res.map((p) => {
    const sign = p.is_return ? -1 : 1
    const total = Math.abs(num(p.total))
    const vat = Math.abs(num(p.tax_amount))
    return {
      date: ymd(p.doc_date),
      purchaseId: String(p.id),
      purchaseNo: String(p.purchase_no),
      supplierInvoiceNo: (p.supplier_invoice_no as string | null) || null,
      supplierName: (p.supplier_name as string | null) || null,
      supplierTin: (p.supplier_tin as string | null) || null,
      isReturn: !!p.is_return,
      value: r2(sign * (total - vat)),
      vat: r2(sign * vat),
      total: r2(sign * total),
    }
  })
  const totals = rows.reduce((t, r) => ({ value: t.value + r.value, vat: t.vat + r.vat, total: t.total + r.total }), { value: 0, vat: 0, total: 0 })
  return {
    rows,
    totals: { value: r2(totals.value), vat: r2(totals.vat), total: r2(totals.total), documents: rows.length, withoutSupplierTin: rows.filter((r) => !r.supplierTin && r.vat !== 0).length },
    period,
  }
}

/** GL voucher types whose tax-account postings are output VAT (sales side). */
export const OUTPUT_VAT_VOUCHER_TYPES = ['sale', 'refund', 'credit_note', 'debit_note', 'work_order_invoice']
/** GL voucher types whose tax-account postings are input VAT (purchases). */
export const INPUT_VAT_VOUCHER_TYPES = ['purchase']

/**
 * VAT return summary: schedule totals vs. the GL tax accounts for the same period. Tax accounts are
 * the default Tax account plus every account used on a tax template. A shared input/output account
 * is split by voucher type; other postings (VAT paid to the IRD, journals) are shown separately.
 */
export async function getVatSummary(db: DbInstance, tenantId: string, period: Period) {
  const [output, input] = await Promise.all([
    getOutputVatSchedule(db, tenantId, period),
    getInputVatSchedule(db, tenantId, period),
  ])
  const accounts = rowsOf<{ id: string; name: string; account_number: string | null }>(await db.execute(sql`
    SELECT a.id, a.name, a.account_number FROM chart_of_accounts a
    WHERE a.tenant_id = ${tenantId} AND a.id IN (
      SELECT default_tax_account_id FROM accounting_settings WHERE tenant_id = ${tenantId} AND default_tax_account_id IS NOT NULL
      UNION SELECT account_id FROM tax_template_items WHERE tenant_id = ${tenantId} AND account_id IS NOT NULL
    )
  `))
  let gl: { outputVat: number; inputVat: number; otherMovements: number; byVoucherType: Array<{ voucherType: string; net: number }> } | null = null
  if (accounts.length) {
    const ids = accounts.map((a) => a.id)
    const byType = rowsOf<{ voucher_type: string; credit_minus_debit: string }>(await db.execute(sql`
      SELECT voucher_type, COALESCE(SUM(credit - debit), 0) AS credit_minus_debit
      FROM gl_entries
      WHERE tenant_id = ${tenantId}
        AND account_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND posting_date BETWEEN ${period.fromDate}::date AND ${period.toDate}::date
      GROUP BY voucher_type ORDER BY voucher_type
    `))
    let outputVat = 0, inputVat = 0, other = 0
    for (const r of byType) {
      const v = num(r.credit_minus_debit)
      if (OUTPUT_VAT_VOUCHER_TYPES.includes(r.voucher_type)) outputVat += v
      else if (INPUT_VAT_VOUCHER_TYPES.includes(r.voucher_type)) inputVat -= v
      else other += v
    }
    gl = {
      outputVat: r2(outputVat),
      inputVat: r2(inputVat),
      otherMovements: r2(other),
      byVoucherType: byType.map((r) => ({ voucherType: r.voucher_type, net: r2(num(r.credit_minus_debit)) })),
    }
  }
  return {
    period,
    taxAccounts: accounts.map((a) => ({ id: a.id, name: a.name, accountNumber: a.account_number })),
    output: output.totals,
    input: input.totals,
    netVatPayable: r2(output.totals.vat - input.totals.vat),
    gl,
    differences: gl ? {
      outputVat: r2(output.totals.vat - gl.outputVat),
      inputVat: r2(input.totals.vat - gl.inputVat),
    } : null,
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  // Neutralise spreadsheet formula injection, then quote
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(headers: Array<[key: string, label: string]>, rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(([, l]) => csvCell(l)).join(',')]
  for (const r of rows) lines.push(headers.map(([k]) => csvCell(r[k])).join(','))
  return lines.join('\r\n') + '\r\n'
}

export const OUTPUT_VAT_CSV_COLUMNS: Array<[string, string]> = [
  ['date', 'Date'], ['docType', 'Document Type'], ['docNo', 'Invoice / Note No'], ['refDocNo', 'Original Invoice No'],
  ['buyerTin', 'Buyer TIN / VAT No'], ['buyerName', 'Buyer Name'], ['taxableValue', 'Taxable Value (Standard Rated)'],
  ['vat', 'VAT'], ['zeroRatedValue', 'Zero-rated Value'], ['exemptValue', 'Exempt Value'], ['otherValue', 'Other / Unclassified'],
  ['total', 'Invoice Total'],
]

export const INPUT_VAT_CSV_COLUMNS: Array<[string, string]> = [
  ['date', 'Supplier Invoice Date'], ['supplierInvoiceNo', 'Supplier Invoice No'], ['purchaseNo', 'Purchase No'],
  ['supplierTin', 'Supplier TIN / VAT No'], ['supplierName', 'Supplier Name'], ['value', 'Value excl. VAT'], ['vat', 'VAT'], ['total', 'Total'],
]

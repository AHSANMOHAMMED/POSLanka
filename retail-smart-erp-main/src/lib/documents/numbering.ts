import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import { nextSequence, bumpSequence } from '@/lib/inventory/item-codes'

/**
 * D1 — per-tenant document numbers on top of `tenant_sequences` (nextSequence).
 *
 * Replaces the old generators (count(*) + 1, LIKE + ORDER BY DESC, MAX(text), global
 * pg_advisory_xact_lock(N)): allocation is a single row-locked upsert per tenant and key, so
 * concurrent documents of one tenant get unique, gap-free (unless rolled back) numbers and
 * tenants never block each other. Formats are unchanged.
 *
 * Period series (daily / monthly / yearly) use one key per period, e.g. 'grn:20261021'.
 * Every key is seeded on first use from the NUMERIC maximum of the existing numbers of that
 * tenant (and drizzle/0143 seeds them for existing data), so switching over never re-issues a
 * number that already exists.
 */

type PeriodKind = 'none' | 'utc_day' | 'local_day' | 'local_year' | 'explicit'

interface SeriesDef {
  /** tenant_sequences.seq_key base (max 40 chars incl. ':<period>') */
  key: string
  table: string
  column: string
  period: PeriodKind
  /** Document number for counter `n` in `period` ('' when period = none). */
  format: (n: number, period: string) => string
  /** Literal prefix before the counter digits (used for seeding). */
  prefix: (period: string) => string
}

const pad = (n: number, w: number) => String(n).padStart(w, '0')

function simple(key: string, table: string, column: string, prefix: string, width: number): SeriesDef {
  return { key, table, column, period: 'none', prefix: () => prefix, format: (n) => `${prefix}${pad(n, width)}` }
}

function daily(key: string, table: string, column: string, code: string, width: number, period: PeriodKind = 'utc_day'): SeriesDef {
  return {
    key, table, column, period,
    prefix: (p) => `${code}-${p}-`,
    format: (n, p) => `${code}-${p}-${pad(n, width)}`,
  }
}

export const DOCUMENT_SERIES = {
  purchase_invoice: daily('purchase_invoice', 'purchases', 'purchase_no', 'PI', 3),
  purchase_return: daily('purchase_return', 'purchases', 'purchase_no', 'PR', 3),
  purchase_requisition: daily('purchase_requisition', 'purchase_requisitions', 'requisition_no', 'PR', 3),
  purchase_order: daily('purchase_order', 'purchase_orders', 'order_no', 'PO', 3),
  supplier_quotation: daily('supplier_quotation', 'supplier_quotations', 'quotation_no', 'SQ', 3),
  sales_order: daily('sales_order', 'sales_orders', 'order_no', 'SO', 3),
  grn: daily('grn', 'purchase_receipts', 'receipt_no', 'GRN', 3),
  landed_cost: daily('landed_cost', 'landed_cost_vouchers', 'voucher_no', 'LCV', 3), // H3
  stock_take: daily('stock_take', 'stock_takes', 'count_no', 'SC', 3),
  dealer_payment: daily('dealer_payment', 'dealer_payments', 'payment_no', 'DP', 3),
  pos_opening: daily('pos_opening', 'pos_opening_entries', 'entry_number', 'POS', 3, 'local_day'),
  pos_closing: daily('pos_closing', 'pos_closing_entries', 'entry_number', 'CLOSE', 3, 'local_day'),
  vehicle_import: daily('vehicle_import', 'vehicle_imports', 'import_no', 'IM', 3, 'local_day'),
  stock_transfer: {
    key: 'stock_transfer', table: 'stock_transfers', column: 'transfer_no', period: 'local_year',
    prefix: (p: string) => `ST${p}`,
    format: (n: number, p: string) => `ST${p}${pad(n, 5)}`,
  } as SeriesDef,
  salary_slip: {
    key: 'salary_slip', table: 'salary_slips', column: 'slip_no', period: 'explicit',
    prefix: (p: string) => `SAL-${p}-`,
    format: (n: number, p: string) => `SAL-${p}-${pad(n, 3)}`,
  } as SeriesDef,
  payroll_run: {
    key: 'payroll_run', table: 'payroll_runs', column: 'run_no', period: 'explicit',
    prefix: (p: string) => `PR-${p}-`,
    format: (n: number, p: string) => `PR-${p}-${pad(n, 2)}`,
  } as SeriesDef,
  layaway: simple('layaway', 'layaways', 'layaway_no', 'LAY-', 6),
  journal_entry: simple('journal_entry', 'journal_entries', 'entry_number', 'JE-', 4),
  payment_entry: simple('payment_entry', 'payment_entries', 'entry_number', 'PE-', 4),
  dunning: simple('dunning', 'dunnings', 'dunning_number', 'DUN-', 4),
  payment_request: simple('payment_request', 'payment_requests', 'request_number', 'PRQ-', 4),
  quotation: simple('quotation', 'quotations', 'quotation_no', 'QT-', 5),
  held_sale: simple('held_sale', 'held_sales', 'hold_number', 'HOLD-', 4),
  work_order: simple('work_order', 'work_orders', 'order_no', 'WO-', 6),
  insurance_estimate: simple('insurance_estimate', 'insurance_estimates', 'estimate_no', 'EST-', 6),
  vehicle_sale: simple('vehicle_sale', 'sales', 'invoice_no', 'VS-', 6),
  commission_payout: simple('commission_payout', 'commission_payouts', 'payout_no', 'PAY-', 6),
  employee_advance: simple('employee_advance', 'employee_advances', 'advance_no', 'ADV-', 5),
  restaurant_order: simple('restaurant_order', 'restaurant_orders', 'order_no', 'RO-', 6),
} satisfies Record<string, SeriesDef>

export type DocumentSeries = keyof typeof DOCUMENT_SERIES

export interface DocNumberOptions {
  /** Date for period series (default: now). */
  date?: Date
  /** Explicit period for 'explicit' series, e.g. '2026-10' for salary slips / payroll runs. */
  period?: string
}

function periodOf(def: SeriesDef, opts: DocNumberOptions): string {
  const d = opts.date || new Date()
  switch (def.period) {
    case 'none': return ''
    case 'utc_day': return d.toISOString().slice(0, 10).replace(/-/g, '')
    case 'local_day': return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`
    case 'local_year': return String(d.getFullYear())
    case 'explicit':
      if (!opts.period) throw new Error(`Document series ${def.key} needs an explicit period`)
      return opts.period
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

/** Seed `seqKey` from the numeric maximum of existing numbers (only when the key is new). */
async function ensureSeeded(tx: DbTx, tenantId: string, def: SeriesDef, seqKey: string, period: string): Promise<void> {
  const [exists] = rows<{ x: number }>(await tx.execute(sql`
    SELECT 1 AS x FROM tenant_sequences WHERE tenant_id = ${tenantId} AND seq_key = ${seqKey}
  `))
  if (exists) return
  const pattern = `^${escapeRegex(def.prefix(period))}(\\d{1,15})$`
  const [row] = rows<{ max: string | null }>(await tx.execute(sql`
    SELECT MAX((regexp_match(${sql.identifier(def.column)}, ${pattern}))[1]::numeric)::text AS max
    FROM ${sql.identifier(def.table)}
    WHERE tenant_id = ${tenantId} AND ${sql.identifier(def.column)} ~ ${pattern}
  `))
  const max = row?.max ? Number(row.max) : 0
  if (max > 0) await bumpSequence(tx, tenantId, seqKey, max)
}

/**
 * Allocate `count` consecutive numbers of a series for the tenant (inside the caller's
 * transaction; a rollback releases them).
 */
export async function nextDocumentNumbers(
  tx: DbTx, tenantId: string, series: DocumentSeries, count: number, opts: DocNumberOptions = {},
): Promise<string[]> {
  const def: SeriesDef = DOCUMENT_SERIES[series]
  const period = periodOf(def, opts)
  const seqKey = period ? `${def.key}:${period}` : def.key
  await ensureSeeded(tx, tenantId, def, seqKey, period)
  const first = await nextSequence(tx, tenantId, seqKey, count)
  return Array.from({ length: count }, (_, i) => def.format(first + i, period))
}

/** Allocate the next number of a series, e.g. nextDocNo(tx, tenantId, 'grn') → 'GRN-20261021-004'. */
export async function nextDocNo(tx: DbTx, tenantId: string, series: DocumentSeries, opts: DocNumberOptions = {}): Promise<string> {
  const [no] = await nextDocumentNumbers(tx, tenantId, series, 1, opts)
  return no
}

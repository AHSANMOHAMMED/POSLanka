/**
 * Controlled-drug register (narcotics / psychotropics, NMRA): per controlled medicine a running
 * ledger for a date range — opening balance, received (purchases / GRN), dispensed (sales, with the
 * prescription's doctor and patient), returns, adjustments and the closing balance.
 *
 * Nothing is stored twice: the lines are the stock ledger (stock_movements, every stock change goes
 * through applyStockChange) and the prescription register (prescriptions, one per sale). The
 * closing balance is today's warehouse stock minus everything that moved after the range, so the
 * register always agrees with the stock on hand even for stock that predates the ledger.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'

type Db = Pick<TenantDb, 'execute'>

export type RegisterCategory = 'received' | 'dispensed' | 'customer_return' | 'supplier_return' | 'transfer' | 'adjustment'

export const REGISTER_CATEGORY_LABELS: Record<RegisterCategory, string> = {
  received: 'Received',
  dispensed: 'Dispensed',
  customer_return: 'Returned by patient',
  supplier_return: 'Returned to supplier',
  transfer: 'Branch transfer',
  adjustment: 'Adjustment',
}

export interface RegisterLine {
  id: string
  date: string
  category: RegisterCategory
  referenceType: string | null
  referenceNo: string | null
  saleId: string | null
  warehouseName: string | null
  qtyIn: number
  qtyOut: number
  balance: number
  doctorName: string | null
  doctorRegNo: string | null
  patientName: string | null
  prescriptionNo: string | null
  notes: string | null
  userName: string | null
}

export interface RegisterDrug {
  itemId: string
  name: string
  genericName: string | null
  strength: string | null
  dosageForm: string | null
  unit: string | null
  opening: number
  received: number
  dispensed: number
  returns: number
  adjustments: number
  closing: number
  lines: RegisterLine[]
}

const r4 = (n: number) => Math.round(n * 10000) / 10000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

/** SQL CASE: ledger reference type → register column */
const CATEGORY_SQL = sql`CASE
  WHEN sm.reference_type = 'sale' AND sm.qty_change < 0 THEN 'dispensed'
  WHEN sm.reference_type IN ('sale', 'return', 'return_quarantine', 'sale_void', 'sale_return') THEN 'customer_return'
  WHEN sm.reference_type LIKE 'purchase_return%' THEN 'supplier_return'
  WHEN sm.reference_type LIKE 'purchase%' OR sm.reference_type LIKE 'grn%' OR sm.reference_type = 'stock_intake' THEN 'received'
  WHEN sm.reference_type LIKE 'stock_transfer%' THEN 'transfer'
  ELSE 'adjustment' END`

export interface RegisterQuery {
  tenantId: string
  /** YYYY-MM-DD, inclusive */
  from: string
  to: string
  itemId?: string | null
  /** one branch; null = every branch in `scope` */
  warehouseId?: string | null
  /** branch scope of the caller (null = all branches) */
  scope: string[] | null
}

function warehouseCond(col: string, q: RegisterQuery): SQL {
  if (q.warehouseId) return sql` AND ${sql.raw(col)} = ${q.warehouseId}::uuid`
  if (q.scope) return sql` AND ${sql.raw(col)} IN (${sql.join(q.scope.map((id) => sql`${id}::uuid`), sql`, `)})`
  return sql``
}

export async function buildControlledRegister(db: Db, q: RegisterQuery): Promise<RegisterDrug[]> {
  const start = `${q.from} 00:00:00`
  const end = `${q.to} 23:59:59.999`
  const itemCond = q.itemId ? sql` AND i.id = ${q.itemId}::uuid` : sql``

  const drugs = rows<{
    id: string; name: string; generic_name: string | null; strength: string | null; dosage_form: string | null; unit: string | null
    on_hand: string; after_to: string
  }>(await db.execute(sql`
    SELECT i.id, i.name, i.generic_name, i.strength, i.dosage_form, i.unit,
      coalesce((SELECT sum(ws.current_stock) FROM warehouse_stock ws
        WHERE ws.tenant_id = i.tenant_id AND ws.item_id = i.id${warehouseCond('ws.warehouse_id', q)}), 0) AS on_hand,
      coalesce((SELECT sum(sm.qty_change) FROM stock_movements sm
        WHERE sm.tenant_id = i.tenant_id AND sm.item_id = i.id AND sm.created_at > ${end}::timestamp${warehouseCond('sm.warehouse_id', q)}), 0) AS after_to
    FROM items i
    WHERE i.tenant_id = ${q.tenantId}::uuid AND i.drug_schedule = 'controlled'${itemCond}
    ORDER BY lower(coalesce(i.generic_name, i.name)), i.name
    LIMIT 500
  `))
  if (drugs.length === 0) return []

  const ids = drugs.map((d) => d.id)
  const lines = rows<{
    id: string; item_id: string; created_at: string; category: RegisterCategory; reference_type: string | null; qty_change: string
    notes: string | null; warehouse_name: string | null; user_name: string | null; sale_id: string | null; ref_no: string | null
    doctor_name: string | null; doctor_reg_no: string | null; patient_name: string | null; prescription_no: string | null
  }>(await db.execute(sql`
    SELECT sm.id, sm.item_id, sm.created_at, ${CATEGORY_SQL} AS category, sm.reference_type, sm.qty_change, sm.notes,
      w.name AS warehouse_name, u.full_name AS user_name,
      s.id AS sale_id,
      coalesce(s.invoice_no, p.purchase_no, pr.receipt_no) AS ref_no,
      rx.doctor_name, rx.doctor_reg_no, coalesce(rx.patient_name, s.customer_name) AS patient_name, rx.prescription_no
    FROM stock_movements sm
    LEFT JOIN warehouses w ON w.id = sm.warehouse_id
    LEFT JOIN users u ON u.id = sm.created_by
    LEFT JOIN sales s ON s.id = sm.reference_id AND sm.reference_type IN ('sale', 'return', 'return_quarantine', 'sale_void', 'sale_return')
    LEFT JOIN purchases p ON p.id = sm.reference_id AND sm.reference_type LIKE 'purchase%'
    LEFT JOIN purchase_receipts pr ON pr.id = sm.reference_id AND (sm.reference_type LIKE 'purchase_receipt%' OR sm.reference_type LIKE 'grn%')
    LEFT JOIN LATERAL (
      SELECT x.doctor_name, x.doctor_reg_no, x.patient_name, x.prescription_no FROM prescriptions x
      WHERE x.sale_id = s.id ORDER BY x.created_at LIMIT 1
    ) rx ON true
    WHERE sm.tenant_id = ${q.tenantId}::uuid
      AND sm.item_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      AND sm.created_at >= ${start}::timestamp AND sm.created_at <= ${end}::timestamp
      ${warehouseCond('sm.warehouse_id', q)}
    ORDER BY sm.created_at, sm.id
  `))

  const byItem = new Map<string, typeof lines>()
  for (const l of lines) {
    const list = byItem.get(l.item_id) || []
    list.push(l)
    byItem.set(l.item_id, list)
  }

  return drugs.map((d) => {
    const list = byItem.get(d.id) || []
    const inRange = list.reduce((s, l) => s + Number(l.qty_change), 0)
    const closing = r4(Number(d.on_hand) - Number(d.after_to))
    const opening = r4(closing - inRange)
    let balance = opening
    const sum = (cats: RegisterCategory[]) => r4(list.filter((l) => cats.includes(l.category)).reduce((s, l) => s + Number(l.qty_change), 0))
    return {
      itemId: d.id, name: d.name, genericName: d.generic_name, strength: d.strength, dosageForm: d.dosage_form, unit: d.unit,
      opening,
      received: sum(['received']),
      dispensed: -sum(['dispensed']),
      returns: sum(['customer_return', 'supplier_return']),
      adjustments: sum(['transfer', 'adjustment']),
      closing,
      lines: list.map((l) => {
        const qty = Number(l.qty_change)
        balance = r4(balance + qty)
        return {
          id: l.id,
          date: new Date(l.created_at).toISOString(),
          category: l.category,
          referenceType: l.reference_type,
          referenceNo: l.ref_no,
          saleId: l.sale_id,
          warehouseName: l.warehouse_name,
          qtyIn: qty > 0 ? r4(qty) : 0,
          qtyOut: qty < 0 ? r4(-qty) : 0,
          balance,
          doctorName: l.doctor_name,
          doctorRegNo: l.doctor_reg_no,
          patientName: l.patient_name,
          prescriptionNo: l.prescription_no,
          notes: l.notes,
          userName: l.user_name,
        }
      }),
    }
  })
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  // Neutralise spreadsheet formulas and quote
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** One CSV for every drug: an opening row, the movements, a closing row */
export function controlledRegisterCsv(drugs: RegisterDrug[], from: string, to: string): string {
  const out: string[] = [['Medicine', 'Generic', 'Strength', 'Date', 'Entry', 'Reference', 'Branch', 'In', 'Out', 'Balance', 'Doctor', 'SLMC no.', 'Patient', 'Rx no.', 'By', 'Notes'].join(',')]
  for (const d of drugs) {
    const base = [d.name, d.genericName, d.strength]
    out.push([...base, from, 'Opening balance', '', '', '', '', d.opening, '', '', '', '', '', ''].map(csvCell).join(','))
    for (const l of d.lines) {
      out.push([...base, l.date.slice(0, 16).replace('T', ' '), REGISTER_CATEGORY_LABELS[l.category], l.referenceNo, l.warehouseName,
        l.qtyIn || '', l.qtyOut || '', l.balance, l.doctorName, l.doctorRegNo, l.patientName, l.prescriptionNo, l.userName, l.notes].map(csvCell).join(','))
    }
    out.push([...base, to, 'Closing balance', '', '', '', '', d.closing, '', '', '', '', '', ''].map(csvCell).join(','))
  }
  return out.join('\n') + '\n'
}

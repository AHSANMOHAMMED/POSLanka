/**
 * Patient medication history: what was dispensed to a patient — by customer record, or by the
 * phone number / name written on prescriptions (walk-in patients without a customer record).
 * Each line: date, bill, medicine, quantity, dose instructions and the prescribing doctor.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { escapeLikePattern } from '@/lib/utils/sql'

type Db = Pick<TenantDb, 'execute'>

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export interface HistoryLine {
  saleId: string
  invoiceNo: string
  date: string
  warehouseName: string | null
  itemId: string | null
  itemName: string
  genericName: string | null
  strength: string | null
  drugSchedule: string | null
  quantity: number
  dosageInstructions: string | null
  doctorName: string | null
  doctorRegNo: string | null
  patientName: string | null
  prescriptionNo: string | null
}

export interface HistoryQuery {
  tenantId: string
  customerId?: string | null
  phone?: string | null
  name?: string | null
  /** false = every line on the bills, not only medicines */
  medicinesOnly?: boolean
  scope: string[] | null
  limit?: number
}

/** digits only: "077 123-4567" → "0771234567" */
export const phoneDigits = (p: string | null | undefined) => (p || '').replace(/\D/g, '')

export async function patientHistory(db: Db, q: HistoryQuery): Promise<HistoryLine[]> {
  const who: SQL[] = []
  if (q.customerId) {
    who.push(sql`s.customer_id = ${q.customerId}::uuid`)
    who.push(sql`EXISTS (SELECT 1 FROM prescriptions x WHERE x.sale_id = s.id AND x.customer_id = ${q.customerId}::uuid)`)
  }
  const digits = phoneDigits(q.phone)
  if (digits.length >= 7) {
    who.push(sql`EXISTS (SELECT 1 FROM prescriptions x WHERE x.sale_id = s.id AND regexp_replace(coalesce(x.patient_phone, ''), '\\D', '', 'g') = ${digits})`)
  }
  if (q.name?.trim()) {
    who.push(sql`EXISTS (SELECT 1 FROM prescriptions x WHERE x.sale_id = s.id AND x.patient_name ILIKE ${escapeLikePattern(q.name.trim())})`)
  }
  if (who.length === 0) return []
  const branch = q.scope ? sql` AND s.warehouse_id IN (${sql.join(q.scope.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``
  const medicines = q.medicinesOnly === false ? sql`` : sql` AND (i.drug_schedule IS NOT NULL OR i.generic_name IS NOT NULL)`
  const limit = Math.min(1000, Math.max(1, q.limit ?? 300))

  const res = rows<{
    sale_id: string; invoice_no: string; created_at: string; warehouse_name: string | null; item_id: string | null; item_name: string
    generic_name: string | null; strength: string | null; drug_schedule: string | null; quantity: string; returned: string
    dosage_instructions: string | null; doctor_name: string | null; doctor_reg_no: string | null; patient_name: string | null; prescription_no: string | null
  }>(await db.execute(sql`
    SELECT s.id AS sale_id, s.invoice_no, s.created_at, w.name AS warehouse_name,
      si.item_id, si.item_name, i.generic_name, i.strength, i.drug_schedule, si.quantity, si.returned_quantity AS returned, si.dosage_instructions,
      rx.doctor_name, rx.doctor_reg_no, coalesce(rx.patient_name, s.customer_name) AS patient_name, rx.prescription_no
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    LEFT JOIN items i ON i.id = si.item_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN LATERAL (
      SELECT x.doctor_name, x.doctor_reg_no, x.patient_name, x.prescription_no FROM prescriptions x
      WHERE x.sale_id = s.id ORDER BY x.created_at LIMIT 1
    ) rx ON true
    WHERE s.tenant_id = ${q.tenantId}::uuid AND s.status <> 'void' AND s.is_return = false
      AND (${sql.join(who, sql` OR `)})${branch}${medicines}
    ORDER BY s.created_at DESC, si.item_name
    LIMIT ${limit}
  `))
  return res.map((r) => ({
    saleId: r.sale_id, invoiceNo: r.invoice_no, date: new Date(r.created_at).toISOString(), warehouseName: r.warehouse_name,
    itemId: r.item_id, itemName: r.item_name, genericName: r.generic_name, strength: r.strength, drugSchedule: r.drug_schedule,
    quantity: Math.round((Number(r.quantity) - Number(r.returned || 0)) * 1000) / 1000,
    dosageInstructions: r.dosage_instructions, doctorName: r.doctor_name, doctorRegNo: r.doctor_reg_no,
    patientName: r.patient_name, prescriptionNo: r.prescription_no,
  }))
}

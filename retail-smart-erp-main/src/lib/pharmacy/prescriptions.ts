/**
 * Pharmacy prescriptions (drizzle/0170).
 *
 * items.drug_schedule decides what a sale needs:
 *   otc / pharmacy_only / NULL → nothing
 *   prescription               → a prescription: doctor's name (+ number / date when written on it)
 *   controlled                 → also the doctor's registration number and the patient's name
 *                                (narcotics / psychotropics register)
 * The POS asks GET /api/pharmacy/rx-check before payment; POST /api/sales enforces the same rule
 * and writes the prescription row in the sale's transaction (the prescription register).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { items, prescriptions } from '@/lib/db/schema'
import type { TenantDb } from '@/lib/db'

type Tx = Pick<TenantDb, 'select' | 'insert'>

export type DrugSchedule = 'otc' | 'pharmacy_only' | 'prescription' | 'controlled'
export type RxLevel = 'none' | 'prescription' | 'controlled'

export const DRUG_SCHEDULE_LABELS: Record<DrugSchedule, string> = {
  otc: 'OTC (over the counter)',
  pharmacy_only: 'Pharmacy only',
  prescription: 'Prescription only',
  controlled: 'Controlled drug',
}

export { prescriptionInputSchema, type PrescriptionInput } from '@/lib/validation/schemas/pharmacy'
import type { PrescriptionInput } from '@/lib/validation/schemas/pharmacy'

export interface RxItem { id: string; name: string; drugSchedule: DrugSchedule; genericName: string | null }

/** Which of these items need a prescription, and the strictest level */
export async function prescriptionRequirement(tx: Tx, tenantId: string, itemIds: string[]): Promise<{ level: RxLevel; items: RxItem[] }> {
  const ids = Array.from(new Set(itemIds.filter(Boolean)))
  if (ids.length === 0) return { level: 'none', items: [] }
  const rows = await tx.select({ id: items.id, name: items.name, drugSchedule: items.drugSchedule, genericName: items.genericName })
    .from(items)
    .where(and(eq(items.tenantId, tenantId), inArray(items.id, ids)))
  const rx = rows.filter((r) => r.drugSchedule === 'prescription' || r.drugSchedule === 'controlled') as RxItem[]
  const level: RxLevel = rx.some((r) => r.drugSchedule === 'controlled') ? 'controlled' : rx.length ? 'prescription' : 'none'
  return { level, items: rx }
}

/** What is missing for this level (null = fine) */
export function prescriptionProblem(level: RxLevel, input: PrescriptionInput | null | undefined): string | null {
  if (level === 'none') return null
  if (!input) return 'These medicines need a prescription: enter the doctor’s details.'
  if (level === 'controlled') {
    if (!input.doctorRegNo) return 'Controlled drugs need the doctor’s SLMC registration number.'
    if (!input.patientName) return 'Controlled drugs need the patient’s name.'
  }
  return null
}

export async function recordPrescription(tx: Tx, args: {
  tenantId: string; saleId: string; customerId?: string | null; userId?: string | null; level: RxLevel; input: PrescriptionInput
}): Promise<string> {
  const { input } = args
  const [row] = await tx.insert(prescriptions).values({
    tenantId: args.tenantId,
    saleId: args.saleId,
    customerId: args.customerId || null,
    prescriptionNo: input.prescriptionNo || null,
    prescriptionDate: input.prescriptionDate || null,
    patientName: input.patientName || null,
    patientAge: input.patientAge || null,
    patientPhone: input.patientPhone || null,
    doctorName: input.doctorName,
    doctorRegNo: input.doctorRegNo || null,
    hospital: input.hospital || null,
    hasControlled: args.level === 'controlled',
    notes: input.notes || null,
    createdBy: args.userId || null,
  }).returning({ id: prescriptions.id })
  return row.id
}

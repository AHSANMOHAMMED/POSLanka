import { z } from 'zod'

// Pharmacy prescription captured at the POS (POST /api/sales → prescription); rules in src/lib/pharmacy
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional())

export const prescriptionInputSchema = z.object({
  doctorName: z.string().trim().min(2, 'Doctor’s name is required').max(255),
  doctorRegNo: text(100),
  hospital: text(255),
  prescriptionNo: text(100),
  prescriptionDate: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date as YYYY-MM-DD').optional()),
  patientName: text(255),
  patientAge: text(20),
  patientPhone: text(50),
  notes: text(1000),
})
export type PrescriptionInput = z.infer<typeof prescriptionInputSchema>


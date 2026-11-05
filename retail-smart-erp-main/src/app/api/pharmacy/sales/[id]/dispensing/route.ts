import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, type TenantDb } from '@/lib/db'
import { items, prescriptions, saleItems, sales, tenants } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { assertRecordBranch } from '@/lib/auth/branch-access'

/**
 * Dispensing labels for a bill.
 *   GET   /api/pharmacy/sales/[id]/dispensing — pharmacy name, patient, doctor and the medicine lines
 *         with their dose instructions (the label page prints one label per line)
 *   PATCH /api/pharmacy/sales/[id]/dispensing { lines: [{ saleItemId, dosageInstructions }] }
 */
async function load(db: TenantDb, tenantId: string, saleId: string) {
  const [sale] = await db.select({
    id: sales.id, invoiceNo: sales.invoiceNo, createdAt: sales.createdAt, customerName: sales.customerName, customerId: sales.customerId,
  }).from(sales).where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId))).limit(1)
  if (!sale) return null
  const [[tenant], [rx], lines] = await Promise.all([
    db.select({ name: tenants.name, phone: tenants.phone, address: tenants.address }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    db.select({
      patientName: prescriptions.patientName, patientAge: prescriptions.patientAge, doctorName: prescriptions.doctorName,
      doctorRegNo: prescriptions.doctorRegNo, prescriptionNo: prescriptions.prescriptionNo,
    }).from(prescriptions).where(eq(prescriptions.saleId, saleId)).limit(1),
    db.select({
      saleItemId: saleItems.id, itemId: saleItems.itemId, itemName: saleItems.itemName, quantity: saleItems.quantity, uom: saleItems.uom,
      dosageInstructions: saleItems.dosageInstructions, genericName: items.genericName, strength: items.strength,
      dosageForm: items.dosageForm, drugSchedule: items.drugSchedule,
    }).from(saleItems).leftJoin(items, eq(items.id, saleItems.itemId)).where(eq(saleItems.saleId, saleId)).orderBy(asc(saleItems.itemName)),
  ])
  return { sale, pharmacy: tenant ?? null, prescription: rx ?? null, lines }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    return await withTenant(session.user.tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, sales, p.data.id)
      if (denied) return denied
      const data = await load(db, session.user.tenantId, p.data.id)
      if (!data) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
      return NextResponse.json(data)
    })
  } catch (error) {
    logError('api/pharmacy/sales/[id]/dispensing GET', error)
    return NextResponse.json({ error: 'Failed to load the bill' }, { status: 500 })
  }
}

const patchSchema = z.object({
  lines: z.array(z.object({
    saleItemId: z.string().uuid(),
    dosageInstructions: z.string().max(255).optional(),
  })).min(1).max(200),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const body = await validateBody(request, patchSchema, { keepEmptyStrings: true })
    if (!body.success) return body.response
    return await withTenant(session.user.tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, sales, p.data.id)
      if (denied) return denied
      const ids = body.data.lines.map((l) => l.saleItemId)
      const own = await db.select({ id: saleItems.id }).from(saleItems)
        .where(and(eq(saleItems.tenantId, session.user.tenantId), eq(saleItems.saleId, p.data.id), inArray(saleItems.id, ids)))
      if (own.length !== new Set(ids).size) return NextResponse.json({ error: 'A line is not on this bill' }, { status: 400 })
      for (const l of body.data.lines) {
        await db.update(saleItems).set({ dosageInstructions: l.dosageInstructions?.trim() || null })
          .where(and(eq(saleItems.tenantId, session.user.tenantId), eq(saleItems.id, l.saleItemId)))
      }
      const data = await load(db, session.user.tenantId, p.data.id)
      return NextResponse.json(data)
    })
  } catch (error) {
    logError('api/pharmacy/sales/[id]/dispensing PATCH', error)
    return NextResponse.json({ error: 'Failed to save the dose instructions' }, { status: 500 })
  }
}

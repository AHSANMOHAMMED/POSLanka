import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { sales, suppliers, tenants, users, warehouses, warrantyClaims } from '@/lib/db/schema'
import type { WarrantyClaimStatus } from '@/lib/db/schema'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateWarrantyClaimSchema } from '@/lib/validation/schemas/installments'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { InstallmentError } from '@/lib/installments/service'
import { WARRANTY_EDIT, WARRANTY_VIEW, requireAny } from '@/lib/installments/access'

type Params = { params: Promise<{ id: string }> }

const NEXT: Record<WarrantyClaimStatus, WarrantyClaimStatus[]> = {
  received: ['diagnosing', 'sent_to_supplier', 'repairing', 'ready', 'rejected'],
  diagnosing: ['sent_to_supplier', 'repairing', 'ready', 'rejected'],
  sent_to_supplier: ['repairing', 'ready', 'rejected'],
  repairing: ['sent_to_supplier', 'ready', 'rejected'],
  ready: ['delivered', 'repairing'],
  // a rejected unit still goes back to the customer
  rejected: ['delivered'],
  delivered: [],
}

/** GET /api/warranty-claims/[id] — claim with technician, supplier, invoice and company (job sheet) */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, WARRANTY_VIEW)
    if (denied) return denied
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    return await withTenant(session.user.tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, warrantyClaims, id)
      if (branchDenied) return branchDenied
      const [row] = await db.select({
        claim: warrantyClaims, technicianName: users.fullName, supplierName: suppliers.name,
        invoiceNo: sales.invoiceNo, warehouseName: warehouses.name,
      })
        .from(warrantyClaims)
        .leftJoin(users, eq(users.id, warrantyClaims.technicianId))
        .leftJoin(suppliers, eq(suppliers.id, warrantyClaims.supplierId))
        .leftJoin(sales, eq(sales.id, warrantyClaims.saleId))
        .leftJoin(warehouses, eq(warehouses.id, warrantyClaims.warehouseId))
        .where(eq(warrantyClaims.id, id))
      if (!row) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
      const [company] = await db.select({ name: tenants.name, phone: tenants.phone, address: tenants.address })
        .from(tenants).where(eq(tenants.id, session.user.tenantId))
      return NextResponse.json({
        ...row.claim,
        technicianName: row.technicianName, supplierName: row.supplierName, invoiceNo: row.invoiceNo, warehouseName: row.warehouseName,
        nextStatuses: NEXT[row.claim.status],
        company: company ?? null,
      })
    })
  } catch (error) {
    logError('api/warranty-claims/[id] GET', error)
    return NextResponse.json({ error: 'Failed to load claim' }, { status: 500 })
  }
}

/** PATCH /api/warranty-claims/[id] — diagnosis, technician, supplier, charges, resolution, status */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, WARRANTY_EDIT)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const parsed = await validateBody(request, updateWarrantyClaimSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const result = await withTenantTransaction(session.user.tenantId, async (tx) => {
      const branchDenied = await assertRecordBranch(session, tx, warrantyClaims, id)
      if (branchDenied) return { response: branchDenied }
      const [cur] = await tx.select().from(warrantyClaims).where(eq(warrantyClaims.id, id)).for('update')
      if (!cur) throw new InstallmentError('Claim not found', 404)
      if (cur.status === 'delivered' && Object.entries(body).some(([k, v]) => v !== undefined && k !== 'notes')) {
        throw new InstallmentError('This claim is closed (delivered to the customer)')
      }
      const now = new Date()
      const set: Partial<typeof warrantyClaims.$inferInsert> = { updatedAt: now }
      if (body.status && body.status !== cur.status) {
        if (!NEXT[cur.status].includes(body.status)) {
          throw new InstallmentError(`A claim that is ${cur.status.replace(/_/g, ' ')} cannot move to ${body.status.replace(/_/g, ' ')}`)
        }
        const supplierId = body.supplierId !== undefined ? body.supplierId : cur.supplierId
        if (body.status === 'sent_to_supplier' && !supplierId) throw new InstallmentError('Choose the supplier / service agent')
        const resolution = body.resolution !== undefined ? body.resolution : cur.resolution
        if (body.status === 'ready' && !resolution) throw new InstallmentError('Choose the resolution (repaired, replaced, …)')
        if (body.status === 'rejected' && !(body.statusNote || body.diagnosis || cur.diagnosis)) throw new InstallmentError('Give the reason the claim was rejected')
        set.status = body.status
        if (body.status === 'rejected' && !resolution) set.resolution = 'rejected'
        if (body.status === 'delivered') set.deliveredAt = now
        set.history = [...(cur.history || []), { status: body.status, at: now.toISOString(), by: session.user.name || null, note: body.statusNote || null }]
      }
      if (body.supplierId !== undefined) {
        if (body.supplierId) {
          const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, body.supplierId))
          if (!s) throw new InstallmentError('Supplier not found')
        }
        set.supplierId = body.supplierId || null
      }
      if (body.technicianId !== undefined) {
        if (body.technicianId) {
          const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, body.technicianId))
          if (!u) throw new InstallmentError('Technician not found')
        }
        set.technicianId = body.technicianId || null
      }
      if (body.supplierRef !== undefined) set.supplierRef = body.supplierRef || null
      if (body.diagnosis !== undefined) set.diagnosis = body.diagnosis || null
      if (body.resolution !== undefined) set.resolution = body.resolution || null
      if (body.replacementSerial !== undefined) set.replacementSerial = body.replacementSerial || null
      if ((body.resolution ?? cur.resolution) === 'replaced' && set.status === 'ready' && !(body.replacementSerial || cur.replacementSerial)) {
        throw new InstallmentError('Enter the serial / IMEI of the replacement unit')
      }
      // in-warranty repairs are free unless the shop decides otherwise (e.g. physical damage)
      if (body.estimatedCharge !== undefined) set.estimatedCharge = String(body.estimatedCharge)
      if (body.finalCharge !== undefined) set.finalCharge = String(body.finalCharge)
      if (body.expectedDate !== undefined) set.expectedDate = body.expectedDate || null
      if (body.accessories !== undefined) set.accessories = body.accessories || null
      if (body.conditionNotes !== undefined) set.conditionNotes = body.conditionNotes || null
      if (body.notes !== undefined) set.notes = body.notes || null
      const [row] = await tx.update(warrantyClaims).set(set).where(eq(warrantyClaims.id, id)).returning()
      return { row, statusChanged: !!set.status }
    })
    if ('response' in result) return result.response
    logAndBroadcast(session.user.tenantId, 'warranty-claim', 'updated', id, {
      userId: session.user.id,
      entityName: result.row.claimNo,
      description: result.statusChanged
        ? `Warranty claim ${result.row.claimNo} → ${result.row.status.replace(/_/g, ' ')}`
        : `Updated warranty claim ${result.row.claimNo}`,
    })
    return NextResponse.json(result.row)
  } catch (error) {
    if (error instanceof InstallmentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    logError('api/warranty-claims/[id] PATCH', error)
    return NextResponse.json({ error: 'Failed to update claim' }, { status: 500 })
  }
}

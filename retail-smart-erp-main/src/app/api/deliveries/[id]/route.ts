import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { deliveries, installmentPlans, sales, tenants, users, warehouses } from '@/lib/db/schema'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateDeliverySchema } from '@/lib/validation/schemas/installments'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { InstallmentError } from '@/lib/installments/service'
import { DELIVERY_EDIT, DELIVERY_VIEW, requireAny } from '@/lib/installments/access'
import type { DeliveryRunStatus } from '@/lib/db/schema'

type Params = { params: Promise<{ id: string }> }

const NEXT: Record<DeliveryRunStatus, DeliveryRunStatus[]> = {
  scheduled: ['out_for_delivery', 'delivered', 'failed', 'cancelled'],
  out_for_delivery: ['delivered', 'failed', 'scheduled'],
  delivered: ['installed'],
  failed: ['scheduled', 'cancelled'],
  installed: [],
  cancelled: [],
}

/** GET /api/deliveries/[id] — one delivery with the sale / plan numbers and company (delivery note) */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, DELIVERY_VIEW)
    if (denied) return denied
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    return await withTenant(session.user.tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, deliveries, id)
      if (branchDenied) return branchDenied
      const [row] = await db.select({
        delivery: deliveries, invoiceNo: sales.invoiceNo, planNo: installmentPlans.planNo, warehouseName: warehouses.name,
      })
        .from(deliveries)
        .leftJoin(sales, eq(sales.id, deliveries.saleId))
        .leftJoin(installmentPlans, eq(installmentPlans.id, deliveries.installmentPlanId))
        .leftJoin(warehouses, eq(warehouses.id, deliveries.warehouseId))
        .where(eq(deliveries.id, id))
      if (!row) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
      const [company] = await db.select({ name: tenants.name, phone: tenants.phone, address: tenants.address })
        .from(tenants).where(eq(tenants.id, session.user.tenantId))
      return NextResponse.json({ ...row.delivery, invoiceNo: row.invoiceNo, planNo: row.planNo, warehouseName: row.warehouseName, company: company ?? null })
    })
  } catch (error) {
    logError('api/deliveries/[id] GET', error)
    return NextResponse.json({ error: 'Failed to load delivery' }, { status: 500 })
  }
}

/**
 * PATCH /api/deliveries/[id] — reschedule / reassign, or move the status (scheduled → out for
 * delivery → delivered → installed; failed; cancelled) with proof of delivery.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, DELIVERY_EDIT)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const parsed = await validateBody(request, updateDeliverySchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const result = await withTenantTransaction(session.user.tenantId, async (tx) => {
      const branchDenied = await assertRecordBranch(session, tx, deliveries, id)
      if (branchDenied) return { response: branchDenied }
      const [cur] = await tx.select().from(deliveries).where(eq(deliveries.id, id)).for('update')
      if (!cur) throw new InstallmentError('Delivery not found', 404)
      const now = new Date()
      const set: Partial<typeof deliveries.$inferInsert> = { updatedAt: now }

      if (body.status && body.status !== cur.status) {
        if (!NEXT[cur.status].includes(body.status)) {
          throw new InstallmentError(`A ${cur.status.replace(/_/g, ' ')} delivery cannot be marked ${body.status.replace(/_/g, ' ')}`)
        }
        if (body.status === 'installed' && !cur.installationRequired) throw new InstallmentError('This delivery has no installation')
        if (body.status === 'failed' && !(body.failureReason || cur.failureReason)) throw new InstallmentError('Give the reason the delivery failed')
        if ((body.status === 'delivered' || body.status === 'installed') && !(body.recipientName || cur.recipientName)) {
          throw new InstallmentError('Enter who received the goods')
        }
        set.status = body.status
        if (body.status === 'out_for_delivery') set.dispatchedAt = now
        if (body.status === 'delivered') set.deliveredAt = now
        if (body.status === 'installed') { set.installedAt = now; if (!cur.deliveredAt) set.deliveredAt = now }
        if (body.status === 'scheduled') set.failureReason = null
      } else if (['installed', 'cancelled'].includes(cur.status) && Object.entries(body).some(([k, v]) => v !== undefined && k !== 'notes' && k !== 'proofNotes' && k !== 'proofPhotoUrl')) {
        throw new InstallmentError(`This delivery is ${cur.status}`)
      }

      const staffIds = [body.driverId, body.technicianId].filter((x): x is string => !!x)
      const staff = staffIds.length
        ? await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(sql`${users.id} IN (${sql.join(staffIds.map((i) => sql`${i}::uuid`), sql`, `)})`)
        : []
      const nameOf = (sid: string) => staff.find((s) => s.id === sid)?.fullName ?? null

      if (body.customerPhone !== undefined) set.customerPhone = body.customerPhone || null
      if (body.address !== undefined) set.address = body.address
      if (body.city !== undefined) set.city = body.city || null
      if (body.scheduledDate !== undefined) set.scheduledDate = body.scheduledDate
      if (body.timeSlot !== undefined) set.timeSlot = body.timeSlot || null
      if (body.vehicleNo !== undefined) set.vehicleNo = body.vehicleNo ? body.vehicleNo.toUpperCase() : null
      if (body.driverId !== undefined) {
        set.driverId = body.driverId || null
        if (body.driverId) set.driverName = nameOf(body.driverId) ?? cur.driverName
      }
      if (body.driverName !== undefined && !body.driverId) set.driverName = body.driverName || null
      if (body.installationRequired !== undefined) set.installationRequired = body.installationRequired
      if (body.technicianId !== undefined) {
        set.technicianId = body.technicianId || null
        if (body.technicianId) set.technicianName = nameOf(body.technicianId) ?? cur.technicianName
      }
      if (body.technicianName !== undefined && !body.technicianId) set.technicianName = body.technicianName || null
      if (body.deliveryCharge !== undefined) set.deliveryCharge = String(body.deliveryCharge)
      if (body.recipientName !== undefined) set.recipientName = body.recipientName || null
      if (body.recipientPhone !== undefined) set.recipientPhone = body.recipientPhone || null
      if (body.proofNotes !== undefined) set.proofNotes = body.proofNotes || null
      if (body.proofPhotoUrl !== undefined) set.proofPhotoUrl = body.proofPhotoUrl || null
      if (body.failureReason !== undefined) set.failureReason = body.failureReason || null
      if (body.notes !== undefined) set.notes = body.notes || null

      const [row] = await tx.update(deliveries).set(set).where(eq(deliveries.id, id)).returning()
      return { row, statusChanged: !!set.status }
    })
    if ('response' in result) return result.response
    logAndBroadcast(session.user.tenantId, 'delivery', 'updated', id, {
      userId: session.user.id,
      entityName: result.row.deliveryNo,
      description: result.statusChanged
        ? `Delivery ${result.row.deliveryNo} marked ${result.row.status.replace(/_/g, ' ')}`
        : `Updated delivery ${result.row.deliveryNo}`,
    })
    return NextResponse.json(result.row)
  } catch (error) {
    if (error instanceof InstallmentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    logError('api/deliveries/[id] PATCH', error)
    return NextResponse.json({ error: 'Failed to update delivery' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { workOrderServices, workOrders, workOrderParts, serviceTypes } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateItemTax, aggregateTaxBreakdown } from '@/lib/utils/tax-template'
import { resolveTaxTemplatesForItems, getDefaultTaxTemplate, getEffectiveTaxTemplate } from '@/lib/utils/tax-template-resolver'
import { checkWorkOrderAnomalies } from '@/lib/ai/anomaly-detector'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addWorkOrderServiceSchema, updateWorkOrderServiceSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Helper function to recalculate work order totals with per-item tax templates
async function recalculateWorkOrderTotals(db: TenantDb, workOrderId: string, tenantId: string) {
  // Get line-level data for per-item tax calculation
  const parts = await db.query.workOrderParts.findMany({
    where: eq(workOrderParts.workOrderId, workOrderId),
    columns: { itemId: true, total: true },
  })

  const [servicesResult] = await db
    .select({
      servicesTotal: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)`,
    })
    .from(sql`work_order_services`)
    .where(sql`work_order_id = ${workOrderId} AND tenant_id = ${tenantId}`)

  const servicesTotal = parseFloat(servicesResult?.servicesTotal || '0')
  const partsTotal = roundCurrency(parts.reduce((s, p) => s + parseFloat(p.total), 0))
  const subtotal = roundCurrency(servicesTotal + partsTotal)

  // Per-item tax calculation using tax templates
  const defaultTemplate = await getDefaultTaxTemplate(db, tenantId)
  const partItemIds = parts.map(p => p.itemId).filter(Boolean)
  const itemTemplateMap = partItemIds.length > 0
    ? await resolveTaxTemplatesForItems(db, partItemIds)
    : new Map()

  const allBreakdowns = []
  let totalTax = 0

  // Tax on parts (per-item template)
  for (const part of parts) {
    const lineTotal = parseFloat(part.total)
    if (lineTotal <= 0) continue
    const template = getEffectiveTaxTemplate(itemTemplateMap, part.itemId, defaultTemplate)
    const taxResult = calculateItemTax(lineTotal, template)
    totalTax += taxResult.totalTax
    if (taxResult.breakdown.length > 0) allBreakdowns.push(taxResult.breakdown)
  }

  // Tax on services (default template only — services have no itemId)
  if (servicesTotal > 0) {
    const taxResult = calculateItemTax(servicesTotal, defaultTemplate)
    totalTax += taxResult.totalTax
    if (taxResult.breakdown.length > 0) allBreakdowns.push(taxResult.breakdown)
  }

  totalTax = roundCurrency(totalTax)
  const taxBreakdown = allBreakdowns.length > 0 ? aggregateTaxBreakdown(allBreakdowns) : null

  // Determine total: inclusive tax is already in subtotal, only add exclusive
  const exclusiveTax = roundCurrency(
    (taxBreakdown || []).filter(b => !b.includedInPrice).reduce((s, b) => s + b.amount, 0)
  )
  const total = roundCurrency(subtotal + exclusiveTax)

  await db.update(workOrders)
    .set({
      subtotal: String(subtotal),
      taxAmount: String(totalTax),
      taxBreakdown: taxBreakdown,
      total: String(total),
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, workOrderId))
}

// POST add service to work order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data

  const parsed = await validateBody(request, addWorkOrderServiceSchema)
  if (!parsed.success) return parsed.response
  const { serviceTypeId, description, hours: parsedHours, rate: parsedRate, technicianId } = parsed.data

  // Use transaction to ensure service addition + total recalculation are atomic
  const result = await withAuthTenantTransaction(async (session, db) => {
    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    // Lock work order with FOR UPDATE to prevent concurrent service additions from producing incorrect totals
    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for('update')

    if (!workOrder) {
      return { error: NextResponse.json({ error: 'Work order not found' }, { status: 404 }) }
    }

    // Check if work order can be modified (checked after lock)
    if (['invoiced', 'cancelled'].includes(workOrder.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify invoiced or cancelled work orders' }, { status: 400 }) }
    }

    // W-H5: Validate serviceTypeId belongs to tenant if provided
    if (serviceTypeId) {
      const serviceType = await db.query.serviceTypes.findFirst({
        where: eq(serviceTypes.id, serviceTypeId),
      })
      if (!serviceType) {
        return { error: NextResponse.json({ error: 'Invalid service type' }, { status: 400 }) }
      }
    }

    const amount = roundCurrency(parsedHours * parsedRate)

    // AEW-7: Warn if rate is $0 (service will have no revenue)
    const zeroRateWarning = parsedRate === 0

    const [newService] = await db.insert(workOrderServices).values({
      tenantId: session.user.tenantId,
      workOrderId,
      serviceTypeId: serviceTypeId || null,
      description: description || null,
      hours: String(parsedHours),
      rate: String(parsedRate),
      amount: String(amount),
      technicianId: technicianId || null,
    }).returning()

    // Recalculate work order totals (inside transaction with work order locked)
    await recalculateWorkOrderTotals(db, workOrderId, session.user.tenantId)

    // Get the updated work order's updatedAt to prevent client conflicts
    const [updatedWorkOrder] = await db
      .select({ updatedAt: workOrders.updatedAt })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))

    // Broadcast work order update
    logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId, { userId: session.user.id })

    // AI: Work order anomaly detection (fire-and-forget)
    // Get all services to compute labor total
    const allServices = await db.query.workOrderServices.findMany({
      where: eq(workOrderServices.workOrderId, workOrderId),
    })
    const laborTotal = allServices.reduce((sum, s) => sum + parseFloat(s.amount || '0'), 0)
    checkWorkOrderAnomalies(session.user.tenantId, {
      id: workOrderId,
      workOrderNo: workOrder.orderNo || workOrderId,
      laborTotal,
      partsTotal: 0, // Services route doesn't have parts info; parts route handles its own checks
      services: allServices.map(s => ({
        serviceName: s.description || 'Service',
        laborCharge: parseFloat(s.amount || '0'),
      })),
    })

    return {
      data: {
        ...newService,
        workOrderUpdatedAt: updatedWorkOrder?.updatedAt,
        zeroRateWarning, // AEW-7: Client can show warning if true
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update service in work order
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data

  const parsed = await validateBody(request, updateWorkOrderServiceSchema)
  if (!parsed.success) return parsed.response
  const { serviceId, hours: parsedHours, rate: parsedRate, technicianId, expectedUpdatedAt } = parsed.data

  // Use transaction to ensure service update + total recalculation are atomic
  const result = await withAuthTenantTransaction(async (session, db) => {
    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return { error: permError }

    // Lock work order with FOR UPDATE to prevent concurrent modifications from producing incorrect totals
    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for('update')

    if (!workOrder) {
      return { error: NextResponse.json({ error: 'Work order not found' }, { status: 404 }) }
    }

    // Optimistic locking (checked after lock)
    if (expectedUpdatedAt) {
      const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
      const serverUpdatedAt = workOrder.updatedAt ? new Date(workOrder.updatedAt).getTime() : 0
      if (serverUpdatedAt > clientUpdatedAt) {
        return { error: NextResponse.json({
          error: 'This work order was modified by another user. Please refresh and try again.',
          code: 'CONFLICT'
        }, { status: 409 }) }
      }
    }

    // Check if work order can be modified (checked after lock)
    if (['invoiced', 'cancelled'].includes(workOrder.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify invoiced or cancelled work orders' }, { status: 400 }) }
    }

    const amount = roundCurrency(parsedHours * parsedRate)

    const [updated] = await db.update(workOrderServices)
      .set({
        hours: String(parsedHours),
        rate: String(parsedRate),
        amount: String(amount),
        // W21: Update technician if provided (can be null to unassign)
        ...(technicianId !== undefined && { technicianId: technicianId || null }),
      })
      .where(and(
        eq(workOrderServices.id, serviceId),
        eq(workOrderServices.workOrderId, workOrderId),
      ))
      .returning()

    if (!updated) {
      return { error: NextResponse.json({ error: 'Service not found' }, { status: 404 }) }
    }

    // Recalculate work order totals (inside transaction with work order locked)
    await recalculateWorkOrderTotals(db, workOrderId, session.user.tenantId)

    // Get the updated work order's updatedAt to prevent client conflicts
    const [updatedWorkOrder] = await db
      .select({ updatedAt: workOrders.updatedAt })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))

    // Broadcast work order update
    logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId, { userId: session.user.id })

    return { data: { ...updated, workOrderUpdatedAt: updatedWorkOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// DELETE remove service from work order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data
  const { searchParams } = new URL(request.url)
  const serviceId = searchParams.get('serviceId')

  if (!serviceId) {
    return NextResponse.json({ error: 'Service ID is required' }, { status: 400 })
  }

  // Use transaction to ensure service deletion + total recalculation are atomic
  const result = await withAuthTenantTransaction(async (session, db) => {
    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return { error: permError }

    // Lock work order with FOR UPDATE to prevent concurrent modifications from producing incorrect totals
    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for('update')

    if (!workOrder) {
      return { error: NextResponse.json({ error: 'Work order not found' }, { status: 404 }) }
    }

    // Check if work order can be modified (checked after lock)
    if (['invoiced', 'cancelled'].includes(workOrder.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify invoiced or cancelled work orders' }, { status: 400 }) }
    }

    const [deleted] = await db.delete(workOrderServices)
      .where(and(
        eq(workOrderServices.id, serviceId),
        eq(workOrderServices.workOrderId, workOrderId),
      ))
      .returning()

    if (!deleted) {
      return { error: NextResponse.json({ error: 'Service not found' }, { status: 404 }) }
    }

    // Recalculate work order totals (inside transaction with work order locked)
    await recalculateWorkOrderTotals(db, workOrderId, session.user.tenantId)

    // Get the updated work order's updatedAt to prevent client conflicts
    const [updatedWorkOrder] = await db
      .select({ updatedAt: workOrders.updatedAt })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))

    // Broadcast work order update
    logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId, { userId: session.user.id })

    return { data: { success: true, workOrderUpdatedAt: updatedWorkOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

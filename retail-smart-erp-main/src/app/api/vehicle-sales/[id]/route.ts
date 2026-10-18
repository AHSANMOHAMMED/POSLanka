import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleSaleDetails, vehicleInventory, vehicleMakes, vehicleModels, sales, customers, financingOptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleSaleDetailSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db
        .select({
          vehicleSale: vehicleSaleDetails,
          vehicleMakeName: vehicleMakes.name,
          vehicleModelName: vehicleModels.name,
          vehicleYear: vehicleInventory.year,
          vehicleVin: vehicleInventory.vin,
          vehicleStockNo: vehicleInventory.stockNo,
          vehicleColor: vehicleInventory.exteriorColor,
          vehicleTrim: vehicleInventory.trim,
          vehicleCondition: vehicleInventory.condition,
          saleInvoiceNo: sales.invoiceNo,
          saleTotal: sales.total,
          saleStatus: sales.status,
          saleDate: sales.createdAt,
          customerName: customers.name,
          customerPhone: customers.phone,
          customerEmail: customers.email,
          financingLenderName: financingOptions.lenderName,
        })
        .from(vehicleSaleDetails)
        .leftJoin(vehicleInventory, eq(vehicleSaleDetails.vehicleInventoryId, vehicleInventory.id))
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .leftJoin(sales, eq(vehicleSaleDetails.saleId, sales.id))
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .leftJoin(financingOptions, eq(vehicleSaleDetails.financingOptionId, financingOptions.id))
        .where(eq(vehicleSaleDetails.id, id))

      if (!result.length) {
        return NextResponse.json({ error: 'Vehicle sale not found' }, { status: 404 })
      }

      const r = result[0]
      return NextResponse.json({
        ...r.vehicleSale,
        vehicleMake: r.vehicleMakeName,
        vehicleModel: r.vehicleModelName,
        vehicleYear: r.vehicleYear,
        vehicleVin: r.vehicleVin,
        vehicleStockNo: r.vehicleStockNo,
        vehicleColor: r.vehicleColor,
        vehicleTrim: r.vehicleTrim,
        vehicleCondition: r.vehicleCondition,
        saleInvoiceNo: r.saleInvoiceNo,
        saleTotal: r.saleTotal,
        saleStatus: r.saleStatus,
        saleDate: r.saleDate,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        customerEmail: r.customerEmail,
        financingName: r.financingLenderName,
      })
    })
  } catch (error) {
    logError('api/vehicle-sales/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle sale' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleSaleDetailSchema)
    if (!parsed.success) return parsed.response
    const { deliveryDate, deliveryNotes, warrantyType, warrantyMonths, warrantyMileage, warrantyPrice, commissionAmount } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const existing = await db.query.vehicleSaleDetails.findFirst({
        where: eq(vehicleSaleDetails.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Vehicle sale not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }

      if (deliveryDate !== undefined) updateData.deliveryDate = deliveryDate
      if (deliveryNotes !== undefined) updateData.deliveryNotes = deliveryNotes
      if (warrantyType !== undefined) updateData.warrantyType = warrantyType
      if (warrantyMonths !== undefined) updateData.warrantyMonths = warrantyMonths
      if (warrantyMileage !== undefined) updateData.warrantyMileage = warrantyMileage
      if (warrantyPrice !== undefined) updateData.warrantyPrice = warrantyPrice ? String(warrantyPrice) : null
      if (commissionAmount !== undefined) updateData.commissionAmount = commissionAmount ? String(commissionAmount) : null

      const [updated] = await db.update(vehicleSaleDetails)
        .set(updateData)
        .where(eq(vehicleSaleDetails.id, id))
        .returning()

      logAndBroadcast(session!.user.tenantId, 'vehicle-sale', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/vehicle-sales/[id]', error)
    return NextResponse.json({ error: 'Failed to update vehicle sale' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'voidSales')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const existing = await db.query.vehicleSaleDetails.findFirst({
        where: eq(vehicleSaleDetails.id, id),
        with: { sale: true },
      })

      if (!existing) {
        return NextResponse.json({ error: 'Vehicle sale not found' }, { status: 404 })
      }

      // Only allow deletion of draft/pending sales
      if (existing.sale && existing.sale.status === 'completed') {
        return NextResponse.json(
          { error: 'Cannot delete a completed vehicle sale. Use void instead.' },
          { status: 400 }
        )
      }

      await db.delete(vehicleSaleDetails).where(eq(vehicleSaleDetails.id, id))

      logAndBroadcast(session!.user.tenantId, 'vehicle-sale', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/vehicle-sales/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle sale' }, { status: 500 })
  }
}

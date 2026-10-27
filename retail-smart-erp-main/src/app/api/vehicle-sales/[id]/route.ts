import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleSaleDetails, vehicleInventory, vehicleMakes, vehicleModels, sales, customers, financingOptions, vehicleWarranties } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleSaleDetailSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { planBlockMessage, planOnSale } from '@/lib/installments/sale-guard'

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
    const { deliveryDate, deliveryNotes, warrantyType, warrantyMonths, warrantyMileage, warrantyPrice, commissionAmount, status, cancellationReason } = parsed.data

    // Cancelling voids the invoice: same permission as voiding a sale
    if (status === 'cancelled') {
      const voidPermError = requirePermission(session, 'voidSales')
      if (voidPermError) return voidPermError
    }

    return await withTenant(session!.user.tenantId, async (db) => {
      const [existing] = await db.select().from(vehicleSaleDetails).where(eq(vehicleSaleDetails.id, id)).for('update')

      if (!existing) {
        return NextResponse.json({ error: 'Vehicle sale not found' }, { status: 404 })
      }

      if (status === 'cancelled') {
        // Lock the invoice and the vehicle; a cancelled sale puts the vehicle back on sale.
        const [sale] = await db.select().from(sales).where(eq(sales.id, existing.saleId)).for('update')
        if (!sale) {
          return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
        }
        if (sale.status === 'void') {
          return NextResponse.json({ error: 'This vehicle sale is already cancelled' }, { status: 400 })
        }
        const hpPlan = await planOnSale(db, sale.id)
        if (hpPlan) return NextResponse.json({ error: planBlockMessage(hpPlan), code: 'HP_PLAN_EXISTS' }, { status: 409 })
        await db.update(sales)
          .set({ status: 'void', voidReason: cancellationReason || 'Vehicle sale cancelled', voidedAt: new Date() })
          .where(eq(sales.id, sale.id))

        const [vehicle] = await db.select().from(vehicleInventory).where(eq(vehicleInventory.id, existing.vehicleInventoryId)).for('update')
        // Only release the vehicle if it is still recorded as sold on THIS invoice
        if (vehicle && vehicle.saleId === sale.id) {
          await db.update(vehicleInventory)
            .set({ status: 'available', soldDate: null, soldPrice: null, saleId: null, updatedAt: new Date() })
            .where(eq(vehicleInventory.id, vehicle.id))
        }

        // Warranties sold with this sale no longer apply
        await db.update(vehicleWarranties)
          .set({ status: 'cancelled', isActive: false, updatedAt: new Date() })
          .where(eq(vehicleWarranties.saleId, sale.id))

        logAndBroadcast(session!.user.tenantId, 'vehicle-sale', 'updated', id)
        logAndBroadcast(session!.user.tenantId, 'vehicle-inventory', 'updated', existing.vehicleInventoryId)
        logAndBroadcast(session!.user.tenantId, 'sale', 'updated', sale.id)
        return NextResponse.json({ ...existing, saleStatus: 'void' })
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

      // Keep a copy in the recycle bin (super admin can restore it)
      await moveToRecycleBin(db, {
        tenantId: session!.user.tenantId, entityType: 'vehicle_sale_detail', entityId: id,
        userId: session!.user.id, userName: session!.user.name,
      })
      await db.delete(vehicleSaleDetails).where(eq(vehicleSaleDetails.id, id))

      logAndBroadcast(session!.user.tenantId, 'vehicle-sale', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/vehicle-sales/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle sale' }, { status: 500 })
  }
}

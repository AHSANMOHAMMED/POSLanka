import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleSaleDetails, vehicleInventory, vehicleMakes, vehicleModels, sales, customers, financingOptions } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleSalesListSchema, createVehicleSaleSchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle sale details for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehicleSalesListSchema)
    if (!parsed.success) return parsed.response
    const { search, customerId, vehicleInventoryId, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (vehicleInventoryId) {
        conditions.push(eq(vehicleSaleDetails.vehicleInventoryId, vehicleInventoryId))
      }
      if (customerId) {
        conditions.push(eq(sales.customerId, customerId))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(vehicleMakes.name, `%${escaped}%`),
            ilike(vehicleModels.name, `%${escaped}%`),
            ilike(vehicleInventory.vin, `%${escaped}%`),
            ilike(vehicleInventory.stockNo, `%${escaped}%`),
            ilike(sales.invoiceNo, `%${escaped}%`)
          )
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicleSaleDetails)
        .leftJoin(vehicleInventory, eq(vehicleSaleDetails.vehicleInventoryId, vehicleInventory.id))
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .leftJoin(sales, eq(vehicleSaleDetails.saleId, sales.id))
        .where(whereClause)

      const totalCount = countResult[0]?.count ?? 0

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get vehicle sale details with joins
      const result = await db
        .select({
          vehicleSale: vehicleSaleDetails,
          vehicleMakeName: vehicleMakes.name,
          vehicleModelName: vehicleModels.name,
          vehicleYear: vehicleInventory.year,
          vehicleVin: vehicleInventory.vin,
          vehicleStockNo: vehicleInventory.stockNo,
          saleInvoiceNo: sales.invoiceNo,
          saleTotal: sales.total,
          saleStatus: sales.status,
          saleDate: sales.createdAt,
          customerName: customers.name,
          customerPhone: customers.phone,
          financingLenderName: financingOptions.lenderName,
        })
        .from(vehicleSaleDetails)
        .leftJoin(vehicleInventory, eq(vehicleSaleDetails.vehicleInventoryId, vehicleInventory.id))
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .leftJoin(sales, eq(vehicleSaleDetails.saleId, sales.id))
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .leftJoin(financingOptions, eq(vehicleSaleDetails.financingOptionId, financingOptions.id))
        .where(whereClause)
        .orderBy(desc(vehicleSaleDetails.createdAt))
        .limit(limit)
        .offset(offset ?? 0)

      const data = result.map(r => ({
        ...r.vehicleSale,
        vehicleMake: r.vehicleMakeName,
        vehicleModel: r.vehicleModelName,
        vehicleYear: r.vehicleYear,
        vehicleVin: r.vehicleVin,
        vehicleStockNo: r.vehicleStockNo,
        saleInvoiceNo: r.saleInvoiceNo,
        saleTotal: r.saleTotal,
        saleStatus: r.saleStatus,
        saleDate: r.saleDate,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        financingName: r.financingLenderName,
      }))

      // Return paginated response
      if (all) {
        return NextResponse.json(data)
      }

      return NextResponse.json({
        data,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/vehicle-sales', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle sales' }, { status: 500 })
  }
}

// POST create new vehicle sale (creates sale record + vehicle sale details)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createVehicleSaleSchema)
    if (!parsed.success) return parsed.response
    const {
      vehicleInventoryId, customerId,
      askingPrice, tradeInAllowance, downPayment,
      financingOptionId, financeAmount, monthlyPayment, loanTermMonths, interestRate,
      salespersonId, commissionAmount,
      warrantyType, warrantyMonths, warrantyMileage, warrantyPrice,
      taxAmount,
      notes, deliveryDate, deliveryNotes,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // Validate vehicle exists and is available for sale
        const vehicleResult = await tx
          .select({
            vehicle: vehicleInventory,
            makeName: vehicleMakes.name,
            modelName: vehicleModels.name,
          })
          .from(vehicleInventory)
          .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
          .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
          .where(eq(vehicleInventory.id, vehicleInventoryId))
          .for('update')

        if (!vehicleResult.length) {
          throw new Error('VEHICLE_NOT_FOUND')
        }

        const vehicle = vehicleResult[0].vehicle
        const makeName = vehicleResult[0].makeName
        const modelName = vehicleResult[0].modelName

        if (vehicle.status === 'sold') {
          throw new Error('VEHICLE_ALREADY_SOLD')
        }

        // Validate customer if provided
        if (customerId) {
          const customer = await tx.query.customers.findFirst({
            where: eq(customers.id, customerId),
          })
          if (!customer) {
            throw new Error('CUSTOMER_NOT_FOUND')
          }
        }

        // Validate financing option if provided
        if (financingOptionId) {
          const option = await tx.query.financingOptions.findFirst({
            where: eq(financingOptions.id, financingOptionId),
          })
          if (!option) {
            throw new Error('FINANCING_OPTION_NOT_FOUND')
          }
        }

        // Advisory lock to prevent duplicate invoice numbers under concurrency
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1)`)

        // Generate invoice number
        const [lastSale] = await tx
          .select({ invoiceNo: sales.invoiceNo })
          .from(sales)
          .orderBy(desc(sales.createdAt))
          .limit(1)

        let nextInvoiceNum = 1
        if (lastSale?.invoiceNo) {
          const numMatch = lastSale.invoiceNo.match(/(\d+)$/)
          if (numMatch) {
            nextInvoiceNum = parseInt(numMatch[1]) + 1
          }
        }
        const invoiceNo = `VS-${String(nextInvoiceNum).padStart(6, '0')}`

        // Calculate total (Zod already provides numbers)
        const calculatedTotal = askingPrice - tradeInAllowance + taxAmount

        // Create the sale record
        const [newSale] = await tx.insert(sales).values({
          tenantId: session.user.tenantId,
          invoiceNo,
          customerId: customerId || null,
          customerName: null,
          vehicleDescription: `${vehicle.year} ${makeName || ''} ${modelName || ''}${vehicle.trim ? ' ' + vehicle.trim : ''}`.trim(),
          subtotal: String(askingPrice),
          discountAmount: String(tradeInAllowance),
          discountType: tradeInAllowance > 0 ? 'fixed' : null,
          discountReason: tradeInAllowance > 0 ? 'Trade-in allowance' : null,
          taxAmount: String(taxAmount),
          total: String(calculatedTotal),
          paidAmount: String(downPayment),
          paymentMethod: financingOptionId ? 'bank_transfer' : 'cash',
          status: 'completed',
          notes: notes || null,
          createdBy: session.user.id,
        }).returning()

        // Create vehicle sale details
        const [newVehicleSale] = await tx.insert(vehicleSaleDetails).values({
          tenantId: session.user.tenantId,
          saleId: newSale.id,
          vehicleInventoryId,
          tradeInAllowance: tradeInAllowance > 0 ? String(tradeInAllowance) : null,
          downPayment: downPayment > 0 ? String(downPayment) : null,
          financingOptionId: financingOptionId || null,
          financeAmount: financeAmount != null ? String(financeAmount) : null,
          monthlyPayment: monthlyPayment != null ? String(monthlyPayment) : null,
          loanTermMonths: loanTermMonths ?? null,
          interestRate: interestRate != null ? String(interestRate) : null,
          salespersonId: salespersonId || session.user.id,
          commissionAmount: commissionAmount != null ? String(commissionAmount) : null,
          warrantyType: warrantyType || null,
          warrantyMonths: warrantyMonths ?? null,
          warrantyMileage: warrantyMileage ?? null,
          warrantyPrice: warrantyPrice != null ? String(warrantyPrice) : null,
          deliveryDate: deliveryDate || null,
          deliveryNotes: deliveryNotes || null,
        }).returning()

        // Update vehicle inventory status to sold
        await tx.update(vehicleInventory)
          .set({
            status: 'sold',
            soldDate: deliveryDate || new Date().toISOString().split('T')[0],
            soldPrice: String(calculatedTotal),
            saleId: newSale.id,
            updatedAt: new Date(),
          })
          .where(eq(vehicleInventory.id, vehicleInventoryId))

        return {
          sale: newSale,
          vehicleSaleDetails: newVehicleSale,
        }
      })

      // Broadcast changes
      logAndBroadcast(session.user.tenantId, 'vehicle-sale', 'created', result.vehicleSaleDetails.id)
      logAndBroadcast(session.user.tenantId, 'vehicle-inventory', 'updated', vehicleInventoryId)
      logAndBroadcast(session.user.tenantId, 'sale', 'created', result.sale.id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/vehicle-sales', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'VEHICLE_NOT_FOUND') {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 400 })
    }
    if (message === 'VEHICLE_ALREADY_SOLD') {
      return NextResponse.json({ error: 'Vehicle has already been sold' }, { status: 400 })
    }
    if (message === 'CUSTOMER_NOT_FOUND') {
      return NextResponse.json({ error: 'Customer not found' }, { status: 400 })
    }
    if (message === 'FINANCING_OPTION_NOT_FOUND') {
      return NextResponse.json({ error: 'Financing option not found' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to create vehicle sale' }, { status: 500 })
  }
}

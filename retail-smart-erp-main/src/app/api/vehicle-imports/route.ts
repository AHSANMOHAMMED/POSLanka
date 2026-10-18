import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleImports } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleImportsListSchema, createVehicleImportSchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle imports for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehicleImportsListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, vehicleInventoryId, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(vehicleImports.importNo, `%${escaped}%`),
            ilike(vehicleImports.billOfLadingNo, `%${escaped}%`),
            ilike(vehicleImports.customsDeclarationNo, `%${escaped}%`),
            ilike(vehicleImports.lcNo, `%${escaped}%`)
          )
        )
      }
      if (status) {
        conditions.push(eq(vehicleImports.status, status))
      }
      if (vehicleInventoryId) {
        conditions.push(eq(vehicleImports.vehicleInventoryId, vehicleInventoryId))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicleImports)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db
        .select()
        .from(vehicleImports)
        .where(whereClause)
        .orderBy(desc(vehicleImports.createdAt))
        .limit(limit)
        .offset(offset ?? 0)

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/vehicle-imports', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle imports' }, { status: 500 })
  }
}

// POST create new vehicle import record
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createVehicleImportSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Auto-generate import number: IM-YYYYMMDD-NNN
      const today = new Date()
      const datePrefix = `IM-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
      const [existing] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicleImports)
        .where(ilike(vehicleImports.importNo, `${datePrefix}%`))
      const seq = (existing?.count || 0) + 1
      const importNo = `${datePrefix}-${String(seq).padStart(3, '0')}`

      const [newImport] = await db.insert(vehicleImports).values({
        tenantId: session.user.tenantId,
        importNo,
        vehicleInventoryId: body.vehicleInventoryId || null,
        supplierId: body.supplierId || null,
        purchaseOrderId: body.purchaseOrderId || null,
        fobValue: body.fobValue != null ? body.fobValue.toString() : null,
        freightCost: body.freightCost != null ? body.freightCost.toString() : null,
        insuranceCost: body.insuranceCost != null ? body.insuranceCost.toString() : null,
        cifValue: body.cifValue != null ? body.cifValue.toString() : null,
        cifCurrency: body.cifCurrency,
        exchangeRate: body.exchangeRate != null ? body.exchangeRate.toString() : null,
        cifValueLkr: body.cifValueLkr != null ? body.cifValueLkr.toString() : null,
        customsImportDuty: body.customsImportDuty != null ? body.customsImportDuty.toString() : null,
        customsImportDutyRate: body.customsImportDutyRate != null ? body.customsImportDutyRate.toString() : null,
        surcharge: body.surcharge != null ? body.surcharge.toString() : null,
        surchargeRate: body.surchargeRate != null ? body.surchargeRate.toString() : null,
        exciseDuty: body.exciseDuty != null ? body.exciseDuty.toString() : null,
        exciseDutyRate: body.exciseDutyRate != null ? body.exciseDutyRate.toString() : null,
        luxuryTax: body.luxuryTax != null ? body.luxuryTax.toString() : null,
        luxuryTaxRate: body.luxuryTaxRate != null ? body.luxuryTaxRate.toString() : null,
        vatAmount: body.vatAmount != null ? body.vatAmount.toString() : null,
        vatRate: body.vatRate != null ? body.vatRate.toString() : null,
        palCharge: body.palCharge != null ? body.palCharge.toString() : null,
        cessFee: body.cessFee != null ? body.cessFee.toString() : null,
        totalTaxes: body.totalTaxes != null ? body.totalTaxes.toString() : null,
        totalLandedCost: body.totalLandedCost != null ? body.totalLandedCost.toString() : null,
        hsCode: body.hsCode || null,
        engineCapacityCc: body.engineCapacityCc ?? null,
        enginePowerKw: body.enginePowerKw != null ? body.enginePowerKw.toString() : null,
        importCountry: body.importCountry || null,
        yearOfManufacture: body.yearOfManufacture ?? null,
        billOfLadingNo: body.billOfLadingNo || null,
        lcNo: body.lcNo || null,
        customsDeclarationNo: body.customsDeclarationNo || null,
        portOfEntry: body.portOfEntry || null,
        arrivalDate: body.arrivalDate || null,
        clearanceDate: body.clearanceDate || null,
        registrationNo: body.registrationNo || null,
        status: body.status,
        notes: body.notes || null,
        additionalCosts: body.additionalCosts != null ? body.additionalCosts.toString() : null,
        additionalCostsBreakdown: body.additionalCostsBreakdown,
        documents: body.documents,
        createdBy: session.user.id,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'vehicle-import', 'created', newImport.id, {
        userId: session.user.id,
        entityName: importNo,
        description: `Created vehicle import ${importNo}`,
      })

      return NextResponse.json(newImport, { status: 201 })
    })
  } catch (error) {
    logError('api/vehicle-imports', error)
    return NextResponse.json({ error: 'Failed to create vehicle import' }, { status: 500 })
  }
}

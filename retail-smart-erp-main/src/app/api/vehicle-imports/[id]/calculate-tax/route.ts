import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleImports } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { calculateImportTax } from '@/lib/dealership/import-tax-calculator'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { calculateImportTaxSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST - Calculate import taxes and save results to the import record
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, calculateImportTaxSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [record] = await db.select().from(vehicleImports).where(eq(vehicleImports.id, id))
      if (!record) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      // Use values from body (form) or fall back to existing record values
      const fobValue = body.fobValue ?? parseFloat(record.fobValue ?? '0')
      const freightCost = body.freightCost ?? parseFloat(record.freightCost ?? '0')
      const insuranceCost = body.insuranceCost ?? parseFloat(record.insuranceCost ?? '0')
      const exchangeRate = body.exchangeRate ?? parseFloat(record.exchangeRate ?? '1')
      const engineCapacityCc = body.engineCapacityCc ?? record.engineCapacityCc ?? 0
      const enginePowerKw = body.enginePowerKw ?? undefined

      const breakdown = calculateImportTax({
        fobValue,
        freightCost,
        insuranceCost,
        exchangeRate,
        engineCapacityCc,
        enginePowerKw,
        fuelType: body.fuelType,
        vehicleType: body.vehicleType,
        condition: body.condition,
        yearOfManufacture: body.yearOfManufacture ?? record.yearOfManufacture ?? new Date().getFullYear(),
        overrides: body.overrides,
      })

      // Save calculated values back to the import record
      const [updated] = await db.update(vehicleImports).set({
        fobValue: breakdown.fobValue.toString(),
        freightCost: breakdown.freightCost.toString(),
        insuranceCost: breakdown.insuranceCost.toString(),
        cifValue: breakdown.cifValueOriginal.toString(),
        exchangeRate: breakdown.exchangeRate.toString(),
        cifValueLkr: breakdown.cifValueLkr.toString(),
        customsImportDuty: breakdown.customsImportDuty.toString(),
        customsImportDutyRate: breakdown.customsImportDutyRate.toString(),
        surcharge: breakdown.surcharge.toString(),
        surchargeRate: breakdown.surchargeRate.toString(),
        exciseDuty: breakdown.exciseDuty.toString(),
        exciseDutyRate: breakdown.exciseDutyRate.toString(),
        luxuryTax: breakdown.luxuryTax.toString(),
        luxuryTaxRate: breakdown.luxuryTaxRate.toString(),
        vatAmount: breakdown.vatAmount.toString(),
        vatRate: breakdown.vatRate.toString(),
        palCharge: breakdown.palCharge.toString(),
        cessFee: breakdown.cessFee.toString(),
        totalTaxes: breakdown.totalTaxes.toString(),
        totalLandedCost: breakdown.totalLandedCost.toString(),
        engineCapacityCc,
        enginePowerKw: enginePowerKw?.toString() || null,
        updatedAt: new Date(),
      }).where(eq(vehicleImports.id, id)).returning()

      logAndBroadcast(session.user.tenantId, 'vehicle-import', 'updated', id, {
        userId: session.user.id,
        entityName: record.importNo,
        description: `Calculated import taxes for ${record.importNo}`,
      })

      return NextResponse.json({ import: updated, breakdown })
    })
  } catch (error) {
    logError('api/vehicle-imports/[id]/calculate-tax', error)
    return NextResponse.json({ error: 'Failed to calculate taxes' }, { status: 500 })
  }
}

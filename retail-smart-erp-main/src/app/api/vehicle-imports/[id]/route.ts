import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleImports } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleImportSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
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
      const [record] = await db.select().from(vehicleImports).where(eq(vehicleImports.id, id))
      if (!record) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json(record)
    })
  } catch (error) {
    logError('api/vehicle-imports/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle import' }, { status: 500 })
  }
}

export async function PUT(
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
    const parsed = await validateBody(request, updateVehicleImportSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const updateData: Record<string, unknown> = { updatedAt: new Date() }

      // Map all updatable fields by type
      const stringFields = [
        'status', 'hsCode', 'importCountry', 'billOfLadingNo', 'lcNo',
        'customsDeclarationNo', 'portOfEntry', 'registrationNo', 'notes', 'cifCurrency',
      ] as const
      const decimalFields = [
        'fobValue', 'freightCost', 'insuranceCost', 'cifValue', 'exchangeRate',
        'cifValueLkr', 'customsImportDuty', 'customsImportDutyRate', 'surcharge', 'surchargeRate',
        'exciseDuty', 'exciseDutyRate', 'luxuryTax', 'luxuryTaxRate', 'vatAmount', 'vatRate',
        'palCharge', 'cessFee', 'totalTaxes', 'totalLandedCost', 'additionalCosts', 'enginePowerKw',
      ] as const
      const intFields = ['engineCapacityCc', 'yearOfManufacture'] as const
      const dateFields = ['arrivalDate', 'clearanceDate'] as const
      const uuidFields = ['vehicleInventoryId', 'supplierId', 'purchaseOrderId'] as const
      const jsonbFields = ['additionalCostsBreakdown', 'documents'] as const

      for (const f of stringFields) {
        if (body[f] !== undefined) updateData[f] = body[f] || null
      }
      for (const f of decimalFields) {
        if (body[f] !== undefined) updateData[f] = body[f] != null ? body[f]!.toString() : null
      }
      for (const f of intFields) {
        if (body[f] !== undefined) updateData[f] = body[f] ?? null
      }
      for (const f of dateFields) {
        if (body[f] !== undefined) updateData[f] = body[f] || null
      }
      for (const f of uuidFields) {
        if (body[f] !== undefined) updateData[f] = body[f] || null
      }
      for (const f of jsonbFields) {
        if (body[f] !== undefined) updateData[f] = body[f]
      }

      const [updated] = await db.update(vehicleImports)
        .set(updateData)
        .where(eq(vehicleImports.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      logAndBroadcast(session.user.tenantId, 'vehicle-import', 'updated', id, {
        userId: session.user.id,
        entityName: updated.importNo,
        description: `Updated vehicle import ${updated.importNo}`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/vehicle-imports/[id]', error)
    return NextResponse.json({ error: 'Failed to update vehicle import' }, { status: 500 })
  }
}

export async function DELETE(
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

    return await withTenant(session.user.tenantId, async (db) => {
      const [record] = await db.select().from(vehicleImports).where(eq(vehicleImports.id, id))
      if (!record) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (record.status === 'cleared' || record.status === 'registered') {
        return NextResponse.json({ error: 'Cannot delete cleared or registered imports' }, { status: 400 })
      }

      await db.delete(vehicleImports).where(eq(vehicleImports.id, id))

      logAndBroadcast(session.user.tenantId, 'vehicle-import', 'deleted', id, {
        userId: session.user.id,
        entityName: record.importNo,
        description: `Deleted vehicle import ${record.importNo}`,
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/vehicle-imports/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle import' }, { status: 500 })
  }
}

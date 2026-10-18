import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { partCompatibility, vehicleMakes, vehicleModels } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'
import { idParamSchema } from '@/lib/validation/schemas/common'

const addCompatibilitySchema = z.object({
  makeId: z.string().uuid(),
  modelId: z.string().uuid().optional(),
  yearFrom: z.number().int().min(1900).max(2100).optional(),
  yearTo: z.number().int().min(1900).max(2100).optional(),
})

// GET all compatibility entries for an item
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
    const { id: itemId } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const entries = await db
        .select({
          id: partCompatibility.id,
          itemId: partCompatibility.itemId,
          makeId: partCompatibility.makeId,
          modelId: partCompatibility.modelId,
          yearFrom: partCompatibility.yearFrom,
          yearTo: partCompatibility.yearTo,
          makeName: vehicleMakes.name,
          modelName: vehicleModels.name,
        })
        .from(partCompatibility)
        .leftJoin(vehicleMakes, eq(partCompatibility.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(partCompatibility.modelId, vehicleModels.id))
        .where(eq(partCompatibility.itemId, itemId))

      return NextResponse.json(entries)
    })
  } catch (error) {
    console.error('GET /api/items/[id]/compatibility error:', error)
    return NextResponse.json({ error: 'Failed to fetch compatibility' }, { status: 500 })
  }
}

// POST add a compatibility entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, addCompatibilitySchema)
    if (!parsed.success) return parsed.response
    const { makeId, modelId, yearFrom, yearTo } = parsed.data

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: itemId } = paramsParsed.data

    if (yearFrom && yearTo && yearFrom > yearTo) {
      return NextResponse.json({ error: 'Year From must be less than or equal to Year To' }, { status: 400 })
    }

    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate
      const existing = await db
        .select({ id: partCompatibility.id })
        .from(partCompatibility)
        .where(
          and(
            eq(partCompatibility.itemId, itemId),
            eq(partCompatibility.makeId, makeId),
            modelId ? eq(partCompatibility.modelId, modelId) : undefined,
          )
        )

      // Check if exact match exists (including year range)
      const duplicate = existing.length > 0 && existing.some(() => {
        // If we have entries for same make+model, it's a potential duplicate
        // Allow different year ranges for same make+model combo
        return false
      })

      if (duplicate) {
        return NextResponse.json({ error: 'This compatibility entry already exists' }, { status: 400 })
      }

      const [entry] = await db.insert(partCompatibility).values({
        tenantId: session!.user.tenantId,
        itemId,
        makeId,
        modelId: modelId || null,
        yearFrom: yearFrom || null,
        yearTo: yearTo || null,
      }).returning()

      logAndBroadcast(session!.user.tenantId, 'item', 'updated', itemId, {
        userId: session!.user.id,
        activityAction: 'update',
        description: `Added compatible model to item`,
      })

      return NextResponse.json(entry, { status: 201 })
    })
  } catch (error) {
    console.error('POST /api/items/[id]/compatibility error:', error)
    return NextResponse.json({ error: 'Failed to add compatibility' }, { status: 500 })
  }
}

// DELETE remove a compatibility entry
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: itemId } = paramsParsed.data
    const { searchParams } = new URL(request.url)
    const compatId = searchParams.get('compatId')

    if (!compatId) {
      return NextResponse.json({ error: 'compatId is required' }, { status: 400 })
    }

    return await withTenant(session!.user.tenantId, async (db) => {
      const [deleted] = await db
        .delete(partCompatibility)
        .where(
          and(
            eq(partCompatibility.id, compatId),
            eq(partCompatibility.itemId, itemId),
          )
        )
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Compatibility entry not found' }, { status: 404 })
      }

      logAndBroadcast(session!.user.tenantId, 'item', 'updated', itemId, {
        userId: session!.user.id,
        activityAction: 'update',
        description: `Removed compatible model from item`,
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    console.error('DELETE /api/items/[id]/compatibility error:', error)
    return NextResponse.json({ error: 'Failed to delete compatibility' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { commissionRates, users, serviceTypes, categories } from '@/lib/db/schema'
import { eq, and, isNull, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateCommissionRateSchema } from '@/lib/validation/schemas/commissions'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single commission rate
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

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [rate] = await db
        .select({
          id: commissionRates.id,
          tenantId: commissionRates.tenantId,
          userId: commissionRates.userId,
          serviceTypeId: commissionRates.serviceTypeId,
          categoryId: commissionRates.categoryId,
          rate: commissionRates.rate,
          rateType: commissionRates.rateType,
          isActive: commissionRates.isActive,
          userName: users.fullName,
          serviceTypeName: serviceTypes.name,
          categoryName: categories.name,
        })
        .from(commissionRates)
        .leftJoin(users, eq(commissionRates.userId, users.id))
        .leftJoin(serviceTypes, eq(commissionRates.serviceTypeId, serviceTypes.id))
        .leftJoin(categories, eq(commissionRates.categoryId, categories.id))
        .where(eq(commissionRates.id, id))

      if (!rate) {
        return NextResponse.json({ error: 'Commission rate not found' }, { status: 404 })
      }

      return NextResponse.json(rate)
    })
  } catch (error) {
    logError('api/commission-rates/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch commission rate' }, { status: 500 })
  }
}

// PUT update commission rate
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCommissionRateSchema)
    if (!parsed.success) return parsed.response
    const { userId, serviceTypeId, categoryId, rate, rateType, isActive } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check if rate exists
      const existingRate = await db.query.commissionRates.findFirst({
        where: eq(commissionRates.id, id),
      })

      if (!existingRate) {
        return NextResponse.json({ error: 'Commission rate not found' }, { status: 404 })
      }

      // Build update data
      const updateData: Partial<typeof commissionRates.$inferInsert> = {}

      if (rate !== undefined) {
        // Validate percentage cap with effective rate type
        const effectiveRateType = rateType || existingRate.rateType
        if (effectiveRateType === 'percentage' && rate > 100) {
          return NextResponse.json({ error: 'Percentage rate cannot exceed 100%' }, { status: 400 })
        }
        updateData.rate = String(rate)
      }

      if (rateType !== undefined) {
        updateData.rateType = rateType
      }

      if (isActive !== undefined) {
        updateData.isActive = isActive
      }

      // Handle reference updates
      const newUserId = userId !== undefined ? userId : existingRate.userId
      const newServiceTypeId = serviceTypeId !== undefined ? serviceTypeId : existingRate.serviceTypeId
      const newCategoryId = categoryId !== undefined ? categoryId : existingRate.categoryId

      // Check for duplicate configuration (excluding current rate)
      const duplicateRate = await db.query.commissionRates.findFirst({
        where: and(
          ne(commissionRates.id, id),
          newUserId ? eq(commissionRates.userId, newUserId) : isNull(commissionRates.userId),
          newServiceTypeId ? eq(commissionRates.serviceTypeId, newServiceTypeId) : isNull(commissionRates.serviceTypeId),
          newCategoryId ? eq(commissionRates.categoryId, newCategoryId) : isNull(commissionRates.categoryId),
          eq(commissionRates.isActive, true)
        ),
      })

      if (duplicateRate && (isActive !== false)) {
        return NextResponse.json({
          error: 'A commission rate with this configuration already exists'
        }, { status: 400 })
      }

      if (userId !== undefined) {
        if (userId) {
          const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
          })
          if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 400 })
          }
        }
        updateData.userId = userId || null
      }

      if (serviceTypeId !== undefined) {
        if (serviceTypeId) {
          const serviceType = await db.query.serviceTypes.findFirst({
            where: eq(serviceTypes.id, serviceTypeId),
          })
          if (!serviceType) {
            return NextResponse.json({ error: 'Service type not found' }, { status: 400 })
          }
        }
        updateData.serviceTypeId = serviceTypeId || null
      }

      if (categoryId !== undefined) {
        if (categoryId) {
          const category = await db.query.categories.findFirst({
            where: eq(categories.id, categoryId),
          })
          if (!category) {
            return NextResponse.json({ error: 'Category not found' }, { status: 400 })
          }
        }
        updateData.categoryId = categoryId || null
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
      }

      const [updated] = await db.update(commissionRates)
        .set(updateData)
        .where(eq(commissionRates.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'commission-rate', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/commission-rates/[id]', error)
    return NextResponse.json({ error: 'Failed to update commission rate' }, { status: 500 })
  }
}

// DELETE commission rate
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [deleted] = await db.delete(commissionRates)
        .where(eq(commissionRates.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Commission rate not found' }, { status: 404 })
      }

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'commission-rate', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/commission-rates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete commission rate' }, { status: 500 })
  }
}

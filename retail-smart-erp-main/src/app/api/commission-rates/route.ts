import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { commissionRates, users, serviceTypes, categories } from '@/lib/db/schema'
import { and, eq, sql, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { commissionRatesListSchema, createCommissionRateSchema } from '@/lib/validation/schemas/commissions'

// GET all commission rates for the tenant (with pagination and filters)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, commissionRatesListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, userId, serviceTypeId, categoryId, activeOnly } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      if (userId) {
        conditions.push(eq(commissionRates.userId, userId))
      }
      if (serviceTypeId) {
        conditions.push(eq(commissionRates.serviceTypeId, serviceTypeId))
      }
      if (categoryId) {
        conditions.push(eq(commissionRates.categoryId, categoryId))
      }
      if (activeOnly) {
        conditions.push(eq(commissionRates.isActive, true))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all rates (for dropdowns or full list)
      if (all) {
        const result = await db
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
          .where(whereClause)
          .orderBy(commissionRates.rate)
          .limit(1000)

        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(commissionRates)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results with joins
      const result = await db
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
        .where(whereClause)
        .orderBy(commissionRates.rate)
        .limit(pageSize)
        .offset(offset)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/commission-rates', error)
    return NextResponse.json({ error: 'Failed to fetch commission rates' }, { status: 500 })
  }
}

// POST create new commission rate
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createCommissionRateSchema)
    if (!parsed.success) return parsed.response
    const { userId, serviceTypeId, categoryId, rate, rateType } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate rate configuration (same user/serviceType/category combination)
      const existingRate = await db.query.commissionRates.findFirst({
        where: and(
          userId ? eq(commissionRates.userId, userId) : isNull(commissionRates.userId),
          serviceTypeId ? eq(commissionRates.serviceTypeId, serviceTypeId) : isNull(commissionRates.serviceTypeId),
          categoryId ? eq(commissionRates.categoryId, categoryId) : isNull(commissionRates.categoryId),
          eq(commissionRates.isActive, true)
        ),
      })

      if (existingRate) {
        return NextResponse.json({
          error: 'A commission rate with this configuration already exists'
        }, { status: 400 })
      }

      // Validate references exist if provided
      if (userId) {
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        })
        if (!user) {
          return NextResponse.json({ error: 'User not found' }, { status: 400 })
        }
      }

      if (serviceTypeId) {
        const serviceType = await db.query.serviceTypes.findFirst({
          where: eq(serviceTypes.id, serviceTypeId),
        })
        if (!serviceType) {
          return NextResponse.json({ error: 'Service type not found' }, { status: 400 })
        }
      }

      if (categoryId) {
        const category = await db.query.categories.findFirst({
          where: eq(categories.id, categoryId),
        })
        if (!category) {
          return NextResponse.json({ error: 'Category not found' }, { status: 400 })
        }
      }

      const [newRate] = await db.insert(commissionRates).values({
        tenantId: session!.user.tenantId,
        userId: userId || null,
        serviceTypeId: serviceTypeId || null,
        categoryId: categoryId || null,
        rate: String(rate),
        rateType,
        isActive: true,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'commission-rate', 'created', newRate.id)

      return NextResponse.json(newRate)
    })
  } catch (error) {
    logError('api/commission-rates', error)
    return NextResponse.json({ error: 'Failed to create commission rate' }, { status: 500 })
  }
}

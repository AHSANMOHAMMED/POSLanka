import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { commissionRates } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { commissionRateMatrixGetSchema, commissionRateMatrixUpdateSchema } from '@/lib/validation/schemas/commissions'

// GET commission rates matrix for a user
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const paramsParsed = validateSearchParams(request, commissionRateMatrixGetSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { userId } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Get all categories
      const allCategories = await db.query.categories.findMany({
        orderBy: (cat, { asc }) => [asc(cat.name)],
      })

      // Get all service types
      const allServiceTypes = await db.query.serviceTypes.findMany({
        orderBy: (st, { asc }) => [asc(st.name)],
      })

      // Get all rates for this user
      const rates = await db.query.commissionRates.findMany({
        where: eq(commissionRates.userId, userId),
      })

      // Build category rates grid
      const categoryRates = allCategories.map((cat) => {
        const rate = rates.find(
          (r) => r.categoryId === cat.id && !r.serviceTypeId
        )
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          rate: rate ? Number(rate.rate) : null,
          rateType: rate?.rateType || 'percentage',
          rateId: rate?.id || null,
          isActive: rate?.isActive ?? true,
        }
      })

      // Build service type rates grid
      const serviceTypeRates = allServiceTypes.map((st) => {
        const rate = rates.find(
          (r) => r.serviceTypeId === st.id && !r.categoryId
        )
        return {
          serviceTypeId: st.id,
          serviceTypeName: st.name,
          rate: rate ? Number(rate.rate) : null,
          rateType: rate?.rateType || 'percentage',
          rateId: rate?.id || null,
          isActive: rate?.isActive ?? true,
        }
      })

      // Default rate (no category, no service type)
      const defaultRate = rates.find(
        (r) => !r.categoryId && !r.serviceTypeId
      )

      return NextResponse.json({
        userId,
        defaultRate: defaultRate
          ? { rate: Number(defaultRate.rate), rateType: defaultRate.rateType, rateId: defaultRate.id }
          : null,
        categoryRates,
        serviceTypeRates,
      })
    })
  } catch (error) {
    logError('api/commission-rates/matrix', error)
    return NextResponse.json({ error: 'Failed to fetch commission rate matrix' }, { status: 500 })
  }
}

// PUT bulk upsert commission rates from matrix grid
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const parsed = await validateBody(request, commissionRateMatrixUpdateSchema)
    if (!parsed.success) return parsed.response
    const { userId, rates: rateEntries } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const results: string[] = []

      for (const entry of rateEntries) {
        const { categoryId, serviceTypeId, rate, rateType = 'percentage' } = entry

        // Build condition to find existing rate
        const conditions = [eq(commissionRates.userId, userId)]
        if (categoryId) {
          conditions.push(eq(commissionRates.categoryId, categoryId))
        } else {
          conditions.push(isNull(commissionRates.categoryId))
        }
        if (serviceTypeId) {
          conditions.push(eq(commissionRates.serviceTypeId, serviceTypeId))
        } else {
          conditions.push(isNull(commissionRates.serviceTypeId))
        }

        const existing = await db.query.commissionRates.findFirst({
          where: and(...conditions),
        })

        if (rate === null || rate === undefined) {
          // Delete the rate if it exists and rate is null
          if (existing) {
            await db.delete(commissionRates).where(eq(commissionRates.id, existing.id))
            results.push(`deleted:${existing.id}`)
          }
        } else if (existing) {
          // Update existing rate
          await db
            .update(commissionRates)
            .set({ rate: String(rate), rateType, isActive: true })
            .where(eq(commissionRates.id, existing.id))
          results.push(`updated:${existing.id}`)
        } else {
          // Insert new rate
          const [newRate] = await db
            .insert(commissionRates)
            .values({
              tenantId: session.user.tenantId,
              userId,
              categoryId: categoryId || null,
              serviceTypeId: serviceTypeId || null,
              rate: String(rate),
              rateType,
              isActive: true,
            })
            .returning()
          results.push(`created:${newRate.id}`)
        }
      }

      logAndBroadcast(session.user.tenantId, 'commission-rate', 'updated', userId)

      return NextResponse.json({ success: true, operations: results.length })
    })
  } catch (error) {
    logError('api/commission-rates/matrix', error)
    return NextResponse.json({ error: 'Failed to update commission rate matrix' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { tradeInVehicles } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { tradeInsListSchema, createTradeInSchema } from '@/lib/validation/schemas/dealership'

// GET all trade-ins for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, tradeInsListSchema)
    if (!parsed.success) return parsed.response
    const { status, saleId, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (status) {
        conditions.push(eq(tradeInVehicles.status, status))
      }
      if (saleId) {
        conditions.push(eq(tradeInVehicles.saleId, saleId))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tradeInVehicles)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.tradeInVehicles.findMany({
        where: whereClause,
        orderBy: (tradeInVehicles, { desc: d }) => [d(tradeInVehicles.createdAt)],
        limit,
        offset,
      })

      // Return paginated response
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
    logError('api/trade-ins', error)
    return NextResponse.json({ error: 'Failed to fetch trade-ins' }, { status: 500 })
  }
}

// POST create new trade-in evaluation
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

    const parsed = await validateBody(request, createTradeInSchema)
    if (!parsed.success) return parsed.response
    const {
      saleId, make, model, year, vin, mileage,
      condition, color, appraisalValue, tradeInAllowance,
      conditionNotes, appraisedBy,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [newTradeIn] = await db.insert(tradeInVehicles).values({
        tenantId: session.user.tenantId,
        saleId: saleId || null,
        make,
        model,
        year,
        vin: vin ? vin.trim().toUpperCase() : null,
        mileage: mileage ?? null,
        condition: condition || null,
        color: color || null,
        appraisalValue: appraisalValue != null ? String(appraisalValue) : null,
        tradeInAllowance: tradeInAllowance != null ? String(tradeInAllowance) : null,
        conditionNotes: conditionNotes || null,
        appraisedBy: appraisedBy || session.user.id,
        status: 'pending',
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'trade-in', 'created', newTradeIn.id)

      return NextResponse.json(newTradeIn)
    })
  } catch (error) {
    logError('api/trade-ins', error)
    return NextResponse.json({ error: 'Failed to create trade-in' }, { status: 500 })
  }
}

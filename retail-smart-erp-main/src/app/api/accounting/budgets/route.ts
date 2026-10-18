import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { budgets, budgetItems, fiscalYears, costCenters } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { budgetsListSchema, createBudgetSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, budgetsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, status } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) {
        conditions.push(ilike(budgets.name, `%${escapeLikePattern(search)}%`))
      }
      if (status) {
        conditions.push(sql`${budgets.status} = ${status}`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(budgets)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Fetch budgets with fiscal year and cost center names via joins
      const result = await db
        .select({
          id: budgets.id,
          tenantId: budgets.tenantId,
          name: budgets.name,
          fiscalYearId: budgets.fiscalYearId,
          costCenterId: budgets.costCenterId,
          status: budgets.status,
          createdAt: budgets.createdAt,
          updatedAt: budgets.updatedAt,
          fiscalYearName: fiscalYears.name,
          costCenterName: costCenters.name,
        })
        .from(budgets)
        .leftJoin(fiscalYears, eq(budgets.fiscalYearId, fiscalYears.id))
        .leftJoin(costCenters, eq(budgets.costCenterId, costCenters.id))
        .where(whereClause)
        .orderBy(desc(budgets.createdAt))
        .limit(Math.min(pageSize, 100))
        .offset(offset)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/budgets', error)
    return NextResponse.json({ error: 'Failed to fetch budgets' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createBudgetSchema)
    if (!parsed.success) return parsed.response
    const { name, fiscalYearId, costCenterId, items } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenantTransaction(tenantId, async (tx) => {
      // Validate fiscal year if provided
      if (fiscalYearId) {
        const fy = await tx
          .select({ id: fiscalYears.id })
          .from(fiscalYears)
          .where(eq(fiscalYears.id, fiscalYearId))
          .limit(1)

        if (fy.length === 0) {
          return NextResponse.json(
            { error: 'Fiscal year not found' },
            { status: 404 }
          )
        }
      }

      // Validate cost center if provided
      if (costCenterId) {
        const cc = await tx
          .select({ id: costCenters.id })
          .from(costCenters)
          .where(eq(costCenters.id, costCenterId))
          .limit(1)

        if (cc.length === 0) {
          return NextResponse.json(
            { error: 'Cost center not found' },
            { status: 404 }
          )
        }
      }

      // Create budget
      const [newBudget] = await tx.insert(budgets).values({
        tenantId,
        name,
        fiscalYearId: fiscalYearId || null,
        costCenterId: costCenterId || null,
        status: 'draft',
      }).returning()

      // Create budget items if provided
      if (items && items.length > 0) {
        for (const item of items) {
          await tx.insert(budgetItems).values({
            tenantId,
            budgetId: newBudget.id,
            accountId: item.accountId,
            monthlyAmount: String(item.monthlyAmount ?? 0),
            annualAmount: String(item.annualAmount ?? 0),
            controlAction: item.controlAction,
          })
        }
      }

      logAndBroadcast(tenantId, 'budget', 'created', newBudget.id)
      return NextResponse.json(newBudget)
    })
  } catch (error) {
    logError('api/accounting/budgets', error)
    return NextResponse.json({ error: 'Failed to create budget' }, { status: 500 })
  }
}

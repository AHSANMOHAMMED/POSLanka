import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleExpenses, vehicleInventory } from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleExpensesListSchema, createVehicleExpenseSchema } from '@/lib/validation/schemas/vehicles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recalcTotalExpenses(db: any, vehicleInventoryId: string) {
  const [result] = await db
    .select({ total: sql<string>`COALESCE(SUM(CASE WHEN ${vehicleExpenses.isCapitalized} = true THEN ${vehicleExpenses.amount} ELSE 0 END), 0)` })
    .from(vehicleExpenses)
    .where(eq(vehicleExpenses.vehicleInventoryId, vehicleInventoryId))
  await db.update(vehicleInventory)
    .set({ totalExpenses: result?.total || '0', updatedAt: new Date() })
    .where(eq(vehicleInventory.id, vehicleInventoryId))
}

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = validateSearchParams(request, vehicleExpensesListSchema)
    if (!parsed.success) return parsed.response
    const { vehicleInventoryId, category, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (vehicleInventoryId) conditions.push(eq(vehicleExpenses.vehicleInventoryId, vehicleInventoryId))
      if (category) conditions.push(eq(vehicleExpenses.category, category))
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicleExpenses)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.select().from(vehicleExpenses)
        .where(whereClause)
        .orderBy(desc(vehicleExpenses.createdAt))
        .limit(limit)
        .offset(offset ?? 0)

      if (all) return NextResponse.json(result)
      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total: totalCount, totalPages: Math.ceil(totalCount / pageSize) }
      })
    })
  } catch (error) {
    logError('GET /api/vehicle-expenses', error)
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError
    const parsed = await validateBody(request, createVehicleExpenseSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [expense] = await db.insert(vehicleExpenses).values({
        tenantId: session.user.tenantId,
        vehicleInventoryId: body.vehicleInventoryId,
        category: body.category,
        description: body.description || null,
        amount: body.amount.toString(),
        vendorName: body.vendorName || null,
        supplierId: body.supplierId || null,
        receiptNo: body.receiptNo || null,
        expenseDate: body.expenseDate || null,
        isCapitalized: body.isCapitalized,
        notes: body.notes || null,
        createdBy: session.user.id,
      }).returning()

      // Recalculate total expenses
      await recalcTotalExpenses(db, body.vehicleInventoryId)

      logAndBroadcast(session.user.tenantId, 'vehicle-expense', 'created', expense.id, {
        userId: session.user.id,
        description: `Added ${body.category} expense of ${body.amount}`,
      })

      return NextResponse.json(expense, { status: 201 })
    })
  } catch (error) {
    logError('POST /api/vehicle-expenses', error)
    return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
  }
}

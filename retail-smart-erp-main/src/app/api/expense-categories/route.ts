import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenantTransaction } from '@/lib/db'
import { expenseCategories } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { createExpenseCategorySchema, updateExpenseCategorySchema } from '@/lib/validation/schemas/expenses'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { ensureExpenseCategories } from '@/lib/expenses/expenses'

// GET /api/expense-categories — every signed-in user (cashiers pick one for a drawer expense).
// The defaults are created the first time.
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const rows = await withTenantTransaction(session.user.tenantId, (tx) => ensureExpenseCategories(tx, session.user.tenantId))
    return NextResponse.json({ data: rows })
  } catch (error) {
    logError('api/expense-categories', error)
    return NextResponse.json({ error: 'Failed to fetch expense categories' }, { status: 500 })
  }
}

// POST /api/expense-categories — accounts
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError
    const parsed = await validateBody(request, createExpenseCategorySchema)
    if (!parsed.success) return parsed.response
    const tenantId = session.user.tenantId
    const row = await withTenantTransaction(tenantId, async (tx) => {
      const existing = await ensureExpenseCategories(tx, tenantId)
      if (existing.some((c: { name: string }) => c.name.toLowerCase() === parsed.data.name.toLowerCase())) return null
      const [r] = await tx.insert(expenseCategories).values({
        tenantId, name: parsed.data.name, accountId: parsed.data.accountId || null,
        isActive: parsed.data.isActive ?? true, sortOrder: existing.length,
      }).returning()
      return r
    })
    if (!row) return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    logAndBroadcast(tenantId, 'expense', 'updated', row.id, { userId: session.user.id, entityName: row.name })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    logError('api/expense-categories', error)
    return NextResponse.json({ error: 'Failed to create expense category' }, { status: 500 })
  }
}

// PATCH /api/expense-categories { id, name?, accountId?, isActive? } — accounts
export async function PATCH(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError
    const parsed = await validateBody(request, updateExpenseCategorySchema)
    if (!parsed.success) return parsed.response
    const { id, ...rest } = parsed.data
    const set: Partial<typeof expenseCategories.$inferInsert> = {}
    if (rest.name !== undefined) set.name = rest.name
    if (rest.accountId !== undefined) set.accountId = rest.accountId || null
    if (rest.isActive !== undefined) set.isActive = rest.isActive
    const [row] = await withTenantTransaction(session.user.tenantId, (tx) =>
      tx.update(expenseCategories).set(set).where(eq(expenseCategories.id, id)).returning())
    if (!row) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    logError('api/expense-categories', error)
    return NextResponse.json({ error: 'Failed to update expense category' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { budgets, budgetItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateBudgetSchema } from '@/lib/validation/schemas/accounting'
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
      const budget = await db.query.budgets.findFirst({
        where: eq(budgets.id, id),
        with: {
          fiscalYear: true,
          costCenter: true,
          items: {
            with: {
              account: true,
            },
          },
        },
      })

      if (!budget) {
        return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
      }

      return NextResponse.json(budget)
    })
  } catch (error) {
    logError('api/accounting/budgets/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch budget' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateBudgetSchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId

    const { expectedUpdatedAt, ...updateFields } = parsed.data

    return await withTenantTransaction(tenantId, async (tx) => {
      // Lock the row for update to prevent race conditions
      const [current] = await tx.select().from(budgets)
        .where(eq(budgets.id, id))
        .for('update')

      if (!current) {
        throw new Error('NOT_FOUND')
      }

      // Optimistic locking: check for concurrent modification
      if (expectedUpdatedAt) {
        const clientTime = new Date(expectedUpdatedAt).getTime()
        const serverTime = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
        if (serverTime > clientTime) {
          throw new Error('CONFLICT')
        }
      }

      // Build update data - only include provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (updateFields.name !== undefined) updateData.name = updateFields.name
      if (updateFields.fiscalYearId !== undefined) updateData.fiscalYearId = updateFields.fiscalYearId || null
      if (updateFields.costCenterId !== undefined) updateData.costCenterId = updateFields.costCenterId || null
      if (updateFields.status !== undefined) updateData.status = updateFields.status

      const [updated] = await tx.update(budgets)
        .set(updateData)
        .where(eq(budgets.id, id))
        .returning()

      // If items are provided, replace all items
      if (updateFields.items && Array.isArray(updateFields.items)) {
        // Delete existing items
        await tx.delete(budgetItems).where(eq(budgetItems.budgetId, id))

        // Insert new items
        for (const item of updateFields.items) {
          if (!item.accountId) continue

          await tx.insert(budgetItems).values({
            tenantId,
            budgetId: id,
            accountId: item.accountId,
            monthlyAmount: String(Number(item.monthlyAmount || 0)),
            annualAmount: String(Number(item.annualAmount || 0)),
            controlAction: item.controlAction || 'warn',
          })
        }
      }

      logAndBroadcast(tenantId, 'budget', 'updated', id)
      return NextResponse.json(updated)
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
    }
    if (err.message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This record was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    logError('api/accounting/budgets/[id]', error)
    return NextResponse.json({ error: 'Failed to update budget' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const existing = await db.query.budgets.findFirst({
        where: eq(budgets.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
      }

      // Only allow deleting draft budgets
      if (existing.status !== 'draft') {
        return NextResponse.json(
          { error: 'Only draft budgets can be deleted' },
          { status: 400 }
        )
      }

      // Budget items will be cascade-deleted due to onDelete: 'cascade'
      await db.delete(budgets).where(eq(budgets.id, id))

      logAndBroadcast(tenantId, 'budget', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/budgets/[id]', error)
    return NextResponse.json({ error: 'Failed to delete budget' }, { status: 500 })
  }
}

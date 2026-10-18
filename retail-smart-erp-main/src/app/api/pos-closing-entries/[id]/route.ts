import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { posClosingEntries, posOpeningEntries, posClosingReconciliation } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePosClosingEntrySchema } from '@/lib/validation/schemas/pos'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET a single closing entry
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
      const entry = await db.query.posClosingEntries.findFirst({
        where: eq(posClosingEntries.id, id),
        with: {
          openingEntry: {
            with: {
              balances: true,
              sales: {
                with: {
                  payments: true,
                  customer: true,
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                orderBy: (sales: any, { desc }: any) => [desc(sales.createdAt)],
              },
            },
          },
          posProfile: {
            with: {
              warehouse: true,
            },
          },
          user: true,
          submittedByUser: true,
          reconciliation: true,
        },
      })

      if (!entry) {
        return NextResponse.json({ error: 'Closing entry not found' }, { status: 404 })
      }

      // Add variance calculations
      const reconciliationWithVariance = entry.reconciliation.map(rec => ({
        ...rec,
        difference: parseFloat(rec.actualAmount) - parseFloat(rec.expectedAmount),
      }))

      const totalVariance = reconciliationWithVariance.reduce((sum, rec) => sum + rec.difference, 0)

      return NextResponse.json({
        ...entry,
        reconciliation: reconciliationWithVariance,
        totalVariance,
      })
    })
  } catch (error) {
    logError('api/pos-closing-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch closing entry' }, { status: 500 })
  }
}

// PUT update a closing entry (submit for approval, cancel)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePOS')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updatePosClosingEntrySchema)
    if (!parsed.success) return parsed.response
    const { status, notes, cancellationReason } = parsed.data

    // Use transaction for cancel (needs to update multiple tables atomically)
    const result = await withTenantTransaction(session.user.tenantId, async (db) => {
      const existing = await db.query.posClosingEntries.findFirst({
        where: eq(posClosingEntries.id, id),
      })

      if (!existing) {
        return { error: NextResponse.json({ error: 'Closing entry not found' }, { status: 404 }) }
      }

      if (existing.status === 'cancelled') {
        return { error: NextResponse.json({ error: 'Closing entry is already cancelled' }, { status: 400 }) }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {}

      if (notes !== undefined) {
        updateData.notes = notes
      }

      if (status === 'submitted') {
        if (existing.status !== 'draft') {
          return { error: NextResponse.json({ error: 'Only draft entries can be submitted' }, { status: 400 }) }
        }
        updateData.status = 'submitted'
        updateData.submittedAt = new Date()
        updateData.submittedBy = session.user.id
      } else if (status === 'cancelled') {
        // Only owners/managers can cancel closing entries
        if (!['owner', 'manager'].includes(session.user.role)) {
          return { error: NextResponse.json({ error: 'Only owners and managers can cancel closing entries' }, { status: 403 }) }
        }

        // Require cancellation reason
        if (!cancellationReason) {
          return { error: NextResponse.json({ error: 'Cancellation reason is required' }, { status: 400 }) }
        }

        // 1. Cancel the closing entry
        updateData.status = 'cancelled'
        updateData.cancellationReason = cancellationReason
        updateData.cancelledAt = new Date()
        updateData.cancelledBy = session.user.id

        // 2. Revert the opening entry back to 'open' so the shift can be re-closed
        await db.update(posOpeningEntries)
          .set({ status: 'open' })
          .where(eq(posOpeningEntries.id, existing.openingEntryId))

        // 3. Reverse GL entries from cash over/short posting
        try {
          await reverseGLEntries(db, session.user.tenantId, 'pos_shift_closing', id)
        } catch (glError) {
          logError('api/pos-closing-entries/[id]/cancel/gl-reversal', glError)
        }

        // 4. Delete reconciliation records (they'll be recreated on next close)
        await db.delete(posClosingReconciliation)
          .where(eq(posClosingReconciliation.closingEntryId, id))
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(posClosingEntries)
          .set(updateData)
          .where(eq(posClosingEntries.id, id))
      }

      return {
        data: { id, openingEntryId: existing.openingEntryId },
        tenantId: session.user.tenantId,
        wasCancelled: status === 'cancelled',
      }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    // Fetch updated entry after transaction
    const updated = await withTenant(result.tenantId, async (db) => {
      return db.query.posClosingEntries.findFirst({
        where: eq(posClosingEntries.id, id),
        with: {
          openingEntry: {
            with: {
              balances: true,
            },
          },
          posProfile: true,
          user: true,
          submittedByUser: true,
          reconciliation: true,
        },
      })
    })

    logAndBroadcast(result.tenantId, 'pos-closing', 'updated', id)
    if (result.wasCancelled) {
      logAndBroadcast(result.tenantId, 'pos-shift', 'updated', result.data.openingEntryId)
      logAndBroadcast(result.tenantId, 'gl-entry', 'updated', id)
    }

    return NextResponse.json(updated)
  } catch (error) {
    logError('api/pos-closing-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to update closing entry' }, { status: 500 })
  }
}

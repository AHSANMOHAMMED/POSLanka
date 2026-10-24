import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenantTransaction } from '@/lib/db'
import { posCashMovements, posOpeningEntries } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { voidPosCashMovementSchema } from '@/lib/validation/schemas/pos'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { logActivity } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import { ApprovalError, consumeApprovals, coverScopes, verifyApprovalTokens } from '@/lib/auth/approval-token'
import { assertBranchAccess } from '@/lib/auth/branch-access'

/**
 * POST /api/pos-cash-movements/[id]/void — reverse a paid-in / paid-out while its shift is open.
 * Needs a supervisor approval (scope cash_movement_void) unless the user has manageSales.
 * The GL posting is reversed in the same transaction (a failed reversal keeps the movement).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, voidPosCashMovementSchema)
    if (!parsed.success) return parsed.response
    const { reason, approvalToken } = parsed.data
    const tenantId = session.user.tenantId
    const userId = session.user.id
    const isSupervisor = hasPermission(session.user.role, 'manageSales', tenantId, session.user.customRoleId)

    const result = await withTenantTransaction(tenantId, async (db) => {
      const [movement] = await db.select().from(posCashMovements).where(eq(posCashMovements.id, id)).for('update')
      if (!movement) return { error: NextResponse.json({ error: 'Cash movement not found' }, { status: 404 }) }
      if (movement.status === 'voided') {
        return { error: NextResponse.json({ error: 'This cash movement is already voided' }, { status: 400 }) }
      }
      if (movement.category === 'void_refund') {
        return { error: NextResponse.json({ error: 'The refund of a voided sale cannot be voided', code: 'SYSTEM_MOVEMENT' }, { status: 400 }) }
      }
      const [shift] = await db.select().from(posOpeningEntries).where(eq(posOpeningEntries.id, movement.openingEntryId)).for('update')
      if (!shift || shift.status !== 'open') {
        return { error: NextResponse.json({ error: 'Cash movements can only be voided while their shift is open', code: 'SHIFT_NOT_OPEN' }, { status: 400 }) }
      }
      if (shift.userId !== userId && !isSupervisor) {
        return { error: NextResponse.json({ error: 'You can only void cash movements of your own shift', code: 'SHIFT_NOT_YOURS' }, { status: 403 }) }
      }
      // K4: only drawers of the user's own branches
      const branchDenied = await assertBranchAccess(session, shift.warehouseId, db)
      if (branchDenied) return { error: branchDenied }

      const approvals = isSupervisor ? [] : verifyApprovalTokens(approvalToken ? [approvalToken] : [], { tenantId, requesterId: session.user.id })
      const cover = coverScopes(['cash_movement_void'], approvals)
      if (!isSupervisor && cover.missing.length > 0) {
        return { error: NextResponse.json({ error: 'A supervisor must approve voiding a cash movement', code: 'APPROVAL_REQUIRED', scopes: cover.missing }, { status: 403 }) }
      }
      if (cover.used.length > 0) {
        await consumeApprovals(db, {
          tenantId, usedBy: userId, entityType: 'pos_cash_movement', entityId: movement.id,
          approvals: cover.used, scopesFor: () => ['cash_movement_void'],
        })
      }

      await reverseGLEntries(db, tenantId, 'pos_cash_movement', movement.id)
      const [voided] = await db.update(posCashMovements).set({
        status: 'voided',
        voidedAt: new Date(),
        voidedBy: userId,
        voidReason: reason,
      }).where(eq(posCashMovements.id, movement.id)).returning()

      return { before: movement, voided, shift, approverId: cover.used[0]?.approverId || null }
    })

    if ('error' in result) return result.error
    const { before, voided, shift, approverId } = result
    broadcastChange(tenantId, 'pos-shift', 'updated', shift.id)
    void logActivity({
      tenantId,
      userId,
      action: 'cancel',
      entityType: 'pos_cash_movement',
      entityId: voided.id,
      entityName: voided.movementNo,
      description: `Voided cash ${voided.type === 'paid_out' ? 'paid-out' : 'paid-in'} ${voided.movementNo}: ${reason}`,
      metadata: {
        posOpeningEntryId: shift.id,
        posProfileId: shift.posProfileId,
        reason,
        approvedBy: approverId,
        before: { status: before.status, amount: before.amount, type: before.type, category: before.category },
        after: { status: voided.status },
      },
    })
    return NextResponse.json(voided)
  } catch (error) {
    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    if (error instanceof Error && error.name === 'GLValidationError') {
      return NextResponse.json({ error: `The GL posting could not be reversed: ${error.message}`, code: 'GL_REVERSAL_FAILED' }, { status: 400 })
    }
    logError('api/pos-cash-movements/[id]/void', error)
    return NextResponse.json({ error: 'Failed to void cash movement' }, { status: 500 })
  }
}

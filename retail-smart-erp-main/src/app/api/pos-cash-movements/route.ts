import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db as rawDb, withTenant, withTenantTransaction } from '@/lib/db'
import { posOpeningEntries, tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { createPosCashMovementSchema, posCashMovementListSchema } from '@/lib/validation/schemas/pos'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { logActivity } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import { roundCurrency } from '@/lib/utils/currency'
import { ApprovalError, type ApprovalScope } from '@/lib/auth/approval-token'
import {
  CASH_MOVEMENT_CATEGORY_LABELS, DEFAULT_PAID_IN_APPROVAL_THRESHOLD, listShiftCashMovements, shiftCashMovementTotals,
} from '@/lib/pos/shift-report'
import { recordCashMovement } from '@/lib/pos/cash-movement'

// GET /api/pos-cash-movements?openingEntryId=… — paid-ins / paid-outs of a shift
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const parsed = validateSearchParams(request, posCashMovementListSchema)
    if (!parsed.success) return parsed.response
    const { openingEntryId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const shift = await db.query.posOpeningEntries.findFirst({ where: eq(posOpeningEntries.id, openingEntryId) })
      if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
      if (shift.userId !== session.user.id && !hasPermission(session.user.role, 'manageSales', session.user.tenantId, session.user.customRoleId)) {
        return NextResponse.json({ error: 'You can only view the cash movements of your own shift' }, { status: 403 })
      }
      const [movements, totals] = await Promise.all([
        listShiftCashMovements(db, openingEntryId),
        shiftCashMovementTotals(db, openingEntryId),
      ])
      return NextResponse.json({ data: movements, totals })
    })
  } catch (error) {
    logError('api/pos-cash-movements', error)
    return NextResponse.json({ error: 'Failed to fetch cash movements' }, { status: 500 })
  }
}

/**
 * POST /api/pos-cash-movements — cash paid into / out of the drawer of an open shift.
 * Paid-outs (and paid-ins at or above the approval threshold) need a supervisor approval token
 * (POST /api/auth/verify-pin, scope cash_paid_out / cash_paid_in) unless the user has manageSales.
 * Paid-outs cannot exceed the cash the drawer should hold. Posted to the GL (pos_cash_movement).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createPosCashMovementSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    const userId = session.user.id
    const isSupervisor = hasPermission(session.user.role, 'manageSales', tenantId, session.user.customRoleId)
    const amount = roundCurrency(body.amount)

    // tenants is a platform table (no RLS): readable from the plain connection
    const [tenantRow] = await rawDb.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    const posSettings = ((tenantRow?.settings as Record<string, unknown> | null)?.pos || {}) as Record<string, unknown>
    const paidInThreshold = Number(posSettings.paidInApprovalThreshold) > 0 ? Number(posSettings.paidInApprovalThreshold) : DEFAULT_PAID_IN_APPROVAL_THRESHOLD

    const needed: ApprovalScope[] = []
    if (body.type === 'paid_out') needed.push('cash_paid_out')
    if (body.type === 'paid_in' && amount >= paidInThreshold) needed.push('cash_paid_in')
    const result = await withTenantTransaction(tenantId, async (db) => {
      const r = await recordCashMovement(db, {
        tenantId,
        userId,
        isSupervisor,
        openingEntryId: body.openingEntryId,
        type: body.type,
        category: body.category,
        amount,
        accountId: body.accountId || null,
        note: body.note || null,
        needed,
        approvalToken: body.approvalToken,
        approvalMessage: body.type === 'paid_out'
          ? 'A supervisor must approve cash paid out of the drawer'
          : `A supervisor must approve cash paid in of ${paidInThreshold} or more`,
      })
      if ('failure' in r) return { error: NextResponse.json(r.failure.body, { status: r.failure.status }) }
      return { movement: r.movement, shift: r.shift }
    })

    if ('error' in result) return result.error
    const { movement, shift } = result
    broadcastChange(tenantId, 'pos-shift', 'updated', shift.id)
    void logActivity({
      tenantId,
      userId,
      action: 'create',
      entityType: 'pos_cash_movement',
      entityId: movement.id,
      entityName: movement.movementNo,
      description: `Cash ${movement.type === 'paid_out' ? 'paid out' : 'paid in'} ${amount.toFixed(2)} (${CASH_MOVEMENT_CATEGORY_LABELS[movement.category] || movement.category}) on shift ${shift.entryNumber}`,
      metadata: {
        posOpeningEntryId: shift.id,
        posProfileId: shift.posProfileId,
        type: movement.type,
        category: movement.category,
        amount,
        accountId: movement.accountId,
        note: movement.note,
        approvedBy: movement.approvedBy,
        after: { status: movement.status },
      },
    })
    return NextResponse.json(movement)
  } catch (error) {
    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('GL_ACCOUNTS_MISSING:') || (error instanceof Error && error.name === 'GLValidationError')) {
      return NextResponse.json({ error: message.replace('GL_ACCOUNTS_MISSING: ', ''), code: 'GL_POSTING_FAILED' }, { status: 400 })
    }
    logError('api/pos-cash-movements', error)
    return NextResponse.json({ error: 'Failed to record cash movement' }, { status: 500 })
  }
}

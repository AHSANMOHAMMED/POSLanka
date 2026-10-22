import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db as rawDb, withTenant, withTenantTransaction } from '@/lib/db'
import { posCashMovements, posOpeningEntries, posOpeningBalances, posProfiles, tenants } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { createPosCashMovementSchema, posCashMovementListSchema } from '@/lib/validation/schemas/pos'
import { postPosCashMovementToGL } from '@/lib/accounting/auto-post'
import { tenantToday } from '@/lib/accounting/gl'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { logActivity } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import {
  ApprovalError, consumeApprovals, coverScopes, verifyApprovalTokens, type ApprovalScope,
} from '@/lib/auth/approval-token'
import {
  CASH_MOVEMENT_CATEGORY_LABELS, DEFAULT_PAID_IN_APPROVAL_THRESHOLD, listShiftCashMovements, shiftCashMovementTotals,
} from '@/lib/pos/shift-report'

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

    const result = await withTenantTransaction(tenantId, async (db) => {
      // Row lock: movements of one shift are numbered and checked against the drawer one at a time
      const [shift] = await db.select().from(posOpeningEntries)
        .where(eq(posOpeningEntries.id, body.openingEntryId))
        .for('update')
      if (!shift) return { error: NextResponse.json({ error: 'Shift not found' }, { status: 404 }) }
      if (shift.status !== 'open') {
        return { error: NextResponse.json({ error: 'Cash can only be paid in or out during an open shift', code: 'SHIFT_NOT_OPEN' }, { status: 400 }) }
      }
      if (shift.userId !== userId && !isSupervisor) {
        return { error: NextResponse.json({ error: 'You can only record cash movements on your own shift', code: 'SHIFT_NOT_YOURS' }, { status: 403 }) }
      }

      // Supervisor approval
      const needed: ApprovalScope[] = []
      if (body.type === 'paid_out') needed.push('cash_paid_out')
      if (body.type === 'paid_in' && amount >= paidInThreshold) needed.push('cash_paid_in')
      const approvals = isSupervisor ? [] : verifyApprovalTokens(body.approvalToken ? [body.approvalToken] : [], { tenantId, requesterId: session.user.id })
      const cover = coverScopes(needed, approvals)
      if (!isSupervisor && cover.missing.length > 0) {
        return {
          error: NextResponse.json({
            error: body.type === 'paid_out'
              ? 'A supervisor must approve cash paid out of the drawer'
              : `A supervisor must approve cash paid in of ${paidInThreshold} or more`,
            code: 'APPROVAL_REQUIRED',
            scopes: cover.missing,
          }, { status: 403 }),
        }
      }

      // A paid-out cannot take more than the drawer should hold
      if (body.type === 'paid_out') {
        const [opening] = await db.select({ amount: sql<string>`COALESCE(SUM(${posOpeningBalances.openingAmount}), 0)` })
          .from(posOpeningBalances)
          .where(and(eq(posOpeningBalances.openingEntryId, shift.id), eq(posOpeningBalances.paymentMethod, 'cash')))
        const cashRows = await db.execute(sql`
          SELECT COALESCE(SUM(CASE WHEN s.is_return THEN -ABS(p.amount) ELSE ABS(p.amount) END), 0) AS cash
          FROM payments p JOIN sales s ON s.id = p.sale_id
          WHERE s.pos_opening_entry_id = ${shift.id} AND s.status <> 'void' AND p.method = 'cash'`)
        const salesCash = parseCurrency(((cashRows as unknown as { rows?: Array<{ cash: string }> }).rows || [])[0]?.cash)
        const movements = await shiftCashMovementTotals(db, shift.id)
        const drawer = roundCurrency(parseCurrency(opening?.amount) + salesCash + movements.net)
        if (amount > drawer + 0.001) {
          return {
            error: NextResponse.json({
              error: `Only ${drawer.toFixed(2)} should be in the drawer; cannot pay out ${amount.toFixed(2)}`,
              code: 'INSUFFICIENT_DRAWER_CASH',
              drawerCash: drawer,
            }, { status: 400 }),
          }
        }
      }

      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(posCashMovements)
        .where(eq(posCashMovements.openingEntryId, shift.id))
      const movementNo = `${shift.entryNumber}-CM${String(n + 1).padStart(2, '0')}`
      const approvedBy = cover.used[0]?.approverId || (isSupervisor && needed.length > 0 ? userId : null)

      const [movement] = await db.insert(posCashMovements).values({
        tenantId,
        movementNo,
        openingEntryId: shift.id,
        posProfileId: shift.posProfileId,
        type: body.type,
        category: body.category,
        amount: String(amount),
        accountId: body.accountId || null,
        note: body.note || null,
        createdBy: userId,
        approvedBy,
      }).returning()

      if (cover.used.length > 0) {
        await consumeApprovals(db, {
          tenantId, usedBy: userId, entityType: 'pos_cash_movement', entityId: movement.id,
          approvals: cover.used, scopesFor: (a) => needed.filter((s) => a.scopes.includes(s)),
        })
      }

      const profile = await db.query.posProfiles.findFirst({ where: eq(posProfiles.id, shift.posProfileId), columns: { costCenterId: true } })
      await postPosCashMovementToGL(db, tenantId, {
        movementId: movement.id,
        movementNo,
        postingDate: await tenantToday(tenantId),
        type: body.type,
        category: body.category,
        amount,
        accountId: body.accountId || null,
        costCenterId: profile?.costCenterId || null,
        notes: `${movementNo} ${CASH_MOVEMENT_CATEGORY_LABELS[body.category] || body.category}${body.note ? `: ${body.note}` : ''}`,
      })

      return { movement, shift }
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

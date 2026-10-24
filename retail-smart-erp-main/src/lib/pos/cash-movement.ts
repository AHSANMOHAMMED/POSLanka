/**
 * Drawer cash movements (paid in / paid out) of an open POS shift — shared by
 * POST /api/pos-cash-movements and the expenses flow (K1: an expense / reimbursement paid from
 * the drawer is a paid-out with category petty_expense).
 *
 * Runs inside the caller's transaction: locks the shift, checks it is open and the caller's
 * (or the caller supervises), spends the supervisor approval for the `needed` scopes, refuses a
 * paid-out larger than the drawer should hold, numbers the movement and posts it to the GL.
 */
import { and, eq, sql } from 'drizzle-orm'
import { posCashMovements, posOpeningBalances, posOpeningEntries, posProfiles } from '@/lib/db/schema'
import { postPosCashMovementToGL } from '@/lib/accounting/auto-post'
import { tenantToday } from '@/lib/accounting/gl'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { consumeApprovals, coverScopes, verifyApprovalTokens, type ApprovalScope } from '@/lib/auth/approval-token'
import { CASH_MOVEMENT_CATEGORY_LABELS, shiftCashMovementTotals } from '@/lib/pos/shift-report'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export type CashMovement = typeof posCashMovements.$inferSelect
export type PosShift = typeof posOpeningEntries.$inferSelect

export interface CashMovementFailure {
  status: number
  body: { error: string; code?: string; scopes?: ApprovalScope[]; drawerCash?: number }
}

export interface RecordCashMovementInput {
  tenantId: string
  userId: string
  isSupervisor: boolean
  openingEntryId: string
  type: 'paid_in' | 'paid_out'
  category: string
  amount: number
  accountId?: string | null
  note?: string | null
  /** approval scopes this movement needs (empty = none) */
  needed: ApprovalScope[]
  approvalToken?: string | null
  /** message when the approval is missing */
  approvalMessage?: string
  /** entity the approval is spent on (default the movement) */
  approvalEntity?: { type: string; id: string | null }
}

/** Cash the drawer of a shift should hold now (opening + cash sales − refunds ± movements). */
export async function expectedDrawerCash(tx: Tx, shiftId: string): Promise<number> {
  const [opening] = await tx.select({ amount: sql<string>`COALESCE(SUM(${posOpeningBalances.openingAmount}), 0)` })
    .from(posOpeningBalances)
    .where(and(eq(posOpeningBalances.openingEntryId, shiftId), eq(posOpeningBalances.paymentMethod, 'cash')))
  const cashRows = await tx.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN s.is_return THEN -ABS(p.amount) ELSE ABS(p.amount) END), 0) AS cash
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE s.pos_opening_entry_id = ${shiftId} AND s.status <> 'void' AND p.method = 'cash' AND p.voided_at IS NULL`)
  const salesCash = parseCurrency(((cashRows as unknown as { rows?: Array<{ cash: string }> }).rows || [])[0]?.cash)
  const movements = await shiftCashMovementTotals(tx, shiftId)
  return roundCurrency(parseCurrency(opening?.amount) + salesCash + movements.net)
}

export async function recordCashMovement(tx: Tx, input: RecordCashMovementInput): Promise<
  { movement: CashMovement; shift: PosShift; approvedBy: string | null } | { failure: CashMovementFailure }
> {
  const amount = roundCurrency(input.amount)
  // Row lock: movements of one shift are numbered and checked against the drawer one at a time
  const [shift] = await tx.select().from(posOpeningEntries).where(eq(posOpeningEntries.id, input.openingEntryId)).for('update')
  if (!shift) return { failure: { status: 404, body: { error: 'Shift not found' } } }
  if (shift.status !== 'open') {
    return { failure: { status: 400, body: { error: 'Cash can only be paid in or out during an open shift', code: 'SHIFT_NOT_OPEN' } } }
  }
  if (shift.userId !== input.userId && !input.isSupervisor) {
    return { failure: { status: 403, body: { error: 'You can only record cash movements on your own shift', code: 'SHIFT_NOT_YOURS' } } }
  }

  const approvals = input.isSupervisor ? [] : verifyApprovalTokens(input.approvalToken ? [input.approvalToken] : [], { tenantId: input.tenantId, requesterId: input.userId })
  const cover = coverScopes(input.needed, approvals)
  if (!input.isSupervisor && cover.missing.length > 0) {
    return {
      failure: {
        status: 403,
        body: { error: input.approvalMessage || 'A supervisor must approve this cash movement', code: 'APPROVAL_REQUIRED', scopes: cover.missing },
      },
    }
  }

  if (input.type === 'paid_out') {
    const drawer = await expectedDrawerCash(tx, shift.id)
    if (amount > drawer + 0.001) {
      return {
        failure: {
          status: 400,
          body: {
            error: `Only ${drawer.toFixed(2)} should be in the drawer; cannot pay out ${amount.toFixed(2)}`,
            code: 'INSUFFICIENT_DRAWER_CASH',
            drawerCash: drawer,
          },
        },
      }
    }
  }

  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(posCashMovements)
    .where(eq(posCashMovements.openingEntryId, shift.id))
  const movementNo = `${shift.entryNumber}-CM${String(n + 1).padStart(2, '0')}`
  const approvedBy = cover.used[0]?.approverId || (input.isSupervisor && input.needed.length > 0 ? input.userId : null)

  const [movement] = await tx.insert(posCashMovements).values({
    tenantId: input.tenantId,
    movementNo,
    openingEntryId: shift.id,
    posProfileId: shift.posProfileId,
    type: input.type,
    category: input.category,
    amount: String(amount),
    accountId: input.accountId || null,
    note: input.note || null,
    createdBy: input.userId,
    approvedBy,
  }).returning()

  if (cover.used.length > 0) {
    await consumeApprovals(tx, {
      tenantId: input.tenantId,
      usedBy: input.userId,
      entityType: input.approvalEntity?.type || 'pos_cash_movement',
      entityId: input.approvalEntity ? input.approvalEntity.id : movement.id,
      approvals: cover.used,
      scopesFor: (a) => input.needed.filter((s) => a.scopes.includes(s)),
    })
  }

  const profile = await tx.query.posProfiles.findFirst({ where: eq(posProfiles.id, shift.posProfileId), columns: { costCenterId: true } })
  await postPosCashMovementToGL(tx, input.tenantId, {
    movementId: movement.id,
    movementNo,
    postingDate: await tenantToday(input.tenantId),
    type: input.type,
    category: input.category,
    amount,
    accountId: input.accountId || null,
    costCenterId: profile?.costCenterId || null,
    notes: `${movementNo} ${CASH_MOVEMENT_CATEGORY_LABELS[input.category] || input.category}${input.note ? `: ${input.note}` : ''}`,
  })

  return { movement, shift, approvedBy }
}

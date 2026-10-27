import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { cheques, installmentPayments, installmentPlans, sales, tenants, users, warehouses } from '@/lib/db/schema'
import { assertBranchAccess, assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateInstallmentPlanSchema } from '@/lib/validation/schemas/installments'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { tenantToday } from '@/lib/accounting/gl'
import { settlementQuote } from '@/lib/installments/schedule'
import {
  InstallmentError, assessLateFees, cancelPlan, loadSchedule, planFigures, repossessPlan, syncBouncedCheques, toLiveRow,
} from '@/lib/installments/service'
import { installmentErrorResponse } from '@/lib/installments/errors'
import { INSTALLMENT_MANAGE, INSTALLMENT_TAKE, INSTALLMENT_VIEW, requireAny } from '@/lib/installments/access'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/installments/[id]?rebate=50 — plan, schedule (late fees assessed to today), receipts,
 * figures (outstanding, overdue, next due) and the early settlement quote.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, INSTALLMENT_VIEW)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const rebateParam = Number(request.nextUrl.searchParams.get('rebate'))
    const rebate = Number.isFinite(rebateParam) && request.nextUrl.searchParams.has('rebate') ? Math.min(100, Math.max(0, rebateParam)) : 50
    const today = await tenantToday(session.user.tenantId)

    // a transaction: assessing late fees writes the schedule
    return await withTenantTransaction(session.user.tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, installmentPlans, id)
      if (branchDenied) return branchDenied
      // a cheque bounced in the cheques register un-pays its receipt
      await syncBouncedCheques(db, session.user.tenantId, id)
      const [plan] = await db.select().from(installmentPlans).where(eq(installmentPlans.id, id))
      if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      const rows = await assessLateFees(db, plan, await loadSchedule(db, id), today)
      const live = rows.map(toLiveRow)
      const [receipts, [extra]] = await Promise.all([
        db.select({
          id: installmentPayments.id, receiptNo: installmentPayments.receiptNo, kind: installmentPayments.kind,
          paymentDate: installmentPayments.paymentDate, amount: installmentPayments.amount,
          principalAmount: installmentPayments.principalAmount, interestAmount: installmentPayments.interestAmount,
          lateFeeAmount: installmentPayments.lateFeeAmount, rebateAmount: installmentPayments.rebateAmount,
          paymentMethod: installmentPayments.paymentMethod, reference: installmentPayments.reference,
          allocations: installmentPayments.allocations, notes: installmentPayments.notes,
          receivedByName: users.fullName, createdAt: installmentPayments.createdAt,
          voidedAt: installmentPayments.voidedAt, voidReason: installmentPayments.voidReason,
          chequeId: installmentPayments.chequeId, chequeNo: cheques.chequeNo, chequeBank: cheques.bankName,
          chequeDate: cheques.chequeDate, chequeStatus: cheques.status,
        })
          .from(installmentPayments)
          .leftJoin(users, eq(users.id, installmentPayments.receivedBy))
          .leftJoin(cheques, eq(cheques.id, installmentPayments.chequeId))
          .where(eq(installmentPayments.planId, id))
          .orderBy(asc(installmentPayments.createdAt)),
        db.select({
          invoiceNo: sales.invoiceNo, warehouseName: warehouses.name, createdByName: users.fullName,
        })
          .from(installmentPlans)
          .leftJoin(sales, eq(sales.id, installmentPlans.saleId))
          .leftJoin(warehouses, eq(warehouses.id, installmentPlans.warehouseId))
          .leftJoin(users, eq(users.id, installmentPlans.createdBy))
          .where(eq(installmentPlans.id, id)),
      ])
      const [company] = await db.select({ name: tenants.name, phone: tenants.phone, address: tenants.address, email: tenants.email })
        .from(tenants).where(eq(tenants.id, session.user.tenantId))
      return NextResponse.json({
        plan: { ...plan, invoiceNo: extra?.invoiceNo ?? null, warehouseName: extra?.warehouseName ?? null, createdByName: extra?.createdByName ?? null },
        schedule: rows,
        receipts,
        figures: planFigures(live, today),
        settlement: ['active', 'defaulted'].includes(plan.status) ? { rebatePercent: rebate, ...settlementQuote(live, today, rebate) } : null,
        today,
        company: company ?? null,
      })
    })
  } catch (error) {
    logError('api/installments/[id] GET', error)
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 })
  }
}

const TRANSITIONS: Record<string, { from: string[]; to: 'cancelled' | 'defaulted' | 'repossessed' | 'active' }> = {
  cancel: { from: ['active', 'defaulted'], to: 'cancelled' },
  default: { from: ['active'], to: 'defaulted' },
  repossess: { from: ['active', 'defaulted'], to: 'repossessed' },
  reactivate: { from: ['defaulted'], to: 'active' },
}

/**
 * PATCH /api/installments/[id] — update contact / guarantor / notes (counter staff), or change the
 * status: cancel, mark defaulted, repossessed, reactivate a defaulted plan (managers).
 * repossess: { returnToStock, returnWarehouseId?, condition: good | used | damaged,
 * recoveredValue?, writeOff } — goods back into stock with their serials, the balance cleared by
 * the goods and optionally written off to Bad Debts (src/lib/installments/service repossessPlan).
 * cancel of a hand-registered plan reverses its receivable (only without installment receipts).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const parsed = await validateBody(request, updateInstallmentPlanSchema)
    if (!parsed.success) return parsed.response
    const { action, reason, ...fields } = parsed.data
    const denied = requireAny(session, action === 'update' ? INSTALLMENT_TAKE : INSTALLMENT_MANAGE)
    if (denied) return denied
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)
    const today = await tenantToday(tenantId)

    const result = await withTenantTransaction(session.user.tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, installmentPlans, id)
      if (branchDenied) return { response: branchDenied }
      const [plan] = await db.select().from(installmentPlans).where(eq(installmentPlans.id, id)).for('update')
      if (!plan) throw new InstallmentError('Plan not found', 404)
      const now = new Date()
      if (action === 'update') {
        const set: Partial<typeof installmentPlans.$inferInsert> = { updatedAt: now }
        if (fields.customerPhone !== undefined) set.customerPhone = fields.customerPhone || null
        if (fields.customerAddress !== undefined) set.customerAddress = fields.customerAddress || null
        if (fields.guarantorName !== undefined) set.guarantorName = fields.guarantorName || null
        if (fields.guarantorNic !== undefined) set.guarantorNic = fields.guarantorNic || null
        if (fields.guarantorPhone !== undefined) set.guarantorPhone = fields.guarantorPhone || null
        if (fields.guarantorAddress !== undefined) set.guarantorAddress = fields.guarantorAddress || null
        if (fields.notes !== undefined) set.notes = fields.notes || null
        if (fields.agreementTerms !== undefined) set.terms = fields.agreementTerms || null
        const [row] = await db.update(installmentPlans).set(set).where(eq(installmentPlans.id, id)).returning()
        return { plan: row, label: 'Updated' }
      }
      const t = TRANSITIONS[action]
      if (!t.from.includes(plan.status)) throw new InstallmentError(`A ${plan.status} plan cannot be ${t.to === 'active' ? 'reactivated' : `marked ${t.to}`}`)
      if (action !== 'reactivate' && !reason) throw new InstallmentError('Give a reason')
      if (action === 'cancel') {
        const row = await cancelPlan(db, tenantId, plan, { reason: reason!, date: today, userId })
        return { plan: row, label: 'Cancelled' }
      }
      if (action === 'repossess') {
        await syncBouncedCheques(db, tenantId, id)
        const [fresh] = await db.select().from(installmentPlans).where(eq(installmentPlans.id, id)).for('update')
        if (!t.from.includes(fresh.status)) throw new InstallmentError(`A ${fresh.status} plan cannot be marked repossessed`)
        const target = fields.returnToStock ? (fields.returnWarehouseId || fresh.warehouseId) : null
        if (fields.returnToStock) {
          // the goods go into a branch the user works in
          const whDenied = await assertBranchAccess(session, target, db, { requireBranch: true })
          if (whDenied) return { response: whDenied }
          if (target) {
            const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, target))
            if (!w) throw new InstallmentError('Warehouse not found', 404)
          }
        }
        const out = await repossessPlan(db, tenantId, fresh, {
          reason: reason!, date: today, userId,
          returnToStock: fields.returnToStock, warehouseId: target, condition: fields.condition,
          recoveredValue: fields.recoveredValue ?? null, writeOff: fields.writeOff,
        })
        return { plan: out.plan, label: 'Marked repossessed', repossession: out.repossession }
      }
      const [row] = await db.update(installmentPlans).set({
        status: t.to,
        statusReason: reason || null,
        closedAt: t.to === 'cancelled' || t.to === 'repossessed' ? now : null,
        updatedAt: now,
      }).where(eq(installmentPlans.id, id)).returning()
      return { plan: row, label: t.to === 'active' ? 'Reactivated' : `Marked ${t.to}` }
    })
    if ('response' in result) return result.response
    logAndBroadcast(session.user.tenantId, 'installment-plan', 'updated', id, {
      userId: session.user.id,
      entityName: result.plan.planNo,
      description: `${result.label} hire purchase plan ${result.plan.planNo}`,
    })
    return NextResponse.json(result.plan)
  } catch (error) {
    const known = installmentErrorResponse(error)
    if (known) return known
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/installments/[id] PATCH', error)
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
  }
}

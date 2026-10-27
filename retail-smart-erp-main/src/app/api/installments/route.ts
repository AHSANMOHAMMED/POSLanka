import { NextRequest, NextResponse } from 'next/server'
import { and, desc, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { customers, installmentPlans, installmentSchedule, items as itemsTable, sales, warehouses } from '@/lib/db/schema'
import { assertBranchAccess, branchFilter, getBranchScope } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createInstallmentPlanSchema, installmentsListSchema } from '@/lib/validation/schemas/installments'
import { escapeLikePattern } from '@/lib/utils/sql'
import { nextDocNo } from '@/lib/documents/numbering'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { tenantToday } from '@/lib/accounting/gl'
import { calculatePlan, round2 } from '@/lib/installments/schedule'
import { InstallmentError, activePlanForSale, recordManualPlanOpening, syncBouncedCheques } from '@/lib/installments/service'
import { installmentErrorResponse } from '@/lib/installments/errors'
import { INSTALLMENT_TAKE, INSTALLMENT_VIEW, requireAny } from '@/lib/installments/access'

/**
 * GET /api/installments — hire purchase plans (view=plans), or schedule rows due today
 * (view=due) / overdue (view=overdue) with days overdue. Branch-scoped by the plan's branch.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, INSTALLMENT_VIEW)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const parsed = validateSearchParams(request, installmentsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, status, view, customerId, saleId } = parsed.data
    const today = await tenantToday(session.user.tenantId)

    return await withTenant(session.user.tenantId, async (db) => {
      // cheques bounced in the cheques register un-pay their receipts (src/lib/installments/service)
      await syncBouncedCheques(db, session.user.tenantId, null)
      const scope = await getBranchScope(session, db)
      const conds: SQL[] = []
      const branchCond = branchFilter(scope, installmentPlans.warehouseId)
      if (branchCond) conds.push(branchCond)
      if (customerId) conds.push(eq(installmentPlans.customerId, customerId))
      if (saleId) conds.push(eq(installmentPlans.saleId, saleId))
      if (search) {
        const like = `%${escapeLikePattern(search)}%`
        const digits = search.replace(/\D/g, '')
        const ors: SQL[] = [
          ilike(installmentPlans.planNo, like),
          ilike(installmentPlans.customerName, like),
          ilike(installmentPlans.customerNic, like),
          sql`${installmentPlans.items}::text ILIKE ${like}`,
          sql`EXISTS (SELECT 1 FROM sales s WHERE s.id = ${installmentPlans.saleId} AND s.invoice_no ILIKE ${like})`,
        ]
        if (digits.length >= 6) ors.push(sql`regexp_replace(coalesce(${installmentPlans.customerPhone}, ''), '\\D', '', 'g') LIKE ${'%' + digits.slice(-9) + '%'}`)
        conds.push(or(...ors)!)
      }

      if (view === 'due' || view === 'overdue') {
        conds.push(sql`${installmentPlans.status} IN ('active', 'defaulted')`)
        conds.push(sql`${installmentSchedule.status} IN ('pending', 'partial')`)
        conds.push(view === 'due' ? sql`${installmentSchedule.dueDate} = ${today}::date` : sql`${installmentSchedule.dueDate} < ${today}::date`)
        const where = and(...conds)
        const [rows, [{ n }]] = await Promise.all([
          db.select({
            scheduleId: installmentSchedule.id,
            planId: installmentPlans.id,
            planNo: installmentPlans.planNo,
            customerName: installmentPlans.customerName,
            customerPhone: installmentPlans.customerPhone,
            customerNic: installmentPlans.customerNic,
            guarantorName: installmentPlans.guarantorName,
            guarantorPhone: installmentPlans.guarantorPhone,
            planStatus: installmentPlans.status,
            installmentNo: installmentSchedule.installmentNo,
            dueDate: installmentSchedule.dueDate,
            amount: installmentSchedule.amount,
            paidAmount: installmentSchedule.paidAmount,
            lateFee: installmentSchedule.lateFee,
            lateFeePaid: installmentSchedule.lateFeePaid,
            daysOverdue: sql<number>`GREATEST(0, ${today}::date - ${installmentSchedule.dueDate})::int`,
            planBalance: installmentPlans.balance,
            warehouseName: warehouses.name,
          })
            .from(installmentSchedule)
            .innerJoin(installmentPlans, eq(installmentPlans.id, installmentSchedule.planId))
            .leftJoin(warehouses, eq(warehouses.id, installmentPlans.warehouseId))
            .where(where)
            .orderBy(asc(installmentSchedule.dueDate), asc(installmentPlans.planNo))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
          db.select({ n: sql<number>`count(*)::int` })
            .from(installmentSchedule)
            .innerJoin(installmentPlans, eq(installmentPlans.id, installmentSchedule.planId))
            .where(where),
        ])
        return NextResponse.json({ data: rows, today, pagination: { page, pageSize, total: n, totalPages: Math.ceil(n / pageSize) } })
      }

      if (status && status !== 'all') conds.push(eq(installmentPlans.status, status))
      const where = conds.length ? and(...conds) : undefined
      const [rows, [{ n }], counts] = await Promise.all([
        db.select({
          id: installmentPlans.id,
          planNo: installmentPlans.planNo,
          saleId: installmentPlans.saleId,
          invoiceNo: sales.invoiceNo,
          customerName: installmentPlans.customerName,
          customerPhone: installmentPlans.customerPhone,
          customerNic: installmentPlans.customerNic,
          items: installmentPlans.items,
          cashPrice: installmentPlans.cashPrice,
          downPayment: installmentPlans.downPayment,
          totalPayable: installmentPlans.totalPayable,
          installmentAmount: installmentPlans.installmentAmount,
          installmentCount: installmentPlans.installmentCount,
          frequency: installmentPlans.frequency,
          paidAmount: installmentPlans.paidAmount,
          balance: installmentPlans.balance,
          status: installmentPlans.status,
          startDate: installmentPlans.startDate,
          createdAt: installmentPlans.createdAt,
          warehouseName: warehouses.name,
          nextDueDate: sql<string | null>`(SELECT min(s.due_date)::text FROM installment_schedule s WHERE s.plan_id = ${installmentPlans.id} AND s.status IN ('pending', 'partial'))`,
          overdueCount: sql<number>`(SELECT count(*)::int FROM installment_schedule s WHERE s.plan_id = ${installmentPlans.id} AND s.status IN ('pending', 'partial') AND s.due_date < ${today}::date)`,
        })
          .from(installmentPlans)
          .leftJoin(sales, eq(sales.id, installmentPlans.saleId))
          .leftJoin(warehouses, eq(warehouses.id, installmentPlans.warehouseId))
          .where(where)
          .orderBy(desc(installmentPlans.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: sql<number>`count(*)::int` }).from(installmentPlans).where(where),
        db.select({ status: installmentPlans.status, count: sql<number>`count(*)::int` })
          .from(installmentPlans).where(branchCond).groupBy(installmentPlans.status),
      ])
      return NextResponse.json({
        data: rows,
        today,
        counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
        pagination: { page, pageSize, total: n, totalPages: Math.ceil(n / pageSize) },
      })
    })
  } catch (error) {
    logError('api/installments GET', error)
    return NextResponse.json({ error: 'Failed to load installment plans' }, { status: 500 })
  }
}

/**
 * POST /api/installments — create a hire purchase plan. From a sale (saleId): the branch,
 * customer and goods come from the sale and the plan finances the sale's open balance (cash
 * price = sale total, down payment = what was paid at the counter). Without a sale: an agreement
 * registered by hand (goods typed in; no stock or ledger postings), optionally taking the down
 * payment now.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, INSTALLMENT_TAKE)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = await validateBody(request, createInstallmentPlanSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId

    const quotaError = await requireQuota(tenantId, 'standard')
    if (quotaError) return quotaError
    const userId = await resolveUserIdRequired(session)
    const today = await tenantToday(tenantId)

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const scope = await getBranchScope(session, tx)
      let warehouseId = body.warehouseId || null
      let customerId = body.customerId || null
      const terms = { ...body.terms }

      if (body.saleId) {
        const [sale] = await tx.select().from(sales).where(eq(sales.id, body.saleId)).for('update')
        if (!sale) throw new InstallmentError('Sale not found', 404)
        if (sale.status === 'void' || sale.isReturn) throw new InstallmentError('A void sale or a return cannot go on hire purchase')
        const balance = round2(Number(sale.total) - Number(sale.paidAmount))
        if (balance <= 0) throw new InstallmentError('This sale is fully paid; nothing to finance')
        if (await activePlanForSale(tx, sale.id)) throw new InstallmentError('This sale already has an active installment plan', 409, 'DUPLICATE')
        warehouseId = sale.warehouseId
        customerId = sale.customerId || customerId
        // the plan finances exactly the sale's open balance
        terms.cashPrice = round2(Number(sale.total))
        terms.downPayment = round2(Number(sale.paidAmount))
      }

      // a hand-registered plan without a branch goes to the user's (first) branch
      if (!warehouseId && scope && scope.length > 0 && !body.saleId) warehouseId = scope[0]
      const branchDenied = await assertBranchAccess(session, warehouseId, tx, { scope, requireBranch: !!scope })
      if (branchDenied) return { response: branchDenied }
      if (warehouseId) {
        const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId))
        if (!w) throw new InstallmentError('Branch not found', 404)
      }
      if (customerId) {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId))
        if (!c) throw new InstallmentError('Customer not found', 404)
      }
      const itemIds = [...new Set(body.items.map((i) => i.itemId).filter((x): x is string => !!x))]
      if (itemIds.length) {
        const found = await tx.select({ id: itemsTable.id }).from(itemsTable).where(sql`${itemsTable.id} IN (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
        if (found.length !== itemIds.length) throw new InstallmentError('One or more items were not found')
      }
      if (terms.downPayment >= terms.cashPrice) throw new InstallmentError('Down payment must be less than the cash price')

      const calc = calculatePlan({
        cashPrice: terms.cashPrice,
        downPayment: terms.downPayment,
        interestType: terms.interestType,
        interestRate: terms.interestRate,
        interestAmount: terms.interestAmount,
        termMonths: terms.termMonths,
        frequency: terms.frequency,
        startDate: terms.startDate,
      })

      const planNo = await nextDocNo(tx, tenantId, 'installment_plan')
      const [plan] = await tx.insert(installmentPlans).values({
        tenantId,
        planNo,
        saleId: body.saleId || null,
        customerId,
        warehouseId,
        customerName: body.customerName,
        customerNic: body.customerNic || null,
        customerPhone: body.customerPhone || null,
        customerAddress: body.customerAddress || null,
        guarantorName: body.guarantorName || null,
        guarantorNic: body.guarantorNic || null,
        guarantorPhone: body.guarantorPhone || null,
        guarantorAddress: body.guarantorAddress || null,
        items: body.items.map((i) => ({
          itemId: i.itemId || null,
          saleItemId: i.saleItemId || null,
          itemName: i.itemName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          serialNumbers: i.serialNumbers || [],
        })),
        cashPrice: String(terms.cashPrice),
        downPayment: String(terms.downPayment),
        financedAmount: String(calc.financedAmount),
        interestType: terms.interestType,
        interestRate: String(terms.interestType === 'flat' ? terms.interestRate : 0),
        interestAmount: String(calc.interestAmount),
        totalPayable: String(calc.totalPayable),
        installmentAmount: String(calc.installmentAmount),
        installmentCount: calc.installmentCount,
        termMonths: terms.termMonths,
        frequency: terms.frequency,
        startDate: terms.startDate,
        lateFeeType: terms.lateFeeType,
        lateFeeValue: String(terms.lateFeeType === 'none' ? 0 : terms.lateFeeValue),
        graceDays: terms.graceDays,
        balance: String(calc.totalPayable),
        status: 'active',
        terms: body.agreementTerms || null,
        notes: body.notes || null,
        openingAgreement: !body.saleId && body.openingAgreement,
        createdBy: userId,
      }).returning()

      await tx.insert(installmentSchedule).values(calc.rows.map((r) => ({
        tenantId,
        planId: plan.id,
        installmentNo: r.installmentNo,
        dueDate: r.dueDate,
        amount: String(r.amount),
        principal: String(r.principal),
        interest: String(r.interest),
      })))

      // Manual plan: its receivable (Dr Installment Receivable / Cr Sales, or Retained Earnings for
      // an opening agreement) and the down payment taken now (a sale's was taken at the till)
      if (!body.saleId) {
        await recordManualPlanOpening(tx, tenantId, plan, {
          today,
          userId,
          downPayment: body.recordDownPayment && terms.downPayment > 0 ? {
            amount: terms.downPayment, method: body.downPaymentMethod, reference: body.downPaymentReference, cheque: body.downPaymentCheque,
          } : null,
        })
      }
      return { plan }
    })

    if ('response' in result) return result.response
    logAndBroadcast(tenantId, 'installment-plan', 'created', result.plan.id, {
      userId: session.user.id,
      entityName: result.plan.planNo,
      description: `Created hire purchase plan ${result.plan.planNo} for ${result.plan.customerName}`,
    })
    return NextResponse.json(result.plan, { status: 201 })
  } catch (error) {
    const known = installmentErrorResponse(error)
    if (known) return known
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/installments POST', error)
    return NextResponse.json({ error: 'Failed to create installment plan' }, { status: 500 })
  }
}

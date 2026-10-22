import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts, payhereTransactionStatusEnum, payhereTransactions, pricingTiers, subscriptions, tenants } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { escapeLikePattern } from '@/lib/utils/sql'
import { isPayhereRefundConfigured } from '@/lib/payhere/refund'

const schema = z.object({
  status: z.preprocess((v) => (v === '' || v === 'all' ? undefined : v), z.enum(payhereTransactionStatusEnum.enumValues).optional()),
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// GET /api/sys-control/payhere-transactions — card payments received through PayHere (paginated, read-only)
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const parsed = validateSearchParams(request, schema)
    if (!parsed.success) return parsed.response
    const { status, q, page, pageSize } = parsed.data

    const conds: SQL[] = []
    if (status) conds.push(eq(payhereTransactions.status, status))
    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`
      conds.push(or(
        ilike(payhereTransactions.orderId, pattern),
        ilike(payhereTransactions.payherePaymentId, pattern),
        ilike(accounts.email, pattern),
        ilike(tenants.name, pattern),
        ilike(tenants.businessId, pattern),
      )!)
    }
    const where = conds.length ? and(...conds) : undefined

    const [rows, [count], totals] = await Promise.all([
      db.select({
        id: payhereTransactions.id,
        orderId: payhereTransactions.orderId,
        payherePaymentId: payhereTransactions.payherePaymentId,
        amount: payhereTransactions.amount,
        currency: payhereTransactions.currency,
        status: payhereTransactions.status,
        paymentMethod: payhereTransactions.paymentMethod,
        description: payhereTransactions.description,
        periodMonths: payhereTransactions.periodMonths,
        billingCycle: payhereTransactions.billingCycle,
        statusMessage: payhereTransactions.statusMessage,
        cardNo: payhereTransactions.cardNo,
        walletCreditApplied: payhereTransactions.walletCreditApplied,
        subscriptionId: payhereTransactions.subscriptionId,
        couponCode: payhereTransactions.couponCode,
        listAmount: payhereTransactions.listAmount,
        discountAmount: payhereTransactions.discountAmount,
        refundStatus: payhereTransactions.refundStatus,
        refundedAmount: payhereTransactions.refundedAmount,
        refundReference: payhereTransactions.refundReference,
        refundReason: payhereTransactions.refundReason,
        refundError: payhereTransactions.refundError,
        refundedAt: payhereTransactions.refundedAt,
        subscriptionStatus: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        paidAt: payhereTransactions.paidAt,
        createdAt: payhereTransactions.createdAt,
        account: { id: accounts.id, email: accounts.email, fullName: accounts.fullName },
        tenant: { id: tenants.id, name: tenants.name, businessId: tenants.businessId },
        newTierName: pricingTiers.displayName,
      })
        .from(payhereTransactions)
        .innerJoin(accounts, eq(accounts.id, payhereTransactions.accountId))
        .leftJoin(subscriptions, eq(subscriptions.id, payhereTransactions.subscriptionId))
        .leftJoin(tenants, eq(tenants.id, subscriptions.tenantId))
        .leftJoin(pricingTiers, eq(pricingTiers.id, payhereTransactions.newTierId))
        .where(where)
        .orderBy(desc(payhereTransactions.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: sql<number>`count(*)::int` })
        .from(payhereTransactions)
        .innerJoin(accounts, eq(accounts.id, payhereTransactions.accountId))
        .leftJoin(subscriptions, eq(subscriptions.id, payhereTransactions.subscriptionId))
        .leftJoin(tenants, eq(tenants.id, subscriptions.tenantId))
        .where(where),
      db.select({
        status: payhereTransactions.status,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${payhereTransactions.amount}), 0)`,
      }).from(payhereTransactions).groupBy(payhereTransactions.status),
    ])

    return NextResponse.json({
      transactions: rows.map((r) => ({ ...r, tenant: r.tenant?.id ? r.tenant : null })),
      pagination: { page, pageSize, total: count?.total ?? 0 },
      statusTotals: Object.fromEntries(totals.map((t) => [t.status, { count: t.count, amount: Number(t.amount) }])),
      refundsConfigured: isPayhereRefundConfigured(),
    })
  } catch (error) {
    logError('api/sys-control/payhere-transactions', error)
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  }
}

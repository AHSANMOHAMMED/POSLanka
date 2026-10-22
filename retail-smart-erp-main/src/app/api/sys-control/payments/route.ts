import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts, paymentDeposits, pendingCompanies, pricingTiers, subscriptions, tenants } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { escapeLikePattern } from '@/lib/utils/sql'

const schema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// GET /api/sys-control/payments — bank-transfer slips (paginated), with what each one pays for
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
    if (status !== 'all') conds.push(eq(paymentDeposits.status, status))
    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`
      conds.push(or(
        ilike(accounts.email, pattern),
        ilike(accounts.fullName, pattern),
        ilike(paymentDeposits.bankReference, pattern),
        ilike(tenants.name, pattern),
        ilike(tenants.businessId, pattern),
        ilike(pendingCompanies.name, pattern),
      )!)
    }
    const where = conds.length ? and(...conds) : undefined

    const [rows, [count], counts] = await Promise.all([
      db.select({
        id: paymentDeposits.id,
        amount: paymentDeposits.amount,
        currency: paymentDeposits.currency,
        bankReference: paymentDeposits.bankReference,
        couponCode: paymentDeposits.couponCode,
        listAmount: paymentDeposits.listAmount,
        discountAmount: paymentDeposits.discountAmount,
        depositDate: paymentDeposits.depositDate,
        receiptUrl: paymentDeposits.receiptUrl,
        notes: paymentDeposits.notes,
        status: paymentDeposits.status,
        reviewedAt: paymentDeposits.reviewedAt,
        reviewNotes: paymentDeposits.reviewNotes,
        periodMonths: paymentDeposits.periodMonths,
        isWalletDeposit: paymentDeposits.isWalletDeposit,
        pendingCompanyId: paymentDeposits.pendingCompanyId,
        subscriptionId: paymentDeposits.subscriptionId,
        createdAt: paymentDeposits.createdAt,
        account: { id: accounts.id, email: accounts.email, fullName: accounts.fullName, phone: accounts.phone },
        tenant: { id: tenants.id, name: tenants.name, slug: tenants.slug, businessId: tenants.businessId },
        subscriptionStatus: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        pendingCompany: { name: pendingCompanies.name, status: pendingCompanies.status, tierName: pricingTiers.displayName },
      })
        .from(paymentDeposits)
        .innerJoin(accounts, eq(accounts.id, paymentDeposits.accountId))
        .leftJoin(subscriptions, eq(subscriptions.id, paymentDeposits.subscriptionId))
        .leftJoin(tenants, eq(tenants.id, subscriptions.tenantId))
        .leftJoin(pendingCompanies, eq(pendingCompanies.id, paymentDeposits.pendingCompanyId))
        .leftJoin(pricingTiers, eq(pricingTiers.id, pendingCompanies.tierId))
        .where(where)
        .orderBy(desc(paymentDeposits.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: sql<number>`count(*)::int` })
        .from(paymentDeposits)
        .innerJoin(accounts, eq(accounts.id, paymentDeposits.accountId))
        .leftJoin(subscriptions, eq(subscriptions.id, paymentDeposits.subscriptionId))
        .leftJoin(tenants, eq(tenants.id, subscriptions.tenantId))
        .leftJoin(pendingCompanies, eq(pendingCompanies.id, paymentDeposits.pendingCompanyId))
        .where(where),
      db.select({ status: paymentDeposits.status, count: sql<number>`count(*)::int` }).from(paymentDeposits).groupBy(paymentDeposits.status),
    ])

    const payments = rows.map((r) => ({
      ...r,
      tenant: r.tenant?.id ? r.tenant : null,
      pendingCompany: r.pendingCompany?.name ? r.pendingCompany : null,
      // Older clients (mobile admin) read the relation shape
      subscription: r.tenant?.id ? { status: r.subscriptionStatus, tenant: r.tenant } : null,
    }))

    return NextResponse.json({
      payments,
      pagination: { page, pageSize, total: count?.total ?? 0 },
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    })
  } catch (error) {
    logError('api/sys-control/payments', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

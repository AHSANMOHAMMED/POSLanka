import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { activityLogs, accountTenants, tenants, users, paymentDeposits, creditTransactions } from '@/lib/db/schema'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/account/activity - Get account activity log across all user's companies
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')

    const accountId = session.user.accountId

    // Get all tenant IDs the user belongs to
    const memberships = await db
      .select({ tenantId: accountTenants.tenantId, tenantName: tenants.name })
      .from(accountTenants)
      .innerJoin(tenants, eq(accountTenants.tenantId, tenants.id))
      .where(and(
        eq(accountTenants.accountId, accountId),
        eq(accountTenants.isActive, true)
      ))

    const tenantIds = memberships.map(m => m.tenantId)
    const tenantNameMap = new Map(memberships.map(m => [m.tenantId, m.tenantName]))

    // Collect activities from multiple sources
    const activities: Array<{
      id: string
      type: string
      action: string
      description: string
      companyName: string | null
      createdAt: Date
      metadata?: unknown
    }> = []

    // 1. Get activity logs from all user's companies
    if (tenantIds.length > 0) {
      // Get user IDs for this account across all tenants
      const userRecords = await db
        .select({ id: users.id, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.accountId, accountId))

      const userIds = userRecords.map(u => u.id)

      if (userIds.length > 0) {
        const logs = await db
          .select()
          .from(activityLogs)
          .where(and(
            inArray(activityLogs.userId, userIds),
            inArray(activityLogs.tenantId, tenantIds)
          ))
          .orderBy(desc(activityLogs.createdAt))
          .limit(limit)

        for (const log of logs) {
          activities.push({
            id: log.id,
            type: log.entityType,
            action: log.action,
            description: log.description || `${log.action} ${log.entityType} ${log.entityName || ''}`,
            companyName: tenantNameMap.get(log.tenantId) || null,
            createdAt: log.createdAt,
            metadata: log.metadata,
          })
        }
      }
    }

    // 2. Get payment deposit activities
    const deposits = await db
      .select()
      .from(paymentDeposits)
      .where(eq(paymentDeposits.accountId, accountId))
      .orderBy(desc(paymentDeposits.createdAt))
      .limit(20)

    for (const deposit of deposits) {
      let description = ''
      if (deposit.isWalletDeposit) {
        description = `Wallet deposit of ${deposit.currency} ${deposit.amount} - ${deposit.status}`
      } else {
        description = `Subscription payment of ${deposit.currency} ${deposit.amount} - ${deposit.status}`
      }

      activities.push({
        id: deposit.id,
        type: 'payment',
        action: deposit.status === 'approved' ? 'approved' : deposit.status === 'rejected' ? 'rejected' : 'submitted',
        description,
        companyName: null,
        createdAt: deposit.createdAt,
        metadata: { amount: deposit.amount, currency: deposit.currency, status: deposit.status },
      })
    }

    // 3. Get wallet transaction activities
    const transactions = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, accountId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(20)

    for (const tx of transactions) {
      activities.push({
        id: tx.id,
        type: 'wallet',
        action: tx.type,
        description: tx.description,
        companyName: null,
        createdAt: tx.createdAt,
        metadata: { amount: tx.amount, currency: tx.currency, balanceAfter: tx.balanceAfter },
      })
    }

    // Sort all activities by date and apply pagination
    activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const paginatedActivities = activities.slice(offset, offset + limit)

    return NextResponse.json({
      activities: paginatedActivities,
      total: activities.length,
      limit,
      offset,
    })
  } catch (error) {
    logError('api/account/activity', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { subscriptions, tenantUsage } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'all'
    const includeUsage = searchParams.get('includeUsage') === 'true'

    const whereClause = status !== 'all'
      ? eq(subscriptions.status, status as 'trial' | 'active' | 'past_due' | 'cancelled' | 'locked')
      : undefined

    const allSubscriptions = await db.query.subscriptions.findMany({
      where: whereClause,
      with: {
        tenant: true,
        tier: true,
        billingAccount: true,
      },
      orderBy: [desc(subscriptions.createdAt)],
    })

    // Optionally include usage data for each subscription
    if (includeUsage) {
      const subsWithUsage = await Promise.all(
        allSubscriptions.map(async (sub) => {
          const usage = await db.query.tenantUsage.findFirst({
            where: eq(tenantUsage.tenantId, sub.tenantId),
          })
          return {
            ...sub,
            usage: usage ? {
              storageBytes: Number(usage.storageBytes),
              fileStorageBytes: Number(usage.fileStorageBytes),
            } : null,
          }
        })
      )
      return NextResponse.json(subsWithUsage)
    }

    return NextResponse.json(allSubscriptions)
  } catch (error) {
    logError('api/sys-control/subscriptions', error)
    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminAuditLogs } from '@/lib/db/schema'
import { desc, and, gte, eq } from 'drizzle-orm'
import { withRateLimit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimited = await withRateLimit('/api/sys-control/audit-logs')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const resource = searchParams.get('resource')
    const days = parseInt(searchParams.get('days') || '7')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)

    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - days)

    const conditions = [gte(adminAuditLogs.createdAt, sinceDate)]

    if (action && action !== 'all') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditions.push(eq(adminAuditLogs.action, action as any))
    }

    if (resource && resource !== 'all') {
      conditions.push(eq(adminAuditLogs.resource, resource))
    }

    const logs = await db.query.adminAuditLogs.findMany({
      where: and(...conditions),
      with: {
        account: {
          columns: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
      orderBy: [desc(adminAuditLogs.createdAt)],
      limit,
    })

    return NextResponse.json(logs)
  } catch (error) {
    logError('api/sys-control/audit-logs', error)
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }
}

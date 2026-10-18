import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { aiAlerts } from '@/lib/db/schema'
import { desc, and, sql, isNull, eq } from 'drizzle-orm'
import { startFullAudit, isAuditRunning } from '@/lib/audit/runner'
import { requirePermission } from '@/lib/auth/roles'

// POST — start a full audit
export async function POST() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = requirePermission(session, 'manageSettings')
  if (denied) return denied

  const tenantId = session.user.tenantId

  if (isAuditRunning(tenantId)) {
    return NextResponse.json({ error: 'Audit already running' }, { status: 409 })
  }

  startFullAudit(tenantId)

  return NextResponse.json({ success: true, message: 'Audit started' })
}

// GET — fetch audit results (paginated, with category filter)
export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '20'), 100)
  const category = searchParams.get('category')
  const severity = searchParams.get('severity')

  return await withTenant(session.user.tenantId, async (db) => {
    const conditions = [
      sql`${aiAlerts.metadata}->>'auditId' IS NOT NULL`,
      isNull(aiAlerts.dismissedAt),
    ]

    if (category) {
      conditions.push(sql`${aiAlerts.metadata}->>'auditCategory' = ${category}`)
    }
    if (severity) {
      conditions.push(eq(aiAlerts.severity, severity as 'low' | 'medium' | 'high' | 'critical'))
    }

    const whereClause = and(...conditions)

    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiAlerts)
      .where(whereClause)

    const results = await db
      .select()
      .from(aiAlerts)
      .where(whereClause)
      .orderBy(desc(aiAlerts.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    // Category summary counts
    const categoryCounts = await db.execute<{ category: string; count: string }>(sql`
      SELECT metadata->>'auditCategory' AS category, COUNT(*)::int AS count
      FROM ai_alerts
      WHERE metadata->>'auditId' IS NOT NULL
        AND dismissed_at IS NULL
      GROUP BY metadata->>'auditCategory'
      ORDER BY count DESC
    `)

    return NextResponse.json({
      data: results,
      categoryCounts: categoryCounts.rows,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    })
  })
}

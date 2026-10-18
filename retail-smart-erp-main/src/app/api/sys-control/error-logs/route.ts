import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { aiErrorLogs, tenants, users } from '@/lib/db/schema'
import { desc, eq, and, sql, isNull } from 'drizzle-orm'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { sysUpdateErrorLogSchema } from '@/lib/validation/schemas/sys-control'

/**
 * GET /api/sys-control/error-logs
 * List ALL error logs (tenant-scoped + system-wide). Sys-control only.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
    const pageSize = Math.min(Math.max(1, parseInt(searchParams.get('pageSize') || '50') || 50), 100)
    const level = searchParams.get('level')
    const source = searchParams.get('source') // system | user_report | frontend
    const resolutionStatus = searchParams.get('resolutionStatus')
    const tenantId = searchParams.get('tenantId') // filter by tenant or 'system' for null
    const includeStats = searchParams.get('includeStats') === 'true'

    const conditions = []

    if (level) {
      conditions.push(eq(aiErrorLogs.level, level as 'error' | 'warning' | 'info'))
    }
    if (source) {
      conditions.push(eq(aiErrorLogs.errorSource, source))
    }
    if (resolutionStatus) {
      conditions.push(eq(aiErrorLogs.resolutionStatus, resolutionStatus))
    }
    if (tenantId === 'system') {
      conditions.push(isNull(aiErrorLogs.tenantId))
    } else if (tenantId) {
      conditions.push(eq(aiErrorLogs.tenantId, tenantId))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiErrorLogs)
      .where(whereClause)

    const logs = await db
      .select({
        id: aiErrorLogs.id,
        tenantId: aiErrorLogs.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        level: aiErrorLogs.level,
        source: aiErrorLogs.source,
        message: aiErrorLogs.message,
        stack: aiErrorLogs.stack,
        context: aiErrorLogs.context,
        aiAnalysis: aiErrorLogs.aiAnalysis,
        aiSuggestion: aiErrorLogs.aiSuggestion,
        groupHash: aiErrorLogs.groupHash,
        resolvedAt: aiErrorLogs.resolvedAt,
        createdAt: aiErrorLogs.createdAt,
        errorSource: aiErrorLogs.errorSource,
        resolutionStatus: aiErrorLogs.resolutionStatus,
        resolutionNotes: aiErrorLogs.resolutionNotes,
        occurrenceCount: aiErrorLogs.occurrenceCount,
        lastOccurredAt: aiErrorLogs.lastOccurredAt,
        reportedUrl: aiErrorLogs.reportedUrl,
        userDescription: aiErrorLogs.userDescription,
        reportedByUserId: aiErrorLogs.reportedByUserId,
        reportedByName: users.fullName,
      })
      .from(aiErrorLogs)
      .leftJoin(tenants, eq(aiErrorLogs.tenantId, tenants.id))
      .leftJoin(users, eq(aiErrorLogs.reportedByUserId, users.id))
      .where(whereClause)
      .orderBy(desc(aiErrorLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    let stats = null
    if (includeStats) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [statsResult] = await db
        .select({
          total24h: sql<number>`count(*) FILTER (WHERE ${aiErrorLogs.createdAt} >= ${twentyFourHoursAgo})::int`,
          unresolvedCount: sql<number>`count(*) FILTER (WHERE COALESCE(${aiErrorLogs.resolutionStatus}, 'open') = 'open')::int`,
          userReportsCount: sql<number>`count(*) FILTER (WHERE ${aiErrorLogs.errorSource} = 'user_report' AND COALESCE(${aiErrorLogs.resolutionStatus}, 'open') = 'open')::int`,
          systemCount: sql<number>`count(*) FILTER (WHERE COALESCE(${aiErrorLogs.errorSource}, 'system') = 'system')::int`,
          systemNullTenantCount: sql<number>`count(*) FILTER (WHERE ${aiErrorLogs.tenantId} IS NULL)::int`,
        })
        .from(aiErrorLogs)
      stats = {
        total24h: statsResult.total24h,
        unresolvedCount: statsResult.unresolvedCount,
        userReportsCount: statsResult.userReportsCount,
        systemCount: statsResult.systemCount,
        systemNullTenantCount: statsResult.systemNullTenantCount,
      }
    }

    return NextResponse.json({
      data: logs,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
      ...(stats ? { stats } : {}),
    })
  } catch (error) {
    logError('api/sys-control/error-logs', error)
    return NextResponse.json({ error: 'Failed to fetch error logs' }, { status: 500 })
  }
}

/**
 * PUT /api/sys-control/error-logs
 * Update resolution status/notes. Sys-control only. Allowed for any log including user-reported.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysUpdateErrorLogSchema)
    if (!parsed.success) return parsed.response
    const { id, resolutionStatus, resolutionNotes } = parsed.data

    const updates: Record<string, unknown> = {}
    if (resolutionStatus !== undefined) {
      updates.resolutionStatus = resolutionStatus
      if (resolutionStatus === 'resolved' || resolutionStatus === 'wont_fix') {
        updates.resolvedAt = new Date()
      } else {
        updates.resolvedAt = null
      }
    }
    if (resolutionNotes !== undefined) {
      updates.resolutionNotes = resolutionNotes
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    await db
      .update(aiErrorLogs)
      .set(updates)
      .where(eq(aiErrorLogs.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/error-logs PUT', error)
    return NextResponse.json({ error: 'Failed to update error log' }, { status: 500 })
  }
}

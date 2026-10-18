import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { aiErrorLogs, users } from '@/lib/db/schema'
import { desc, eq, and, sql, isNull, isNotNull } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { updateErrorLogSchema } from '@/lib/validation/schemas/ai'

export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'manageSettings')
  if (permError) return permError

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
  const pageSize = Math.min(Math.max(1, parseInt(searchParams.get('pageSize') || '50') || 50), 100)
  const level = searchParams.get('level')
  const resolved = searchParams.get('resolved')
  const groupHash = searchParams.get('groupHash')
  const source = searchParams.get('source') // 'system' | 'user_report' | 'frontend'
  const resolutionStatus = searchParams.get('resolutionStatus') // 'open' | 'investigating' | 'resolved' | 'wont_fix'
  const includeStats = searchParams.get('includeStats') === 'true'

  return await withTenant(session.user.tenantId, async (db) => {
    const conditions = []

    if (level) {
      conditions.push(eq(aiErrorLogs.level, level as 'error' | 'warning' | 'info'))
    }

    // Legacy resolved filter (backward compatible)
    if (resolved === 'true') {
      conditions.push(isNotNull(aiErrorLogs.resolvedAt))
    } else if (resolved === 'false') {
      conditions.push(isNull(aiErrorLogs.resolvedAt))
    }

    if (groupHash) {
      conditions.push(eq(aiErrorLogs.groupHash, groupHash))
    }

    if (source) {
      conditions.push(eq(aiErrorLogs.errorSource, source))
    }

    if (resolutionStatus) {
      conditions.push(eq(aiErrorLogs.resolutionStatus, resolutionStatus))
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
      .leftJoin(users, eq(aiErrorLogs.reportedByUserId, users.id))
      .where(whereClause)
      .orderBy(desc(aiErrorLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    // Optionally include stats
    let stats = null
    if (includeStats) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      const [statsResult] = await db
        .select({
          total24h: sql<number>`count(*) FILTER (WHERE ${aiErrorLogs.createdAt} >= ${twentyFourHoursAgo})::int`,
          unresolvedCount: sql<number>`count(*) FILTER (WHERE COALESCE(${aiErrorLogs.resolutionStatus}, 'open') = 'open')::int`,
          userReportsCount: sql<number>`count(*) FILTER (WHERE ${aiErrorLogs.errorSource} = 'user_report' AND COALESCE(${aiErrorLogs.resolutionStatus}, 'open') = 'open')::int`,
          frontendCount: sql<number>`count(*) FILTER (WHERE ${aiErrorLogs.errorSource} = 'frontend' AND ${aiErrorLogs.createdAt} >= ${twentyFourHoursAgo})::int`,
          systemCount: sql<number>`count(*) FILTER (WHERE COALESCE(${aiErrorLogs.errorSource}, 'system') = 'system' AND ${aiErrorLogs.createdAt} >= ${twentyFourHoursAgo})::int`,
        })
        .from(aiErrorLogs)

      stats = {
        total24h: statsResult.total24h,
        unresolvedCount: statsResult.unresolvedCount,
        userReportsCount: statsResult.userReportsCount,
        frontendCount: statsResult.frontendCount,
        systemCount: statsResult.systemCount,
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
  })
}

// Update error resolution status
export async function PUT(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'manageSettings')
  if (permError) return permError

  const parsed = await validateBody(request, updateErrorLogSchema)
  if (!parsed.success) return parsed.response
  const { id, action, resolutionStatus, resolutionNotes } = parsed.data

  return await withTenant(session.user.tenantId, async (db) => {
    // User-reported logs: only sys-control can change status; tenant users cannot change after submit
    const [existing] = await db
      .select({ errorSource: aiErrorLogs.errorSource })
      .from(aiErrorLogs)
      .where(eq(aiErrorLogs.id, id))
    if (existing?.errorSource === 'user_report') {
      return NextResponse.json(
        { error: 'Status and notes for user-reported errors can only be changed from System Control.' },
        { status: 403 }
      )
    }

    // Build a single update object from all inputs
    const updates: Record<string, unknown> = {}

    // Resolve legacy action into resolutionStatus
    const effectiveStatus = resolutionStatus
      || (action === 'resolve' ? 'resolved' : action === 'unresolve' ? 'open' : null)

    if (effectiveStatus) {
      updates.resolutionStatus = effectiveStatus
      if (effectiveStatus === 'resolved' || effectiveStatus === 'wont_fix') {
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

    await db.update(aiErrorLogs)
      .set(updates)
      .where(eq(aiErrorLogs.id, id))

    return NextResponse.json({ success: true })
  })
}

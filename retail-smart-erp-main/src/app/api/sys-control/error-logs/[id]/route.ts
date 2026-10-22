import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { aiErrorLogs, tenants, users } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { scrubText, scrubValue } from '@/lib/admin/scrub'
import { logError } from '@/lib/ai/error-logger'

/**
 * GET /api/sys-control/error-logs/[id] — one entry with its stack trace and request context,
 * scrubbed of secrets (tokens, passwords, connection strings) and server paths, plus how many
 * other entries share its group.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response

    const [row] = await db.select({
      log: aiErrorLogs,
      tenantName: tenants.name,
      tenantBusinessId: tenants.businessId,
      reportedByName: users.fullName,
      reportedByEmail: users.email,
      groupEntries: sql<number>`(select count(*)::int from ai_error_logs g where g.group_hash = ${aiErrorLogs.groupHash})`,
    })
      .from(aiErrorLogs)
      .leftJoin(tenants, eq(tenants.id, aiErrorLogs.tenantId))
      .leftJoin(users, eq(users.id, aiErrorLogs.reportedByUserId))
      .where(eq(aiErrorLogs.id, p.data.id))
    if (!row) return NextResponse.json({ error: 'Error log entry not found' }, { status: 404 })

    const l = row.log
    return NextResponse.json({
      id: l.id,
      level: l.level,
      source: l.source,
      message: scrubText(l.message, 5_000),
      stack: scrubText(l.stack),
      context: scrubValue(l.context ?? null),
      browserInfo: scrubValue(l.browserInfo ?? null),
      userAgent: l.userAgent,
      aiAnalysis: l.aiAnalysis,
      aiSuggestion: l.aiSuggestion,
      groupHash: l.groupHash,
      groupEntries: l.groupHash ? row.groupEntries : 1,
      errorSource: l.errorSource ?? 'system',
      resolutionStatus: l.resolutionStatus ?? 'open',
      resolutionNotes: l.resolutionNotes,
      resolvedAt: l.resolvedAt,
      occurrenceCount: l.occurrenceCount ?? 1,
      createdAt: l.createdAt,
      lastOccurredAt: l.lastOccurredAt,
      reportedUrl: scrubText(l.reportedUrl, 2_000),
      userDescription: l.userDescription,
      tenantId: l.tenantId,
      tenantName: row.tenantName,
      tenantBusinessId: row.tenantBusinessId,
      reportedByName: row.reportedByName,
      reportedByEmail: row.reportedByEmail,
    })
  } catch (error) {
    logError('api/sys-control/error-logs/[id]', error)
    return NextResponse.json({ error: 'Failed to load error log entry' }, { status: 500 })
  }
}

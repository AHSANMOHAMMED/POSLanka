import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { aiErrorLogs } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { bugReportSchema } from '@/lib/validation/schemas/public'

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, bugReportSchema)
    if (!parsed.success) return parsed.response
    const { title, description, severity, url, userAgent } = parsed.data

    const level = severity === 'critical' || severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info'

    return await withTenant(session.user.tenantId, async (db) => {
      const [entry] = await db.insert(aiErrorLogs).values({
        tenantId: session.user.tenantId,
        level: level as 'error' | 'warning' | 'info',
        source: 'user-report',
        message: title.trim(),
        errorSource: 'user_report',
        reportedByUserId: session.user.id,
        userDescription: description?.trim() || null,
        reportedUrl: url || null,
        userAgent: userAgent || null,
        resolutionStatus: 'open',
        occurrenceCount: 1,
        lastOccurredAt: new Date(),
      }).returning()

      return NextResponse.json({ success: true, id: entry.id })
    })
  } catch (error) {
    logError('api/bug-reports', error)
    return NextResponse.json({ error: 'Failed to submit bug report' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const reports = await db
        .select({
          id: aiErrorLogs.id,
          title: aiErrorLogs.message,
          description: aiErrorLogs.userDescription,
          severity: aiErrorLogs.level,
          url: aiErrorLogs.reportedUrl,
          status: aiErrorLogs.resolutionStatus,
          resolutionNotes: aiErrorLogs.resolutionNotes,
          createdAt: aiErrorLogs.createdAt,
        })
        .from(aiErrorLogs)
        .where(and(
          eq(aiErrorLogs.reportedByUserId, session.user.id),
          eq(aiErrorLogs.errorSource, 'user_report'),
        ))
        .orderBy(desc(aiErrorLogs.createdAt))
        .limit(50)

      return NextResponse.json(reports)
    })
  } catch (error) {
    logError('api/bug-reports', error)
    return NextResponse.json({ error: 'Failed to fetch bug reports' }, { status: 500 })
  }
}

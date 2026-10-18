import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { savedReports } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { createSavedReportSchema } from '@/lib/validation/schemas/settings'

export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const data = await db.select()
        .from(savedReports)
        .where(eq(savedReports.tenantId, session.user.tenantId))
        .orderBy(desc(savedReports.createdAt))

      return NextResponse.json(data)
    })
  } catch (error) {
    logError('api/saved-reports', error)
    return NextResponse.json({ error: 'Failed to fetch saved reports' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createSavedReportSchema)
    if (!parsed.success) return parsed.response
    const { name, reportType, filters, columns, isPublic } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [saved] = await db.insert(savedReports).values({
        tenantId: session.user.tenantId,
        name,
        reportType,
        filters,
        columns: columns || null,
        createdBy: session.user.id,
        isPublic,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'saved-report', 'created', saved.id, { userId: session.user.id, entityName: saved.name })
      return NextResponse.json(saved, { status: 201 })
    })
  } catch (error) {
    logError('api/saved-reports', error)
    return NextResponse.json({ error: 'Failed to save report' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { fileAuditLogs } from '@/lib/db/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { fileAuditListSchema } from '@/lib/validation/schemas/files'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET audit log for a file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageFiles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = validateSearchParams(request, fileAuditListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Count total entries
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(fileAuditLogs)
        .where(eq(fileAuditLogs.fileId, id))

      // Get audit log entries with user info
      const logs = await db.query.fileAuditLogs.findMany({
        where: eq(fileAuditLogs.fileId, id),
        with: {
          user: { columns: { id: true, fullName: true } },
        },
        orderBy: [desc(fileAuditLogs.createdAt)],
        limit: Math.min(pageSize, 100),
        offset: (page - 1) * pageSize,
      })

      return NextResponse.json({
        data: logs,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/files/[id]/audit', error)
    return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 })
  }
}

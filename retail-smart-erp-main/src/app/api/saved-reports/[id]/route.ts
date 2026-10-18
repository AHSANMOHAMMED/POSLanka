import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { savedReports } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateSavedReportSchema } from '@/lib/validation/schemas/settings'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [report] = await db.select()
        .from(savedReports)
        .where(and(
          eq(savedReports.id, id),
          eq(savedReports.tenantId, session.user.tenantId),
        ))

      if (!report) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      return NextResponse.json(report)
    })
  } catch (error) {
    logError('api/saved-reports/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch saved report' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageSavedReports')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const parsed = await validateBody(request, updateSavedReportSchema)
    if (!parsed.success) return parsed.response
    const { name, filters, columns, isPublic } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [updated] = await db.update(savedReports)
        .set({
          ...(name !== undefined && { name }),
          ...(filters !== undefined && { filters }),
          ...(columns !== undefined && { columns }),
          ...(isPublic !== undefined && { isPublic }),
          updatedAt: new Date(),
        })
        .where(and(
          eq(savedReports.id, id),
          eq(savedReports.tenantId, session.user.tenantId),
        ))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      logAndBroadcast(session.user.tenantId, 'saved-report', 'updated', updated.id, { userId: session.user.id, entityName: updated.name })
      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/saved-reports/[id]', error)
    return NextResponse.json({ error: 'Failed to update saved report' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageSavedReports')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [deleted] = await db.delete(savedReports)
        .where(and(
          eq(savedReports.id, id),
          eq(savedReports.tenantId, session.user.tenantId),
        ))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      logAndBroadcast(session.user.tenantId, 'saved-report', 'deleted', deleted.id, { userId: session.user.id, entityName: deleted.name })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/saved-reports/[id]', error)
    return NextResponse.json({ error: 'Failed to delete saved report' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withAuthTenant } from '@/lib/db'
import { printTemplates } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updatePrintTemplateSchema } from '@/lib/validation/schemas/settings'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [template] = await db.select().from(printTemplates)
      .where(and(eq(printTemplates.id, id), eq(printTemplates.tenantId, session.user.tenantId)))
    return template || undefined
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  const permError = requirePermission(session, 'managePrintTemplates')
  if (permError) return permError

  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  try {
    const parsed = await validateBody(request, updatePrintTemplateSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      if (body.isDefault && body.documentType) {
        await db.update(printTemplates)
          .set({ isDefault: false })
          .where(and(
            eq(printTemplates.tenantId, session.user.tenantId),
            eq(printTemplates.documentType, body.documentType)
          ))
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      const fields = [
        'name', 'documentType', 'letterHeadId', 'paperSize', 'orientation',
        'margins', 'showLogo', 'showHeader', 'showFooter', 'customCss',
        'headerFields', 'bodyFields', 'footerFields', 'isDefault', 'isActive'
      ] as const
      for (const field of fields) {
        if (body[field] !== undefined) updateData[field] = body[field]
      }

      const [updated] = await db.update(printTemplates)
        .set(updateData)
        .where(and(eq(printTemplates.id, id), eq(printTemplates.tenantId, session.user.tenantId)))
        .returning()

      return updated || undefined
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    logAndBroadcast(result.tenantId, 'print-template', 'updated', result.id, { userId: session!.user.id, entityName: result.name })
    return NextResponse.json(result)
  } catch (error) {
    logError('api/print-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to update print template' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  const permError = requirePermission(session, 'managePrintTemplates')
  if (permError) return permError

  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [deleted] = await db.delete(printTemplates)
      .where(and(eq(printTemplates.id, id), eq(printTemplates.tenantId, session.user.tenantId)))
      .returning()
    return deleted || undefined
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (result) {
    logAndBroadcast(result.tenantId, 'print-template', 'deleted', result.id, { userId: session!.user.id, entityName: result.name })
  }
  return NextResponse.json({ success: true })
}

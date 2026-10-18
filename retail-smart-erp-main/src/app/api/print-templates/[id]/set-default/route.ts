import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { printTemplates } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return { error: permError }

    // Get this template to find its document type
    const [template] = await db.select().from(printTemplates)
      .where(and(eq(printTemplates.id, id), eq(printTemplates.tenantId, session.user.tenantId)))

    if (!template) return undefined

    // Unset all defaults for this document type
    await db.update(printTemplates)
      .set({ isDefault: false })
      .where(and(
        eq(printTemplates.tenantId, session.user.tenantId),
        eq(printTemplates.documentType, template.documentType)
      ))

    // Set this one as default
    const [updated] = await db.update(printTemplates)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(printTemplates.id, id), eq(printTemplates.tenantId, session.user.tenantId)))
      .returning()

    logAndBroadcast(session.user.tenantId, 'print-template', 'updated', id, { userId: session.user.id })
    return updated
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}

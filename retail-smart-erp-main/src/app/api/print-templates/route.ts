import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { printTemplates } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { notInRecycleBin } from '@/lib/recycle-bin'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { printTemplatesListSchema, createPrintTemplateSchema } from '@/lib/validation/schemas/settings'

export async function GET(request: NextRequest) {
  const parsed = validateSearchParams(request, printTemplatesListSchema)
  if (!parsed.success) return parsed.response
  const { documentType } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    // Templates moved to the recycle bin are hidden (deactivated ones still show)
    const conditions = [eq(printTemplates.tenantId, session.user.tenantId), notInRecycleBin('print_template', printTemplates.id)]
    if (documentType) {
      conditions.push(eq(printTemplates.documentType, documentType))
    }
    return db.select().from(printTemplates)
      .where(and(...conditions))
      .orderBy(desc(printTemplates.createdAt))
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, createPrintTemplateSchema)
    if (!parsed.success) return parsed.response
    const {
      name, documentType, letterHeadId, paperSize, orientation,
      margins, showLogo, showHeader, showFooter, customCss,
      headerFields, bodyFields, footerFields, config, isDefault
    } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return quotaError

      if (isDefault) {
        await db.update(printTemplates)
          .set({ isDefault: false })
          .where(and(
            eq(printTemplates.tenantId, session.user.tenantId),
            eq(printTemplates.documentType, documentType)
          ))
      }

      const [created] = await db.insert(printTemplates).values({
        tenantId: session.user.tenantId,
        name,
        documentType,
        letterHeadId: letterHeadId || null,
        paperSize,
        orientation,
        margins: margins || { top: 10, right: 10, bottom: 10, left: 10 },
        showLogo,
        showHeader,
        showFooter,
        customCss: customCss || null,
        headerFields: headerFields || null,
        bodyFields: bodyFields || null,
        footerFields: footerFields || null,
        config: config || {},
        isDefault,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'print-template', 'created', created.id, { userId: session.user.id, entityName: created.name })
      return created
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (result instanceof NextResponse) return result
    if ('error' in result && result.error instanceof NextResponse) return result.error

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    logError('api/print-templates', error)
    return NextResponse.json({ error: 'Failed to create print template' }, { status: 500 })
  }
}

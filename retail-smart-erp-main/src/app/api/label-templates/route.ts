import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { labelTemplates } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { labelTemplatesListSchema, createLabelTemplateSchema } from '@/lib/validation/schemas/label-templates'

export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, labelTemplatesListSchema)
    if (!parsed.success) return parsed.response

    const result = await withAuthTenant(async (session, db) => {
      return db.select().from(labelTemplates)
        .where(and(
          eq(labelTemplates.tenantId, session.user.tenantId),
          eq(labelTemplates.isActive, true)
        ))
        .orderBy(desc(labelTemplates.createdAt))
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/label-templates GET', error)
    return NextResponse.json({ error: 'Failed to fetch label templates' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, createLabelTemplateSchema)
    if (!parsed.success) return parsed.response
    const { name, description, widthMm, heightMm, labelShape, cornerRadius, elements, isDefault } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { _response: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { _response: quotaError }

      // If setting as default, clear existing default
      if (isDefault) {
        await db.update(labelTemplates)
          .set({ isDefault: false })
          .where(and(
            eq(labelTemplates.tenantId, session.user.tenantId),
            eq(labelTemplates.isDefault, true)
          ))
      }

      const [created] = await db.insert(labelTemplates).values({
        tenantId: session.user.tenantId,
        name,
        description: description || null,
        widthMm: String(widthMm),
        heightMm: String(heightMm),
        labelShape: labelShape || 'rectangle',
        cornerRadius: cornerRadius ?? null,
        elements: elements || [],
        isDefault: isDefault || false,
        createdBy: session.user.id,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'label-template', 'created', created.id, { userId: session.user.id, entityName: created.name })
      return created
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (result && '_response' in result) {
      return (result as { _response: NextResponse })._response
    }

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    logError('api/label-templates', error)
    return NextResponse.json({ error: 'Failed to create label template' }, { status: 500 })
  }
}

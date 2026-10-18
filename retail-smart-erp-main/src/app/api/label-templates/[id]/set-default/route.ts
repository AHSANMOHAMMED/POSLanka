import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { labelTemplates } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { _response: permError }

      // Clear existing default
      await db.update(labelTemplates)
        .set({ isDefault: false })
        .where(and(
          eq(labelTemplates.tenantId, session.user.tenantId),
          eq(labelTemplates.isDefault, true)
        ))

      // Set new default
      const [updated] = await db.update(labelTemplates)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(
          eq(labelTemplates.id, id),
          eq(labelTemplates.tenantId, session.user.tenantId)
        ))
        .returning()

      if (!updated) return null

      logAndBroadcast(session.user.tenantId, 'label-template', 'updated', updated.id, { userId: session.user.id, entityName: updated.name })
      return updated
    })

    if (result === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (result && '_response' in result) {
      return (result as { _response: NextResponse })._response
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/label-templates/[id]/set-default', error)
    return NextResponse.json({ error: 'Failed to set default template' }, { status: 500 })
  }
}

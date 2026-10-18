import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { letterHeads } from '@/lib/db/schema'
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

    // Unset all defaults
    await db.update(letterHeads)
      .set({ isDefault: false })
      .where(eq(letterHeads.tenantId, session.user.tenantId))

    // Set this one as default
    const [updated] = await db.update(letterHeads)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(letterHeads.id, id), eq(letterHeads.tenantId, session.user.tenantId)))
      .returning()

    logAndBroadcast(session.user.tenantId, 'letter-head', 'updated', id, { userId: session.user.id })
    return updated || undefined
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}

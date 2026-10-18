import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST toggle star/unstar on a file
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'uploadFiles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const file = await db.query.files.findFirst({
        where: eq(files.id, id),
        columns: { id: true, isStarred: true },
      })

      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const [updated] = await db.update(files)
        .set({
          isStarred: !file.isStarred,
          updatedAt: new Date(),
        })
        .where(eq(files.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'file', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/files/[id]/star', error)
    return NextResponse.json({ error: 'Failed to toggle star' }, { status: 500 })
  }
}

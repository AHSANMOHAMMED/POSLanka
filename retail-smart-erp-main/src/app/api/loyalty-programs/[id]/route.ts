import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { loyaltyPrograms } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateLoyaltyProgramSchema } from '@/lib/validation/schemas/loyalty'
import { idParamSchema } from '@/lib/validation/schemas/common'

// PUT - update loyalty program
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateLoyaltyProgramSchema)
    if (!parsed.success) return parsed.response
    const { status } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [updated] = await db.update(loyaltyPrograms)
        .set({
          ...(status && { status }),
          updatedAt: new Date(),
        })
        .where(eq(loyaltyPrograms.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Program not found' }, { status: 404 })
      }

      logAndBroadcast(session.user.tenantId, 'loyalty-program', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/loyalty-programs/[id]', error)
    return NextResponse.json({ error: 'Failed to update program' }, { status: 500 })
  }
}

// DELETE - deactivate loyalty program
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [updated] = await db.update(loyaltyPrograms)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(loyaltyPrograms.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Program not found' }, { status: 404 })
      }

      logAndBroadcast(session.user.tenantId, 'loyalty-program', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/loyalty-programs/[id]', error)
    return NextResponse.json({ error: 'Failed to delete program' }, { status: 500 })
  }
}

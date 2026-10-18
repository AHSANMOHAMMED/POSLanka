import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { cancellationReasons } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

const updateCancellationReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

// PUT /api/cancellation-reasons/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCancellationReasonSchema)
    if (!parsed.success) return parsed.response

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.cancellationReasons.findFirst({
        where: eq(cancellationReasons.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      const [updated] = await db
        .update(cancellationReasons)
        .set(parsed.data)
        .where(eq(cancellationReasons.id, id))
        .returning()

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/cancellation-reasons/[id]', error)
    return NextResponse.json({ error: 'Failed to update cancellation reason' }, { status: 500 })
  }
}

// DELETE /api/cancellation-reasons/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.cancellationReasons.findFirst({
        where: eq(cancellationReasons.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      await db.delete(cancellationReasons).where(eq(cancellationReasons.id, id))

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/cancellation-reasons/[id]', error)
    return NextResponse.json({ error: 'Failed to delete cancellation reason' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysUpdateUserSchema } from '@/lib/validation/schemas/sys-control'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting
    const rateLimited = await withRateLimit('/api/sys-control/users', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, sysUpdateUserSchema)
    if (!parsed.success) return parsed.response
    const { isActive, deactivationReason } = parsed.data

    // Get the account
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
    })

    if (!account) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }
    const auditDetails: Record<string, unknown> = {
      email: account.email,
    }

    // Handle activation/deactivation
    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive)
      auditDetails.isActive = { from: account.isActive, to: Boolean(isActive) }

      if (!isActive) {
        // Deactivating
        updateData.deactivatedAt = new Date()
        updateData.deactivationReason = deactivationReason || null
        auditDetails.deactivationReason = deactivationReason
      } else {
        // Reactivating
        updateData.deactivatedAt = null
        updateData.deactivationReason = null
      }
    }

    // Update account
    await db.update(accounts)
      .set(updateData)
      .where(eq(accounts.id, id))

    // Audit log
    await adminAudit.update(session.superAdminId, 'user', id, auditDetails)

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/users/[id]', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

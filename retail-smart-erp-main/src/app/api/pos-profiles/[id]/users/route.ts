import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posProfiles, posProfileUsers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { posProfileUsersSchema, posProfileAddUserSchema } from '@/lib/validation/schemas/pos'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET users assigned to a POS profile
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      const users = await db.query.posProfileUsers.findMany({
        where: eq(posProfileUsers.posProfileId, id),
        with: {
          user: true,
        },
      })

      return NextResponse.json(users)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/users', error)
    return NextResponse.json({ error: 'Failed to fetch profile users' }, { status: 500 })
  }
}

// POST - Replace all user assignments for a POS profile
export async function POST(
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

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, posProfileUsersSchema)
    if (!parsed.success) return parsed.response
    const { userIds, defaultUserId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      // withTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.
      await db.delete(posProfileUsers)
        .where(eq(posProfileUsers.posProfileId, id))

      if (userIds.length > 0) {
        const userValues = userIds.map((userId: string, index: number) => ({
          tenantId: session.user.tenantId,
          posProfileId: id,
          userId,
          isDefault: defaultUserId ? userId === defaultUserId : index === 0,
        }))
        await db.insert(posProfileUsers).values(userValues)
      }

      // Fetch updated
      const updated = await db.query.posProfileUsers.findMany({
        where: eq(posProfileUsers.posProfileId, id),
        with: {
          user: true,
        },
      })

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/users', error)
    return NextResponse.json({ error: 'Failed to update profile users' }, { status: 500 })
  }
}

// PUT - Add a single user to a profile
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
    const parsed = await validateBody(request, posProfileAddUserSchema)
    if (!parsed.success) return parsed.response
    const { userId, isDefault } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      // Check if user already assigned
      const existing = await db.query.posProfileUsers.findFirst({
        where: and(
          eq(posProfileUsers.posProfileId, id),
          eq(posProfileUsers.userId, userId)
        ),
      })

      if (existing) {
        // Update default status if needed
        if (isDefault !== existing.isDefault) {
          if (isDefault) {
            // Unset other defaults
            await db.update(posProfileUsers)
              .set({ isDefault: false })
              .where(eq(posProfileUsers.posProfileId, id))
          }
          await db.update(posProfileUsers)
            .set({ isDefault })
            .where(eq(posProfileUsers.id, existing.id))
        }
        return NextResponse.json({ message: 'User already assigned', updated: true })
      }

      // If setting as default, unset others
      if (isDefault) {
        await db.update(posProfileUsers)
          .set({ isDefault: false })
          .where(eq(posProfileUsers.posProfileId, id))
      }

      // Add user
      await db.insert(posProfileUsers).values({
        tenantId: session.user.tenantId,
        posProfileId: id,
        userId,
        isDefault,
      })

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/users', error)
    return NextResponse.json({ error: 'Failed to add user to profile' }, { status: 500 })
  }
}

// DELETE - Remove a user from a profile
export async function DELETE(
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
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      await db.delete(posProfileUsers)
        .where(and(
          eq(posProfileUsers.posProfileId, id),
          eq(posProfileUsers.userId, userId)
        ))

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/users', error)
    return NextResponse.json({ error: 'Failed to remove user from profile' }, { status: 500 })
  }
}

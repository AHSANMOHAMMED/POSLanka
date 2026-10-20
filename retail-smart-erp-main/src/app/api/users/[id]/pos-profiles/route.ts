import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission, canModifyUser } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { users, posProfiles, posProfileUsers, warehouses } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateUserPosProfilesSchema } from '@/lib/validation/schemas/users'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { addUserWarehouses, replaceUserPosProfiles, StaffError } from '@/lib/users/create-staff'
import type { TenantDb } from '@/lib/db'

async function listAssigned(db: TenantDb, tenantId: string, userId: string) {
  return db
    .select({
      posProfileId: posProfileUsers.posProfileId,
      isDefault: posProfileUsers.isDefault,
      name: posProfiles.name,
      code: posProfiles.code,
      status: posProfiles.status,
      warehouseId: posProfiles.warehouseId,
      warehouseName: warehouses.name,
    })
    .from(posProfileUsers)
    .innerJoin(posProfiles, eq(posProfileUsers.posProfileId, posProfiles.id))
    .leftJoin(warehouses, eq(posProfiles.warehouseId, warehouses.id))
    .where(and(eq(posProfileUsers.tenantId, tenantId), eq(posProfileUsers.userId, userId)))
}

// GET /api/users/[id]/pos-profiles — counters (POS profiles) assigned to a user
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
    const { id: userId } = paramsParsed.data

    // Users may read their own counters; reading others requires manageUsers
    if (userId !== session.user.id) {
      const permError = requirePermission(session, 'manageUsers')
      if (permError) return permError
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const [user] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, session.user.tenantId)))
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      const posProfileAssignments = await listAssigned(db, session.user.tenantId, userId)
      return NextResponse.json({ posProfiles: posProfileAssignments })
    })
  } catch (error) {
    logError('api/users/[id]/pos-profiles', error)
    return NextResponse.json({ error: 'Failed to fetch user counters' }, { status: 500 })
  }
}

// PUT /api/users/[id]/pos-profiles — replace this user's counter assignments
// Body: { posProfileIds: uuid[], defaultPosProfileId?: uuid }
// Counters' branches are added to the user's branch assignments if missing.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: userId } = paramsParsed.data

    const parsed = await validateBody(request, updateUserPosProfilesSchema)
    if (!parsed.success) return parsed.response
    const posProfileIds = Array.from(new Set(parsed.data.posProfileIds))
    const { defaultPosProfileId } = parsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const [user] = await db.select({ id: users.id, role: users.role }).from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      if (!canModifyUser(session!.user.role, user.role)) {
        return NextResponse.json({ error: 'You cannot modify this user' }, { status: 403 })
      }

      let profiles: Array<{ id: string; warehouseId: string | null }> = []
      if (posProfileIds.length > 0) {
        profiles = await db.select({ id: posProfiles.id, warehouseId: posProfiles.warehouseId })
          .from(posProfiles)
          .where(and(eq(posProfiles.tenantId, tenantId), inArray(posProfiles.id, posProfileIds)))
        if (profiles.length !== posProfileIds.length) {
          return NextResponse.json({ error: 'One or more POS counters not found' }, { status: 400 })
        }
      }

      try {
        await replaceUserPosProfiles(db, tenantId, userId, posProfileIds, defaultPosProfileId)
      } catch (err) {
        if (err instanceof StaffError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }

      // A counter is only usable at its branch — make sure the user has that branch
      const branchIds = Array.from(new Set(profiles.map(p => p.warehouseId).filter((w): w is string => !!w)))
      await addUserWarehouses(db, tenantId, userId, branchIds)

      const posProfileAssignments = await listAssigned(db, tenantId, userId)
      logAndBroadcast(tenantId, 'user', 'updated', userId, { userId: session!.user.id })
      return NextResponse.json({ posProfiles: posProfileAssignments })
    })
  } catch (error) {
    logError('api/users/[id]/pos-profiles', error)
    return NextResponse.json({ error: 'Failed to update user counters' }, { status: 500 })
  }
}

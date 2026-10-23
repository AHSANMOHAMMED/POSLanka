import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission, MODULE_KEYS, ROLE_HIERARCHY } from '@/lib/auth/roles'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { withTenant } from '@/lib/db'
import { moduleAccess } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { updateModuleAccessSchema } from '@/lib/validation/schemas/settings'

export async function GET(_request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.query.moduleAccess.findMany({
        orderBy: (m, { asc }) => [asc(m.moduleKey), asc(m.role)],
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/module-access', error)
    return NextResponse.json({ error: 'Failed to fetch module access' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageModuleAccess')
    if (permError) return permError

    const parsed = await validateBody(request, updateModuleAccessSchema)
    if (!parsed.success) return parsed.response
    const { entries: requested } = parsed.data

    // Unknown modules / roles would only create dead rows (or a DB enum error); reject them.
    const bad = requested.find((e) => !(MODULE_KEYS as readonly string[]).includes(e.moduleKey) || !(e.role in ROLE_HIERARCHY))
    if (bad) {
      return NextResponse.json({ error: `Unknown module or role: ${bad.moduleKey} / ${bad.role}` }, { status: 400 })
    }
    // The owner can never be locked out of a module — owner rows are ignored (and enforcement
    // skips owners anyway), so the editor may send the full grid unchanged.
    const entries = requested.filter((e) => e.role !== 'owner')

    const response = await withTenant(session.user.tenantId, async (db) => {
      for (const entry of entries) {
        const existing = await db.query.moduleAccess.findFirst({
          where: and(
            eq(moduleAccess.moduleKey, entry.moduleKey),
            eq(moduleAccess.role, entry.role as typeof moduleAccess.role.enumValues[number]),
          ),
        })

        if (existing) {
          await db
            .update(moduleAccess)
            .set({
              isEnabled: entry.isEnabled,
              updatedBy: session.user.id,
              updatedAt: new Date(),
            })
            .where(eq(moduleAccess.id, existing.id))
        } else {
          await db.insert(moduleAccess).values({
            tenantId: session.user.tenantId,
            moduleKey: entry.moduleKey,
            role: entry.role as typeof moduleAccess.role.enumValues[number],
            isEnabled: entry.isEnabled,
            updatedBy: session.user.id,
          })
        }
      }

      const result = await db.query.moduleAccess.findMany({
        orderBy: (m, { asc }) => [asc(m.moduleKey), asc(m.role)],
      })

      return NextResponse.json(result)
    })

    // After commit: invalidating (or telling clients to refetch) inside the transaction let a
    // concurrent request reload the old module access into the cache.
    // Server-side enforcement reads module access from the permission cache
    invalidatePermissionCache(session.user.tenantId)
    logAndBroadcast(session.user.tenantId, 'module-access', 'updated', 'bulk')
    // Effective permissions change too — clients listening for 'settings' refetch them
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'role-permissions', { userId: session.user.id })
    return response
  } catch (error) {
    logError('api/module-access', error)
    return NextResponse.json({ error: 'Failed to update module access' }, { status: 500 })
  }
}

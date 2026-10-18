import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
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
    const { entries } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
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

      logAndBroadcast(session.user.tenantId, 'module-access', 'updated', 'bulk')

      const result = await db.query.moduleAccess.findMany({
        orderBy: (m, { asc }) => [asc(m.moduleKey), asc(m.role)],
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/module-access', error)
    return NextResponse.json({ error: 'Failed to update module access' }, { status: 500 })
  }
}

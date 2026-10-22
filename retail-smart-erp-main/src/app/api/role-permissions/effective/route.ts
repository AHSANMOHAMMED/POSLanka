import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { getEffectivePermissions } from '@/lib/auth/roles'
import { getCustomRoleName } from '@/lib/auth/permission-cache'
import { logError } from '@/lib/ai/error-logger'

// GET /api/role-permissions/effective — Effective permissions for the current user
// (custom role, tenant overrides and module-access toggles applied; the same rules
// requirePermission enforces). The mobile app uses this to show/hide screens.
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { role, tenantId, customRoleId } = session.user
    const permissions = getEffectivePermissions(role, tenantId, customRoleId)

    // Business ID lets older app installs (signed in with the slug) learn it
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { businessId: true },
    }).catch(() => undefined)

    return NextResponse.json({
      permissions,
      role,
      customRoleId: customRoleId || null,
      customRoleName: customRoleId ? getCustomRoleName(tenantId, customRoleId) ?? null : null,
      businessId: tenant?.businessId ?? null,
    })
  } catch (error) {
    logError('api/role-permissions/effective', error)
    return NextResponse.json({ error: 'Failed to get permissions' }, { status: 500 })
  }
}

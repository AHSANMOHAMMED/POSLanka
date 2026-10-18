import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getEffectivePermissions } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'

// GET /api/role-permissions/effective — Get effective permissions for the current user
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permissions = getEffectivePermissions(
      session.user.role,
      session.user.tenantId,
      session.user.customRoleId,
    )

    return NextResponse.json({ permissions })
  } catch (error) {
    logError('api/role-permissions/effective', error)
    return NextResponse.json({ error: 'Failed to get permissions' }, { status: 500 })
  }
}

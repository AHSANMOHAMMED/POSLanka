/**
 * Shared helpers for the /api/hr/* attendance routes: session + permission + HR module check,
 * error mapping, and branch (K4) scoping of employees.
 *
 * An employee's branch is employee_profiles.warehouse_id; when unset, the branches of the
 * employee's user (user_warehouses). A branch-restricted manager only sees employees of their
 * own branches.
 */
import { NextResponse } from 'next/server'
import { sql, type SQL } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import type { Permission } from '@/lib/auth/roles'
import { getBranchScope, type BranchScope } from '@/lib/auth/branch-access'
import { toApiError } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'
import type { TenantDb } from '@/lib/db'

export type HrSession = NonNullable<Awaited<ReturnType<typeof authWithCompany>>>

export async function hrAuth(permission: Permission = 'manageEmployees'): Promise<{ session: HrSession; error?: undefined } | { session?: undefined; error: NextResponse }> {
  const session = await authWithCompany()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const perm = requirePermission(session, permission)
  if (perm) return { error: perm }
  const mod = requireModule(session, 'hr')
  if (mod) return { error: mod }
  return { session }
}

export function hrError(route: string, error: unknown, message = 'Request failed'): NextResponse {
  const mapped = toApiError(error)
  if (mapped) return mapped
  logError(route, error)
  return NextResponse.json({ error: message }, { status: 500 })
}

/**
 * SQL condition on an employee_profiles alias (default `employee_profiles`) limiting it to the
 * scope's branches; empty `TRUE` when unrestricted. `alias` is trusted SQL text.
 */
export function employeeScopeSql(scope: BranchScope, alias = 'employee_profiles'): SQL {
  if (!scope) return sql`TRUE`
  const ids = sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)
  const a = sql.raw(alias)
  return sql`(${a}.warehouse_id IN (${ids}) OR (${a}.warehouse_id IS NULL AND EXISTS (
    SELECT 1 FROM user_warehouses uw WHERE uw.user_id = ${a}.user_id AND uw.is_active = true AND uw.warehouse_id IN (${ids}))))`
}

/** Employee ids (of the given ones, or all) the session may work with; null = unrestricted. */
export async function scopedEmployeeIds(session: HrSession, db: TenantDb): Promise<{ scope: BranchScope; ids: Set<string> | null }> {
  const scope = await getBranchScope(session, db)
  if (!scope) return { scope, ids: null }
  const res = await db.execute(sql`SELECT employee_profiles.id FROM employee_profiles WHERE ${employeeScopeSql(scope)}`)
  return { scope, ids: new Set((res.rows as Array<{ id: string }>).map((r) => r.id)) }
}

export async function assertEmployeeInScope(session: HrSession, db: TenantDb, employeeProfileId: string): Promise<NextResponse | null> {
  const { ids } = await scopedEmployeeIds(session, db)
  if (!ids || ids.has(employeeProfileId)) return null
  return NextResponse.json({ error: 'You can only manage employees of your own branch.', code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
}

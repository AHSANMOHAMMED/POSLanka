import { NextResponse } from 'next/server'
import {
  ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
  OWNER_ONLY_PERMISSIONS,
  getRoleLevel,
  hasPermission,
  resolveRoleDefinition,
  type Permission,
} from './roles'

/**
 * Guards for editing role definitions (custom roles and built-in role overrides).
 *
 * Owners may define anything except owner-only permissions. A non-owner holding `manageRoles`
 * may only edit roles ranked strictly below their own and can never change a permission they
 * do not hold themselves: such keys keep their previous value, and an edit (including a base-role
 * change or a reset) that would newly grant one is refused.
 */
type RoleSession = { user: { id: string; role: string; tenantId: string; customRoleId?: string | null } }

const ALL_PERMISSIONS = Object.keys(ROLE_PERMISSIONS) as Permission[]

export function isOwnerActor(session: RoleSession): boolean {
  return session.user.role === 'owner' && !session.user.customRoleId
}

function actorHolds(session: RoleSession, perm: Permission): boolean {
  return hasPermission(session.user.role, perm, session.user.tenantId, session.user.customRoleId)
}

export function isBuiltinRole(role: string): boolean {
  return role in ROLE_HIERARCHY
}

/** Refuses roles the actor may not define: unknown roles, owner, or (non-owners) roles at/above their rank. */
export function checkRoleRank(session: RoleSession, role: string): NextResponse | null {
  if (!isBuiltinRole(role)) return NextResponse.json({ error: `Unknown role: ${role}` }, { status: 400 })
  if (role === 'owner') return NextResponse.json({ error: 'Owner permissions cannot be modified' }, { status: 400 })
  if (!isOwnerActor(session) && getRoleLevel(role) >= getRoleLevel(session.user.role)) {
    return NextResponse.json({ error: 'You can only change roles ranked below your own' }, { status: 403 })
  }
  return null
}

/**
 * Final explicit permission map for a role edit. Unknown keys are dropped, owner-only grants are
 * dropped, and for non-owners every key the actor does not hold keeps its previous explicit value.
 */
export function sanitizeRequestedPermissions(
  session: RoleSession,
  requested: Record<string, boolean>,
  previous: Record<string, boolean> = {},
): Record<string, boolean> {
  const owner = isOwnerActor(session)
  const out: Record<string, boolean> = {}
  for (const perm of ALL_PERMISSIONS) {
    let value: boolean | undefined = requested[perm]
    if (!owner && !actorHolds(session, perm)) value = previous[perm]
    if (value === undefined) continue
    if (value && OWNER_ONLY_PERMISSIONS.includes(perm)) continue
    out[perm] = value
  }
  return out
}

/** The request as asked (valid keys only, owner-only grants dropped) — used to detect escalation attempts. */
export function requestedPermissions(requested: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const perm of ALL_PERMISSIONS) {
    const v = requested[perm]
    if (v === undefined || (v && OWNER_ONLY_PERMISSIONS.includes(perm))) continue
    out[perm] = v
  }
  return out
}

/**
 * Permissions the edited role would newly gain that the actor does not hold
 * (empty for owners). `before` = the role's effective map before the edit (null when creating).
 */
export function escalatedPermissions(
  session: RoleSession,
  after: Record<Permission, boolean>,
  before: Record<Permission, boolean> | null,
): Permission[] {
  if (isOwnerActor(session)) return []
  return ALL_PERMISSIONS.filter((p) => after[p] && !(before?.[p]) && !actorHolds(session, p))
}

export function escalationResponse(missing: Permission[]): NextResponse {
  return NextResponse.json(
    { error: 'You cannot grant permissions you do not have yourself', missingPermissions: missing },
    { status: 403 },
  )
}

export { resolveRoleDefinition }

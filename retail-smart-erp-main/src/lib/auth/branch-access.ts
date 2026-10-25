/**
 * K4: branch (warehouse) isolation for staff inside one vendor.
 *
 * Tenants are already isolated by RLS; this is the layer below it. The rule:
 *
 *   - The owner may work with every branch.
 *   - Any other user with NO active user_warehouses assignment may also work with every branch.
 *     Single-branch shops and staff nobody has assigned keep working exactly as before.
 *   - A non-owner with one or more active assignments is RESTRICTED to those branches: lists
 *     only show records of those branches, a foreign branch id is refused (403
 *     BRANCH_ACCESS_DENIED), and a single record of a foreign branch is refused the same way.
 *
 * The role does not matter (a manager assigned to one branch is that branch's manager); only
 * the owner is never restricted. Stock transfers: sending needs access to the source branch;
 * receiving needs access to the destination branch.
 *
 * Records without a branch (warehouse_id NULL, e.g. a company-wide expense) are not shown to
 * restricted users unless a caller opts in with `includeUnassigned`.
 *
 * The scope is cached per user for a short time; changing a user's branches calls
 * invalidatePermissionCache(tenantId), which also drops these entries in every process.
 */
import { NextResponse } from 'next/server'
import { and, eq, inArray, isNull, or, sql, type SQL, type AnyColumn } from 'drizzle-orm'
import { posOpeningEntries, userWarehouses, warehouses } from '@/lib/db/schema'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { withTenant, type TenantDb } from '@/lib/db/tenant-context'

/** Any tenant-scoped handle (withTenant db, a transaction, a DbTx) */
type BranchDb = Pick<TenantDb, 'select'>

/** null = every branch; otherwise the warehouse ids this user may work with (never empty). */
export type BranchScope = string[] | null

interface BranchSessionLike {
  user: { id: string; tenantId: string; role: string; isOwner?: boolean }
}

const CACHE_TTL_MS = 60 * 1000
const cache = new Map<string, { scope: BranchScope; loadedAt: number }>()
// Bumped on every invalidation so a read that started before it is not stored as fresh
let generation = 0

/** Drop cached scopes of one tenant ('*' = all). Called from invalidatePermissionCache(). */
export function clearBranchScopeCache(tenantId: string): void {
  generation++
  if (tenantId === '*') { cache.clear(); return }
  for (const key of cache.keys()) if (key.startsWith(`${tenantId}:`)) cache.delete(key)
}

/** Whether the role can never be restricted to branches. */
export function isBranchUnrestrictedRole(session: BranchSessionLike): boolean {
  return session.user.role === 'owner' || session.user.isOwner === true
}

/**
 * The branches the user may work with: null when unrestricted, else the assigned warehouse ids.
 * `db` must be a tenant-scoped handle (withTenant); RLS keeps the read inside the tenant.
 */
export async function getBranchScope(session: BranchSessionLike | null | undefined, db: BranchDb): Promise<BranchScope> {
  if (!session?.user?.id) return null
  if (isBranchUnrestrictedRole(session)) return null
  const key = `${session.user.tenantId}:${session.user.id}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.scope

  const gen = generation
  const rows = await db.select({ warehouseId: userWarehouses.warehouseId })
    .from(userWarehouses)
    .where(and(eq(userWarehouses.userId, session.user.id), eq(userWarehouses.isActive, true)))
  const scope: BranchScope = rows.length > 0 ? [...new Set(rows.map(r => r.warehouseId))] : null
  if (gen === generation) cache.set(key, { scope, loadedAt: Date.now() })
  return scope
}

/** True when the scope allows the branch. A missing branch id is allowed only when unrestricted. */
export function canAccessBranch(scope: BranchScope, warehouseId: string | null | undefined): boolean {
  if (scope === null) return true
  if (!warehouseId) return false
  return scope.includes(warehouseId)
}

/**
 * Filter for list queries: undefined when unrestricted (no condition), else `column IN scope`
 * (optionally also rows without a branch).
 */
export function branchFilter(scope: BranchScope, column: AnyColumn | SQL, opts?: { includeUnassigned?: boolean }): SQL | undefined {
  if (scope === null) return undefined
  const inScope = inArray(column as AnyColumn, scope)
  return opts?.includeUnassigned ? or(inScope, isNull(column as AnyColumn)) : inScope
}

/** Plain user-facing message naming the user's branches. */
export async function branchDeniedMessage(scope: BranchScope, db: BranchDb): Promise<string> {
  if (!scope || scope.length === 0) return 'You do not have access to this branch.'
  const names = await db.select({ name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, scope))
    .catch(() => [] as Array<{ name: string }>)
  const list = names.map(n => n.name).sort().join(', ')
  if (!list) return 'You can only work with your own branch.'
  return names.length === 1
    ? `You can only work with your own branch (${list}).`
    : `You can only work with your own branches (${list}).`
}

/** 403 response for a branch the user may not work with. */
export async function branchDeniedResponse(scope: BranchScope, db: BranchDb): Promise<NextResponse> {
  return NextResponse.json({ error: await branchDeniedMessage(scope, db), code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
}

/**
 * Refuse a branch the user may not work with. Returns a 403 NextResponse or null when allowed.
 * Pass several ids to require all of them (null/undefined ids are skipped unless `requireBranch`).
 */
export async function assertBranchAccess(
  session: BranchSessionLike | null | undefined,
  warehouseId: string | null | undefined | Array<string | null | undefined>,
  db: BranchDb,
  opts?: { requireBranch?: boolean; scope?: BranchScope },
): Promise<NextResponse | null> {
  const scope = opts?.scope !== undefined ? opts.scope : await getBranchScope(session, db)
  if (scope === null) return null
  const ids = Array.isArray(warehouseId) ? warehouseId : [warehouseId]
  for (const id of ids) {
    if (!id) {
      if (opts?.requireBranch) return branchDeniedResponse(scope, db)
      continue
    }
    if (!scope.includes(id)) return branchDeniedResponse(scope, db)
  }
  return null
}

/**
 * Refuse a single record of another branch: reads `column` (default the table's warehouseId) of
 * the row with this id. A missing row returns null so the caller answers its usual 404. A row
 * without a branch is refused for restricted users unless `includeUnassigned`.
 */
export async function assertRecordBranch(
  session: BranchSessionLike | null | undefined,
  db: BranchDb,
  table: PgTable & { id: AnyColumn },
  id: string,
  opts?: { column?: AnyColumn; includeUnassigned?: boolean },
): Promise<NextResponse | null> {
  const scope = await getBranchScope(session, db)
  if (scope === null) return null
  const column = (opts?.column ?? (table as unknown as { warehouseId: AnyColumn }).warehouseId) as PgColumn
  const [row] = await db.select({ warehouseId: column }).from(table as PgTable).where(eq(table.id, id)).limit(1)
  if (!row) return null
  const warehouseId = row.warehouseId as string | null
  if (!warehouseId) return opts?.includeUnassigned ? null : branchDeniedResponse(scope, db)
  return scope.includes(warehouseId) ? null : branchDeniedResponse(scope, db)
}

/**
 * Raw-SQL filter for hand-written queries: `AND <column> IN (...)` for a restricted scope, empty
 * otherwise. `column` is trusted SQL text (e.g. 'ws.warehouse_id'), never user input.
 */
export function branchSqlFilter(scope: BranchScope | undefined, column: string): SQL {
  if (!scope) return sql``
  return sql` AND ${sql.raw(column)} IN (${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)})`
}

/**
 * For company-wide figures that cannot be split by branch (ledgers, tax, payables, most reports):
 * refused for branch-restricted users. Returns a 403 NextResponse or null.
 */
export async function requireAllBranches(session: BranchSessionLike | null | undefined): Promise<NextResponse | null> {
  if (!session?.user?.tenantId || isBranchUnrestrictedRole(session)) return null
  const scope = await withTenant(session.user.tenantId, (db) => getBranchScope(session, db))
  if (scope === null) return null
  return NextResponse.json({
    error: 'This report covers every branch. You can only see the figures of your own branch.',
    code: 'BRANCH_ACCESS_DENIED',
  }, { status: 403 })
}

/**
 * Staff management by a branch-restricted manager: only staff whose branches all lie within the
 * manager's own (a staff member with no branch works with every branch, so is out of reach).
 * Returns a 403 NextResponse or null.
 */
export async function assertStaffInScope(
  session: BranchSessionLike | null | undefined,
  db: BranchDb,
  targetUserId: string,
): Promise<NextResponse | null> {
  const scope = await getBranchScope(session, db)
  if (scope === null) return null
  const rows = await db.select({ warehouseId: userWarehouses.warehouseId })
    .from(userWarehouses)
    .where(and(eq(userWarehouses.userId, targetUserId), eq(userWarehouses.isActive, true)))
  if (rows.length > 0 && rows.every((r) => scope.includes(r.warehouseId))) return null
  return staffDeniedResponse(scope, db)
}

/** 403 for staff (or branches) outside a branch-restricted manager's own branches. */
export async function staffDeniedResponse(scope: BranchScope, db: BranchDb): Promise<NextResponse> {
  const message = (await branchDeniedMessage(scope, db)).replace('You can only work with', 'You can only manage staff of')
  return NextResponse.json({ error: message, code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
}

/**
 * The branch a new record (restaurant table/order, appointment, requisition) belongs to.
 * A branch from the request must exist, be active and be allowed for the user (else 403).
 * Without one: the branch of the user's open POS shift (when allowed), else the user's first
 * branch (restricted users), else the default branch, else any active branch, else null.
 * Returns `{ warehouseId }` or `{ error }` with the response to send.
 */
export async function resolveRecordBranch(
  session: BranchSessionLike | null | undefined,
  db: BranchDb,
  requested?: string | null,
): Promise<{ warehouseId: string | null; error?: undefined } | { warehouseId?: undefined; error: NextResponse }> {
  const scope = await getBranchScope(session, db)
  if (requested) {
    if (!canAccessBranch(scope, requested)) return { error: await branchDeniedResponse(scope, db) }
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, requested), eq(warehouses.isActive, true))).limit(1)
    if (!wh) return { error: NextResponse.json({ error: 'Selected branch not found or inactive' }, { status: 400 }) }
    return { warehouseId: wh.id }
  }
  if (session?.user?.id) {
    const [shift] = await db.select({ warehouseId: posOpeningEntries.warehouseId }).from(posOpeningEntries)
      .where(and(eq(posOpeningEntries.userId, session.user.id), eq(posOpeningEntries.status, 'open'))).limit(1)
    if (shift?.warehouseId && canAccessBranch(scope, shift.warehouseId)) return { warehouseId: shift.warehouseId }
  }
  if (scope) return { warehouseId: scope[0] }
  const notQuarantine = sql`upper(coalesce(${warehouses.code}, '')) <> 'QUARANTINE'`
  const [def] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.isDefault, true), eq(warehouses.isActive, true), notQuarantine)).limit(1)
  if (def) return { warehouseId: def.id }
  const [any] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.isActive, true), notQuarantine)).limit(1)
  return { warehouseId: any?.id ?? null }
}

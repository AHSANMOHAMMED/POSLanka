/**
 * D3: per-tenant hiding of shared system defaults (rows with tenant_id IS NULL).
 *
 * System vehicle types / inspection templates are shared by every company and read-only for
 * tenant code (RLS). A company that does not want one stores an override row in
 * tenant_hidden_defaults; list endpoints then leave it out for that company only.
 */
import { and, eq } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { tenantHiddenDefaults } from '@/lib/db/schema'

export type HiddenDefaultEntity = 'vehicle_type' | 'inspection_template'

/** Ids of the system rows of `entity` this tenant has hidden. Must run inside withTenant. */
export async function getHiddenDefaultIds(tdb: TenantDb, tenantId: string, entity: HiddenDefaultEntity): Promise<Set<string>> {
  const rows = await tdb.select({ id: tenantHiddenDefaults.entityId }).from(tenantHiddenDefaults)
    .where(and(eq(tenantHiddenDefaults.tenantId, tenantId), eq(tenantHiddenDefaults.entity, entity)))
  return new Set(rows.map((r) => r.id))
}

/** Hide (hidden=true) or re-show (hidden=false) a system row for this tenant. Idempotent. */
export async function setDefaultHidden(
  tdb: TenantDb,
  tenantId: string,
  entity: HiddenDefaultEntity,
  entityId: string,
  hidden: boolean,
  userId?: string | null,
): Promise<void> {
  if (hidden) {
    await tdb.insert(tenantHiddenDefaults)
      .values({ tenantId, entity, entityId, hiddenBy: userId || null })
      .onConflictDoNothing()
  } else {
    await tdb.delete(tenantHiddenDefaults).where(and(
      eq(tenantHiddenDefaults.tenantId, tenantId),
      eq(tenantHiddenDefaults.entity, entity),
      eq(tenantHiddenDefaults.entityId, entityId),
    ))
  }
}

/**
 * Apply the tenant's overrides to a list: hidden system rows are dropped, or — when
 * includeHidden — kept and flagged `hidden: true` so settings screens can re-enable them.
 * Every returned row carries a boolean `hidden`.
 */
export function applyHiddenDefaults<T extends { id: string; tenantId: string | null }>(
  rows: T[],
  hiddenIds: Set<string>,
  includeHidden: boolean,
): Array<T & { hidden: boolean }> {
  const out: Array<T & { hidden: boolean }> = []
  for (const row of rows) {
    const hidden = row.tenantId === null && hiddenIds.has(row.id)
    if (hidden && !includeHidden) continue
    out.push({ ...row, hidden })
  }
  return out
}

/** Body keys other than isActive that carry a value (system rows only accept isActive). */
export function otherFieldsSet(body: Record<string, unknown>): string[] {
  return Object.entries(body).filter(([k, v]) => k !== 'isActive' && v !== undefined).map(([k]) => k)
}

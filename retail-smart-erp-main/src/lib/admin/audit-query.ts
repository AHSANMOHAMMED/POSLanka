/**
 * Super-admin audit log query, shared by the paginated list and the CSV export so both
 * apply exactly the same filters.
 */
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { accounts, adminAuditActionEnum, adminAuditLogs, superAdmins, tenants } from '@/lib/db/schema'
import { escapeLikePattern } from '@/lib/utils/sql'
import { normalizeBusinessId } from '@/lib/tenant/business-id'

const blank = (v: unknown) => (v === '' || v === 'all' || v === null ? undefined : v)
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

export const auditFilterSchema = z.object({
  adminId: z.preprocess(blank, z.string().uuid().optional()),
  action: z.preprocess(blank, z.enum(adminAuditActionEnum.enumValues).optional()),
  resource: z.preprocess(blank, z.string().trim().max(100).optional()),
  /** Vendor: Business ID (any spelling), tenant UUID, or part of the vendor name. */
  vendor: z.preprocess(blank, z.string().trim().max(100).optional()),
  /** Free text over resource, resource id and details. */
  q: z.preprocess(blank, z.string().trim().max(100).optional()),
  from: z.preprocess(blank, dateOnly.optional()),
  /** Inclusive end date. */
  to: z.preprocess(blank, dateOnly.optional()),
  /** Legacy: last N days (used when from/to are not given). */
  days: z.preprocess(blank, z.coerce.number().int().min(1).max(3650).optional()),
})

export type AuditFilters = z.infer<typeof auditFilterSchema>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Vendor filter → tenant ids (Business ID / UUID exact, otherwise name match, max 50). */
async function resolveVendorIds(vendor: string): Promise<string[]> {
  if (UUID_RE.test(vendor)) return [vendor.toLowerCase()]
  const bid = normalizeBusinessId(vendor)
  if (bid) {
    const t = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.businessId, bid)).limit(1)
    if (t.length) return [t[0].id]
  }
  const pattern = `%${escapeLikePattern(vendor)}%`
  const rows = await db.select({ id: tenants.id }).from(tenants)
    .where(or(ilike(tenants.name, pattern), ilike(tenants.slug, pattern)))
    .limit(50)
  return rows.map((r) => r.id)
}

export async function auditWhere(f: AuditFilters): Promise<SQL | undefined> {
  const conds: SQL[] = []
  if (f.adminId) conds.push(eq(adminAuditLogs.superAdminId, f.adminId))
  if (f.action) conds.push(eq(adminAuditLogs.action, f.action))
  if (f.resource) conds.push(eq(adminAuditLogs.resource, f.resource))
  if (f.from) conds.push(gte(adminAuditLogs.createdAt, new Date(`${f.from}T00:00:00`)))
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00`)
    end.setDate(end.getDate() + 1)
    conds.push(lt(adminAuditLogs.createdAt, end))
  }
  if (!f.from && !f.to && f.days) conds.push(gte(adminAuditLogs.createdAt, new Date(Date.now() - f.days * 86_400_000)))
  if (f.vendor) {
    const ids = await resolveVendorIds(f.vendor)
    if (ids.length === 0) return sql`false`
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `)
    conds.push(sql`(${adminAuditLogs.resourceId} in (${idList}) or ${adminAuditLogs.details}->>'tenantId' in (${idList}))`)
  }
  if (f.q) {
    const pattern = `%${escapeLikePattern(f.q)}%`
    conds.push(or(
      ilike(adminAuditLogs.resource, pattern),
      sql`${adminAuditLogs.resourceId}::text ilike ${pattern}`,
      sql`${adminAuditLogs.details}::text ilike ${pattern}`,
      ilike(adminAuditLogs.ipAddress, pattern),
    )!)
  }
  return conds.length ? and(...conds) : undefined
}

export const auditRowColumns = {
  id: adminAuditLogs.id,
  action: adminAuditLogs.action,
  resource: adminAuditLogs.resource,
  resourceId: adminAuditLogs.resourceId,
  details: adminAuditLogs.details,
  ipAddress: adminAuditLogs.ipAddress,
  userAgent: adminAuditLogs.userAgent,
  createdAt: adminAuditLogs.createdAt,
  adminId: superAdmins.id,
  adminName: superAdmins.fullName,
  adminEmail: superAdmins.email,
  accountName: accounts.fullName,
  accountEmail: accounts.email,
  // Vendor named by the row (resource id or details.tenantId), when it still exists
  vendorId: tenants.id,
  vendorName: tenants.name,
  vendorBusinessId: tenants.businessId,
}

export function auditBaseQuery() {
  return db.select(auditRowColumns)
    .from(adminAuditLogs)
    .leftJoin(superAdmins, eq(superAdmins.id, adminAuditLogs.superAdminId))
    .leftJoin(accounts, eq(accounts.id, adminAuditLogs.accountId))
    .leftJoin(tenants, sql`${tenants.id} = coalesce(
      case when ${adminAuditLogs.details}->>'tenantId' ~* '^[0-9a-f-]{36}$' then (${adminAuditLogs.details}->>'tenantId')::uuid end,
      ${adminAuditLogs.resourceId})`)
    .$dynamic()
}

export const auditOrder = [desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id)]

export async function auditCount(where: SQL | undefined): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(adminAuditLogs).where(where)
  return row?.total ?? 0
}

/** RFC 4180 CSV cell; also neutralises spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

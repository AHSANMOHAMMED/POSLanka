import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminAuditLogs, superAdmins } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { auditBaseQuery, auditCount, auditFilterSchema, auditOrder, auditWhere } from '@/lib/admin/audit-query'

const listSchema = auditFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Legacy (overview widget): first N rows as a plain array. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Include the admin list for the filter (first page load). */
  meta: z.enum(['1', 'true']).optional(),
})

/**
 * GET /api/sys-control/audit-logs?adminId=&action=&resource=&vendor=&q=&from=&to=&page=&pageSize=
 * Paginated super-admin audit trail (newest first) with the acting admin and the vendor the
 * row refers to. `meta=1` adds the admins and resources for the filter controls.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }
    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, limit, meta, ...filters } = parsed.data
    const where = await auditWhere(filters)

    if (limit && !request.nextUrl.searchParams.has('page')) {
      const rows = await auditBaseQuery().where(where).orderBy(...auditOrder).limit(limit)
      return NextResponse.json(rows.map((r) => ({
        ...r,
        account: r.adminEmail ? { email: r.adminEmail, fullName: r.adminName } : r.accountEmail ? { email: r.accountEmail, fullName: r.accountName } : null,
      })))
    }

    const [logs, total, admins, resources] = await Promise.all([
      auditBaseQuery().where(where).orderBy(...auditOrder).limit(pageSize).offset((page - 1) * pageSize),
      auditCount(where),
      meta ? db.select({ id: superAdmins.id, fullName: superAdmins.fullName, email: superAdmins.email }).from(superAdmins).orderBy(asc(superAdmins.fullName)) : null,
      meta ? db.selectDistinct({ resource: adminAuditLogs.resource }).from(adminAuditLogs).orderBy(asc(adminAuditLogs.resource)).limit(200) : null,
    ])

    return NextResponse.json({
      logs,
      pagination: { page, pageSize, total },
      ...(meta ? {
        admins,
        resources: (resources ?? []).map((r) => r.resource),
      } : {}),
    })
  } catch (error) {
    logError('api/sys-control/audit-logs', error)
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }
}

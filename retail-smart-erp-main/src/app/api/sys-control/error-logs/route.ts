import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, gte, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { aiErrorLogs, tenants, users } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { escapeLikePattern } from '@/lib/utils/sql'
import { normalizeBusinessId } from '@/lib/tenant/business-id'

const blank = (v: unknown) => (v === '' || v === 'all' ? undefined : v)
const STATUSES = ['open', 'investigating', 'resolved', 'wont_fix'] as const

const listSchema = z.object({
  view: z.preprocess(blank, z.enum(['list', 'groups']).default('list')),
  level: z.preprocess(blank, z.enum(['error', 'warning', 'info']).optional()),
  source: z.preprocess(blank, z.enum(['system', 'user_report', 'frontend']).optional()),
  /** open (default: open + investigating), resolved (resolved + won't fix), or an exact status */
  status: z.preprocess(blank, z.enum(['unresolved', 'closed', ...STATUSES]).optional()),
  /** 'system' = no vendor, a tenant UUID, or a Business ID */
  vendor: z.preprocess(blank, z.string().trim().max(100).optional()),
  q: z.preprocess(blank, z.string().trim().max(200).optional()),
  groupHash: z.preprocess(blank, z.string().max(64).optional()),
  days: z.preprocess(blank, z.coerce.number().int().min(1).max(365).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeStats: z.enum(['true', '1']).optional(),
})

const statusExpr = sql<string>`coalesce(${aiErrorLogs.resolutionStatus}, 'open')`
const lastSeenExpr = sql`coalesce(${aiErrorLogs.lastOccurredAt}, ${aiErrorLogs.createdAt})`

async function buildWhere(f: z.infer<typeof listSchema>): Promise<SQL | undefined> {
  const conds: SQL[] = []
  if (f.level) conds.push(eq(aiErrorLogs.level, f.level))
  if (f.source) conds.push(f.source === 'system' ? sql`coalesce(${aiErrorLogs.errorSource}, 'system') = 'system'` : eq(aiErrorLogs.errorSource, f.source))
  if (f.status === 'unresolved') conds.push(sql`${statusExpr} in ('open', 'investigating')`)
  else if (f.status === 'closed') conds.push(sql`${statusExpr} in ('resolved', 'wont_fix')`)
  else if (f.status) conds.push(sql`${statusExpr} = ${f.status}`)
  if (f.vendor === 'system') conds.push(isNull(aiErrorLogs.tenantId))
  else if (f.vendor) {
    if (/^[0-9a-f-]{36}$/i.test(f.vendor)) conds.push(eq(aiErrorLogs.tenantId, f.vendor))
    else {
      const bid = normalizeBusinessId(f.vendor)
      const t = bid ? await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.businessId, bid)).limit(1) : []
      if (!t.length) return sql`false`
      conds.push(eq(aiErrorLogs.tenantId, t[0].id))
    }
  }
  if (f.groupHash) conds.push(eq(aiErrorLogs.groupHash, f.groupHash))
  if (f.q) {
    const p = `%${escapeLikePattern(f.q)}%`
    conds.push(or(ilike(aiErrorLogs.message, p), ilike(aiErrorLogs.source, p), ilike(aiErrorLogs.reportedUrl, p))!)
  }
  if (f.days) conds.push(gte(lastSeenExpr, new Date(Date.now() - f.days * 86_400_000)))
  return conds.length ? and(...conds) : undefined
}

/**
 * GET /api/sys-control/error-logs — error log for the whole platform.
 *   view=list    one row per stored entry (repeats within 24h are folded into occurrenceCount)
 *   view=groups  entries grouped by their group hash (same source + normalised message)
 * Filters: level, source, status, vendor, q, days. Stacks/context are served scrubbed by /[id].
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }
    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const f = parsed.data
    const where = await buildWhere(f)
    const offset = (f.page - 1) * f.pageSize

    const statsPromise = f.includeStats
      ? db.select({
        last24h: sql<number>`count(*) filter (where ${lastSeenExpr} >= now() - interval '24 hours')::int`,
        unresolved: sql<number>`count(*) filter (where ${statusExpr} in ('open', 'investigating'))::int`,
        userReports: sql<number>`count(*) filter (where ${aiErrorLogs.errorSource} = 'user_report' and ${statusExpr} in ('open', 'investigating'))::int`,
        occurrences24h: sql<number>`coalesce(sum(${aiErrorLogs.occurrenceCount}) filter (where ${lastSeenExpr} >= now() - interval '24 hours'), 0)::int`,
      }).from(aiErrorLogs).then((r) => r[0])
      : Promise.resolve(null)

    if (f.view === 'groups') {
      const groupKey = sql`coalesce(${aiErrorLogs.groupHash}, ${aiErrorLogs.id}::text)`
      const [groups, [count], stats] = await Promise.all([
        db.select({
          groupKey: sql<string>`${groupKey}`,
          groupHash: sql<string | null>`max(${aiErrorLogs.groupHash})`,
          entries: sql<number>`count(*)::int`,
          occurrences: sql<number>`coalesce(sum(${aiErrorLogs.occurrenceCount}), count(*))::int`,
          openEntries: sql<number>`count(*) filter (where ${statusExpr} in ('open', 'investigating'))::int`,
          vendors: sql<number>`count(distinct ${aiErrorLogs.tenantId})::int`,
          firstSeen: sql<string>`min(${aiErrorLogs.createdAt})`,
          lastSeen: sql<string>`max(${lastSeenExpr})`,
          latestId: sql<string>`(array_agg(${aiErrorLogs.id} order by ${lastSeenExpr} desc))[1]`,
          message: sql<string>`(array_agg(${aiErrorLogs.message} order by ${lastSeenExpr} desc))[1]`,
          source: sql<string>`(array_agg(${aiErrorLogs.source} order by ${lastSeenExpr} desc))[1]`,
          level: sql<string>`(array_agg(${aiErrorLogs.level}::text order by ${lastSeenExpr} desc))[1]`,
        })
          .from(aiErrorLogs)
          .where(where)
          .groupBy(groupKey)
          .orderBy(sql`max(${lastSeenExpr}) desc`)
          .limit(f.pageSize)
          .offset(offset),
        db.select({ total: sql<number>`count(distinct ${groupKey})::int` }).from(aiErrorLogs).where(where),
        statsPromise,
      ])
      return NextResponse.json({
        groups: groups.map((g) => ({ ...g, message: g.message?.slice(0, 500) ?? '' })),
        pagination: { page: f.page, pageSize: f.pageSize, total: count?.total ?? 0 },
        ...(stats ? { stats } : {}),
      })
    }

    const [logs, [count], stats] = await Promise.all([
      db.select({
        id: aiErrorLogs.id,
        tenantId: aiErrorLogs.tenantId,
        tenantName: tenants.name,
        tenantBusinessId: tenants.businessId,
        level: aiErrorLogs.level,
        source: aiErrorLogs.source,
        message: sql<string>`left(${aiErrorLogs.message}, 500)`,
        groupHash: aiErrorLogs.groupHash,
        errorSource: aiErrorLogs.errorSource,
        resolutionStatus: statusExpr,
        occurrenceCount: aiErrorLogs.occurrenceCount,
        createdAt: aiErrorLogs.createdAt,
        lastOccurredAt: aiErrorLogs.lastOccurredAt,
        resolvedAt: aiErrorLogs.resolvedAt,
        reportedByName: users.fullName,
      })
        .from(aiErrorLogs)
        .leftJoin(tenants, eq(aiErrorLogs.tenantId, tenants.id))
        .leftJoin(users, eq(aiErrorLogs.reportedByUserId, users.id))
        .where(where)
        .orderBy(desc(lastSeenExpr), desc(aiErrorLogs.id))
        .limit(f.pageSize)
        .offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(aiErrorLogs).where(where),
      statsPromise,
    ])

    return NextResponse.json({
      data: logs,
      pagination: { page: f.page, pageSize: f.pageSize, total: count?.total ?? 0, totalPages: Math.ceil((count?.total ?? 0) / f.pageSize) },
      ...(stats ? { stats } : {}),
    })
  } catch (error) {
    logError('api/sys-control/error-logs', error)
    return NextResponse.json({ error: 'Failed to fetch error logs' }, { status: 500 })
  }
}

const updateSchema = z.object({
  /** One entry … */
  id: z.string().uuid().optional(),
  /** … or every entry of a group */
  groupHash: z.string().min(1).max(64).optional(),
  resolutionStatus: z.enum(STATUSES).optional(),
  resolutionNotes: z.string().max(5000).optional(),
}).refine((v) => !!v.id !== !!v.groupHash, { message: 'Pass either id or groupHash', path: ['id'] })
  .refine((v) => v.resolutionStatus !== undefined || v.resolutionNotes !== undefined, { message: 'Nothing to update', path: ['resolutionStatus'] })

/**
 * PUT /api/sys-control/error-logs — resolve / ignore (won't fix) / investigate / reopen one entry
 * or a whole group, and/or save notes. Audited.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await validateAdminSession('error_logs')
    if (!session) {
      return adminAuthError()
    }
    const parsed = await validateBody(request, updateSchema, { keepEmptyStrings: true }) // '' clears the notes
    if (!parsed.success) return parsed.response
    const { id, groupHash, resolutionStatus, resolutionNotes } = parsed.data

    const updates: Partial<typeof aiErrorLogs.$inferInsert> = {}
    if (resolutionStatus !== undefined) {
      updates.resolutionStatus = resolutionStatus
      updates.resolvedAt = resolutionStatus === 'resolved' || resolutionStatus === 'wont_fix' ? new Date() : null
    }
    if (resolutionNotes !== undefined) updates.resolutionNotes = resolutionNotes || null

    const target = id ? eq(aiErrorLogs.id, id) : eq(aiErrorLogs.groupHash, groupHash!)
    const updated = await db.update(aiErrorLogs).set(updates).where(target).returning({ id: aiErrorLogs.id })
    if (updated.length === 0) return NextResponse.json({ error: 'Error log entry not found' }, { status: 404 })

    await adminAudit.update(session.superAdminId, 'error_log', id ?? updated[0].id, {
      op: resolutionStatus ? `status_${resolutionStatus}` : 'notes',
      ...(groupHash ? { groupHash, entries: updated.length } : {}),
      ...(resolutionNotes !== undefined ? { notes: resolutionNotes.slice(0, 200) } : {}),
    })

    return NextResponse.json({ success: true, updated: updated.length })
  } catch (error) {
    logError('api/sys-control/error-logs PUT', error)
    return NextResponse.json({ error: 'Failed to update error log' }, { status: 500 })
  }
}

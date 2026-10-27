import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, projects, warehouses } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { branchFilter, getBranchScope, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createProjectSchema, projectsListSchema } from '@/lib/validation/schemas/projects'
import { escapeLikePattern } from '@/lib/utils/sql'
import { nextDocNo } from '@/lib/documents/numbering'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { canManageProjects, projectTotalsSql, saveTasksAndMembers } from '@/lib/projects/server'

// GET /api/projects — projects (managers: their branches; staff: projects they are a member of)
// with hours logged, unbilled hours and amount invoiced
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, projectsListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, customerId, page, pageSize, all } = parsed.data
    const userId = await resolveUserIdRequired(session)

    return await withTenant(session.user.tenantId, async (db) => {
      const conds: SQL[] = [eq(projects.isActive, true)]
      if (canManageProjects(session)) {
        const scope = await getBranchScope(session, db)
        const b = branchFilter(scope, projects.warehouseId, { includeUnassigned: true })
        if (b) conds.push(b)
      } else {
        conds.push(sql`EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ${projects.id} AND m.user_id = ${userId}::uuid)`)
      }
      if (customerId) conds.push(eq(projects.customerId, customerId))
      if (search) {
        const q = `%${escapeLikePattern(search)}%`
        conds.push(or(ilike(projects.name, q), ilike(projects.projectNo, q), ilike(customers.name, q))!)
      }
      const chipWhere = and(...conds)
      if (status && status !== 'all') conds.push(eq(projects.status, status))
      const where = and(...conds)
      const countRows = await db.select({ status: projects.status, count: sql<number>`count(*)::int` })
        .from(projects).leftJoin(customers, eq(customers.id, projects.customerId)).where(chipWhere).groupBy(projects.status)
      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
        .from(projects).leftJoin(customers, eq(customers.id, projects.customerId)).where(where)
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const rows = await db.select({
        id: projects.id, projectNo: projects.projectNo, name: projects.name, customerId: projects.customerId, customerName: customers.name,
        warehouseName: warehouses.name, billingMethod: projects.billingMethod, fixedAmount: projects.fixedAmount, projectRate: projects.projectRate,
        budgetType: projects.budgetType, budgetHours: projects.budgetHours, budgetAmount: projects.budgetAmount, status: projects.status,
        startDate: projects.startDate, endDate: projects.endDate, createdAt: projects.createdAt, ...projectTotalsSql(),
      }).from(projects)
        .leftJoin(customers, eq(customers.id, projects.customerId))
        .leftJoin(warehouses, eq(warehouses.id, projects.warehouseId))
        .where(where)
        .orderBy(sql`CASE ${projects.status} WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END`, desc(projects.createdAt))
        .limit(limit).offset(all ? 0 : (page - 1) * pageSize)
      const counts: Record<string, number> = {}
      for (const r of countRows) counts[r.status] = r.count
      if (all) return NextResponse.json(rows)
      return NextResponse.json({ data: rows, counts, canManage: canManageProjects(session), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
    })
  } catch (error) {
    logError('api/projects', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

// POST /api/projects — create a project with its tasks and members
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError
    const parsed = await validateBody(request, createProjectSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const userId = await resolveUserIdRequired(session)
    const tenantId = session.user.tenantId

    const result = await withTenant(tenantId, async (db) => {
      const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, body.customerId))
      if (!customer) return { error: NextResponse.json({ error: 'Customer not found' }, { status: 400 }) }
      const branch = await resolveRecordBranch(session, db, body.warehouseId)
      if (branch.error) return { error: branch.error }
      const projectNo = await nextDocNo(db, tenantId, 'project')
      const [row] = await db.insert(projects).values({
        tenantId, projectNo, name: body.name, customerId: body.customerId, warehouseId: branch.warehouseId,
        description: body.description || null, billingMethod: body.billingMethod, fixedAmount: String(body.fixedAmount || 0),
        projectRate: String(body.projectRate || 0), budgetType: body.budgetType,
        budgetHours: body.budgetType === 'hours' && body.budgetHours != null ? String(body.budgetHours) : null,
        budgetAmount: body.budgetType === 'amount' && body.budgetAmount != null ? String(body.budgetAmount) : null,
        serviceItemId: body.serviceItemId || null, startDate: body.startDate || null, endDate: body.endDate || null,
        status: body.status, createdBy: userId,
      }).returning({ id: projects.id, projectNo: projects.projectNo, name: projects.name })
      const err = await saveTasksAndMembers(db, tenantId, row.id, body.tasks, body.members)
      if (err) throw Object.assign(new Error('ROLLBACK'), { response: err })
      return { row }
    }).catch((e) => {
      if (e?.response) return { error: e.response as NextResponse }
      throw e
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'project', 'created', result.row.id, { userId, entityName: result.row.name, description: `Created project ${result.row.projectNo}` })
    return NextResponse.json({ id: result.row.id, projectNo: result.row.projectNo }, { status: 201 })
  } catch (error) {
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/projects POST', error)
    return NextResponse.json({ error: 'Failed to create the project' }, { status: 500 })
  }
}

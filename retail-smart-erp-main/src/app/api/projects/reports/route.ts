import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { requireModule } from '@/lib/auth/roles'
import { getBranchScope } from '@/lib/auth/branch-access'
import { validateSearchParams } from '@/lib/validation/helpers'
import { projectReportSchema } from '@/lib/validation/schemas/projects'
import { logError } from '@/lib/ai/error-logger'
import { canManageProjects } from '@/lib/projects/server'
import { scopeSql } from '@/lib/payments-received/server'

function rows<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]
}

// GET /api/projects/reports — hours by project, hours by staff member, unbilled billable time.
// Managers: their branches' projects; other staff: their own time.
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, projectReportSchema)
    if (!parsed.success) return parsed.response
    const { fromDate, toDate, projectId } = parsed.data
    const userId = await resolveUserIdRequired(session)
    return await withTenant(session.user.tenantId, async (db) => {
      const manage = canManageProjects(session)
      const scope = manage ? await getBranchScope(session, db) : null
      const f = [sql`p.is_active`, sql`NOT e.is_running`]
      if (fromDate) f.push(sql`e.entry_date >= ${fromDate}::date`)
      if (toDate) f.push(sql`e.entry_date <= ${toDate}::date`)
      if (projectId) f.push(sql`e.project_id = ${projectId}::uuid`)
      if (!manage) f.push(sql`e.user_id = ${userId}::uuid`)
      const where = sql`${sql.join(f, sql` AND `)}${scopeSql(scope, 'p.warehouse_id')}`
      const billableCond = sql`e.billable AND COALESCE(t.billable, true)`
      const byProject = rows(await db.execute(sql`
        SELECT p.id, p.project_no AS "projectNo", p.name, c.name AS "customerName", p.billing_method AS "billingMethod",
               SUM(e.duration_minutes)::int AS minutes,
               SUM(e.duration_minutes) FILTER (WHERE ${billableCond})::int AS "billableMinutes",
               COALESCE(SUM(e.duration_minutes) FILTER (WHERE ${billableCond} AND NOT e.invoiced), 0)::int AS "unbilledMinutes",
               COALESCE(SUM(e.duration_minutes) FILTER (WHERE e.invoiced), 0)::int AS "invoicedMinutes",
               p.budget_type AS "budgetType", p.budget_hours::float AS "budgetHours"
        FROM project_time_entries e
        JOIN projects p ON p.id = e.project_id
        LEFT JOIN customers c ON c.id = p.customer_id
        LEFT JOIN project_tasks t ON t.id = e.task_id
        WHERE ${where}
        GROUP BY p.id, c.name ORDER BY minutes DESC`))
      const byUser = rows(await db.execute(sql`
        SELECT u.id, u.full_name AS name,
               SUM(e.duration_minutes)::int AS minutes,
               COALESCE(SUM(e.duration_minutes) FILTER (WHERE ${billableCond}), 0)::int AS "billableMinutes",
               COALESCE(SUM(e.duration_minutes) FILTER (WHERE ${billableCond} AND NOT e.invoiced), 0)::int AS "unbilledMinutes",
               COUNT(DISTINCT e.project_id)::int AS projects
        FROM project_time_entries e
        JOIN projects p ON p.id = e.project_id
        JOIN users u ON u.id = e.user_id
        LEFT JOIN project_tasks t ON t.id = e.task_id
        WHERE ${where}
        GROUP BY u.id ORDER BY minutes DESC`))
      const unbilled = rows(await db.execute(sql`
        SELECT e.id, e.entry_date::text AS "entryDate", e.duration_minutes AS minutes, e.notes,
               p.id AS "projectId", p.project_no AS "projectNo", p.name AS "projectName", t.name AS "taskName", u.full_name AS "userName"
        FROM project_time_entries e
        JOIN projects p ON p.id = e.project_id
        JOIN users u ON u.id = e.user_id
        LEFT JOIN project_tasks t ON t.id = e.task_id
        WHERE ${where} AND ${billableCond} AND NOT e.invoiced AND p.billing_method <> 'fixed'
        ORDER BY e.entry_date ASC LIMIT 500`))
      return NextResponse.json({ byProject, byUser, unbilled })
    })
  } catch (error) {
    logError('api/projects/reports', error)
    return NextResponse.json({ error: 'Failed to build the report' }, { status: 500 })
  }
}

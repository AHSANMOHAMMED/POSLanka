import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { escapeLikePattern } from '@/lib/utils/sql'
import { getBranchScope } from '@/lib/auth/branch-access'
import { requireAnyPermission } from '@/lib/pharmacy/route-helpers'

/**
 * GET /api/pharmacy/patients?q= — find a patient for the medication history: customers (name /
 * phone) and walk-in patients named on prescriptions (name / phone, no customer record).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['createSales', 'viewReports'])
    if (permError) return permError
    const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 100)
    if (q.length < 2) return NextResponse.json({ customers: [], walkIns: [] })
    const like = `%${escapeLikePattern(q)}%`
    const digits = q.replace(/\D/g, '')
    const phoneLike = digits.length >= 3 ? `%${digits}%` : null

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      const customers = ((await db.execute(sql`
        SELECT c.id, c.name, c.phone, c.mobile_phone AS "mobilePhone", c.allergies, c.medical_notes AS "medicalNotes"
        FROM customers c
        WHERE c.tenant_id = ${session.user.tenantId}::uuid AND (c.name ILIKE ${like}
          ${phoneLike ? sql`OR regexp_replace(coalesce(c.phone, '') || ' ' || coalesce(c.mobile_phone, ''), '\\D', '', 'g') LIKE ${phoneLike}` : sql``})
        ORDER BY c.name LIMIT 20
      `)) as unknown as { rows: unknown[] }).rows
      // Walk-in patients: prescriptions without a customer, grouped by name + phone
      const branch = scope ? sql` AND s.warehouse_id IN (${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``
      const walkIns = ((await db.execute(sql`
        SELECT min(p.patient_name) AS "patientName", min(p.patient_phone) AS "patientPhone", count(*)::int AS prescriptions, max(p.created_at) AS "lastVisit"
        FROM prescriptions p JOIN sales s ON s.id = p.sale_id
        WHERE p.tenant_id = ${session.user.tenantId}::uuid AND p.customer_id IS NULL AND p.patient_name IS NOT NULL
          AND (p.patient_name ILIKE ${like} ${phoneLike ? sql`OR regexp_replace(coalesce(p.patient_phone, ''), '\\D', '', 'g') LIKE ${phoneLike}` : sql``})${branch}
        GROUP BY lower(p.patient_name), regexp_replace(coalesce(p.patient_phone, ''), '\\D', '', 'g')
        ORDER BY max(p.created_at) DESC LIMIT 20
      `)) as unknown as { rows: unknown[] }).rows
      return NextResponse.json({ customers, walkIns })
    })
  } catch (error) {
    logError('api/pharmacy/patients', error)
    return NextResponse.json({ error: 'Failed to search patients' }, { status: 500 })
  }
}

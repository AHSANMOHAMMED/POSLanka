import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { hasPermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { prescriptions, sales, users } from '@/lib/db/schema'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'

/**
 * GET /api/prescriptions?q=&from=&to=&controlled=1&page=&pageSize= — the prescription register:
 * every sale that dispensed prescription / controlled medicines, with the doctor, patient and the
 * medicines on the bill. Pharmacy staff who sell (createSales) or managers (viewReports).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const can = (perm: 'createSales' | 'viewReports') => hasPermission(session.user.role, perm, session.user.tenantId, session.user.customRoleId)
    if (!can('createSales') && !can('viewReports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const sp = request.nextUrl.searchParams
    const page = Math.max(1, Number(sp.get('page')) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize')) || 50))
    const q = sp.get('q')?.trim()
    const from = sp.get('from')
    const to = sp.get('to')

    const where: SQL[] = [eq(prescriptions.tenantId, session.user.tenantId)]
    if (sp.get('controlled') === '1') where.push(eq(prescriptions.hasControlled, true))
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) where.push(gte(prescriptions.createdAt, new Date(`${from}T00:00:00`)))
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) where.push(lte(prescriptions.createdAt, new Date(`${to}T23:59:59.999`)))
    if (q) {
      const like = `%${escapeLikePattern(q)}%`
      where.push(sql`(${prescriptions.doctorName} ILIKE ${like} OR ${prescriptions.doctorRegNo} ILIKE ${like} OR ${prescriptions.patientName} ILIKE ${like}
        OR ${prescriptions.prescriptionNo} ILIKE ${like} OR ${sales.invoiceNo} ILIKE ${like})`)
    }
    const cond = and(...where)

    return await withTenant(session.user.tenantId, async (db) => {
      const [rows, [{ n }]] = await Promise.all([
        db.select({
          id: prescriptions.id, createdAt: prescriptions.createdAt, saleId: prescriptions.saleId, invoiceNo: sales.invoiceNo, total: sales.total,
          prescriptionNo: prescriptions.prescriptionNo, prescriptionDate: prescriptions.prescriptionDate,
          patientName: prescriptions.patientName, patientAge: prescriptions.patientAge, patientPhone: prescriptions.patientPhone,
          doctorName: prescriptions.doctorName, doctorRegNo: prescriptions.doctorRegNo, hospital: prescriptions.hospital,
          hasControlled: prescriptions.hasControlled, notes: prescriptions.notes, dispensedBy: users.fullName,
          medicines: sql<string | null>`(SELECT string_agg(si.item_name || ' × ' || trim(to_char(si.quantity, 'FM999999990.###')), ', ' ORDER BY si.item_name)
            FROM sale_items si JOIN items it ON it.id = si.item_id
            WHERE si.sale_id = ${prescriptions.saleId} AND it.drug_schedule IN ('prescription', 'controlled'))`,
        })
          .from(prescriptions)
          .leftJoin(sales, eq(sales.id, prescriptions.saleId))
          .leftJoin(users, eq(users.id, prescriptions.createdBy))
          .where(cond)
          .orderBy(desc(prescriptions.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: sql<number>`count(*)::int` }).from(prescriptions).leftJoin(sales, eq(sales.id, prescriptions.saleId)).where(cond),
      ])
      return NextResponse.json({ data: rows, pagination: { page, pageSize, total: n, totalPages: Math.ceil(n / pageSize) } })
    })
  } catch (error) {
    logError('api/prescriptions GET', error)
    return NextResponse.json({ error: 'Failed to load prescriptions' }, { status: 500 })
  }
}

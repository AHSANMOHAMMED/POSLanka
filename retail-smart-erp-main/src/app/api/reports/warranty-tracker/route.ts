import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { sql } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    if (session.user.businessType !== 'dealership') {
      return NextResponse.json({ error: 'This report is only available for dealership businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Query vehicle warranties with related vehicle and sale info
      const rows = await db.execute(sql`
        SELECT
          vw.id,
          vw.warranty_type AS "warrantyType",
          vw.provider,
          vw.policy_number AS "policyNumber",
          vw.start_date AS "startDate",
          vw.end_date AS "endDate",
          vw.mileage_limit AS "mileageLimit",
          vw.coverage_details AS "coverageDetails",
          CAST(vw.price AS numeric) AS "price",
          vw.status,
          vw.created_at AS "createdAt",
          s.invoice_no AS "invoiceNo",
          s.customer_name AS "customerName",
          COALESCE(vm.name, '') AS "vehicleMake",
          COALESCE(vmod.name, '') AS "vehicleModel",
          vi.year AS "vehicleYear",
          vi.vin
        FROM vehicle_warranties vw
        JOIN sales s ON s.id = vw.sale_id
        JOIN vehicle_inventory vi ON vi.id = vw.vehicle_inventory_id
        LEFT JOIN vehicle_makes vm ON vm.id = vi.make_id
        LEFT JOIN vehicle_models vmod ON vmod.id = vi.model_id
        WHERE vw.tenant_id = ${session.user.tenantId}
          AND vw.created_at >= ${fromDate}::date
          AND vw.created_at < (${toDate}::date + interval '1 day')
        ORDER BY vw.created_at DESC
      `)

      const data = (rows.rows || []).map((r: Record<string, unknown>) => ({
        id: r.id,
        warrantyType: r.warrantyType || 'N/A',
        provider: r.provider || 'N/A',
        policyNumber: r.policyNumber || '',
        startDate: r.startDate,
        endDate: r.endDate,
        mileageLimit: r.mileageLimit,
        coverageDetails: r.coverageDetails,
        price: Number(r.price) || 0,
        status: r.status,
        createdAt: r.createdAt,
        invoiceNo: r.invoiceNo,
        customerName: r.customerName || 'Walk-in',
        vehicleInfo: [r.vehicleYear, r.vehicleMake, r.vehicleModel].filter(Boolean).join(' '),
        vin: r.vin || '',
      }))

      const totalClaims = data.length
      const totalCost = data.reduce((s: number, d: { price: number }) => s + d.price, 0)
      const avgCost = totalClaims > 0 ? totalCost / totalClaims : 0

      const byType: Record<string, number> = {}
      for (const d of data) {
        const t = String(d.warrantyType)
        byType[t] = (byType[t] || 0) + 1
      }

      return NextResponse.json({
        summary: {
          totalClaims,
          totalCost,
          avgCostPerClaim: avgCost,
        },
        byType,
        data,
      })
    })
  } catch (error) {
    logError('api/reports/warranty-tracker', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

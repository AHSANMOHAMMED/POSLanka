import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { sql } from 'drizzle-orm'
import { requireAllBranches } from '@/lib/auth/branch-access'
import { hasBusinessType } from '@/lib/business-types/scope'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError
    // K4: a company-wide report, not split by branch: refused for branch-restricted users
    const branchError = await requireAllBranches(session)
    if (branchError) return branchError

    const isElectronics = hasBusinessType(session.user, 'electronics')
    if (!hasBusinessType(session.user, 'dealership') && !isElectronics) {
      return NextResponse.json({ error: 'This report is only available for dealership and electronics businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 })
    }

    // 0193: electronics — units / lines sold with a shop warranty in the period, with their
    // serial / IMEI, warranty end, active / expired, and the warranty claims raised on them
    if (isElectronics) {
      return await withTenant(session.user.tenantId, async (db) => {
        const rows = await db.execute(sql`
          SELECT si.id || COALESCE(':' || sn.id::text, '') AS id,
                 s.created_at AS "createdAt", s.invoice_no AS "invoiceNo", COALESCE(c.name, s.customer_name) AS "customerName",
                 si.item_name AS "itemName", COALESCE(sn.serial_number, '') AS serial, COALESCE(sn.imei, '') AS imei,
                 si.warranty_months AS "warrantyMonths",
                 COALESCE(sn.warranty_end_date, si.warranty_until)::text AS "endDate",
                 (s.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo')::date::text AS "startDate",
                 CAST(si.total AS numeric) AS price,
                 (SELECT count(*)::int FROM warranty_claims wc
                   WHERE wc.sale_item_id = si.id OR (sn.id IS NOT NULL AND wc.serial_number_id = sn.id)) AS claims
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          LEFT JOIN customers c ON c.id = s.customer_id
          LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(si.serial_number_ids, '[]'::jsonb)) AS sid(v) ON true
          LEFT JOIN item_serial_numbers sn ON sn.id::text = sid.v
          WHERE s.is_return = false AND s.status <> 'void'
            AND (si.warranty_until IS NOT NULL OR sn.warranty_end_date IS NOT NULL)
            AND s.created_at >= ${fromDate}::date
            AND s.created_at < (${toDate}::date + interval '1 day')
          ORDER BY s.created_at DESC
          LIMIT 5000
        `)
        const today = new Date().toISOString().slice(0, 10)
        const data = ((rows.rows || []) as Array<Record<string, unknown>>).map((r) => {
          const end = (r.endDate as string | null) || null
          const claims = Number(r.claims) || 0
          return {
            id: String(r.id),
            warrantyType: r.warrantyMonths ? `${r.warrantyMonths} months` : 'Shop warranty',
            provider: claims > 0 ? `${claims} claim${claims > 1 ? 's' : ''}` : '—',
            policyNumber: String(r.imei || r.serial || ''),
            startDate: r.startDate,
            endDate: end,
            mileageLimit: null,
            coverageDetails: null,
            price: Number(r.price) || 0,
            status: claims > 0 ? 'claimed' : end && end >= today ? 'active' : 'expired',
            createdAt: r.createdAt,
            invoiceNo: r.invoiceNo,
            customerName: (r.customerName as string) || 'Walk-in',
            vehicleInfo: String(r.itemName || ''),
            vin: String(r.imei || r.serial || ''),
          }
        })
        const byType: Record<string, number> = {}
        for (const d of data) byType[d.status] = (byType[d.status] || 0) + 1
        const totalCost = data.reduce((s2, d) => s2 + d.price, 0)
        return NextResponse.json({
          kind: 'units',
          summary: { totalClaims: data.length, totalCost, avgCostPerClaim: data.length ? totalCost / data.length : 0 },
          byType,
          data,
        })
      })
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

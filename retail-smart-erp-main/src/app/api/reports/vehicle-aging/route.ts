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
    const asOfDate = searchParams.get('asOfDate') || new Date().toISOString().split('T')[0]

    return await withTenant(session.user.tenantId, async (db) => {
      const rows = await db.execute(sql`
        SELECT
          vi.id,
          COALESCE(vm.name, '') AS "make",
          COALESCE(vmod.name, '') AS "model",
          vi.year,
          vi.vin,
          vi.stock_no AS "stockNo",
          vi.status,
          vi.condition AS "vehicleCondition",
          vi.purchase_date AS "acquiredDate",
          CAST(vi.asking_price AS numeric) AS "listPrice",
          CAST(vi.purchase_price AS numeric) AS "purchasePrice",
          EXTRACT(DAY FROM (${asOfDate}::date - vi.purchase_date::date)) AS "daysInInventory"
        FROM vehicle_inventory vi
        LEFT JOIN vehicle_makes vm ON vm.id = vi.make_id
        LEFT JOIN vehicle_models vmod ON vmod.id = vi.model_id
        WHERE vi.tenant_id = ${session.user.tenantId}
          AND vi.status != 'sold'
          AND vi.is_active = true
          AND vi.purchase_date IS NOT NULL
        ORDER BY "daysInInventory" DESC NULLS LAST
      `)

      const data = (rows.rows || []).map((r: Record<string, unknown>) => ({
        id: r.id,
        make: r.make,
        model: r.model,
        year: r.year,
        vin: r.vin || '',
        stockNo: r.stockNo || '',
        status: r.status,
        vehicleCondition: r.vehicleCondition || 'N/A',
        acquiredDate: r.acquiredDate,
        listPrice: Number(r.listPrice) || 0,
        purchasePrice: Number(r.purchasePrice) || 0,
        daysInInventory: Number(r.daysInInventory) || 0,
      }))

      // Aging buckets
      const buckets = [
        { label: '0-30 days', min: 0, max: 30 },
        { label: '31-60 days', min: 31, max: 60 },
        { label: '61-90 days', min: 61, max: 90 },
        { label: '91-120 days', min: 91, max: 120 },
        { label: '120+ days', min: 121, max: Infinity },
      ]

      const agingBuckets = buckets.map((bucket) => {
        const vehicles = data.filter(
          (d: { daysInInventory: number }) => d.daysInInventory >= bucket.min && d.daysInInventory <= bucket.max
        )
        return {
          label: bucket.label,
          count: vehicles.length,
          totalValue: vehicles.reduce((s: number, v: { listPrice: number }) => s + v.listPrice, 0),
        }
      })

      const totalVehicles = data.length
      const totalInventoryValue = data.reduce((s: number, d: { listPrice: number }) => s + d.listPrice, 0)
      const avgDays = totalVehicles > 0
        ? data.reduce((s: number, d: { daysInInventory: number }) => s + d.daysInInventory, 0) / totalVehicles
        : 0

      return NextResponse.json({
        summary: {
          totalVehicles,
          avgDaysInInventory: Math.round(avgDays),
          totalInventoryValue,
        },
        agingBuckets,
        data,
      })
    })
  } catch (error) {
    logError('api/reports/vehicle-aging', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

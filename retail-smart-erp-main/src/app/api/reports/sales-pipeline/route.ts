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
      // Count total vehicle inventory items added in the period (new leads/listings)
      const inventoryResult = await db.execute(sql`
        SELECT COUNT(*) AS count
        FROM vehicle_inventory
        WHERE tenant_id = ${session.user.tenantId}
          AND created_at >= ${fromDate}::date
          AND created_at < (${toDate}::date + interval '1 day')
      `)
      const totalInventoryAdded = Number((inventoryResult.rows || [])[0]?.count) || 0

      // Count test drives in the period by status
      const testDriveResult = await db.execute(sql`
        SELECT
          status,
          COUNT(*) AS count
        FROM test_drives
        WHERE tenant_id = ${session.user.tenantId}
          AND created_at >= ${fromDate}::date
          AND created_at < (${toDate}::date + interval '1 day')
        GROUP BY status
      `)
      const testDrivesByStatus: Record<string, number> = {}
      let totalTestDrives = 0
      for (const row of (testDriveResult.rows || [])) {
        const r = row as Record<string, unknown>
        testDrivesByStatus[r.status as string] = Number(r.count) || 0
        totalTestDrives += Number(r.count) || 0
      }

      // Count vehicle sales in the period (vehicleSaleDetails linked to completed sales)
      const salesResult = await db.execute(sql`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM(CAST(s.total AS numeric)), 0) AS "totalValue"
        FROM vehicle_sale_details vsd
        JOIN sales s ON s.id = vsd.sale_id
        WHERE s.tenant_id = ${session.user.tenantId}
          AND s.created_at >= ${fromDate}::date
          AND s.created_at < (${toDate}::date + interval '1 day')
          AND s.status != 'void'
          AND s.is_return = false
      `)
      const totalSales = Number((salesResult.rows || [])[0]?.count) || 0
      const totalSalesValue = Number((salesResult.rows || [])[0]?.totalValue) || 0

      // Count vehicles currently available (pipeline)
      const availableResult = await db.execute(sql`
        SELECT
          status,
          COUNT(*) AS count
        FROM vehicle_inventory
        WHERE tenant_id = ${session.user.tenantId}
          AND is_active = true
        GROUP BY status
      `)
      const inventoryByStatus: Record<string, number> = {}
      for (const row of (availableResult.rows || [])) {
        const r = row as Record<string, unknown>
        inventoryByStatus[r.status as string] = Number(r.count) || 0
      }

      // Build funnel stages
      const funnel = [
        { stage: 'Vehicles Listed', count: totalInventoryAdded, value: null as number | null },
        { stage: 'Test Drives', count: totalTestDrives, value: null as number | null },
        { stage: 'Completed Sales', count: totalSales, value: totalSalesValue },
      ]

      // Conversion rates
      const testDriveRate = totalInventoryAdded > 0
        ? ((totalTestDrives / totalInventoryAdded) * 100)
        : 0
      const closeRate = totalTestDrives > 0
        ? ((totalSales / totalTestDrives) * 100)
        : 0
      const overallConversion = totalInventoryAdded > 0
        ? ((totalSales / totalInventoryAdded) * 100)
        : 0

      return NextResponse.json({
        summary: {
          totalInventoryAdded,
          totalTestDrives,
          totalSales,
          totalSalesValue,
          testDriveConversionRate: Math.round(testDriveRate * 10) / 10,
          closeRate: Math.round(closeRate * 10) / 10,
          overallConversionRate: Math.round(overallConversion * 10) / 10,
        },
        funnel,
        testDrivesByStatus,
        inventoryByStatus,
      })
    })
  } catch (error) {
    logError('api/reports/sales-pipeline', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

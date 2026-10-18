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

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')
    const groupBy = searchParams.get('groupBy') || 'item'

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      let rows

      if (groupBy === 'category') {
        rows = await db.execute(sql`
          SELECT
            COALESCE(c.name, 'Uncategorized') AS "name",
            SUM(CAST(si.total AS numeric)) AS "totalRevenue",
            SUM(CAST(si.quantity AS numeric) * CAST(COALESCE(i.cost_price, '0') AS numeric)) AS "totalCost",
            SUM(CAST(si.quantity AS numeric)) AS "unitsSold"
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          LEFT JOIN items i ON i.id = si.item_id
          LEFT JOIN categories c ON c.id = i.category_id
          WHERE si.tenant_id = ${session.user.tenantId}
            AND s.created_at >= ${fromDate}::date
            AND s.created_at < (${toDate}::date + interval '1 day')
            AND s.status != 'void'
            AND s.is_return = false
          GROUP BY c.name
          ORDER BY "totalRevenue" DESC
        `)
      } else {
        rows = await db.execute(sql`
          SELECT
            COALESCE(i.name, si.item_name) AS "name",
            i.sku,
            SUM(CAST(si.total AS numeric)) AS "totalRevenue",
            SUM(CAST(si.quantity AS numeric) * CAST(COALESCE(i.cost_price, '0') AS numeric)) AS "totalCost",
            SUM(CAST(si.quantity AS numeric)) AS "unitsSold"
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          LEFT JOIN items i ON i.id = si.item_id
          WHERE si.tenant_id = ${session.user.tenantId}
            AND s.created_at >= ${fromDate}::date
            AND s.created_at < (${toDate}::date + interval '1 day')
            AND s.status != 'void'
            AND s.is_return = false
          GROUP BY COALESCE(i.name, si.item_name), i.sku
          ORDER BY "totalRevenue" DESC
        `)
      }

      const data = (rows.rows || []).map((r: Record<string, unknown>) => {
        const totalRevenue = Number(r.totalRevenue) || 0
        const totalCost = Number(r.totalCost) || 0
        const grossProfit = totalRevenue - totalCost
        const marginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

        return {
          name: r.name,
          sku: r.sku || '',
          totalRevenue,
          totalCost,
          grossProfit,
          marginPct: Math.round(marginPct * 10) / 10,
          unitsSold: Number(r.unitsSold) || 0,
        }
      })

      // Overall summary
      const overallRevenue = data.reduce((s: number, d: { totalRevenue: number }) => s + d.totalRevenue, 0)
      const overallCost = data.reduce((s: number, d: { totalCost: number }) => s + d.totalCost, 0)
      const overallProfit = overallRevenue - overallCost
      const overallMargin = overallRevenue > 0 ? (overallProfit / overallRevenue) * 100 : 0

      return NextResponse.json({
        summary: {
          totalRevenue: overallRevenue,
          totalCost: overallCost,
          totalProfit: overallProfit,
          overallMarginPct: Math.round(overallMargin * 10) / 10,
          itemCount: data.length,
        },
        groupBy,
        data,
      })
    })
  } catch (error) {
    logError('api/reports/margin-analysis', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

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

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Stock take items with non-zero variance, joined with stock takes for date filtering
      const rows = await db.execute(sql`
        SELECT
          sti.id,
          sti.item_name AS "itemName",
          sti.item_sku AS "sku",
          CAST(sti.expected_quantity AS numeric) AS "expectedQty",
          CAST(sti.counted_quantity AS numeric) AS "actualQty",
          CAST(sti.variance AS numeric) AS "variance",
          CAST(sti.cost_price AS numeric) AS "costPrice",
          CAST(sti.variance_value AS numeric) AS "varianceValue",
          st.count_no AS "stockTakeNo",
          st.created_at AS "stockTakeDate",
          sti.notes
        FROM stock_take_items sti
        JOIN stock_takes st ON st.id = sti.stock_take_id
        WHERE sti.tenant_id = ${session.user.tenantId}
          AND st.tenant_id = ${session.user.tenantId}
          AND st.status IN ('completed', 'pending_review')
          AND st.created_at >= ${fromDate}::date
          AND st.created_at < (${toDate}::date + interval '1 day')
          AND sti.variance IS NOT NULL
          AND CAST(sti.variance AS numeric) != 0
        ORDER BY CAST(sti.variance_value AS numeric) ASC
      `)

      const data = (rows.rows || []).map((r: Record<string, unknown>) => ({
        id: r.id,
        itemName: r.itemName,
        sku: r.sku || '',
        expectedQty: Number(r.expectedQty) || 0,
        actualQty: Number(r.actualQty) || 0,
        variance: Number(r.variance) || 0,
        costPrice: Number(r.costPrice) || 0,
        varianceValue: Number(r.varianceValue) || 0,
        stockTakeNo: r.stockTakeNo,
        stockTakeDate: r.stockTakeDate,
        notes: r.notes,
      }))

      // Calculate summary
      let totalShortageValue = 0
      let totalExcessValue = 0
      let shortageCount = 0
      let excessCount = 0

      for (const d of data) {
        if (d.varianceValue < 0) {
          totalShortageValue += Math.abs(d.varianceValue)
          shortageCount++
        } else {
          totalExcessValue += d.varianceValue
          excessCount++
        }
      }

      const netVariance = totalExcessValue - totalShortageValue

      return NextResponse.json({
        summary: {
          totalShortageValue,
          totalExcessValue,
          netVariance,
          itemsAffected: data.length,
          shortageCount,
          excessCount,
        },
        data,
      })
    })
  } catch (error) {
    logError('api/reports/shrinkage-report', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

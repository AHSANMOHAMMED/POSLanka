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

    if (session.user.businessType !== 'restaurant') {
      return NextResponse.json({ error: 'This report is only available for restaurant businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Stock movements of type 'adjustment' with negative quantity represent waste/write-offs/damage
      // referenceType or notes may contain the reason (e.g., 'write_off', 'waste', 'damage', 'expired')
      const rows = await db.execute(sql`
        SELECT
          sm.id,
          sm.item_id AS "itemId",
          i.name AS "itemName",
          i.sku,
          COALESCE(c.name, 'Uncategorized') AS "category",
          ABS(CAST(sm.quantity AS numeric)) AS "quantity",
          CAST(COALESCE(i.cost_price, '0') AS numeric) AS "costPrice",
          ABS(CAST(sm.quantity AS numeric)) * CAST(COALESCE(i.cost_price, '0') AS numeric) AS "totalValue",
          COALESCE(sm.reference_type, 'adjustment') AS "reason",
          sm.notes,
          sm.created_at AS "date"
        FROM stock_movements sm
        JOIN items i ON i.id = sm.item_id
        LEFT JOIN categories c ON c.id = i.category_id
        WHERE sm.tenant_id = ${session.user.tenantId}
          AND sm.type = 'adjustment'
          AND CAST(sm.quantity AS numeric) < 0
          AND sm.created_at >= ${fromDate}::date
          AND sm.created_at < (${toDate}::date + interval '1 day')
        ORDER BY sm.created_at DESC
      `)

      const data = (rows.rows || []).map((r: Record<string, unknown>) => ({
        id: r.id,
        itemId: r.itemId,
        itemName: r.itemName,
        sku: r.sku || '',
        category: r.category,
        quantity: Number(r.quantity) || 0,
        costPrice: Number(r.costPrice) || 0,
        totalValue: Number(r.totalValue) || 0,
        reason: r.reason,
        notes: r.notes,
        date: r.date,
      }))

      const totalWasteValue = data.reduce((s: number, d: { totalValue: number }) => s + d.totalValue, 0)
      const totalItemsWasted = data.reduce((s: number, d: { quantity: number }) => s + d.quantity, 0)

      // Find top wasted item by total value
      const wasteByItem: Record<string, { name: string; value: number }> = {}
      for (const d of data) {
        const key = d.itemId as string
        if (!wasteByItem[key]) wasteByItem[key] = { name: d.itemName as string, value: 0 }
        wasteByItem[key].value += d.totalValue
      }
      const topWastedItem = Object.values(wasteByItem).sort((a, b) => b.value - a.value)[0]?.name || 'N/A'

      // Waste by category for chart — sorted by value descending
      const wasteByCategoryUnsorted: Record<string, number> = {}
      for (const d of data) {
        const cat = d.category as string
        wasteByCategoryUnsorted[cat] = (wasteByCategoryUnsorted[cat] || 0) + d.totalValue
      }
      const wasteByCategory: Record<string, number> = {}
      for (const [k, v] of Object.entries(wasteByCategoryUnsorted).sort(([, a], [, b]) => b - a)) {
        wasteByCategory[k] = Math.round(v * 100) / 100
      }

      return NextResponse.json({
        summary: {
          totalWasteValue: Math.round(totalWasteValue * 100) / 100,
          totalItemsWasted: Math.round(totalItemsWasted * 1000) / 1000,
          topWastedItem,
          recordCount: data.length,
        },
        byCategory: wasteByCategory,
        data,
      })
    })
  } catch (error) {
    logError('api/reports/waste-analysis', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

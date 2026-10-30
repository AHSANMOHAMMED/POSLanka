/**
 * K1 — owner / manager dashboard figures (GET /api/dashboard/owner). All maths in SQL numeric,
 * rounded to cents at the end.
 *
 *  stock value     Σ positive on-hand qty × items.cost_price (at cost) and × items.selling_price
 *                  (at selling price) of stock-tracked items, per branch and in total.
 *  gross profit    for sales created in [from, to] (tenant's local days), not voided, returns
 *                  included (negative): revenue = sale total − sale tax (what the GL books as
 *                  revenue), spread over the sale's lines in proportion to the line totals so
 *                  cart discounts / promotions / loyalty land on the lines; cost of goods =
 *                  quantity × sale_items.unit_cost (the cost recorded at sale time, the same as
 *                  the GL's COGS). Gift-card lines are liabilities, not revenue: excluded.
 *  top items       the same per item, ordered by profit.
 *  cheques         open cheques (in hand / deposited) dated today … today + 7, per direction;
 *                  overdue = open and dated before today; bounced = status bounced.
 *  expiring        active batches with stock expiring today … today + 30 (and already expired).
 *  low stock       branch stock at or below its reorder level (warehouse_stock.min_stock > 0).
 */
import { sql, type SQL } from 'drizzle-orm'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}
const money = (v: unknown) => roundCurrency(parseCurrency(v as string))
const qty = (v: unknown) => Math.round((Number(v) || 0) * 1000) / 1000

/**
 * CTE `l`: one row per sale line of the period with its revenue, cost and base-unit quantity (see
 * "gross profit" above). Shared with the super-admin vendor reports so both show the same profit.
 * `filter` adds conditions on `sales`.
 */
export function saleProfitLines(tenantId: string, from: string, to: string, filter: SQL = sql``): SQL {
  return sql`
    WITH s AS (
      SELECT id, (total - tax_amount) AS net FROM sales
      WHERE tenant_id = ${tenantId} AND status <> 'void'
        AND created_at >= ${from}::timestamp AND created_at <= ${to}::timestamp${filter}
    ), li AS (
      SELECT si.sale_id, si.item_id, si.item_name, si.quantity, si.uom_factor, si.total AS line_total,
             COALESCE(si.unit_cost, 0) AS unit_cost, COALESCE(i.is_gift_card, false) AS gift_card,
             SUM(si.total) OVER (PARTITION BY si.sale_id) AS sale_lines, s.net
      FROM sale_items si JOIN s ON s.id = si.sale_id
      LEFT JOIN items i ON i.id = si.item_id
      WHERE si.tenant_id = ${tenantId}
    ), l AS (
      SELECT sale_id, item_id, item_name, quantity, quantity * uom_factor AS base_qty,
             CASE WHEN sale_lines <> 0 THEN net * line_total / sale_lines ELSE 0 END AS revenue,
             quantity * unit_cost AS cost
      FROM li WHERE NOT gift_card
    )`
}

export interface OwnerDashboardInput {
  tenantId: string
  warehouseId?: string | null
  /** K4: a branch-restricted user's branches (null = every branch) */
  warehouseIds?: string[] | null
  /** UTC instants bounding the period (tenantDayRange) */
  from: Date
  to: Date
  /** tenant-local today, YYYY-MM-DD */
  today: string
  topItems?: number
}

export async function ownerDashboard(tx: Tx, input: OwnerDashboardInput) {
  const { tenantId } = input
  const wh = input.warehouseId || null
  const from = input.from.toISOString()
  const to = input.to.toISOString()
  const today = input.today
  const top = input.topItems ?? 10
  // K4: limit every figure to the user's branches (column given as trusted SQL text)
  const ids = input.warehouseIds
  const inScope = (col: string) => ids
    ? sql` AND ${sql.raw(col)} IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``

  // ---------------------------------------------------------------- stock value
  const stockRows = rows<{ warehouse_id: string; name: string; at_cost: string; at_price: string; units: string; lines: number }>(await tx.execute(sql`
    SELECT w.id AS warehouse_id, w.name,
           COALESCE(SUM(GREATEST(x.current_stock, 0) * x.cost_price), 0) AS at_cost,
           COALESCE(SUM(GREATEST(x.current_stock, 0) * x.selling_price), 0) AS at_price,
           COALESCE(SUM(GREATEST(x.current_stock, 0)), 0) AS units,
           count(*) FILTER (WHERE x.current_stock > 0)::int AS lines
    FROM warehouses w
    LEFT JOIN (
      SELECT ws.warehouse_id, ws.current_stock, i.cost_price, i.selling_price
      FROM warehouse_stock ws JOIN items i ON i.id = ws.item_id AND i.track_stock AND NOT i.is_gift_card
      WHERE ws.tenant_id = ${tenantId}
    ) x ON x.warehouse_id = w.id
    WHERE w.tenant_id = ${tenantId} AND w.is_active
      AND (${wh}::uuid IS NULL OR w.id = ${wh}::uuid)${inScope('w.id')}
    GROUP BY w.id, w.name
    ORDER BY w.name
  `))
  const byBranch = stockRows.map((r) => ({
    warehouseId: r.warehouse_id, name: r.name, atCost: money(r.at_cost), atSellingPrice: money(r.at_price),
    potentialMargin: roundCurrency(money(r.at_price) - money(r.at_cost)), units: qty(r.units), itemsInStock: r.lines,
  }))
  const stock = {
    byBranch,
    atCost: roundCurrency(byBranch.reduce((s, b) => s + b.atCost, 0)),
    atSellingPrice: roundCurrency(byBranch.reduce((s, b) => s + b.atSellingPrice, 0)),
    potentialMargin: 0,
  }
  stock.potentialMargin = roundCurrency(stock.atSellingPrice - stock.atCost)

  // ---------------------------------------------------------------- gross profit + top items
  const lines = saleProfitLines(tenantId, from, to, sql`
        AND (${wh}::uuid IS NULL OR warehouse_id = ${wh}::uuid)${inScope('warehouse_id')}`)
  const [gp] = rows<{ revenue: string; cost: string; sales: number }>(await tx.execute(sql`
    ${lines}
    SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(cost), 0) AS cost, count(DISTINCT sale_id)::int AS sales FROM l
  `))
  const revenue = money(gp?.revenue)
  const cogs = money(gp?.cost)
  const grossProfit = roundCurrency(revenue - cogs)
  const topRows = rows<{ item_id: string | null; item_name: string; qty: string; revenue: string; cost: string }>(await tx.execute(sql`
    ${lines}
    SELECT item_id, MIN(item_name) AS item_name, SUM(quantity) AS qty, SUM(revenue) AS revenue, SUM(cost) AS cost
    FROM l GROUP BY item_id, CASE WHEN item_id IS NULL THEN item_name END
    ORDER BY SUM(revenue) - SUM(cost) DESC, MIN(item_name)
    LIMIT ${top}
  `))
  const topItems = topRows.map((r) => {
    const rev = money(r.revenue)
    const cost = money(r.cost)
    const profit = roundCurrency(rev - cost)
    return { itemId: r.item_id, name: r.item_name, quantity: qty(r.qty), revenue: rev, cost, profit, marginPercent: rev !== 0 ? Math.round((profit / rev) * 10000) / 100 : null }
  })

  // ---------------------------------------------------------------- cheques
  const chequeRows = rows<{
    id: string; direction: 'received' | 'issued'; cheque_no: string; bank_name: string; cheque_date: string; amount: string;
    status: string; party: string | null; bucket: 'due' | 'overdue' | 'bounced'
  }>(await tx.execute(sql`
    SELECT c.id, c.direction, c.cheque_no, c.bank_name, c.cheque_date::text AS cheque_date, c.amount, c.status,
           COALESCE(cu.name, su.name, c.party_name) AS party,
           CASE WHEN c.status = 'bounced' THEN 'bounced'
                WHEN c.cheque_date < ${today}::date THEN 'overdue' ELSE 'due' END AS bucket
    FROM cheques c
    LEFT JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN suppliers su ON su.id = c.supplier_id
    WHERE c.tenant_id = ${tenantId}
      AND (${wh}::uuid IS NULL OR c.warehouse_id = ${wh}::uuid)${inScope('c.warehouse_id')}
      AND (c.status = 'bounced' OR (c.status IN ('pending', 'deposited') AND c.cheque_date <= ${today}::date + 7))
    ORDER BY c.cheque_date, c.cheque_no
  `))
  const sum = (list: typeof chequeRows) => roundCurrency(list.reduce((s, c) => s + money(c.amount), 0))
  const toCheque = (c: typeof chequeRows[number]) => ({
    id: c.id, direction: c.direction, chequeNo: c.cheque_no, bankName: c.bank_name, chequeDate: c.cheque_date,
    amount: money(c.amount), status: c.status, party: c.party,
  })
  const due = chequeRows.filter((c) => c.bucket === 'due')
  const overdue = chequeRows.filter((c) => c.bucket === 'overdue')
  const bounced = chequeRows.filter((c) => c.bucket === 'bounced')
  const cheques = {
    next7Days: {
      received: { count: due.filter((c) => c.direction === 'received').length, amount: sum(due.filter((c) => c.direction === 'received')) },
      issued: { count: due.filter((c) => c.direction === 'issued').length, amount: sum(due.filter((c) => c.direction === 'issued')) },
      list: due.slice(0, 50).map(toCheque),
    },
    overdue: { count: overdue.length, amount: sum(overdue), list: overdue.slice(0, 50).map(toCheque) },
    bounced: { count: bounced.length, amount: sum(bounced), list: bounced.slice(0, 50).map(toCheque) },
  }

  // ---------------------------------------------------------------- expiring batches
  const batchRows = rows<{ id: string; item_id: string; name: string; batch_number: string; expiry_date: string; qty: string; value: string; warehouse: string | null; expired: boolean }>(await tx.execute(sql`
    SELECT b.id, b.item_id, i.name, b.batch_number, b.expiry_date::text AS expiry_date, b.current_quantity AS qty,
           b.current_quantity * i.cost_price AS value, w.name AS warehouse, (b.expiry_date < ${today}::date) AS expired
    FROM item_batches b
    JOIN items i ON i.id = b.item_id
    LEFT JOIN warehouses w ON w.id = b.warehouse_id
    WHERE b.tenant_id = ${tenantId} AND b.status = 'active' AND b.current_quantity > 0
      AND b.expiry_date IS NOT NULL AND b.expiry_date <= ${today}::date + 30
      AND (${wh}::uuid IS NULL OR b.warehouse_id = ${wh}::uuid)${inScope('b.warehouse_id')}
    ORDER BY b.expiry_date, i.name
    LIMIT 500
  `))
  const soon = batchRows.filter((b) => !b.expired)
  const expired = batchRows.filter((b) => b.expired)
  const toBatch = (b: typeof batchRows[number]) => ({
    id: b.id, itemId: b.item_id, name: b.name, batchNumber: b.batch_number, expiryDate: b.expiry_date,
    quantity: qty(b.qty), valueAtCost: money(b.value), warehouse: b.warehouse,
  })
  const expiring = {
    next30Days: { count: soon.length, quantity: qty(soon.reduce((s, b) => s + Number(b.qty), 0)), valueAtCost: roundCurrency(soon.reduce((s, b) => s + money(b.value), 0)), list: soon.slice(0, 50).map(toBatch) },
    expired: { count: expired.length, quantity: qty(expired.reduce((s, b) => s + Number(b.qty), 0)), valueAtCost: roundCurrency(expired.reduce((s, b) => s + money(b.value), 0)), list: expired.slice(0, 50).map(toBatch) },
  }

  // ---------------------------------------------------------------- low stock
  const lowRows = rows<{ item_id: string; name: string; warehouse_id: string; warehouse: string; current: string; min: string; reorder_qty: string | null }>(await tx.execute(sql`
    SELECT i.id AS item_id, i.name, w.id AS warehouse_id, w.name AS warehouse, ws.current_stock AS current, ws.min_stock AS min, ws.reorder_qty
    FROM warehouse_stock ws
    JOIN items i ON i.id = ws.item_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.tenant_id = ${tenantId} AND i.is_active AND i.track_stock AND w.is_active
      AND ws.min_stock > 0 AND ws.current_stock <= ws.min_stock
      AND (${wh}::uuid IS NULL OR ws.warehouse_id = ${wh}::uuid)${inScope('ws.warehouse_id')}
    ORDER BY ws.current_stock / NULLIF(ws.min_stock, 0), i.name
    LIMIT 500
  `))
  const lowStock = {
    count: lowRows.length,
    outOfStock: lowRows.filter((r) => Number(r.current) <= 0).length,
    list: lowRows.slice(0, 50).map((r) => ({
      itemId: r.item_id, name: r.name, warehouseId: r.warehouse_id, warehouse: r.warehouse,
      current: qty(r.current), reorderLevel: qty(r.min), reorderQty: r.reorder_qty != null ? qty(r.reorder_qty) : null,
    })),
  }

  return {
    stock,
    profit: {
      sales: gp?.sales || 0,
      revenue,
      costOfGoods: cogs,
      grossProfit,
      marginPercent: revenue !== 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null,
      topItems,
    },
    cheques,
    expiring,
    lowStock,
  }
}

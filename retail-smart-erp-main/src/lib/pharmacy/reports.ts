/**
 * Pharmacy reports (all read-only, derived from sales, prescriptions, batches and the stock ledger):
 *   - sales by generic name (all brands of one medicine together)
 *   - prescription-only / controlled sales (bills, lines, value) and prescriptions recorded
 *   - expiry loss: expired stock still on the shelf (value at cost) and stock written off as expired
 *   - return-to-supplier list: short-dated batches grouped by supplier, with the purchase that
 *     brought them in (the purchase return is made from that purchase)
 */
import { sql, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'

type Db = Pick<TenantDb, 'execute'>

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}
const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface PeriodQuery {
  tenantId: string
  from: string
  to: string
  scope: string[] | null
  warehouseId?: string | null
}

function branchCond(col: string, q: { scope: string[] | null; warehouseId?: string | null }): SQL {
  if (q.warehouseId) return sql` AND ${sql.raw(col)} = ${q.warehouseId}::uuid`
  if (q.scope) return sql` AND ${sql.raw(col)} IN (${sql.join(q.scope.map((id) => sql`${id}::uuid`), sql`, `)})`
  return sql``
}

export interface GenericSalesRow { genericName: string; brands: number; bills: number; quantity: number; revenue: number; cost: number }

export async function salesByGeneric(db: Db, q: PeriodQuery): Promise<GenericSalesRow[]> {
  const res = rows<{ generic: string; brands: string; bills: string; qty: string; revenue: string; cost: string }>(await db.execute(sql`
    SELECT min(trim(i.generic_name)) AS generic, count(DISTINCT i.id) AS brands, count(DISTINCT s.id) AS bills,
      sum(si.quantity - si.returned_quantity) AS qty,
      sum(CASE WHEN si.quantity > 0 THEN si.total * (si.quantity - si.returned_quantity) / si.quantity ELSE 0 END) AS revenue,
      sum((si.quantity - si.returned_quantity) * coalesce(si.unit_cost, i.cost_price, 0)) AS cost
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN items i ON i.id = si.item_id
    WHERE s.tenant_id = ${q.tenantId}::uuid AND s.status <> 'void' AND s.is_return = false
      AND i.generic_name IS NOT NULL AND trim(i.generic_name) <> ''
      AND s.created_at >= ${`${q.from} 00:00:00`}::timestamp AND s.created_at <= ${`${q.to} 23:59:59.999`}::timestamp
      ${branchCond('s.warehouse_id', q)}
    GROUP BY lower(trim(i.generic_name))
    ORDER BY revenue DESC NULLS LAST
    LIMIT 500
  `))
  return res.map((r) => ({
    genericName: r.generic, brands: Number(r.brands), bills: Number(r.bills), quantity: r3(Number(r.qty)),
    revenue: r2(Number(r.revenue)), cost: r2(Number(r.cost)),
  }))
}

export interface RxSummary {
  prescriptions: number
  controlledPrescriptions: number
  rxBills: number
  rxLines: number
  rxValue: number
  controlledBills: number
  controlledValue: number
  totalBills: number
  totalValue: number
}

export async function prescriptionSummary(db: Db, q: PeriodQuery): Promise<RxSummary> {
  const range = sql`s.created_at >= ${`${q.from} 00:00:00`}::timestamp AND s.created_at <= ${`${q.to} 23:59:59.999`}::timestamp`
  const [lines] = rows<Record<string, string>>(await db.execute(sql`
    SELECT
      count(DISTINCT s.id) FILTER (WHERE i.drug_schedule IN ('prescription', 'controlled')) AS rx_bills,
      count(*) FILTER (WHERE i.drug_schedule IN ('prescription', 'controlled')) AS rx_lines,
      coalesce(sum(si.total) FILTER (WHERE i.drug_schedule IN ('prescription', 'controlled')), 0) AS rx_value,
      count(DISTINCT s.id) FILTER (WHERE i.drug_schedule = 'controlled') AS c_bills,
      coalesce(sum(si.total) FILTER (WHERE i.drug_schedule = 'controlled'), 0) AS c_value,
      count(DISTINCT s.id) AS bills,
      coalesce(sum(si.total), 0) AS value
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN items i ON i.id = si.item_id
    WHERE s.tenant_id = ${q.tenantId}::uuid AND s.status <> 'void' AND s.is_return = false AND ${range}
      ${branchCond('s.warehouse_id', q)}
  `))
  const [rx] = rows<{ n: string; c: string }>(await db.execute(sql`
    SELECT count(*) AS n, count(*) FILTER (WHERE p.has_controlled) AS c
    FROM prescriptions p JOIN sales s ON s.id = p.sale_id
    WHERE p.tenant_id = ${q.tenantId}::uuid AND s.status <> 'void' AND ${range}${branchCond('s.warehouse_id', q)}
  `))
  return {
    prescriptions: Number(rx?.n || 0),
    controlledPrescriptions: Number(rx?.c || 0),
    rxBills: Number(lines?.rx_bills || 0),
    rxLines: Number(lines?.rx_lines || 0),
    rxValue: r2(Number(lines?.rx_value || 0)),
    controlledBills: Number(lines?.c_bills || 0),
    controlledValue: r2(Number(lines?.c_value || 0)),
    totalBills: Number(lines?.bills || 0),
    totalValue: r2(Number(lines?.value || 0)),
  }
}

export interface ExpiryLoss {
  /** expired batches still in stock today (value at cost) */
  expiredOnHand: { batches: number; quantity: number; value: number }
  /** stock adjusted out with reason "expiry" in the period (value at today's cost) */
  writtenOff: { movements: number; quantity: number; value: number }
  items: Array<{ itemId: string; name: string; expiredQty: number; expiredValue: number; writtenOffQty: number; writtenOffValue: number }>
}

export async function expiryLoss(db: Db, q: PeriodQuery): Promise<ExpiryLoss> {
  const onHand = rows<{ item_id: string; name: string; batches: string; qty: string; value: string }>(await db.execute(sql`
    SELECT b.item_id, i.name, count(*) AS batches, sum(b.current_quantity) AS qty, sum(b.current_quantity * coalesce(i.cost_price, 0)) AS value
    FROM item_batches b JOIN items i ON i.id = b.item_id
    WHERE b.tenant_id = ${q.tenantId}::uuid AND b.expiry_date < CURRENT_DATE AND b.current_quantity > 0
      ${branchCond('b.warehouse_id', q)}
    GROUP BY b.item_id, i.name
  `))
  const written = rows<{ item_id: string; name: string; n: string; qty: string; value: string }>(await db.execute(sql`
    SELECT sm.item_id, i.name, count(*) AS n, sum(-sm.qty_change) AS qty, sum(-sm.qty_change * coalesce(i.cost_price, 0)) AS value
    FROM stock_movements sm JOIN items i ON i.id = sm.item_id
    WHERE sm.tenant_id = ${q.tenantId}::uuid AND sm.reason_code = 'expiry' AND sm.qty_change < 0
      AND sm.created_at >= ${`${q.from} 00:00:00`}::timestamp AND sm.created_at <= ${`${q.to} 23:59:59.999`}::timestamp
      ${branchCond('sm.warehouse_id', q)}
    GROUP BY sm.item_id, i.name
  `))
  const map = new Map<string, ExpiryLoss['items'][number]>()
  const get = (id: string, name: string) => {
    let e = map.get(id)
    if (!e) { e = { itemId: id, name, expiredQty: 0, expiredValue: 0, writtenOffQty: 0, writtenOffValue: 0 }; map.set(id, e) }
    return e
  }
  for (const r of onHand) Object.assign(get(r.item_id, r.name), { expiredQty: r3(Number(r.qty)), expiredValue: r2(Number(r.value)) })
  for (const r of written) Object.assign(get(r.item_id, r.name), { writtenOffQty: r3(Number(r.qty)), writtenOffValue: r2(Number(r.value)) })
  return {
    expiredOnHand: {
      batches: onHand.reduce((s, r) => s + Number(r.batches), 0),
      quantity: r3(onHand.reduce((s, r) => s + Number(r.qty), 0)),
      value: r2(onHand.reduce((s, r) => s + Number(r.value), 0)),
    },
    writtenOff: {
      movements: written.reduce((s, r) => s + Number(r.n), 0),
      quantity: r3(written.reduce((s, r) => s + Number(r.qty), 0)),
      value: r2(written.reduce((s, r) => s + Number(r.value), 0)),
    },
    items: Array.from(map.values()).sort((a, b) => (b.expiredValue + b.writtenOffValue) - (a.expiredValue + a.writtenOffValue)),
  }
}

export interface ReturnListBatch {
  batchId: string
  batchNumber: string
  expiryDate: string | null
  daysLeft: number
  quantity: number
  value: number
  itemId: string
  itemName: string
  genericName: string | null
  strength: string | null
  warehouseName: string | null
  /** the purchase invoice that brought this batch in (make the purchase return from it) */
  purchaseId: string | null
  purchaseNo: string | null
  supplierInvoiceNo: string | null
}

export interface ReturnListSupplier {
  supplierId: string | null
  supplierName: string
  batches: ReturnListBatch[]
  value: number
}

/** Batches expired or expiring within `days`, grouped by the supplier they came from */
export async function returnToSupplierList(db: Db, q: { tenantId: string; days: number; scope: string[] | null; warehouseId?: string | null }): Promise<ReturnListSupplier[]> {
  const res = rows<{
    batch_id: string; batch_number: string; expiry_date: string | null; days_left: number; qty: string; cost: string | null
    item_id: string; item_name: string; generic_name: string | null; strength: string | null; warehouse_name: string | null
    supplier_id: string | null; supplier_name: string | null; purchase_id: string | null; purchase_no: string | null; supplier_invoice_no: string | null
  }>(await db.execute(sql`
    SELECT b.id AS batch_id, b.batch_number, b.expiry_date::text AS expiry_date, (b.expiry_date - CURRENT_DATE)::int AS days_left,
      b.current_quantity AS qty, i.cost_price AS cost, i.id AS item_id, i.name AS item_name, i.generic_name, i.strength,
      w.name AS warehouse_name,
      coalesce(b.supplier_id, p.supplier_id) AS supplier_id, sup.name AS supplier_name,
      p.id AS purchase_id, p.purchase_no, p.supplier_invoice_no
    FROM item_batches b
    JOIN items i ON i.id = b.item_id
    LEFT JOIN warehouses w ON w.id = b.warehouse_id
    LEFT JOIN LATERAL (
      SELECT pu.id, pu.purchase_no, pu.supplier_invoice_no, pu.supplier_id FROM purchase_doc_batches d
      JOIN purchases pu ON pu.id = d.document_id
      WHERE d.batch_id = b.id AND d.document_type = 'purchase' AND d.reversed_at IS NULL AND pu.is_return = false
      ORDER BY d.created_at LIMIT 1
    ) p ON true
    LEFT JOIN suppliers sup ON sup.id = coalesce(b.supplier_id, p.supplier_id)
    WHERE b.tenant_id = ${q.tenantId}::uuid AND b.expiry_date IS NOT NULL AND b.current_quantity > 0
      AND b.expiry_date <= CURRENT_DATE + ${Math.max(0, Math.min(730, Math.round(q.days)))}::int
      ${branchCond('b.warehouse_id', { scope: q.scope, warehouseId: q.warehouseId })}
    ORDER BY sup.name NULLS LAST, b.expiry_date, i.name
    LIMIT 2000
  `))
  const groups = new Map<string, ReturnListSupplier>()
  for (const r of res) {
    const key = r.supplier_id || 'none'
    let g = groups.get(key)
    if (!g) { g = { supplierId: r.supplier_id, supplierName: r.supplier_name || 'Supplier not recorded', batches: [], value: 0 }; groups.set(key, g) }
    const value = r2(Number(r.qty) * Number(r.cost || 0))
    g.batches.push({
      batchId: r.batch_id, batchNumber: r.batch_number, expiryDate: r.expiry_date, daysLeft: Number(r.days_left), quantity: r3(Number(r.qty)), value,
      itemId: r.item_id, itemName: r.item_name, genericName: r.generic_name, strength: r.strength, warehouseName: r.warehouse_name,
      purchaseId: r.purchase_id, purchaseNo: r.purchase_no, supplierInvoiceNo: r.supplier_invoice_no,
    })
    g.value = r2(g.value + value)
  }
  return Array.from(groups.values())
}

/**
 * Dealership reports (Dealership → Reports, GET /api/dealership/reports).
 *
 * Vehicle cost everywhere = landed cost of an imported vehicle (else its purchase price) plus its
 * capitalised expenses (vehicle_inventory.total_expenses) — the same figure a vehicle sale stores
 * as the invoice line's unit cost. Every query runs inside withTenant (RLS) and takes the user's
 * branch scope (K4): vehicles and dealers of other branches are left out for restricted staff.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { branchSqlFilter, type BranchScope } from '@/lib/auth/branch-access'

export const DEALERSHIP_REPORTS = ['aging', 'profit', 'import-tax', 'dealers', 'documents'] as const
export type DealershipReport = typeof DEALERSHIP_REPORTS[number]

type Row = Record<string, unknown>
const rows = (res: unknown): Row[] => ((res as { rows?: Row[] }).rows) || []
const n = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100

const COST = sql.raw(`(COALESCE(v.landed_cost, v.purchase_price, 0) + COALESCE(v.total_expenses, 0))`)

function sum(list: Row[], key: string): number {
  return n(list.reduce((s, r) => s + (Number(r[key]) || 0), 0))
}

/** Unsold vehicles by days in stock (since purchase date, else the day they were added). */
export async function vehicleAging(db: TenantDb, scope: BranchScope, today: string) {
  const res = await db.execute(sql`
    SELECT v.id, v.stock_no, v.vin, v.year, mk.name AS make, md.name AS model, v.status, v.condition,
           w.name AS branch, COALESCE(v.purchase_date, v.created_at::date) AS since,
           (${today}::date - COALESCE(v.purchase_date, v.created_at::date)) AS days,
           ${COST} AS cost, v.asking_price
      FROM vehicle_inventory v
      LEFT JOIN vehicle_makes mk ON mk.id = v.make_id
      LEFT JOIN vehicle_models md ON md.id = v.model_id
      LEFT JOIN warehouses w ON w.id = v.warehouse_id
     WHERE v.is_active = true AND v.sale_id IS NULL AND COALESCE(v.status, 'available') <> 'sold'${branchSqlFilter(scope, 'v.warehouse_id')}
     ORDER BY days DESC NULLS LAST
     LIMIT 2000`)
  const list = rows(res).map((r) => ({
    id: r.id, stockNo: r.stock_no, vin: r.vin, year: r.year, make: r.make, model: r.model, status: r.status,
    condition: r.condition, branch: r.branch, since: r.since, days: Math.max(0, Number(r.days) || 0),
    cost: n(r.cost), askingPrice: r.asking_price == null ? null : n(r.asking_price),
  }))
  const bucket = (lo: number, hi: number | null) => {
    const b = list.filter((v) => v.days >= lo && (hi === null || v.days <= hi))
    return { label: hi === null ? `${lo}+ days` : `${lo}–${hi} days`, count: b.length, cost: sum(b, 'cost') }
  }
  return {
    buckets: [bucket(0, 30), bucket(31, 60), bucket(61, 90), bucket(91, null)],
    totals: { count: list.length, cost: sum(list, 'cost'), askingPrice: sum(list, 'askingPrice') },
    rows: list,
  }
}

/** Every vehicle sold in the period: price without tax, cost, gross profit, commission. */
export async function vehicleProfit(db: TenantDb, scope: BranchScope, from: Date, to: Date) {
  const res = await db.execute(sql`
    SELECT s.id AS sale_id, s.invoice_no, s.created_at AS sold_at, v.id, v.stock_no, v.vin, v.year,
           mk.name AS make, md.name AS model, c.name AS customer, u.full_name AS salesperson,
           (s.total - s.tax_amount) AS revenue, ${COST} AS cost, COALESCE(d.commission_amount, 0) AS commission
      FROM vehicle_sale_details d
      JOIN sales s ON s.id = d.sale_id
      JOIN vehicle_inventory v ON v.id = d.vehicle_inventory_id
      LEFT JOIN vehicle_makes mk ON mk.id = v.make_id
      LEFT JOIN vehicle_models md ON md.id = v.model_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = d.salesperson_id
     WHERE s.status <> 'void'
       AND s.created_at >= ${from.toISOString()}::timestamp AND s.created_at <= ${to.toISOString()}::timestamp
       ${branchSqlFilter(scope, 'COALESCE(s.warehouse_id, v.warehouse_id)')}
     ORDER BY s.created_at DESC
     LIMIT 2000`)
  const list = rows(res).map((r) => {
    const revenue = n(r.revenue), cost = n(r.cost), commission = n(r.commission)
    const profit = n(revenue - cost - commission)
    return {
      saleId: r.sale_id, invoiceNo: r.invoice_no, soldAt: r.sold_at, id: r.id, stockNo: r.stock_no, vin: r.vin,
      year: r.year, make: r.make, model: r.model, customer: r.customer, salesperson: r.salesperson,
      revenue, cost, commission, profit, marginPercent: revenue ? n((profit / revenue) * 100) : null,
    }
  })
  const revenue = sum(list, 'revenue'), profit = sum(list, 'profit')
  return {
    totals: { count: list.length, revenue, cost: sum(list, 'cost'), commission: sum(list, 'commission'), profit, marginPercent: revenue ? n((profit / revenue) * 100) : null },
    rows: list,
  }
}

/** Import duties and taxes of vehicles that arrived (else were recorded) in the period. */
export async function importTaxSummary(db: TenantDb, scope: BranchScope, fromDate: string, toDate: string) {
  const res = await db.execute(sql`
    SELECT i.id, i.import_no, i.status, COALESCE(i.arrival_date, i.created_at::date) AS on_date, i.hs_code,
           v.year, mk.name AS make, md.name AS model, v.vin,
           COALESCE(i.cif_value_lkr, 0) AS cif, COALESCE(i.customs_import_duty, 0) AS customs_duty,
           COALESCE(i.surcharge, 0) AS surcharge, COALESCE(i.excise_duty, 0) AS excise_duty,
           COALESCE(i.luxury_tax, 0) AS luxury_tax, COALESCE(i.vat_amount, 0) AS vat,
           COALESCE(i.pal_charge, 0) + COALESCE(i.cess_fee, 0) AS pal_cess,
           COALESCE(i.total_taxes, 0) AS total_taxes, COALESCE(i.total_landed_cost, 0) AS landed_cost
      FROM vehicle_imports i
      LEFT JOIN vehicle_inventory v ON v.id = i.vehicle_inventory_id
      LEFT JOIN vehicle_makes mk ON mk.id = v.make_id
      LEFT JOIN vehicle_models md ON md.id = v.model_id
     WHERE COALESCE(i.arrival_date, i.created_at::date) BETWEEN ${fromDate}::date AND ${toDate}::date
       ${scope ? sql`AND v.warehouse_id IS NOT NULL${branchSqlFilter(scope, 'v.warehouse_id')}` : sql``}
     ORDER BY on_date DESC
     LIMIT 2000`)
  const list = rows(res).map((r) => ({
    id: r.id, importNo: r.import_no, status: r.status, date: r.on_date, hsCode: r.hs_code,
    year: r.year, make: r.make, model: r.model, vin: r.vin,
    cif: n(r.cif), customsDuty: n(r.customs_duty), surcharge: n(r.surcharge), exciseDuty: n(r.excise_duty),
    luxuryTax: n(r.luxury_tax), vat: n(r.vat), palCess: n(r.pal_cess), totalTaxes: n(r.total_taxes), landedCost: n(r.landed_cost),
  }))
  const keys = ['cif', 'customsDuty', 'surcharge', 'exciseDuty', 'luxuryTax', 'vat', 'palCess', 'totalTaxes', 'landedCost'] as const
  return {
    totals: Object.fromEntries([['count', list.length], ...keys.map((k) => [k, sum(list, k)])]) as Record<string, number>,
    rows: list,
  }
}

/** Per dealer: vehicles with them now, allocated and returned in the period, sold, money. */
export async function dealerPerformance(db: TenantDb, scope: BranchScope, from: Date, to: Date) {
  const f = from.toISOString(), t = to.toISOString()
  const res = await db.execute(sql`
    SELECT d.id, d.name, d.code, d.status, d.territory, w.name AS branch, COALESCE(d.current_balance, 0) AS balance,
           COALESCE(d.credit_limit, 0) AS credit_limit,
           (SELECT count(*) FROM dealer_allocations a WHERE a.dealer_id = d.id AND a.status = 'allocated')::int AS holding,
           (SELECT count(*) FROM dealer_allocations a WHERE a.dealer_id = d.id
              AND a.allocated_at >= ${f}::timestamp AND a.allocated_at <= ${t}::timestamp)::int AS allocated,
           (SELECT count(*) FROM dealer_allocations a WHERE a.dealer_id = d.id AND a.returned_at IS NOT NULL
              AND a.returned_at >= ${f}::timestamp AND a.returned_at <= ${t}::timestamp)::int AS returned,
           (SELECT count(*) FROM dealer_allocations a JOIN vehicle_inventory v ON v.id = a.vehicle_inventory_id
              WHERE a.dealer_id = d.id AND a.status = 'sold' AND v.sold_date BETWEEN ${f}::timestamp::date AND ${t}::timestamp::date)::int AS sold,
           (SELECT COALESCE(sum(p.amount), 0) FROM dealer_payments p WHERE p.dealer_id = d.id AND p.status <> 'cancelled'
              AND p.direction = 'inbound' AND p.payment_date BETWEEN ${f}::timestamp::date AND ${t}::timestamp::date) AS received,
           (SELECT COALESCE(sum(p.amount), 0) FROM dealer_payments p WHERE p.dealer_id = d.id AND p.status <> 'cancelled'
              AND p.direction = 'outbound' AND p.payment_date BETWEEN ${f}::timestamp::date AND ${t}::timestamp::date) AS paid
      FROM dealers d
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
     WHERE d.is_active = true${branchSqlFilter(scope, 'd.warehouse_id')}
     ORDER BY d.name
     LIMIT 1000`)
  const list = rows(res).map((r) => ({
    id: r.id, name: r.name, code: r.code, status: r.status, territory: r.territory, branch: r.branch,
    holding: Number(r.holding) || 0, allocated: Number(r.allocated) || 0, returned: Number(r.returned) || 0, sold: Number(r.sold) || 0,
    received: n(r.received), paid: n(r.paid), balance: n(r.balance), creditLimit: n(r.credit_limit),
  }))
  return {
    totals: { dealers: list.length, holding: list.reduce((s, d) => s + d.holding, 0), sold: list.reduce((s, d) => s + d.sold, 0), received: sum(list, 'received'), balance: sum(list, 'balance') },
    rows: list,
  }
}

/** Vehicle, import and dealer documents expired or expiring within `days`. */
export async function documentExpiry(db: TenantDb, scope: BranchScope, today: string, days: number) {
  const branch: SQL = scope
    ? sql` AND COALESCE(v.warehouse_id, dv.warehouse_id, dl.warehouse_id) IS NOT NULL${branchSqlFilter(scope, 'COALESCE(v.warehouse_id, dv.warehouse_id, dl.warehouse_id)')}`
    : sql``
  const res = await db.execute(sql`
    SELECT doc.id, doc.name, doc.document_type, doc.document_no, doc.expiry_date, (doc.expiry_date - ${today}::date) AS days_left,
           doc.vehicle_inventory_id, doc.vehicle_import_id, doc.dealer_id,
           COALESCE(v.stock_no, dv.stock_no) AS stock_no, COALESCE(v.vin, dv.vin) AS vin, i.import_no, dl.name AS dealer
      FROM vehicle_documents doc
      LEFT JOIN vehicle_inventory v ON v.id = doc.vehicle_inventory_id
      LEFT JOIN vehicle_imports i ON i.id = doc.vehicle_import_id
      LEFT JOIN vehicle_inventory dv ON dv.id = i.vehicle_inventory_id
      LEFT JOIN dealers dl ON dl.id = doc.dealer_id
     WHERE doc.expiry_date IS NOT NULL AND doc.expiry_date <= (${today}::date + ${days}::int)${branch}
     ORDER BY doc.expiry_date
     LIMIT 2000`)
  const list = rows(res).map((r) => ({
    id: r.id, name: r.name, type: r.document_type, documentNo: r.document_no, expiryDate: r.expiry_date,
    daysLeft: Number(r.days_left), vehicleId: r.vehicle_inventory_id, importId: r.vehicle_import_id, dealerId: r.dealer_id,
    stockNo: r.stock_no, vin: r.vin, importNo: r.import_no, dealer: r.dealer,
  }))
  return {
    totals: { expired: list.filter((d) => d.daysLeft < 0).length, expiring: list.filter((d) => d.daysLeft >= 0).length },
    rows: list,
  }
}

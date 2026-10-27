/**
 * Sale / serial lookups shared by hire purchase, deliveries and warranty claims (drizzle/0181).
 * Server-only. Callers pass a tenant-scoped handle (RLS) and the user's branch scope.
 */
import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import type { BranchScope } from '@/lib/auth/branch-access'
import { branchSqlFilter } from '@/lib/auth/branch-access'

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || (Array.isArray(res) ? (res as T[]) : [])
}

export interface LookupSaleLine {
  saleItemId: string
  itemId: string | null
  itemName: string
  quantity: number
  unitPrice: number
  total: number
  warrantyMonths: number | null
  warrantyUntil: string | null
  serialNumbers: Array<{ id: string; serialNumber: string; warrantyEndDate: string | null }>
}

export interface LookupSale {
  id: string
  invoiceNo: string
  createdAt: string
  saleDate: string
  warehouseId: string | null
  warehouseName: string | null
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  total: number
  paidAmount: number
  balance: number
  status: string
  isReturn: boolean
  lines: LookupSaleLine[]
}

/** Sales whose invoice no matches exactly (case-insensitive), with lines and serials. */
export async function findSaleByInvoice(db: DbTx, invoiceNo: string, scope: BranchScope): Promise<LookupSale | null> {
  const ids = rowsOf<{ id: string }>(await db.execute(sql`
    SELECT s.id FROM sales s
    WHERE lower(s.invoice_no) = lower(${invoiceNo.trim()}) ${branchSqlFilter(scope, 's.warehouse_id')}
    ORDER BY s.created_at DESC LIMIT 1
  `))
  if (!ids[0]) return null
  const [sale] = await loadSales(db, [ids[0].id])
  return sale ?? null
}

/** Full sales (header + lines + serials) for ids, newest first */
export async function loadSales(db: DbTx, saleIds: string[]): Promise<LookupSale[]> {
  if (saleIds.length === 0) return []
  const list = sql.join(saleIds.map((id) => sql`${id}::uuid`), sql`, `)
  const heads = rowsOf<{
    id: string; invoice_no: string; created_at: string; sale_date: string; warehouse_id: string | null; warehouse_name: string | null
    customer_id: string | null; customer_name: string | null; customer_phone: string | null; customer_address: string | null
    total: string; paid_amount: string; status: string; is_return: boolean
  }>(await db.execute(sql`
    SELECT s.id, s.invoice_no, s.created_at::text AS created_at,
           (s.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo')::date::text AS sale_date,
           s.warehouse_id, w.name AS warehouse_name,
           s.customer_id, COALESCE(c.name, s.customer_name) AS customer_name,
           COALESCE(c.mobile_phone, c.phone) AS customer_phone,
           COALESCE(NULLIF(c.address, ''), NULLIF(concat_ws(', ', c.address_line_1, c.address_line_2), '')) AS customer_address,
           s.total::text AS total, s.paid_amount::text AS paid_amount, s.status::text AS status, s.is_return
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.id IN (${list})
    ORDER BY s.created_at DESC
  `))
  if (heads.length === 0) return []
  const lines = rowsOf<{
    id: string; sale_id: string; item_id: string | null; item_name: string; quantity: string; unit_price: string; total: string
    warranty_months: number | null; warranty_until: string | null; serial_number_ids: string[] | null
  }>(await db.execute(sql`
    SELECT si.id, si.sale_id, si.item_id, si.item_name, si.quantity::text AS quantity, si.unit_price::text AS unit_price,
           si.total::text AS total, si.warranty_months, si.warranty_until::text AS warranty_until, si.serial_number_ids
    FROM sale_items si WHERE si.sale_id IN (${list}) ORDER BY si.item_name
  `))
  const serialIds = [...new Set(lines.flatMap((l) => (Array.isArray(l.serial_number_ids) ? l.serial_number_ids : [])))]
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
  const serials = serialIds.length === 0 ? [] : rowsOf<{ id: string; serial_number: string; warranty_end_date: string | null }>(await db.execute(sql`
    SELECT id, serial_number, warranty_end_date::text AS warranty_end_date FROM item_serial_numbers
    WHERE id IN (${sql.join(serialIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `))
  const serialById = new Map(serials.map((s) => [s.id, s]))
  return heads.map((h) => {
    const total = Number(h.total) || 0
    const paid = Number(h.paid_amount) || 0
    return {
      id: h.id,
      invoiceNo: h.invoice_no,
      createdAt: h.created_at,
      saleDate: h.sale_date,
      warehouseId: h.warehouse_id,
      warehouseName: h.warehouse_name,
      customerId: h.customer_id,
      customerName: h.customer_name,
      customerPhone: h.customer_phone,
      customerAddress: h.customer_address,
      total,
      paidAmount: paid,
      balance: Math.max(0, Math.round((total - paid) * 100) / 100),
      status: h.status,
      isReturn: !!h.is_return,
      lines: lines.filter((l) => l.sale_id === h.id).map((l) => ({
        saleItemId: l.id,
        itemId: l.item_id,
        itemName: l.item_name,
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unit_price) || 0,
        total: Number(l.total) || 0,
        warrantyMonths: l.warranty_months,
        warrantyUntil: l.warranty_until,
        serialNumbers: (Array.isArray(l.serial_number_ids) ? l.serial_number_ids : [])
          .map((id) => serialById.get(id))
          .filter((s): s is NonNullable<typeof s> => !!s)
          .map((s) => ({ id: s.id, serialNumber: s.serial_number, warrantyEndDate: s.warranty_end_date })),
      })),
    }
  })
}

export interface WarrantyLookupHit {
  sale: LookupSale | null
  /** the matching unit when found by serial / IMEI */
  serial: { id: string; serialNumber: string; itemId: string; itemName: string; status: string; warrantyStartDate: string | null; warrantyEndDate: string | null } | null
}

/**
 * Find units / sales by serial or IMEI (exact, case-insensitive), invoice no, or customer phone
 * (last 9 digits, so 077… and +9477… match). Up to 10 hits.
 */
export async function warrantyLookup(db: DbTx, q: string, scope: BranchScope): Promise<WarrantyLookupHit[]> {
  const term = q.trim()
  const hits: WarrantyLookupHit[] = []

  // 1. serial / IMEI
  const serials = rowsOf<{
    id: string; serial_number: string; item_id: string; item_name: string; status: string
    warranty_start_date: string | null; warranty_end_date: string | null; sale_id: string | null
  }>(await db.execute(sql`
    SELECT sn.id, sn.serial_number, sn.item_id, i.name AS item_name, sn.status::text AS status,
           sn.warranty_start_date::text AS warranty_start_date, sn.warranty_end_date::text AS warranty_end_date,
           (SELECT si.sale_id FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE si.serial_number_ids @> to_jsonb(ARRAY[sn.id::text]) AND s.is_return = false AND s.status <> 'void'
             ORDER BY s.created_at DESC LIMIT 1) AS sale_id
    FROM item_serial_numbers sn JOIN items i ON i.id = sn.item_id
    WHERE lower(sn.serial_number) = lower(${term})
    LIMIT 10
  `))
  if (serials.length > 0) {
    const sales = await loadSales(db, serials.map((s) => s.sale_id).filter((x): x is string => !!x))
    for (const s of serials) {
      const sale = sales.find((x) => x.id === s.sale_id) ?? null
      if (sale && scope && sale.warehouseId && !scope.includes(sale.warehouseId)) continue
      hits.push({
        sale,
        serial: {
          id: s.id, serialNumber: s.serial_number, itemId: s.item_id, itemName: s.item_name, status: s.status,
          warrantyStartDate: s.warranty_start_date, warrantyEndDate: s.warranty_end_date,
        },
      })
    }
    return hits
  }

  // 2. invoice no
  const byInvoice = await findSaleByInvoice(db, term, scope)
  if (byInvoice) return [{ sale: byInvoice, serial: null }]

  // 3. phone (digits only, last 9)
  const digits = term.replace(/\D/g, '')
  if (digits.length >= 7) {
    const tail = digits.slice(-9)
    const ids = rowsOf<{ id: string }>(await db.execute(sql`
      SELECT s.id FROM sales s JOIN customers c ON c.id = s.customer_id
      WHERE s.is_return = false AND s.status <> 'void'
        AND (right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 9) = ${tail}
          OR right(regexp_replace(coalesce(c.mobile_phone, ''), '\\D', '', 'g'), 9) = ${tail})
        ${branchSqlFilter(scope, 's.warehouse_id')}
      ORDER BY s.created_at DESC LIMIT 10
    `))
    const sales = await loadSales(db, ids.map((r) => r.id))
    return sales.map((sale) => ({ sale, serial: null }))
  }
  return hits
}

/** Warranty end of a sold line / unit: the unit's own end date, else the line's, else none */
export function warrantyEndOf(line: Pick<LookupSaleLine, 'warrantyUntil'> | null, serialEnd: string | null | undefined): string | null {
  return serialEnd || line?.warrantyUntil || null
}

/**
 * H4: shared helpers for the public /api/v1 API (docs/API.md).
 * Responses use plain JSON with string decimals (exactly as stored) and ISO timestamps.
 */
import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db/tenant-context'
import { categories, items, warehouseStock, warehouses } from '@/lib/db/schema'

export const v1PageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export function v1Error(status: number, error: string, code: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error, code } : { error, code, details }, { status })
}

export function v1Page<T>(data: T[], page: number, pageSize: number, total: number) {
  return NextResponse.json({
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

/** Parse query params with a zod schema; returns a v1-shaped 400 on failure. */
export function v1Query<T>(request: Request, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; response: NextResponse } {
  const params: Record<string, string> = {}
  new URL(request.url).searchParams.forEach((v, k) => { params[k] = v })
  const r = schema.safeParse(params)
  if (!r.success) return { ok: false, response: v1Error(400, 'Invalid query parameters', 'VALIDATION_ERROR', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))) }
  return { ok: true, data: r.data }
}

/**
 * Idempotency-Key → sales.client_sale_id (uuid). Namespaced by tenant so an integrator's key can
 * never collide with a POS device's clientSaleId or another company's key.
 */
export function idempotencyKeyToClientSaleId(tenantId: string, key: string): string {
  const h = createHash('sha256').update(`poslanka-api-v1:${tenantId}:${key}`).digest()
  h[6] = (h[6] & 0x0f) | 0x40
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{8,255}$/

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)

export interface V1StockRow {
  warehouseId: string
  warehouseName: string
  currentStock: string
  reservedStock: string
  availableStock: string
  minStock: string
  updatedAt: string | null
}

/** Stock per warehouse for a set of items (RLS-scoped db). */
export async function stockByItem(db: TenantDb, itemIds: string[]): Promise<Map<string, V1StockRow[]>> {
  const map = new Map<string, V1StockRow[]>()
  if (itemIds.length === 0) return map
  const rows = await db
    .select({
      itemId: warehouseStock.itemId,
      warehouseId: warehouseStock.warehouseId,
      warehouseName: warehouses.name,
      currentStock: warehouseStock.currentStock,
      reservedStock: warehouseStock.reservedStock,
      minStock: warehouseStock.minStock,
      updatedAt: warehouseStock.updatedAt,
    })
    .from(warehouseStock)
    .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
    .where(inArray(warehouseStock.itemId, itemIds))
  for (const r of rows) {
    const available = Math.max(0, Number(r.currentStock) - Number(r.reservedStock || 0))
    const list = map.get(r.itemId) || []
    list.push({
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      currentStock: r.currentStock,
      reservedStock: r.reservedStock,
      availableStock: available.toFixed(3),
      minStock: r.minStock,
      updatedAt: iso(r.updatedAt),
    })
    map.set(r.itemId, list)
  }
  return map
}

/** Columns selected for the public item shape (join categories for categoryName). */
export const ITEM_V1_COLUMNS = {
  id: items.id, itemCode: items.itemCode, sku: items.sku, barcode: items.barcode, name: items.name,
  description: items.description, categoryId: items.categoryId, categoryName: categories.name, brand: items.brand,
  unit: items.unit, sellingPrice: items.sellingPrice, trackStock: items.trackStock, isActive: items.isActive,
  isGiftCard: items.isGiftCard, taxTemplateId: items.taxTemplateId, createdAt: items.createdAt, updatedAt: items.updatedAt,
}

export interface ItemRowForV1 {
  id: string
  itemCode: string
  sku: string | null
  barcode: string | null
  name: string
  description: string | null
  categoryId: string | null
  categoryName?: string | null
  brand: string | null
  unit: string | null
  sellingPrice: string
  trackStock: boolean
  isActive: boolean
  isGiftCard: boolean
  taxTemplateId: string | null
  createdAt: Date
  updatedAt: Date
}

/** Public item shape. Cost / valuation prices are deliberately not exposed. */
export function serializeItem(item: ItemRowForV1, stock: V1StockRow[] | undefined) {
  const rows = stock || []
  return {
    id: item.id,
    itemCode: item.itemCode,
    sku: item.sku,
    barcode: item.barcode,
    name: item.name,
    description: item.description,
    categoryId: item.categoryId,
    categoryName: item.categoryName ?? null,
    brand: item.brand,
    unit: item.unit,
    sellingPrice: item.sellingPrice,
    taxTemplateId: item.taxTemplateId,
    trackStock: item.trackStock,
    isActive: item.isActive,
    isGiftCard: item.isGiftCard,
    totalStock: item.trackStock ? rows.reduce((s, r) => s + Number(r.currentStock), 0).toFixed(3) : null,
    stock: item.trackStock ? rows : [],
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
  }
}

export function serializeCustomer(c: {
  id: string; name: string; firstName: string | null; lastName: string | null; companyName: string | null
  email: string | null; phone: string | null; mobilePhone: string | null; addressLine1: string | null
  addressLine2: string | null; city: string | null; postalCode: string | null; country: string | null
  taxId: string | null; customerType: string | null; loyaltyPoints: number; balance: string
  createdAt: Date; updatedAt: Date
}) {
  return {
    id: c.id,
    name: c.name,
    firstName: c.firstName,
    lastName: c.lastName,
    companyName: c.companyName,
    email: c.email,
    phone: c.phone,
    mobilePhone: c.mobilePhone,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    postalCode: c.postalCode,
    country: c.country,
    taxId: c.taxId,
    customerType: c.customerType,
    loyaltyPoints: c.loyaltyPoints,
    storeCreditBalance: c.balance,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  }
}

export { iso as v1Iso }

/** Public sale shape (header + lines + payments) for the given sale ids, in the given order. */
export async function loadSalesV1(db: TenantDb, ids: string[], opts: { withLines?: boolean } = {}) {
  if (ids.length === 0) return []
  const { sales, saleItems, payments } = await import('@/lib/db/schema')
  const heads = await db.select({
    id: sales.id, invoiceNo: sales.invoiceNo, clientSaleId: sales.clientSaleId, status: sales.status,
    isReturn: sales.isReturn, returnAgainst: sales.returnAgainst, customerId: sales.customerId,
    customerName: sales.customerName, warehouseId: sales.warehouseId, subtotal: sales.subtotal,
    discountAmount: sales.discountAmount, taxAmount: sales.taxAmount, total: sales.total, paidAmount: sales.paidAmount,
    paymentMethod: sales.paymentMethod, offlineRef: sales.offlineRef, voidedAt: sales.voidedAt, createdAt: sales.createdAt,
  }).from(sales).where(inArray(sales.id, ids))
  const lines = opts.withLines === false ? [] : await db.select({
    id: saleItems.id, saleId: saleItems.saleId, itemId: saleItems.itemId, itemName: saleItems.itemName,
    quantity: saleItems.quantity, unitPrice: saleItems.unitPrice, discount: saleItems.discount,
    taxRate: saleItems.taxRate, taxAmount: saleItems.taxAmount, total: saleItems.total,
  }).from(saleItems).where(inArray(saleItems.saleId, ids))
  const pays = opts.withLines === false ? [] : await db.select({
    id: payments.id, saleId: payments.saleId, method: payments.method, amount: payments.amount,
    reference: payments.reference, createdAt: payments.createdAt, voidedAt: payments.voidedAt,
  }).from(payments).where(inArray(payments.saleId, ids))
  const byId = new Map(heads.map((h) => [h.id, h]))
  return ids.map((id) => byId.get(id)).filter((h): h is NonNullable<typeof h> => !!h).map((h) => ({
    ...h,
    voidedAt: iso(h.voidedAt),
    createdAt: iso(h.createdAt),
    ...(opts.withLines === false ? {} : {
      lines: lines.filter((l) => l.saleId === h.id).map(({ saleId: _s, ...l }) => l),
      payments: pays.filter((p) => p.saleId === h.id).map(({ saleId: _s, ...p }) => ({ ...p, createdAt: iso(p.createdAt), voidedAt: iso(p.voidedAt) })),
    }),
  }))
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { items, tenants, warehouses, warehouseStock } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateBody } from '@/lib/validation'
import { adjustmentReasonCodeSchema } from '@/lib/validation/schemas/stock'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { applyBulkAdjustment, BulkLineError } from '@/lib/inventory/bulk-adjust'

const PAGE_SIZE = 50

const adjustSchema = z.object({
  warehouseId: z.string().uuid(),
  reasonCode: adjustmentReasonCodeSchema,
  note: z.string().trim().min(3, 'Say why the stock is changed').max(300),
  adjustments: z.array(z.object({ itemId: z.string().uuid(), newQuantity: z.coerce.number().min(0, 'Stock cannot be negative').max(10_000_000) }))
    .min(1, 'Change at least one count')
    .max(200, 'Maximum 200 items per save'),
})

type Ctx = { params: Promise<{ id: string }> }

async function vendorExists(id: string) {
  return !!(await db.query.tenants.findFirst({ where: eq(tenants.id, id), columns: { id: true } }))
}

/** GET — the vendor's branches and stock-tracked items with the count in one branch (?warehouseId, ?q, ?page). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const { id } = await params
    if (!z.string().uuid().safeParse(id).success || !(await vendorExists(id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const sp = request.nextUrl.searchParams
    const q = (sp.get('q') || '').trim().slice(0, 100)
    const page = Math.max(1, Math.min(1000, Number(sp.get('page')) || 1))

    const data = await withTenant(id, async (tdb) => {
      const branches = await tdb.select({ id: warehouses.id, name: warehouses.name, code: warehouses.code, isDefault: warehouses.isDefault })
        .from(warehouses).where(and(eq(warehouses.tenantId, id), eq(warehouses.isActive, true))).orderBy(asc(warehouses.name))
      const wanted = sp.get('warehouseId')
      const branch = branches.find((b) => b.id === wanted) || branches.find((b) => b.isDefault) || branches[0]
      if (!branch) return { branches, warehouseId: null, rows: [], total: 0 }

      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      const cond = and(
        eq(items.tenantId, id),
        eq(items.isActive, true),
        eq(items.trackStock, true),
        q ? or(ilike(items.name, like), ilike(items.sku, like), ilike(items.barcode, like)) : undefined,
      )
      const [rows, [count]] = await Promise.all([
        tdb.select({
          itemId: items.id, name: items.name, sku: items.sku, barcode: items.barcode, unit: items.unit, costPrice: items.costPrice,
          stock: warehouseStock.currentStock, reserved: warehouseStock.reservedStock,
        })
          .from(items)
          .leftJoin(warehouseStock, and(eq(warehouseStock.itemId, items.id), eq(warehouseStock.warehouseId, branch.id)))
          .where(cond)
          .orderBy(asc(items.name))
          .limit(PAGE_SIZE)
          .offset((page - 1) * PAGE_SIZE),
        tdb.select({ n: sql<number>`count(*)::int` }).from(items).where(cond),
      ])
      return {
        branches,
        warehouseId: branch.id,
        rows: rows.map((r) => ({ ...r, stock: Number(r.stock ?? 0), reserved: Number(r.reserved ?? 0), costPrice: Number(r.costPrice ?? 0) })),
        total: count?.n ?? 0,
      }
    })
    return NextResponse.json({ ...data, page, pageSize: PAGE_SIZE })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/stock GET', error)
    return NextResponse.json({ error: 'Failed to load stock' }, { status: 500 })
  }
}

/**
 * POST — set new stock counts in one branch ({ warehouseId, reasonCode, note, adjustments }).
 * Goes through the same path as the vendor's own bulk adjustment: stock movements with the reason,
 * GL posting, all-or-nothing. vendors.manage, audited on the vendor.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/stock', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const { id } = await params
    if (!z.string().uuid().safeParse(id).success || !(await vendorExists(id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const parsed = await validateBody(request, adjustSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const result = await withTenant(id, async (tx) => {
      const [warehouse] = await tx.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
        .where(and(eq(warehouses.id, body.warehouseId), eq(warehouses.tenantId, id))).limit(1)
      if (!warehouse) return { error: NextResponse.json({ error: 'Branch not found' }, { status: 404 }) }
      const acctError = await requireAccountingConfig(tx, id, 'stock_adjustment')
      if (acctError) return { error: acctError }

      const out = await applyBulkAdjustment(tx, {
        tenantId: id,
        warehouseId: body.warehouseId,
        userId: null,
        reasonCode: body.reasonCode,
        defaultNote: `Platform admin: ${body.note}`,
        referenceType: 'admin_adjustment',
        adjustments: body.adjustments,
      })
      return { data: { ...out, warehouseName: warehouse.name } }
    })
    if (result.error || !result.data) return result.error ?? NextResponse.json({ error: 'Failed to save stock' }, { status: 500 })

    const { adjusted, warnings, results, changedStockIds, warehouseName } = result.data
    for (const sid of changedStockIds) logAndBroadcast(id, 'warehouse-stock', 'updated', sid)
    if (adjusted > 0) logAndBroadcast(id, 'stock-movement', 'created', 'bulk')

    const changed = results.filter((r) => r.delta !== 0)
    if (changed.length > 0) {
      await adminAudit.update(session.superAdminId, 'vendor_stock', id, {
        op: 'stock_adjust', tenantId: id, warehouseId: body.warehouseId, warehouse: warehouseName,
        reasonCode: body.reasonCode, note: body.note,
        lines: changed.slice(0, 50).map((r) => ({ item: r.itemName, before: r.before, after: r.after })),
        count: changed.length,
      })
    }
    return NextResponse.json({ adjusted, warnings, results })
  } catch (error) {
    if (error instanceof BulkLineError) {
      return NextResponse.json({ error: `Nothing was changed: ${error.reason}` }, { status: error.status })
    }
    const stockErr = stockErrorResponse(error, 'Nothing was changed')
    if (stockErr) return stockErr
    logError('api/sys-control/vendors/[id]/stock POST', error)
    return NextResponse.json({ error: 'Failed to save stock' }, { status: 500 })
  }
}

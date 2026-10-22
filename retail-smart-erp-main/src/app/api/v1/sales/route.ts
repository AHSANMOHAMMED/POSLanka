import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { validateBody } from '@/lib/validation/helpers'
import { items, sales } from '@/lib/db/schema'
import { withApiKey } from '@/lib/auth/api-keys'
import { logActivity } from '@/lib/utils/activity-log'
import {
  IDEMPOTENCY_KEY_RE, idempotencyKeyToClientSaleId, loadSalesV1, v1Error, v1Page, v1PageSchema, v1Query,
} from '@/lib/api-v1'
import { POST as createSalePOST } from '@/app/api/sales/route'

const listSchema = v1PageSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['pending', 'partial', 'completed', 'void']).optional(),
  customerId: z.string().uuid().optional(),
  includeLines: z.enum(['true', 'false']).optional(),
})

const money = z.coerce.number().finite()
const lineSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string().trim().max(255).optional(),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: money.min(0),
  discount: money.min(0).default(0),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  taxRate: money.min(0).optional(),
  taxTemplateId: z.string().uuid().optional(),
  taxAmount: money.min(0).optional(),
  batchNumber: z.string().trim().max(100).optional(),
  serialNumberIds: z.array(z.string().uuid()).max(1000).optional(),
  notes: z.string().max(500).optional(),
}).strict()

const methodSchema = z.enum(['cash', 'card', 'bank_transfer', 'credit'])

/**
 * Body an integration may send. A strict subset of POST /api/sales: no returns, gift cards,
 * loyalty redemption, work / restaurant orders, shifts or offline references.
 */
const createSchema = z.object({
  customerId: z.string().uuid().optional(),
  customerName: z.string().trim().max(255).optional(),
  warehouseId: z.string().uuid().optional(),
  cartItems: z.array(lineSchema).min(1).max(200),
  paymentMethod: methodSchema,
  paymentSplits: z.array(z.object({ method: methodSchema, amount: money.positive(), reference: z.string().max(100).optional() }).strict()).max(10).optional(),
  subtotal: money.min(0),
  discount: money.min(0).default(0),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountReason: z.string().max(500).optional(),
  tax: money.min(0).default(0),
  total: money.min(0),
  amountPaid: money.min(0).optional(),
  creditAmount: money.min(0).default(0),
}).strict()

// GET /api/v1/sales (scope sales:read)
export async function GET(request: NextRequest) {
  return withApiKey(request, 'sales:read', async ({ session }) => {
    const q = v1Query(request, listSchema)
    if (!q.ok) return q.response
    const { page, pageSize, from, to, status, customerId, includeLines } = q.data
    return withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (from) conditions.push(gte(sales.createdAt, from))
      if (to) conditions.push(lt(sales.createdAt, to))
      if (status) conditions.push(eq(sales.status, status))
      if (customerId) conditions.push(eq(sales.customerId, customerId))
      const where = conditions.length ? and(...conditions) : undefined
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(sales).where(where)
      const ids = await db.select({ id: sales.id }).from(sales).where(where)
        .orderBy(desc(sales.createdAt), desc(sales.id))
        .limit(pageSize).offset((page - 1) * pageSize)
      const data = await loadSalesV1(db, ids.map((r) => r.id), { withLines: includeLines === 'true' })
      return v1Page(data, page, pageSize, Number(count))
    })
  })
}

// POST /api/v1/sales (scope sales:write) — requires an Idempotency-Key header; runs the POS sale logic
export async function POST(request: NextRequest) {
  return withApiKey(request, 'sales:write', async ({ session, apiKeyId, apiKeyName }) => {
    const idemKey = request.headers.get('idempotency-key')?.trim()
    if (!idemKey) return v1Error(400, 'Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED')
    if (!IDEMPOTENCY_KEY_RE.test(idemKey)) return v1Error(400, 'Idempotency-Key must be 8-255 printable ASCII characters', 'VALIDATION_ERROR')

    const parsed = await validateBody(request, createSchema)
    if (!parsed.success) {
      const err = await parsed.response.json().catch(() => ({}))
      return v1Error(400, err.error === 'Invalid JSON in request body' ? err.error : 'Invalid sale', 'VALIDATION_ERROR', err.details)
    }
    const body = parsed.data
    const tenantId = session.user.tenantId
    const clientSaleId = idempotencyKeyToClientSaleId(tenantId, idemKey)

    // Fill missing line names from the catalog; detect a replay of the same Idempotency-Key.
    const { existing, names } = await withTenant(tenantId, async (db) => {
      const [found] = await db.select({ id: sales.id }).from(sales).where(eq(sales.clientSaleId, clientSaleId)).limit(1)
      const ids = [...new Set(body.cartItems.map((l) => l.itemId))]
      const rows = await db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, ids))
      return { existing: found, names: new Map(rows.map((r) => [r.id, r.name])) }
    })
    if (existing) {
      const [sale] = await withTenant(tenantId, (db) => loadSalesV1(db, [existing.id]))
      return NextResponse.json({ data: sale }, { status: 200, headers: { 'Idempotent-Replayed': 'true' } })
    }
    const missing = body.cartItems.find((l) => !names.has(l.itemId))
    if (missing) return v1Error(400, `Unknown item ${missing.itemId}`, 'VALIDATION_ERROR')

    const inner = new NextRequest(new URL('/api/sales', request.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        cartItems: body.cartItems.map((l) => ({ ...l, name: l.name || names.get(l.itemId) })),
        clientSaleId,
        isReturn: false,
      }),
    })
    const res = await createSalePOST(inner)
    const result = await res.json().catch(() => ({}))
    if (!res.ok) {
      return v1Error(res.status, result.error || 'Failed to create sale', result.code || (res.status === 400 ? 'VALIDATION_ERROR' : 'ERROR'), result.details)
    }
    // (A concurrent request with the same key that won the race comes back here as that same sale.)
    const [sale] = await withTenant(tenantId, (db) => loadSalesV1(db, [result.id]))
    if (!sale || sale.clientSaleId !== clientSaleId) return v1Error(409, 'Idempotency-Key conflict', 'IDEMPOTENCY_CONFLICT')

    void logActivity({
      tenantId,
      userId: session.user.id,
      action: 'create',
      entityType: 'sale',
      entityId: sale.id,
      entityName: sale.invoiceNo,
      description: `Sale ${sale.invoiceNo} created via API key "${apiKeyName}"`,
      metadata: { apiKeyId, idempotencyKey: idemKey },
    })
    return NextResponse.json({ data: sale }, { status: 201 })
  })
}

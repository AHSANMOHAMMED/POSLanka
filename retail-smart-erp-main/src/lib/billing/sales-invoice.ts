/**
 * Back-office invoices raised by other modules (recurring invoices, project billing — drizzle/0185)
 * go through THE sale creation path: POST /api/sales (stock, batches, serials, price lists /
 * promotions, tax templates, credit limit, customer balance, GL). Nothing here writes sales,
 * payments, stock or GL rows itself.
 *
 *  - priceInvoiceLines(): the request totals the route will accept — same pricing engine
 *    (priceSaleCart, lines locked at the given price), same cart-discount ratio and tax templates
 *    (recalculateDocumentTax) the route validates against.
 *  - createSalesInvoice(): runs POST /api/sales for `session`. With a session (cron / system runs)
 *    it is installed as the request principal (same mechanism as /api/v1); without one the
 *    current request's cookie / bearer session applies. `clientSaleId` makes a retry return the
 *    sale already created instead of a second one.
 *
 * Server-only.
 */
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { withTenant, withoutTenant, type TenantDb } from '@/lib/db'
import { customers, tenants, users } from '@/lib/db/schema'
import { priceSaleCart } from '@/lib/pricing/sale-pricing'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { roundCurrency } from '@/lib/utils/currency'
import type { CompanySession } from '@/lib/auth'

export interface InvoiceLineInput {
  itemId: string
  name: string
  quantity: number
  unitPrice: number
  /** manual line discount (amount) */
  discount?: number
  /** unit sold ('' / null = base unit) */
  uom?: string | null
  notes?: string | null
}

export interface PricedInvoice {
  cartItems: Array<{
    itemId: string; name: string; quantity: number; unitPrice: number; discount: number; uom?: string; priceLocked: true; notes?: string
  }>
  lines: Array<{ name: string; quantity: number; unitPrice: number; discount: number; total: number }>
  subtotal: number
  promotionDiscount: number
  discount: number
  tax: number
  total: number
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Totals for POST /api/sales (see the header). Call under the tenant's RLS context. */
export async function priceInvoiceLines(
  db: TenantDb, tenantId: string, input: { customerId: string | null; lines: InvoiceLineInput[] },
): Promise<PricedInvoice> {
  const cartItems = input.lines.map((l) => ({
    itemId: l.itemId,
    name: l.name.slice(0, 255),
    quantity: r3(l.quantity),
    unitPrice: roundCurrency(l.unitPrice),
    discount: roundCurrency(l.discount || 0),
    ...(l.uom ? { uom: l.uom } : {}),
    priceLocked: true as const,
    ...(l.notes ? { notes: l.notes.slice(0, 500) } : {}),
  }))
  const pricing = await priceSaleCart(db, tenantId, {
    cartItems, customerId: input.customerId, posProfileId: null, applyRules: true,
  })
  const lines = cartItems.map((c, i) => {
    const pl = pricing.lines[i]
    const unitPrice = roundCurrency(pl.unitPrice)
    const discount = roundCurrency(c.discount + pl.promotionDiscount)
    return { name: c.name, quantity: c.quantity, unitPrice, discount, total: roundCurrency(unitPrice * c.quantity - discount) }
  })
  const subtotal = roundCurrency(lines.reduce((s, l) => s + l.total, 0))
  const promotionDiscount = roundCurrency(pricing.cartPromotionDiscount || 0)
  const discount = promotionDiscount
  const ratio = subtotal > 0 ? Math.max(0, 1 - discount / subtotal) : 1
  const taxExempt = input.customerId
    ? !!(await db.query.customers.findFirst({ where: eq(customers.id, input.customerId), columns: { taxExempt: true } }))?.taxExempt
    : false
  const taxResult = await recalculateDocumentTax(db, tenantId,
    lines.map((l, i) => ({ itemId: cartItems[i].itemId, lineTotal: roundCurrency(l.total * ratio) })),
    { type: 'sales', taxExempt })
  const tax = roundCurrency(taxResult.totalTax || 0)
  const exclusiveTax = taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0 && taxResult.totalTax > 0
    ? roundCurrency(tax * (taxResult.exclusiveTax / taxResult.totalTax))
    : tax
  // When the tenant prices tax-inclusive without templates the route treats tax as included
  const total = roundCurrency(Math.max(0, subtotal - discount + exclusiveTax))
  return { cartItems, lines, subtotal, promotionDiscount, discount: 0, tax, total }
}

/** Deterministic UUID (v4 layout) from a key: the sale's clientSaleId for idempotent retries. */
export function stableUuid(key: string): string {
  const h = createHash('sha256').update(key).digest('hex')
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export interface CreateInvoiceResult {
  ok: boolean
  status: number
  saleId?: string
  invoiceNo?: string
  total?: number
  error?: string
  code?: string
}

/**
 * Raise the invoice through POST /api/sales. `onAccount`: the whole total is left on the
 * customer's account (paymentMethod 'credit'; needs the credit sales switch).
 */
export async function createSalesInvoice(opts: {
  session?: CompanySession | null
  tenantId: string
  customerId: string
  warehouseId?: string | null
  priced: PricedInvoice
  clientSaleId: string
  costCenterId?: string | null
}): Promise<CreateInvoiceResult> {
  const { POST: createSalePOST } = await import('@/app/api/sales/route')
  const body = {
    customerId: opts.customerId,
    ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
    ...(opts.costCenterId ? { costCenterId: opts.costCenterId } : {}),
    cartItems: opts.priced.cartItems,
    paymentMethod: 'credit',
    subtotal: opts.priced.subtotal,
    discount: opts.priced.discount,
    ...(opts.priced.promotionDiscount > 0 ? { promotionDiscount: opts.priced.promotionDiscount } : {}),
    tax: opts.priced.tax,
    total: opts.priced.total,
    amountPaid: 0,
    creditAmount: 0,
    clientSaleId: opts.clientSaleId,
    isReturn: false,
  }
  const run = async () => {
    const req = new NextRequest(new URL('/api/sales', process.env.NEXTAUTH_URL || 'http://localhost'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return createSalePOST(req)
  }
  let res: Response
  if (opts.session) {
    const { runWithApiPrincipal } = await import('@/lib/auth/api-key-context')
    res = await runWithApiPrincipal({ session: opts.session, apiKeyId: 'internal', apiKeyName: 'system', scopes: [] }, run)
  } else {
    res = await run()
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || !data.id) {
    return { ok: false, status: res.status, error: String(data.error || 'Failed to create the invoice'), code: data.code ? String(data.code) : undefined }
  }
  return { ok: true, status: res.status, saleId: String(data.id), invoiceNo: String(data.invoiceNo || ''), total: Number(data.total) || opts.priced.total }
}

/**
 * Session for system runs (cron) of a tenant: `preferredUserId` when that user is active and an
 * owner / manager (who may sell on account without a shift), else the tenant's first active owner.
 */
export async function systemSessionFor(tenantId: string, preferredUserId?: string | null): Promise<CompanySession | null> {
  const row = await withoutTenant(async (db) => {
    const [t] = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name, businessType: tenants.businessType, status: tenants.status })
      .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    if (!t || t.status !== 'active') return null
    const candidates = await db.select({ id: users.id, accountId: users.accountId, email: users.email, fullName: users.fullName, role: users.role, customRoleId: users.customRoleId })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, ['owner', 'manager']),
        preferredUserId ? or(eq(users.id, preferredUserId), eq(users.role, 'owner')) : eq(users.role, 'owner')))
      .orderBy(sql`CASE WHEN ${users.id} = ${preferredUserId ?? null}::uuid THEN 0 WHEN ${users.role} = 'owner' THEN 1 ELSE 2 END`, users.createdAt)
      .limit(1)
    return candidates[0] ? { t, u: candidates[0] } : null
  })
  if (!row) return null
  try {
    const cache = await import('@/lib/auth/permission-cache')
    const { registerPermissionOverrides } = await import('@/lib/auth/roles')
    registerPermissionOverrides({
      getPermissionOverride: cache.getPermissionOverride,
      getCustomRolePermission: cache.getCustomRolePermission,
      getCustomRoleBaseRole: cache.getCustomRoleBaseRole,
    })
    await cache.warmPermissionCache(tenantId)
  } catch {
    // non-fatal: system defaults apply
  }
  return {
    user: {
      id: row.u.id, accountId: row.u.accountId ?? null, email: row.u.email, name: row.u.fullName || row.u.email,
      role: row.u.role, customRoleId: row.u.customRoleId, tenantId, tenantSlug: row.t.slug, tenantName: row.t.name,
      businessType: row.t.businessType, aiEnabled: false, isSuperAdmin: false, isOwner: row.u.role === 'owner', mode: 'company',
    },
  }
}

/** Put the module's notes on the created invoice (POST /api/sales takes none). */
export async function setInvoiceNotes(tenantId: string, saleId: string, notes: string | null): Promise<void> {
  if (!notes) return
  const { sales } = await import('@/lib/db/schema')
  await withTenant(tenantId, (db) => db.update(sales).set({ notes: notes.slice(0, 5000) }).where(eq(sales.id, saleId)))
}

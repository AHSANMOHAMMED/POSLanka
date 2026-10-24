/**
 * Messages the app sends through sendMessage(): bill receipts, payment reminders, low-stock alerts.
 * Server-only.
 */
import { and, eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { customers, sales } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { billUrl } from './bill-link'
import { colomboDate, getSubscription, money, sendMessage, shopInfo, type MessageChannel, type SendMessageResult } from './service'

const notFound = (what: string): SendMessageResult => ({ ok: false, code: 'PROVIDER_REJECTED', error: `${what} not found`, units: 0 })

/** Bill to the customer after a sale: total + a link to the bill. `phone` overrides the customer's number. */
export async function sendSaleReceipt(opts: { tenantId: string; saleId: string; channel: MessageChannel; phone?: string | null; userId?: string | null; baseUrl?: string }): Promise<SendMessageResult & { notFound?: boolean }> {
  const { tenantId, saleId } = opts
  const sale = await withTenant(tenantId, async (tdb) => {
    const [s] = await tdb.select({
      id: sales.id, invoiceNo: sales.invoiceNo, total: sales.total, isReturn: sales.isReturn, createdAt: sales.createdAt,
      customerId: sales.customerId, customerName: sales.customerName,
      phone: customers.phone, mobilePhone: customers.mobilePhone,
    }).from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
      .limit(1)
    return s ?? null
  })
  if (!sale) return { ...notFound('Sale'), notFound: true }
  const to = (opts.phone || sale.mobilePhone || sale.phone || '').trim()
  if (!to) return { ok: false, code: 'INVALID_NUMBER', error: 'Enter the customer’s mobile number', units: 0 }
  const shop = await shopInfo(tenantId)
  return sendMessage({
    tenantId,
    channel: opts.channel,
    to,
    purpose: 'sale_receipt',
    vars: {
      shop: shop.name,
      invoiceNo: sale.invoiceNo,
      total: money(shop.currency, sale.total),
      link: billUrl(sale.id, opts.baseUrl),
      customer: sale.customerName || '',
      date: colomboDate(sale.createdAt),
    },
    context: {
      userId: opts.userId, recipientType: 'customer', recipientId: sale.customerId, recipientName: sale.customerName,
      entityType: 'sale', entityId: sale.id, entityReference: sale.invoiceNo,
    },
  })
}

/** Reminder to a credit customer with an outstanding balance. */
export async function sendPaymentReminder(opts: { tenantId: string; customerId: string; channel: MessageChannel; userId?: string | null }): Promise<SendMessageResult & { notFound?: boolean }> {
  const { tenantId, customerId } = opts
  const c = await withTenant(tenantId, async (tdb) => {
    const [row] = await tdb.select({ id: customers.id, name: customers.name, phone: customers.phone, mobilePhone: customers.mobilePhone, balance: customers.balance })
      .from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1)
    return row ?? null
  })
  if (!c) return { ...notFound('Customer'), notFound: true }
  if (!(Number(c.balance) > 0)) return { ok: false, code: 'PROVIDER_REJECTED', error: `${c.name} has no outstanding balance`, units: 0 }
  const to = (c.mobilePhone || c.phone || '').trim()
  if (!to) return { ok: false, code: 'INVALID_NUMBER', error: `${c.name} has no mobile number`, units: 0 }
  const shop = await shopInfo(tenantId)
  return sendMessage({
    tenantId,
    channel: opts.channel,
    to,
    purpose: 'payment_reminder',
    vars: { shop: shop.name, customer: c.name, balance: money(shop.currency, c.balance), shopPhone: shop.phone },
    context: { userId: opts.userId, recipientType: 'customer', recipientId: c.id, recipientName: c.name, entityType: 'customer', entityId: c.id },
  })
}

/**
 * Low / out-of-stock SMS or WhatsApp to the owner's alert phone, when the vendor chose a channel for
 * it on their Messaging page. Called after the in-app alert was delivered (so its de-dupe applies).
 * Never throws.
 */
export async function sendLowStockMessage(tenantId: string, info: { item: string; qty: string; min: string; warehouse?: string | null; itemId?: string }): Promise<SendMessageResult | null> {
  try {
    const sub = await getSubscription(tenantId)
    if (!sub || sub.lowStockChannel === 'off' || !sub.alertPhone) return null
    const shop = await shopInfo(tenantId)
    return await sendMessage({
      tenantId,
      channel: sub.lowStockChannel as MessageChannel,
      to: sub.alertPhone,
      purpose: 'low_stock',
      vars: { shop: shop.name, item: info.item, qty: info.qty, min: info.min, warehouse: info.warehouse ? `at ${info.warehouse}` : '' },
      context: { recipientType: 'owner', entityType: 'item', entityId: info.itemId ?? null },
    })
  } catch (error) {
    logError('messaging/low-stock', error, { tenantId })
    return null
  }
}

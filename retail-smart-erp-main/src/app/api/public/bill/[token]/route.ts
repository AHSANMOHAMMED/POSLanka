import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { saleItems, sales, tenants } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { verifyBillToken } from '@/lib/messaging/bill-link'

/**
 * GET /api/public/bill/<token> — the bill a customer opens from the SMS / WhatsApp link.
 * The token is HMAC-signed (src/lib/messaging/bill-link.ts); no sign-in. A small self-contained
 * HTML page (no scripts), not indexed.
 */
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#111827;--fg:#f3f4f6;--muted:#9ca3af;--line:#1f2937}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:440px;margin:24px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
h1{font-size:18px;margin:0 0 2px}.muted{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;margin:14px 0}td{padding:6px 0;border-bottom:1px solid var(--line);vertical-align:top}
td.r{text-align:right;white-space:nowrap;padding-left:12px}.tot td{border:0;font-weight:700;font-size:17px}
.sum td{border:0;padding:2px 0;color:var(--muted)}
</style></head><body><main><div class="card">${body}</div><p class="muted" style="text-align:center">Sent by ${esc(process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS')}</p></main></body></html>`
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' },
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const saleId = verifyBillToken(token)
    if (!saleId) return page('Bill not found', '<h1>Bill not found</h1><p class="muted">This link is not valid.</p>', 404)

    const [s] = await db.select({
      id: sales.id, tenantId: sales.tenantId, invoiceNo: sales.invoiceNo, createdAt: sales.createdAt, customerName: sales.customerName,
      subtotal: sales.subtotal, discountAmount: sales.discountAmount, taxAmount: sales.taxAmount, total: sales.total, paidAmount: sales.paidAmount,
      isReturn: sales.isReturn, status: sales.status,
      shop: tenants.name, phone: tenants.phone, address: tenants.address, currency: tenants.currency, timezone: tenants.timezone,
    }).from(sales).innerJoin(tenants, eq(tenants.id, sales.tenantId)).where(eq(sales.id, saleId)).limit(1)
    if (!s) return page('Bill not found', '<h1>Bill not found</h1>', 404)

    const lines = await db.select({ name: saleItems.itemName, qty: saleItems.quantity, price: saleItems.unitPrice, total: saleItems.total })
      .from(saleItems).where(and(eq(saleItems.saleId, s.id), eq(saleItems.tenantId, s.tenantId))).orderBy(asc(saleItems.id)).limit(500)

    const m = (n: string | number) => `${esc(s.currency)} ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const qty = (n: string) => Number(n).toLocaleString('en-LK', { maximumFractionDigits: 3 })
    const when = new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeStyle: 'short', timeZone: s.timezone || 'Asia/Colombo' }).format(s.createdAt)
    const body = `
<h1>${esc(s.shop)}</h1>
${s.address ? `<div class="muted">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="muted">${esc(s.phone)}</div>` : ''}
<p style="margin:14px 0 0"><strong>${s.isReturn ? 'Credit note' : 'Bill'} ${esc(s.invoiceNo)}</strong><br><span class="muted">${esc(when)}${s.customerName ? ` · ${esc(s.customerName)}` : ''}</span></p>
${s.status === 'void' ? '<p style="color:#dc2626;font-weight:600">This bill was cancelled.</p>' : ''}
<table>${lines.map((l) => `<tr><td>${esc(l.name)}<div class="muted">${qty(l.qty)} × ${m(l.price)}</div></td><td class="r">${m(l.total)}</td></tr>`).join('')}</table>
<table>
<tr class="sum"><td>Subtotal</td><td class="r">${m(s.subtotal)}</td></tr>
${Number(s.discountAmount) ? `<tr class="sum"><td>Discount</td><td class="r">-${m(s.discountAmount)}</td></tr>` : ''}
${Number(s.taxAmount) ? `<tr class="sum"><td>Tax</td><td class="r">${m(s.taxAmount)}</td></tr>` : ''}
<tr class="tot"><td>Total</td><td class="r">${m(s.total)}</td></tr>
<tr class="sum"><td>Paid</td><td class="r">${m(s.paidAmount)}</td></tr>
</table>
<p class="muted" style="text-align:center;margin:0">Thank you!</p>`
    return page(`${s.shop} — ${s.invoiceNo}`, body)
  } catch (error) {
    logError('api/public/bill', error)
    return page('Error', '<h1>Something went wrong</h1><p class="muted">Please try again later.</p>', 500)
  }
}

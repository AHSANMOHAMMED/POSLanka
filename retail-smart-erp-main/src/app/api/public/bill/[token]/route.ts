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

function page(title: string, body: string, status = 200, meta?: { ogTitle?: string; ogDesc?: string; ogSite?: string }): Response {
  const ogTitle = meta?.ogTitle || title
  const ogDesc = meta?.ogDesc || ''
  const ogSite = meta?.ogSite || process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:site_name" content="${esc(ogSite)}">
<meta name="description" content="${esc(ogDesc)}">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--btn-bg:#2563eb;--btn-fg:#ffffff;--btn-sec-bg:#f3f4f6;--btn-sec-hover:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#111827;--fg:#f3f4f6;--muted:#9ca3af;--line:#1f2937;--btn-sec-bg:#1f2937;--btn-sec-hover:#374151}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:440px;margin:24px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 4px 12px rgba(0,0,0,0.04)}
h1{font-size:20px;font-weight:700;margin:0 0 2px;letter-spacing:-0.01em}
.muted{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:8px 0;border-bottom:1px solid var(--line);vertical-align:top}
td.r{text-align:right;white-space:nowrap;padding-left:12px}
.tot td{border-top:2px solid var(--fg);border-bottom:0;font-weight:700;font-size:18px;padding-top:10px}
.sum td{border:0;padding:3px 0;color:var(--muted)}
.actions{display:flex;gap:10px;margin-top:20px;margin-bottom:6px}
.btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 14px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:all 0.15s ease}
.btn-primary{background:var(--btn-bg);color:var(--btn-fg)}
.btn-primary:hover{opacity:0.92}
.btn-secondary{background:var(--btn-sec-bg);color:var(--fg);border:1px solid var(--line)}
.btn-secondary:hover{background:var(--btn-sec-hover)}
@media print{
  body{background:#fff;color:#000}
  main{margin:0;padding:0;max-width:100%}
  .card{border:none;padding:0;box-shadow:none}
  .actions,p.muted.footer{display:none !important}
}
</style></head><body><main><div class="card">${body}</div><p class="muted footer" style="text-align:center;margin-top:16px">Sent by ${esc(ogSite)}</p></main></body></html>`
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

    const lines = await db.select({
      name: saleItems.itemName,
      qty: saleItems.quantity,
      price: saleItems.unitPrice,
      discount: saleItems.discount,
      discountType: saleItems.discountType,
      discountValue: saleItems.discountValue,
      total: saleItems.total,
    })
      .from(saleItems).where(and(eq(saleItems.saleId, s.id), eq(saleItems.tenantId, s.tenantId))).orderBy(asc(saleItems.id)).limit(500)

    const m = (n: string | number) => `${esc(s.currency)} ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const qty = (n: string) => Number(n).toLocaleString('en-LK', { maximumFractionDigits: 3 })
    const when = new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeStyle: 'short', timeZone: s.timezone || 'Asia/Colombo' }).format(s.createdAt)
    const docType = s.isReturn ? 'Credit note' : 'Bill'
    const ogTitle = `${s.shop} — ${docType} ${s.invoiceNo}`
    const ogDesc = `Total: ${m(s.total)} • Date: ${when} • View your digital receipt`
    const body = `
<h1>${esc(s.shop)}</h1>
${s.address ? `<div class="muted">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="muted">${esc(s.phone)}</div>` : ''}
<div style="margin:14px 0 0;padding-bottom:12px;border-bottom:1px dashed var(--line)">
  <strong>${esc(docType)} ${esc(s.invoiceNo)}</strong><br>
  <span class="muted">${esc(when)}${s.customerName ? ` · ${esc(s.customerName)}` : ''}</span>
</div>
${s.status === 'void' ? '<p style="color:#dc2626;font-weight:600;margin:12px 0 0">This bill was cancelled.</p>' : ''}
<table>${lines.map((l) => {
  const disc = Number(l.discount) || 0
  const qNum = Number(l.qty) || 0
  const pNum = Number(l.price) || 0
  const gross = Math.round(qNum * pNum * 100) / 100
  const dv = l.discountValue != null ? Number(l.discountValue) : null
  const discLabel = l.discountType === 'percentage' && dv && dv > 0
    ? `Discount (${Number.isInteger(dv) ? dv : dv.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%)`
    : 'Discount'
  return `<tr><td>${esc(l.name)}<div class="muted">${qty(l.qty)} × ${m(l.price)}</div>${disc > 0 ? `<div style="font-size:12px;color:#059669;font-weight:500">${esc(discLabel)}: -${m(disc)}</div>` : ''}</td><td class="r">${disc > 0 ? `<div class="muted" style="text-decoration:line-through;font-size:12px">${m(gross)}</div>` : ''}<strong>${m(l.total)}</strong></td></tr>`
}).join('')}</table>
<table>
<tr class="sum"><td>Subtotal</td><td class="r">${m(s.subtotal)}</td></tr>
${Number(s.discountAmount) ? `<tr class="sum"><td>Discount</td><td class="r">-${m(s.discountAmount)}</td></tr>` : ''}
${Number(s.taxAmount) ? `<tr class="sum"><td>Tax</td><td class="r">${m(s.taxAmount)}</td></tr>` : ''}
<tr class="tot"><td>Total</td><td class="r">${m(s.total)}</td></tr>
<tr class="sum" style="padding-top:6px"><td>Paid</td><td class="r">${m(s.paidAmount)}</td></tr>
</table>
<div class="actions">
  <a href="/api/public/bill/${esc(token)}/pdf?download=1" class="btn btn-primary" download="${esc(s.invoiceNo)}.pdf">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    Download PDF
  </a>
  <button type="button" onclick="window.print()" class="btn btn-secondary">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    Print
  </button>
</div>
<p class="muted" style="text-align:center;margin:12px 0 0">Thank you for your business!</p>`
    return page(ogTitle, body, 200, { ogTitle, ogDesc, ogSite: s.shop })
  } catch (error) {
    logError('api/public/bill', error)
    return page('Error', '<h1>Something went wrong</h1><p class="muted">Please try again later.</p>', 500)
  }
}

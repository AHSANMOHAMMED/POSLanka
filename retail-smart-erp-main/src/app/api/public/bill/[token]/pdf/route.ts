import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { db, withTenant } from '@/lib/db'
import { sales, tenants } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { appBaseUrl, verifyBillToken } from '@/lib/messaging/bill-link'
import { buildReceiptModel, type ReceiptSaleSource } from '@/lib/print/receipt-model'
import { resolveReceiptSettings } from '@/lib/print/receipt-settings'
import { buildReceiptPdf } from '@/lib/print/receipt-pdf'
import { loadLogoBytes } from '@/lib/files/logo-bytes'

/**
 * GET /api/public/bill/<token>/pdf — the bill as a PDF that looks like the printed receipt (shop's
 * receipt settings: logo, layout, font, barcode / QR, coupon). Same HMAC token as the bill page;
 * no sign-in. Sent on WhatsApp ("WhatsApp" link, "Share PDF").
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const saleId = verifyBillToken(token)
    if (!saleId) return new Response('Bill not found', { status: 404 })
    const [head] = await db.select({ tenantId: sales.tenantId }).from(sales).where(eq(sales.id, saleId)).limit(1)
    if (!head) return new Response('Bill not found', { status: 404 })

    const loaded = await withTenant(head.tenantId, async (tdb) => {
      const sale = await tdb.query.sales.findFirst({
        where: eq(sales.id, saleId),
        with: { customer: true, user: { columns: { fullName: true } }, items: { with: { item: true } }, payments: true },
      })
      const tenant = await tdb.query.tenants.findFirst({ where: eq(tenants.id, head.tenantId) })
      return { sale, tenant }
    })
    const { sale, tenant } = loaded
    if (!sale || !tenant) return new Response('Bill not found', { status: 404 })

    const settings = resolveReceiptSettings(tenant.receiptSettings)
    const model = buildReceiptModel({
      sale: { ...(sale as unknown as ReceiptSaleSource), customerPhone: sale.customer?.phone ?? null },
      tenant,
      settings,
      cashier: sale.user?.fullName ?? null,
      formatDate: (d) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: tenant.timezone || 'Asia/Colombo' }).format(d),
      verifyBaseUrl: appBaseUrl(new URL(request.url).origin),
      businessId: tenant.businessId ?? null,
    })

    const value = model.invoiceCode.value
    const qrValue = model.invoiceCode.qrValue || value
    const { toBuffer } = await import('bwip-js/node')
    const [barcodePng, qrPng, logoPng] = await Promise.all([
      value && (model.invoiceCode.type === 'barcode' || model.invoiceCode.type === 'both')
        ? toBuffer({ bcid: 'code128', text: value, scale: 3, height: 10, includetext: true, textxalign: 'center' }).catch(() => null)
        : null,
      qrValue && (model.invoiceCode.type === 'qr' || model.invoiceCode.type === 'both')
        ? toBuffer({ bcid: 'qrcode', text: qrValue, scale: 4 }).catch(() => null)
        : null,
      model.logo.show && tenant.logoUrl
        ? loadLogoBytes(tenant.logoUrl)
            .then((b) => (b ? sharp(b).flatten({ background: '#ffffff' }).resize({ width: 600, withoutEnlargement: true }).grayscale().png().toBuffer() : null))
            .catch(() => null)
        : null,
    ])

    const paper = new URL(request.url).searchParams.get('w') === '58' ? 58 : 80
    const pdf = await buildReceiptPdf(model, paper, { barcodePng, qrPng, logoPng })
    const name = `${model.isReturn ? 'credit-note' : 'bill'}-${model.invoiceNo.replace(/[^\w.-]+/g, '_')}.pdf`
    return new Response(Buffer.from(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${name}"`,
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex',
        'referrer-policy': 'no-referrer',
      },
    })
  } catch (error) {
    logError('api/public/bill/[token]/pdf', error)
    return new Response('Could not make the PDF', { status: 500 })
  }
}

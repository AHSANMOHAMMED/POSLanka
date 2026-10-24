/**
 * Public receipt verification (/v/<BusinessID>/<invoiceNo>?a=<total>), the
 * target of the receipt QR code when the receipt settings ask for it. Shows
 * the document only when the amount in the link matches the stored total, so
 * nothing can be looked up without the printed receipt.
 */
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { sales, tenants } from '@/lib/db/schema'
import { normalizeBusinessId } from '@/lib/tenant/business-id-format'
import { consumeRateLimit } from '@/lib/auth/rate-limit'
import { APP_NAME } from '@/lib/config/branding'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Receipt verification',
  robots: { index: false, follow: false },
}

const VERIFY_LIMIT = { maxAttempts: 30, windowMs: 60_000, category: 'receipt_verify' }

type Result =
  | { ok: true; business: string; invoiceNo: string; date: Date; total: string; currency: string; status: string; isReturn: boolean }
  | { ok: false; reason: string }

async function verify(businessIdRaw: string, invoiceNoRaw: string, amountRaw: string | undefined): Promise<Result> {
  const notFound: Result = { ok: false, reason: 'We could not verify this receipt. Check that you scanned the code on an original receipt.' }
  const businessId = normalizeBusinessId(decodeURIComponent(businessIdRaw))
  let invoiceNo = ''
  try {
    invoiceNo = decodeURIComponent(invoiceNoRaw).trim().slice(0, 50)
  } catch {
    return notFound
  }
  const amount = Number(amountRaw)
  if (!businessId || !invoiceNo || !Number.isFinite(amount)) return notFound

  const h = await headers()
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown'
  if ((await consumeRateLimit(ip, VERIFY_LIMIT)).limited) return { ok: false, reason: 'Too many checks. Please try again in a minute.' }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.businessId, businessId),
    columns: { id: true, name: true, currency: true, status: true },
  })
  if (!tenant || tenant.status === 'cancelled') return notFound

  const sale = await withTenant(tenant.id, (tdb) =>
    tdb.query.sales.findFirst({
      where: and(eq(sales.tenantId, tenant.id), eq(sales.invoiceNo, invoiceNo)),
      columns: { invoiceNo: true, createdAt: true, total: true, status: true, isReturn: true },
    })
  )
  if (!sale) return notFound
  if (Math.abs(Math.abs(Number(sale.total)) - Math.abs(amount)) > 0.005) return notFound
  return {
    ok: true,
    business: tenant.name,
    invoiceNo: sale.invoiceNo,
    date: sale.createdAt,
    total: Math.abs(Number(sale.total)).toFixed(2),
    currency: tenant.currency || 'LKR',
    status: sale.status,
    isReturn: sale.isReturn,
  }
}

export default async function VerifyReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; invoiceNo: string }>
  searchParams: Promise<{ a?: string }>
}) {
  const { businessId, invoiceNo } = await params
  const { a } = await searchParams
  let result: Result
  try {
    result = await verify(businessId, invoiceNo, a)
  } catch {
    result = { ok: false, reason: 'Verification is not available right now. Please try again later.' }
  }
  const voided = result.ok && result.status === 'void'

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-6 space-y-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Receipt verification</h1>
        {result.ok ? (
          <>
            <div
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                voided ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              }`}
            >
              {voided ? 'This receipt was voided.' : result.isReturn ? 'Genuine credit note / return.' : 'Genuine receipt.'}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-gray-500">Business</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-medium">{result.business}</dd>
              <dt className="text-gray-500">{result.isReturn ? 'Return no.' : 'Invoice no.'}</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-mono">{result.invoiceNo}</dd>
              <dt className="text-gray-500">Date</dt>
              <dd className="text-gray-900 dark:text-gray-100">{result.date.toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</dd>
              <dt className="text-gray-500">Total</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-semibold">
                {result.currency} {result.total}
              </dd>
            </dl>
          </>
        ) : (
          <div className="rounded-lg px-3 py-2 text-sm bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{result.reason}</div>
        )}
        <p className="text-xs text-gray-400">Verified by {APP_NAME}</p>
      </div>
    </main>
  )
}

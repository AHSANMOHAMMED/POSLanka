/**
 * Public receipt verification links: /v/<BusinessID>/<invoiceNo>?a=<total>.
 * The amount printed on the receipt is part of the link, so the page only
 * confirms documents whose holder already knows their total (nothing to
 * enumerate). Pure module (web + server; mirrored in apps/mobile/src/lib/receipt.ts).
 */

export function buildInvoiceVerifyUrl(baseUrl: string, businessId: string, invoiceNo: string, total: number): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/v/${encodeURIComponent(businessId)}/${encodeURIComponent(invoiceNo)}?a=${Math.abs(Number(total) || 0).toFixed(2)}`
}

/** Invoice number from a scanned receipt code: a bare number (INV-...) or a verification URL. */
export function invoiceNoFromScan(text: string): string {
  const t = (text || '').trim()
  const m = /\/v\/[A-Za-z0-9-]+\/([^/?#\s]+)/.exec(t)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return m[1]
    }
  }
  return t
}

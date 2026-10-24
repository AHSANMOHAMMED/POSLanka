import { fetchWithTimeout } from '@/lib/utils/fetch-timeout'
/**
 * WhatsApp sharing for skyERPOS documents.
 * Primary path: wa.me deep links (no Cloud API required).
 * Optional: Cloud API for automated Admin alerts when env is configured.
 */

export type WhatsAppDocumentType = 'receipt' | 'invoice' | 'quotation' | 'credit_note'

export function normalizePhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) {
    // Sri Lanka local → 94…
    return `94${digits.slice(1)}`
  }
  return digits
}

export function buildWhatsAppShareUrl(options: {
  phone?: string
  text: string
}): string {
  const encoded = encodeURIComponent(options.text)
  if (options.phone) {
    const phone = normalizePhoneForWhatsApp(options.phone)
    return `https://wa.me/${phone}?text=${encoded}`
  }
  return `https://wa.me/?text=${encoded}`
}

export function buildDocumentShareText(options: {
  documentType: WhatsAppDocumentType
  label: string
  shopName?: string
  pdfUrl?: string
  amount?: string
}): string {
  const shop = options.shopName || 'skyERPOS'
  const typeLabel =
    options.documentType === 'credit_note'
      ? 'Credit Note'
      : options.documentType.charAt(0).toUpperCase() + options.documentType.slice(1)

  const lines = [
    `${shop}`,
    `${typeLabel}: ${options.label}`,
  ]
  if (options.amount) lines.push(`Amount: ${options.amount}`)
  if (options.pdfUrl) lines.push(`PDF: ${options.pdfUrl}`)
  lines.push('Thank you!')
  return lines.join('\n')
}

export function isWhatsAppCloudConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  )
}

/** Send text via WhatsApp Cloud API (optional automation) */
export async function sendWhatsAppCloudText(
  toPhone: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsAppCloudConfigured()) {
    return { ok: false, error: 'WhatsApp Cloud API not configured' }
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!
  const token = process.env.WHATSAPP_ACCESS_TOKEN!
  const to = normalizePhoneForWhatsApp(toPhone)

  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      }
    )
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: body }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'send failed' }
  }
}

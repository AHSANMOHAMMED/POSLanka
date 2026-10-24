/**
 * Phone numbers for SMS / WhatsApp. Client-safe.
 *
 *   0771234567, 077 123 4567, +94 77 123 4567, 0094771234567, 771234567 → 94771234567
 * Other international numbers keep their country code (digits only, 8–15 digits).
 */

/** Digits in international form without "+", or null when it cannot be a phone number. */
export function normalizeMsisdn(input: string | null | undefined): string | null {
  if (!input) return null
  let s = String(input).trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  else if (s.startsWith('00')) s = s.slice(2)
  if (!/^\d+$/.test(s)) return null
  if (/^0\d{9}$/.test(s)) s = `94${s.slice(1)}` // Sri Lankan local form 0XX XXX XXXX
  else if (/^7\d{8}$/.test(s)) s = `94${s}` // mobile without the leading 0
  else if (/^940\d{9}$/.test(s)) s = `94${s.slice(3)}` // +94 0771234567 (a common typo)
  if (s.startsWith('0')) return null // a local number that is not 0XX XXX XXXX
  if (s.startsWith('94') && s.length !== 11) return null
  return s.length >= 8 && s.length <= 15 ? s : null
}

/** Sri Lankan mobile (Dialog 076/077, Mobitel 070/071, Hutch 072/078, Airtel 075, Lanka Bell/SLT 074 …) */
export function isLankanMobile(msisdn: string): boolean {
  return /^947\d{8}$/.test(msisdn)
}

/** GSM-7 text (160 chars per SMS) or Unicode (Sinhala / Tamil / emoji: 70 per SMS). */
export function isGsmText(text: string): boolean {
  // Basic GSM-7 set plus the extension table; anything else forces UCS-2
  return /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text)
}

/** Billable SMS parts for a message. */
export function smsSegments(text: string): number {
  const len = [...text].length
  if (len === 0) return 1
  if (isGsmText(text)) {
    // extension characters take two septets
    const septets = len + (text.match(/[\^{}\\[~\]|€]/g)?.length ?? 0)
    return septets <= 160 ? 1 : Math.ceil(septets / 153)
  }
  return len <= 70 ? 1 : Math.ceil(len / 67)
}

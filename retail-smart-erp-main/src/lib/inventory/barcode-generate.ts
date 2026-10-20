/**
 * Generate a simple Code128-friendly numeric barcode when item barcode is blank.
 * Uses a POSLanka prefix + timestamp + random digits (13 chars when possible).
 */
export function generateItemBarcode(prefix = '2'): string {
  const ts = Date.now().toString().slice(-10)
  const rand = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0')
  const body = `${prefix}${ts}${rand}`.slice(0, 12)
  return body + ean13CheckDigit(body)
}

export function ean13CheckDigit(twelveDigits: string): string {
  const digits = twelveDigits.padStart(12, '0').slice(0, 12).split('').map(Number)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

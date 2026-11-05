/**
 * IMEI helpers (client-safe). An IMEI is 15 digits whose last digit is a Luhn check digit.
 * Shops type IMEIs by hand, so a failed check is a WARNING (the unit is still saved): some
 * devices print IMEISV (16 digits) or have damaged labels.
 */

/** Digits only ("35-209900-176148-1" → "352099001761481"). */
export function normalizeImei(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

/** Luhn checksum over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** null when the IMEI looks right (or is empty); otherwise a short warning for the form. */
export function imeiWarning(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const digits = normalizeImei(raw)
  if (digits.length !== 15) return `An IMEI has 15 digits (this has ${digits.length})`
  if (!luhnValid(digits)) return 'IMEI check digit does not match — please re-check the number'
  return null
}

import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { superAdmins } from '@/lib/db/schema'
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit } from '@/lib/auth/rate-limit'

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]
    bits += 8
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31]
  }

  return output
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_CHARS.indexOf(clean[i])
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

function getTotpCode(secretBytes: Buffer, timeStepIndex: number): string {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigInt64BE(BigInt(timeStepIndex))

  const hmac = crypto.createHmac('sha1', secretBytes).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const codeInt =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000

  return codeInt.toString().padStart(6, '0')
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

export async function totpQrDataUrl(
  email: string,
  secret: string
): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  const issuer = 'POSLanka Control'
  const encodedIssuer = encodeURIComponent(issuer)
  const encodedEmail = encodeURIComponent(email)
  const otpauthUrl = `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`

  try {
    const bwipjs = await import('bwip-js/node')
    const svg = bwipjs.toSVG({
      bcid: 'qrcode',
      text: otpauthUrl,
      scale: 3,
    })
    const qrDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    return { otpauthUrl, qrDataUrl }
  } catch {
    return { otpauthUrl, qrDataUrl: '' }
  }
}

export function verifyTotp(code: string, secret: string): boolean {
  try {
    const cleanCode = code.replace(/\s+/g, '')
    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) return false
    const secretBytes = base32Decode(secret)
    const currentStep = Math.floor(Date.now() / 1000 / 30)

    for (let step = currentStep - 1; step <= currentStep + 1; step++) {
      if (getTotpCode(secretBytes, step) === cleanCode) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/** Returns 'ok' | 'required' | 'invalid' for a login attempt. */
export async function checkAdminTotp(
  superAdminId: string,
  code?: string
): Promise<'ok' | 'required' | 'invalid'> {
  const admin = await db.query.superAdmins.findFirst({
    where: eq(superAdmins.id, superAdminId),
    columns: { totpEnabled: true, totpSecret: true },
  })
  if (!admin?.totpEnabled || !admin.totpSecret) return 'ok'
  if (!code) return 'required'
  // The password was already verified (which resets the password lockout), so the 6-digit
  // code needs its own brute-force limit: 5 wrong codes → locked for 15 minutes.
  const key = `sa-totp:${superAdminId}`
  if ((await checkRateLimit(key, TOTP_RATE_LIMIT)).limited) return 'invalid'
  if (verifyTotp(code, admin.totpSecret)) {
    await clearRateLimit(key, TOTP_RATE_LIMIT.category)
    return 'ok'
  }
  await recordRateLimitAttempt(key, TOTP_RATE_LIMIT)
  return 'invalid'
}

const TOTP_RATE_LIMIT = { maxAttempts: 5, windowMs: 15 * 60 * 1000, category: 'admin_totp', failClosed: true }

import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { superAdmins } from '@/lib/db/schema'

authenticator.options = { window: 1 }

export function generateTotpSecret(): string {
  return authenticator.generateSecret()
}

export async function totpQrDataUrl(email: string, secret: string): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  const otpauthUrl = authenticator.keyuri(email, 'POSLanka Control', secret)
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 })
  return { otpauthUrl, qrDataUrl }
}

export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.check(code.replace(/\s+/g, ''), secret)
  } catch {
    return false
  }
}

/** Returns 'ok' | 'required' | 'invalid' for a login attempt. */
export async function checkAdminTotp(superAdminId: string, code?: string): Promise<'ok' | 'required' | 'invalid'> {
  const admin = await db.query.superAdmins.findFirst({
    where: eq(superAdmins.id, superAdminId),
    columns: { totpEnabled: true, totpSecret: true },
  })
  if (!admin?.totpEnabled || !admin.totpSecret) return 'ok'
  if (!code) return 'required'
  return verifyTotp(code, admin.totpSecret) ? 'ok' : 'invalid'
}

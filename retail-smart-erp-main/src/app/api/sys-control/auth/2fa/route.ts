import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { superAdmins } from '@/lib/db/schema'
import { validateAdminSession, adminAudit } from '@/lib/admin'
import { generateTotpSecret, totpQrDataUrl, verifyTotp } from '@/lib/admin/totp'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'

const actionSchema = z.object({
  action: z.enum(['setup', 'enable', 'disable']),
  code: z.string().regex(/^\d{6}$/).optional(),
})

/** GET /api/sys-control/auth/2fa → { enabled } */
export async function GET() {
  const session = await validateAdminSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await db.query.superAdmins.findFirst({ where: eq(superAdmins.id, session.superAdminId), columns: { totpEnabled: true, email: true } })
  return NextResponse.json({ enabled: !!admin?.totpEnabled, email: admin?.email })
}

/**
 * POST /api/sys-control/auth/2fa
 *  { action:'setup' }            → generates a pending secret, returns { secret, otpauthUrl, qrDataUrl }
 *  { action:'enable', code }     → verifies the code against the pending secret and turns 2FA on
 *  { action:'disable', code }    → verifies a current code and turns 2FA off
 */
export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await validateBody(request, actionSchema)
    if (!parsed.success) return parsed.response
    const { action, code } = parsed.data

    const admin = await db.query.superAdmins.findFirst({ where: eq(superAdmins.id, session.superAdminId) })
    if (!admin) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })

    if (action === 'setup') {
      if (admin.totpEnabled) return NextResponse.json({ error: '2FA is already enabled. Disable it first to re-enrol.' }, { status: 400 })
      const secret = generateTotpSecret()
      await db.update(superAdmins).set({ totpSecret: secret, totpEnabled: false, updatedAt: new Date() }).where(eq(superAdmins.id, admin.id))
      const { otpauthUrl, qrDataUrl } = await totpQrDataUrl(admin.email, secret)
      return NextResponse.json({ secret, otpauthUrl, qrDataUrl })
    }

    if (!code) return NextResponse.json({ error: 'A 6-digit code is required' }, { status: 400 })
    if (!admin.totpSecret) return NextResponse.json({ error: 'Run setup first' }, { status: 400 })
    if (!verifyTotp(code, admin.totpSecret)) return NextResponse.json({ error: 'Invalid code' }, { status: 403 })

    if (action === 'enable') {
      await db.update(superAdmins).set({ totpEnabled: true, updatedAt: new Date() }).where(eq(superAdmins.id, admin.id))
      await adminAudit.update(session.superAdminId, 'super_admin', admin.id, { twoFactor: 'enabled' })
      return NextResponse.json({ enabled: true })
    }
    await db.update(superAdmins).set({ totpEnabled: false, totpSecret: null, updatedAt: new Date() }).where(eq(superAdmins.id, admin.id))
    await adminAudit.update(session.superAdminId, 'super_admin', admin.id, { twoFactor: 'disabled' })
    return NextResponse.json({ enabled: false })
  } catch (error) {
    logError('api/sys-control/auth/2fa', error)
    return NextResponse.json({ error: 'Two-factor operation failed' }, { status: 500 })
  }
}

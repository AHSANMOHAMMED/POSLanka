import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateSuperAdmin, createAdminSession, withRateLimit, LOGIN_LIMIT } from '@/lib/admin'
import { checkAdminTotp } from '@/lib/admin/totp'
import { adminPermissionsOf } from '@/lib/admin/roles'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { db } from '@/lib/db'
import { superAdmins } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
})

/**
 * POST /api/sys-control/auth/mobile-login
 * Super-admin login for the mobile companion. Returns a bearer token (prefix `sa_`)
 * accepted by every /api/sys-control route via `Authorization: Bearer`.
 * 428 { requires2fa: true } when the admin has TOTP enabled and no/invalid code was sent.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/auth/mobile-login', LOGIN_LIMIT)
    if (rateLimited) return rateLimited

    const parsed = await validateBody(request, schema)
    if (!parsed.success) return parsed.response
    const { email, password, totpCode } = parsed.data

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined
    const result = await authenticateSuperAdmin(email, password, ip)
    if (!result.success || !result.admin) {
      return NextResponse.json({ error: result.error || 'Invalid credentials' }, { status: 401 })
    }

    const totp = await checkAdminTotp(result.admin.id, totpCode)
    if (totp === 'required') return NextResponse.json({ requires2fa: true, error: 'Two-factor code required' }, { status: 428 })
    if (totp === 'invalid') return NextResponse.json({ requires2fa: true, error: 'Invalid two-factor code' }, { status: 401 })

    // Setup another admin requires (new password / 2FA enrolment) can only be completed in the web console
    const state = await db.query.superAdmins.findFirst({
      where: eq(superAdmins.id, result.admin.id),
      columns: { mustChangePassword: true, totpRequired: true, totpEnabled: true },
    })
    if (state && (state.mustChangePassword || (state.totpRequired && !state.totpEnabled))) {
      return NextResponse.json({
        error: state.mustChangePassword
          ? 'Choose a new password in the web console before using the app.'
          : 'Set up two-factor authentication in the web console before using the app.',
        code: 'ACCOUNT_SETUP_REQUIRED',
        setup: { mustChangePassword: state.mustChangePassword, totpRequired: state.totpRequired && !state.totpEnabled },
      }, { status: 403 })
    }

    const token = await createAdminSession(result.admin.id, { setCookie: false })
    // The role decides what the companion app shows; every sys-control route enforces it again
    return NextResponse.json({
      token,
      admin: { id: result.admin.id, name: result.admin.fullName, email: result.admin.email, role: result.admin.role },
      permissions: adminPermissionsOf(result.admin.role),
    })
  } catch (error) {
    logError('api/sys-control/auth/mobile-login', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}

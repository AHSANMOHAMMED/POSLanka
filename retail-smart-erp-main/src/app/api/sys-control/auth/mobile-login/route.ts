import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateSuperAdmin, createAdminSession, withRateLimit, LOGIN_LIMIT } from '@/lib/admin'
import { checkAdminTotp } from '@/lib/admin/totp'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'

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

    const token = await createAdminSession(result.admin.id, { setCookie: false })
    return NextResponse.json({ token, admin: { id: result.admin.id, name: result.admin.fullName, email: result.admin.email } })
  } catch (error) {
    logError('api/sys-control/auth/mobile-login', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}

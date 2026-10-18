import { NextRequest, NextResponse } from 'next/server'
import { authenticateSuperAdmin, createAdminSession, withRateLimit, LOGIN_LIMIT } from '@/lib/admin'
import { headers } from 'next/headers'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { sysLoginSchema } from '@/lib/validation/schemas/sys-control'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting for login attempts
    const rateLimited = await withRateLimit('/api/sys-control/auth/login', LOGIN_LIMIT)
    if (rateLimited) return rateLimited

    const parsed = await validateBody(request, sysLoginSchema)
    if (!parsed.success) return parsed.response
    const { email, password } = parsed.data

    // Get IP address for logging
    const headersList = await headers()
    const forwardedFor = headersList.get('x-forwarded-for')
    const realIp = headersList.get('x-real-ip')
    const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || undefined

    // Authenticate super admin
    const result = await authenticateSuperAdmin(email, password, ipAddress)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      )
    }

    // Create session
    await createAdminSession(result.admin!.id)

    return NextResponse.json({
      success: true,
      admin: {
        email: result.admin!.email,
        fullName: result.admin!.fullName,
      },
    })
  } catch (error) {
    logError('api/sys-control/auth/login', error)
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    )
  }
}

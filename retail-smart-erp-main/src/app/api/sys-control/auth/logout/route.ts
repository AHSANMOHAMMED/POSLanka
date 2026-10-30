import { publicUrl } from '@/lib/http/public-url'
import { NextResponse, type NextRequest } from 'next/server'
import { destroyAdminSession, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession({ permission: 'self', allowPendingSetup: true })

    if (session) {
      // The signed-in session (cookie or the app's bearer token)
      await destroyAdminSession(session.sessionToken)
    }

    // The app (bearer) wants JSON; the web console is redirected to the login page
    if (request.headers.get('authorization')?.startsWith('Bearer ')) return NextResponse.json({ ok: true })
    return NextResponse.redirect(publicUrl(request, '/sys-control/login'))
  } catch (error) {
    logError('api/sys-control/auth/logout', error)
    // Even on error, redirect to login
    return NextResponse.redirect(publicUrl(request, '/sys-control/login'))
  }
}

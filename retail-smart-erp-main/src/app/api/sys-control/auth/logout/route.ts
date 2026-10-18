import { NextResponse } from 'next/server'
import { destroyAdminSession, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function POST() {
  try {
    const session = await validateAdminSession()

    if (session) {
      await destroyAdminSession()
    }

    // Redirect to login page after logout
    return NextResponse.redirect(new URL('/sys-control/login', process.env.NEXTAUTH_URL || 'http://localhost:3000'))
  } catch (error) {
    logError('api/sys-control/auth/logout', error)
    // Even on error, redirect to login
    return NextResponse.redirect(new URL('/sys-control/login', process.env.NEXTAUTH_URL || 'http://localhost:3000'))
  }
}

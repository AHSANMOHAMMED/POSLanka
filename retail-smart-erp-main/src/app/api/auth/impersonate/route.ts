import { NextRequest, NextResponse } from 'next/server'
import { signIn } from '@/lib/auth'

/**
 * Completes Super Admin impersonation by exchanging a short-lived token
 * for a company session, then redirecting into the vendor app.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const slug = request.nextUrl.searchParams.get('slug')

  if (!token || !slug) {
    return NextResponse.redirect(new URL('/sys-control/vendors?error=missing_token', request.url))
  }

  try {
    await signIn('impersonate', {
      impersonateToken: token,
      redirect: false,
    })
  } catch (error) {
    console.error('[Impersonate] signIn failed:', error)
    return NextResponse.redirect(new URL('/sys-control/vendors?error=impersonate_failed', request.url))
  }

  return NextResponse.redirect(new URL(`/c/${slug}/dashboard`, request.url))
}

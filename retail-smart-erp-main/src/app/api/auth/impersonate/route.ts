import { z } from 'zod'
import { publicUrl } from '@/lib/http/public-url'
import { NextRequest, NextResponse } from 'next/server'
import { signIn } from '@/lib/auth'
import { validateBody } from '@/lib/validation/helpers'

const impersonateBodySchema = z.object({
  c: z.string().optional(),
  jti: z.string().optional(),
  token: z.string().optional(),
  slug: z.string().optional(),
})

async function exchange(request: NextRequest, tokenOrJti: string | null, slug: string | null) {
  if (!tokenOrJti || !slug) {
    return NextResponse.redirect(publicUrl(request, '/sys-control/vendors?error=missing_token'))
  }

  try {
    await signIn('impersonate', {
      impersonateToken: tokenOrJti,
      redirect: false,
    })
  } catch (error) {
    console.error('[Impersonate] signIn failed:', error)
    return NextResponse.redirect(publicUrl(request, '/sys-control/vendors?error=impersonate_failed'))
  }

  // Never bounce the secret back into the Location header / browser history.
  return NextResponse.redirect(publicUrl(request, `/c/${encodeURIComponent(slug)}/dashboard`))
}

/**
 * Completes Super Admin impersonation by exchanging a short-lived opaque code (`c=`)
 * or legacy JWT (`token=`) for a company session, then redirecting into the vendor app.
 * Prefer POST (form body) so secrets never hit access logs / Referer.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('c')
  const token = request.nextUrl.searchParams.get('token')
  const slug = request.nextUrl.searchParams.get('slug')
  return exchange(request, code || token, slug)
}

export async function POST(request: NextRequest) {
  let tokenOrJti: string | null = null
  let slug: string | null = null
  const contentType = request.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const parsed = await validateBody(request, impersonateBodySchema)
      if (parsed.success) {
        tokenOrJti = (parsed.data.c || parsed.data.jti || parsed.data.token || '').trim() || null
        slug = (parsed.data.slug || '').trim() || null
      }
    } else {
      const form = await request.formData().catch(() => null)
      if (form) {
        tokenOrJti = String(form.get('c') || form.get('jti') || form.get('token') || '').trim() || null
        slug = String(form.get('slug') || '').trim() || null
      }
    }
  } catch {
    // fall through to missing_token
  }
  return exchange(request, tokenOrJti, slug)
}

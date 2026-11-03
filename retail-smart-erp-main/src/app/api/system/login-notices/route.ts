import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { getLoginNotices } from '@/lib/admin/login-notices'
import { clientIp, consumeRateLimit, rateLimitedResponse } from '@/lib/auth/rate-limit'

const PUBLIC_GET_LIMIT = { maxAttempts: 60, windowMs: 60_000, category: 'login_notices' }

/**
 * GET /api/system/login-notices?locale=en|si|ta&slug=company-slug
 * Public: platform announcement + SA broadcasts marked “show on login” for this vendor.
 */
export async function GET(req: NextRequest) {
  try {
    const limit = await consumeRateLimit(clientIp(req), PUBLIC_GET_LIMIT)
    if (limit.limited) return rateLimitedResponse(limit)

    const locale = req.nextUrl.searchParams.get('locale')
    const slug = req.nextUrl.searchParams.get('slug')
    const data = await getLoginNotices({ locale, slug })
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    })
  } catch (error) {
    logError('api/system/login-notices', error)
    return NextResponse.json({ locale: 'en', notices: [] })
  }
}

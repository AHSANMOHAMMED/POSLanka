import { createHash } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * JSON response with a strong ETag for read-mostly, per-user data (tenant settings, pricing
 * bundle). `private, no-cache` lets the browser / mobile client keep the body but revalidate on
 * every use, so an edit is visible immediately while unchanged data costs a 304 with no body.
 * (A max-age would serve stale settings right after the user saved them.)
 */
export function jsonWithEtag(request: Request | undefined, data: unknown, cacheControl = 'private, no-cache'): NextResponse {
  const body = JSON.stringify(data)
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`
  const headers = { ETag: etag, 'Cache-Control': cacheControl, Vary: 'Cookie, Authorization' }
  const inm = request?.headers.get('if-none-match')
  if (inm && inm.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(etag)) {
    return new NextResponse(null, { status: 304, headers })
  }
  return new NextResponse(body, { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } })
}

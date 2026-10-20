import { NextResponse } from 'next/server'
import { toApiError } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'
import { IntakeError } from './stock-intake'

/** Map stock-intake / DB errors to an API response (500 is logged). */
export function intakeErrorResponse(err: unknown, context: string, fallback: string): NextResponse {
  if (err instanceof IntakeError) {
    return NextResponse.json({ error: err.message, code: err.code, ...(err.extra || {}) }, { status: err.status })
  }
  const mapped = toApiError(err)
  if (mapped) return mapped
  logError(context, err)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/** Requests from the mobile app: `X-Client: mobile`, a Bearer token, or body `source: 'mobile'`. */
export function isMobileRequest(request: Request, bodySource?: string): boolean {
  if (bodySource === 'mobile') return true
  if ((request.headers.get('x-client') || '').toLowerCase() === 'mobile') return true
  return /^bearer\s+/i.test(request.headers.get('authorization') || '')
}

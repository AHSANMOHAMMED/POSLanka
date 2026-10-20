import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * Fail-closed CRON_SECRET check for /api/cron/* routes (Authorization: Bearer <CRON_SECRET>).
 * Returns a 401 response when the secret is missing or wrong, otherwise null.
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  const ok = !!secret && header.length === expected.length
    && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  return ok ? null : NextResponse.json({ error: 'Unauthorized. Provide valid CRON_SECRET.' }, { status: 401 })
}

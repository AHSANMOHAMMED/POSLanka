/** Keep-alive used by some push firmware between uploads. Public, authenticated by serial. */
import { NextRequest } from 'next/server'
import { resolveDevice, text, touchDevice } from '@/lib/attendance/iclock-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const r = await resolveDevice(request)
    if (r.kind === 'reject') return r.response
    if (r.kind === 'device') await touchDevice(r.device, r.ip)
  } catch {
    // ignore
  }
  return text('OK')
}

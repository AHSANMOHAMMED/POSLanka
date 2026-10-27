/**
 * ZKTeco ADMS command poll: the device asks for pending commands every `Delay` seconds.
 * No server commands are queued, so a registered device always gets "OK". Also refreshes
 * last_seen_at (the "online" indicator on the Devices page). Public, authenticated by serial.
 */
import { NextRequest } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { resolveDevice, text, touchDevice } from '@/lib/attendance/iclock-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const info = request.nextUrl.searchParams.get('INFO')
    const r = await resolveDevice(request)
    if (r.kind === 'reject') return r.response
    if (r.kind === 'unknown') return text('OK')
    // INFO=firmware,users,fingerprints,punches,ip,… (sent by most firmware on the first poll)
    await touchDevice(r.device, r.ip, info ? { info: { info: info.slice(0, 300) } } : undefined)
    return text('OK')
  } catch (err) {
    logError('iclock/getrequest', err)
    return text('OK')
  }
}

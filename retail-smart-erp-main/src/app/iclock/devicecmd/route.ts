/**
 * ZKTeco ADMS command results (the device reports the outcome of server commands). We send no
 * commands, so this only acknowledges. Public, authenticated by serial.
 */
import { NextRequest } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { readBody, resolveDevice, text, touchDevice } from '@/lib/attendance/iclock-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const r = await resolveDevice(request)
    if (r.kind === 'reject') return r.response
    await readBody(request)
    if (r.kind === 'device') await touchDevice(r.device, r.ip)
    return text('OK')
  } catch (err) {
    logError('iclock/devicecmd', err)
    return text('OK')
  }
}

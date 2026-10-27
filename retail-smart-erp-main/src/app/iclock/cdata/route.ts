/**
 * ZKTeco ADMS push: handshake (GET) and data upload (POST). See src/lib/attendance/iclock.ts.
 * Public (devices cannot log in): authenticated by the registered serial number.
 */
import { NextRequest } from 'next/server'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { attLogInstant, countLines, handshakeText, parseAttLog, parseOperLogUsers, punchTypeFromStatus, verifyLabel } from '@/lib/attendance/iclock'
import { readBody, resolveDevice, text, touchDevice } from '@/lib/attendance/iclock-server'
import { ingestPunches } from '@/lib/attendance/ingest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl
    const info: Record<string, unknown> = {}
    for (const k of ['pushver', 'language', 'options', 'DeviceType', 'PushOptionsFlag']) {
      const v = url.searchParams.get(k)
      if (v) info[k] = v.slice(0, 50)
    }
    const r = await resolveDevice(request, info)
    if (r.kind === 'reject') return r.response
    if (r.kind === 'unknown') return text(handshakeText(r.sn, { registered: false, attlogStamp: '9999999999', operlogStamp: '9999999999' }))
    const operlogStamp = (r.device.deviceInfo?.operlogStamp as string | undefined) ?? null
    await touchDevice(r.device, r.ip, Object.keys(info).length ? { info: { handshake: info } } : undefined)
    return text(handshakeText(r.sn, { registered: true, attlogStamp: r.device.attlogStamp, operlogStamp }))
  } catch (err) {
    logError('iclock/cdata GET', err)
    return text('ERROR', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const r = await resolveDevice(request)
    if (r.kind === 'reject') return r.response
    // Refused (not "OK") so the terminal keeps the records and re-sends once it is registered
    if (r.kind === 'unknown') return text('ERROR: device not registered', 403)

    const url = request.nextUrl
    const table = (url.searchParams.get('table') || '').toUpperCase()
    const stamp = (url.searchParams.get('Stamp') || url.searchParams.get('stamp') || '').slice(0, 50) || null
    const body = await readBody(request)
    if (body === null) return text('ERROR: body too large', 413)
    const device = r.device

    if (table === 'ATTLOG') {
      const records = parseAttLog(body)
      if (records.length > 0) {
        const result = await withTenant(device.tenantId, (db) => ingestPunches(db, device.tenantId, records.map((rec) => ({
          biometricUserId: rec.pin,
          punchTime: attLogInstant(rec, device.timezone),
          punchType: punchTypeFromStatus(rec.status),
          verifyMode: rec.verify ? verifyLabel(rec.verify) : null,
          source: 'device' as const,
          deviceId: device.id,
          raw: { line: rec.line },
        })), device.timezone))
        if (result.inserted > 0) logAndBroadcast(device.tenantId, 'attendance', 'updated', device.id, { entityName: `Device ${device.serialNumber}`, description: `${result.inserted} punches received` })
      }
      await touchDevice(device, r.ip, { attlogStamp: stamp })
      return text(`OK: ${records.length}`)
    }

    if (table === 'OPERLOG') {
      const users = parseOperLogUsers(body)
      const opStamp = (url.searchParams.get('OpStamp') || stamp || '').slice(0, 50)
      const patchInfo: Record<string, unknown> = {}
      if (opStamp) patchInfo.operlogStamp = opStamp
      if (Object.keys(users).length > 0) {
        const prev = (device.deviceInfo?.users as Record<string, string> | undefined) ?? {}
        const merged = { ...prev, ...users }
        // Keep the user list bounded
        patchInfo.users = Object.fromEntries(Object.entries(merged).slice(0, 5000))
      }
      await touchDevice(device, r.ip, Object.keys(patchInfo).length ? { info: patchInfo } : undefined)
      if (patchInfo.users) device.deviceInfo = { ...(device.deviceInfo ?? {}), users: patchInfo.users }
      return text(`OK: ${countLines(body)}`)
    }

    // ATTPHOTO, BIODATA, options … acknowledged, not stored
    await touchDevice(device, r.ip)
    return text(`OK: ${countLines(body)}`)
  } catch (err) {
    logError('iclock/cdata POST', err)
    // Not OK → the device retries later and nothing is lost
    return text('ERROR', 500)
  }
}

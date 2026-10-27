/**
 * Server side of the iclock push endpoints (src/app/iclock/*). Devices cannot log in, so:
 *  - the serial number (?SN=) is looked up on the privileged connection (`db`, the same path the
 *    PayHere / WebXPay webhooks use) to find the tenant; only active registered devices count;
 *  - everything written for a known device goes through withTenant(device.tenantId) (RLS);
 *  - unknown serials are remembered in attendance_pending_devices (so the admin's register form
 *    can say "this device has contacted the server") and get a back-off handshake; their punch
 *    uploads are refused, so the terminal keeps them and re-sends after it is registered.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { clientIp, consumeRateLimit } from '@/lib/auth/rate-limit'
import { cleanSerial } from './iclock'
import { safeTimezone } from './time'

export interface IclockDevice {
  id: string
  tenantId: string
  serialNumber: string
  timezone: string
  attlogStamp: string | null
  deviceInfo: Record<string, unknown> | null
  lastSeenAt: Date | null
}

export const MAX_BODY_BYTES = 5 * 1024 * 1024

export function text(body: string, status = 200): NextResponse {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

// Per-serial in-process limiter for registered devices (they poll every ~10 s)
const hits = new Map<string, { n: number; at: number }>()
function deviceRateLimited(sn: string, max = 240, windowMs = 60_000): boolean {
  const now = Date.now()
  const h = hits.get(sn)
  if (!h || now - h.at > windowMs) {
    if (hits.size > 20000) hits.clear()
    hits.set(sn, { n: 1, at: now })
    return false
  }
  h.n++
  return h.n > max
}

// Short cache of serial → device (the handshake and every poll look it up)
const deviceCache = new Map<string, { device: IclockDevice | null; at: number }>()
const DEVICE_TTL_MS = 30_000

export function invalidateIclockDevice(serial?: string) {
  if (!serial) deviceCache.clear()
  else deviceCache.delete(serial.toUpperCase())
}

export async function findDevice(sn: string): Promise<IclockDevice | null> {
  const key = sn.toUpperCase()
  const hit = deviceCache.get(key)
  if (hit && Date.now() - hit.at < DEVICE_TTL_MS) return hit.device
  // Privileged lookup: a device has no session; the serial is the credential (registered + active)
  const res = await db.execute(sql`
    SELECT id, tenant_id, serial_number, timezone, attlog_stamp, device_info, last_seen_at
      FROM attendance_devices
     WHERE upper(serial_number) = ${key} AND is_active = true
     LIMIT 1`)
  const row = res.rows?.[0] as Record<string, unknown> | undefined
  const device: IclockDevice | null = row ? {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    serialNumber: String(row.serial_number),
    timezone: safeTimezone(row.timezone as string),
    attlogStamp: (row.attlog_stamp as string | null) ?? null,
    deviceInfo: (row.device_info as Record<string, unknown> | null) ?? null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as string) : null,
  } : null
  if (deviceCache.size > 5000) deviceCache.clear()
  deviceCache.set(key, { device, at: Date.now() })
  return device
}

export type DeviceResolution =
  | { kind: 'device'; sn: string; device: IclockDevice; ip: string }
  | { kind: 'unknown'; sn: string; ip: string }
  | { kind: 'reject'; response: NextResponse }

/** Validate ?SN=, rate-limit, and resolve the device (or record an unknown serial). */
export async function resolveDevice(request: Request, info?: Record<string, unknown>): Promise<DeviceResolution> {
  const url = new URL(request.url)
  const sn = cleanSerial(url.searchParams.get('SN') || url.searchParams.get('sn'))
  const ip = clientIp(request)
  if (!sn) return { kind: 'reject', response: text('ERROR: missing SN', 400) }

  let device: IclockDevice | null = null
  try {
    device = await findDevice(sn)
  } catch (err) {
    logError('iclock/findDevice', err)
    return { kind: 'reject', response: text('ERROR', 503) }
  }

  if (device) {
    if (deviceRateLimited(sn)) return { kind: 'reject', response: text('ERROR: too many requests', 429) }
    return { kind: 'device', sn, device, ip }
  }

  // Unknown serial: DB-backed limit per IP (also caps writes to the pending table)
  const limited = await consumeRateLimit(`iclock:${ip}`, { maxAttempts: 120, windowMs: 10 * 60_000, category: 'iclock_unknown' })
  if (limited.limited) return { kind: 'reject', response: text('ERROR: too many requests', 429) }
  try {
    await db.execute(sql`
      INSERT INTO attendance_pending_devices (serial_number, last_ip, info)
      VALUES (${sn}, ${ip.slice(0, 64)}, ${info ? JSON.stringify(info) : null}::jsonb)
      ON CONFLICT (serial_number) DO UPDATE SET
        last_seen_at = now(), last_ip = EXCLUDED.last_ip, hits = attendance_pending_devices.hits + 1,
        info = COALESCE(EXCLUDED.info, attendance_pending_devices.info)`)
  } catch (err) {
    logError('iclock/pending', err)
  }
  console.warn(`[iclock] unregistered device SN=${sn} ip=${ip}`)
  return { kind: 'unknown', sn, ip }
}

/** last_seen_at / IP (at most once a minute) and optional stamps / info merged into device_info. */
export async function touchDevice(device: IclockDevice, ip: string, patch?: { attlogStamp?: string | null; info?: Record<string, unknown> }) {
  const stale = !device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000
  if (!stale && !patch) return
  try {
    await withTenant(device.tenantId, async (tdb) => {
      await tdb.execute(sql`
        UPDATE attendance_devices SET
          last_seen_at = now(),
          last_ip = ${ip.slice(0, 64)},
          attlog_stamp = COALESCE(${patch?.attlogStamp ?? null}, attlog_stamp),
          device_info = CASE WHEN ${patch?.info ? JSON.stringify(patch.info) : null}::jsonb IS NULL THEN device_info
                             ELSE COALESCE(device_info, '{}'::jsonb) || ${patch?.info ? JSON.stringify(patch.info) : null}::jsonb END
        WHERE id = ${device.id}`)
    })
    device.lastSeenAt = new Date()
    if (patch?.attlogStamp) device.attlogStamp = patch.attlogStamp
  } catch (err) {
    logError('iclock/touch', err)
  }
}

/** Read a request body as text, refusing oversized uploads. */
export async function readBody(request: Request): Promise<string | null> {
  const len = Number(request.headers.get('content-length') || 0)
  if (len > MAX_BODY_BYTES) return null
  const buf = await request.arrayBuffer()
  if (buf.byteLength > MAX_BODY_BYTES) return null
  return new TextDecoder('utf-8').decode(buf)
}

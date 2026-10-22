/**
 * Cross-instance fan-out for realtime broadcasts (WebSocket + SSE) over Postgres LISTEN/NOTIFY.
 *
 * Every broadcast is still delivered to this process's own clients first, exactly as on a single
 * instance. It is additionally published with pg_notify on channel `ws_broadcast`, tagged with
 * this process's instance id; every app instance LISTENs on one dedicated connection and
 * delivers messages coming from *other* instances to its local clients. No Redis needed.
 *
 *   BROADCAST_FANOUT=off   disable publishing and listening (single instance, or tests)
 *   PG_LISTEN=off          disables every LISTEN subscriber, fan-out included
 *
 * Postgres limits a NOTIFY payload to 8000 bytes; larger messages are sent without `data`
 * (clients only use `data` as a hint and refetch by id/entity type anyway).
 */
import { getSharedPool } from '@/lib/db/pool'
import { subscribe, listenEnabled, listenConnected, stopListening } from '@/lib/db/listen-hub'
import { createLogger } from '@/lib/logger'
import { metricsState } from '@/lib/observability/metrics'

export const FANOUT_CHANNEL = 'ws_broadcast'
const MAX_PAYLOAD_BYTES = 7900

export type FanoutKind = 'tenant' | 'account'

export interface FanoutMessage {
  /** origin instance id — receivers drop their own messages */
  o: string
  k: FanoutKind
  m: {
    tenantId?: string
    userId?: string
    entityType: string
    action: 'created' | 'updated' | 'deleted'
    id: string
    data?: Record<string, unknown>
  }
}

type Deliver = (kind: FanoutKind, msg: FanoutMessage['m']) => void

declare global {
  var __poslankaInstanceId: string | undefined
  var __poslankaFanoutUnsubscribe: (() => void) | undefined
}

const log = createLogger('fanout')

/** Stable id of this process (shared by server.js and the Next.js bundles via globalThis). */
export function instanceId(): string {
  return (globalThis.__poslankaInstanceId ||= `${process.pid}-${globalThis.crypto.randomUUID().slice(0, 8)}`)
}

export function fanoutEnabled(): boolean {
  return (process.env.BROADCAST_FANOUT || '').toLowerCase() !== 'off' && listenEnabled()
}

/** Serialize a message for NOTIFY, dropping `data` when it would exceed the payload limit. */
export function encodeFanout(kind: FanoutKind, msg: FanoutMessage['m'], origin = instanceId()): string {
  const full = JSON.stringify({ o: origin, k: kind, m: msg } satisfies FanoutMessage)
  if (Buffer.byteLength(full) <= MAX_PAYLOAD_BYTES) return full
  const { data: _data, ...slim } = msg
  void _data
  return JSON.stringify({ o: origin, k: kind, m: { ...slim, data: { truncated: true } } } satisfies FanoutMessage)
}

/** Publish to other instances. Fire-and-forget: a failed publish never breaks the API route. */
export function publishFanout(kind: FanoutKind, msg: FanoutMessage['m']): void {
  if (!fanoutEnabled()) return
  let payload: string
  try {
    payload = encodeFanout(kind, msg)
  } catch {
    return
  }
  const m = metricsState()
  getSharedPool()
    .query('SELECT pg_notify($1, $2)', [FANOUT_CHANNEL, payload])
    .then(() => { m.fanoutPublished++ })
    .catch((err: Error) => {
      m.fanoutErrors++
      log.warn('publish failed', { err: err.message })
    })
}

/** Parse and filter a NOTIFY payload; returns null for our own / malformed messages. */
export function decodeFanout(payload: string | undefined, self = instanceId()): FanoutMessage | null {
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as FanoutMessage
    if (!parsed || parsed.o === self) return null
    if (parsed.k !== 'tenant' && parsed.k !== 'account') return null
    const msg = parsed.m
    if (!msg || typeof msg.id !== 'string' || typeof msg.entityType !== 'string') return null
    if (msg.action !== 'created' && msg.action !== 'updated' && msg.action !== 'deleted') return null
    if (parsed.k === 'tenant' && typeof msg.tenantId !== 'string') return null
    if (parsed.k === 'account' && typeof msg.userId !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Deliver broadcasts published by other instances to `deliver` (idempotent: a second call
 * replaces the first). Uses the process-wide LISTEN connection (src/lib/db/listen-hub.ts).
 * Returns false when fan-out is disabled.
 */
export function startFanoutListener(deliver: Deliver): boolean {
  if (!fanoutEnabled()) return false
  globalThis.__poslankaFanoutUnsubscribe?.()
  globalThis.__poslankaFanoutUnsubscribe = subscribe(FANOUT_CHANNEL, (payload) => {
    const msg = decodeFanout(payload)
    if (!msg) return
    metricsState().fanoutReceived++
    try {
      deliver(msg.k, msg.m)
    } catch (err) {
      log.error('deliver failed', { err })
    }
  })
  return true
}

/** True while the shared LISTEN connection is up (reported by /api/health/ready). */
export function fanoutListening(): boolean {
  return listenConnected()
}

export async function stopFanoutListener(): Promise<void> {
  globalThis.__poslankaFanoutUnsubscribe?.()
  globalThis.__poslankaFanoutUnsubscribe = undefined
  await stopListening()
}

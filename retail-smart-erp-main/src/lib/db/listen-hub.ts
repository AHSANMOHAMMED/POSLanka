/**
 * One dedicated Postgres LISTEN connection per process, shared by every subscriber
 * (realtime broadcast fan-out, cache invalidation). Reconnects with exponential backoff
 * (1 s → 60 s) like the permission-cache listener; after a reconnect every subscriber's
 * `onReconnect` runs, because notifications sent while disconnected are lost (caches drop
 * their entries).
 *
 * State lives on globalThis: server.js and the Next.js bundles are separate module instances in
 * the same process and must share the connection.
 *
 *   PG_LISTEN=off   never open the connection (scripts / tests that do not need it)
 */
import { Client } from 'pg'
import { pgConnectionConfig } from './pg-connection'
import { createLogger } from '@/lib/logger'

type Handler = (payload: string | undefined) => void

interface Subscription {
  handler: Handler
  onReconnect?: () => void
}

interface HubState {
  client: Client | null
  starting: boolean
  stopped: boolean
  retryMs: number
  timer: NodeJS.Timeout | null
  channels: Map<string, Set<Subscription>>
  everConnected: boolean
}

declare global {
  var __poslankaListenHub: HubState | undefined
}

const log = createLogger('pg-listen')
const CHANNEL_RE = /^[a-z_][a-z0-9_]{0,62}$/

function hub(): HubState {
  return (globalThis.__poslankaListenHub ||= {
    client: null, starting: false, stopped: false, retryMs: 1000, timer: null,
    channels: new Map(), everConnected: false,
  })
}

export function listenEnabled(): boolean {
  return (process.env.PG_LISTEN || '').toLowerCase() !== 'off' && !!process.env.DATABASE_URL
}

/**
 * Subscribe to a NOTIFY channel. Returns an unsubscribe function. Opens the shared connection
 * on first use (no-op when listening is disabled).
 */
export function subscribe(channel: string, handler: Handler, onReconnect?: () => void): () => void {
  if (!CHANNEL_RE.test(channel)) throw new Error(`invalid channel ${channel}`)
  const s = hub()
  const sub: Subscription = { handler, onReconnect }
  let set = s.channels.get(channel)
  const isNew = !set
  if (!set) { set = new Set(); s.channels.set(channel, set) }
  set.add(sub)
  if (listenEnabled()) {
    s.stopped = false
    if (s.client && isNew) s.client.query(`LISTEN ${channel}`).catch(() => undefined)
    connect()
  }
  return () => {
    set!.delete(sub)
  }
}

function connect(): void {
  const s = hub()
  if (s.client || s.starting || s.stopped || !listenEnabled()) return
  s.starting = true
  const client = new Client({ ...pgConnectionConfig(process.env.DATABASE_URL), keepAlive: true })
  let failed = false
  const retry = (err?: unknown) => {
    if (failed) return
    failed = true
    if (s.client === client) s.client = null
    s.starting = false
    client.removeAllListeners()
    client.on('error', () => undefined)
    client.end().catch(() => undefined)
    if (s.stopped) return
    const wait = s.retryMs
    s.retryMs = Math.min(s.retryMs * 2, 60_000)
    log.warn('listener disconnected, reconnecting', { retryInMs: wait, err: err instanceof Error ? err.message : undefined })
    s.timer = setTimeout(() => { s.timer = null; connect() }, wait)
    s.timer.unref?.()
  }
  client.on('notification', (n) => {
    const subs = s.channels.get(n.channel)
    if (!subs) return
    for (const sub of subs) {
      try {
        sub.handler(n.payload)
      } catch (err) {
        log.error('notification handler failed', { channel: n.channel, err })
      }
    }
  })
  client.on('error', retry)
  client.on('end', () => retry())
  client.connect()
    .then(async () => {
      if (s.stopped) { retry(); return }
      // Publish the client first: channels subscribed from now on LISTEN directly in subscribe()
      s.client = client
      s.starting = false
      for (const ch of s.channels.keys()) await client.query(`LISTEN ${ch}`)
      s.retryMs = 1000
      // Never keep a process (tests, scripts) alive just for this socket
      ;(client as unknown as { connection?: { stream?: { unref?: () => void } } }).connection?.stream?.unref?.()
      if (s.everConnected) {
        // Anything published while we were disconnected is unknown
        for (const subs of s.channels.values()) for (const sub of subs) {
          try { sub.onReconnect?.() } catch { /* ignore */ }
        }
      }
      s.everConnected = true
      log.info('listening', { channels: [...s.channels.keys()] })
    })
    .catch(retry)
}

/** True while the shared LISTEN connection is up. */
export function listenConnected(): boolean {
  return !!globalThis.__poslankaListenHub?.client
}

/** Close the shared connection (graceful shutdown / tests). Subscriptions are kept. */
export async function stopListening(): Promise<void> {
  const s = globalThis.__poslankaListenHub
  if (!s) return
  s.stopped = true
  if (s.timer) { clearTimeout(s.timer); s.timer = null }
  const c = s.client
  s.client = null
  if (c) {
    c.removeAllListeners()
    c.on('error', () => undefined)
    await c.end().catch(() => undefined)
  }
}

/** Resolves once the connection is listening (tests), or false after `timeoutMs`. */
export async function waitForListening(timeoutMs = 5000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (listenConnected()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

import { getSharedPool } from '@/lib/db/pool'
import { isShuttingDown } from '@/lib/observability/metrics'
import { storageMode } from '@/lib/files/r2'
import { fanoutEnabled, fanoutListening } from '@/lib/websocket/fanout'

export interface DbCheck {
  ok: boolean
  latencyMs: number
  error?: string
}

/** SELECT 1 on the shared pool, bounded by `timeoutMs` (default 2 s). Never throws. */
export async function pingDatabase(timeoutMs = 2000): Promise<DbCheck> {
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      getSharedPool().query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
    return { ok: true, latencyMs: Date.now() - started }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface Readiness {
  ready: boolean
  shuttingDown: boolean
  database: DbCheck
  storage: ReturnType<typeof storageMode>
  realtimeFanout: 'listening' | 'disconnected' | 'disabled'
}

/**
 * Readiness = this instance should receive traffic: not draining and the database answers.
 * Storage / fan-out are reported but do not fail readiness (the app still serves most requests).
 */
export async function checkReadiness(): Promise<Readiness> {
  const shuttingDown = isShuttingDown()
  const database = shuttingDown ? { ok: false, latencyMs: 0, error: 'shutting down' } : await pingDatabase()
  const realtimeFanout = !fanoutEnabled() ? 'disabled' : fanoutListening() ? 'listening' : 'disconnected'
  return { ready: !shuttingDown && database.ok, shuttingDown, database, storage: storageMode(), realtimeFanout }
}

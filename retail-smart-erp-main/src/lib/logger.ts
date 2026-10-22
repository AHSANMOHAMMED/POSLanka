/**
 * Tiny structured logger (no dependencies).
 *
 *   LOG_FORMAT  json | pretty   (default: json in production, pretty otherwise)
 *   LOG_LEVEL   debug | info | warn | error   (default: info)
 *
 * Each line in JSON mode is one object: {"time","level","component","msg","requestId",...fields}.
 * The request id of the current HTTP request (set by server.ts / src/proxy.ts as `x-request-id`)
 * is attached automatically when the call happens inside that request's async context.
 *
 * Use it at the boundaries (server, websocket, cron, db pool, error logger); plain console.* in
 * leaf code still works and is captured by the platform log drain as unstructured text.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface RequestContext {
  requestId: string
  method?: string
  path?: string
}

// One store per process: server.js (esbuild bundle) and the Next.js route bundles each load
// their own copy of this module, so the instance lives on globalThis.
declare global {
  var __poslankaRequestContext: AsyncLocalStorage<RequestContext> | undefined
}

export function requestContextStore(): AsyncLocalStorage<RequestContext> {
  return (globalThis.__poslankaRequestContext ||= new AsyncLocalStorage<RequestContext>())
}

/** Request id of the HTTP request currently being handled (undefined outside a request). */
export function currentRequestId(): string | undefined {
  return requestContextStore().getStore()?.requestId
}

/** Run `fn` with a request context so logs and logError() calls carry the request id. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStore().run(ctx, fn)
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/

/** Accept an upstream request id when it looks sane, otherwise create one. */
export function ensureRequestId(incoming?: string | null): string {
  if (incoming && REQUEST_ID_RE.test(incoming)) return incoming
  return globalThis.crypto.randomUUID()
}

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel
  return LEVELS[lvl] ?? LEVELS.info
}

function jsonMode(): boolean {
  const f = (process.env.LOG_FORMAT || '').toLowerCase()
  if (f === 'json') return true
  if (f === 'pretty') return false
  return process.env.NODE_ENV === 'production'
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown }
    return { type: e.name, message: e.message, code: e.code, stack: e.stack }
  }
  return { message: String(err) }
}

export type LogFields = Record<string, unknown>

function write(level: LogLevel, component: string, msg: string, fields?: LogFields): void {
  if (LEVELS[level] < threshold()) return
  const requestId = currentRequestId()
  const out: Record<string, unknown> = { time: new Date().toISOString(), level, component, msg }
  if (requestId) out.requestId = requestId
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue
      out[k] = k === 'err' || v instanceof Error ? serializeError(v) : v
    }
  }
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  if (jsonMode()) {
    let line: string
    try {
      line = JSON.stringify(out)
    } catch {
      line = JSON.stringify({ time: out.time, level, component, msg, requestId })
    }
    sink(line)
  } else {
    const rest = { ...out }
    delete rest.time; delete rest.level; delete rest.component; delete rest.msg
    const err = rest.err as { stack?: string } | undefined
    if (err?.stack) delete rest.err
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''
    sink(`[${component}] ${msg}${extra}${err?.stack ? `\n${err.stack}` : ''}`)
  }
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(component: string): Logger
}

export function createLogger(component: string): Logger {
  return {
    debug: (m, f) => write('debug', component, m, f),
    info: (m, f) => write('info', component, m, f),
    warn: (m, f) => write('warn', component, m, f),
    error: (m, f) => write('error', component, m, f),
    child: (sub) => createLogger(`${component}:${sub}`),
  }
}

export const logger = createLogger('app')

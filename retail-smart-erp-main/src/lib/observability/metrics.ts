/**
 * Process-wide counters for /api/metrics (Prometheus text exposition format, no dependencies).
 * State lives on globalThis because server.js and the Next.js route bundles are separate module
 * instances inside the same process.
 */

interface MetricsState {
  startedAt: number
  httpRequests: Record<string, number> // by status class: 2xx, 3xx, 4xx, 5xx
  httpDurationMsSum: number
  httpDurationCount: number
  httpSlowRequests: number
  dbQueries: number
  dbQueryErrors: number
  dbSlowQueries: number
  dbQueryMsSum: number
  fanoutPublished: number
  fanoutReceived: number
  fanoutErrors: number
  shuttingDown: boolean
}

declare global {
  var __poslankaMetrics: MetricsState | undefined
}

export function metricsState(): MetricsState {
  return (globalThis.__poslankaMetrics ||= {
    startedAt: Date.now(),
    httpRequests: {},
    httpDurationMsSum: 0,
    httpDurationCount: 0,
    httpSlowRequests: 0,
    dbQueries: 0,
    dbQueryErrors: 0,
    dbSlowQueries: 0,
    dbQueryMsSum: 0,
    fanoutPublished: 0,
    fanoutReceived: 0,
    fanoutErrors: 0,
    shuttingDown: false,
  })
}

export function recordHttpRequest(status: number, durationMs: number, slow: boolean): void {
  const m = metricsState()
  const cls = `${Math.floor(status / 100)}xx`
  m.httpRequests[cls] = (m.httpRequests[cls] || 0) + 1
  m.httpDurationMsSum += durationMs
  m.httpDurationCount++
  if (slow) m.httpSlowRequests++
}

export function recordDbQuery(durationMs: number, failed: boolean, slow: boolean): void {
  const m = metricsState()
  m.dbQueries++
  m.dbQueryMsSum += durationMs
  if (failed) m.dbQueryErrors++
  if (slow) m.dbSlowQueries++
}

/** Readiness flag: set by server.ts on SIGTERM so /api/health/ready returns 503 while draining. */
export function setShuttingDown(v = true): void {
  metricsState().shuttingDown = v
}

export function isShuttingDown(): boolean {
  return metricsState().shuttingDown
}

interface PoolLike { totalCount: number; idleCount: number; waitingCount: number }

export function renderMetrics(pool: PoolLike | null): string {
  const m = metricsState()
  const lines: string[] = []
  const metric = (name: string, type: 'counter' | 'gauge', help: string, samples: Array<[string, number]>) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
    for (const [labels, value] of samples) lines.push(`${name}${labels} ${Number.isFinite(value) ? value : 0}`)
  }
  metric('poslanka_http_requests_total', 'counter', 'HTTP requests handled, by status class',
    Object.entries(m.httpRequests).map(([cls, n]) => [`{status="${cls}"}`, n]))
  metric('poslanka_http_request_duration_ms_sum', 'counter', 'Total HTTP request time (ms)', [['', Math.round(m.httpDurationMsSum)]])
  metric('poslanka_http_request_duration_ms_count', 'counter', 'HTTP requests timed', [['', m.httpDurationCount]])
  metric('poslanka_http_slow_requests_total', 'counter', 'HTTP requests slower than SLOW_REQUEST_MS', [['', m.httpSlowRequests]])
  metric('poslanka_db_queries_total', 'counter', 'Database queries issued through the shared pool', [['', m.dbQueries]])
  metric('poslanka_db_query_errors_total', 'counter', 'Database queries that failed', [['', m.dbQueryErrors]])
  metric('poslanka_db_slow_queries_total', 'counter', 'Database queries slower than SLOW_QUERY_MS', [['', m.dbSlowQueries]])
  metric('poslanka_db_query_duration_ms_sum', 'counter', 'Total database query time (ms)', [['', Math.round(m.dbQueryMsSum)]])
  if (pool) {
    metric('poslanka_db_pool_connections', 'gauge', 'Shared pool connections', [
      ['{state="total"}', pool.totalCount],
      ['{state="idle"}', pool.idleCount],
      ['{state="waiting"}', pool.waitingCount],
    ])
  }
  const ws = (globalThis as { __wsStats?: () => { connections: number; tenants: number } }).__wsStats?.()
  metric('poslanka_realtime_clients', 'gauge', 'Connected WebSocket + SSE clients', [['', ws?.connections ?? 0]])
  metric('poslanka_realtime_tenants', 'gauge', 'Tenants with a connected realtime client', [['', ws?.tenants ?? 0]])
  metric('poslanka_broadcast_fanout_total', 'counter', 'Cross-instance broadcast messages', [
    ['{direction="published"}', m.fanoutPublished],
    ['{direction="received"}', m.fanoutReceived],
    ['{direction="error"}', m.fanoutErrors],
  ])
  const mem = process.memoryUsage()
  metric('poslanka_process_memory_bytes', 'gauge', 'Process memory', [
    ['{type="rss"}', mem.rss],
    ['{type="heap_used"}', mem.heapUsed],
    ['{type="heap_total"}', mem.heapTotal],
    ['{type="external"}', mem.external],
  ])
  metric('poslanka_process_uptime_seconds', 'gauge', 'Seconds since process start', [['', Math.round(process.uptime())]])
  metric('poslanka_shutting_down', 'gauge', '1 while the instance is draining', [['', m.shuttingDown ? 1 : 0]])
  return lines.join('\n') + '\n'
}

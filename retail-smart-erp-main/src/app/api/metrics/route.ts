import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { peekSharedPool } from '@/lib/db/pool'
import { renderMetrics } from '@/lib/observability/metrics'

// Prometheus text exposition for this instance: HTTP status classes and latency, DB pool
// (total / idle / waiting), slow queries, realtime clients, cross-instance fan-out, memory.
// Protected by METRICS_TOKEN (Authorization: Bearer <token>); without the env var the endpoint
// does not exist (404). Scrape every instance (each one reports only itself).
function authorized(request: Request): boolean {
  const token = process.env.METRICS_TOKEN
  if (!token) return false
  const header = request.headers.get('authorization') || ''
  const expected = `Bearer ${token}`
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
}

export function GET(request: Request) {
  if (!process.env.METRICS_TOKEN) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  }
  return new Response(renderMetrics(peekSharedPool()), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export const dynamic = 'force-dynamic'

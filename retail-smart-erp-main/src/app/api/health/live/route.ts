import { NextResponse } from 'next/server'

// Liveness: the process is up and its event loop answers. Never touches the database, so a
// database outage does not make the orchestrator restart healthy app instances in a loop.
export function GET() {
  return NextResponse.json(
    { status: 'ok', uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const dynamic = 'force-dynamic'

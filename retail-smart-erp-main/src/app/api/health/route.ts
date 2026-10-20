import { NextResponse } from 'next/server'
import { checkTenantIsolation } from '@/lib/db/tenant-context'

export async function GET() {
  let database: 'ok' | 'error' = 'ok'
  let tenantIsolation: string = 'unknown'
  try {
    tenantIsolation = await checkTenantIsolation()
  } catch {
    database = 'error'
  }
  return NextResponse.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    tenantIsolation,
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.7',
  }, { status: database === 'ok' ? 200 : 503 })
}

export const dynamic = 'force-dynamic'

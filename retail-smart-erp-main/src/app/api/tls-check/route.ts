import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'

/**
 * GET /api/tls-check?domain=<host>
 *
 * Used by Caddy "on-demand TLS" (deploy/digitalocean/Caddyfile) before it requests a
 * certificate for a hostname: 200 = issue a certificate, anything else = refuse. Without this
 * check anyone could point arbitrary hostnames at the server and exhaust certificate limits.
 *
 * Allowed: the base, app and landing domains, and `<slug>.<base>` for an existing vendor.
 */
// Same reserved list as src/proxy.ts (never vendor subdomains)
const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'test', 'staging', 'dev',
  'mail', 'email', 'blog', 'support', 'help', 'status',
  'dashboard', 'account', 'login', 'register', 'billing',
])

function clean(host: string) {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

export async function GET(request: NextRequest) {
  const domain = clean(request.nextUrl.searchParams.get('domain') || '')
  if (!domain || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain)) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const base = clean(process.env.NEXT_PUBLIC_BASE_DOMAIN || '')
  const fixed = [
    base,
    process.env.NEXT_PUBLIC_APP_DOMAIN,
    process.env.NEXT_PUBLIC_LANDING_DOMAIN,
    'skyerpos.com',
    'www.skyerpos.com',
    'app.skyerpos.com',
  ].filter(Boolean).map((d) => clean(String(d)))
  if (fixed.includes(domain)) return NextResponse.json({ ok: true })

  let sub = ''
  if (base && domain.endsWith(`.${base}`)) {
    sub = domain.slice(0, -(base.length + 1))
  } else if (domain.endsWith('.skyerpos.com')) {
    sub = domain.slice(0, -('.skyerpos.com'.length))
  }

  if (!sub || sub.includes('.') || RESERVED.has(sub)) return NextResponse.json({ ok: false }, { status: 404 })
  try {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.slug, sub), columns: { id: true, status: true } })
    return tenant ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 404 })
  } catch (error) {
    logError('api/tls-check', error)
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const THEME_COLORS: Record<string, string> = {
  retail: '#1e3a8a',
  restaurant: '#7c2d12',
  supermarket: '#064e3b',
  auto_service: '#1e293b',
}

/**
 * Dynamic per-tenant Web App Manifest.
 * Returns manifest JSON with the company name, logo, and business-type theme color.
 * Enables PWA install on tenant subdomains.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.slug, slug), eq(tenants.status, 'active')),
    columns: { name: true, logoUrl: true, businessType: true },
  })

  if (!tenant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Detect subdomain vs path-based routing
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  const isSubdomain = host.toLowerCase().startsWith(`${slug}.`)

  const startUrl = isSubdomain ? '/dashboard' : `/c/${slug}/dashboard`
  const scope = isSubdomain ? '/' : `/c/${slug}/`

  const icons = []
  if (tenant.logoUrl) {
    icons.push(
      { src: tenant.logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: tenant.logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' },
    )
  }

  const shortName = tenant.name.length > 12 ? tenant.name.slice(0, 12).trim() : tenant.name

  const manifest = {
    name: tenant.name,
    short_name: shortName,
    description: `${tenant.name} - Business Portal`,
    start_url: startUrl,
    scope,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: THEME_COLORS[tenant.businessType] || '#1e3a8a',
    icons,
  }

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

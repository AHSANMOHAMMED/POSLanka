import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { getFromR2, keyFromUrl } from '@/lib/files'
import { rasterizeLogo, type LogoRaster } from '@/lib/print/logo-raster'

/**
 * GET /api/settings/logo/raster?width=384|576&pct=60
 *
 * Returns the tenant logo as a 1-bit ESC/POS raster (GS v 0 layout, rows packed
 * MSB-first, black = 1) centered on the paper width, plus a grayscale PNG
 * (`pngBase64`) for HTML receipts:
 *   { width, height, data: base64, pngBase64, logoWidth }
 * 404 when the tenant has no logo. Works with cookie or mobile Bearer auth.
 */

const cache = new Map<string, { at: number; value: LogoRaster }>()
const CACHE_TTL = 60 * 60_000
const CACHE_MAX = 200

async function loadLogoBytes(logoUrl: string): Promise<Buffer | null> {
  const key = keyFromUrl(logoUrl)
  if (key) {
    const obj = await getFromR2(key)
    if (obj) return obj.buffer
  }
  // Fallback: the stored URL is an absolute http(s) URL (set only by our own upload route).
  if (/^https?:\/\//i.test(logoUrl)) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(logoUrl, { signal: ctrl.signal })
      if (!res.ok) return null
      const ab = await res.arrayBuffer()
      if (ab.byteLength > 5 * 1024 * 1024) return null
      return Buffer.from(ab)
    } finally {
      clearTimeout(t)
    }
  }
  return null
}

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sp = request.nextUrl.searchParams
    const width = Number(sp.get('width') || 576)
    if (width !== 384 && width !== 576) {
      return NextResponse.json({ error: 'width must be 384 or 576' }, { status: 400 })
    }
    const pctRaw = Number(sp.get('pct') || 60)
    if (!Number.isFinite(pctRaw) || pctRaw < 10 || pctRaw > 100) {
      return NextResponse.json({ error: 'pct must be between 10 and 100' }, { status: 400 })
    }
    const pct = Math.round(pctRaw)

    const tenant = await withTenant(session.user.tenantId, async (db) =>
      db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
        columns: { logoUrl: true },
      })
    )
    if (!tenant?.logoUrl) {
      return NextResponse.json({ error: 'No logo' }, { status: 404 })
    }

    const cacheKey = `${session.user.tenantId}|${tenant.logoUrl}|${width}|${pct}`
    const hit = cache.get(cacheKey)
    let value: LogoRaster
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      value = hit.value
    } else {
      const bytes = await loadLogoBytes(tenant.logoUrl)
      if (!bytes) {
        return NextResponse.json({ error: 'Logo file not found' }, { status: 404 })
      }
      value = await rasterizeLogo(bytes, { paperDots: width, pct })
      if (cache.size >= CACHE_MAX) {
        const first = cache.keys().next().value
        if (first) cache.delete(first)
      }
      cache.set(cacheKey, { at: Date.now(), value })
    }

    return NextResponse.json(value, {
      headers: { 'Cache-Control': 'private, max-age=3600' },
    })
  } catch (error) {
    logError('api/settings/logo/raster', error)
    return NextResponse.json({ error: 'Failed to rasterize logo' }, { status: 500 })
  }
}

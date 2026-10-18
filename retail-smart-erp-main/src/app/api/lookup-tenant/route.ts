import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, tenants, accounts, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { lookupTenantSchema } from '@/lib/validation/schemas/auth'

// Rate limiting map: email -> { count, firstRequest }
const rateLimitMap = new Map<string, { count: number; firstRequest: number }>()
const slugRateLimitMap = new Map<string, { count: number; firstRequest: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 5 // Max 5 requests per minute per email
let lookupLastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

function cleanupExpiredEntries() {
  const now = Date.now()
  if (now - lookupLastCleanup > CLEANUP_INTERVAL) {
    lookupLastCleanup = now
    for (const [key, entry] of rateLimitMap) {
      if (now - entry.firstRequest > RATE_LIMIT_WINDOW) rateLimitMap.delete(key)
    }
    for (const [key, entry] of slugRateLimitMap) {
      if (now - entry.firstRequest > RATE_LIMIT_WINDOW) slugRateLimitMap.delete(key)
    }
  }
}

// GET lookup tenant by slug (internal use for middleware)
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const MIN_RESPONSE_TIME = 100 // Minimum response time in ms

  try {
    const slug = request.nextUrl.searchParams.get('slug')
    
    if (!slug) {
      return NextResponse.json({ error: 'Slug required' }, { status: 400 })
    }

    // Verify internal request using shared secret
    const internalSecret = request.headers.get('x-internal-secret')
    if (internalSecret !== process.env.NEXTAUTH_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Periodically clean expired entries to prevent memory leaks
    cleanupExpiredEntries()

    // Rate limiting by slug
    const now = Date.now()
    const rateLimit = slugRateLimitMap.get(slug)
    if (rateLimit) {
      if (now - rateLimit.firstRequest < RATE_LIMIT_WINDOW) {
        if (rateLimit.count >= RATE_LIMIT_MAX) {
          const elapsed = Date.now() - startTime
          if (elapsed < MIN_RESPONSE_TIME) {
            await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
          }
          return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
        }
        rateLimit.count++
      } else {
        slugRateLimitMap.set(slug, { count: 1, firstRequest: now })
      }
    } else {
      slugRateLimitMap.set(slug, { count: 1, firstRequest: now })
    }

    // Query tenant by slug
    const tenant = await db.query.tenants.findFirst({
      where: and(
        eq(tenants.slug, slug),
        eq(tenants.status, 'active')
      ),
      columns: { id: true, slug: true, name: true }
    })

    // Ensure minimum response time
    const elapsed = Date.now() - startTime
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
    }

    if (tenant) {
      return NextResponse.json({ tenant: { id: tenant.id, slug: tenant.slug } })
    } else {
      return NextResponse.json({ tenant: null })
    }
  } catch (error) {
    logError('api/lookup-tenant/slug', error)
    const elapsed = Date.now() - startTime
    if (elapsed < 100) {
      await new Promise(resolve => setTimeout(resolve, 100 - elapsed))
    }
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}

// POST lookup tenants by email (no auth required - public endpoint)
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  const MIN_RESPONSE_TIME = 200 // Minimum response time in ms to prevent timing attacks

  try {
    const parsed = await validateBody(request, lookupTenantSchema)
    if (!parsed.success) return parsed.response
    const { email: normalizedEmail } = parsed.data

    // Periodically clean expired entries to prevent memory leaks
    cleanupExpiredEntries()

    // Rate limiting check
    const now = Date.now()
    const rateLimit = rateLimitMap.get(normalizedEmail)
    if (rateLimit) {
      if (now - rateLimit.firstRequest < RATE_LIMIT_WINDOW) {
        if (rateLimit.count >= RATE_LIMIT_MAX) {
          // Wait minimum time before responding to prevent timing attacks
          const elapsed = Date.now() - startTime
          if (elapsed < MIN_RESPONSE_TIME) {
            await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
          }
          return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
        }
        rateLimit.count++
      } else {
        // Reset window
        rateLimitMap.set(normalizedEmail, { count: 1, firstRequest: now })
      }
    } else {
      rateLimitMap.set(normalizedEmail, { count: 1, firstRequest: now })
    }

    const tenantsFound: Map<string, { slug: string; name: string }> = new Map()

    // First, check if user has an account (new multi-company flow)
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.email, normalizedEmail),
    })

    if (account) {
      // Get all tenants from accountTenants
      const memberships = await db
        .select({
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
        })
        .from(accountTenants)
        .innerJoin(tenants, eq(accountTenants.tenantId, tenants.id))
        .where(
          and(
            eq(accountTenants.accountId, account.id),
            eq(accountTenants.isActive, true),
            eq(tenants.status, 'active')
          )
        )

      for (const m of memberships) {
        tenantsFound.set(m.tenantSlug, { slug: m.tenantSlug, name: m.tenantName })
      }
    }

    // Also check legacy users table (for users not yet migrated)
    const userResults = await db
      .select({
        tenantSlug: tenants.slug,
        tenantName: tenants.name,
      })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(
        and(
          eq(users.email, normalizedEmail),
          eq(users.isActive, true),
          eq(tenants.status, 'active')
        )
      )

    for (const u of userResults) {
      // Only add if not already found from accountTenants
      if (!tenantsFound.has(u.tenantSlug)) {
        tenantsFound.set(u.tenantSlug, { slug: u.tenantSlug, name: u.tenantName })
      }
    }

    // Ensure minimum response time to prevent timing attacks
    // This makes it impossible to determine if an email exists based on response time
    const elapsed = Date.now() - startTime
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
    }

    return NextResponse.json({
      tenants: Array.from(tenantsFound.values()),
    })
  } catch (error) {
    logError('api/lookup-tenant', error)
    // Ensure consistent response time even on errors
    const elapsed = Date.now() - startTime
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
    }
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, tenants, accounts, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { lookupTenantSchema } from '@/lib/validation/schemas/auth'
import { normalizeBusinessId } from '@/lib/tenant/business-id'
import { consumeRateLimit, clientIp } from '@/lib/auth/rate-limit'

const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 5 // Max 5 requests per minute per slug (internal GET)

// Public POST lookups are limited in the database so every app instance shares the counters.
const EMAIL_LOOKUP_LIMIT = { maxAttempts: 5, windowMs: RATE_LIMIT_WINDOW, category: 'lookup_email' }
// Business ID / company-slug lookups from the sign-in page: per client IP and per identifier
const IDENTIFIER_IP_LIMIT = { maxAttempts: 10, windowMs: RATE_LIMIT_WINDOW, category: 'lookup_identifier_ip' }
const IDENTIFIER_LIMIT = { maxAttempts: 5, windowMs: RATE_LIMIT_WINDOW, category: 'lookup_identifier' }

// The GET variant is only reachable with the internal secret (src/lib/edge-db.ts, cached 5 min),
// so a per-process counter is sufficient there and avoids a DB write per tenant-host request.
const slugRateLimitMap = new Map<string, { count: number; firstRequest: number }>()
let lookupLastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

function cleanupExpiredEntries() {
  const now = Date.now()
  if (now - lookupLastCleanup > CLEANUP_INTERVAL) {
    lookupLastCleanup = now
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

async function padResponse(startTime: number, min: number) {
  const elapsed = Date.now() - startTime
  if (elapsed < min) await new Promise((resolve) => setTimeout(resolve, min - elapsed))
}

const identifierSchema = z.object({
  identifier: z.string().trim().min(2, 'Enter your Business ID').max(100),
})

/**
 * Resolve a sign-in identifier — Business ID (PL123456, any case/spacing/dash) or company slug —
 * to the minimum the sign-in page needs: name, slug and logo. Active companies only.
 */
async function lookupByIdentifier(request: NextRequest, raw: string, startTime: number) {
  const MIN_RESPONSE_TIME = 200
  const ip = clientIp(request)
  const businessId = normalizeBusinessId(raw)
  const slug = businessId ? null : raw.toLowerCase()
  if (!businessId && !/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(slug!)) {
    await padResponse(startTime, MIN_RESPONSE_TIME)
    return NextResponse.json({ tenant: null })
  }

  const [ipLimit, idLimit] = await Promise.all([
    consumeRateLimit(ip, IDENTIFIER_IP_LIMIT),
    consumeRateLimit(businessId ?? slug!, IDENTIFIER_LIMIT),
  ])
  if (ipLimit.limited || idLimit.limited) {
    await padResponse(startTime, MIN_RESPONSE_TIME)
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  const tenant = await db.query.tenants.findFirst({
    where: and(businessId ? eq(tenants.businessId, businessId) : eq(tenants.slug, slug!), eq(tenants.status, 'active')),
    columns: { slug: true, name: true, logoUrl: true },
  })

  await padResponse(startTime, MIN_RESPONSE_TIME)
  return NextResponse.json({
    tenant: tenant ? { slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl || null } : null,
  })
}

// POST lookup (no auth required - public endpoint):
//  - { identifier } → company for a Business ID / slug (staff sign-in)
//  - { email }      → companies this email belongs to
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  const MIN_RESPONSE_TIME = 200 // Minimum response time in ms to prevent timing attacks

  try {
    const parsed = await validateBody(request, z.union([identifierSchema, lookupTenantSchema]))
    if (!parsed.success) return parsed.response
    if ('identifier' in parsed.data) {
      return await lookupByIdentifier(request, parsed.data.identifier, startTime)
    }
    const { email: normalizedEmail } = parsed.data

    // Rate limiting check (per email, shared by all instances)
    if ((await consumeRateLimit(normalizedEmail, EMAIL_LOOKUP_LIMIT)).limited) {
      // Wait minimum time before responding to prevent timing attacks
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
      }
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
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
// Next.js 16 "proxy" convention (formerly src/middleware.ts). Proxy always runs
// on the Node.js runtime; no route segment config (e.g. `runtime`) is allowed here.
// Behaviour is identical to the old middleware: host validation, CORS for
// cross-subdomain RSC, sensitive-param stripping, and subdomain → /c/[slug] rewrites.
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { edgeDb } from '@/lib/edge-db'
import { isTrustedOrigin } from '@/lib/security/origin'
import { FEATURE_FLAG_LABELS, featureForApiPath, type FeatureFlag } from '@/lib/features/flags'

// Domain configuration from environment
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'retailsmarterp.com'
const LANDING_DOMAIN = process.env.NEXT_PUBLIC_LANDING_DOMAIN || 'www.retailsmarterp.com'
const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'app.retailsmarterp.com'

// Sensitive parameters that should never appear in URLs
const SENSITIVE_PARAMS = ['password', 'pwd', 'pass', 'secret', 'token', 'apikey', 'api_key']

// Routes where we should be extra careful about sensitive data in URLs
const AUTH_ROUTES = ['/login', '/register', '/reset-password', '/forgot-password']

// Reserved subdomains (cannot be used for tenants)
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'test', 'staging', 'dev',
  'mail', 'email', 'blog', 'support', 'help', 'status',
  'dashboard', 'account', 'login', 'register', 'billing'
])

/** Check if an origin URL belongs to one of our subdomains */
function isOurOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.split(':')[0].toLowerCase()
    const base = BASE_DOMAIN.split(':')[0].toLowerCase()
    return (
      host === base ||
      host.endsWith(`.${base}`) ||
      host === 'skyerpos.com' ||
      host.endsWith('.skyerpos.com') ||
      host === 'poslanka.lk' ||
      host.endsWith('.poslanka.lk') ||
      host.endsWith('.ondigitalocean.app') ||
      host.endsWith('.up.railway.app') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    )
  } catch {
    return false
  }
}

/** Add CORS headers for cross-subdomain page requests (RSC, prefetch) */
function addSubdomainCors(response: NextResponse, origin: string): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  response.headers.set('Access-Control-Allow-Headers', 'RSC, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Router-State-Tree, Next-Url, Content-Type')
  response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  return response
}

// ==================== API: request id + CSRF ====================
// Cookies that carry an authenticated session (company, account, platform admin).
const SESSION_COOKIES = ['company-session', 'account-session', 'admin_session']
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Routes called by other servers or by non-browser clients that authenticate without cookies.
const CSRF_EXEMPT_PREFIXES = [
  '/api/payhere/notify',   // PayHere server-to-server notification (signed md5sig)
  '/api/webxpay/webhook',  // WebXPay server-to-server notification (signed)
  '/api/cron/',            // GitHub Actions scheduler (Bearer CRON_SECRET)
  '/api/v1/',              // public API (API keys)
  '/api/client-errors',    // error beacon; rate limited, writes only error reports
]

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) =>
    SESSION_COOKIES.some((c) => name === c || name === `__Secure-${c}` || name.startsWith(`${c}.`) || name.startsWith(`__Secure-${c}.`)))
}

/**
 * CSRF defence for cookie-authenticated API writes (SameSite=lax alone does not cover
 * same-site subdomains or older browsers): a state-changing request that carries a session
 * cookie must come from one of our origins. Browsers always attach Origin to cross-origin
 * POST/PUT/PATCH/DELETE; when it is absent we fall back to Referer, and when both are absent the
 * caller is not a browser (mobile app, curl, server) and cannot be a CSRF vector.
 * Returns a reason string when the request must be rejected.
 */
export function csrfViolation(request: NextRequest): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null
  const { pathname } = request.nextUrl
  if (CSRF_EXEMPT_PREFIXES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)))) return null
  if (!hasSessionCookie(request)) return null // Bearer / API-key / anonymous: nothing ambient to forge
  const publicHosts = [request.headers.get('x-forwarded-host'), request.headers.get('host'), request.nextUrl.host]
  const trusted = (value: string) => publicHosts.some((h) => isTrustedOrigin(value, h)) || isTrustedOrigin(value)
  const origin = request.headers.get('origin')
  if (origin) {
    if (origin === 'null' || !trusted(origin)) return `untrusted origin ${origin}`
    return null
  }
  const referer = request.headers.get('referer')
  if (referer && !trusted(referer)) return 'untrusted referer'
  return null
}

/**
 * Feature switches (super admin → vendor → Features): requests to a switched-off feature's API get
 * 403 FEATURE_DISABLED. The answer comes from /api/features/check (it resolves the session or app
 * token) and is cached per caller + switch for a few seconds.
 */
const FEATURE_CACHE_TTL_MS = 10_000
const featureCache = new Map<string, { enabled: boolean; at: number }>()

async function featureDisabled(request: NextRequest): Promise<FeatureFlag | null> {
  const flag = featureForApiPath(request.nextUrl.pathname)
  if (!flag) return null
  const authorization = request.headers.get('authorization') || ''
  const cookie = request.headers.get('cookie') || ''
  if (!authorization && !cookie) return null // the route answers 401
  const key = `${flag}|${authorization}|${cookie}`
  const hit = featureCache.get(key)
  if (hit && Date.now() - hit.at < FEATURE_CACHE_TTL_MS) return hit.enabled ? null : flag
  try {
    const base = process.env.NEXTAUTH_URL_INTERNAL || `http://127.0.0.1:${process.env.PORT || 3000}`
    const res = await fetch(`${base}/api/features/check?flag=${flag}`, {
      headers: { ...(authorization ? { authorization } : {}), ...(cookie ? { cookie } : {}), 'x-internal-feature-check': '1' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { enabled?: boolean }
    if (featureCache.size > 5000) featureCache.clear()
    featureCache.set(key, { enabled: body.enabled !== false, at: Date.now() })
    return body.enabled === false ? flag : null
  } catch {
    return null // fail open: the switch is a product limit, not a security boundary
  }
}

async function handleApi(request: NextRequest): Promise<NextResponse> {
  const incoming = request.headers.get('x-request-id')
  const requestId = incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID()
  const violation = csrfViolation(request)
  if (violation) {
    console.warn(JSON.stringify({ level: 'warn', component: 'csrf', msg: 'blocked cross-site API request', requestId, method: request.method, path: request.nextUrl.pathname, reason: violation }))
    const res = NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  const disabled = await featureDisabled(request)
  if (disabled) {
    const res = NextResponse.json(
      { error: `${FEATURE_FLAG_LABELS[disabled]} is turned off for this business. Contact skyERPOS support to turn it on.`, code: 'FEATURE_DISABLED', feature: disabled },
      { status: 403 },
    )
    res.headers.set('x-request-id', requestId)
    return res
  }
  const headers = new Headers(request.headers)
  headers.set('x-request-id', requestId)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('x-request-id', requestId)
  return res
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams, hostname } = request.nextUrl

  // API routes: only request id + CSRF; no host routing / tenant rewrites (unchanged behaviour)
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return handleApi(request)
  }
  
  // Get the actual host from headers (respecting x-forwarded-host and Host header)
  // Try multiple headers in order of preference:
  // 1. x-forwarded-host (standard proxy header)
  // 2. host (direct Host header from request)
  // 3. x-original-host (some proxies use this)
  // 4. Fallback to request.nextUrl.hostname
  const forwardedHost = request.headers.get('x-forwarded-host')
  const hostHeader = request.headers.get('host')
  const originalHostHeader = request.headers.get('x-original-host')
  
  const candidateHost = forwardedHost || hostHeader || originalHostHeader || hostname

  // ==================== SECURITY: Host Header Validation ====================
  // Validate the candidate host against allowed patterns to prevent host header
  // injection attacks. Untrusted x-forwarded-host / x-original-host headers
  // could otherwise manipulate subdomain routing.
  const allowedHostsEnv = process.env.ALLOWED_HOSTS
  const isAllowedHost = (host: string): boolean => {
    const clean = host.split(':')[0].toLowerCase()

    // Always allow localhost (development) & local loopbacks
    if (clean === 'localhost' || clean === '127.0.0.1' || clean === '0.0.0.0') return true

    // Allow raw IPv4 address access (e.g. droplet direct testing)
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) return true

    // Allow Railway deployment URLs
    if (clean === 'retail-smart-pos-web-production.up.railway.app' || clean.endsWith('.up.railway.app')) return true

    // Allow DigitalOcean App Platform domains
    if (clean.endsWith('.ondigitalocean.app')) return true

    // Allow skyERPOS official domains
    if (clean === 'skyerpos.com' || clean.endsWith('.skyerpos.com')) return true
    if (clean === 'poslanka.lk' || clean.endsWith('.poslanka.lk')) return true
    if (clean.endsWith('.sslip.io') || clean.endsWith('.nip.io')) return true

    // Allow the configured base domain and any subdomain of it
    const base = BASE_DOMAIN.toLowerCase()
    if (clean === base || clean.endsWith(`.${base}`)) return true

    // Allow explicitly listed hosts from ALLOWED_HOSTS env var
    if (allowedHostsEnv) {
      const allowedList = allowedHostsEnv.split(',').map(h => h.trim().toLowerCase())
      if (allowedList.includes(clean)) return true
    }

    return false
  }

  // If the host is not in the allow-list, fall back to the trusted
  // request.nextUrl.hostname which is derived from the actual request URL
  const originalHost = isAllowedHost(candidateHost) ? candidateHost : hostname

  // Normalize hostname by removing port for consistent comparisons
  const normalizedHostname = originalHost.split(':')[0].toLowerCase()
  
  // Debug logging (only when DEBUG_MIDDLEWARE env var is set)
  if (process.env.DEBUG_MIDDLEWARE) {
    console.log(`[Proxy] ${normalizedHostname} ${pathname}`)
  }

  // ==================== CORS: Cross-subdomain preflight ====================
  const requestOrigin = request.headers.get('origin')
  if (request.method === 'OPTIONS' && requestOrigin && isOurOrigin(requestOrigin)) {
    return addSubdomainCors(new NextResponse(null, { status: 204 }), requestOrigin)
  }

  // ==================== SECURITY: Sensitive Params ====================
  const isAuthRoute = AUTH_ROUTES.some(route => pathname.startsWith(route))

  if (isAuthRoute) {
    const sensitiveParamsFound: string[] = []

    // Convert URLSearchParams entries to array to avoid iteration issues
    const paramsArray = Array.from(searchParams.entries())
    for (const [key] of paramsArray) {
      const lowerKey = key.toLowerCase()
      if (SENSITIVE_PARAMS.some(sensitive => lowerKey.includes(sensitive))) {
        sensitiveParamsFound.push(key)
      }
      if (pathname === '/login' && (lowerKey === 'email' || lowerKey === 'user' || lowerKey === 'username')) {
        sensitiveParamsFound.push(key)
      }
    }

    if (sensitiveParamsFound.length > 0) {
      const cleanUrl = request.nextUrl.clone()
      sensitiveParamsFound.forEach(param => cleanUrl.searchParams.delete(param))

      console.warn(
        `[SECURITY] Stripped sensitive params from URL: ${pathname}`,
        `Params removed: ${sensitiveParamsFound.join(', ')}`,
        `IP: ${request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'}`
      )

      return NextResponse.redirect(cleanUrl, 302)
    }
  }

  // ==================== SUBDOMAIN ROUTING ====================
  // Use BASE_DOMAIN env var directly (don't rely solely on NODE_ENV)
  const isRealDomain = BASE_DOMAIN && BASE_DOMAIN !== 'localhost'
  const baseDomain = (isRealDomain ? BASE_DOMAIN : 'localhost').toLowerCase()

  // Extract subdomain from hostname
  const extractSubdomain = (host: string): string | null => {
    const cleanHost = host.split(':')[0].toLowerCase() // Remove port and normalize case

    const candidateBases = Array.from(new Set([baseDomain, 'skyerpos.com', 'poslanka.lk', 'retailsmarterp.com'])).filter(
      b => b && b !== 'localhost'
    )

    for (const b of candidateBases) {
      if (cleanHost === b) return null // Root domain
      if (cleanHost.endsWith(`.${b}`)) {
        const subdomain = cleanHost.replace(`.${b}`, '')
        if (subdomain && !RESERVED_SUBDOMAINS.has(subdomain)) {
          return subdomain
        }
      }
    }
    return null
  }

  const subdomain = extractSubdomain(normalizedHostname)

  // Determine protocol for redirects (https for real domains, http locally)
  const protocol = isRealDomain ? 'https' : 'http'

  // ==================== ROUTING LOGIC ====================

  // 1. LANDING DOMAIN (Landing Page Only)
  const isLandingDomain = normalizedHostname === LANDING_DOMAIN.toLowerCase()
  const isBaseDomain = normalizedHostname === BASE_DOMAIN.toLowerCase()
  
  if (isLandingDomain || (isRealDomain && isBaseDomain)) {
    // In production, redirect root domain to landing domain
    if (isRealDomain && isBaseDomain) {
      return NextResponse.redirect(`${protocol}://${LANDING_DOMAIN}${pathname}`)
    }

    // The site root opens the sign-in page on the app domain
    if (pathname === '/') {
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/login`)
    }

    // Block access to app/tenant routes
    const blockedPaths = ['/c/', '/account', '/login', '/register', '/dashboard', '/pos']
    if (blockedPaths.some(blocked => pathname.startsWith(blocked))) {
      // Redirect to app domain for these paths
      const redirect = NextResponse.redirect(`${protocol}://${APP_DOMAIN}${pathname}`)
      // Add CORS headers so RSC/prefetch cross-subdomain redirects succeed
      if (requestOrigin && isOurOrigin(requestOrigin)) {
        addSubdomainCors(redirect, requestOrigin)
      }
      return redirect
    }

    // Allow landing page content
    const landingResponse = NextResponse.next()
    if (requestOrigin && isOurOrigin(requestOrigin)) {
      addSubdomainCors(landingResponse, requestOrigin)
    }
    return landingResponse
  }

  // 2. APP DOMAIN (Account Management)
  if (normalizedHostname === APP_DOMAIN.toLowerCase()) {
    // Root path: the sign-in page (it forwards signed-in owners to /account)
    if (pathname === '/') {
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/login`)
    }

    // Allowed paths for app domain
    const allowedPaths = [
      '/account', '/login', '/register', '/reset-password', '/forgot-password',
      '/verify-email', '/setup', '/billing', '/plans', '/team', '/settings',
      '/v', // public receipt verification (receipt QR)
    ]

    const isAllowed = allowedPaths.some(allowed =>
      pathname === allowed || pathname.startsWith(`${allowed}/`)
    )

    if (!isAllowed) {
      // Check if it's a tenant workspace request
      if (pathname.startsWith('/c/')) {
        const slugMatch = pathname.match(/^\/c\/([^/]+)/)
        if (slugMatch) {
          const slug = slugMatch[1]
          // Validate slug format before redirecting (prevent open redirect)
          const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
          if (slugRegex.test(slug)) {
            // Redirect to tenant subdomain
            return NextResponse.redirect(`${protocol}://${slug}.${BASE_DOMAIN}${pathname.replace(`/c/${slug}`, '') || '/'}`)
          }
        }
      }

      // Redirect to landing page for unknown paths
      const landingRedirect = NextResponse.redirect(`${protocol}://${LANDING_DOMAIN}${pathname}`)
      if (requestOrigin && isOurOrigin(requestOrigin)) {
        addSubdomainCors(landingRedirect, requestOrigin)
      }
      return landingRedirect
    }

    // Add CORS headers for cross-subdomain RSC requests (e.g. www → app)
    const appResponse = NextResponse.next()
    if (requestOrigin && isOurOrigin(requestOrigin)) {
      addSubdomainCors(appResponse, requestOrigin)
    }
    return appResponse
  }

  // 3. TENANT SUBDOMAIN ([slug].domain.com)
  if (subdomain) {
    // Paths that should only live on the app domain (not on tenant subdomains)
    const appOnlyPaths = ['/register', '/account']
    if (appOnlyPaths.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}${pathname}`)
    }

    // Validate subdomain format
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // lowercase, numbers, hyphens
    if (!slugRegex.test(subdomain)) {
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/error?code=invalid-subdomain`)
    }

    try {
      const tenant = await edgeDb.getTenantBySlug(subdomain)

      if (tenant) {
        // Strip /c/slug prefix if already present (prevents double-nesting)
        let targetPath = pathname
        if (pathname.startsWith(`/c/${tenant.slug}`)) {
          targetPath = pathname.slice(`/c/${tenant.slug}`.length) || '/'

          // For full document requests (not RSC/prefetch), redirect to clean URL
          // so the browser shows /dashboard instead of /c/slug/dashboard
          const isRSC = request.headers.get('RSC') === '1'
          const isPrefetch = request.headers.get('Next-Router-Prefetch') === '1'
          const hasRouterState = request.headers.has('Next-Router-State-Tree')

          if (!isRSC && !isPrefetch && !hasRouterState) {
            const cleanUrl = new URL(targetPath, request.url)
            cleanUrl.search = request.nextUrl.search
            return NextResponse.redirect(cleanUrl, 302)
          }
        }

        // Rewrite to internal /c/[slug] path
        const newPath = `/c/${tenant.slug}${targetPath}`
        const response = NextResponse.rewrite(new URL(newPath, request.url))

        // Only set non-sensitive headers on response (tenant-id is internal, not exposed)
        response.headers.set('x-pathname', newPath)

        return response
      } else {
        // Tenant not found - send to sign-in (businesses are created by skyERPOS, no self sign-up)
        return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/`)
      }
    } catch (error) {
      // Database/network error - fail gracefully
      console.error('Tenant lookup failed:', error)
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/error?code=tenant-lookup-failed`)
    }
  }

  // 4. PLATFORM URLS / DIGITALOCEAN / LOCALHOST / DIRECT IP
  const isRailwayUrl = normalizedHostname.includes('.railway.app')
  const isDigitalOceanApp = normalizedHostname.endsWith('.ondigitalocean.app')
  const isLocalhostOrIp =
    normalizedHostname === 'localhost' ||
    normalizedHostname.startsWith('localhost:') ||
    normalizedHostname === '127.0.0.1' ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname)

  if (isRailwayUrl) {
    // In production with custom domain, redirect Railway URL to the main app domain
    if (isRealDomain && !normalizedHostname.includes(baseDomain)) {
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}${pathname}`, 301)
    }

    // Maintain backward compatibility for /c/[slug] routes
    if (pathname.startsWith('/c/')) {
      const slugMatch = pathname.match(/^\/c\/([^/]+)/)
      if (slugMatch) {
        const response = NextResponse.next()
        response.headers.set('x-pathname', pathname)
        response.headers.set('x-tenant-slug', slugMatch[1])
        return response
      }
    }

    return NextResponse.next()
  }

  if (isDigitalOceanApp || isLocalhostOrIp) {
    if (pathname.startsWith('/c/')) {
      const slugMatch = pathname.match(/^\/c\/([^/]+)/)
      if (slugMatch) {
        const response = NextResponse.next()
        response.headers.set('x-pathname', pathname)
        response.headers.set('x-tenant-slug', slugMatch[1])
        return response
      }
    }

    // Allow sys-control, auth, and general routes on IP / dev / direct container platform hosts
    if (
      pathname.startsWith('/sys-control') ||
      pathname.startsWith('/login') ||
      pathname.startsWith('/register') ||
      pathname.startsWith('/account') ||
      pathname === '/'
    ) {
      return NextResponse.next()
    }

    return NextResponse.next()
  }

  // 5. UNKNOWN DOMAIN (Fallback)
  return NextResponse.redirect(`${protocol}://${LANDING_DOMAIN}`)
}

export const config = {
  matcher: [
    // API routes: request id + CSRF origin check only (see handleApi)
    '/api/:path*',
    // Match all paths except static files, API routes, SSE endpoint, etc.
    '/((?!api|ws|_events|_internal|_next/static|_next/image|favicon.ico|uploads|images|public|icons|sw\\.js|manifest\\.webmanifest).*)',
  ],
}
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { edgeDb } from '@/lib/edge-db'

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
    return host === base || host.endsWith(`.${base}`)
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

export async function middleware(request: NextRequest) {
  const { pathname, searchParams, hostname } = request.nextUrl
  
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

    // Always allow localhost (development)
    if (clean === 'localhost' || clean === '127.0.0.1') return true

    // Allow only our specific Railway deployment URLs
    if (clean === 'retail-smart-pos-web-production.up.railway.app' || clean.endsWith('.up.railway.app')) return true

    // Allow the base domain and any subdomain of it
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
    console.log(`[Middleware] ${normalizedHostname} ${pathname}`)
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

    // Check if it's our domain
    if (cleanHost === baseDomain) return null // Root domain
    if (cleanHost.endsWith(`.${baseDomain}`)) {
      const subdomain = cleanHost.replace(`.${baseDomain}`, '')
      if (subdomain && !RESERVED_SUBDOMAINS.has(subdomain)) {
        return subdomain
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
    // Root path: redirect to account dashboard (account layout handles auth → /login if needed)
    if (pathname === '/') {
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/account`)
    }

    // Allowed paths for app domain
    const allowedPaths = [
      '/account', '/login', '/register', '/reset-password', '/forgot-password',
      '/verify-email', '/setup', '/billing', '/plans', '/team', '/settings'
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
        // Tenant not found - redirect to signup
        return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/register?subdomain=${subdomain}`)
      }
    } catch (error) {
      // Database/network error - fail gracefully
      console.error('Tenant lookup failed:', error)
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}/error?code=tenant-lookup-failed`)
    }
  }

  // 4. RAILWAY URL / LOCALHOST (Development)
  const isRailwayUrl = normalizedHostname.includes('.railway.app')
  const isLocalhost = normalizedHostname === 'localhost' || normalizedHostname.startsWith('localhost:')

  if (isRailwayUrl) {
    // In production, redirect Railway URL to the main app domain
    if (isRealDomain) {
      return NextResponse.redirect(`${protocol}://${APP_DOMAIN}${pathname}`, 301)
    }

    // Dev: maintain backward compatibility for /c/[slug] routes
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

  if (isLocalhost) {
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

  // 5. UNKNOWN DOMAIN (Fallback)
  return NextResponse.redirect(`${protocol}://${LANDING_DOMAIN}`)
}

export const config = {
  matcher: [
    // Match all paths except static files, API routes, SSE endpoint, etc.
    '/((?!api|ws|_events|_internal|_next/static|_next/image|favicon.ico|uploads|images|public|icons|sw\\.js|manifest\\.webmanifest).*)',
  ],
}
'use client'

import { useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'

const BASE_DOMAIN = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'retailsmarterp.com').toLowerCase()

/**
 * Strips the redundant `/c/{slug}` prefix from the browser URL when on a subdomain.
 *
 * On subdomain (e.g., `tenant.retailsmarterp.com`), the middleware rewrites
 * requests internally to `/c/[slug]/...`, but client-side navigation
 * (router.push, Link href) uses explicit `/c/${slug}/...` paths.
 * This component cleans the browser URL via `history.replaceState` so
 * the user sees `/dashboard` instead of `/c/tenant/dashboard`.
 *
 * Safe because `usePathname()` returns the router's internal path (unaffected
 * by replaceState), so active links, module detection, etc. all still work.
 */
export function SubdomainUrlCleaner() {
  // Subscribe to route changes — triggers re-render on each client-side navigation
  const routerPathname = usePathname()

  useLayoutEffect(() => {
    const hostname = window.location.hostname.toLowerCase()

    // Only act on subdomains of our base domain
    if (!hostname.endsWith(`.${BASE_DOMAIN}`)) return

    // Extract subdomain
    const subdomain = hostname.slice(0, -(BASE_DOMAIN.length + 1))
    if (!subdomain) return

    // Verify the router path matches this subdomain's tenant
    // (prevents cleaning when CompanySwitcher navigates to a different tenant)
    if (!routerPathname.startsWith(`/c/${subdomain}`)) return

    // Check if the browser URL has the redundant /c/{slug} prefix
    const browserPath = window.location.pathname
    const prefix = `/c/${subdomain}`

    if (!browserPath.startsWith(prefix)) return

    // Strip the prefix, keep the rest
    const cleanPath = browserPath.slice(prefix.length) || '/'
    const fullUrl = cleanPath + window.location.search + window.location.hash

    // Preserve Next.js router state object
    window.history.replaceState(window.history.state, '', fullUrl)
  })

  return null
}

// Lightweight HTTP-based database client for Edge Runtime
import { TenantCache } from './cache/tenant-cache'

export class EdgeDB {
  private cache: TenantCache
  
  constructor() {
    this.cache = new TenantCache()
  }
  
  async getTenantBySlug(slug: string): Promise<{id: string, slug: string} | null> {
    // 1. Check in-memory cache (works per-instance)
    const cached = this.cache.get(slug)
    if (cached) return cached
    
    // 2. For production: Use API route to query database
    // This avoids direct DB connection in Edge Runtime
    try {
      const baseUrl = process.env.NEXTAUTH_URL_INTERNAL || 'http://localhost:3000'
      const response = await fetch(
        `${baseUrl}/api/lookup-tenant?slug=${encodeURIComponent(slug)}`,
        {
          headers: {
            'x-internal-secret': process.env.NEXTAUTH_SECRET || '',
            'cache-control': 'no-cache'
          },
          next: { revalidate: 300 }, // 5 minutes cache
          signal: AbortSignal.timeout(5000), // 5s timeout
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.tenant) {
          this.cache.set(slug, data.tenant)
          return data.tenant
        }
      }
    } catch (error) {
      // Only log a short message to avoid flooding logs on transient timeouts
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('timeout') || msg.includes('aborted')) {
        console.warn(`[EdgeDB] Tenant lookup timeout for slug="${slug}"`)
      } else {
        console.error(`[EdgeDB] Tenant lookup failed for slug="${slug}":`, msg)
      }
    }
    
    return null
  }
}

export const edgeDb = new EdgeDB()
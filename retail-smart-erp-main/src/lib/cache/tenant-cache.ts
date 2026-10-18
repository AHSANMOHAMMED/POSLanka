// In-memory cache with TTL for Edge Runtime
// In production, this would be backed by Redis or similar

export class TenantCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cache = new Map<string, {data: any, expires: number}>()
  private ttl = 5 * 60 * 1000 // 5 minutes
  
  get(slug: string): {id: string, slug: string} | null {
    const entry = this.cache.get(slug)
    if (!entry) return null
    
    if (Date.now() > entry.expires) {
      this.cache.delete(slug)
      return null
    }
    
    return entry.data
  }
  
  set(slug: string, data: {id: string, slug: string}): void {
    this.cache.set(slug, {
      data,
      expires: Date.now() + this.ttl
    })
  }
  
  invalidate(slug: string): void {
    this.cache.delete(slug)
  }
  
  clear(): void {
    this.cache.clear()
  }
}
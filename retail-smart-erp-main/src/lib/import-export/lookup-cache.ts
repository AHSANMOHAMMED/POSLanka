// Lookup cache for import operations - optimized for batch resolution
// Uses in-memory cache with TTL and automatic batching to reduce database queries
import { logError } from '@/lib/ai/error-logger'

export interface LookupCacheOptions {
  ttl?: number // Cache TTL in milliseconds (default: 5 minutes)
  batchSize?: number // Maximum batch size for database queries (default: 1000)
}

export interface LookupConfig {
  entity: string // e.g., 'categories'
  table: string // DB table name
  matchField: string // Field to match against (e.g., 'name')
  valueField: string // Field to return (e.g., 'id')
}

export class LookupCache {
  private cache = new Map<string, { data: Map<string, string>; expires: number }>()
  private pendingBatches = new Map<string, Set<string>>()
  private pendingResolvers = new Map<string, Map<string, Array<(value: string | null) => void>>>()
  private options: Required<LookupCacheOptions>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getSchemaTable: (tableName: string) => any
  
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSchemaTable: (tableName: string) => any,
    options: LookupCacheOptions = {}
  ) {
    this.getSchemaTable = getSchemaTable
    this.options = {
      ttl: options.ttl ?? 5 * 60 * 1000, // 5 minutes
      batchSize: options.batchSize ?? 1000
    }
  }

  /**
   * Get a single lookup value from cache or schedule batch resolution
   */
  async get(
    config: LookupConfig,
    matchValue: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any // Drizzle DB instance
  ): Promise<string | null> {
    const cacheKey = this.getCacheKey(config)
    const normalizedValue = matchValue.toLowerCase().trim()
    
    // Check cache
    const cacheEntry = this.cache.get(cacheKey)
    if (cacheEntry && Date.now() < cacheEntry.expires) {
      const cachedValue = cacheEntry.data.get(normalizedValue)
      if (cachedValue !== undefined) {
        return cachedValue
      }
    }
    
    // Not in cache, schedule for batch resolution
    return new Promise((resolve) => {
      if (!this.pendingBatches.has(cacheKey)) {
        this.pendingBatches.set(cacheKey, new Set())
        this.pendingResolvers.set(cacheKey, new Map())
      }
      
      const batch = this.pendingBatches.get(cacheKey)!
      const resolvers = this.pendingResolvers.get(cacheKey)!
      
      if (!resolvers.has(normalizedValue)) {
        resolvers.set(normalizedValue, [])
      }
      
      resolvers.get(normalizedValue)!.push(resolve)
      
      if (batch.has(normalizedValue)) {
        // Already in pending batch
        return
      }
      
      batch.add(normalizedValue)
      
      // Schedule batch resolution if not already scheduled
      if (batch.size >= this.options.batchSize) {
        // Process immediately if batch size reached
        this.processBatch(config, db).catch((error) => {
        console.error('Lookup batch processing error:', error)
        logError('import-lookup-batch', error, { errorSource: 'system' })
        })
      } else {
        // Defer processing for micro-batching
        setTimeout(() => {
          if (batch.size > 0) {
            this.processBatch(config, db).catch((error) => {
              console.error('Lookup batch processing error:', error)
              logError('lookup-cache', error, { errorSource: 'system' })
            })
          }
        }, 10) // 10ms debounce for micro-batching
      }
    })
  }

  /**
   * Batch-resolve multiple values at once
   */
  async getBatch(
    config: LookupConfig,
    matchValues: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any
  ): Promise<Map<string, string>> {
    const cacheKey = this.getCacheKey(config)
    const normalizedValues = matchValues.map(v => v.toLowerCase().trim())
    
    // Check cache first
    const cacheEntry = this.cache.get(cacheKey)
    const result = new Map<string, string>()
    const toResolve = new Set<string>()
    
    normalizedValues.forEach((normalizedValue) => {
      if (cacheEntry && Date.now() < cacheEntry.expires) {
        const cachedValue = cacheEntry.data.get(normalizedValue)
        if (cachedValue !== undefined) {
          result.set(normalizedValue, cachedValue)
          return
        }
      }
      toResolve.add(normalizedValue)
    })
    
    if (toResolve.size === 0) {
      return result
    }
    
    // Resolve remaining values
    const resolved = await this.resolveBatch(config, Array.from(toResolve), db)
    
    // Update result with resolved values
    resolved.forEach((value, key) => {
      result.set(key, value)
    })
    
    return result
  }

  /**
   * Manually add a value to cache (useful for auto-created entities)
   */
  set(config: LookupConfig, matchValue: string, resolvedValue: string): void {
    const cacheKey = this.getCacheKey(config)
    const normalizedValue = matchValue.toLowerCase().trim()
    
    let cacheEntry = this.cache.get(cacheKey)
    if (!cacheEntry || Date.now() >= cacheEntry.expires) {
      cacheEntry = {
        data: new Map(),
        expires: Date.now() + this.options.ttl
      }
      this.cache.set(cacheKey, cacheEntry)
    }
    
    cacheEntry.data.set(normalizedValue, resolvedValue)
    
    // Notify any pending resolvers
    const resolvers = this.pendingResolvers.get(cacheKey)
    if (resolvers) {
      const valueResolvers = resolvers.get(normalizedValue)
      if (valueResolvers) {
        valueResolvers.forEach(resolve => resolve(resolvedValue))
        resolvers.delete(normalizedValue)
      }
    }
  }

  /**
   * Invalidate cache for a specific lookup config
   */
  invalidate(config: LookupConfig): void {
    const cacheKey = this.getCacheKey(config)
    this.cache.delete(cacheKey)
    this.pendingBatches.delete(cacheKey)
    this.pendingResolvers.delete(cacheKey)
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.cache.clear()
    this.pendingBatches.clear()
    this.pendingResolvers.clear()
  }

  private getCacheKey(config: LookupConfig): string {
    return `${config.table}:${config.matchField}:${config.valueField}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async processBatch(config: LookupConfig, db: any): Promise<void> {
    const cacheKey = this.getCacheKey(config)
    const batch = this.pendingBatches.get(cacheKey)
    const resolvers = this.pendingResolvers.get(cacheKey)
    
    if (!batch || !resolvers || batch.size === 0) {
      return
    }
    
    // Take current batch and clear pending
    const valuesToResolve = Array.from(batch)
    batch.clear()
    
    try {
      const resolved = await this.resolveBatch(config, valuesToResolve, db)
      
      // Notify all resolvers
      valuesToResolve.forEach(value => {
        const resolvedValue = resolved.get(value) ?? null
        const valueResolvers = resolvers.get(value)
        if (valueResolvers) {
          valueResolvers.forEach(resolve => resolve(resolvedValue))
          resolvers.delete(value)
        }
      })
    } catch (error) {
      console.error(`Lookup batch resolution failed for ${cacheKey}:`, error)
      logError('lookup-cache', error, { 
        errorSource: 'system'
      })
      
      // Notify all resolvers with null on error
      valuesToResolve.forEach(value => {
        const valueResolvers = resolvers.get(value)
        if (valueResolvers) {
          valueResolvers.forEach(resolve => resolve(null))
          resolvers.delete(value)
        }
      })
    }
  }

  private async resolveBatch(
    config: LookupConfig,
    values: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any
  ): Promise<Map<string, string>> {
    if (values.length === 0) {
      return new Map()
    }
    
    // Get schema table
    const schemaTable = this.getSchemaTable(config.table)
    if (!schemaTable) {
      const error = new Error(`Table not found: ${config.table}`)
      logError('lookup-cache', error, { 
        errorSource: 'system',
        context: { table: config.table, config }
      })
      throw error
    }
    
    // Build query
    const matchField = schemaTable[config.matchField as keyof typeof schemaTable]
    if (!matchField) {
      const error = new Error(`Field ${config.matchField} not found in table ${config.table}`)
      logError('lookup-cache', error, { 
        errorSource: 'system',
        context: { table: config.table, field: config.matchField, config }
      })
      throw error
    }
    
    try {
      // Query database
      const results = await db.select({
        matchValue: matchField,
        resolvedValue: schemaTable[config.valueField as keyof typeof schemaTable]
      }).from(schemaTable)
      
      // Build result map
      const result = new Map<string, string>()
      const normalizedResults = new Map<string, string>()
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results.forEach((row: any) => {
        if (row.matchValue && row.resolvedValue) {
          const normalizedKey = String(row.matchValue).toLowerCase().trim()
          normalizedResults.set(normalizedKey, String(row.resolvedValue))
        }
      })
      
      values.forEach(value => {
        const resolved = normalizedResults.get(value.toLowerCase().trim())
        if (resolved) {
          result.set(value, resolved)
        }
      })
      
      // Update cache
      const cacheKey = this.getCacheKey(config)
      let cacheEntry = this.cache.get(cacheKey)
      if (!cacheEntry || Date.now() >= cacheEntry.expires) {
        cacheEntry = {
          data: new Map(),
          expires: Date.now() + this.options.ttl
        }
        this.cache.set(cacheKey, cacheEntry)
      }
      
      result.forEach((resolvedValue, matchValue) => {
        cacheEntry!.data.set(matchValue.toLowerCase().trim(), resolvedValue)
      })
      
      // Log cache statistics for monitoring
      if (values.length > 100) {
        console.log(`LookupCache: Resolved ${result.size}/${values.length} values for ${config.table}`)
      }
      
      return result
    } catch (error) {
      console.error(`LookupCache: Database query failed for ${config.table}:`, error)
      logError('lookup-cache', error, { 
        errorSource: 'system',
        context: { 
          table: config.table, 
          field: config.matchField,
          valueCount: values.length,
          config 
        }
      })
      throw error
    }
  }
}

// Global instance for import operations - needs to be initialized with schema resolver
export const importLookupCache = new LookupCache(
  (_tableName: string) => {
    // This should be provided by the consumer
    throw new Error('Schema resolver not initialized - importLookupCache must be re-initialized with proper schema resolver')
  },
  {
    ttl: 10 * 60 * 1000, // 10 minutes for import operations
    batchSize: 500 // Optimize for typical import batch sizes
  }
)
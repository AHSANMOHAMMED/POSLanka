import { db } from '@/lib/db'
import { rolePermissionOverrides, customRoles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  loadedAt: number
  // key: "role:permission" → boolean
  builtinOverrides: Map<string, boolean>
  // key: "customRoleId:permission" → boolean
  customRolePerms: Map<string, boolean>
  // customRoleId → { baseRole, name }
  customRoleMap: Map<string, { baseRole: string; name: string }>
}

const cache = new Map<string, CacheEntry>()

/**
 * Load all permission overrides and custom roles for a tenant into memory.
 * Called lazily from authWithCompany(). Safe to call repeatedly (TTL-gated).
 */
export async function warmPermissionCache(tenantId: string): Promise<void> {
  const existing = cache.get(tenantId)
  if (existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) return

  try {
    const [overrides, roles] = await Promise.all([
      db.select().from(rolePermissionOverrides).where(eq(rolePermissionOverrides.tenantId, tenantId)),
      db.select().from(customRoles).where(eq(customRoles.tenantId, tenantId)),
    ])

    const entry: CacheEntry = {
      loadedAt: Date.now(),
      builtinOverrides: new Map(),
      customRolePerms: new Map(),
      customRoleMap: new Map(),
    }

    for (const o of overrides) {
      if (o.role) {
        entry.builtinOverrides.set(`${o.role}:${o.permissionKey}`, o.isGranted)
      } else if (o.customRoleId) {
        entry.customRolePerms.set(`${o.customRoleId}:${o.permissionKey}`, o.isGranted)
      }
    }

    for (const r of roles) {
      entry.customRoleMap.set(r.id, { baseRole: r.baseRole, name: r.name })
    }

    cache.set(tenantId, entry)
  } catch {
    // On DB error, keep stale cache or no cache — fall back to system defaults
  }
}

/**
 * Check if a built-in role has a tenant-specific override for a permission.
 * Returns undefined if no override exists (caller should use system default).
 */
export function getPermissionOverride(tenantId: string, role: string, permission: string): boolean | undefined {
  const entry = cache.get(tenantId)
  if (!entry) return undefined
  return entry.builtinOverrides.get(`${role}:${permission}`)
}

/**
 * Check if a custom role has a specific permission.
 * Returns undefined if no explicit permission set (caller should check base role).
 */
export function getCustomRolePermission(tenantId: string, customRoleId: string, permission: string): boolean | undefined {
  const entry = cache.get(tenantId)
  if (!entry) return undefined
  return entry.customRolePerms.get(`${customRoleId}:${permission}`)
}

/**
 * Get the base role for a custom role (for fallback to system defaults).
 */
export function getCustomRoleBaseRole(tenantId: string, customRoleId: string): string | undefined {
  const entry = cache.get(tenantId)
  if (!entry) return undefined
  return entry.customRoleMap.get(customRoleId)?.baseRole
}

/**
 * Get the display name for a custom role.
 */
export function getCustomRoleName(tenantId: string, customRoleId: string): string | undefined {
  const entry = cache.get(tenantId)
  if (!entry) return undefined
  return entry.customRoleMap.get(customRoleId)?.name
}

/**
 * Get all custom roles for a tenant (from cache).
 */
export function getCachedCustomRoles(tenantId: string): Array<{ id: string; baseRole: string; name: string }> {
  const entry = cache.get(tenantId)
  if (!entry) return []
  return Array.from(entry.customRoleMap.entries()).map(([id, data]) => ({ id, ...data }))
}

/**
 * Invalidate cache for a tenant. Called after permission mutations.
 */
export function invalidatePermissionCache(tenantId: string): void {
  cache.delete(tenantId)
}

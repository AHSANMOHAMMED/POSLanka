import { Client } from 'pg'
import { db } from '@/lib/db'
import { rolePermissionOverrides, customRoles, moduleAccess } from '@/lib/db/schema'
import { pgConnectionConfig } from '@/lib/db/pg-connection'
import { eq, sql } from 'drizzle-orm'
import { registerModuleAccessLookup } from './roles'
import { clearSessionValidation } from './session-validation-cache'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  loadedAt: number
  // key: "role:permission" → boolean
  builtinOverrides: Map<string, boolean>
  // key: "customRoleId:permission" → boolean
  customRolePerms: Map<string, boolean>
  // customRoleId → { baseRole, name, isActive }
  customRoleMap: Map<string, { baseRole: string; name: string; isActive: boolean }>
  // "role:moduleKey" of modules the owner switched OFF for a built-in role
  disabledModules: Set<string>
}

const cache = new Map<string, CacheEntry>()

/**
 * Load all permission overrides and custom roles for a tenant into memory.
 * Called lazily from authWithCompany(). Safe to call repeatedly (TTL-gated).
 */
export async function warmPermissionCache(tenantId: string): Promise<void> {
  startInvalidationListener()
  const existing = cache.get(tenantId)
  if (existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) return

  try {
    const [overrides, roles, modules] = await Promise.all([
      db.select().from(rolePermissionOverrides).where(eq(rolePermissionOverrides.tenantId, tenantId)),
      db.select().from(customRoles).where(eq(customRoles.tenantId, tenantId)),
      db.select({ role: moduleAccess.role, moduleKey: moduleAccess.moduleKey, isEnabled: moduleAccess.isEnabled })
        .from(moduleAccess).where(eq(moduleAccess.tenantId, tenantId)),
    ])

    const entry: CacheEntry = {
      loadedAt: Date.now(),
      builtinOverrides: new Map(),
      customRolePerms: new Map(),
      customRoleMap: new Map(),
      disabledModules: new Set(),
    }

    for (const o of overrides) {
      if (o.role) {
        entry.builtinOverrides.set(`${o.role}:${o.permissionKey}`, o.isGranted)
      } else if (o.customRoleId) {
        entry.customRolePerms.set(`${o.customRoleId}:${o.permissionKey}`, o.isGranted)
      }
    }

    for (const r of roles) {
      entry.customRoleMap.set(r.id, { baseRole: r.baseRole, name: r.name, isActive: r.isActive })
    }

    for (const m of modules) {
      // Owners can never be locked out of a module
      if (!m.isEnabled && m.role !== 'owner') entry.disabledModules.add(`${m.role}:${m.moduleKey}`)
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
  // A deactivated custom role grants nothing extra: its users fall back to the base role
  if (entry.customRoleMap.get(customRoleId)?.isActive === false) return undefined
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
export function getCachedCustomRoles(tenantId: string): Array<{ id: string; baseRole: string; name: string; isActive: boolean }> {
  const entry = cache.get(tenantId)
  if (!entry) return []
  return Array.from(entry.customRoleMap.entries()).map(([id, data]) => ({ id, ...data }))
}

/**
 * True when the owner disabled `moduleKey` for the built-in `role` (Settings → Module Access).
 */
export function isModuleDisabled(tenantId: string, role: string, moduleKey: string): boolean {
  const entry = cache.get(tenantId)
  if (!entry) return false
  return entry.disabledModules.has(`${role}:${moduleKey}`)
}

// Wire module-access enforcement into hasPermission as soon as this (server-only) module loads;
// authWithCompany() dynamic-imports it on every request before any permission check.
registerModuleAccessLookup(isModuleDisabled)

// ---------------------------------------------------------------------------
// Cross-process invalidation. Every app process keeps its own cache; a change made in one
// process (role edit, custom role, module access, user role) is published on a Postgres
// NOTIFY channel so the other processes drop that tenant immediately. (The websocket broadcast
// layer only reaches browsers, so it is not used for this.) The 5-minute TTL remains the
// fallback if a notification is missed; after a listener reconnect the whole cache is dropped.
// ---------------------------------------------------------------------------
const CHANNEL = 'permission_cache_invalidate'
const UUID_RE = /^[0-9a-f-]{36}$/i

declare global {
  var __permCacheListener: { client: Client | null; starting: boolean; retryMs: number } | undefined
}

function startInvalidationListener(): void {
  if (process.env.PERMISSION_CACHE_LISTEN === '0' || !process.env.DATABASE_URL) return
  const state = (globalThis.__permCacheListener ||= { client: null, starting: false, retryMs: 1000 })
  if (state.client || state.starting) return
  state.starting = true
  const client = new Client({ ...pgConnectionConfig(process.env.DATABASE_URL), keepAlive: true })
  const retry = () => {
    if (state.client === client) state.client = null
    client.removeAllListeners()
    client.end().catch(() => undefined)
    const wait = state.retryMs
    state.retryMs = Math.min(state.retryMs * 2, 60_000)
    const t = setTimeout(() => startInvalidationListener(), wait)
    t.unref?.()
  }
  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL) return
    if (msg.payload === '*') cache.clear()
    else if (msg.payload) cache.delete(msg.payload)
    // Same signal: staff/roles changed → cached session checks of that tenant are stale too
    if (msg.payload) clearSessionValidation(msg.payload)
  })
  client.on('error', retry)
  client.connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .then(() => {
      state.client = client
      state.starting = false
      state.retryMs = 1000
      // Anything published while we were not listening is unknown: start clean
      cache.clear()
      clearSessionValidation('*')
      // Never keep a process (tests, scripts) alive just for this socket
      ;(client as unknown as { connection?: { stream?: { unref?: () => void } } }).connection?.stream?.unref?.()
    })
    .catch(() => {
      state.starting = false
      retry()
    })
}

/**
 * Invalidate cache for a tenant. Called after permission mutations (roles, custom roles,
 * module access) and staff changes (deactivation, role/password change, tenant status), which
 * also drops the tenant's cached session checks. Applies in this process right away and tells
 * the other processes.
 */
export function invalidatePermissionCache(tenantId: string): void {
  cache.delete(tenantId)
  clearSessionValidation(tenantId)
  if (!UUID_RE.test(tenantId)) return
  db.execute(sql`SELECT pg_notify(${CHANNEL}, ${tenantId})`).catch(() => undefined)
}

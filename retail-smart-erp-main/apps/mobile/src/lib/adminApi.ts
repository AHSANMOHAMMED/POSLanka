// Platform (super-admin) session + API client.
//
// The admin token lives under its own SecureStore key and is sent as a Bearer
// header ONLY to /api/sys-control/* routes; it never touches the tenant client
// in src/lib/api.ts and the tenant token is never sent to sys-control.
import { useEffect, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { getApiBase, REQUEST_TIMEOUT_MS, type ApiResult } from './api'

const ADMIN_TOKEN_KEY = 'poslanka_admin_token'
const ADMIN_USER_KEY = 'poslanka_admin_user'

export const SYS_CONTROL_PREFIX = '/api/sys-control/'

export type AdminRole = 'owner' | 'support' | 'billing' | 'viewer'

export interface AdminUser {
  name: string
  email: string
  /** Platform role from mobile-login (absent for sessions saved by an older app version) */
  role?: AdminRole
  /** Permissions granted by the role (same names as src/lib/admin/roles.ts on the server) */
  permissions?: string[]
}

/** Server permission names (src/lib/admin/roles.ts); the server enforces them on every request. */
const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  owner: ['read', 'self', 'vendors.manage', 'vendors.impersonate', 'messages', 'notifications', 'error_logs', 'billing', 'settings', 'admins'],
  support: ['read', 'self', 'vendors.impersonate', 'messages', 'notifications', 'error_logs'],
  billing: ['read', 'self', 'billing'],
  viewer: ['read', 'self'],
}

export const ADMIN_ROLE_LABEL: Record<AdminRole, string> = { owner: 'Owner', support: 'Support', billing: 'Billing', viewer: 'Viewer' }

/**
 * Whether the signed-in admin's role allows `permission`. Only hides controls: every
 * /api/sys-control route checks the role again. A session saved before roles existed has no
 * role; its controls stay visible and the server answers 403 where the role does not allow it.
 */
export function adminCan(user: AdminUser | null | undefined, permission: string): boolean {
  if (!user) return false
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission)
  if (user.role && ROLE_PERMISSIONS[user.role]) return ROLE_PERMISSIONS[user.role].includes(permission)
  return true
}

/** React hook: the stored admin (null until loaded) and a permission check. */
export function useAdminUser(): { admin: AdminUser | null; can: (permission: string) => boolean } {
  const [admin, setAdmin] = useState<AdminUser | null>(cachedAdmin ?? null)
  useEffect(() => {
    let alive = true
    getAdminUser().then((a) => { if (alive) setAdmin(a) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  return { admin, can: (permission: string) => adminCan(admin, permission) }
}

let cachedAdmin: AdminUser | null | undefined

export async function getAdminToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ADMIN_TOKEN_KEY)
}

export async function getAdminUser(): Promise<AdminUser | null> {
  if (cachedAdmin !== undefined) return cachedAdmin
  const raw = await SecureStore.getItemAsync(ADMIN_USER_KEY)
  if (!raw) {
    cachedAdmin = null
    return null
  }
  try {
    cachedAdmin = JSON.parse(raw) as AdminUser
  } catch {
    cachedAdmin = null
  }
  return cachedAdmin
}

export async function setAdminSession(token: string, admin: AdminUser): Promise<void> {
  cachedAdmin = admin
  unauthorizedInFlight = false
  await Promise.all([SecureStore.setItemAsync(ADMIN_TOKEN_KEY, token), SecureStore.setItemAsync(ADMIN_USER_KEY, JSON.stringify(admin))])
}

export async function clearAdminSession(): Promise<void> {
  cachedAdmin = null
  await Promise.all([SecureStore.deleteItemAsync(ADMIN_TOKEN_KEY), SecureStore.deleteItemAsync(ADMIN_USER_KEY)])
}

export async function adminLogout(): Promise<void> {
  await clearAdminSession()
  router.replace('/login')
}

let unauthorizedInFlight = false

async function handleAdminUnauthorized() {
  if (unauthorizedInFlight) return
  unauthorizedInFlight = true
  try {
    await clearAdminSession()
  } finally {
    router.replace('/login')
  }
}

export interface AdminFetchOptions {
  timeoutMs?: number
  skipUnauthorizedHandler?: boolean
}

/**
 * Typed sys-control request. Never throws; network errors come back as
 * { ok:false, status:0 }. Refuses to send the admin token anywhere but /api/sys-control/*.
 */
export async function adminApi<T = any>(path: string, init: RequestInit = {}, options: AdminFetchOptions = {}): Promise<ApiResult<T>> {
  if (!path.startsWith(SYS_CONTROL_PREFIX)) {
    return { ok: false, status: 0, data: null, error: `adminApi only serves ${SYS_CONTROL_PREFIX}* routes (got ${path})` }
  }
  const token = await getAdminToken()
  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${getApiBase()}${path}`, { ...init, headers, signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      data: null,
      error: aborted ? 'The server took too long to respond.' : 'Cannot reach the skyERPOS server. Check your connection and the server URL.',
    }
  }
  clearTimeout(timer)

  let body: any = null
  const text = await res.text().catch(() => '')
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (res.ok) return { ok: true, status: res.status, data: body as T, error: null }

  if (res.status === 401 && !options.skipUnauthorizedHandler) handleAdminUnauthorized()

  const message =
    (body && typeof body.error === 'string' && body.error) ||
    (body && typeof body.message === 'string' && body.message) ||
    (res.status === 401 ? 'Admin session expired. Please sign in again.' : '') ||
    (res.status === 403 ? 'Your admin role does not allow this.' : '') ||
    `Request failed (${res.status})`
  return { ok: false, status: res.status, data: body as T, error: message }
}

export const adminGet = <T = any>(path: string, options?: AdminFetchOptions) => adminApi<T>(path, { method: 'GET' }, options)
export const adminPut = <T = any>(path: string, body?: unknown, options?: AdminFetchOptions) =>
  adminApi<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }, options)
export const adminPost = <T = any>(path: string, body?: unknown, options?: AdminFetchOptions) =>
  adminApi<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, options)

export interface AdminLoginResponse {
  token: string
  admin: AdminUser & { id?: string }
  permissions?: string[]
}

/** POST /api/sys-control/auth/mobile-login. 428 + { requires2fa:true } → caller must ask for a TOTP code. */
export async function adminLogin(email: string, password: string, totpCode?: string): Promise<ApiResult<AdminLoginResponse> & { requires2fa?: boolean }> {
  const res = await adminApi<AdminLoginResponse & { requires2fa?: boolean }>(
    `${SYS_CONTROL_PREFIX}auth/mobile-login`,
    { method: 'POST', body: JSON.stringify({ email, password, totpCode: totpCode || undefined }) },
    { skipUnauthorizedHandler: true }
  )
  if (!res.ok && res.status === 428) {
    return { ...res, requires2fa: true }
  }
  return res
}

/** Convenience for list endpoints that return either an array or { <key>: [...] }. */
export function adminList<T = any>(body: any, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object') {
    for (const key of [...keys, 'data', 'items']) {
      if (Array.isArray(body[key])) return body[key] as T[]
    }
  }
  return []
}

import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'

declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string
    [key: string]: string | undefined
  }
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'poslanka_token'
const USER_KEY = 'poslanka_user'
const API_BASE_KEY = 'poslanka_api_base'
const TENANT_SLUG_KEY = 'poslanka_tenant_slug'
const BUSINESS_ID_KEY = 'poslanka_business_id'

// Server the app talks to until the user changes it on the sign-in screen. Set per build with
// EXPO_PUBLIC_API_URL (eas.json profiles, scripts/build-apk.sh). Expo inlines EXPO_PUBLIC_* only
// for this exact `process.env.NAME` form — with `?.` the release APK silently fell back to localhost.
export const DEFAULT_API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '')
export const REQUEST_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
  tenantSlug: string
  tenantName: string
  businessType?: string | null
  /** Vendor Business ID (e.g. PL985633) — what staff type at sign-in. */
  businessId?: string | null
  customRoleId?: string | null
  customRoleName?: string | null
  /** Server-effective permissions (custom roles, overrides, module access applied). */
  permissions?: Record<string, boolean> | null
}

/** "pl-482 913" → "PL482913"; null when it isn't shaped like a Business ID. */
export function normalizeBusinessId(input: string | null | undefined): string | null {
  if (!input) return null
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '')
  return /^PL\d{6}$/.test(compact) ? compact : null
}

/** PL482913 → PL-482913 (display form). */
export function formatBusinessId(id: string | null | undefined): string {
  if (!id) return ''
  return /^PL\d{6}$/.test(id) ? `${id.slice(0, 2)}-${id.slice(2)}` : id
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T; error: null }
  | { ok: false; status: number; data: T | null; error: string }

/** status === 0 means the request never reached the server (offline / timeout / DNS). */
export function isNetworkError(result: ApiResult<unknown>): boolean {
  return !result.ok && result.status === 0
}

// ---------------------------------------------------------------------------
// API base URL (remembered on device)
// ---------------------------------------------------------------------------
let apiBase = DEFAULT_API_URL

export function setApiBase(url: string) {
  apiBase = (url || DEFAULT_API_URL).trim().replace(/\/$/, '')
}

export function getApiBase() {
  return apiBase
}

export interface SavedSettings {
  apiUrl: string
  tenantSlug: string
  /** Remembered Business ID (preferred over the slug); optional for old callers. */
  businessId?: string
}

/** Loads the remembered server URL, Business ID + company slug and applies the URL as the API base. */
export async function loadSavedSettings(): Promise<SavedSettings> {
  const [savedUrl, savedSlug, savedBusinessId] = await Promise.all([
    SecureStore.getItemAsync(API_BASE_KEY),
    SecureStore.getItemAsync(TENANT_SLUG_KEY),
    SecureStore.getItemAsync(BUSINESS_ID_KEY),
  ])
  if (savedUrl) setApiBase(savedUrl)
  return { apiUrl: savedUrl || apiBase, tenantSlug: savedSlug || '', businessId: savedBusinessId || '' }
}

export async function saveSettings(settings: SavedSettings) {
  setApiBase(settings.apiUrl)
  const writes: Promise<void>[] = [
    SecureStore.setItemAsync(API_BASE_KEY, getApiBase()),
    SecureStore.setItemAsync(TENANT_SLUG_KEY, settings.tenantSlug || ''),
  ]
  // Only overwrite the remembered Business ID when the caller passes one.
  if (settings.businessId !== undefined) {
    writes.push(SecureStore.setItemAsync(BUSINESS_ID_KEY, settings.businessId || ''))
  }
  await Promise.all(writes)
}

// ---------------------------------------------------------------------------
// Session (token + user)
// ---------------------------------------------------------------------------
let cachedUser: AuthUser | null | undefined

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY)
}

export async function setToken(token: string | null) {
  if (!token) {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    return
  }
  unauthorizedInFlight = false
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function getUser(): Promise<AuthUser | null> {
  if (cachedUser !== undefined) return cachedUser
  const raw = await SecureStore.getItemAsync(USER_KEY)
  if (!raw) {
    cachedUser = null
    return null
  }
  try {
    cachedUser = JSON.parse(raw) as AuthUser
  } catch {
    cachedUser = null
  }
  return cachedUser
}

export async function setUser(user: AuthUser | null) {
  cachedUser = user
  if (!user) {
    await SecureStore.deleteItemAsync(USER_KEY)
    return
  }
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
}

interface EffectivePermissionsResponse {
  permissions?: Record<string, boolean>
  role?: string
  customRoleId?: string | null
  customRoleName?: string | null
  businessId?: string | null
}

/**
 * Pulls the server-effective permissions (custom roles, overrides, module access) and merges
 * them into the stored user so role changes made by the owner show up without re-login.
 * Offline / server errors keep the last known values; a 401 goes through the normal logout.
 */
export async function refreshPermissions(): Promise<AuthUser | null> {
  const user = await getUser()
  if (!user) return null
  const res = await api<EffectivePermissionsResponse>('/api/role-permissions/effective', { method: 'GET' })
  if (!res.ok || !res.data || !res.data.permissions) return user
  const current = await getUser()
  if (!current || current.id !== user.id) return current
  const next: AuthUser = {
    ...current,
    permissions: res.data.permissions,
    role: res.data.role || current.role,
    customRoleId: res.data.customRoleId !== undefined ? res.data.customRoleId : current.customRoleId,
    customRoleName: res.data.customRoleName !== undefined ? res.data.customRoleName : current.customRoleName,
    businessId: res.data.businessId || current.businessId,
  }
  await setUser(next)
  return next
}

/** Clears token + user. Remembered server URL and slug are kept. */
export async function clearSession() {
  cachedUser = null
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ])
}

// Hooks run before the session is cleared on an explicit sign-out (e.g. push
// token de-registration). Not run on the automatic 401 logout.
const beforeLogoutHooks = new Set<() => Promise<void> | void>()

export function onBeforeLogout(fn: () => Promise<void> | void): () => void {
  beforeLogoutHooks.add(fn)
  return () => {
    beforeLogoutHooks.delete(fn)
  }
}

export async function logout() {
  for (const hook of Array.from(beforeLogoutHooks)) {
    try {
      await hook()
    } catch {
      // never block sign-out
    }
  }
  await clearSession()
  router.replace('/login')
}

// ---------------------------------------------------------------------------
// Shared 401 handler — clears the session and navigates to /login exactly once
// even if several requests fail at the same time.
// ---------------------------------------------------------------------------
let unauthorizedInFlight = false

export async function handleUnauthorized() {
  if (unauthorizedInFlight) return
  unauthorizedInFlight = true
  try {
    await clearSession()
  } finally {
    router.replace('/login')
  }
}

// ---------------------------------------------------------------------------
// Low-level fetch (kept for compatibility). Adds auth header, JSON content type,
// a 15s timeout and the shared 401 handling. Throws on network errors/timeouts.
// ---------------------------------------------------------------------------
export interface ApiFetchOptions {
  timeoutMs?: number
  /** Skip the automatic logout on 401 (used by the login call itself). */
  skipUnauthorizedHandler?: boolean
}

export async function apiFetch(path: string, init: RequestInit = {}, options: ApiFetchOptions = {}) {
  const token = await getToken()
  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
    if (res.status === 401 && !options.skipUnauthorizedHandler) {
      // Token expired/invalid for any route -> drop the session and go to login.
      handleUnauthorized()
    }
    return res
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Typed wrapper: never throws. Network errors / timeouts come back as
// { ok:false, status:0 }. HTTP errors carry the server's `error` message.
// ---------------------------------------------------------------------------
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await apiFetch(path, init, options)
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      data: null,
      error: aborted
        ? 'The server took too long to respond. Check your connection and try again.'
        : 'Cannot reach the POSLanka server. Check your connection and the server URL.',
    }
  }

  let body: any = null
  const text = await res.text().catch(() => '')
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (res.ok) {
    return { ok: true, status: res.status, data: body as T, error: null }
  }

  const message =
    (body && typeof body.error === 'string' && body.error) ||
    (body && typeof body.message === 'string' && body.message) ||
    (body && Array.isArray(body.details) && body.details.map((d: any) => d.message || d).join(', ')) ||
    (res.status === 401 ? 'Session expired. Please sign in again.' : '') ||
    (res.status === 403 ? 'You do not have permission to do this.' : '') ||
    `Request failed (${res.status})`

  return { ok: false, status: res.status, data: body as T, error: message }
}

export const apiGet = <T = any>(path: string, options?: ApiFetchOptions) =>
  api<T>(path, { method: 'GET' }, options)

export const apiPost = <T = any>(path: string, body?: unknown, options?: ApiFetchOptions) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, options)

export const apiDelete = <T = any>(path: string, options?: ApiFetchOptions) =>
  api<T>(path, { method: 'DELETE' }, options)

/** Builds a query string, skipping empty / undefined values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/** Normalises list responses that are either a bare array or `{ data: [...] }` / `{ <key>: [...] }`. */
export function asList<T = any>(body: any, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object') {
    for (const key of [...keys, 'data', 'items']) {
      if (Array.isArray(body[key])) return body[key] as T[]
    }
  }
  return []
}

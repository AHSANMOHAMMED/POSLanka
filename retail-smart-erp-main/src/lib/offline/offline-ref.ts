/**
 * Offline receipt numbers for the web POS: OFF-W<5 chars>-<seq>.
 *
 * The device code is random per browser profile (leading "W" = web till; mobile codes never
 * collide by construction but a clash is handled anyway: OFFLINE_REF_CONFLICT → re-numbered with
 * the printed number kept as alias). The sequence is per company and per browser. Both live in
 * localStorage; increments are serialised across tabs with Web Locks when available.
 */
import { formatOfflineRef } from './sync-policy'

const DEVICE_KEY = 'poslanka.webDeviceCode'
const SEQ_PREFIX = 'poslanka.offlineSeq.'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface RefStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const memory = new Map<string, string>()
const memoryStorage: RefStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => { memory.set(k, v) },
}

function defaultStorage(): RefStorage {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('poslanka.probe', '1')
      return localStorage
    }
  } catch {
    // private mode / blocked storage
  }
  return memoryStorage
}

function randomCode(len: number): string {
  const bytes = new Uint8Array(len)
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function getWebDeviceCode(storage: RefStorage = defaultStorage()): string {
  let code = storage.getItem(DEVICE_KEY)
  if (!code || !/^W[A-Z0-9]{5}$/.test(code)) {
    code = `W${randomCode(5)}`
    storage.setItem(DEVICE_KEY, code)
  }
  return code
}

/** Allocate the next offline receipt number for this browser and company (synchronous core). */
export function allocateOfflineRef(tenantSlug: string | null | undefined, storage: RefStorage = defaultStorage()): string {
  const key = SEQ_PREFIX + (tenantSlug || 'default')
  const seq = (Number.parseInt(storage.getItem(key) || '0', 10) || 0) + 1
  storage.setItem(key, String(seq))
  return formatOfflineRef(getWebDeviceCode(storage), seq)
}

/** Browser entry point: allocation serialised across tabs (Web Locks) when supported. */
export async function nextOfflineRef(tenantSlug: string | null | undefined): Promise<string> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (!locks) return allocateOfflineRef(tenantSlug)
  return (await locks.request('poslanka-offline-ref', async () => allocateOfflineRef(tenantSlug))) as unknown as string
}

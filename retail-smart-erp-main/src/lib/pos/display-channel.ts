/**
 * POS → Customer Display channel
 *
 * The POS page publishes its live cart state here; the customer-facing display
 * (`/c/[slug]/pos/display`) subscribes and mirrors it.
 *
 * Transport: BroadcastChannel (same-origin tabs/windows) with a localStorage
 * fallback (the `storage` event fires in every *other* tab when the key changes).
 * Both are written on every publish so a display opened later can pick up the
 * last known state from localStorage immediately.
 */

export const POS_DISPLAY_CHANNEL_NAME = 'poslanka-pos-display'
export const POS_DISPLAY_STORAGE_KEY = 'poslanka:pos-display'

export type PosDisplayStatus = 'idle' | 'cart' | 'paying' | 'paid'

export interface PosDisplayItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  total: number
  unit?: string
}

export type PosDisplayState = {
  tenantName: string
  cashierName: string
  items: PosDisplayItem[]
  subtotal: number
  discount: number
  tax: number
  total: number
  status: PosDisplayStatus
  changeDue?: number
  /** Amount the customer handed over (cash) */
  amountPaid?: number
  invoiceNo?: string
  /** Shop the POS belongs to: a display of another shop in the same browser ignores it */
  tenantSlug?: string
  /** ISO timestamp of when this state was produced */
  updatedAt: string
  /** ISO timestamp of the last (re)send: the POS re-sends every few seconds as a heartbeat */
  sentAt?: string
}

/** How often the POS re-sends its state (the display shows "Waiting for POS" after a few missed beats) */
export const POS_DISPLAY_HEARTBEAT_MS = 15_000

export type PosDisplaySubscriber = (state: PosDisplayState) => void

/** Runtime guard – messages can arrive from any same-origin script. */
export function isPosDisplayState(value: unknown): value is PosDisplayState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.tenantName === 'string' &&
    typeof v.cashierName === 'string' &&
    Array.isArray(v.items) &&
    typeof v.subtotal === 'number' &&
    typeof v.discount === 'number' &&
    typeof v.tax === 'number' &&
    typeof v.total === 'number' &&
    typeof v.status === 'string' &&
    ['idle', 'cart', 'paying', 'paid'].includes(v.status as string) &&
    typeof v.updatedAt === 'string'
  )
}

/** Build an idle/welcome state (used by the POS when the cart is cleared). */
export function createIdlePosDisplayState(
  tenantName: string,
  cashierName: string
): PosDisplayState {
  return {
    tenantName,
    cashierName,
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    status: 'idle',
    updatedAt: new Date().toISOString(),
  }
}

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  if (!channel) {
    try {
      channel = new BroadcastChannel(POS_DISPLAY_CHANNEL_NAME)
    } catch {
      channel = null
    }
  }
  return channel
}

/**
 * Publish the current POS state to any open customer displays.
 * Safe to call on the server (no-op) and when storage is unavailable.
 */
export function publishPosDisplay(state: PosDisplayState): void {
  if (typeof window === 'undefined') return
  const payload: PosDisplayState = {
    ...state,
    updatedAt: state.updatedAt || new Date().toISOString(),
  }

  const ch = getChannel()
  if (ch) {
    try {
      ch.postMessage(payload)
    } catch {
      // ignore – fall through to storage
    }
  }

  try {
    window.localStorage.setItem(POS_DISPLAY_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // storage may be unavailable (private mode / quota) – BroadcastChannel still works
  }
}

/** Read the last published state from localStorage (if any). */
export function readPosDisplaySnapshot(): PosDisplayState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(POS_DISPLAY_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isPosDisplayState(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Subscribe to POS display updates.
 * Listens on BroadcastChannel and on the `storage` event as a fallback.
 * Returns an unsubscribe function.
 */
export function subscribePosDisplay(cb: PosDisplaySubscriber): () => void {
  if (typeof window === 'undefined') return () => {}

  const ch = getChannel()
  const onMessage = (event: MessageEvent) => {
    if (isPosDisplayState(event.data)) cb(event.data)
  }
  ch?.addEventListener('message', onMessage)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== POS_DISPLAY_STORAGE_KEY || !event.newValue) return
    try {
      const parsed: unknown = JSON.parse(event.newValue)
      if (isPosDisplayState(parsed)) cb(parsed)
    } catch {
      // ignore malformed payloads
    }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    ch?.removeEventListener('message', onMessage)
    window.removeEventListener('storage', onStorage)
  }
}

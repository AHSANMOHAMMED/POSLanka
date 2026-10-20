import { apiGet, isNetworkError, type ApiResult } from './api'
import { getBundle, patchBundle } from './localdb'

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'credit' | 'gift_card'

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'credit', 'gift_card']

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank / LankaQR',
  credit: 'Customer Credit',
  gift_card: 'Gift Card',
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as string[]).includes(value)
}

export function paymentMethodLabel(method: string): string {
  return isPaymentMethod(method) ? PAYMENT_METHOD_LABELS[method] : method
}

export interface ShiftBalance {
  id?: string
  paymentMethod: string
  openingAmount: string
}

export interface PosProfilePaymentMethod {
  paymentMethod: string
  isDefault?: boolean
  allowInReturns?: boolean
  sortOrder?: number
}

export interface PosProfile {
  id: string
  name: string
  code?: string | null
  warehouseId?: string | null
  warehouse?: { id: string; name: string } | null
  defaultPaymentMethod?: string | null
  maxDiscountPercent?: string | number | null
  allowCreditSale?: boolean
  paymentMethods?: PosProfilePaymentMethod[]
  isUserDefault?: boolean
  /** Printed at the top / bottom of receipts (free text, may contain newlines). */
  receiptHeader?: string | null
  receiptFooter?: string | null
  showLogoOnReceipt?: boolean | null
  /** Per-counter receipt overrides (partial receipt settings, see src/lib/receipt.ts). */
  receiptSettings?: Record<string, unknown> | null
}

export interface Shift {
  id: string
  entryNumber?: string
  posProfileId: string
  warehouseId: string
  userId?: string
  openingTime: string
  status: 'open' | 'closed' | 'cancelled'
  notes?: string | null
  posProfile?: PosProfile | null
  warehouse?: { id: string; name: string } | null
  balances?: ShiftBalance[]
}

export interface CurrentShiftResponse {
  shift: Shift | null
  hasOpenShift: boolean
}

/** GET /api/pos-opening-entries?current=true (the answer is cached for offline cold starts). */
export async function fetchCurrentShift(): Promise<ApiResult<CurrentShiftResponse>> {
  const res = await apiGet<CurrentShiftResponse>('/api/pos-opening-entries?current=true')
  if (res.ok) {
    patchBundle({ shift: res.data?.shift || null, posProfile: res.data?.shift?.posProfile || null }).catch(() => undefined)
  }
  return res
}

export interface ShiftLoadResult {
  shift: Shift | null
  /** true when the server could not be reached and `shift` came from the device cache */
  offline: boolean
  error: string | null
  status: number
}

/**
 * Current shift, falling back to the cached open shift when the server is unreachable
 * (power cut / no internet): the cashier can keep selling and the sales sync later.
 */
export async function loadShiftOfflineAware(): Promise<ShiftLoadResult> {
  const res = await fetchCurrentShift()
  if (res.ok) return { shift: res.data.shift, offline: false, error: null, status: res.status }
  if (isNetworkError(res)) {
    const bundle = await getBundle()
    const cached = bundle?.shift as Shift | null | undefined
    if (cached && cached.status === 'open') return { shift: cached, offline: true, error: null, status: 0 }
    return { shift: null, offline: true, error: res.error, status: 0 }
  }
  return { shift: null, offline: false, error: res.error, status: res.status }
}

/** GET /api/pos-profiles — array when assigned, `{ profiles: [] , needsSetup }` otherwise. */
export async function fetchMyProfiles(): Promise<ApiResult<PosProfile[]>> {
  const res = await apiGet<any>('/api/pos-profiles')
  if (!res.ok) return { ok: false, status: res.status, data: null, error: res.error }
  const body = res.data
  const list: PosProfile[] = Array.isArray(body)
    ? body
    : Array.isArray(body?.profiles)
      ? body.profiles
      : body?.profile
        ? [body.profile]
        : []
  return { ok: true, status: res.status, data: list, error: null }
}

export function shiftWarehouseName(shift: Shift | null | undefined): string {
  return shift?.warehouse?.name || shift?.posProfile?.warehouse?.name || ''
}

export function shiftCounterName(shift: Shift | null | undefined): string {
  return shift?.posProfile?.name || ''
}

/** Payment methods a profile allows (valid enum values only); falls back to cash. */
export function profilePaymentMethods(profile: PosProfile | null | undefined): PaymentMethod[] {
  const raw = (profile?.paymentMethods || [])
    .map((pm: any) => (typeof pm === 'string' ? pm : pm?.paymentMethod))
    .filter(isPaymentMethod)
  const unique = Array.from(new Set<PaymentMethod>(raw))
  if (!unique.includes('cash')) unique.unshift('cash')
  return unique
}

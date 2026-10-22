/**
 * Pluggable e-invoice transmitters (H2). The default is `disabled`: documents stay `pending` in
 * the outbox (nothing is sent, no attempts are used) until an IRD RAMIS transmitter is
 * implemented and selected with EINVOICE_TRANSMITTER.
 */
import type { EInvoicePayload } from './types'

export type TransmitResult =
  /** Accepted by the authority (irn = invoice reference number issued by it). */
  | { ok: true; acknowledged: boolean; irn?: string | null; response?: unknown }
  /** Rejected / failed. `retryable: false` → no further automatic attempts. */
  | { ok: false; retryable: boolean; error: string; response?: unknown }

export interface EInvoiceTransmitter {
  readonly name: string
  /** False → the outbox is only filled; nothing is transmitted. */
  readonly enabled: boolean
  transmit(payload: EInvoicePayload, ctx: { tenantId: string; outboxId: string }): Promise<TransmitResult>
}

export const disabledTransmitter: EInvoiceTransmitter = {
  name: 'disabled',
  enabled: false,
  async transmit() {
    return { ok: false, retryable: true, error: 'E-invoice transmission is not configured' }
  },
}

const registry = new Map<string, EInvoiceTransmitter>([[disabledTransmitter.name, disabledTransmitter]])
let override: EInvoiceTransmitter | null = null

/** Register a transmitter implementation (e.g. 'ird-ramis' once the API is published). */
export function registerTransmitter(t: EInvoiceTransmitter) {
  registry.set(t.name, t)
}

/** Tests: force a transmitter (null restores the env-selected one). */
export function setTransmitterOverride(t: EInvoiceTransmitter | null) {
  override = t
}

export function getTransmitter(): EInvoiceTransmitter {
  if (override) return override
  const name = (process.env.EINVOICE_TRANSMITTER || 'disabled').trim()
  const t = registry.get(name)
  if (!t) {
    console.warn(`[einvoice] Unknown EINVOICE_TRANSMITTER "${name}" — transmission disabled`)
    return disabledTransmitter
  }
  return t
}

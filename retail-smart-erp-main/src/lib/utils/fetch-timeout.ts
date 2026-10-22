/**
 * fetch() with a deadline for calls to third-party services (SMS, e-mail, push, WhatsApp, AI).
 * Without one a hung provider keeps the request (and often a DB connection) open indefinitely.
 * OUTBOUND_TIMEOUT_MS overrides the default 10 s. A caller's own signal is honoured as well.
 */
export function outboundTimeoutMs(fallback = 10_000): number {
  const n = parseInt(process.env.OUTBOUND_TIMEOUT_MS || '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = outboundTimeoutMs(),
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

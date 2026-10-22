/**
 * Redaction for error details shown in the console: stack traces and request context can
 * carry secrets (tokens, passwords, connection strings) and server paths.
 */

const SENSITIVE_KEY = /password|passwd|secret|token|authori[sz]ation|cookie|api[-_]?key|signature|card_?number|^(pass|pin|otp|totp|cvv|session)$/i

const TEXT_RULES: Array<[RegExp, string]> = [
  // connection strings with credentials: postgres://user:pw@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi, '$1$2:[redacted]@'],
  // Authorization: Bearer xxx / Basic xxx
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]'],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]'],
  // key=value / "key": "value" pairs with sensitive names
  [/((?:pass(?:word)?|secret|token|api[-_]?key|apikey|session(?:token)?|authorization|cookie|otp)["']?\s*[:=]\s*["']?)([^"'\s,;&}]+)/gi, '$1[redacted]'],
  // long hex / base64-ish secrets (≥ 32 chars)
  [/\b[a-f0-9]{40,}\b/gi, '[redacted-hex]'],
  // absolute server paths → project-relative
  [/(?:\/[\w.-]+)+\/(?:retail-smart-erp-main|app|src)\//g, '…/'],
  [/[A-Z]:\\(?:[\w .-]+\\)+/g, '…\\'],
]

export function scrubText(input: string | null | undefined, maxLength = 20_000): string | null {
  if (input === null || input === undefined) return null
  let s = String(input)
  for (const [re, rep] of TEXT_RULES) s = s.replace(re, rep)
  return s.length > maxLength ? `${s.slice(0, maxLength)}\n… (truncated)` : s
}

/** Deep copy with sensitive keys replaced and string values scrubbed. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth > 6) return '[…]'
  if (typeof value === 'string') return scrubText(value, 2_000)
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && v !== null && v !== undefined && v !== '' ? '[redacted]' : scrubValue(v, depth + 1)
    }
    return out
  }
  return value
}

import { createHash } from 'crypto'

/**
 * Session tokens are stored as a SHA-256 hash ("h1$<hex>"), so a database leak cannot be
 * replayed as live admin / account sessions. The "sa_" prefix of bearer (mobile) admin tokens is
 * kept in front so the per-channel session rules still work.
 *
 * Rows written before hashing hold the raw token; they are still accepted until they expire
 * (admin: 15 min idle, account: 24 h). A presented token that itself looks like a stored hash is
 * refused, so a leaked hash can never be used as a token.
 */
const MARK = 'h1$'

export function hashSessionToken(token: string): string {
  const prefix = token.startsWith('sa_') ? 'sa_' : ''
  return `${prefix}${MARK}${createHash('sha256').update(token).digest('hex')}`
}

/** Stored values that match a presented token: its hash, plus the raw value for legacy rows. */
export function sessionTokenCandidates(token: string): string[] {
  if (!token || token.includes(MARK)) return []
  return [hashSessionToken(token), token]
}

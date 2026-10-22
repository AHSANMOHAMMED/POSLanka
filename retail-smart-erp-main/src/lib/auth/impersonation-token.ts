/**
 * Single-use "open as owner" links for the super-admin console.
 *
 * issue:   records a jti (admin_impersonation_tokens) and signs a 2-minute JWT carrying it.
 * consume: verifies the JWT, then marks the jti used in ONE conditional UPDATE
 *          (used_at IS NULL AND expires_at > now()), so a link opens a session at most once —
 *          even when two requests race with the same link.
 */
import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminImpersonationTokens } from '@/lib/db/schema'

export const IMPERSONATION_TTL_SECONDS = 120

export interface ImpersonationClaims {
  type: 'vendor-impersonate'
  tenantId: string
  adminId: string
  adminEmail?: string
  jti: string
}

export async function issueImpersonationToken(input: { tenantId: string; adminId: string; adminEmail?: string }): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET not configured')
  const jti = randomUUID()
  const now = Date.now()
  // Opportunistic clean-up of links that can no longer be used
  await db.delete(adminImpersonationTokens).where(lt(adminImpersonationTokens.expiresAt, new Date(now - 86_400_000))).catch(() => undefined)
  await db.insert(adminImpersonationTokens).values({
    jti,
    superAdminId: input.adminId,
    vendorId: input.tenantId,
    expiresAt: new Date(now + IMPERSONATION_TTL_SECONDS * 1000),
  })
  return jwt.sign(
    { type: 'vendor-impersonate', tenantId: input.tenantId, adminId: input.adminId, adminEmail: input.adminEmail },
    secret,
    { expiresIn: IMPERSONATION_TTL_SECONDS, jwtid: jti },
  )
}

/**
 * Verify and burn a link. Returns the claims the first time a valid, unexpired link is used;
 * null for a bad signature, an expired link, a token without a recorded jti, or a reused link.
 */
export async function consumeImpersonationToken(token: string, ip?: string): Promise<ImpersonationClaims | null> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return null
  let payload: jwt.JwtPayload & Partial<ImpersonationClaims>
  try {
    payload = jwt.verify(token, secret) as jwt.JwtPayload & Partial<ImpersonationClaims>
  } catch {
    return null
  }
  if (payload.type !== 'vendor-impersonate' || !payload.tenantId || !payload.adminId || !payload.jti) return null
  if (!/^[0-9a-f-]{36}$/i.test(payload.jti)) return null

  const burned = await db.update(adminImpersonationTokens)
    .set({ usedAt: new Date(), usedIp: ip ? ip.slice(0, 45) : null })
    .where(and(
      eq(adminImpersonationTokens.jti, payload.jti),
      eq(adminImpersonationTokens.vendorId, payload.tenantId),
      isNull(adminImpersonationTokens.usedAt),
      gt(adminImpersonationTokens.expiresAt, new Date()),
    ))
    .returning({ jti: adminImpersonationTokens.jti })
  if (burned.length !== 1) return null

  return {
    type: 'vendor-impersonate',
    tenantId: payload.tenantId,
    adminId: payload.adminId,
    adminEmail: payload.adminEmail,
    jti: payload.jti,
  }
}

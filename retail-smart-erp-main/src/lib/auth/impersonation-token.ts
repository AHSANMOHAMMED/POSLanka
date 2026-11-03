/**
 * Single-use "open as owner" links for the super-admin console.
 *
 * issue:   records a jti (admin_impersonation_tokens) and signs a 2-minute JWT carrying it.
 * consume: verifies the JWT *or* burns a bare jti, then marks the row used in ONE conditional UPDATE
 *          (used_at IS NULL AND expires_at > now()), so a link opens a session at most once —
 *          even when two requests race with the same link.
 *
 * Live-safe carriage: prefer the opaque jti in URLs/forms (`?c=<uuid>`). The JWT may still be
 * POSTed in the body for older clients, but must not appear in durable GET URLs / access logs.
 */
import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminImpersonationTokens, superAdmins } from '@/lib/db/schema'

export const IMPERSONATION_TTL_SECONDS = 120

export interface ImpersonationClaims {
  type: 'vendor-impersonate'
  tenantId: string
  adminId: string
  adminEmail?: string
  jti: string
}

export interface IssuedImpersonation {
  /** Short-lived JWT — prefer POST body only; do not put in GET URLs. */
  token: string
  /** Opaque single-use id safe to put in a short-lived redirect query (`c=`). */
  jti: string
}

const JTI_RE = /^[0-9a-f-]{36}$/i

export async function issueImpersonationToken(input: { tenantId: string; adminId: string; adminEmail?: string }): Promise<IssuedImpersonation> {
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
  const token = jwt.sign(
    { type: 'vendor-impersonate', tenantId: input.tenantId, adminId: input.adminId, adminEmail: input.adminEmail },
    secret,
    { expiresIn: IMPERSONATION_TTL_SECONDS, jwtid: jti },
  )
  return { token, jti }
}

async function burnJti(jti: string, tenantId: string | undefined, ip?: string): Promise<{ jti: string; vendorId: string; superAdminId: string | null } | null> {
  if (!JTI_RE.test(jti)) return null
  const burned = await db.update(adminImpersonationTokens)
    .set({ usedAt: new Date(), usedIp: ip ? ip.slice(0, 45) : null })
    .where(and(
      eq(adminImpersonationTokens.jti, jti),
      ...(tenantId ? [eq(adminImpersonationTokens.vendorId, tenantId)] : []),
      isNull(adminImpersonationTokens.usedAt),
      gt(adminImpersonationTokens.expiresAt, new Date()),
    ))
    .returning({
      jti: adminImpersonationTokens.jti,
      vendorId: adminImpersonationTokens.vendorId,
      superAdminId: adminImpersonationTokens.superAdminId,
    })
  if (burned.length !== 1) return null
  return burned[0]
}

/** Burn a bare jti (URL `c=` / form field) without requiring the JWT in the request. */
export async function consumeImpersonationByJti(jti: string, ip?: string): Promise<ImpersonationClaims | null> {
  const burned = await burnJti(jti, undefined, ip)
  if (!burned?.superAdminId) return null
  let adminEmail: string | undefined
  try {
    const admin = await db.query.superAdmins.findFirst({
      where: eq(superAdmins.id, burned.superAdminId),
      columns: { email: true },
    })
    adminEmail = admin?.email || undefined
  } catch {
    // email is optional for the session
  }
  return {
    type: 'vendor-impersonate',
    tenantId: burned.vendorId,
    adminId: burned.superAdminId,
    adminEmail,
    jti: burned.jti,
  }
}

/**
 * Verify and burn a link. Accepts either a JWT or a bare jti UUID.
 * Returns the claims the first time a valid, unexpired link is used;
 * null for a bad signature, an expired link, a token without a recorded jti, or a reused link.
 */
export async function consumeImpersonationToken(tokenOrJti: string, ip?: string): Promise<ImpersonationClaims | null> {
  const raw = (tokenOrJti || '').trim()
  if (!raw) return null
  // Opaque code path (preferred for URLs)
  if (JTI_RE.test(raw) && !raw.includes('.')) {
    return consumeImpersonationByJti(raw, ip)
  }

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return null
  let payload: jwt.JwtPayload & Partial<ImpersonationClaims>
  try {
    payload = jwt.verify(raw, secret) as jwt.JwtPayload & Partial<ImpersonationClaims>
  } catch {
    return null
  }
  if (payload.type !== 'vendor-impersonate' || !payload.tenantId || !payload.adminId || !payload.jti) return null
  if (!JTI_RE.test(payload.jti)) return null

  const burned = await burnJti(payload.jti, payload.tenantId, ip)
  if (!burned) return null

  return {
    type: 'vendor-impersonate',
    tenantId: payload.tenantId,
    adminId: payload.adminId,
    adminEmail: payload.adminEmail,
    jti: payload.jti,
  }
}

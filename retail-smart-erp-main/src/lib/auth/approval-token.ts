/**
 * H1 — supervisor approval tokens.
 *
 * POST /api/auth/verify-pin (scope 'supervisor') signs a short-lived token after a supervisor's
 * PIN was verified. The cashier's terminal sends it with the action that needs approval
 * (over-limit discount, rate change, credit-limit override, cash paid in / out, void of a cash
 * movement). The server verifies the HMAC, tenant, requesting user, scope and expiry, and records
 * the nonce in pos_approval_uses inside the action's transaction, so a token is spent exactly once
 * (a rolled-back action leaves it usable for a retry until it expires).
 *
 * Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload, NEXTAUTH_SECRET)).
 */
import crypto from 'crypto'
import { and, eq } from 'drizzle-orm'
import { posApprovalUses, users } from '@/lib/db/schema'
import { hasPermission } from '@/lib/auth/roles'

export const APPROVAL_SCOPES = [
  'discount',           // cart / line discount above the POS profile limit (or discounts disabled)
  'price_change',       // line sold below the catalog price on a profile without rate changes
  'credit_override',    // on-account sale beyond the customer's credit limit
  'cash_paid_out',      // cash taken out of the drawer
  'cash_paid_in',       // cash put into the drawer above the approval threshold
  'cash_movement_void', // reversing a cash movement of an open shift
] as const
export type ApprovalScope = typeof APPROVAL_SCOPES[number]

/** Tokens are short-lived: they cover the sale / movement the supervisor just looked at. */
export const APPROVAL_TOKEN_TTL_SECONDS = 10 * 60

export interface ApprovalTokenPayload {
  /** tenant */
  t: string
  /** approver (supervisor) user id */
  a: string
  /** requesting user (the cashier the approval was given to) */
  r: string
  /** approved scopes */
  s: ApprovalScope[]
  /** expiry, unix seconds */
  e: number
  /** single-use nonce */
  n: string
}

export interface VerifiedApproval {
  approverId: string
  scopes: ApprovalScope[]
  nonce: string
  expiresAt: number
  token: string
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_SECRET is required to sign approval tokens')
  return 'poslanka-dev-approval-secret'
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')

function sign(body: string): string {
  return crypto.createHmac('sha256', secret()).update(`pos-approval:${body}`).digest('base64url')
}

export function signApprovalToken(input: {
  tenantId: string
  approverId: string
  requesterId: string
  scopes: ApprovalScope[]
  ttlSeconds?: number
}): { token: string; nonce: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? APPROVAL_TOKEN_TTL_SECONDS)
  const nonce = crypto.randomBytes(16).toString('hex')
  const payload: ApprovalTokenPayload = {
    t: input.tenantId, a: input.approverId, r: input.requesterId,
    s: Array.from(new Set(input.scopes)), e: expiresAt, n: nonce,
  }
  const body = b64url(JSON.stringify(payload))
  return { token: `${body}.${sign(body)}`, nonce, expiresAt }
}

/** Signature, tenant, requester and expiry check (no database access). null = not valid. */
export function verifyApprovalToken(token: string, ctx: { tenantId: string; requesterId: string }): VerifiedApproval | null {
  if (typeof token !== 'string' || token.length > 2000) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expected = sign(body)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let payload: ApprovalTokenPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || payload.t !== ctx.tenantId || payload.r !== ctx.requesterId) return null
  if (typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return null
  if (!Array.isArray(payload.s) || typeof payload.n !== 'string' || typeof payload.a !== 'string') return null
  const scopes = payload.s.filter((s): s is ApprovalScope => (APPROVAL_SCOPES as readonly string[]).includes(s))
  return { approverId: payload.a, scopes, nonce: payload.n, expiresAt: payload.e, token }
}

/** Valid approvals among `tokens` (invalid / foreign / expired ones are dropped). */
export function verifyApprovalTokens(tokens: string[] | undefined | null, ctx: { tenantId: string; requesterId: string }): VerifiedApproval[] {
  const out: VerifiedApproval[] = []
  for (const t of tokens || []) {
    const v = verifyApprovalToken(t, ctx)
    if (v) out.push(v)
  }
  return out
}

/**
 * Pick, for each needed scope, a verified approval that covers it. Returns the approvals to spend
 * and the scopes nobody approved.
 */
export function coverScopes(needed: ApprovalScope[], approvals: VerifiedApproval[]): { used: VerifiedApproval[]; missing: ApprovalScope[] } {
  const used = new Map<string, VerifiedApproval>()
  const missing: ApprovalScope[] = []
  for (const scope of needed) {
    const already = [...used.values()].find((a) => a.scopes.includes(scope))
    if (already) continue
    const hit = approvals.find((a) => a.scopes.includes(scope))
    if (hit) used.set(hit.nonce, hit)
    else missing.push(scope)
  }
  return { used: [...used.values()], missing }
}

export class ApprovalError extends Error {
  constructor(public code: 'APPROVAL_REUSED' | 'APPROVER_INVALID', message: string) {
    super(message)
    this.name = 'ApprovalError'
  }
}

/**
 * Spend approvals inside the caller's transaction: the approver must still be an active user of
 * the tenant with manageSales, and each nonce is recorded once (a second use throws APPROVAL_REUSED).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function consumeApprovals(tx: any, ctx: {
  tenantId: string
  usedBy: string
  entityType: string
  entityId: string | null
  approvals: VerifiedApproval[]
  scopesFor?: (a: VerifiedApproval) => ApprovalScope[]
}): Promise<void> {
  for (const approval of ctx.approvals) {
    const [approver] = await tx.select({ id: users.id, role: users.role, customRoleId: users.customRoleId, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, approval.approverId), eq(users.tenantId, ctx.tenantId)))
      .limit(1)
    if (!approver || !approver.isActive || !hasPermission(approver.role, 'manageSales', ctx.tenantId, approver.customRoleId)) {
      throw new ApprovalError('APPROVER_INVALID', 'The approving supervisor is no longer allowed to approve this action')
    }
    const inserted = await tx.insert(posApprovalUses).values({
      tenantId: ctx.tenantId,
      nonce: approval.nonce,
      scopes: (ctx.scopesFor ? ctx.scopesFor(approval) : approval.scopes).join(','),
      approverId: approval.approverId,
      usedBy: ctx.usedBy,
      entityType: ctx.entityType,
      entityId: ctx.entityId,
    }).onConflictDoNothing({ target: [posApprovalUses.tenantId, posApprovalUses.nonce] })
      .returning({ id: posApprovalUses.id })
    if (!inserted.length) {
      throw new ApprovalError('APPROVAL_REUSED', 'This supervisor approval was already used. Ask the supervisor to approve again.')
    }
  }
}

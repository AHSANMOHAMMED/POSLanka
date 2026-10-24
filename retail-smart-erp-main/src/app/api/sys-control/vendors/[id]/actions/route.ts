import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { randomBytes, randomInt } from 'crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { accountTenants, pricingTiers, staffInvites, subscriptions, tenants, users } from '@/lib/db/schema'
import { adminAuthError, adminAudit, logAdminAction, requireAdminPermission, validateAdminSession, withRateLimit, STRICT_LIMIT, type AdminPermission } from '@/lib/admin'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { getNextPeriodDates } from '@/lib/billing/proration'
import { tierNameToPlan } from '@/lib/billing/activate-company'
import {
  NEVER_EXPIRES,
  isFreeTier,
  neverExpires,
  resumedSubscriptionStatus,
  syncTenantPlanExpiry,
} from '@/lib/billing/subscription-state'
import { revokeAllSessions } from '@/lib/auth/session-manager'
import { sendStaffInviteEmail } from '@/lib/email/system-email'
import { createOwnerResetLink, sendOwnerResetEmail, sendOwnerWelcomeEmail, type OwnerMailTarget } from '@/lib/admin/vendor-emails'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { isPlaceholderLogin } from '@/lib/users/generated-login'

/**
 * POST /api/sys-control/vendors/[id]/actions — vendor lifecycle actions for the super admin.
 * Every action needs the admin session, is rate limited and written to the admin audit log.
 *
 *   suspend           { reason }                         sign-in blocked (web + app), data kept
 *   reactivate        { reason?, extendDays? }           lifts a suspension, archive or billing lock
 *   extend            { days, reason }                   adds days to the trial or the paid period
 *   change_plan       { tierId, billingCycle?, reason }  moves the subscription to another tier (no charge)
 *   reset_password    { mode: 'email' | 'temporary' }    reset link to the owner, or a one-time password shown once
 *   resend_welcome    {}                                  owner invite (not yet accepted) or sign-in details
 *   archive           { reason, confirm }                 soft-archive: sign-in blocked, nothing deleted
 */
const reason = z.string().trim().min(3, 'Give a short reason (3+ characters)').max(500)

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('suspend'), reason }),
  z.object({ action: z.literal('reactivate'), reason: z.string().trim().max(500).optional(), extendDays: z.number().int().min(1).max(366).optional() }),
  z.object({ action: z.literal('extend'), days: z.number().int().min(1).max(366), reason }),
  // alias kept for clarity in API clients
  z.object({ action: z.literal('extend_trial'), days: z.number().int().min(1).max(366), reason }),
  z.object({ action: z.literal('change_plan'), tierId: z.string().uuid(), billingCycle: z.enum(['monthly', 'yearly']).optional(), reason }),
  z.object({ action: z.literal('reset_password'), mode: z.enum(['email', 'temporary']) }),
  z.object({ action: z.literal('resend_welcome') }),
  z.object({ action: z.literal('archive'), reason, confirm: z.string().trim() }),
])

type Action = z.infer<typeof actionSchema>

class ActionError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/**
 * Permission per action: lifecycle actions are vendor management (owner); extensions and plan
 * changes are billing (billing role or owner). Reactivating with extra days needs both.
 */
function actionPermissions(input: Action): AdminPermission[] {
  switch (input.action) {
    case 'extend':
    case 'extend_trial':
    case 'change_plan':
      return ['billing']
    case 'reactivate':
      return input.extendDays ? ['vendors.manage', 'billing'] : ['vendors.manage']
    default:
      return ['vendors.manage']
  }
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000)
}

/** Readable one-time password: 4 groups, no look-alike characters. */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')
  return `${group()}-${group()}-${group()}`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/actions', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    // Signed in at all here; the action's own permission is checked once the body is parsed
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const tenantId = p.data.id

    const parsed = await validateBody(request, actionSchema)
    if (!parsed.success) return parsed.response
    const input: Action = parsed.data
    const denied = requireAdminPermission(session, ...actionPermissions(input))
    if (denied) return denied

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.tenantId, tenantId) })

    const now = new Date()
    const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin
    const audit = (action: 'update' | 'extend' | 'delete', details: Record<string, unknown>) =>
      logAdminAction({
        accountId: session.superAdminId,
        action,
        resource: 'tenant',
        resourceId: tenantId,
        details: { op: input.action, tenantName: tenant.name, businessId: tenant.businessId, ...details },
      })

    switch (input.action) {
      /* ---------------------------------------------------------------- suspend */
      case 'suspend': {
        if (tenant.status === 'suspended') throw new ActionError('This vendor is already suspended.')
        if (tenant.status === 'cancelled') throw new ActionError('This vendor is archived. Reactivate it first.')
        await db.update(tenants)
          .set({ status: 'suspended', lockedAt: now, lockedReason: 'admin_suspended', deletionScheduledAt: null, updatedAt: now })
          .where(eq(tenants.id, tenantId))
        await audit('update', { reason: input.reason, before: { status: tenant.status }, after: { status: 'suspended' } })
        invalidatePermissionCache(tenantId) // staff sessions re-check (and fail) on their next request
        return NextResponse.json({ success: true, status: 'suspended', message: `${tenant.name} is suspended. Its staff cannot sign in.` })
      }

      /* ---------------------------------------------------------------- reactivate */
      case 'reactivate': {
        if (tenant.status === 'active') throw new ActionError('This vendor is already active.')
        let warning: string | undefined
        await db.transaction(async (tx) => {
          await tx.update(tenants)
            .set({ status: 'active', lockedAt: null, lockedReason: null, deletionScheduledAt: null, updatedAt: now })
            .where(eq(tenants.id, tenantId))
          if (sub) {
            const set: Partial<typeof subscriptions.$inferInsert> = { updatedAt: now }
            if (input.extendDays) {
              if (sub.trialEndsAt) set.trialEndsAt = addDays(new Date(Math.max(sub.trialEndsAt.getTime(), now.getTime())), input.extendDays)
              if (!neverExpires(sub)) {
                const base = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
                set.currentPeriodEnd = addDays(base, input.extendDays)
              }
            }
            if (sub.status === 'locked' || sub.status === 'cancelled' || input.extendDays) {
              set.status = resumedSubscriptionStatus({
                trialEndsAt: (set.trialEndsAt as Date | undefined) ?? sub.trialEndsAt,
                currentPeriodEnd: (set.currentPeriodEnd as Date | undefined) ?? sub.currentPeriodEnd,
              }, now)
              if (set.status === 'past_due') {
                warning = 'The subscription period has ended — the vendor will be locked again at the next billing check unless the period is extended or paid.'
              }
            }
            await tx.update(subscriptions).set(set).where(eq(subscriptions.id, sub.id))
          }
          await syncTenantPlanExpiry(tenantId, tx)
        })
        await audit('update', {
          reason: input.reason ?? null,
          extendDays: input.extendDays ?? null,
          before: { status: tenant.status, lockedReason: tenant.lockedReason, subscriptionStatus: sub?.status ?? null },
          after: { status: 'active' },
        })
        return NextResponse.json({ success: true, status: 'active', warning, message: `${tenant.name} is active again.` })
      }

      /* ---------------------------------------------------------------- extend */
      case 'extend':
      case 'extend_trial': {
        if (!sub) throw new ActionError('This vendor has no subscription.')
        if (neverExpires(sub)) throw new ActionError('This vendor is on the free plan, which does not expire.')
        if (tenant.status === 'suspended' || tenant.status === 'cancelled') {
          throw new ActionError('Reactivate the vendor before extending its subscription.')
        }
        const set: Partial<typeof subscriptions.$inferInsert> = { updatedAt: now }
        let before: Date | null
        let after: Date
        let kind: 'trial' | 'period'
        if (sub.trialEndsAt && (sub.status === 'trial' || tenant.lockedReason === 'trial_expired')) {
          kind = 'trial'
          before = sub.trialEndsAt
          after = addDays(new Date(Math.max(sub.trialEndsAt.getTime(), now.getTime())), input.days)
          set.trialEndsAt = after
          set.status = 'trial'
          if (!sub.currentPeriodEnd || sub.currentPeriodEnd < after) set.currentPeriodEnd = after
        } else {
          if (input.action === 'extend_trial') throw new ActionError('This vendor is not on a trial. Use “extend” to add days to the paid period.')
          kind = 'period'
          before = sub.currentPeriodEnd
          const base = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
          after = addDays(base, input.days)
          set.currentPeriodEnd = after
          if (sub.status === 'past_due' || sub.status === 'locked') set.status = 'active'
        }
        await db.transaction(async (tx) => {
          await tx.update(subscriptions).set(set).where(eq(subscriptions.id, sub.id))
          // A billing lock (trial or period ran out) is lifted by the extension
          await tx.update(tenants)
            .set({ status: 'active', lockedAt: null, lockedReason: null, deletionScheduledAt: null, updatedAt: now })
            .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'locked')))
          await syncTenantPlanExpiry(tenantId, tx)
        })
        await logAdminAction({
          accountId: session.superAdminId,
          action: 'extend',
          resource: 'subscription',
          resourceId: sub.id,
          details: { op: input.action, tenantId, tenantName: tenant.name, kind, days: input.days, reason: input.reason, before, after },
        })
        return NextResponse.json({
          success: true,
          kind,
          endsAt: after.toISOString(),
          message: `${kind === 'trial' ? 'Trial' : 'Subscription'} now ends ${after.toISOString().slice(0, 10)}.`,
        })
      }

      /* ---------------------------------------------------------------- change plan */
      case 'change_plan': {
        if (!sub) throw new ActionError('This vendor has no subscription.')
        const tier = await db.query.pricingTiers.findFirst({ where: eq(pricingTiers.id, input.tierId) })
        if (!tier) throw new ActionError('Plan not found.', 404)
        if (!tier.isActive) throw new ActionError('That plan is no longer offered.')
        const cycle = input.billingCycle ?? ((sub.billingCycle as 'monthly' | 'yearly' | null) || 'monthly')
        if (tier.id === sub.tierId && cycle === (sub.billingCycle || 'monthly')) throw new ActionError('The vendor is already on this plan.')

        const free = isFreeTier(tier)
        const set: Partial<typeof subscriptions.$inferInsert> = {
          tierId: tier.id,
          billingCycle: cycle,
          // The vendor pays the new tier's current price from here on
          subscribedPriceMonthly: tier.priceMonthly,
          subscribedPriceYearly: tier.priceYearly,
          priceLockedAt: now,
          updatedAt: now,
        }
        if (free) {
          set.status = 'trial'
          set.trialEndsAt = null
          set.currentPeriodEnd = NEVER_EXPIRES
        } else if (sub.status === 'trial' || neverExpires(sub)) {
          // Free/trial → paid: the admin grants one complimentary period; billing renews after it
          const { periodStart, periodEnd } = getNextPeriodDates(now, cycle)
          set.status = 'active'
          set.trialEndsAt = null
          set.currentPeriodStart = periodStart
          set.currentPeriodEnd = periodEnd
        }
        // paid → paid: the current period is kept as it is

        let seatWarning: string | undefined
        if (tier.maxUsers != null) {
          const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
          if ((c?.n ?? 0) > tier.maxUsers) {
            seatWarning = `The vendor has ${c.n} active users but ${tier.displayName} allows ${tier.maxUsers}. Existing users keep working; new users are blocked until some are deactivated.`
          }
        }

        await db.transaction(async (tx) => {
          await tx.update(subscriptions).set(set).where(eq(subscriptions.id, sub.id))
          await tx.update(tenants).set({ plan: tierNameToPlan(tier.name), updatedAt: now }).where(eq(tenants.id, tenantId))
          if (set.status) {
            await tx.update(tenants)
              .set({ status: 'active', lockedAt: null, lockedReason: null, deletionScheduledAt: null })
              .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'locked')))
          }
          await syncTenantPlanExpiry(tenantId, tx)
        })
        await adminAudit.update(session.superAdminId, 'subscription', sub.id, {
          op: 'change_plan',
          tenantId,
          tenantName: tenant.name,
          reason: input.reason,
          before: { tierId: sub.tierId, billingCycle: sub.billingCycle, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
          after: { tierId: tier.id, tier: tier.name, billingCycle: cycle, status: set.status ?? sub.status, currentPeriodEnd: set.currentPeriodEnd ?? sub.currentPeriodEnd },
        })
        return NextResponse.json({ success: true, tier: { id: tier.id, displayName: tier.displayName }, warning: seatWarning, message: `Plan changed to ${tier.displayName}.` })
      }

      /* ---------------------------------------------------------------- owner password */
      case 'reset_password': {
        const owner = await findOwner(tenantId)
        if (!owner) throw new ActionError('This vendor has no active owner user.')
        const target: OwnerMailTarget = {
          userId: owner.id, email: owner.email, fullName: owner.fullName,
          tenantId, tenantSlug: tenant.slug, tenantName: tenant.name, businessId: tenant.businessId,
        }
        if (input.mode === 'email') {
          if (isPlaceholderLogin(owner.email)) throw new ActionError('The owner has no email address (they sign in with a generated login). Set a temporary password instead.')
          const link = await createOwnerResetLink(target, baseUrl)
          try {
            await sendOwnerResetEmail(target, link)
          } catch (err) {
            logError('api/sys-control/vendors/actions reset-email', err)
            throw new ActionError('The reset email could not be sent. Check the email service, or set a temporary password instead.', 502)
          }
          await audit('update', { ownerUserId: owner.id, ownerEmail: owner.email, mode: 'email' })
          return NextResponse.json({ success: true, message: `A password reset link was emailed to ${owner.email}. It expires in 1 hour.` })
        }
        const password = temporaryPassword()
        const passwordHash = await bcrypt.hash(password, 12)
        await withTenant(tenantId, (tdb) =>
          tdb.update(users).set({ passwordHash, passwordChangedAt: now, updatedAt: now }).where(eq(users.id, owner.id))
        )
        // Signed-in sessions of the owner end (their token predates the password change)
        if (owner.accountId) {
          revokeAllSessions(owner.accountId, undefined, 'admin_password_reset').catch(() => undefined)
        }
        await audit('update', { ownerUserId: owner.id, ownerEmail: owner.email, mode: 'temporary' })
        return NextResponse.json({
          success: true,
          temporaryPassword: password,
          email: owner.email,
          message: 'Share this password with the owner securely. It is shown only once; ask them to change it after signing in.',
        })
      }

      /* ---------------------------------------------------------------- welcome / invite */
      case 'resend_welcome': {
        const owner = await findOwner(tenantId)
        if (!owner) throw new ActionError('This vendor has no active owner user.')
        if (isPlaceholderLogin(owner.email)) throw new ActionError('The owner has no email address to send to. Set a temporary password and share it with them instead.')
        const membership = owner.accountId
          ? await db.query.accountTenants.findFirst({
              where: and(eq(accountTenants.tenantId, tenantId), eq(accountTenants.accountId, owner.accountId)),
              columns: { acceptedAt: true },
            })
          : null
        const pendingInvite = !owner.lastLoginAt && membership && !membership.acceptedAt
        try {
          if (pendingInvite) {
            // Replace any unaccepted invite for this owner and business with a fresh 7-day link
            await db.delete(staffInvites).where(and(
              eq(staffInvites.email, owner.email),
              isNull(staffInvites.acceptedAt),
              sql`${staffInvites.tenantAssignments} @> ${JSON.stringify([{ tenantId }])}::jsonb`,
            ))
            const token = randomBytes(32).toString('hex')
            await db.insert(staffInvites).values({
              email: owner.email,
              token,
              tenantAssignments: [{ tenantId, role: 'owner' }],
              invitedBy: null,
              expiresAt: addDays(now, 7),
            })
            await sendStaffInviteEmail({
              email: owner.email,
              inviterName: 'skyERPOS Platform Team',
              companyName: tenant.name,
              role: 'owner',
              inviteUrl: `${baseUrl}/invite/${token}`,
            })
          } else {
            await sendOwnerWelcomeEmail({
              userId: owner.id, email: owner.email, fullName: owner.fullName,
              tenantId, tenantSlug: tenant.slug, tenantName: tenant.name, businessId: tenant.businessId,
            }, baseUrl)
          }
        } catch (err) {
          logError('api/sys-control/vendors/actions welcome-email', err)
          throw new ActionError('The email could not be sent. Check the email service and try again.', 502)
        }
        await audit('update', { ownerEmail: owner.email, kind: pendingInvite ? 'invite' : 'sign_in_details' })
        return NextResponse.json({
          success: true,
          kind: pendingInvite ? 'invite' : 'sign_in_details',
          message: pendingInvite ? `A new invitation was emailed to ${owner.email}.` : `Sign-in details were emailed to ${owner.email}.`,
        })
      }

      /* ---------------------------------------------------------------- archive */
      case 'archive': {
        if (tenant.status === 'cancelled') throw new ActionError('This vendor is already archived.')
        const norm = (v: string) => v.toLowerCase().replace(/[\s-]/g, '')
        if (![tenant.slug, tenant.businessId].map(norm).includes(norm(input.confirm))) {
          throw new ActionError('Type the Business ID or web address exactly to confirm.')
        }
        // Soft archive: sign-in blocked, all business and billing records kept; the
        // automatic deletion of billing-locked companies never applies to archived ones.
        await db.update(tenants)
          .set({ status: 'cancelled', lockedAt: now, lockedReason: 'admin_archived', deletionScheduledAt: null, updatedAt: now })
          .where(eq(tenants.id, tenantId))
        invalidatePermissionCache(tenantId)
        await audit('delete', { reason: input.reason, soft: true, before: { status: tenant.status }, after: { status: 'cancelled' } })
        return NextResponse.json({ success: true, status: 'cancelled', message: `${tenant.name} is archived. Nothing was deleted; reactivate it at any time.` })
      }
    }
  } catch (error) {
    if (error instanceof ActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logError('api/sys-control/vendors/[id]/actions', error)
    return NextResponse.json({ error: 'The action failed. Nothing was changed.' }, { status: 500 })
  }
}

async function findOwner(tenantId: string) {
  return db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.role, 'owner'), eq(users.isActive, true)),
    columns: { id: true, email: true, fullName: true, accountId: true, lastLoginAt: true },
    orderBy: (u, { asc }) => [asc(u.createdAt)],
  })
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { staffInvites, tenants, accounts, users, accountTenants, warehouses, posProfiles, customRoles } from '@/lib/db/schema'
import { eq, and, isNull, gt, sql, inArray } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { logError } from '@/lib/ai/error-logger'
import { validatePasswordStrength } from '@/lib/utils/validation'
import { validateBody } from '@/lib/validation'
import { acceptInviteSchema } from '@/lib/validation/schemas/auth'
import { addUserWarehouses, replaceUserPosProfiles } from '@/lib/users/create-staff'
import { getUserLimit } from '@/lib/billing/user-limit'
import { consumeRateLimit, clientIp } from '@/lib/auth/rate-limit'

type InviteAssignment = {
  tenantId: string
  role: string
  /** Custom role chosen by the inviter (its base role is `role`) */
  customRoleId?: string
  warehouseIds?: string[]
  posProfileIds?: string[]
}

/**
 * Custom role from the invite, if it still exists, is active and still has the invited base role;
 * otherwise the person joins with the plain built-in role. Runs with the tenant RLS context set.
 */
async function inviteCustomRoleId(
  tx: { select: typeof db.select },
  assignment: InviteAssignment,
): Promise<string | null> {
  if (!assignment.customRoleId) return null
  const [cr] = await tx.select({ id: customRoles.id, baseRole: customRoles.baseRole, isActive: customRoles.isActive })
    .from(customRoles)
    .where(and(eq(customRoles.id, assignment.customRoleId), eq(customRoles.tenantId, assignment.tenantId)))
    .limit(1)
  return cr && cr.isActive && cr.baseRole === assignment.role ? cr.id : null
}

/**
 * Apply the branch/counter assignments stored on the invite to a newly created user.
 * Ids were validated against the tenant when the invite was issued; rows that no longer
 * exist are skipped so a deleted counter cannot block the invite.
 */
async function applyInviteAssignments(
  tx: Parameters<typeof addUserWarehouses>[0],
  assignment: InviteAssignment,
  userId: string,
) {
  const whIds = Array.isArray(assignment.warehouseIds) ? assignment.warehouseIds : []
  const ppIds = Array.isArray(assignment.posProfileIds) ? assignment.posProfileIds : []
  if (whIds.length > 0) {
    const live = await tx.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.tenantId, assignment.tenantId), inArray(warehouses.id, whIds)))
    await addUserWarehouses(tx, assignment.tenantId, userId, live.map(w => w.id))
  }
  if (ppIds.length > 0) {
    const live = await tx.select({ id: posProfiles.id }).from(posProfiles)
      .where(and(eq(posProfiles.tenantId, assignment.tenantId), inArray(posProfiles.id, ppIds)))
    await replaceUserPosProfiles(tx, assignment.tenantId, userId, live.map(p => p.id))
  }
}

class InviteError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

/** Mark the invite accepted only if it is still pending and unexpired; otherwise abort. */
async function claimInvite(tx: Parameters<typeof addUserWarehouses>[0], inviteId: string) {
  const claimed = await tx.update(staffInvites)
    .set({ acceptedAt: new Date() })
    .where(and(
      eq(staffInvites.id, inviteId),
      isNull(staffInvites.acceptedAt),
      gt(staffInvites.expiresAt, new Date()),
    ))
    .returning({ id: staffInvites.id })
  if (claimed.length === 0) throw new InviteError('This invite has already been used or has expired', 400)
}

/** Plan seat limit for the company the invite adds the user to. */
async function assertSeat(tenantId: string) {
  const { maxUsers, activeUsers } = await getUserLimit(tenantId)
  if (maxUsers !== null && activeUsers + 1 > maxUsers) {
    throw new InviteError('This company has reached its plan user limit. Ask the owner to upgrade the plan.', 402)
  }
}

// Accept attempts: 5 per minute per client IP (database-backed, shared by all instances)
const INVITE_ACCEPT_RATE_LIMIT = { maxAttempts: 5, windowMs: 60 * 1000, category: 'invite_accept' }

// POST /api/invites/[token]/accept - Accept invite
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Rate limiting by client IP to prevent brute force
    if ((await consumeRateLimit(clientIp(request), INVITE_ACCEPT_RATE_LIMIT)).limited) {
      return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
    }

    const parsed = await validateBody(request, acceptInviteSchema)
    if (!parsed.success) return parsed.response

    const { fullName, password } = parsed.data

    // Find invite
    const invite = await db.query.staffInvites.findFirst({
      where: and(
        eq(staffInvites.token, token),
        isNull(staffInvites.acceptedAt),
        gt(staffInvites.expiresAt, new Date())
      ),
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
    }

    // Check if invitee already has an account
    const existingAccount = await db.query.accounts.findFirst({
      where: eq(accounts.email, invite.email),
    })

    // Create memberships and user records
    const assignments = invite.tenantAssignments as InviteAssignment[]

    if (existingAccount) {
      // Existing account flow: create user + accountTenants (original behavior)
      await db.transaction(async (tx) => {
        // Claim the invite atomically: a double-click / two tabs must not both create users
        await claimInvite(tx, invite.id)
        for (const assignment of assignments) {
          // Set tenant context for RLS
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${assignment.tenantId}, true)`)
          const customRoleId = await inviteCustomRoleId(tx, assignment)

          // Create user record for this tenant
          const existingUser = await tx.query.users.findFirst({
            where: and(
              eq(users.email, existingAccount.email),
              eq(users.tenantId, assignment.tenantId)
            ),
          })

          if (existingUser) {
            if (!existingUser.isActive) {
              await assertSeat(assignment.tenantId)
              await tx.update(users)
                .set({
                  isActive: true,
                  role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
                  customRoleId,
                })
                .where(eq(users.id, existingUser.id))
            }
          } else {
            await assertSeat(assignment.tenantId)
            const [created] = await tx.insert(users).values({
              tenantId: assignment.tenantId,
              accountId: existingAccount.id,
              email: existingAccount.email,
              passwordHash: existingAccount.passwordHash,
              fullName: existingAccount.fullName,
              role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
              customRoleId,
              isActive: true,
            }).returning({ id: users.id })
            await applyInviteAssignments(tx, assignment, created.id)
          }

          // Create or reactivate account-tenant membership
          const existingMembership = await tx.query.accountTenants.findFirst({
            where: and(
              eq(accountTenants.accountId, existingAccount.id),
              eq(accountTenants.tenantId, assignment.tenantId)
            ),
          })

          if (existingMembership) {
            if (!existingMembership.isActive) {
              await tx.update(accountTenants)
                .set({
                  isActive: true,
                  role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
                  customRoleId,
                  acceptedAt: new Date(),
                })
                .where(eq(accountTenants.id, existingMembership.id))
            }
          } else {
            await tx.insert(accountTenants).values({
              accountId: existingAccount.id,
              tenantId: assignment.tenantId,
              role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
              customRoleId,
              isOwner: false,
              isActive: true,
              invitedBy: invite.invitedBy,
              acceptedAt: new Date(),
            })
          }
        }

        // Mark invite as accepted
        await tx.update(staffInvites)
          .set({ acceptedAt: new Date() })
          .where(eq(staffInvites.id, invite.id))
      })
    } else {
      // No account exists — create users directly without account/accountTenants
      if (!fullName || !password) {
        return NextResponse.json({
          error: 'Full name and password are required for new staff members',
        }, { status: 400 })
      }

      const passwordError = validatePasswordStrength(password)
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 })
      }

      const passwordHash = await bcrypt.hash(password, 12)

      await db.transaction(async (tx) => {
        // Claim the invite atomically: a double-click / two tabs must not both create users
        await claimInvite(tx, invite.id)
        for (const assignment of assignments) {
          // Set tenant context for RLS
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${assignment.tenantId}, true)`)
          const customRoleId = await inviteCustomRoleId(tx, assignment)

          // Check if user already exists for this tenant
          const existingUser = await tx.query.users.findFirst({
            where: and(
              eq(users.email, invite.email),
              eq(users.tenantId, assignment.tenantId)
            ),
          })

          if (existingUser) {
            if (!existingUser.isActive) {
              await assertSeat(assignment.tenantId)
              await tx.update(users)
                .set({
                  isActive: true,
                  passwordHash,
                  fullName: fullName.trim(),
                  role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
                  customRoleId,
                })
                .where(eq(users.id, existingUser.id))
            }
          } else {
            // Create user directly — no account, no accountTenants
            await assertSeat(assignment.tenantId)
            const [created] = await tx.insert(users).values({
              tenantId: assignment.tenantId,
              accountId: null,
              email: invite.email,
              passwordHash,
              fullName: fullName.trim(),
              role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
              customRoleId,
              isActive: true,
              passwordChangedAt: new Date(),
            }).returning({ id: users.id })
            await applyInviteAssignments(tx, assignment, created.id)
          }
        }

        // Mark invite as accepted
        await tx.update(staffInvites)
          .set({ acceptedAt: new Date() })
          .where(eq(staffInvites.id, invite.id))
      })
    }

    // Get tenant names for response
    const tenantDetails = await Promise.all(
      assignments.map(async (a) => {
        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.id, a.tenantId),
        })
        return {
          tenantId: a.tenantId,
          tenantName: tenant?.name || 'Unknown',
          tenantSlug: tenant?.slug,
          role: a.role,
        }
      })
    )

    return NextResponse.json({
      success: true,
      message: 'Invite accepted successfully',
      email: invite.email,
      companies: tenantDetails,
    })
  } catch (error) {
    if (error instanceof InviteError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logError('api/invites/[token]/accept', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

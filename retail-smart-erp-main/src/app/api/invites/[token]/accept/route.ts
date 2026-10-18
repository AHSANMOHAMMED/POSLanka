import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { staffInvites, tenants, accounts, users, accountTenants } from '@/lib/db/schema'
import { eq, and, isNull, gt, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { logError } from '@/lib/ai/error-logger'
import { validatePasswordStrength } from '@/lib/utils/validation'
import { validateBody } from '@/lib/validation'
import { acceptInviteSchema } from '@/lib/validation/schemas/auth'

// Rate limiting map for accept attempts
const rateLimitMap = new Map<string, { count: number; firstRequest: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 5 // Max 5 attempts per minute per token
let acceptLastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// POST /api/invites/[token]/accept - Accept invite
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Periodically clean expired entries to prevent memory leaks
    const now = Date.now()
    if (now - acceptLastCleanup > CLEANUP_INTERVAL) {
      acceptLastCleanup = now
      for (const [key, entry] of rateLimitMap) {
        if (now - entry.firstRequest > RATE_LIMIT_WINDOW) rateLimitMap.delete(key)
      }
    }

    // Rate limiting by token to prevent brute force
    const rateLimitKey = `accept:${token.substring(0, 8)}`
    const rateLimit = rateLimitMap.get(rateLimitKey)

    if (rateLimit) {
      if (now - rateLimit.firstRequest < RATE_LIMIT_WINDOW) {
        if (rateLimit.count >= RATE_LIMIT_MAX) {
          return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
        }
        rateLimit.count++
      } else {
        rateLimitMap.set(rateLimitKey, { count: 1, firstRequest: now })
      }
    } else {
      rateLimitMap.set(rateLimitKey, { count: 1, firstRequest: now })
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
    const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>

    if (existingAccount) {
      // Existing account flow: create user + accountTenants (original behavior)
      await db.transaction(async (tx) => {
        for (const assignment of assignments) {
          // Set tenant context for RLS
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${assignment.tenantId}, true)`)

          // Create user record for this tenant
          const existingUser = await tx.query.users.findFirst({
            where: and(
              eq(users.email, existingAccount.email),
              eq(users.tenantId, assignment.tenantId)
            ),
          })

          if (existingUser) {
            if (!existingUser.isActive) {
              await tx.update(users)
                .set({
                  isActive: true,
                  role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
                })
                .where(eq(users.id, existingUser.id))
            }
          } else {
            await tx.insert(users).values({
              tenantId: assignment.tenantId,
              accountId: existingAccount.id,
              email: existingAccount.email,
              passwordHash: existingAccount.passwordHash,
              fullName: existingAccount.fullName,
              role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
              isActive: true,
            })
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
                  acceptedAt: new Date(),
                })
                .where(eq(accountTenants.id, existingMembership.id))
            }
          } else {
            await tx.insert(accountTenants).values({
              accountId: existingAccount.id,
              tenantId: assignment.tenantId,
              role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
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
        for (const assignment of assignments) {
          // Set tenant context for RLS
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${assignment.tenantId}, true)`)

          // Check if user already exists for this tenant
          const existingUser = await tx.query.users.findFirst({
            where: and(
              eq(users.email, invite.email),
              eq(users.tenantId, assignment.tenantId)
            ),
          })

          if (existingUser) {
            if (!existingUser.isActive) {
              await tx.update(users)
                .set({
                  isActive: true,
                  passwordHash,
                  fullName: fullName.trim(),
                  role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
                })
                .where(eq(users.id, existingUser.id))
            }
          } else {
            // Create user directly — no account, no accountTenants
            await tx.insert(users).values({
              tenantId: assignment.tenantId,
              accountId: null,
              email: invite.email,
              passwordHash,
              fullName: fullName.trim(),
              role: assignment.role as 'owner' | 'manager' | 'cashier' | 'technician',
              isActive: true,
            })
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
    logError('api/invites/[token]/accept', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { db } from '@/lib/db'
import { users, userWarehouses, warehouses, accounts, staffInvites, tenants } from '@/lib/db/schema'
import { eq, and, inArray, isNull, gt } from 'drizzle-orm'
import { requirePermission, canModifyUser } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { sendStaffInviteEmail } from '@/lib/email/system-email'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { createInviteSchema } from '@/lib/validation/schemas/users'

// GET all users for the tenant with optional role filter
// Query params:
// - role: Filter by specific role (owner, manager, cashier, technician)
// - activeOnly: Set to 'true' to only return active users (for dropdowns)
// - includeWarehouses: Set to 'true' to include warehouse assignments
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const roleFilter = searchParams.get('role')
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const includeWarehouses = searchParams.get('includeWarehouses') === 'true'

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build conditions (tenantId filter handled by RLS)
      const conditions = []
      if (roleFilter) {
        conditions.push(eq(users.role, roleFilter as 'owner' | 'manager' | 'cashier' | 'technician'))
      }
      if (activeOnly) {
        conditions.push(eq(users.isActive, true))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const result = await db.query.users.findMany({
        where: whereClause,
        orderBy: (users, { asc }) => [asc(users.fullName)],
        columns: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          // Exclude passwordHash for security
        },
      })

      // Include warehouse assignments if requested (RLS scopes the query)
      if (includeWarehouses && result.length > 0) {
        const userIds = result.map(u => u.id)
        const warehouseAssignments = await db
          .select({
            userId: userWarehouses.userId,
            warehouseId: userWarehouses.warehouseId,
            warehouseName: warehouses.name,
            warehouseCode: warehouses.code,
            isDefault: warehouses.isDefault,
          })
          .from(userWarehouses)
          .innerJoin(warehouses, eq(userWarehouses.warehouseId, warehouses.id))
          .where(
            and(
              eq(userWarehouses.isActive, true),
              inArray(userWarehouses.userId, userIds)
            )
          )

        // Group by user
        const assignmentsByUser = new Map<string, Array<{ warehouseId: string; warehouse: { id: string; name: string; code: string; isDefault: boolean } }>>()
        for (const a of warehouseAssignments) {
          if (!assignmentsByUser.has(a.userId)) {
            assignmentsByUser.set(a.userId, [])
          }
          assignmentsByUser.get(a.userId)!.push({
            warehouseId: a.warehouseId,
            warehouse: {
              id: a.warehouseId,
              name: a.warehouseName,
              code: a.warehouseCode,
              isDefault: a.isDefault,
            },
          })
        }

        // Add to results
        const resultWithWarehouses = result.map(user => ({
          ...user,
          warehouses: assignmentsByUser.get(user.id) || [],
        }))

        return NextResponse.json(resultWithWarehouses)
      }

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/users', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

// POST create new user or send invite
// Only requires email + role. If the person has an account, adds them immediately.
// If not, creates a staff invite and sends an email.
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createInviteSchema)
    if (!parsed.success) return parsed.response
    const { email, role, warehouseIds } = parsed.data

    // email is already normalized (lowercased + trimmed) by Zod emailSchema
    const normalizedEmail = email

    // Business rule: 'owner' cannot be created via POS, only through account dashboard
    if (role === 'owner') {
      return NextResponse.json({ error: 'Invalid role. Owner role can only be assigned through account management.' }, { status: 400 })
    }

    // Role hierarchy: cannot create users at or above your own level
    if (!canModifyUser(session.user.role, role, role)) {
      return NextResponse.json({ error: 'You cannot create users with this role' }, { status: 403 })
    }

    // Check if email already exists as a user in this tenant (RLS scopes the query)
    const existingUser = await withTenant(session.user.tenantId, async (tenantDb) => {
      return tenantDb.query.users.findFirst({
        where: eq(users.email, normalizedEmail),
      })
    })

    if (existingUser) {
      return NextResponse.json({ error: 'A user with this email already exists in this company' }, { status: 400 })
    }

    // Check if a global account exists for this email (accounts table has no RLS)
    const existingAccount = await db.query.accounts.findFirst({
      where: eq(accounts.email, normalizedEmail),
    })

    if (existingAccount) {
      // Account exists — add them immediately
      const newUser = await withTenant(session.user.tenantId, async (tenantDb) => {
        return tenantDb.transaction(async (tx) => {
          const [user] = await tx.insert(users).values({
            tenantId: session.user.tenantId,
            accountId: existingAccount.id,
            email: normalizedEmail,
            fullName: existingAccount.fullName || normalizedEmail,
            passwordHash: existingAccount.passwordHash || '',
            role: role as 'owner' | 'manager' | 'cashier' | 'technician',
            isActive: true,
          }).returning({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            isActive: users.isActive,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })

          // Assign warehouses if provided
          if (Array.isArray(warehouseIds) && warehouseIds.length > 0) {
            await tx.insert(userWarehouses).values(
              warehouseIds.map((warehouseId: string) => ({
                tenantId: session.user.tenantId,
                userId: user.id,
                warehouseId,
                isActive: true,
              }))
            )
          }

          return user
        })
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'user', 'created', newUser.id)

      return NextResponse.json({ mode: 'added', user: newUser })
    }

    // No account exists — send invite
    // Check for existing pending invite to the same email for this tenant
    const existingInvite = await db.query.staffInvites.findFirst({
      where: and(
        eq(staffInvites.email, normalizedEmail),
        isNull(staffInvites.acceptedAt),
        gt(staffInvites.expiresAt, new Date())
      ),
    })

    if (existingInvite) {
      // Check if this invite already includes the current tenant
      const assignments = existingInvite.tenantAssignments as Array<{ tenantId: string; role: string }>
      const alreadyInvited = assignments.some(a => a.tenantId === session.user.tenantId)
      if (alreadyInvited) {
        return NextResponse.json({ error: 'An invitation has already been sent to this email' }, { status: 400 })
      }
    }

    // Get tenant name for the email
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, session.user.tenantId),
    })

    // Generate invite token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const [invite] = await db.insert(staffInvites).values({
      email: normalizedEmail,
      token,
      tenantAssignments: [{ tenantId: session.user.tenantId, role }],
      invitedBy: session.user.accountId,
      expiresAt,
    }).returning()

    // Send invite email
    const inviteUrl = `${process.env.NEXTAUTH_URL || ''}/invite/${token}`
    try {
      await sendStaffInviteEmail({
        email: normalizedEmail,
        inviterName: session.user.name || 'A team member',
        companyName: tenant?.name || session.user.tenantName || 'the company',
        role,
        inviteUrl,
      })
    } catch (emailError) {
      logError('api/users', emailError)
      // Don't fail the request — invite is created, email may not have sent
    }

    return NextResponse.json({
      mode: 'invited',
      invite: {
        id: invite.id,
        email: invite.email,
        role,
        expiresAt: invite.expiresAt,
        inviteUrl,
      },
    })
  } catch (error) {
    logError('api/users', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

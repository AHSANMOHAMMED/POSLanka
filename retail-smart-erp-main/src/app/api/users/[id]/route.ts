import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { users, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { requirePermission, canModifyUser, rolePermissionsNotHeld } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { validatePasswordStrength } from '@/lib/utils/validation'
import { validateBody } from '@/lib/validation'
import { updateUserSchema } from '@/lib/validation/schemas/users'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { isUniqueViolation } from '@/lib/db/errors'
import { requireUserSeat } from '@/lib/billing/user-limit'
import { loadAssignableCustomRole, StaffError } from '@/lib/users/create-staff'
import { getCustomRoleName } from '@/lib/auth/permission-cache'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'

// GET single user by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
        columns: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          customRoleId: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      return NextResponse.json({
        ...user,
        customRoleName: user.customRoleId ? getCustomRoleName(session.user.tenantId, user.customRoleId) ?? null : null,
      })
    })
  } catch (error) {
    logError('api/users/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }
}

// PUT update user
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateUserSchema)
    if (!parsed.success) return parsed.response
    const { fullName, email, role, isActive, password, pin, customRoleId, expectedUpdatedAt } = parsed.data

    // Execute with RLS tenant context
    const response = await withTenant(session.user.tenantId, async (db) => {
      // Use transaction with FOR UPDATE lock for optimistic locking
      const result = await db.transaction(async (tx) => {
        // Get current user with lock (RLS scopes the query)
        const [current] = await tx.select().from(users)
          .where(eq(users.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Check for concurrent modification (optimistic locking)
        if (expectedUpdatedAt) {
          const clientTime = new Date(expectedUpdatedAt).getTime()
          const serverTime = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
          if (serverTime > clientTime) {
            throw new Error('CONFLICT')
          }
        }

        // Resulting built-in role + custom role. Picking a built-in role (without customRoleId)
        // leaves any custom role; picking a custom role sets the role to its base role.
        const currentCustomRoleId = current.customRoleId ?? null
        let newCustomRoleId: string | null =
          customRoleId !== undefined ? customRoleId
            : role !== undefined && role !== current.role ? null
              : currentCustomRoleId
        let newRole: string = role ?? current.role
        if (newCustomRoleId && newCustomRoleId !== currentCustomRoleId) {
          const cr = await loadAssignableCustomRole(tx, newCustomRoleId)
          newRole = cr.baseRole
        } else if (newCustomRoleId && role !== undefined && role !== current.role) {
          // Explicit built-in role change while keeping the same custom role is contradictory
          newCustomRoleId = null
        }
        const roleChanged = newRole !== current.role || newCustomRoleId !== currentCustomRoleId

        // The business owner can't be demoted, given a custom role or locked out from here
        // (ownership moves only through account management).
        if (current.role === 'owner' && (roleChanged || isActive === false)) {
          throw new Error('OWNER_PROTECTED')
        }

        // Prevent modifying own role or isActive status
        if (current.id === session.user.id) {
          if (roleChanged) {
            throw new Error('CANNOT_MODIFY_OWN_ROLE')
          }
          if (isActive !== undefined && isActive !== current.isActive) {
            throw new Error('CANNOT_MODIFY_OWN_STATUS')
          }
        }

        // Owner role is granted only through account management (same rule as POST /api/users):
        // nobody — not even an owner — can promote staff to owner from here.
        if (newRole === 'owner' && current.role !== 'owner') {
          throw new Error('CANNOT_ASSIGN_OWNER')
        }

        // Plan seat limit when re-activating a deactivated user
        if (isActive === true && !current.isActive) {
          const seatError = await requireUserSeat(session.user.tenantId)
          if (seatError) throw new Error('USER_LIMIT')
        }

        // Cannot assign a role (built-in or custom) that holds permissions the actor lacks
        if (roleChanged &&
            rolePermissionsNotHeld(session.user.role, newRole, session.user.tenantId, session.user.customRoleId, newCustomRoleId).length > 0) {
          throw new Error('INSUFFICIENT_RANK')
        }
        // ...nor take over / switch off such a user (credentials, status or role)
        if (current.id !== session.user.id && (roleChanged || isActive !== undefined || password || pin !== undefined || (email && email !== current.email)) &&
            rolePermissionsNotHeld(session.user.role, current.role, session.user.tenantId, session.user.customRoleId, currentCustomRoleId).length > 0) {
          throw new Error('INSUFFICIENT_RANK')
        }

        // Role hierarchy: cannot modify users at or above your rank
        // Owners are protected — only another owner can modify an owner
        if (!canModifyUser(session.user.role, current.role, roleChanged ? newRole : undefined)) {
          throw new Error('INSUFFICIENT_RANK')
        }

        // If email is changed, check uniqueness (RLS scopes the query)
        if (email && email !== current.email) {
          const existingUser = await tx.query.users.findFirst({
            where: eq(users.email, email),
          })

          if (existingUser && existingUser.id !== id) {
            throw new Error('EMAIL_EXISTS')
          }
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (fullName !== undefined) updateData.fullName = fullName
        if (email !== undefined) updateData.email = email
        if (roleChanged) {
          updateData.role = newRole
          updateData.customRoleId = newCustomRoleId
        }
        if (isActive !== undefined) updateData.isActive = isActive

        // Hash new password if provided
        if (password) {
          const passwordError = validatePasswordStrength(password)
          if (passwordError) {
            throw new Error('INVALID_PASSWORD')
          }
          updateData.passwordHash = await bcrypt.hash(password, 12)
          // Sign the user out everywhere (JWT check rejects tokens issued before this)
          updateData.passwordChangedAt = new Date()
        }

        // POS PIN: hash on save, empty string clears
        if (pin !== undefined) {
          updateData.pinHash = pin === '' ? null : await bcrypt.hash(pin, 12)
        }

        // Update user
        const [updated] = await tx.update(users)
          .set(updateData)
          .where(eq(users.id, id))
          .returning({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            customRoleId: users.customRoleId,
            isActive: users.isActive,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })

        // Sync isActive / role to accountTenants (the account-portal membership) so the
        // portal cannot hand back a role or access the owner just removed.
        if ((isActive !== undefined || roleChanged) && current.accountId) {
          const memberUpdate: Record<string, unknown> = { updatedAt: new Date() }
          if (isActive !== undefined) memberUpdate.isActive = isActive
          if (roleChanged) {
            memberUpdate.role = newRole
            memberUpdate.customRoleId = newCustomRoleId
          }
          await tx.update(accountTenants)
            .set(memberUpdate)
            .where(and(
              eq(accountTenants.accountId, current.accountId),
              eq(accountTenants.tenantId, session.user.tenantId)
            ))
        }

        return updated
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'user', 'updated', id)

      return NextResponse.json(result)
    })
    // Committed: status/role/password changes must not ride on a cached session check
    if (response.ok) invalidatePermissionCache(session.user.tenantId)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    logError('api/users/[id]', error)

    if (error instanceof StaffError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (message === 'OWNER_PROTECTED') {
      return NextResponse.json({ error: 'The business owner cannot be demoted or deactivated here. Ownership changes go through account management.' }, { status: 400 })
    }
    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This user was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message === 'CANNOT_MODIFY_OWN_ROLE') {
      return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 })
    }
    if (message === 'CANNOT_MODIFY_OWN_STATUS') {
      return NextResponse.json({ error: 'You cannot change your own status' }, { status: 400 })
    }
    if (message === 'CANNOT_ASSIGN_OWNER') {
      return NextResponse.json({ error: 'Owner role can only be assigned through account management.' }, { status: 400 })
    }
    if (message === 'USER_LIMIT') {
      return NextResponse.json({ error: 'Your plan user limit has been reached. Upgrade your plan or deactivate a user first.', code: 'USER_LIMIT' }, { status: 402 })
    }
    if (message === 'INSUFFICIENT_RANK') {
      return NextResponse.json({ error: 'You do not have permission to modify this user' }, { status: 403 })
    }
    if (message === 'EMAIL_EXISTS' || isUniqueViolation(error, 'users_tenant_email_active_unique')) {
      return NextResponse.json({ error: 'Another active user already uses this email', code: 'DUPLICATE', field: 'email' }, { status: 409 })
    }
    if (message === 'INVALID_PASSWORD') {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

// DELETE (soft delete) user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Cannot delete self
    if (id === session.user.id) {
      return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Check user exists (RLS scopes the query)
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      })

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      if (user.role === 'owner') {
        return NextResponse.json({ error: 'The business owner cannot be deactivated here.' }, { status: 400 })
      }

      // Role hierarchy: cannot deactivate users at or above your rank, nor users holding
      // permissions you lack (e.g. a manager switching off the system manager)
      if (!canModifyUser(session.user.role, user.role) ||
          rolePermissionsNotHeld(session.user.role, user.role, session.user.tenantId, session.user.customRoleId, user.customRoleId).length > 0) {
        return NextResponse.json({ error: 'You do not have permission to deactivate this user' }, { status: 403 })
      }

      // Archive (is_active = false) + recycle bin: only a super admin can restore or purge the user
      const binned = await moveToRecycleBin(db, {
        tenantId: session.user.tenantId, entityType: 'user', entityId: id,
        userId: session.user.id, userName: session.user.name,
      })
      if (!binned) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // Sync to accountTenants if user has a linked account
      if (user.accountId) {
        await db.update(accountTenants)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(
            eq(accountTenants.accountId, user.accountId),
            eq(accountTenants.tenantId, session.user.tenantId)
          ))
      }

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'user', 'deleted', id)

      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/users/[id]', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}

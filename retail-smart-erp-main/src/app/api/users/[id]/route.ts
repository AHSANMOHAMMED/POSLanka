import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { users, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { requirePermission, canModifyUser } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validatePasswordStrength } from '@/lib/utils/validation'
import { validateBody } from '@/lib/validation'
import { updateUserSchema } from '@/lib/validation/schemas/users'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

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
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      return NextResponse.json(user)
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
    const { fullName, email, role, isActive, password, expectedUpdatedAt } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
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

        // Prevent modifying own role or isActive status
        if (current.id === session.user.id) {
          if (role !== undefined && role !== current.role) {
            throw new Error('CANNOT_MODIFY_OWN_ROLE')
          }
          if (isActive !== undefined && isActive !== current.isActive) {
            throw new Error('CANNOT_MODIFY_OWN_STATUS')
          }
        }

        // Role hierarchy: cannot modify users at or above your rank
        // Owners are protected — only another owner can modify an owner
        if (!canModifyUser(session.user.role, current.role, role)) {
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
        if (role !== undefined) {
          updateData.role = role
        }
        if (isActive !== undefined) updateData.isActive = isActive

        // Hash new password if provided
        if (password) {
          const passwordError = validatePasswordStrength(password)
          if (passwordError) {
            throw new Error('INVALID_PASSWORD')
          }
          updateData.passwordHash = await bcrypt.hash(password, 12)
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
            isActive: users.isActive,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })

        // Sync isActive to accountTenants when status changes
        if (isActive !== undefined && current.accountId) {
          await db.update(accountTenants)
            .set({ isActive, updatedAt: new Date() })
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
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    logError('api/users/[id]', error)

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
    if (message === 'INSUFFICIENT_RANK') {
      return NextResponse.json({ error: 'You do not have permission to modify this user' }, { status: 403 })
    }
    if (message === 'EMAIL_EXISTS') {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 400 })
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

      // Role hierarchy: cannot deactivate users at or above your rank
      if (!canModifyUser(session.user.role, user.role)) {
        return NextResponse.json({ error: 'You do not have permission to deactivate this user' }, { status: 403 })
      }

      // Soft delete - set isActive to false
      await db.update(users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(users.id, id))

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

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/users/[id]', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}

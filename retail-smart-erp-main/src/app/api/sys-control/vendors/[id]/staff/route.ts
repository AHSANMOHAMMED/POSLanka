import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { and, eq, ne } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateBody, validateParams } from '@/lib/validation'
import { emailSchema, idParamSchema, passwordSchema, userRoleSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { requireUserSeat } from '@/lib/billing/user-limit'
import { getRolesForBusinessType } from '@/lib/auth/roles'
import { StaffError, createStaffUser } from '@/lib/users/create-staff'
import { generateReadablePassword } from '@/lib/users/generated-login'
import { revokeAllSessions } from '@/lib/auth/session-manager'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

/** Only name and role are required; no email → generated login, no password → generated (returned once). */
const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the staff member’s name').max(255),
  role: userRoleSchema.refine((r) => r !== 'owner', 'A vendor has one owner; choose another role'),
  email: z.preprocess(blank, emailSchema.optional()),
  password: z.preprocess(blank, passwordSchema.optional()),
  pin: z.preprocess(blank, z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits').optional()),
})

const updateSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(['deactivate', 'activate', 'reset_password']),
})

async function loadTenant(id: string) {
  return db.query.tenants.findFirst({
    where: eq(tenants.id, id),
    columns: { id: true, name: true, slug: true, businessId: true, businessType: true, status: true },
  })
}

/**
 * POST /api/sys-control/vendors/[id]/staff — create a staff member (manager, cashier, …) for this
 * vendor. Same rules as the vendor's own staff page: plan seat limit, branch / counter auto-assign
 * when the vendor has one. vendors.manage. Audited.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/staff', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, createSchema)
    if (!parsed.success) return parsed.response

    const tenant = await loadTenant(p.data.id)
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    if (tenant.status === 'cancelled') return NextResponse.json({ error: 'This vendor is archived. Reactivate it before adding staff.' }, { status: 400 })
    if (!getRolesForBusinessType(tenant.businessType).includes(parsed.data.role)) {
      return NextResponse.json({ error: 'This role is not available for this type of business', field: 'role' }, { status: 400 })
    }

    const seatError = await requireUserSeat(tenant.id)
    if (seatError) {
      const body = await seatError.json()
      return NextResponse.json({ ...body, error: `${tenant.name}'s plan allows ${body.maxUsers} active user${body.maxUsers === 1 ? '' : 's'}. Change its plan or deactivate a user first.` }, { status: 402 })
    }

    let created
    try {
      created = await withTenant(tenant.id, (tdb) => tdb.transaction((tx) => createStaffUser(tx, {
        tenantId: tenant.id,
        actorRole: 'owner',
        email: parsed.data.email,
        fullName: parsed.data.fullName,
        role: parsed.data.role,
        password: parsed.data.password,
        pin: parsed.data.pin,
      })))
    } catch (err) {
      if (err instanceof StaffError) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }

    const { generatedPassword, ...user } = created
    await adminAudit.create(session.superAdminId, 'tenant_user', user.id, {
      op: 'create_staff', tenantId: tenant.id, tenantName: tenant.name, businessId: tenant.businessId,
      email: user.email, fullName: user.fullName, role: user.role, passwordGenerated: !!generatedPassword,
    })
    return NextResponse.json({ success: true, user, generatedPassword }, { status: 201 })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/staff POST', error)
    return NextResponse.json({ error: 'Failed to create the staff member' }, { status: 500 })
  }
}

/**
 * PATCH /api/sys-control/vendors/[id]/staff — { userId, action }: deactivate / activate a staff
 * member or give them a temporary password (returned once). Not for the owner (use the vendor
 * actions). vendors.manage. Audited.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/staff', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, updateSchema)
    if (!parsed.success) return parsed.response
    const { userId, action } = parsed.data

    const tenant = await loadTenant(p.data.id)
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const target = await withTenant(tenant.id, (tdb) => tdb.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.tenantId, tenant.id)),
      columns: { id: true, email: true, fullName: true, role: true, isActive: true, accountId: true },
    }))
    if (!target) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
    if (target.role === 'owner') {
      return NextResponse.json({ error: 'Manage the owner with the vendor actions (reset password, suspend).' }, { status: 400 })
    }

    const now = new Date()
    if (action === 'activate') {
      const seatError = await requireUserSeat(tenant.id)
      if (!target.isActive && seatError) return seatError
      await withTenant(tenant.id, (tdb) => tdb.update(users).set({ isActive: true, updatedAt: now }).where(eq(users.id, target.id)))
    } else if (action === 'deactivate') {
      await withTenant(tenant.id, (tdb) => tdb.update(users).set({ isActive: false, updatedAt: now })
        .where(and(eq(users.id, target.id), ne(users.role, 'owner'))))
      if (target.accountId) revokeAllSessions(target.accountId, undefined, 'admin_deactivated').catch(() => undefined)
    }

    let temporaryPassword: string | null = null
    if (action === 'reset_password') {
      temporaryPassword = generateReadablePassword()
      const passwordHash = await bcrypt.hash(temporaryPassword, 12)
      await withTenant(tenant.id, (tdb) => tdb.update(users).set({ passwordHash, passwordChangedAt: now, updatedAt: now }).where(eq(users.id, target.id)))
      if (target.accountId) revokeAllSessions(target.accountId, undefined, 'admin_password_reset').catch(() => undefined)
    }
    invalidatePermissionCache(tenant.id)

    await adminAudit.update(session.superAdminId, 'tenant_user', target.id, {
      op: `staff_${action}`, tenantId: tenant.id, tenantName: tenant.name, businessId: tenant.businessId,
      email: target.email, role: target.role,
    })
    return NextResponse.json({ success: true, email: target.email, temporaryPassword })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/staff PATCH', error)
    return NextResponse.json({ error: 'Failed to update the staff member' }, { status: 500 })
  }
}

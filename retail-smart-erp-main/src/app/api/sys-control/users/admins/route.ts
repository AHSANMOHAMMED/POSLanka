import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminSessions, superAdmins } from '@/lib/db/schema'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession, ADMIN_ROLES } from '@/lib/admin'
import { adminListColumns, generateTempPassword, sendAdminCredentialsEmail } from '@/lib/admin/platform-admins'
import { validateBody } from '@/lib/validation/helpers'
import { emailSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'

/** GET /api/sys-control/users/admins — every platform admin with sign-in, 2FA and session state. */
export async function GET() {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()

    const activeSessions = db
      .select({ superAdminId: adminSessions.superAdminId, n: sql<number>`count(*)::int`.as('n') })
      .from(adminSessions)
      .where(sql`${adminSessions.expiresAt} > now()`)
      .groupBy(adminSessions.superAdminId)
      .as('active_sessions')

    const admins = await db
      .select({ ...adminListColumns, activeSessions: sql<number>`coalesce(${activeSessions.n}, 0)::int` })
      .from(superAdmins)
      .leftJoin(activeSessions, eq(activeSessions.superAdminId, superAdmins.id))
      .orderBy(sql`${superAdmins.isActive} desc`, asc(superAdmins.fullName))

    return NextResponse.json({ admins, meId: session.superAdminId, myRole: session.role })
  } catch (error) {
    logError('api/sys-control/users/admins GET', error)
    return NextResponse.json({ error: 'Failed to load platform admins' }, { status: 500 })
  }
}

const createSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2, 'Enter the full name').max(255),
  phone: z.string().trim().max(50).optional(),
  /** Platform role; least privilege when omitted */
  role: z.enum(ADMIN_ROLES).default('viewer'),
  requireTotp: z.boolean().default(true),
  sendEmail: z.boolean().default(true),
})

/**
 * POST /api/sys-control/users/admins — add a platform admin with a temporary password.
 * The password is returned once (and optionally emailed); the new admin must change it at
 * first sign-in. Owners only (permission 'admins'). Audited.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/users/admins', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('admins')
    if (!session) return adminAuthError()

    const parsed = await validateBody(request, createSchema)
    if (!parsed.success) return parsed.response
    const { email, fullName, phone, role, requireTotp, sendEmail } = parsed.data

    const existing = await db.query.superAdmins.findFirst({ where: eq(superAdmins.email, email), columns: { id: true } })
    if (existing) return NextResponse.json({ error: 'A platform admin with this email already exists' }, { status: 409 })

    const tempPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, 12)
    const [created] = await db.insert(superAdmins).values({
      email,
      fullName,
      phone: phone || null,
      passwordHash,
      role,
      totpRequired: requireTotp,
      mustChangePassword: true,
    }).onConflictDoNothing().returning(adminListColumns)
    if (!created) return NextResponse.json({ error: 'A platform admin with this email already exists' }, { status: 409 })

    const emailStatus = sendEmail
      ? await sendAdminCredentialsEmail({
        to: email, fullName, tempPassword, reason: 'created', requireTotp,
        baseUrl: process.env.NEXTAUTH_URL || request.nextUrl.origin,
      })
      : 'skipped'

    await adminAudit.create(session.superAdminId, 'super_admin', created.id, {
      op: 'create_admin', email, fullName, role, requireTotp, emailStatus,
    })

    return NextResponse.json({ admin: { ...created, activeSessions: 0 }, tempPassword, emailStatus }, { status: 201 })
  } catch (error) {
    logError('api/sys-control/users/admins POST', error)
    return NextResponse.json({ error: 'Failed to create platform admin' }, { status: 500 })
  }
}

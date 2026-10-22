import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminSessions, superAdmins } from '@/lib/db/schema'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { adminPasswordSchema } from '@/lib/admin/platform-admins'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: adminPasswordSchema,
})

/**
 * POST /api/sys-control/users/me/password — the signed-in admin changes their own password
 * (also completes a forced change after a reset). Other sessions of this admin are ended.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/users/me/password', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession({ permission: 'self', allowPendingSetup: true })
    if (!session) return adminAuthError()

    const parsed = await validateBody(request, schema)
    if (!parsed.success) return parsed.response
    const { currentPassword, newPassword } = parsed.data

    const admin = await db.query.superAdmins.findFirst({ where: eq(superAdmins.id, session.superAdminId) })
    if (!admin) return adminAuthError()
    if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }
    if (await bcrypt.compare(newPassword, admin.passwordHash)) {
      return NextResponse.json({ error: 'Choose a password different from the current one' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await db.transaction(async (tx) => {
      await tx.update(superAdmins)
        .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
        .where(eq(superAdmins.id, admin.id))
      await tx.delete(adminSessions)
        .where(and(eq(adminSessions.superAdminId, admin.id), ne(adminSessions.id, session.id)))
    })
    await adminAudit.update(session.superAdminId, 'super_admin', admin.id, { op: 'change_own_password' })
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/users/me/password', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}

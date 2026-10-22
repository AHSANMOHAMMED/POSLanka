import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminSessions, superAdmins } from '@/lib/db/schema'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession, ADMIN_ROLES } from '@/lib/admin'
import { adminListColumns, generateTempPassword, sendAdminCredentialsEmail } from '@/lib/admin/platform-admins'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('deactivate'), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('reactivate') }),
  z.object({ action: z.literal('reset_password'), sendEmail: z.boolean().default(true) }),
  z.object({ action: z.literal('require_2fa') }),
  z.object({ action: z.literal('waive_2fa') }),
  z.object({ action: z.literal('reset_2fa') }),
  z.object({ action: z.literal('change_role'), role: z.enum(ADMIN_ROLES) }),
  z.object({
    action: z.literal('update'),
    fullName: z.string().trim().min(2, 'Enter the full name').max(255).optional(),
    phone: z.string().trim().max(50).optional(),
  }),
])

class RuleError extends Error {
  constructor(message: string, public status = 409) { super(message) }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Lock every active admin row (FOR UPDATE, stable order) so concurrent deactivations / demotions
 * serialize, and return the active admins with their roles.
 */
async function lockActiveAdmins(tx: Tx): Promise<Array<{ id: string; role: string }>> {
  const res = await tx.execute(sql`SELECT id, role FROM super_admins WHERE is_active = true ORDER BY id FOR UPDATE`)
  return (res as unknown as { rows?: Array<{ id: string; role: string }> }).rows ?? (res as unknown as Array<{ id: string; role: string }>)
}

/**
 * POST /api/sys-control/users/admins/[id] — manage a platform admin.
 *   deactivate      blocks sign-in and ends their sessions (never yourself, never the last active
 *                   admin or the last active owner)
 *   reactivate      restores sign-in and clears a lockout
 *   reset_password  new temporary password (returned once, optionally emailed); must be changed at sign-in
 *   require_2fa     the console stays blocked for them until they enrol an authenticator app
 *   waive_2fa       2FA becomes optional again (an enrolled app keeps working)
 *   reset_2fa       removes their enrolled app (lost phone); they sign in with password only
 *   update          name / phone
 *   change_role     owner | support | billing | viewer (never demotes the last active owner)
 * Owners only (permission 'admins'). Every change is audited.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/users/admins/action', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('admins')
    if (!session) return adminAuthError()

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, actionSchema, { keepEmptyStrings: true }) // '' clears the phone
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const id = p.data.id
    const isSelf = id === session.superAdminId

    const target = await db.query.superAdmins.findFirst({ where: eq(superAdmins.id, id) })
    if (!target) return NextResponse.json({ error: 'Platform admin not found' }, { status: 404 })

    const now = new Date()
    let tempPassword: string | undefined
    let emailStatus: string | undefined
    const audit: Record<string, unknown> = { op: body.action, email: target.email }

    switch (body.action) {
      case 'deactivate': {
        if (isSelf) throw new RuleError('You cannot deactivate your own account.', 400)
        if (!target.isActive) throw new RuleError('This admin is already deactivated.')
        await db.transaction(async (tx) => {
          // Lock every active admin row so two concurrent deactivations cannot both pass the check
          const active = await lockActiveAdmins(tx)
          const activeIds = active.map((r) => r.id)
          if (!activeIds.includes(id)) throw new RuleError('This admin is already deactivated.')
          if (activeIds.length <= 1) throw new RuleError('This is the last active platform admin. Add or reactivate another admin first.')
          const owners = active.filter((r) => r.role === 'owner')
          if (owners.length <= 1 && owners[0]?.id === id) {
            throw new RuleError('This is the last active owner. Make another admin an owner first.')
          }
          await tx.update(superAdmins).set({ isActive: false, deactivatedAt: now, updatedAt: now }).where(eq(superAdmins.id, id))
          await tx.delete(adminSessions).where(eq(adminSessions.superAdminId, id))
        })
        audit.reason = body.reason || null
        break
      }
      case 'reactivate': {
        if (target.isActive) throw new RuleError('This admin is already active.')
        await db.update(superAdmins).set({
          isActive: true, deactivatedAt: null, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now,
        }).where(eq(superAdmins.id, id))
        break
      }
      case 'reset_password': {
        if (isSelf) throw new RuleError('Change your own password from Settings → Security.', 400)
        tempPassword = generateTempPassword()
        const passwordHash = await bcrypt.hash(tempPassword, 12)
        await db.transaction(async (tx) => {
          await tx.update(superAdmins).set({
            passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now,
          }).where(eq(superAdmins.id, id))
          await tx.delete(adminSessions).where(eq(adminSessions.superAdminId, id))
        })
        emailStatus = body.sendEmail
          ? await sendAdminCredentialsEmail({
            to: target.email, fullName: target.fullName, tempPassword, reason: 'reset',
            requireTotp: target.totpRequired, baseUrl: process.env.NEXTAUTH_URL || request.nextUrl.origin,
          })
          : 'skipped'
        audit.emailStatus = emailStatus
        break
      }
      case 'require_2fa':
      case 'waive_2fa': {
        const required = body.action === 'require_2fa'
        await db.update(superAdmins).set({ totpRequired: required, updatedAt: now }).where(eq(superAdmins.id, id))
        audit.totpRequired = { from: target.totpRequired, to: required }
        break
      }
      case 'reset_2fa': {
        if (isSelf) throw new RuleError('Turn off your own two-factor authentication from Settings → Security.', 400)
        if (!target.totpEnabled && !target.totpSecret) throw new RuleError('This admin has no authenticator app enrolled.')
        await db.transaction(async (tx) => {
          await tx.update(superAdmins).set({ totpEnabled: false, totpSecret: null, updatedAt: now }).where(eq(superAdmins.id, id))
          await tx.delete(adminSessions).where(eq(adminSessions.superAdminId, id))
        })
        break
      }
      case 'change_role': {
        if (target.role === body.role) throw new RuleError(`This admin already has the ${body.role} role.`)
        await db.transaction(async (tx) => {
          const active = await lockActiveAdmins(tx)
          const [current] = await tx.select({ role: superAdmins.role, isActive: superAdmins.isActive })
            .from(superAdmins).where(eq(superAdmins.id, id)).for('update')
          if (!current) throw new RuleError('Platform admin not found', 404)
          if (current.role === 'owner' && body.role !== 'owner' && current.isActive) {
            const owners = active.filter((r) => r.role === 'owner')
            if (owners.length <= 1) throw new RuleError('This is the last active owner. Make another admin an owner first.')
          }
          await tx.update(superAdmins).set({ role: body.role, updatedAt: now }).where(eq(superAdmins.id, id))
          // Sessions carry no cached role (it is read on every request), so nothing else to end
        })
        audit.role = { from: target.role, to: body.role }
        break
      }
      case 'update': {
        const set: Partial<typeof superAdmins.$inferInsert> = { updatedAt: now }
        if (body.fullName !== undefined) set.fullName = body.fullName
        if (body.phone !== undefined) set.phone = body.phone || null
        await db.update(superAdmins).set(set).where(eq(superAdmins.id, id))
        audit.changes = { fullName: body.fullName, phone: body.phone }
        break
      }
    }

    await adminAudit.update(session.superAdminId, 'super_admin', id, audit)

    const [admin] = await db.select(adminListColumns).from(superAdmins).where(eq(superAdmins.id, id))
    return NextResponse.json({ admin, ...(tempPassword ? { tempPassword } : {}), ...(emailStatus ? { emailStatus } : {}) })
  } catch (error) {
    if (error instanceof RuleError) return NextResponse.json({ error: error.message }, { status: error.status })
    logError('api/sys-control/users/admins/[id]', error)
    return NextResponse.json({ error: 'Failed to update platform admin' }, { status: 500 })
  }
}

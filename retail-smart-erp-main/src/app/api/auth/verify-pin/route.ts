import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { and, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { hasPermission, ROLE_PERMISSIONS, type Permission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit } from '@/lib/auth/rate-limit'
import { logError } from '@/lib/ai/error-logger'

const PIN_RATE_LIMIT = { maxAttempts: 5, windowMs: 10 * 60 * 1000, category: 'pos_pin' }

const permissionKeys = Object.keys(ROLE_PERMISSIONS) as [Permission, ...Permission[]]

const verifyPinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
  /** 'self' = unlock my own terminal; 'supervisor' = another user with `permission` approves */
  scope: z.enum(['self', 'supervisor']).default('self'),
  permission: z.enum(permissionKeys).optional(),
  reason: z.string().max(500).optional(),
})

/**
 * POST /api/auth/verify-pin
 * Verifies a 4-6 digit POS PIN (users.pin_hash).
 * - scope 'self': the signed-in cashier unlocks the terminal.
 * - scope 'supervisor': any active user in the tenant whose role grants `permission`
 *   (default 'manageSales') approves an override. The approver is returned so the
 *   client can record who authorised the action. Never elevates the caller's session.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, verifyPinSchema)
    if (!parsed.success) return parsed.response
    const { pin, scope, permission = 'manageSales' } = parsed.data

    const tenantId = session.user.tenantId
    const rateKey = `pin:${tenantId}:${session.user.id}:${scope}`
    const limit = await checkRateLimit(rateKey, PIN_RATE_LIMIT)
    if (limit.limited) {
      return NextResponse.json(
        { ok: false, error: 'Too many PIN attempts. Try again in a few minutes.' },
        { status: 429 }
      )
    }

    const approver = await withTenant(tenantId, async (db) => {
      if (scope === 'self') {
        const me = await db.query.users.findFirst({
          where: and(eq(users.id, session.user.id), eq(users.isActive, true)),
          columns: { id: true, fullName: true, role: true, pinHash: true, customRoleId: true },
        })
        if (!me?.pinHash) return { error: 'NO_PIN' as const }
        const ok = await bcrypt.compare(pin, me.pinHash)
        return ok ? { user: me } : { error: 'INVALID' as const }
      }

      // Supervisor scope: check every active user with a PIN and the required permission.
      const candidates = await db.query.users.findMany({
        where: and(eq(users.isActive, true), isNotNull(users.pinHash)),
        columns: { id: true, fullName: true, role: true, pinHash: true, customRoleId: true },
      })
      for (const candidate of candidates) {
        if (!hasPermission(candidate.role, permission, tenantId, candidate.customRoleId)) continue
        if (await bcrypt.compare(pin, candidate.pinHash!)) {
          return { user: candidate }
        }
      }
      return { error: 'INVALID' as const }
    })

    if ('error' in approver) {
      await recordRateLimitAttempt(rateKey, PIN_RATE_LIMIT)
      if (approver.error === 'NO_PIN') {
        return NextResponse.json(
          { ok: false, error: 'No PIN set for your account. Ask a manager to set one in Staff settings.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ ok: false, error: 'Invalid PIN or insufficient permissions' }, { status: 403 })
    }

    await clearRateLimit(rateKey, PIN_RATE_LIMIT.category).catch(() => undefined)
    return NextResponse.json({
      ok: true,
      user: { id: approver.user.id, name: approver.user.fullName, role: approver.user.role },
    })
  } catch (error) {
    logError('api/auth/verify-pin', error)
    return NextResponse.json({ ok: false, error: 'PIN verification failed' }, { status: 500 })
  }
}

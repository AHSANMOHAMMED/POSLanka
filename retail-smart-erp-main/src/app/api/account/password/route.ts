import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { logError } from '@/lib/ai/error-logger'
import { revokeAllSessions } from '@/lib/auth/session-manager'
import { validateBody } from '@/lib/validation'
import { changePasswordSchema } from '@/lib/validation/schemas/auth'

// PUT /api/account/password - Change password
export async function PUT(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, changePasswordSchema)
    if (!parsed.success) return parsed.response

    const { currentPassword, newPassword } = parsed.data

    // Get current account
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, account.passwordHash)
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12)

    // Update password and record the change time (invalidates existing sessions)
    await db.update(accounts)
      .set({
        passwordHash: newPasswordHash,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, session.user.accountId))

    // Revoke all other sessions (keep current)
    const currentSessionToken = session.user.sessionToken
    revokeAllSessions(session.user.accountId, currentSessionToken, 'password_changed')
      .catch(err => console.error('[Password] Failed to revoke sessions:', err))

    return NextResponse.json({ success: true, message: 'Password updated successfully' })
  } catch (error) {
    logError('api/account/password', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

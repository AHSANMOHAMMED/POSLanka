import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { accountAuth } from '@/lib/auth/account-auth'
import jwt from 'jsonwebtoken'
import { logError } from '@/lib/ai/error-logger'

export async function GET() {
  try {
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      logError('api/auth/ws-token', new Error('NEXTAUTH_SECRET not configured'))
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Try company auth first (tenant-mode token)
    const session = await auth()
    if (session?.user?.tenantId) {
      const token = jwt.sign(
        {
          id: session.user.id,
          name: session.user.name,
          tenantId: session.user.tenantId,
          tenantSlug: session.user.tenantSlug,
          role: session.user.role,
          mode: 'tenant',
        },
        secret,
        { expiresIn: '1h' }
      )
      return NextResponse.json({ token })
    }

    // Fall back to account auth (account-mode token)
    const accountSession = await accountAuth()
    if (accountSession?.user?.id && accountSession.user.id !== '') {
      const token = jwt.sign(
        {
          id: accountSession.user.id,
          accountId: (accountSession.user as unknown as { accountId?: string }).accountId || accountSession.user.id,
          name: accountSession.user.name,
          mode: 'account',
        },
        secret,
        { expiresIn: '1h' }
      )
      return NextResponse.json({ token })
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } catch (error) {
    logError('api/auth/ws-token', error)
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}

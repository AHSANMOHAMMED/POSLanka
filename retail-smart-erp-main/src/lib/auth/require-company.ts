import { NextResponse } from 'next/server'
import { auth } from './index'
import type { Session } from 'next-auth'

/**
 * Helper to require company context in API routes.
 * Returns 401 if not authenticated, 403 if not in company mode.
 * Returns narrowed session type with non-null tenantId.
 */
export async function requireCompanyAuth(): Promise<
  | { session: Session & { user: Session['user'] & { tenantId: string; role: string } }; error?: never }
  | { session?: never; error: NextResponse }
> {
  const session = await auth()

  if (!session) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (!session.user.tenantId) {
    return { error: NextResponse.json({ error: 'Company context required' }, { status: 403 }) }
  }

  // Type narrowing - we've verified tenantId exists
  return {
    session: session as Session & {
      user: Session['user'] & { tenantId: string; role: string }
    },
  }
}

/**
 * Get the tenantId from session, with assertion that it exists.
 * Use only after verifying session has company context.
 */
export function getTenantId(session: Session): string {
  if (!session.user.tenantId) {
    throw new Error('Session does not have company context')
  }
  return session.user.tenantId
}

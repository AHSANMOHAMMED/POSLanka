import { withoutTenant, withTenant } from '@/lib/db'
import { users, accounts, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

/**
 * Resolves a valid user ID from the session.
 *
 * This is needed because session.user.id can be either:
 * - A users.id (correct for FK references)
 * - An accounts.id (incorrect, needs lookup)
 *
 * The fallback occurs when:
 * 1. User logs in with account that has no local user record
 * 2. User switches to a company without a local user record
 * 3. Stale JWT after user record is created
 *
 * Uses withTenant() with proper RLS context instead of raw db to avoid
 * connection pool role leaking (DATABASE_APP_ROLE=app_user).
 *
 * @param session - The auth session
 * @param tenantId - The tenant ID to lookup user in
 * @returns The valid users.id or null if not found
 */
export async function resolveUserId(
  session: { user: { id: string; accountId?: string | null; email?: string | null; name?: string | null; role?: string | null; tenantId: string } },
  tenantId?: string
): Promise<string | null> {
  const targetTenantId = tenantId || session.user.tenantId

  if (!targetTenantId) {
    return null
  }

  return await withTenant(targetTenantId, async (db) => {
    // First check if session.user.id is a valid users.id
    const userExists = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { id: true }
    })

    if (userExists) {
      return session.user.id
    }

    // Fallback: lookup by accountId
    if (session.user.accountId) {
      const userByAccount = await db.query.users.findFirst({
        where: eq(users.accountId, session.user.accountId),
        columns: { id: true }
      })
      if (userByAccount) {
        return userByAccount.id
      }
    }

    return null
  })
}

/**
 * Auto-creates a user record for a tenant from an account membership.
 * This handles the case where a user has a valid JWT session with an accountId
 * but their user record was deleted or never created.
 */
async function autoCreateUserFromAccount(
  accountId: string,
  tenantId: string,
  sessionEmail?: string,
  sessionName?: string,
  sessionRole?: string,
): Promise<{ id: string } | null> {
  try {
    // Look up the account and membership (bypasses RLS - global tables)
    const result = await withoutTenant(async (db) => {
      const account = await db.query.accounts.findFirst({
        where: eq(accounts.id, accountId),
        columns: { id: true, email: true, fullName: true },
      })
      if (!account) return null

      // Check membership exists (user is actually allowed in this tenant)
      const membership = await db.query.accountTenants.findFirst({
        where: and(
          eq(accountTenants.accountId, accountId),
          eq(accountTenants.tenantId, tenantId),
          eq(accountTenants.isActive, true)
        ),
        columns: { role: true, isOwner: true },
      })
      if (!membership) return null

      return { account, membership }
    })

    if (!result) return null

    // Create the user record within tenant RLS context
    const [newUser] = await withTenant(tenantId, async (tdb) => {
      return tdb.insert(users).values({
        tenantId,
        accountId,
        email: result.account.email || sessionEmail || '',
        fullName: result.account.fullName || sessionName || result.account.email?.split('@')[0] || '',
        passwordHash: '',
        role: result.membership.role || sessionRole || 'cashier',
        isActive: true,
        isSuperAdmin: false,
      }).returning({ id: users.id })
    })

    console.log(`[resolve-user] Auto-created user ${newUser.id} for account ${accountId} in tenant ${tenantId}`)
    return newUser
  } catch (error) {
    // Don't let auto-creation failure crash the request — log and return null
    console.error('[resolve-user] Failed to auto-create user:', error)
    return null
  }
}

/**
 * Resolves a valid user ID, throwing an error if not found.
 * Use this when a user ID is required for the operation.
 *
 * @param session - The auth session
 * @param tenantId - The tenant ID to lookup user in
 * @returns The valid users.id
 * @throws Error if no valid user ID found
 */
export async function resolveUserIdRequired(
  session: { user: { id: string; accountId?: string | null; email?: string | null; name?: string | null; role?: string | null; tenantId: string } },
  tenantId?: string
): Promise<string> {
  const userId = await resolveUserId(session, tenantId)

  if (!userId) {
    // If resolveUserId returned null and accountId exists, try auto-create
    if (session.user.accountId) {
      const newUser = await autoCreateUserFromAccount(
        session.user.accountId,
        tenantId || session.user.tenantId,
        session.user.email || undefined,
        session.user.name || undefined,
        session.user.role || undefined
      )
      if (newUser) {
        return newUser.id
      }
    }
    throw new Error('USER_NOT_FOUND')
  }

  return userId
}

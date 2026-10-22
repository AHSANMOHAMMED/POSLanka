import { db, withTenant } from '@/lib/db'
import { users, accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Current, authoritative state of a company user, read on every authenticated request.
 *
 * Sessions are JWTs, so anything copied into the token at sign-in (role, custom role) goes
 * stale when an owner demotes or deactivates a staff member. Callers use this to:
 *   - reject the session when the user was deactivated or changed their password after the
 *     token was issued (`issuedAtSec` = JWT `iat`), or the linked global account was suspended;
 *   - pick up the *current* role / custom role so a demotion takes effect immediately instead
 *     of when the token is next re-issued (mobile tokens live 12h).
 */
export type LiveCompanyUser =
  | { ok: true; role: string; customRoleId: string | null }
  | { ok: false; reason: 'not_found' | 'inactive' | 'password_changed' | 'account_inactive' }

export async function getLiveCompanyUser(
  tenantId: string,
  userId: string,
  issuedAtSec?: number,
): Promise<LiveCompanyUser> {
  const row = await withTenant(tenantId, async (tdb) =>
    tdb.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, isActive: true, role: true, customRoleId: true, passwordChangedAt: true, accountId: true },
    }),
  )
  if (!row) return { ok: false, reason: 'not_found' }
  if (!row.isActive) return { ok: false, reason: 'inactive' }
  if (row.passwordChangedAt && issuedAtSec) {
    const pwChangedSec = Math.floor(row.passwordChangedAt.getTime() / 1000)
    if (pwChangedSec >= issuedAtSec) return { ok: false, reason: 'password_changed' }
  }
  if (row.accountId && !(await isAccountActive(row.accountId))) {
    return { ok: false, reason: 'account_inactive' }
  }
  return { ok: true, role: row.role, customRoleId: row.customRoleId ?? null }
}

/** Global accounts (no RLS) can be suspended by the platform admin; treat a missing row as active. */
export async function isAccountActive(accountId: string): Promise<boolean> {
  const acc = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { isActive: true },
  })
  return acc ? acc.isActive !== false : true
}

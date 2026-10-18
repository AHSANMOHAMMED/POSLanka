import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accountTenants, accounts, tenants } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/account/team - Get all team members for user's companies
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all tenants owned by this account
    const ownedTenants = await db
      .select({ tenantId: accountTenants.tenantId })
      .from(accountTenants)
      .where(
        and(
          eq(accountTenants.accountId, session.user.accountId),
          eq(accountTenants.isOwner, true)
        )
      )

    const tenantIds = ownedTenants.map((t) => t.tenantId)

    if (tenantIds.length === 0) {
      return NextResponse.json({ members: [] })
    }

    // Get all members of those tenants (filtered at SQL level)
    const filteredMembers = await db
      .select({
        id: accountTenants.id,
        accountId: accounts.id,
        fullName: accounts.fullName,
        email: accounts.email,
        role: accountTenants.role,
        isOwner: accountTenants.isOwner,
        tenantId: tenants.id,
        tenantName: tenants.name,
        joinedAt: accountTenants.createdAt,
      })
      .from(accountTenants)
      .innerJoin(accounts, eq(accountTenants.accountId, accounts.id))
      .innerJoin(tenants, eq(accountTenants.tenantId, tenants.id))
      .where(and(
        eq(accountTenants.isActive, true),
        inArray(accountTenants.tenantId, tenantIds)
      ))

    // Group by account
    const memberMap = new Map<string, {
      id: string
      accountId: string
      fullName: string
      email: string
      isOwner: boolean
      sites: { id: string; name: string; role: string }[]
      joinedAt: Date | null
    }>()

    for (const m of filteredMembers) {
      if (!memberMap.has(m.accountId)) {
        memberMap.set(m.accountId, {
          id: m.id,
          accountId: m.accountId,
          fullName: m.fullName,
          email: m.email,
          isOwner: m.isOwner,
          sites: [],
          joinedAt: m.joinedAt,
        })
      }
      memberMap.get(m.accountId)!.sites.push({
        id: m.tenantId,
        name: m.tenantName,
        role: m.role,
      })
    }

    return NextResponse.json({ members: Array.from(memberMap.values()) })
  } catch (error) {
    logError('api/account/team', error)
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}

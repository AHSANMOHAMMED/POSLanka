import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { chartOfAccounts, tenants } from '@/lib/db/schema'
import { eq, and, ilike, sql, asc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { accountsListSchema, createAccountSchema } from '@/lib/validation/schemas/accounting'

interface AccountTreeNode {
  id: string
  name: string
  accountNumber: string
  rootType: string
  accountType: string
  isGroup: boolean
  isActive: boolean
  isSystemAccount: boolean
  balance: string
  description: string | null
  currency: string
  parentId: string | null
  children: AccountTreeNode[]
}

// Recursively compute group account balances from their descendants
function rollUpBalances(nodes: AccountTreeNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.children.length > 0) {
      const childrenTotal = rollUpBalances(node.children)
      if (node.isGroup) {
        node.balance = String(Math.round(childrenTotal * 100) / 100)
      }
      total += parseFloat(node.balance)
    } else {
      total += parseFloat(node.balance || '0')
    }
  }
  return total
}

function buildTree(accounts: typeof chartOfAccounts.$inferSelect[]): AccountTreeNode[] {
  const map = new Map<string, AccountTreeNode>()
  const roots: AccountTreeNode[] = []

  // Create nodes
  for (const acc of accounts) {
    map.set(acc.id, {
      id: acc.id,
      name: acc.name,
      accountNumber: acc.accountNumber,
      rootType: acc.rootType,
      accountType: acc.accountType,
      isGroup: acc.isGroup,
      isActive: acc.isActive,
      isSystemAccount: acc.isSystemAccount,
      balance: acc.balance,
      description: acc.description,
      currency: acc.currency,
      parentId: acc.parentId,
      children: [],
    })
  }

  // Build hierarchy
  for (const acc of accounts) {
    const node = map.get(acc.id)!
    if (acc.parentId && map.has(acc.parentId)) {
      map.get(acc.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Roll up child balances into parent/group accounts
  rollUpBalances(roots)

  return roots
}

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, accountsListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all, tree } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Tree mode: return all accounts in hierarchical structure
      if (tree) {
        const accounts = await db
          .select()
          .from(chartOfAccounts)
          .orderBy(asc(chartOfAccounts.accountNumber))

        const treeData = buildTree(accounts)
        return NextResponse.json(treeData)
      }

      // All mode: return flat list (for dropdowns)
      if (all) {
        const accounts = await db
          .select()
          .from(chartOfAccounts)
          .orderBy(asc(chartOfAccounts.accountNumber))
          .limit(1000)

        return NextResponse.json(accounts)
      }

      // Build search conditions
      const conditions: ReturnType<typeof eq>[] = []
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(chartOfAccounts.name, `%${escaped}%`),
            ilike(chartOfAccounts.accountNumber, `%${escaped}%`)
          )!
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(chartOfAccounts)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const accounts = await db
        .select()
        .from(chartOfAccounts)
        .where(whereClause)
        .orderBy(asc(chartOfAccounts.accountNumber))
        .limit(Math.min(pageSize, 100))
        .offset(offset)

      return NextResponse.json({
        data: accounts,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/accounts', error)
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createAccountSchema)
    if (!parsed.success) return parsed.response
    const { name, accountNumber, rootType, accountType, parentId, isGroup, description, currency } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Check for duplicate account number within tenant
      const existing = await db
        .select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.accountNumber, accountNumber))
        .limit(1)

      if (existing.length > 0) {
        return NextResponse.json(
          { error: 'An account with this account number already exists' },
          { status: 409 }
        )
      }

      // Get tenant's currency as default
      const tenant = await db
        .select({ currency: tenants.currency })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)

      const tenantCurrency = tenant[0]?.currency || 'LKR'

      const [newAccount] = await db.insert(chartOfAccounts).values({
        tenantId,
        name,
        accountNumber,
        rootType,
        accountType,
        parentId: parentId || null,
        isGroup: isGroup ?? false,
        description: description || null,
        currency: currency || tenantCurrency,
      }).returning()

      logAndBroadcast(tenantId, 'account', 'created', newAccount.id)
      return NextResponse.json(newAccount)
    })
  } catch (error) {
    logError('api/accounting/accounts', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}

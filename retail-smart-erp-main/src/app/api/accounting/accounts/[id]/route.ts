import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { chartOfAccounts, glEntries } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateAccountSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const account = await db.query.chartOfAccounts.findFirst({
        where: eq(chartOfAccounts.id, id),
        with: { children: true },
      })

      if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      return NextResponse.json(account)
    })
  } catch (error) {
    logError('api/accounting/accounts/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateAccountSchema)
    if (!parsed.success) return parsed.response
    const { name, description, isActive, accountNumber, parentId, rootType, accountType, isGroup } = parsed.data
    const body = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Fetch existing account
      const existing = await db.query.chartOfAccounts.findFirst({
        where: eq(chartOfAccounts.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      // Prevent changing rootType/accountType on system accounts
      if (existing.isSystemAccount) {
        if (body.rootType && body.rootType !== existing.rootType) {
          return NextResponse.json(
            { error: 'Cannot change root type on system accounts' },
            { status: 400 }
          )
        }
        if (body.accountType && body.accountType !== existing.accountType) {
          return NextResponse.json(
            { error: 'Cannot change account type on system accounts' },
            { status: 400 }
          )
        }
      }

      // Build update data - only include provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (name !== undefined) updateData.name = name
      if (description !== undefined) updateData.description = description
      if (isActive !== undefined) {
        // Safety check: prevent deactivating accounts with non-zero balance
        if (isActive === false && existing.isActive) {
          const balance = Number(existing.balance || 0)
          if (Math.abs(balance) > 0.01) {
            return NextResponse.json(
              { error: `Cannot deactivate account with non-zero balance (${balance.toFixed(2)}). Transfer or write off the balance first.` },
              { status: 400 }
            )
          }
        }
        updateData.isActive = isActive
      }
      if (accountNumber !== undefined) {
        // Check for duplicate account number (excluding current)
        const duplicate = await db
          .select({ id: chartOfAccounts.id })
          .from(chartOfAccounts)
          .where(eq(chartOfAccounts.accountNumber, accountNumber))
          .limit(1)

        if (duplicate.length > 0 && duplicate[0].id !== id) {
          return NextResponse.json(
            { error: 'An account with this account number already exists' },
            { status: 409 }
          )
        }
        updateData.accountNumber = accountNumber
      }
      if (parentId !== undefined) updateData.parentId = parentId || null
      if (isGroup !== undefined) updateData.isGroup = isGroup
      if (rootType !== undefined) updateData.rootType = rootType
      if (accountType !== undefined) updateData.accountType = accountType

      const [updated] = await db.update(chartOfAccounts)
        .set(updateData)
        .where(eq(chartOfAccounts.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      logAndBroadcast(tenantId, 'account', 'updated', id)
      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/accounting/accounts/[id]', error)
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Fetch the account
      const account = await db.query.chartOfAccounts.findFirst({
        where: eq(chartOfAccounts.id, id),
      })

      if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      // Prevent deleting system accounts
      if (account.isSystemAccount) {
        return NextResponse.json(
          { error: 'Cannot delete system accounts' },
          { status: 400 }
        )
      }

      // Check if account has any GL entries
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(glEntries)
        .where(eq(glEntries.accountId, id))

      if (Number(count) > 0) {
        return NextResponse.json(
          { error: 'Cannot delete account with existing GL entries' },
          { status: 400 }
        )
      }

      // Check if account has children
      const [{ childCount }] = await db
        .select({ childCount: sql<number>`count(*)::int` })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.parentId, id))

      if (Number(childCount) > 0) {
        return NextResponse.json(
          { error: 'Cannot delete account with child accounts' },
          { status: 400 }
        )
      }

      const [deleted] = await db.delete(chartOfAccounts)
        .where(eq(chartOfAccounts.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      logAndBroadcast(tenantId, 'account', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/accounts/[id]', error)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}

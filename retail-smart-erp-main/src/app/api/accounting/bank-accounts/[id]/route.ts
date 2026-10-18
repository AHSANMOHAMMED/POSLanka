import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { bankAccounts, bankTransactions, chartOfAccounts, accountingSettings } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateBankAccountSchema } from '@/lib/validation/schemas/accounting'
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
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
        with: { coaAccount: true },
      })

      if (!account) {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
      }

      return NextResponse.json(account)
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch bank account' }, { status: 500 })
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
    const parsed = await validateBody(request, updateBankAccountSchema)
    if (!parsed.success) return parsed.response
    const {
      expectedUpdatedAt,
      accountName,
      bankName,
      accountNumber,
      branchCode,
      iban,
      swiftCode,
      isDefault,
      isActive,
    } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      return await db.transaction(async (tx) => {
        // Lock the row for update to prevent race conditions
        const [current] = await tx.select().from(bankAccounts)
          .where(eq(bankAccounts.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking: check for concurrent modification
        if (expectedUpdatedAt) {
          const clientTime = new Date(expectedUpdatedAt).getTime()
          const serverTime = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
          if (serverTime > clientTime) {
            throw new Error('CONFLICT')
          }
        }

        // If setting isDefault to true, unset any other default
        if (isDefault === true) {
          await tx
            .update(bankAccounts)
            .set({ isDefault: false })
            .where(eq(bankAccounts.isDefault, true))
        }

        // Build update data - only include provided fields
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (accountName !== undefined) updateData.accountName = accountName
        if (bankName !== undefined) updateData.bankName = bankName || null
        if (accountNumber !== undefined) updateData.accountNumber = accountNumber || null
        if (branchCode !== undefined) updateData.branchCode = branchCode || null
        if (iban !== undefined) updateData.iban = iban || null
        if (swiftCode !== undefined) updateData.swiftCode = swiftCode || null
        if (isDefault !== undefined) updateData.isDefault = isDefault
        if (isActive !== undefined) updateData.isActive = isActive

        const [updated] = await tx
          .update(bankAccounts)
          .set(updateData)
          .where(eq(bankAccounts.id, id))
          .returning()

        if (!updated) {
          throw new Error('NOT_FOUND')
        }

        // Sync COA entry name when accountName changes
        if (accountName !== undefined && updated.accountId) {
          await tx
            .update(chartOfAccounts)
            .set({ name: accountName, updatedAt: new Date() })
            .where(eq(chartOfAccounts.id, updated.accountId))
          logAndBroadcast(tenantId, 'account', 'updated', updated.accountId)
        }

        logAndBroadcast(tenantId, 'bank-account', 'updated', id)
        return NextResponse.json(updated)
      })
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
    }
    if (err.message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This record was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    logError('api/accounting/bank-accounts/[id]', error)
    return NextResponse.json({ error: 'Failed to update bank account' }, { status: 500 })
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
      return await db.transaction(async (tx) => {
        // Fetch the account
        const account = await tx.query.bankAccounts.findFirst({
          where: eq(bankAccounts.id, id),
        })

        if (!account) {
          return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
        }

        // Check if bank account has transactions
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bankTransactions)
          .where(eq(bankTransactions.bankAccountId, id))

        if (Number(count) > 0) {
          return NextResponse.json(
            { error: 'Cannot delete bank account with existing transactions' },
            { status: 400 }
          )
        }

        const [deleted] = await tx
          .delete(bankAccounts)
          .where(eq(bankAccounts.id, id))
          .returning()

        if (!deleted) {
          return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
        }

        // Delete the linked COA entry (safe — no bank transactions = no GL entries)
        if (deleted.accountId) {
          await tx
            .delete(chartOfAccounts)
            .where(eq(chartOfAccounts.id, deleted.accountId))

          // If this was the default bank account, reassign to next available
          const [settings] = await tx
            .select()
            .from(accountingSettings)
            .where(eq(accountingSettings.tenantId, tenantId))

          if (settings?.defaultBankAccountId === deleted.accountId) {
            const nextBank = await tx.query.bankAccounts.findFirst({
              where: and(
                eq(bankAccounts.isActive, true),
              ),
            })
            await tx
              .update(accountingSettings)
              .set({ defaultBankAccountId: nextBank?.accountId || null })
              .where(eq(accountingSettings.tenantId, tenantId))
          }

          logAndBroadcast(tenantId, 'account', 'deleted', deleted.accountId)
        }

        logAndBroadcast(tenantId, 'bank-account', 'deleted', id)
        return NextResponse.json({ success: true })
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]', error)
    return NextResponse.json({ error: 'Failed to delete bank account' }, { status: 500 })
  }
}

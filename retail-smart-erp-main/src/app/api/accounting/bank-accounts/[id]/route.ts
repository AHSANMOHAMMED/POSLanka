import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission, requireModule } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { bankAccounts, chartOfAccounts, accountingSettings, glEntries } from '@/lib/db/schema'
import { eq, and, ne, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateBankAccountSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { moveToRecycleBin } from '@/lib/recycle-bin'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'accounting')
    if (moduleError) return moduleError

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

        // Transactions stay (the bank account is only archived), but money still in it must not be hidden
        if (account.accountId) {
          const [{ balance }] = await tx
            .select({ balance: sql<string>`COALESCE(SUM(${glEntries.debit} - ${glEntries.credit}), 0)::text` })
            .from(glEntries)
            .where(eq(glEntries.accountId, account.accountId))
          if (Math.abs(parseFloat(balance || '0')) >= 0.005) {
            return NextResponse.json(
              { error: `Cannot move a bank account with a balance (${parseFloat(balance).toFixed(2)}) to the recycle bin. Transfer the balance out first.` },
              { status: 400 }
            )
          }
        }

        // Vendors never hard-delete: archive + recycle bin (only a super admin can restore or purge)
        const binned = await moveToRecycleBin(tx, {
          tenantId: tenantId, entityType: 'bank_account', entityId: id, userId: session!.user.id, userName: session!.user.name,
        })
        if (!binned) {
          return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
        }

        const deleted = account
        if (deleted.accountId) {
          // If this was the default bank account, reassign to next available
          const [settings] = await tx
            .select()
            .from(accountingSettings)
            .where(eq(accountingSettings.tenantId, tenantId))

          if (settings?.defaultBankAccountId === deleted.accountId) {
            const nextBank = await tx.query.bankAccounts.findFirst({
              where: and(
                eq(bankAccounts.isActive, true),
                ne(bankAccounts.id, id),
              ),
            })
            await tx
              .update(accountingSettings)
              .set({ defaultBankAccountId: nextBank?.accountId || null })
              .where(eq(accountingSettings.tenantId, tenantId))
          }

        }

        logAndBroadcast(tenantId, 'bank-account', 'deleted', id)
        return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]', error)
    return NextResponse.json({ error: 'Failed to delete bank account' }, { status: 500 })
  }
}

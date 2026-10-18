import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { recurringJournalTemplates, chartOfAccounts, costCenters } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateRecurringEntrySchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

function calculateNextRunDate(currentDate: string, pattern: string): string {
  const date = new Date(currentDate + 'T00:00:00')
  switch (pattern) {
    case 'daily':
      date.setDate(date.getDate() + 1)
      break
    case 'weekly':
      date.setDate(date.getDate() + 7)
      break
    case 'monthly':
      date.setMonth(date.getMonth() + 1)
      break
    case 'quarterly':
      date.setMonth(date.getMonth() + 3)
      break
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1)
      break
  }
  return date.toISOString().split('T')[0]
}

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
      const template = await db
        .select()
        .from(recurringJournalTemplates)
        .where(eq(recurringJournalTemplates.id, id))
        .limit(1)

      if (!template.length) {
        return NextResponse.json({ error: 'Recurring entry template not found' }, { status: 404 })
      }

      return NextResponse.json(template[0])
    })
  } catch (error) {
    logError('api/accounting/recurring-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch recurring entry template' }, { status: 500 })
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
    const parsed = await validateBody(request, updateRecurringEntrySchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId

    const {
      expectedUpdatedAt,
      name,
      entryType,
      remarks,
      recurrencePattern,
      startDate,
      endDate,
      items,
      isActive,
    } = parsed.data

    return await withTenant(tenantId, async (db) => {
      // Fetch current record
      const [current] = await db
        .select()
        .from(recurringJournalTemplates)
        .where(eq(recurringJournalTemplates.id, id))
        .for('update')

      if (!current) {
        return NextResponse.json({ error: 'Recurring entry template not found' }, { status: 404 })
      }

      // Optimistic locking
      if (expectedUpdatedAt) {
        const clientTime = new Date(expectedUpdatedAt).getTime()
        const serverTime = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
        if (serverTime > clientTime) {
          return NextResponse.json({
            error: 'This record was modified by another user. Please refresh and try again.',
            code: 'CONFLICT',
          }, { status: 409 })
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = { updatedAt: new Date() }

      if (name !== undefined) updateData.name = name.trim()
      if (entryType !== undefined) updateData.entryType = entryType
      if (remarks !== undefined) updateData.remarks = remarks || null
      if (isActive !== undefined) updateData.isActive = isActive

      if (items !== undefined) {
        if (!Array.isArray(items) || items.length < 2) {
          return NextResponse.json({ error: 'At least 2 line items are required' }, { status: 400 })
        }

        // Validate double entry
        let totalDebit = 0
        let totalCredit = 0
        for (const item of items) {
          totalDebit += Number(item.debit || 0)
          totalCredit += Number(item.credit || 0)
        }

        const difference = Math.round((totalDebit - totalCredit) * 100) / 100
        if (difference !== 0) {
          return NextResponse.json({
            error: `Debits and credits must be equal. Difference: ${difference}`,
          }, { status: 400 })
        }

        // Validate party and cost center requirements
        const accountIds = [...new Set(items.map((item) => item.accountId))]
        const accountRecords = await db
          .select({ id: chartOfAccounts.id, accountType: chartOfAccounts.accountType, name: chartOfAccounts.name })
          .from(chartOfAccounts)
          .where(sql`${chartOfAccounts.id} IN ${accountIds}`)

        const accountMap = new Map(accountRecords.map((a) => [a.id, a]))

        for (const item of items) {
          const account = accountMap.get(item.accountId)
          if (account && (account.accountType === 'receivable' || account.accountType === 'payable')) {
            if (!item.partyType || !item.partyId) {
              return NextResponse.json({
                error: `Party type and party are required for ${account.accountType} account "${account.name}"`,
              }, { status: 400 })
            }
          }
        }

        // Validate cost center for income/expense accounts (only if cost centers exist)
        const [{ count: ccCount }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(costCenters)
          .where(eq(costCenters.isGroup, false))

        if (Number(ccCount) > 0) {
          for (const item of items) {
            const account = accountMap.get(item.accountId)
            if (account && (account.accountType === 'income_account' || account.accountType === 'expense_account')) {
              if (!item.costCenterId) {
                return NextResponse.json({
                  error: `Cost Center is required for ${account.accountType} account "${account.name}"`,
                }, { status: 400 })
              }
            }
          }
        }

        updateData.items = items.map((item) => ({
          accountId: item.accountId,
          debit: Number(item.debit || 0),
          credit: Number(item.credit || 0),
          partyType: item.partyType || null,
          partyId: item.partyId || null,
          costCenterId: item.costCenterId || null,
          remarks: item.remarks || null,
        }))
      }

      // Recalculate nextRunDate if dates or pattern changed
      const effectiveStartDate = startDate !== undefined ? startDate : current.startDate
      const effectiveEndDate = endDate !== undefined ? endDate : current.endDate
      const effectivePattern = recurrencePattern !== undefined ? recurrencePattern : current.recurrencePattern

      if (startDate !== undefined) updateData.startDate = startDate
      if (endDate !== undefined) updateData.endDate = endDate || null
      if (recurrencePattern !== undefined) updateData.recurrencePattern = recurrencePattern

      if (startDate !== undefined || recurrencePattern !== undefined) {
        // Recalculate next run date from start date
        updateData.nextRunDate = effectiveStartDate

        // If there was already a last generated date, calculate from pattern
        if (current.lastGeneratedAt) {
          const lastGenDate = current.nextRunDate || effectiveStartDate
          updateData.nextRunDate = calculateNextRunDate(lastGenDate, effectivePattern)
        }

        // If next run is past end date, deactivate
        if (effectiveEndDate && updateData.nextRunDate > effectiveEndDate) {
          updateData.isActive = false
        }
      }

      if (endDate !== undefined) {
        // Check if current next run date would exceed new end date
        const nextRun = updateData.nextRunDate || current.nextRunDate
        if (effectiveEndDate && nextRun && nextRun > effectiveEndDate) {
          updateData.isActive = false
        }
      }

      const [updated] = await db
        .update(recurringJournalTemplates)
        .set(updateData)
        .where(eq(recurringJournalTemplates.id, id))
        .returning()

      logAndBroadcast(tenantId, 'recurring-entry', 'updated', id)
      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/accounting/recurring-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to update recurring entry template' }, { status: 500 })
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
      const [existing] = await db
        .select()
        .from(recurringJournalTemplates)
        .where(eq(recurringJournalTemplates.id, id))

      if (!existing) {
        return NextResponse.json({ error: 'Recurring entry template not found' }, { status: 404 })
      }

      await db.delete(recurringJournalTemplates).where(eq(recurringJournalTemplates.id, id))

      logAndBroadcast(tenantId, 'recurring-entry', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/recurring-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to delete recurring entry template' }, { status: 500 })
  }
}

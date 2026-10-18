import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { recurringJournalTemplates, chartOfAccounts, costCenters } from '@/lib/db/schema'
import { and, ilike, sql, desc, eq } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createRecurringEntrySchema } from '@/lib/validation/schemas/accounting'
import { z } from 'zod'
import { paginatedSearchSchema } from '@/lib/validation/schemas/common'

const recurringEntriesListSchema = paginatedSearchSchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
})

function calculateNextRunDate(startDate: string, pattern: string): string {
  const date = new Date(startDate + 'T00:00:00')
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

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, recurringEntriesListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, status } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) {
        conditions.push(ilike(recurringJournalTemplates.name, `%${escapeLikePattern(search)}%`))
      }
      if (status === 'active') {
        conditions.push(eq(recurringJournalTemplates.isActive, true))
      } else if (status === 'inactive') {
        conditions.push(eq(recurringJournalTemplates.isActive, false))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(recurringJournalTemplates)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db
        .select()
        .from(recurringJournalTemplates)
        .where(whereClause)
        .orderBy(desc(recurringJournalTemplates.createdAt))
        .limit(pageSize)
        .offset(offset)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/recurring-entries', error)
    return NextResponse.json({ error: 'Failed to fetch recurring entries' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createRecurringEntrySchema)
    if (!parsed.success) return parsed.response
    const {
      name,
      entryType,
      remarks,
      recurrencePattern,
      startDate,
      endDate,
      items,
    } = parsed.data

    // Validate double entry (business logic - keep outside schema)
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

    if (endDate && endDate < startDate) {
      return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
    }

    const tenantId = session!.user.tenantId

    // Validate party and cost center requirements
    const validationResult = await withTenant(tenantId, async (db) => {
      const accountIds = [...new Set(items.map((item) => item.accountId))]
      const accountRecords = await db
        .select({ id: chartOfAccounts.id, accountType: chartOfAccounts.accountType, name: chartOfAccounts.name })
        .from(chartOfAccounts)
        .where(sql`${chartOfAccounts.id} IN ${accountIds}`)

      const accountMap = new Map(accountRecords.map((a) => [a.id, a]))

      // Validate party required for receivable/payable accounts
      for (const item of items) {
        const account = accountMap.get(item.accountId)
        if (account && (account.accountType === 'receivable' || account.accountType === 'payable')) {
          if (!item.partyType || !item.partyId) {
            return { error: `Party type and party are required for ${account.accountType} account "${account.name}"` }
          }
        }
      }

      // Validate cost center required for income/expense accounts (only if cost centers exist)
      const [{ count: ccCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(costCenters)
        .where(eq(costCenters.isGroup, false))

      if (Number(ccCount) > 0) {
        for (const item of items) {
          const account = accountMap.get(item.accountId)
          if (account && (account.accountType === 'income_account' || account.accountType === 'expense_account')) {
            if (!item.costCenterId) {
              return { error: `Cost Center is required for ${account.accountType} account "${account.name}"` }
            }
          }
        }
      }

      return null
    })

    if (validationResult) {
      return NextResponse.json({ error: validationResult.error }, { status: 400 })
    }
    const nextRunDate = calculateNextRunDate(startDate, recurrencePattern)

    // If end date is set and next run date is past it, template starts inactive
    const isActive = !(endDate && nextRunDate > endDate)

    return await withTenant(tenantId, async (db) => {
      const [created] = await db.insert(recurringJournalTemplates).values({
        tenantId,
        name: name.trim(),
        isActive,
        entryType,
        remarks: remarks || null,
        recurrencePattern,
        startDate,
        endDate: endDate || null,
        nextRunDate,
        items: items.map((item) => ({
          accountId: item.accountId,
          debit: Number(item.debit || 0),
          credit: Number(item.credit || 0),
          partyType: item.partyType || null,
          partyId: item.partyId || null,
          costCenterId: item.costCenterId || null,
          remarks: item.remarks || null,
        })),
        createdBy: session!.user.id,
      }).returning()

      logAndBroadcast(tenantId, 'recurring-entry', 'created', created.id)
      return NextResponse.json(created)
    })
  } catch (error) {
    logError('api/accounting/recurring-entries', error)
    return NextResponse.json({ error: 'Failed to create recurring entry template' }, { status: 500 })
  }
}

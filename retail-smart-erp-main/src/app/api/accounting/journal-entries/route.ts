import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { journalEntries, journalEntryItems, chartOfAccounts, costCenters } from '@/lib/db/schema'
import { and, ilike, sql, eq } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { journalEntriesListSchema, createJournalEntrySchema } from '@/lib/validation/schemas/accounting'
import { nextDocNo } from '@/lib/documents/numbering'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, journalEntriesListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, status, fromDate, toDate } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) {
        conditions.push(ilike(journalEntries.entryNumber, `%${escapeLikePattern(search)}%`))
      }
      if (status) {
        conditions.push(sql`${journalEntries.status} = ${status}`)
      }
      if (fromDate) {
        conditions.push(sql`${journalEntries.postingDate} >= ${fromDate}`)
      }
      if (toDate) {
        conditions.push(sql`${journalEntries.postingDate} <= ${toDate}`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(journalEntries)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db.query.journalEntries.findMany({
        where: whereClause,
        with: {
          items: {
            with: {
              account: true,
            },
          },
        },
        orderBy: (je, { desc }) => [desc(je.createdAt)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/journal-entries', error)
    return NextResponse.json({ error: 'Failed to fetch journal entries' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createJournalEntrySchema)
    if (!parsed.success) return parsed.response
    const { entryType, postingDate, remarks, items } = parsed.data

    // Validate double entry
    let totalDebit = 0
    let totalCredit = 0
    for (const item of items) {
      totalDebit += item.debit
      totalCredit += item.credit
    }

    const difference = Math.round((totalDebit - totalCredit) * 100) / 100
    if (difference !== 0) {
      return NextResponse.json({
        error: `Debits and credits must be equal. Difference: ${difference}`,
      }, { status: 400 })
    }

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Validate party required for receivable/payable accounts
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
              return NextResponse.json({
                error: `Cost Center is required for ${account.accountType} account "${account.name}"`,
              }, { status: 400 })
            }
          }
        }
      }

      const result = await db.transaction(async (tx) => {
        // Entry number JE-#### from the per-tenant sequence (numeric, never re-issued)
        const entryNumber = await nextDocNo(tx, tenantId, 'journal_entry')

        // Create journal entry
        const [newEntry] = await tx.insert(journalEntries).values({
          tenantId,
          entryNumber,
          entryType,
          postingDate,
          totalDebit: String(totalDebit),
          totalCredit: String(totalCredit),
          status: 'draft',
          remarks: remarks || null,
          createdBy: session!.user.id,
        }).returning()

        // Create line items
        for (const item of items) {
          await tx.insert(journalEntryItems).values({
            tenantId,
            journalEntryId: newEntry.id,
            accountId: item.accountId,
            debit: String(item.debit),
            credit: String(item.credit),
            partyType: item.partyType || null,
            partyId: item.partyId || null,
            costCenterId: item.costCenterId || null,
            remarks: item.remarks || null,
          })
        }

        return newEntry
      })

      logAndBroadcast(tenantId, 'journal-entry', 'created', result.id)
      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/accounting/journal-entries', error)
    return NextResponse.json({ error: 'Failed to create journal entry' }, { status: 500 })
  }
}

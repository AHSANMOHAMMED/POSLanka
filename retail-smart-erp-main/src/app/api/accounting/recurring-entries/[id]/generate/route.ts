import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { recurringJournalTemplates, journalEntries, journalEntryItems } from '@/lib/db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

interface TemplateItem {
  accountId: string
  debit: number
  credit: number
  partyType: string | null
  partyId: string | null
  costCenterId: string | null
  remarks: string | null
}

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

export async function POST(
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

    const quotaError = await requireQuota(tenantId, 'standard')
    if (quotaError) return quotaError

    return await withTenant(tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // 1. Read the template
        const [template] = await tx
          .select()
          .from(recurringJournalTemplates)
          .where(eq(recurringJournalTemplates.id, id))
          .for('update')

        if (!template) {
          throw new Error('NOT_FOUND')
        }

        if (!template.isActive) {
          throw new Error('VALIDATION: This template is inactive and cannot generate entries')
        }

        if (!template.nextRunDate) {
          throw new Error('VALIDATION: No next run date set for this template')
        }

        const items = template.items as TemplateItem[]
        if (!items || items.length < 2) {
          throw new Error('VALIDATION: Template must have at least 2 line items')
        }

        // 2. Generate entry number with advisory lock (same pattern as journal entries)
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('journal_entry_' || ${tenantId}))`)

        const [lastEntry] = await tx
          .select({ entryNumber: journalEntries.entryNumber })
          .from(journalEntries)
          .orderBy(desc(journalEntries.createdAt))
          .limit(1)

        let nextNum = 1
        if (lastEntry?.entryNumber) {
          const match = lastEntry.entryNumber.match(/JE-(\d+)/)
          if (match) nextNum = parseInt(match[1], 10) + 1
        }
        const entryNumber = `JE-${String(nextNum).padStart(4, '0')}`

        // 3. Calculate totals
        let totalDebit = 0
        let totalCredit = 0
        for (const item of items) {
          totalDebit += Number(item.debit || 0)
          totalCredit += Number(item.credit || 0)
        }

        // 4. Create journal entry with posting date = nextRunDate
        const [newEntry] = await tx.insert(journalEntries).values({
          tenantId,
          entryNumber,
          entryType: template.entryType as 'journal' | 'opening' | 'adjustment' | 'depreciation' | 'closing',
          postingDate: template.nextRunDate,
          totalDebit: String(totalDebit),
          totalCredit: String(totalCredit),
          status: 'draft',
          remarks: template.remarks
            ? `[Auto-generated from "${template.name}"] ${template.remarks}`
            : `[Auto-generated from "${template.name}"]`,
          createdBy: session!.user.id,
        }).returning()

        // 5. Create line items
        for (const item of items) {
          await tx.insert(journalEntryItems).values({
            tenantId,
            journalEntryId: newEntry.id,
            accountId: item.accountId,
            debit: String(Number(item.debit || 0)),
            credit: String(Number(item.credit || 0)),
            partyType: item.partyType as 'customer' | 'supplier' | 'employee' | null,
            partyId: item.partyId || null,
            costCenterId: item.costCenterId || null,
            remarks: item.remarks || null,
          })
        }

        // 6. Calculate new next run date
        const newNextRunDate = calculateNextRunDate(template.nextRunDate, template.recurrencePattern)

        // 7. Update template
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const templateUpdate: Record<string, any> = {
          lastGeneratedAt: new Date(),
          nextRunDate: newNextRunDate,
          updatedAt: new Date(),
        }

        // 8. If nextRunDate > endDate, deactivate
        if (template.endDate && newNextRunDate > template.endDate) {
          templateUpdate.isActive = false
        }

        await tx
          .update(recurringJournalTemplates)
          .set(templateUpdate)
          .where(eq(recurringJournalTemplates.id, id))

        return newEntry
      })

      // Broadcast changes for both entity types
      logAndBroadcast(tenantId, 'recurring-entry', 'updated', id)
      logAndBroadcast(tenantId, 'journal-entry', 'created', result.id)

      return NextResponse.json({
        success: true,
        journalEntry: result,
        message: `Journal entry ${result.entryNumber} created successfully`,
      })
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Recurring entry template not found' }, { status: 404 })
    }
    if (err.message?.startsWith('VALIDATION:')) {
      return NextResponse.json({ error: err.message.replace('VALIDATION: ', '') }, { status: 400 })
    }
    logError('api/accounting/recurring-entries/[id]/generate', error)
    return NextResponse.json({ error: 'Failed to generate journal entry' }, { status: 500 })
  }
}

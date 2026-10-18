import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { journalEntries, journalEntryItems, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateJournalEntrySchema } from '@/lib/validation/schemas/accounting'
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
      const entry = await db.query.journalEntries.findFirst({
        where: eq(journalEntries.id, id),
        with: {
          items: {
            with: {
              account: true,
            },
          },
        },
      })

      if (!entry) {
        return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
      }

      // Fetch creator name
      let createdByName: string | null = null
      if (entry.createdBy) {
        const [creator] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, entry.createdBy))
        createdByName = creator?.fullName || null
      }

      // Flatten account relation into each item for frontend consumption
      const items = entry.items.map((item) => ({
        ...item,
        accountNumber: item.account?.accountNumber ?? '',
        accountName: item.account?.name ?? '',
      }))

      return NextResponse.json({ ...entry, items, createdByName })
    })
  } catch (error) {
    logError('api/accounting/journal-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch journal entry' }, { status: 500 })
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
    const parsed = await validateBody(request, updateJournalEntrySchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId

    const { expectedUpdatedAt, postingDate, entryType, remarks, items } = parsed.data

    return await withTenant(tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // Lock the row for update to prevent race conditions
        const [current] = await tx.select().from(journalEntries)
          .where(eq(journalEntries.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        if (current.status !== 'draft') {
          throw new Error('VALIDATION: Only draft entries can be edited')
        }

        // Optimistic locking: check for concurrent modification
        if (expectedUpdatedAt) {
          const clientTime = new Date(expectedUpdatedAt).getTime()
          const serverTime = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
          if (serverTime > clientTime) {
            throw new Error('CONFLICT')
          }
        }

        // Update main entry
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = { updatedAt: new Date() }
        if (postingDate !== undefined) updateData.postingDate = postingDate
        if (entryType !== undefined) updateData.entryType = entryType
        if (remarks !== undefined) updateData.remarks = remarks

        // If items are provided, recalculate totals and replace items
        if (items && Array.isArray(items) && items.length >= 2) {
          let totalDebit = 0
          let totalCredit = 0
          for (const item of items) {
            totalDebit += Number(item.debit || 0)
            totalCredit += Number(item.credit || 0)
          }

          const difference = Math.round((totalDebit - totalCredit) * 100) / 100
          if (difference !== 0) {
            throw new Error(`VALIDATION: Debits and credits must be equal. Difference: ${difference}`)
          }

          updateData.totalDebit = String(totalDebit)
          updateData.totalCredit = String(totalCredit)

          // Delete old items and insert new
          await tx.delete(journalEntryItems).where(eq(journalEntryItems.journalEntryId, id))

          for (const item of items) {
            await tx.insert(journalEntryItems).values({
              tenantId,
              journalEntryId: id,
              accountId: item.accountId,
              debit: String(Number(item.debit || 0)),
              credit: String(Number(item.credit || 0)),
              partyType: item.partyType || null,
              partyId: item.partyId || null,
              costCenterId: item.costCenterId || null,
              remarks: item.remarks || null,
            })
          }
        }

        const [updated] = await tx.update(journalEntries)
          .set(updateData)
          .where(eq(journalEntries.id, id))
          .returning()

        return updated
      })

      logAndBroadcast(tenantId, 'journal-entry', 'updated', id)
      return NextResponse.json(result)
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
    }
    if (err.message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This record was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (err.message?.startsWith('VALIDATION:')) {
      return NextResponse.json({ error: err.message.replace('VALIDATION: ', '') }, { status: 400 })
    }
    logError('api/accounting/journal-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to update journal entry' }, { status: 500 })
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
      const existing = await db.query.journalEntries.findFirst({
        where: eq(journalEntries.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
      }

      if (existing.status !== 'draft') {
        return NextResponse.json({ error: 'Only draft entries can be deleted' }, { status: 400 })
      }

      await db.delete(journalEntries).where(eq(journalEntries.id, id))

      logAndBroadcast(tenantId, 'journal-entry', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/journal-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to delete journal entry' }, { status: 500 })
  }
}

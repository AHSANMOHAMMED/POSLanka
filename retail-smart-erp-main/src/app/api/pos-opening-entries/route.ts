import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import {
  posOpeningEntries,
  posOpeningBalances,
  posProfiles,
  posProfileUsers,
} from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { posOpeningListSchema, createPosOpeningSchema } from '@/lib/validation/schemas/pos'

// GET list of opening entries (shifts)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, posOpeningListSchema)
    if (!parsed.success) return parsed.response
    const { status, userId, current } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // If requesting current user's open shift
      if (current) {
        const openShift = await db.query.posOpeningEntries.findFirst({
          where: and(
            eq(posOpeningEntries.userId, session.user.id),
            eq(posOpeningEntries.status, 'open')
          ),
          with: {
            posProfile: {
              with: {
                warehouse: true,
                paymentMethods: true,
              },
            },
            warehouse: true,
            balances: true,
          },
        })

        return NextResponse.json({
          shift: openShift || null,
          hasOpenShift: !!openShift,
        })
      }

      // Build where clause
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let where: any = undefined
      if (status && status !== 'all') {
        where = eq(posOpeningEntries.status, status as 'open' | 'closed' | 'cancelled')
      }
      if (userId) {
        where = where
          ? and(where, eq(posOpeningEntries.userId, userId))
          : eq(posOpeningEntries.userId, userId)
      }

      const entries = await db.query.posOpeningEntries.findMany({
        where,
        with: {
          posProfile: true,
          user: true,
          warehouse: true,
          balances: true,
        },
        orderBy: [desc(posOpeningEntries.openingTime)],
        limit: 50,
      })

      return NextResponse.json(entries)
    })
  } catch (error) {
    logError('api/pos-opening-entries', error)
    return NextResponse.json({ error: 'Failed to fetch opening entries' }, { status: 500 })
  }
}

// POST create a new opening entry (start shift)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createPosOpeningSchema)
    if (!parsed.success) return parsed.response
    const { posProfileId, openingBalances = [], notes } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists and user has access
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, posProfileId),
        with: {
          warehouse: true,
        },
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      if (!profile.warehouseId) {
        return NextResponse.json({ error: 'POS profile has no warehouse assigned. Please configure the profile first.' }, { status: 400 })
      }

      // Check user has access to this profile
      const userAccess = await db.query.posProfileUsers.findFirst({
        where: and(
          eq(posProfileUsers.posProfileId, posProfileId),
          eq(posProfileUsers.userId, session.user.id)
        ),
      })

      // Strict: only assigned users can open a shift
      if (!userAccess) {
        return NextResponse.json({ error: 'You are not assigned to this POS profile' }, { status: 403 })
      }

      // Check if user already has an open shift
      const existingShift = await db.query.posOpeningEntries.findFirst({
        where: and(
          eq(posOpeningEntries.userId, session.user.id),
          eq(posOpeningEntries.status, 'open')
        ),
      })

      if (existingShift) {
        return NextResponse.json({
          error: 'You already have an open shift. Please close it first.',
          existingShiftId: existingShift.id,
        }, { status: 400 })
      }

      // Advisory lock for atomic entry number generation.
      // withTenant already wraps in a transaction — no nested db.transaction()
      // (nested transactions reset SET LOCAL RLS context on commit).
      await db.execute(sql`SELECT pg_advisory_xact_lock(8)`)

      // Generate entry number
      const today = new Date()
      const datePrefix = `POS-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

      // Count today's entries using SQL date comparison (server-side)
      const [{ count: todayCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(posOpeningEntries)
        .where(sql`${posOpeningEntries.entryNumber} LIKE ${datePrefix + '-%'}`)

      const entryNumber = `${datePrefix}-${String(Number(todayCount) + 1).padStart(3, '0')}`

      // Create opening entry
      const [openingEntry] = await db.insert(posOpeningEntries).values({
        tenantId: session.user.tenantId,
        entryNumber,
        posProfileId,
        userId: session.user.id,
        warehouseId: profile.warehouseId!,
        openingTime: new Date(),
        status: 'open',
        notes: notes || null,
      }).returning()

      // Create opening balances
      if (openingBalances.length > 0) {
        const balanceValues = openingBalances.map((balance) => ({
          tenantId: session.user.tenantId,
          openingEntryId: openingEntry.id,
          paymentMethod: balance.paymentMethod,
          openingAmount: String(balance.amount || 0),
        }))
        await db.insert(posOpeningBalances).values(balanceValues)
      }

      // Fetch complete entry
      const completeEntry = await db.query.posOpeningEntries.findFirst({
        where: eq(posOpeningEntries.id, openingEntry.id),
        with: {
          posProfile: {
            with: {
              warehouse: true,
              paymentMethods: true,
            },
          },
          warehouse: true,
          balances: true,
          user: true,
        },
      })

      logAndBroadcast(session.user.tenantId, 'pos-shift', 'created', openingEntry.id)

      return NextResponse.json(completeEntry)
    })
  } catch (error) {
    logError('api/pos-opening-entries', error)
    console.error('POST /api/pos-opening-entries error:', error)
    return NextResponse.json({ error: 'Failed to start shift' }, { status: 500 })
  }
}

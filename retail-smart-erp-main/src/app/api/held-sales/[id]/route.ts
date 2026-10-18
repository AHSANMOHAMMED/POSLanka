import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { heldSales } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single held sale (for recall)
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

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const heldSale = await db.query.heldSales.findFirst({
        where: eq(heldSales.id, id),
        with: {
          customer: true,
          vehicle: true,
          heldByUser: true,
        },
      })

      if (!heldSale) {
        return NextResponse.json({ error: 'Held sale not found' }, { status: 404 })
      }

      return NextResponse.json(heldSale)
    })
  } catch (error) {
    logError('api/held-sales/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch held sale' }, { status: 500 })
  }
}

// DELETE held sale (after recall or manual delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [deleted] = await db.delete(heldSales)
        .where(eq(heldSales.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Held sale not found' }, { status: 404 })
      }

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'held-sale', 'deleted', id)
      logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', '', { userId: session.user.id })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/held-sales/[id]', error)
    return NextResponse.json({ error: 'Failed to delete held sale' }, { status: 500 })
  }
}

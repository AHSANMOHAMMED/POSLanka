import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantTables, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { assignServerSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// PUT assign or unassign a server to a table
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTables')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, assignServerSchema)
    if (!parsed.success) return parsed.response
    const { serverId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify table exists
      const table = await db.query.restaurantTables.findFirst({
        where: eq(restaurantTables.id, id),
      })

      if (!table) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }

      // If assigning a server, verify the user exists and is active
      if (serverId) {
        const server = await db.query.users.findFirst({
          where: eq(users.id, serverId),
        })

        if (!server) {
          return NextResponse.json({ error: 'Server (user) not found' }, { status: 404 })
        }

        if (!server.isActive) {
          return NextResponse.json({ error: 'Server (user) is inactive' }, { status: 400 })
        }
      }

      // Update the table's serverId
      const [updated] = await db
        .update(restaurantTables)
        .set({
          serverId: serverId || null,
          updatedAt: new Date(),
        })
        .where(eq(restaurantTables.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'table', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/restaurant-tables/[id]/assign-server', error)
    return NextResponse.json(
      { error: 'Failed to assign server' },
      { status: 500 }
    )
  }
}

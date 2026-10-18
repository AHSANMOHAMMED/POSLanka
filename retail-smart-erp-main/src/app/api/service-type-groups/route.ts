import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { serviceTypeGroups } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createServiceTypeGroupSchema } from '@/lib/validation/schemas/service-types'

// GET all service type groups for the tenant
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.query.serviceTypeGroups.findMany({
        with: {
          serviceTypes: true,
        },
        orderBy: (serviceTypeGroups, { asc }) => [asc(serviceTypeGroups.name)],
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/service-type-groups', error)
    return NextResponse.json({ error: 'Failed to fetch service type groups' }, { status: 500 })
  }
}

// POST create new service type group
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageServiceTypes')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createServiceTypeGroupSchema)
    if (!parsed.success) return parsed.response
    const { name, description } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [newGroup] = await db.insert(serviceTypeGroups).values({
        tenantId: session.user.tenantId,
        name,
        description: description || null,
      }).returning()

      // Broadcast service type group creation
      logAndBroadcast(session.user.tenantId, 'service-type-group', 'created', newGroup.id)

      return NextResponse.json(newGroup)
    })
  } catch (error) {
    logError('api/service-type-groups', error)
    return NextResponse.json({ error: 'Failed to create service type group' }, { status: 500 })
  }
}

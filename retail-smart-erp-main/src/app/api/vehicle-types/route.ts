import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db, withTenant } from '@/lib/db'
import { vehicleTypes, inspectionTemplates, inspectionCategories, inspectionChecklistItems } from '@/lib/db/schema'
import { eq, or, isNull, and } from 'drizzle-orm'
import { getChecklistForBodyType } from '@/lib/data/default-checklists'
import { defaultVehicleTypes } from '@/lib/data/default-vehicle-types'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createVehicleTypeSchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle types (system defaults + tenant custom)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get('includeInactive') === 'true'

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (tenantDb) => {
      // Get both system defaults (tenantId is null) and tenant-specific types
      // Note: RLS allows null tenantId for system defaults, and tenant's own records
      let whereClause = or(
        isNull(vehicleTypes.tenantId),
        eq(vehicleTypes.tenantId, session.user.tenantId)
      )

      if (!includeInactive) {
        whereClause = and(
          whereClause,
          eq(vehicleTypes.isActive, true)
        )
      }

      const result = await tenantDb.query.vehicleTypes.findMany({
        where: whereClause,
        with: {
          diagramViews: {
            orderBy: (views, { asc }) => [asc(views.sortOrder)],
          },
        },
        orderBy: (types, { asc, desc }) => [desc(types.isSystemDefault), asc(types.name)],
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/vehicle-types', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle types' }, { status: 500 })
  }
}

// POST create new vehicle type (or seed system defaults)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createVehicleTypeSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Special action to seed system defaults (uses direct db - no RLS)
    // Only owners can seed system defaults
    if ('action' in body && body.action === 'seed-defaults') {
      if (session.user.role !== 'owner') {
        return NextResponse.json({ error: 'Only owners can seed system defaults' }, { status: 403 })
      }
      return await seedSystemDefaults()
    }

    const { name, bodyType, description, wheelCount } = body as { name: string; bodyType: string; description?: string; wheelCount?: number }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (tenantDb) => {
      const [newType] = await tenantDb.insert(vehicleTypes).values({
        tenantId: session.user.tenantId,
        name,
        bodyType: bodyType as typeof vehicleTypes.bodyType.enumValues[number],
        description: description || null,
        wheelCount: wheelCount || 4,
        isSystemDefault: false,
        isActive: true,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'vehicle-type', 'created', newType.id)

      return NextResponse.json(newType)
    })
  } catch (error) {
    logError('api/vehicle-types', error)
    return NextResponse.json({ error: 'Failed to create vehicle type' }, { status: 500 })
  }
}

// Seed system default vehicle types with checklists (no diagrams - users upload their own)
// Note: This function uses direct db access since it creates system-wide defaults (tenantId = null)
async function seedSystemDefaults() {
  try {
    // Check if system defaults already exist (uses direct db - no RLS needed for system defaults)
    const existing = await db.query.vehicleTypes.findFirst({
      where: eq(vehicleTypes.isSystemDefault, true),
    })

    if (existing) {
      return NextResponse.json({ message: 'System defaults already seeded' })
    }

    // Insert all vehicle types (no diagrams - users upload their own images)
    for (const typeData of defaultVehicleTypes) {
      // Create the vehicle type
      const [newType] = await db.insert(vehicleTypes).values({
        tenantId: null, // System default
        name: typeData.name,
        bodyType: typeData.bodyType,
        description: typeData.description,
        wheelCount: typeData.wheelCount,
        isSystemDefault: true,
        isActive: true,
      }).returning()

      // Create default inspection template for this vehicle type
      const checklist = getChecklistForBodyType(typeData.bodyType)

      const [newTemplate] = await db.insert(inspectionTemplates).values({
        tenantId: null, // System default
        vehicleTypeId: newType.id,
        name: checklist.name,
        description: checklist.description,
        inspectionType: 'check_in',
        isDefault: true,
        isActive: true,
      }).returning()

      // Create categories and items
      for (let catIndex = 0; catIndex < checklist.categories.length; catIndex++) {
        const category = checklist.categories[catIndex]

        const [newCategory] = await db.insert(inspectionCategories).values({
          tenantId: null,
          templateId: newTemplate.id,
          name: category.name,
          sortOrder: catIndex,
        }).returning()

        // Create items for this category
        for (let itemIndex = 0; itemIndex < category.items.length; itemIndex++) {
          const item = category.items[itemIndex]

          await db.insert(inspectionChecklistItems).values({
            tenantId: null,
            categoryId: newCategory.id,
            itemName: item.itemName,
            itemType: item.itemType,
            options: item.options || [],
            isRequired: item.isRequired,
            sortOrder: itemIndex,
          })
        }
      }
    }

    return NextResponse.json({ message: 'System defaults seeded successfully' })
  } catch (error) {
    logError('api/vehicle-types', error)
    return NextResponse.json({ error: 'Failed to seed system defaults' }, { status: 500 })
  }
}

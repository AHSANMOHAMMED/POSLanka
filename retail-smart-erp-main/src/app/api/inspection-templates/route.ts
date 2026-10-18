import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { inspectionTemplates, inspectionCategories, inspectionChecklistItems } from '@/lib/db/schema'
import { eq, or, isNull, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { inspectionTemplatesListSchema, createInspectionTemplateSchema } from '@/lib/validation/schemas/service-types'

// GET all inspection templates (system defaults + tenant custom)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, inspectionTemplatesListSchema)
    if (!parsed.success) return parsed.response
    const { vehicleTypeId, inspectionType, includeInactive } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Base where clause: system defaults or tenant-specific
      let whereClause = or(
        isNull(inspectionTemplates.tenantId),
        eq(inspectionTemplates.tenantId, session.user.tenantId)
      )

      // Add filters if provided
      if (vehicleTypeId) {
        whereClause = and(
          whereClause,
          eq(inspectionTemplates.vehicleTypeId, vehicleTypeId)
        )
      }

      if (inspectionType) {
        whereClause = and(
          whereClause,
          eq(inspectionTemplates.inspectionType, inspectionType)
        )
      }

      if (!includeInactive) {
        whereClause = and(
          whereClause,
          eq(inspectionTemplates.isActive, true)
        )
      }

      const result = await db.query.inspectionTemplates.findMany({
        where: whereClause,
        with: {
          vehicleType: true,
          categories: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            orderBy: (cats: any, { asc }: any) => [asc(cats.sortOrder)],
            with: {
              items: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                orderBy: (items: any, { asc }: any) => [asc(items.sortOrder)],
              },
            },
          },
        },
        orderBy: (templates, { asc, desc }) => [desc(templates.isDefault), asc(templates.name)],
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/inspection-templates', error)
    return NextResponse.json({ error: 'Failed to fetch inspection templates' }, { status: 500 })
  }
}

// POST create new inspection template (or clone from existing)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInspectionTemplates')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createInspectionTemplateSchema)
    if (!parsed.success) return parsed.response
    const { name, description, vehicleTypeId, inspectionType, cloneFromId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Clone from existing template
      if (cloneFromId) {
        return await cloneTemplate(db, cloneFromId, name, session.user.tenantId)
      }

      const [newTemplate] = await db.insert(inspectionTemplates).values({
        tenantId: session.user.tenantId,
        vehicleTypeId: vehicleTypeId || null,
        name,
        description: description || null,
        inspectionType: inspectionType || 'check_in',
        isDefault: false,
        isActive: true,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'inspection-template', 'created', newTemplate.id)

      return NextResponse.json(newTemplate)
    })
  } catch (error) {
    logError('api/inspection-templates', error)
    return NextResponse.json({ error: 'Failed to create inspection template' }, { status: 500 })
  }
}

// Clone a template (system or existing) for the tenant
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cloneTemplate(db: any, sourceId: string, newName: string, tenantId: string) {
  try {
    // Get source template with all categories and items
    // Only allow cloning system defaults (null tenantId) or own templates
    const source = await db.query.inspectionTemplates.findFirst({
      where: and(
        eq(inspectionTemplates.id, sourceId),
        or(
          isNull(inspectionTemplates.tenantId),
          eq(inspectionTemplates.tenantId, tenantId)
        )
      ),
      with: {
        categories: {
          with: {
            items: true,
          },
        },
      },
    })

    if (!source) {
      return NextResponse.json({ error: 'Source template not found' }, { status: 404 })
    }

    // Create new template
    const [newTemplate] = await db.insert(inspectionTemplates).values({
      tenantId,
      vehicleTypeId: source.vehicleTypeId,
      name: newName || `${source.name} (Copy)`,
      description: source.description,
      inspectionType: source.inspectionType,
      isDefault: false,
      isActive: true,
    }).returning()

    // Clone categories and items
    for (const category of source.categories) {
      const [newCategory] = await db.insert(inspectionCategories).values({
        tenantId,
        templateId: newTemplate.id,
        name: category.name,
        sortOrder: category.sortOrder,
      }).returning()

      // Clone items for this category
      for (const item of category.items) {
        await db.insert(inspectionChecklistItems).values({
          tenantId,
          categoryId: newCategory.id,
          itemName: item.itemName,
          itemType: item.itemType,
          options: item.options,
          isRequired: item.isRequired,
          sortOrder: item.sortOrder,
        })
      }
    }

    // Fetch and return the complete cloned template
    const clonedTemplate = await db.query.inspectionTemplates.findFirst({
      where: eq(inspectionTemplates.id, newTemplate.id),
      with: {
        vehicleType: true,
        categories: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orderBy: (cats: any, { asc }: any) => [asc(cats.sortOrder)],
          with: {
            items: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              orderBy: (items: any, { asc }: any) => [asc(items.sortOrder)],
            },
          },
        },
      },
    })

    // Broadcast the change
    if (clonedTemplate) {
      logAndBroadcast(tenantId, 'inspection-template', 'created', clonedTemplate.id)
    }

    return NextResponse.json(clonedTemplate)
  } catch (error) {
    logError('api/inspection-templates', error)
    return NextResponse.json({ error: 'Failed to clone template' }, { status: 500 })
  }
}

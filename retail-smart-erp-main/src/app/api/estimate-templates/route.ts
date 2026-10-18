import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { estimateTemplates } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createEstimateTemplateSchema } from '@/lib/validation/schemas/insurance'

// E25: GET all estimate templates
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const templates = await db.query.estimateTemplates.findMany({
        where: eq(estimateTemplates.isActive, true),
        with: {
          createdByUser: {
            columns: { fullName: true }
          }
        },
        orderBy: [desc(estimateTemplates.createdAt)],
      })

      return NextResponse.json(templates)
    })
  } catch (error) {
    logError('api/estimate-templates', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

// E25: POST create a new template
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createEstimateTemplateSchema)
    if (!parsed.success) return parsed.response
    const { name, description, itemsTemplate } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [template] = await db.insert(estimateTemplates).values({
        tenantId: session.user.tenantId,
        name: name.trim(),
        description: description?.trim() || null,
        itemsTemplate: itemsTemplate || [],
        createdBy: session.user.id,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'estimate-template', 'created', template.id)

      return NextResponse.json(template)
    })
  } catch (error) {
    logError('api/estimate-templates', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}

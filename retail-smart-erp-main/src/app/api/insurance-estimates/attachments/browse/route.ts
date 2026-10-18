import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq, and, ne, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { browseAttachmentsSchema } from '@/lib/validation/schemas/insurance'

interface GroupedResult {
  estimateId: string
  estimateNo: string
  customerName: string | null
  vehicleInfo: string | null
  attachments: Array<{
    id: string
    fileName: string
    fileType: string | null
    fileSize: number | null
    filePath: string
    fileHash: string | null
    category: string | null
    createdAt: Date
  }>
}

// GET all attachments for tenant, grouped by estimate
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const parsed = validateSearchParams(request, browseAttachmentsSchema)
    if (!parsed.success) return parsed.response
    const { excludeEstimateId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Get all estimate attachment files
      const conditions = [eq(files.attachedToType, 'estimate')]
      if (excludeEstimateId) {
        conditions.push(ne(files.attachedToId, excludeEstimateId))
      }

      const attachmentFiles = await db.query.files.findMany({
        where: and(...conditions),
        orderBy: [desc(files.createdAt)],
      })

      // Get unique estimate IDs
      const estimateIds = [...new Set(attachmentFiles.map(f => f.attachedToId).filter(Boolean))] as string[]

      if (estimateIds.length === 0) {
        return NextResponse.json([])
      }

      // Fetch estimate details
      const estimates = await db.query.insuranceEstimates.findMany({
        where: (est, { inArray }) => inArray(est.id, estimateIds),
        with: {
          customer: { columns: { name: true } },
          vehicle: { columns: { make: true, model: true, licensePlate: true } },
        },
        columns: { id: true, estimateNo: true },
      })

      const estimateMap = new Map(estimates.map(e => [e.id, e]))

      // Group by estimate
      const grouped = new Map<string, GroupedResult>()

      for (const f of attachmentFiles) {
        const estimateId = f.attachedToId
        if (!estimateId) continue

        const est = estimateMap.get(estimateId)
        if (!est) continue

        if (!grouped.has(estimateId)) {
          const vehicle = Array.isArray(est.vehicle) ? est.vehicle[0] : est.vehicle
          const customer = Array.isArray(est.customer) ? est.customer[0] : est.customer
          const vehicleInfo = vehicle
            ? `${vehicle.make} ${vehicle.model}${vehicle.licensePlate ? ` (${vehicle.licensePlate})` : ''}`
            : null

          grouped.set(estimateId, {
            estimateId,
            estimateNo: est.estimateNo,
            customerName: customer?.name || null,
            vehicleInfo,
            attachments: [],
          })
        }

        grouped.get(estimateId)!.attachments.push({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          fileSize: f.fileSize,
          filePath: f.fileUrl,
          fileHash: f.contentHash,
          category: f.category,
          createdAt: f.createdAt,
        })
      }

      const result = Array.from(grouped.values()).sort((a, b) =>
        b.estimateNo.localeCompare(a.estimateNo)
      )

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/insurance-estimates/attachments/browse', error)
    return NextResponse.json({ error: 'Failed to browse attachments' }, { status: 500 })
  }
}

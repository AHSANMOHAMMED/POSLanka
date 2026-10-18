import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateItems, customers, vehicles, insuranceCompanies, insuranceAssessors } from '@/lib/db/schema'
import { eq, desc, sql, and, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { requirePermission } from '@/lib/auth/roles'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax, type LineItemInput } from '@/lib/utils/tax-recalculate'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { insuranceEstimatesListSchema, createInsuranceEstimateSchema } from '@/lib/validation/schemas/insurance'

// GET all insurance estimates for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, insuranceEstimatesListSchema)
    if (!parsed.success) return parsed.response
    const { status, insuranceCompanyId, workOrderId, customerId, search, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []
      if (customerId) {
        conditions.push(eq(insuranceEstimates.customerId, customerId))
      }
      if (workOrderId) {
        conditions.push(eq(insuranceEstimates.workOrderId, workOrderId))
      }
      if (status) {
        conditions.push(eq(insuranceEstimates.status, status as 'draft' | 'submitted' | 'under_review' | 'approved' | 'partially_approved' | 'rejected' | 'cancelled' | 'work_order_created'))
      }
      if (insuranceCompanyId) {
        conditions.push(eq(insuranceEstimates.insuranceCompanyId, insuranceCompanyId))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(insuranceEstimates.estimateNo, `%${escaped}%`),
            ilike(insuranceEstimates.claimNumber, `%${escaped}%`),
            ilike(insuranceEstimates.policyNumber, `%${escaped}%`)
          )!
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(insuranceEstimates)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.insuranceEstimates.findMany({
        where: whereClause,
        with: {
          customer: true,
          vehicle: true,
          insuranceCompany: true,
          assessor: true,
          createdByUser: true,
          items: {
            with: {
              serviceType: true,
              item: true,
            },
            orderBy: (items, { asc }) => [asc(items.sortOrder)],
          },
        },
        orderBy: [desc(insuranceEstimates.createdAt)],
        limit,
        offset,
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/insurance-estimates', error)
    return NextResponse.json({ error: 'Failed to fetch insurance estimates' }, { status: 500 })
  }
}

// Helper function to build line items for tax template calculation
function buildLineItems(items: Array<{ itemType: string; hours?: number; rate?: number; quantity?: number; unitPrice?: number; itemId?: string | null }>): LineItemInput[] {
  return items.map(item => {
    const lineTotal = item.itemType === 'service'
      ? (item.hours || 0) * (item.rate || 0)
      : (item.quantity || 0) * (item.unitPrice || 0)
    return { itemId: item.itemId || null, lineTotal }
  })
}

// POST create new insurance estimate
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createInsuranceEstimateSchema)
    if (!parsed.success) return parsed.response
    const {
      estimateType,
      customerId,
      vehicleId,
      warehouseId,
      insuranceCompanyId,
      policyNumber,
      claimNumber,
      assessorId,
      assessorName,
      assessorPhone,
      assessorEmail,
      incidentDate,
      incidentDescription,
      odometerIn,
      items,
      confirmCustomerMismatch
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Calculate totals using tax template system
      const lineItems = buildLineItems(items)
      const taxResult = await recalculateDocumentTax(db, session.user.tenantId, lineItems, { type: 'sales' })
      const { subtotal, totalTax: taxAmount, total, taxBreakdown } = taxResult

      // Validate foreign keys belong to tenant (RLS scopes the queries)
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
        }
      }

      if (vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({
          where: eq(vehicles.id, vehicleId),
        })
        if (!vehicle) {
          return NextResponse.json({ error: 'Invalid vehicle' }, { status: 400 })
        }

        // Check if vehicle belongs to the specified customer
        if (customerId && vehicle.customerId && vehicle.customerId !== customerId && !confirmCustomerMismatch) {
          // Get vehicle owner's name for the warning
          const vehicleOwner = await db.query.customers.findFirst({
            where: eq(customers.id, vehicle.customerId),
          })
          return NextResponse.json({
            error: 'CUSTOMER_VEHICLE_MISMATCH',
            message: `This vehicle belongs to "${vehicleOwner?.name || 'another customer'}". Do you want to proceed?`,
            vehicleOwnerName: vehicleOwner?.name || 'another customer',
            vehicleOwnerId: vehicle.customerId,
          }, { status: 409 })
        }
      }

      if (insuranceCompanyId) {
        const company = await db.query.insuranceCompanies.findFirst({
          where: eq(insuranceCompanies.id, insuranceCompanyId),
        })
        if (!company) {
          return NextResponse.json({ error: 'Invalid insurance company' }, { status: 400 })
        }
      }

      if (assessorId) {
        const assessor = await db.query.insuranceAssessors.findFirst({
          where: eq(insuranceAssessors.id, assessorId),
        })
        if (!assessor) {
          return NextResponse.json({ error: 'Invalid assessor' }, { status: 400 })
        }
      }

      // E8: Pre-check for duplicate claim number (fast UX feedback) - RLS scopes
      if (estimateType === 'insurance' && claimNumber) {
        const existingClaim = await db.query.insuranceEstimates.findFirst({
          where: and(
            eq(insuranceEstimates.claimNumber, claimNumber),
            eq(insuranceEstimates.estimateType, 'insurance')
          ),
        })
        if (existingClaim) {
          return NextResponse.json({
            error: `An estimate with claim number "${claimNumber}" already exists (${existingClaim.estimateNo})`
          }, { status: 400 })
        }
      }

      // Create estimate in transaction with atomic number generation and race condition prevention
      const result = await db.transaction(async (tx) => {
        // Re-verify claim number uniqueness inside transaction to prevent race conditions (RLS scopes)
        if (estimateType === 'insurance' && claimNumber) {
          const existingClaimInTx = await tx.query.insuranceEstimates.findFirst({
            where: and(
              eq(insuranceEstimates.claimNumber, claimNumber),
              eq(insuranceEstimates.estimateType, 'insurance')
            ),
          })
          if (existingClaimInTx) {
            throw new Error(`DUPLICATE_CLAIM:${existingClaimInTx.estimateNo}`)
          }
        }

        // Advisory lock prevents duplicate estimate numbers under concurrent load
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('insurance_estimate_' || ${session.user.tenantId}))`)

        // Generate estimate number atomically inside transaction (RLS scopes)
        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${insuranceEstimates.estimateNo})` })
          .from(insuranceEstimates)

      const lastEstimateNo = maxResult?.maxNo
      const nextNumber = lastEstimateNo ? parseInt(lastEstimateNo.replace(/\D/g, '')) + 1 : 1
      const estimateNo = `EST-${String(nextNumber).padStart(6, '0')}`

      const [newEstimate] = await tx.insert(insuranceEstimates).values({
        tenantId: session.user.tenantId,
        estimateNo,
        estimateType: estimateType as 'insurance' | 'direct',
        customerId: customerId || null,
        vehicleId: vehicleId || null,
        warehouseId: warehouseId || null,
        insuranceCompanyId: insuranceCompanyId || null,
        policyNumber: policyNumber || null,
        claimNumber: claimNumber || null,
        assessorId: assessorId || null,
        assessorName: assessorName || null,
        assessorPhone: assessorPhone || null,
        assessorEmail: assessorEmail || null,
        incidentDate: incidentDate || null,
        incidentDescription: incidentDescription || null,
        odometerIn: odometerIn || null,
        status: 'draft',
        revisionNumber: 1,
        originalSubtotal: String(subtotal),
        originalTaxAmount: String(taxAmount),
        originalTotal: String(total),
        taxBreakdown: taxBreakdown,
        approvedSubtotal: '0',
        approvedTaxAmount: '0',
        approvedTotal: '0',
        createdBy: userId,
      }).returning()

      // Insert items if provided
      if (items.length > 0) {
        await tx.insert(insuranceEstimateItems).values(
          items.map((item, index: number) => {
            const amount = item.itemType === 'service'
              ? (item.hours || 0) * (item.rate || 0)
              : (item.quantity || 0) * (item.unitPrice || 0)

            return {
              tenantId: session.user.tenantId,
              estimateId: newEstimate.id,
              itemType: item.itemType,
              serviceTypeId: item.serviceTypeId || null,
              description: item.description || null,
              hours: item.hours ? String(item.hours) : null,
              rate: item.rate ? String(item.rate) : null,
              itemId: item.itemId || null,
              partName: item.partName || null,
              quantity: item.quantity ? String(item.quantity) : null,
              unitPrice: item.unitPrice ? String(item.unitPrice) : null,
              originalAmount: String(amount),
              status: 'pending' as const,
              sortOrder: index,
            }
          })
        )
      }

        return newEstimate
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'estimate', 'created', result.id, {
        userId,
        entityName: result.estimateNo,
        description: generateActivityDescription('create', 'insurance estimate', result.estimateNo),
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/insurance-estimates', error)
    console.error('POST /api/insurance-estimates error:', error)

    // Handle duplicate claim number race condition (business logic error, safe to expose)
    if (message.startsWith('DUPLICATE_CLAIM:')) {
      const existingEstimateNo = message.replace('DUPLICATE_CLAIM:', '')
      return NextResponse.json({
        error: `An estimate with this claim number already exists (${existingEstimateNo})`
      }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to create insurance estimate' }, { status: 500 })
  }
}

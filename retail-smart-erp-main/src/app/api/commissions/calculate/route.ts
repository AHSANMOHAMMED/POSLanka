import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { commissions, commissionRates, sales, workOrders, users } from '@/lib/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { calculateCommissionSchema } from '@/lib/validation/schemas/commissions'

interface CommissionCalculation {
  itemName: string
  amount: number
  rate: number
  rateType: string
  commissionAmount: number
  serviceTypeId?: string | null
  categoryId?: string | null
}

// Helper function to find the best matching commission rate
// Priority: user-specific > service-type > category > default
async function findCommissionRate(
  db: Parameters<Parameters<typeof withTenant>[1]>[0],
  userId: string,
  serviceTypeId?: string | null,
  categoryId?: string | null
): Promise<{ rate: number; rateType: string } | null> {
  // 1. Try user + service type specific rate
  if (serviceTypeId) {
    const userServiceRate = await db.query.commissionRates.findFirst({
      where: and(
        eq(commissionRates.userId, userId),
        eq(commissionRates.serviceTypeId, serviceTypeId),
        eq(commissionRates.isActive, true)
      ),
    })
    if (userServiceRate) {
      return { rate: parseFloat(userServiceRate.rate), rateType: userServiceRate.rateType }
    }
  }

  // 2. Try user + category specific rate
  if (categoryId) {
    const userCategoryRate = await db.query.commissionRates.findFirst({
      where: and(
        eq(commissionRates.userId, userId),
        eq(commissionRates.categoryId, categoryId),
        eq(commissionRates.isActive, true)
      ),
    })
    if (userCategoryRate) {
      return { rate: parseFloat(userCategoryRate.rate), rateType: userCategoryRate.rateType }
    }
  }

  // 3. Try user-specific default rate (no service type or category)
  const userDefaultRate = await db.query.commissionRates.findFirst({
    where: and(
      eq(commissionRates.userId, userId),
      isNull(commissionRates.serviceTypeId),
      isNull(commissionRates.categoryId),
      eq(commissionRates.isActive, true)
    ),
  })
  if (userDefaultRate) {
    return { rate: parseFloat(userDefaultRate.rate), rateType: userDefaultRate.rateType }
  }

  // 4. Try service type rate (no user)
  if (serviceTypeId) {
    const serviceTypeRate = await db.query.commissionRates.findFirst({
      where: and(
        isNull(commissionRates.userId),
        eq(commissionRates.serviceTypeId, serviceTypeId),
        eq(commissionRates.isActive, true)
      ),
    })
    if (serviceTypeRate) {
      return { rate: parseFloat(serviceTypeRate.rate), rateType: serviceTypeRate.rateType }
    }
  }

  // 5. Try category rate (no user)
  if (categoryId) {
    const categoryRate = await db.query.commissionRates.findFirst({
      where: and(
        isNull(commissionRates.userId),
        eq(commissionRates.categoryId, categoryId),
        eq(commissionRates.isActive, true)
      ),
    })
    if (categoryRate) {
      return { rate: parseFloat(categoryRate.rate), rateType: categoryRate.rateType }
    }
  }

  // 6. Try default rate (no user, no service type, no category)
  const defaultRate = await db.query.commissionRates.findFirst({
    where: and(
      isNull(commissionRates.userId),
      isNull(commissionRates.serviceTypeId),
      isNull(commissionRates.categoryId),
      eq(commissionRates.isActive, true)
    ),
  })
  if (defaultRate) {
    return { rate: parseFloat(defaultRate.rate), rateType: defaultRate.rateType }
  }

  return null
}

// Calculate commission amount based on rate type
function calculateCommissionAmount(amount: number, rate: number, rateType: string): number {
  if (rateType === 'percentage') {
    return roundCurrency(amount * rate / 100)
  } else {
    // Fixed rate per item/service
    return roundCurrency(rate)
  }
}

// POST calculate and create commission for a sale or work order
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, calculateCommissionSchema)
    if (!parsed.success) return parsed.response
    const { saleId, workOrderId, userId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify user exists
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const calculations: CommissionCalculation[] = []

      if (saleId) {
        // Process sale commission
        const sale = await db.query.sales.findFirst({
          where: eq(sales.id, saleId),
          with: {
            items: {
              with: {
                item: true,
              },
            },
          },
        })

        if (!sale) {
          return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
        }

        // Check if commission already exists for this sale and user
        const existingCommission = await db.query.commissions.findFirst({
          where: and(
            eq(commissions.saleId, saleId),
            eq(commissions.userId, userId)
          ),
        })

        if (existingCommission) {
          return NextResponse.json({
            error: 'Commission already calculated for this sale and user'
          }, { status: 400 })
        }

        // Calculate commission for each sale item
        for (const saleItem of sale.items) {
          const categoryId = saleItem.item?.categoryId || null
          const amount = parseCurrency(saleItem.total)

          // Find applicable commission rate
          const rateConfig = await findCommissionRate(db, userId, null, categoryId)

          if (rateConfig) {
            const commissionAmount = calculateCommissionAmount(amount, rateConfig.rate, rateConfig.rateType)

            if (commissionAmount > 0) {
              calculations.push({
                itemName: saleItem.itemName || saleItem.item?.name || 'Unknown Item',
                amount,
                rate: rateConfig.rate,
                rateType: rateConfig.rateType,
                commissionAmount,
                categoryId,
              })
            }
          }
        }

        // If no item-level commissions, try sale-level commission
        if (calculations.length === 0) {
          const totalAmount = parseCurrency(sale.total)
          const rateConfig = await findCommissionRate(db, userId, null, null)

          if (rateConfig) {
            const commissionAmount = calculateCommissionAmount(totalAmount, rateConfig.rate, rateConfig.rateType)

            if (commissionAmount > 0) {
              calculations.push({
                itemName: `Sale ${sale.invoiceNo}`,
                amount: totalAmount,
                rate: rateConfig.rate,
                rateType: rateConfig.rateType,
                commissionAmount,
              })
            }
          }
        }

      } else if (workOrderId) {
        // Process work order commission
        const workOrder = await db.query.workOrders.findFirst({
          where: eq(workOrders.id, workOrderId),
          with: {
            services: {
              with: {
                serviceType: true,
              },
            },
            parts: {
              with: {
                item: true,
              },
            },
          },
        })

        if (!workOrder) {
          return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
        }

        // Check if commission already exists for this work order and user
        const existingCommission = await db.query.commissions.findFirst({
          where: and(
            eq(commissions.workOrderId, workOrderId),
            eq(commissions.userId, userId)
          ),
        })

        if (existingCommission) {
          return NextResponse.json({
            error: 'Commission already calculated for this work order and user'
          }, { status: 400 })
        }

        // Calculate commission for services (labor)
        for (const service of workOrder.services) {
          const serviceTypeId = service.serviceTypeId || null
          // Fix #9: Round intermediate amount before commission calculation
          const amount = roundCurrency(parseCurrency(service.hours) * parseCurrency(service.rate))

          // Find applicable commission rate for service
          const rateConfig = await findCommissionRate(db, userId, serviceTypeId, null)

          if (rateConfig) {
            const commissionAmount = calculateCommissionAmount(amount, rateConfig.rate, rateConfig.rateType)

            if (commissionAmount > 0) {
              calculations.push({
                itemName: service.description || service.serviceType?.name || 'Service',
                amount,
                rate: rateConfig.rate,
                rateType: rateConfig.rateType,
                commissionAmount,
                serviceTypeId,
              })
            }
          }
        }

        // Calculate commission for parts
        for (const part of workOrder.parts) {
          const categoryId = part.item?.categoryId || null
          // Fix #9: Round intermediate amount before commission calculation
          const amount = roundCurrency(parseCurrency(part.quantity) * parseCurrency(part.unitPrice))

          // Find applicable commission rate for part
          const rateConfig = await findCommissionRate(db, userId, null, categoryId)

          if (rateConfig) {
            const commissionAmount = calculateCommissionAmount(amount, rateConfig.rate, rateConfig.rateType)

            if (commissionAmount > 0) {
              calculations.push({
                itemName: part.item?.name || 'Part',
                amount,
                rate: rateConfig.rate,
                rateType: rateConfig.rateType,
                commissionAmount,
                categoryId,
              })
            }
          }
        }

        // If no item-level commissions, try work order-level commission
        if (calculations.length === 0) {
          const totalAmount = parseCurrency(workOrder.total)
          const rateConfig = await findCommissionRate(db, userId, null, null)

          if (rateConfig) {
            const commissionAmount = calculateCommissionAmount(totalAmount, rateConfig.rate, rateConfig.rateType)

            if (commissionAmount > 0) {
              calculations.push({
                itemName: `Work Order ${workOrder.orderNo}`,
                amount: totalAmount,
                rate: rateConfig.rate,
                rateType: rateConfig.rateType,
                commissionAmount,
              })
            }
          }
        }
      }

      // No commissions to create
      if (calculations.length === 0) {
        return NextResponse.json({
          message: 'No applicable commission rate found',
          commissions: [],
          totalCommission: 0,
        })
      }

      // Create commission records in transaction with duplicate re-check (FOR UPDATE)
      const createdCommissions = await db.transaction(async (tx) => {
        // Re-check for duplicates inside transaction with lock to prevent race conditions
        const duplicateCheck = saleId
          ? await tx.select({ id: commissions.id }).from(commissions)
              .where(and(eq(commissions.saleId, saleId), eq(commissions.userId, userId)))
              .for('update')
          : workOrderId
          ? await tx.select({ id: commissions.id }).from(commissions)
              .where(and(eq(commissions.workOrderId, workOrderId), eq(commissions.userId, userId)))
              .for('update')
          : []

        if (duplicateCheck.length > 0) {
          throw new Error('COMMISSION_ALREADY_EXISTS')
        }

        const results = []

        for (const calc of calculations) {
          const [newCommission] = await tx.insert(commissions).values({
            tenantId: session!.user.tenantId,
            userId,
            saleId: saleId || null,
            workOrderId: workOrderId || null,
            itemName: calc.itemName,
            amount: String(calc.amount),
            rate: String(calc.rate),
            rateType: calc.rateType,
            commissionAmount: String(calc.commissionAmount),
            status: 'pending',
          }).returning()

          results.push(newCommission)
        }

        return results
      })

      // Calculate total commission
      const totalCommission = calculations.reduce((sum, calc) => sum + calc.commissionAmount, 0)

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'commission', 'created', createdCommissions[0]?.id || 'bulk')

      return NextResponse.json({
        message: 'Commission calculated successfully',
        commissions: createdCommissions,
        calculations,
        totalCommission: roundCurrency(totalCommission),
      })
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'COMMISSION_ALREADY_EXISTS') {
      return NextResponse.json({ error: 'Commission already calculated for this user' }, { status: 409 })
    }
    logError('api/commissions/calculate', error)
    return NextResponse.json({ error: 'Failed to calculate commission' }, { status: 500 })
  }
}

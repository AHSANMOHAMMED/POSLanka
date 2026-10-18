import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posProfiles, posProfileUsers, posProfilePaymentMethods, posProfileItemGroups } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePosProfileSchema } from '@/lib/validation/schemas/pos'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET a single POS profile
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

    return await withTenant(session.user.tenantId, async (db) => {
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
        with: {
          warehouse: true,
          defaultCustomer: true,
          costCenter: true,
          paymentMethods: {
            orderBy: (pm, { asc }) => [asc(pm.sortOrder)],
          },
          users: {
            with: {
              user: true,
            },
          },
          itemGroups: {
            with: {
              category: true,
            },
          },
        },
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      return NextResponse.json(profile)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch POS profile' }, { status: 500 })
  }
}

// PUT update a POS profile
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updatePosProfileSchema)
    if (!parsed.success) return parsed.response

    return await withTenant(session.user.tenantId, async (db) => {
      // Check if profile exists
      const existing = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      const {
        name,
        code,
        warehouseId,
        defaultCustomerId,
        costCenterId,
        isDefault,
        applyDiscountOn,
        allowRateChange,
        allowDiscountChange,
        maxDiscountPercent,
        allowNegativeStock,
        validateStockOnSave,
        hideUnavailableItems,
        autoAddItemToCart,
        printReceiptOnComplete,
        skipPrintPreview,
        receiptPrintFormat,
        showLogoOnReceipt,
        receiptHeader,
        receiptFooter,
        defaultPaymentMethod,
        allowCreditSale,
        status,
        paymentMethods,
        userIds,
        userAssignments,
        categoryIds,
      } = parsed.data

      // If setting as default, unset other defaults
      if (isDefault === true && !existing.isDefault) {
        await db.update(posProfiles)
          .set({ isDefault: false })
          .where(and(
            eq(posProfiles.isDefault, true),
          ))
      }

      // Build update object with only provided fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = { updatedAt: new Date() }
      if (name !== undefined) updateData.name = name.trim()
      if (code !== undefined) updateData.code = code?.trim() || null
      if (warehouseId !== undefined) updateData.warehouseId = warehouseId || null
      if (defaultCustomerId !== undefined) updateData.defaultCustomerId = defaultCustomerId || null
      if (costCenterId !== undefined) updateData.costCenterId = costCenterId || null
      if (isDefault !== undefined) updateData.isDefault = isDefault
      if (applyDiscountOn !== undefined) updateData.applyDiscountOn = applyDiscountOn
      if (allowRateChange !== undefined) updateData.allowRateChange = allowRateChange
      if (allowDiscountChange !== undefined) updateData.allowDiscountChange = allowDiscountChange
      if (maxDiscountPercent !== undefined) updateData.maxDiscountPercent = String(maxDiscountPercent)
      if (allowNegativeStock !== undefined) updateData.allowNegativeStock = allowNegativeStock
      if (validateStockOnSave !== undefined) updateData.validateStockOnSave = validateStockOnSave
      if (hideUnavailableItems !== undefined) updateData.hideUnavailableItems = hideUnavailableItems
      if (autoAddItemToCart !== undefined) updateData.autoAddItemToCart = autoAddItemToCart
      if (printReceiptOnComplete !== undefined) updateData.printReceiptOnComplete = printReceiptOnComplete
      if (skipPrintPreview !== undefined) updateData.skipPrintPreview = skipPrintPreview
      if (receiptPrintFormat !== undefined) updateData.receiptPrintFormat = receiptPrintFormat
      if (showLogoOnReceipt !== undefined) updateData.showLogoOnReceipt = showLogoOnReceipt
      if (receiptHeader !== undefined) updateData.receiptHeader = receiptHeader || null
      if (receiptFooter !== undefined) updateData.receiptFooter = receiptFooter || null
      if (defaultPaymentMethod !== undefined) updateData.defaultPaymentMethod = defaultPaymentMethod
      if (allowCreditSale !== undefined) updateData.allowCreditSale = allowCreditSale
      if (status !== undefined) updateData.status = status

      // Update main profile
      await db.update(posProfiles)
        .set(updateData)
        .where(eq(posProfiles.id, id))
        .returning()

      // Update related records (withTenant already wraps in a transaction —
      // no nested db.transaction() which resets SET LOCAL RLS context).
      // Update payment methods if provided
      if (paymentMethods !== undefined) {
        await db.delete(posProfilePaymentMethods)
          .where(eq(posProfilePaymentMethods.posProfileId, id))

        if (paymentMethods.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pmValues = paymentMethods.map((method: any, index: number) => {
            if (typeof method === 'string') {
              return {
                tenantId: session.user.tenantId,
                posProfileId: id,
                paymentMethod: method,
                isDefault: index === 0,
                allowInReturns: true,
                sortOrder: index,
              }
            }
            return {
              tenantId: session.user.tenantId,
              posProfileId: id,
              paymentMethod: method.paymentMethod || method.method,
              isDefault: !!method.isDefault,
              allowInReturns: method.allowInReturns !== false,
              sortOrder: method.sortOrder ?? index,
            }
          })
          await db.insert(posProfilePaymentMethods).values(pmValues)
        }
      }

      // Update user assignments if provided
      const resolvedUserAssignments = userAssignments || (userIds !== undefined ? userIds.map((uid: string) => ({ userId: uid })) : undefined)
      if (resolvedUserAssignments !== undefined) {
        await db.delete(posProfileUsers)
          .where(eq(posProfileUsers.posProfileId, id))

        if (resolvedUserAssignments.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const userValues = resolvedUserAssignments.map((ua: any, index: number) => ({
            tenantId: session.user.tenantId,
            posProfileId: id,
            userId: ua.userId || ua,
            isDefault: ua.isDefault ?? index === 0,
          }))
          await db.insert(posProfileUsers).values(userValues)
        }
      }

      // Update category filters if provided
      if (categoryIds !== undefined) {
        await db.delete(posProfileItemGroups)
          .where(eq(posProfileItemGroups.posProfileId, id))

        if (categoryIds.length > 0) {
          const catValues = categoryIds.map((categoryId: string) => ({
            tenantId: session.user.tenantId,
            posProfileId: id,
            categoryId,
          }))
          await db.insert(posProfileItemGroups).values(catValues)
        }
      }

      // Fetch complete updated profile
      const completeProfile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
        with: {
          warehouse: true,
          defaultCustomer: true,
          costCenter: true,
          paymentMethods: {
            orderBy: (pm, { asc }) => [asc(pm.sortOrder)],
          },
          users: {
            with: {
              user: true,
            },
          },
          itemGroups: {
            with: {
              category: true,
            },
          },
        },
      })

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json(completeProfile)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]', error)
    console.error('PUT /api/pos-profiles/[id] error:', error)
    return NextResponse.json({ error: 'Failed to update POS profile' }, { status: 500 })
  }
}

// DELETE a POS profile
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check if profile exists
      const existing = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      // Check if this is the only profile
      const profileCount = await db.query.posProfiles.findMany({
        where: eq(posProfiles.status, 'active'),
      })

      if (profileCount.length === 1 && profileCount[0].id === id) {
        return NextResponse.json({
          error: 'Cannot delete the only active POS profile. Create another profile first.',
        }, { status: 400 })
      }

      // Delete the profile (cascades will handle child records)
      await db.delete(posProfiles).where(eq(posProfiles.id, id))

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/pos-profiles/[id]', error)
    return NextResponse.json({ error: 'Failed to delete POS profile' }, { status: 500 })
  }
}

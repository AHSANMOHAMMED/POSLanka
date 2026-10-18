import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posProfiles, posProfileUsers, posProfilePaymentMethods, warehouses } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createPosProfileSchema } from '@/lib/validation/schemas/pos'

// GET current user's POS profiles (profiles they have access to)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please select a company first.' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const all = searchParams.get('all') === 'true'

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // For settings page (all=true), managers/owners see ALL tenant profiles
      if (all) {
        const canManage = ['owner', 'manager', 'system_manager'].includes(session.user.role)
        if (canManage) {
          const allProfiles = await db.query.posProfiles.findMany({
            with: {
              warehouse: true,
              paymentMethods: true,
              defaultCustomer: true,
              costCenter: true,
              users: { with: { user: true } },
            },
            orderBy: (p, { desc }) => [desc(p.isDefault), desc(p.createdAt)],
          })
          return NextResponse.json(allProfiles)
        }
      }

      // Get all profiles the user has access to
      const userProfiles = await db.query.posProfileUsers.findMany({
        where: eq(posProfileUsers.userId, session.user.id),
        with: {
          posProfile: {
            with: {
              warehouse: true,
              paymentMethods: true,
              defaultCustomer: true,
              costCenter: true,
            },
          },
        },
      })

      // Get the user's default profile
      const defaultProfileUser = userProfiles.find(pu => pu.isDefault)
      const defaultProfile = defaultProfileUser?.posProfile

      // If no profiles assigned, return empty — strict user-only access
      if (userProfiles.length === 0) {
        return NextResponse.json({
          profile: null,
          profiles: [],
          needsSetup: true,
        })
      }

      const profiles = userProfiles.map(pu => ({
        ...pu.posProfile,
        isUserDefault: pu.isDefault,
      }))

      // Return all profiles or the default/first profile
      if (all) {
        return NextResponse.json(profiles)
      }

      return NextResponse.json({
        profile: defaultProfile || profiles[0] || null,
        profiles,
        needsSetup: false,
      })
    })
  } catch (error) {
    logError('api/pos-profiles', error)
    return NextResponse.json({ error: 'Failed to fetch POS profiles' }, { status: 500 })
  }
}

// POST create a new POS profile
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please select a company first.' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createPosProfileSchema)
    if (!parsed.success) return parsed.response
    const {
      name,
      code,
      warehouseId,
      costCenterId,
      isDefault,
      applyDiscountOn,
      // Permissions
      allowRateChange,
      allowDiscountChange,
      maxDiscountPercent,
      allowNegativeStock,
      validateStockOnSave,
      // Display
      hideUnavailableItems,
      autoAddItemToCart,
      // Print
      printReceiptOnComplete,
      skipPrintPreview,
      receiptPrintFormat,
      showLogoOnReceipt,
      receiptHeader,
      receiptFooter,
      // Payment
      defaultPaymentMethod,
      allowCreditSale,
      // Payment methods to enable
      paymentMethods,
      // Users to assign
      userIds,
      userAssignments,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify warehouse exists
      const warehouse = await db.query.warehouses.findFirst({
        where: and(
          eq(warehouses.id, warehouseId),
          eq(warehouses.isActive, true)
        ),
      })
      if (!warehouse) {
        return NextResponse.json({ error: 'Warehouse not found or inactive' }, { status: 404 })
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await db.update(posProfiles)
          .set({ isDefault: false })
          .where(eq(posProfiles.isDefault, true))
      }

      // Create the profile
      const [profile] = await db.insert(posProfiles).values({
        tenantId: session.user.tenantId,
        name: name.trim(),
        code: code?.trim() || null,
        warehouseId: warehouseId || null,
        costCenterId: costCenterId || null,
        isDefault: isDefault || false,
        applyDiscountOn,
        allowRateChange,
        allowDiscountChange,
        maxDiscountPercent: String(maxDiscountPercent),
        allowNegativeStock,
        validateStockOnSave,
        hideUnavailableItems,
        autoAddItemToCart,
        printReceiptOnComplete,
        skipPrintPreview,
        receiptPrintFormat,
        showLogoOnReceipt,
        receiptHeader: receiptHeader || null,
        receiptFooter: receiptFooter || null,
        defaultPaymentMethod,
        allowCreditSale,
        status: 'active',
      }).returning()

      // Add payment methods
      if (paymentMethods && paymentMethods.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pmValues = paymentMethods.map((method: any, index: number) => ({
          tenantId: session.user.tenantId,
          posProfileId: profile.id,
          paymentMethod: typeof method === 'string' ? method : method.paymentMethod,
          isDefault: typeof method === 'string' ? index === 0 : !!method.isDefault,
          allowInReturns: typeof method === 'string' ? true : !!method.allowInReturns,
          sortOrder: typeof method === 'string' ? index : (method.sortOrder ?? index),
          accountId: typeof method === 'string' ? null : (method.accountId || null),
        }))
        await db.insert(posProfilePaymentMethods).values(pmValues)
      }

      // Assign users (accepts both userIds array or userAssignments objects from modal)
      const resolvedUsers = userAssignments || (userIds.length > 0 ? userIds.map((uid: string) => ({ userId: uid })) : [])
      if (resolvedUsers.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userValues = resolvedUsers.map((ua: any, index: number) => ({
          tenantId: session.user.tenantId,
          posProfileId: profile.id,
          userId: ua.userId || ua,
          isDefault: ua.isDefault ?? index === 0,
        }))
        await db.insert(posProfileUsers).values(userValues)
      }

      // Fetch complete profile
      const completeProfile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, profile.id),
        with: {
          warehouse: true,
          paymentMethods: true,
          costCenter: true,
          users: {
            with: {
              user: true,
            },
          },
        },
      })

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'created', profile.id)

      return NextResponse.json(completeProfile)
    })
  } catch (error) {
    logError('api/pos-profiles', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message.includes('violates foreign key constraint')) {
      return NextResponse.json({ error: 'Invalid reference (warehouse or user not found)' }, { status: 400 })
    }
    if (message.includes('unique constraint')) {
      return NextResponse.json({ error: 'A profile with this code already exists' }, { status: 409 })
    }

    return NextResponse.json({ error: 'Failed to create POS profile' }, { status: 500 })
  }
}

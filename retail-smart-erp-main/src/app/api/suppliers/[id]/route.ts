import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { requireAnyPermission, SUPPLIER_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'
import { withTenant } from '@/lib/db'
import { suppliers, purchaseOrders, purchases } from '@/lib/db/schema'
import { eq, and, ne, notInArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSupplierSchema } from '@/lib/validation/schemas/suppliers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { moveToRecycleBin } from '@/lib/recycle-bin'

// GET single supplier
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requireAnyPermission(session, SUPPLIER_VIEW_PERMISSIONS)
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const supplier = await db.query.suppliers.findFirst({
        where: eq(suppliers.id, id),
      })

      if (!supplier) {
        return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
      }

      return NextResponse.json(supplier)
    })
  } catch (error) {
    logError('api/suppliers/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch supplier' }, { status: 500 })
  }
}

// PUT update supplier
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePurchases')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateSupplierSchema)
    if (!parsed.success) return parsed.response
    const { name, email, phone, address, taxId, taxInclusive, isActive, paymentTermsTemplateId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate supplier name (excluding current supplier) - RLS scopes
      const existingSupplier = await db.query.suppliers.findFirst({
        where: and(
          eq(suppliers.name, name.trim()),
          ne(suppliers.id, id)
        ),
      })
      if (existingSupplier) {
        return NextResponse.json({ error: 'A supplier with this name already exists' }, { status: 400 })
      }

      const [updated] = await db.update(suppliers)
        .set({
          name: name.trim(),
          email: email || null,
          phone: phone || null,
          address: address || null,
          taxId: taxId || null,
          taxInclusive: taxInclusive ?? false,
          isActive: isActive ?? true,
          paymentTermsTemplateId: paymentTermsTemplateId || null,
        })
        .where(eq(suppliers.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'supplier', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/suppliers/[id]', error)
    return NextResponse.json({ error: 'Failed to update supplier' }, { status: 500 })
  }
}

// DELETE supplier
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePurchases')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const current = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) })
      if (!current) {
        return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
      }

      // Open work and money owed must be settled first (the archived supplier is hidden everywhere)
      const activePO = await db.query.purchaseOrders.findFirst({
        where: and(
          eq(purchaseOrders.supplierId, id),
          notInArray(purchaseOrders.status, ['cancelled', 'invoice_created'])
        ),
      })
      if (activePO) {
        return NextResponse.json(
          { error: 'Cannot move a supplier with active purchase orders to the recycle bin. Please complete or cancel them first.' },
          { status: 400 }
        )
      }

      const unpaidPurchase = await db.query.purchases.findFirst({
        where: and(
          eq(purchases.supplierId, id),
          notInArray(purchases.status, ['cancelled', 'paid'])
        ),
      })
      if (unpaidPurchase) {
        return NextResponse.json(
          { error: 'Cannot move a supplier with unpaid purchases to the recycle bin. Please complete payments or cancel them first.' },
          { status: 400 }
        )
      }

      if (Math.abs(parseFloat(current.balance || '0')) >= 0.005) {
        return NextResponse.json(
          { error: `Cannot move a supplier with an outstanding balance (${parseFloat(current.balance || '0').toFixed(2)}) to the recycle bin. Settle it first.` },
          { status: 400 }
        )
      }

      // Vendors never hard-delete: archive + recycle bin (history keeps pointing at the supplier;
      // only a super admin can restore or purge it)
      const binned = await moveToRecycleBin(db, {
        tenantId: session.user.tenantId, entityType: 'supplier', entityId: id,
        userId: session.user.id, userName: session.user.name,
      })
      if (!binned) {
        return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'supplier', 'deleted', id)

      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/suppliers/[id]', error)
    return NextResponse.json({ error: 'Failed to delete supplier' }, { status: 500 })
  }
}

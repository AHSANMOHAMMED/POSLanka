import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { sales, tenants } from '@/lib/db/schema'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { hasAnyPermission } from '@/lib/auth/field-access'
import { validateSearchParams } from '@/lib/validation/helpers'
import { loadSales, warrantyEndOf } from '@/lib/installments/sale-lookup'
import { tenantToday } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'

const schema = z.object({
  saleId: z.string().uuid().optional(),
  serialNumberId: z.string().uuid().optional(),
}).refine((v) => !!v.saleId || !!v.serialNumberId, 'saleId or serialNumberId is required')

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || (Array.isArray(res) ? (res as T[]) : [])
}

/**
 * GET /api/warranty-card?saleId= | ?serialNumberId= — data for the customer's warranty card:
 * shop, invoice, customer and each sold line with a warranty (serial / IMEI, warranty until).
 * From a serial number, the latest (non-return) sale of that unit and only its line.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasAnyPermission(session, ['createSales', 'manageSales', 'viewReports', 'manageItems', 'manageInventory'])) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    const parsed = validateSearchParams(request, schema)
    if (!parsed.success) return parsed.response
    const tenantId = session.user.tenantId
    const today = await tenantToday(tenantId)

    return await withTenant(tenantId, async (db) => {
      let saleId = parsed.data.saleId || null
      const onlySerial = parsed.data.serialNumberId || null
      if (!saleId && onlySerial) {
        const [hit] = rowsOf<{ sale_id: string }>(await db.execute(sql`
          SELECT si.sale_id FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.serial_number_ids @> to_jsonb(ARRAY[${onlySerial}::text]) AND s.is_return = false AND s.status <> 'void'
          ORDER BY s.created_at DESC LIMIT 1
        `))
        if (!hit) return NextResponse.json({ error: 'This unit has not been sold yet', code: 'NOT_SOLD' }, { status: 404 })
        saleId = hit.sale_id
      }
      const denied = await assertRecordBranch(session, db, sales, saleId!, { includeUnassigned: true })
      if (denied) return denied
      const [sale] = await loadSales(db, [saleId!])
      if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

      // IMEIs of the units (0193)
      const serialIds = sale.lines.flatMap((l) => l.serialNumbers.map((s) => s.id))
      const imeis = serialIds.length
        ? rowsOf<{ id: string; imei: string | null; imei2: string | null }>(await db.execute(sql`
            SELECT id, imei, imei2 FROM item_serial_numbers WHERE id IN (${sql.join(serialIds.map((id) => sql`${id}::uuid`), sql`, `)})
          `))
        : []
      const imeiById = new Map(imeis.map((r) => [r.id, r]))

      const lines = sale.lines
        .map((l) => {
          const units = l.serialNumbers
            .filter((s) => !onlySerial || s.id === onlySerial)
            .map((s) => {
              const end = warrantyEndOf(l, s.warrantyEndDate)
              return {
                id: s.id, serialNumber: s.serialNumber, imei: imeiById.get(s.id)?.imei || null, imei2: imeiById.get(s.id)?.imei2 || null,
                warrantyUntil: end, inWarranty: !!end && end >= today,
              }
            })
          const end = warrantyEndOf(l, null)
          return {
            itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total, warrantyMonths: l.warrantyMonths,
            warrantyUntil: end, inWarranty: !!end && end >= today, units,
          }
        })
        // a card covers lines with a warranty or a serial (from a serial: only that unit's line)
        .filter((l) => (onlySerial ? l.units.length > 0 : (l.warrantyUntil || l.units.length > 0)))

      const [company] = await db.select({ name: tenants.name, phone: tenants.phone, address: tenants.address, email: tenants.email })
        .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      return NextResponse.json({
        today,
        company: company ?? null,
        sale: {
          id: sale.id, invoiceNo: sale.invoiceNo, saleDate: sale.saleDate, customerName: sale.customerName, customerPhone: sale.customerPhone,
          customerAddress: sale.customerAddress, warehouseName: sale.warehouseName,
        },
        lines,
      })
    })
  } catch (error) {
    logError('api/warranty-card', error)
    return NextResponse.json({ error: 'Failed to load the warranty card' }, { status: 500 })
  }
}

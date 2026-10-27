import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getBranchScope } from '@/lib/auth/branch-access'
import { validateSearchParams } from '@/lib/validation/helpers'
import { warrantyLookupSchema } from '@/lib/validation/schemas/installments'
import { logError } from '@/lib/ai/error-logger'
import { tenantToday } from '@/lib/accounting/gl'
import { warrantyEndOf, warrantyLookup } from '@/lib/installments/sale-lookup'
import { WARRANTY_EDIT, requireAny } from '@/lib/installments/access'

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || (Array.isArray(res) ? (res as T[]) : [])
}

/**
 * GET /api/warranty-claims/lookup?q= — find the unit by serial / IMEI, the invoice number or the
 * customer's phone. Each sold line comes with its warranty end (the unit's own warranty end date,
 * else the line's warranty_until) and in / out of warranty on today's date, plus open claims.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, WARRANTY_EDIT)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, warrantyLookupSchema)
    if (!parsed.success) return parsed.response
    const today = await tenantToday(session.user.tenantId)

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      const hits = await warrantyLookup(db, parsed.data.q, scope)
      const results = hits.map((h) => {
        const lines = (h.sale?.lines ?? []).map((l) => {
          const unit = h.serial ? l.serialNumbers.find((s) => s.id === h.serial!.id) : undefined
          const end = warrantyEndOf(l, unit?.warrantyEndDate ?? (l.serialNumbers.length === 1 ? l.serialNumbers[0].warrantyEndDate : null))
          return { ...l, matched: !!unit, warrantyEnd: end, inWarranty: !!end && end >= today }
        })
        const serialEnd = h.serial ? (h.serial.warrantyEndDate || lines.find((l) => l.matched)?.warrantyEnd || null) : null
        return {
          sale: h.sale ? { ...h.sale, lines } : null,
          serial: h.serial ? { ...h.serial, warrantyEnd: serialEnd, inWarranty: !!serialEnd && serialEnd >= today } : null,
        }
      })
      // open claims on the units / sales found
      const serials = results.map((r) => r.serial?.serialNumber).filter((x): x is string => !!x)
      const saleIds = results.map((r) => r.sale?.id).filter((x): x is string => !!x)
      const openClaims = serials.length || saleIds.length ? rowsOf<{ id: string; claim_no: string; status: string; serial_number: string | null; item_name: string; sale_id: string | null; created_at: string }>(await db.execute(sql`
        SELECT id, claim_no, status, serial_number, item_name, sale_id, created_at::text AS created_at FROM warranty_claims
        WHERE status NOT IN ('delivered', 'rejected') AND (
          ${serials.length ? sql`lower(serial_number) IN (${sql.join(serials.map((s) => sql`lower(${s})`), sql`, `)})` : sql`false`}
          OR ${saleIds.length ? sql`sale_id IN (${sql.join(saleIds.map((s) => sql`${s}::uuid`), sql`, `)})` : sql`false`})
        ORDER BY created_at DESC LIMIT 20
      `)) : []
      return NextResponse.json({ today, results, openClaims })
    })
  } catch (error) {
    logError('api/warranty-claims/lookup', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}

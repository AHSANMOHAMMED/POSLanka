import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { priceLists } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { savePriceListItemsSchema } from '@/lib/validation/schemas/pricing'
import { logError } from '@/lib/ai/error-logger'

const CHUNK = 1000

// PUT /api/price-lists/[id]/items { mode: 'replace' | 'merge', items: [{ itemId | itemCode, uom?, minQty?, price | discountPercent }] }
// itemCode matches the item code, barcode (primary, additional or unit barcode) or SKU — so a CSV export of the
// list can be edited and imported back. All-or-nothing: any unknown item / unit → 400 with row errors.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, savePriceListItemsSchema)
    if (!parsed.success) return parsed.response
    const { mode, items: rows } = parsed.data
    const tenantId = session!.user.tenantId
    const listId = p.data.id

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const [list] = await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.id, listId)).for('update')
      if (!list) return { status: 404 as const }

      // resolve item references
      const codes = [...new Set(rows.filter((r) => !r.itemId && r.itemCode).map((r) => r.itemCode!))]
      const ids = [...new Set(rows.filter((r) => r.itemId).map((r) => r.itemId!))]
      const byCode = new Map<string, string>()
      if (codes.length) {
        const found = (await tx.execute(sql`
          SELECT i.id, upper(i.item_code) AS k FROM items i WHERE i.tenant_id = ${tenantId}::uuid AND upper(i.item_code) IN (${sql.join(codes.map((c) => sql`${c.toUpperCase()}`), sql`, `)})
          UNION ALL SELECT i.id, i.barcode FROM items i WHERE i.tenant_id = ${tenantId}::uuid AND i.barcode IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
          UNION ALL SELECT b.item_id, b.barcode FROM item_barcodes b WHERE b.tenant_id = ${tenantId}::uuid AND b.barcode IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
          UNION ALL SELECT u.item_id, u.barcode FROM item_uoms u WHERE u.tenant_id = ${tenantId}::uuid AND u.barcode IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
          UNION ALL SELECT i.id, i.sku FROM items i WHERE i.tenant_id = ${tenantId}::uuid AND i.sku IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
        `)).rows as Array<{ id: string; k: string }>
        for (const f of found) if (!byCode.has(f.k)) byCode.set(f.k, f.id)
      }
      const resolvedIds = [...new Set([...ids, ...byCode.values()])]
      const meta = new Map<string, { unit: string | null; uoms: Set<string> }>()
      if (resolvedIds.length) {
        const itemRows = (await tx.execute(sql`
          SELECT i.id, lower(coalesce(i.unit, '')) AS unit, coalesce(array_agg(lower(u.uom)) FILTER (WHERE u.uom IS NOT NULL), '{}') AS uoms
          FROM items i LEFT JOIN item_uoms u ON u.item_id = i.id
          WHERE i.tenant_id = ${tenantId}::uuid AND i.id IN (${sql.join(resolvedIds.map((i) => sql`${i}::uuid`), sql`, `)})
          GROUP BY i.id, i.unit
        `)).rows as Array<{ id: string; unit: string; uoms: string[] }>
        for (const r of itemRows) meta.set(r.id, { unit: r.unit, uoms: new Set(r.uoms) })
      }

      const errors: Array<{ row: number; error: string }> = []
      const clean = new Map<string, { itemId: string; uom: string | null; minQty: number; price: number | null; discountPercent: number | null }>()
      rows.forEach((r, i) => {
        const itemId = r.itemId || byCode.get(r.itemCode!) || byCode.get(r.itemCode!.toUpperCase())
        const m = itemId ? meta.get(itemId) : undefined
        if (!itemId || !m) { errors.push({ row: i + 1, error: `Item not found: ${r.itemId || r.itemCode}` }); return }
        let uom: string | null = r.uom || null
        if (uom && uom === m.unit) uom = null
        if (uom && !m.uoms.has(uom)) { errors.push({ row: i + 1, error: `Item has no "${uom}" unit conversion` }); return }
        const minQty = r.minQty ?? 0
        // last row wins for the same item / unit / tier
        clean.set(`${itemId}|${uom ?? ''}|${minQty}`, { itemId, uom, minQty, price: r.price ?? null, discountPercent: r.discountPercent ?? null })
      })
      if (errors.length) return { status: 400 as const, errors }

      if (mode === 'replace') {
        await tx.execute(sql`DELETE FROM price_list_items WHERE tenant_id = ${tenantId}::uuid AND price_list_id = ${listId}::uuid`)
      }
      const values = [...clean.values()]
      for (let i = 0; i < values.length; i += CHUNK) {
        const chunk = values.slice(i, i + CHUNK)
        await tx.execute(sql`
          INSERT INTO price_list_items (tenant_id, price_list_id, item_id, uom, min_qty, price, discount_percent)
          VALUES ${sql.join(chunk.map((v) => sql`(${tenantId}::uuid, ${listId}::uuid, ${v.itemId}::uuid, ${v.uom}, ${String(v.minQty)}::numeric,
            ${v.price}::numeric, ${v.discountPercent}::numeric)`), sql`, `)}
          ON CONFLICT (price_list_id, item_id, (coalesce(lower(uom), '')), min_qty)
          DO UPDATE SET price = EXCLUDED.price, discount_percent = EXCLUDED.discount_percent, updated_at = now()
        `)
      }
      await tx.update(priceLists).set({ updatedAt: new Date() }).where(eq(priceLists.id, listId))
      const [{ c }] = (await tx.execute(sql`SELECT count(*)::int AS c FROM price_list_items WHERE price_list_id = ${listId}::uuid`)).rows as Array<{ c: number }>
      return { status: 200 as const, saved: values.length, itemCount: c }
    })

    if (result.status === 404) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
    if (result.status === 400) return NextResponse.json({ error: 'Some rows could not be imported', errors: result.errors.slice(0, 200) }, { status: 400 })
    return NextResponse.json({ saved: result.saved, itemCount: result.itemCount })
  } catch (error) {
    logError('api/price-lists/[id]/items', error)
    return NextResponse.json({ error: 'Failed to save price list items' }, { status: 500 })
  }
}

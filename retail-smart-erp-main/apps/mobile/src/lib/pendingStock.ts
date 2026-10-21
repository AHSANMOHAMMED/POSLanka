// Offline stock (D2): sales waiting in the offline queue are not in the server's stock figures
// yet, so after every catalog sync the local stock is recomputed as
//   local = server stock − Σ quantities of this catalog's queued (pending or rejected) sales
// from the server figure kept in `stock_server`. Recomputing from the server figure (never
// subtracting from the current local value) makes repeated syncs idempotent. Pure: no RN imports.

export interface PendingQueueEntryLike {
  tenantSlug?: string | null
  payload: Record<string, unknown>
}

/** item id → quantity still to be uploaded, for one tenant + warehouse. */
export function pendingStockFromQueue(
  entries: PendingQueueEntryLike[],
  scope: { tenantSlug: string; warehouseId: string }
): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) {
    if (e.tenantSlug && e.tenantSlug !== scope.tenantSlug) continue
    const wh = e.payload?.warehouseId
    if (typeof wh === 'string' && wh && wh !== scope.warehouseId) continue
    const lines = Array.isArray(e.payload?.cartItems) ? (e.payload.cartItems as Array<Record<string, unknown>>) : []
    for (const l of lines) {
      const id = typeof l?.itemId === 'string' ? l.itemId : null
      const q = Number(l?.quantity)
      if (!id || !Number.isFinite(q) || q === 0) continue
      out.set(id, Math.round(((out.get(id) || 0) + q) * 1000) / 1000)
    }
  }
  return out
}

/**
 * Local stock rows to write after a sync: for every item that has (or had at the previous
 * recompute) pending quantities and a known server figure, `server − pending`.
 */
export function recomputeLocalStock(
  server: Map<string, number>,
  pending: Map<string, number>,
  previouslyPending: Iterable<string> = []
): Array<{ itemId: string; available: number }> {
  const ids = new Set<string>([...pending.keys(), ...previouslyPending])
  const rows: Array<{ itemId: string; available: number }> = []
  for (const id of ids) {
    const s = server.get(id)
    if (s === undefined || s === null || !Number.isFinite(s)) continue
    rows.push({ itemId: id, available: Math.round((s - (pending.get(id) || 0)) * 1000) / 1000 })
  }
  return rows
}

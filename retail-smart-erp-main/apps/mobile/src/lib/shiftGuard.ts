// Pure: offline sales of a shift that the server has not recorded yet. Closing the shift before
// they sync reconciles the drawer without them (the counted cash then shows as "over" and is
// posted to the GL as a variance), and the sales arrive later against an already-closed shift.

export interface QueueEntryLike {
  payload: Record<string, unknown>
  rejected?: boolean
  tenantSlug?: string | null
}

export function unsyncedSalesForShift(
  queue: QueueEntryLike[],
  shiftId: string,
  tenantSlug?: string | null
): { pending: number; rejected: number; amount: number } {
  let pending = 0
  let rejected = 0
  let amount = 0
  for (const e of queue) {
    if (tenantSlug && e.tenantSlug && e.tenantSlug !== tenantSlug) continue
    if (e.payload?.posOpeningEntryId !== shiftId) continue
    if (e.rejected) rejected++
    else pending++
    amount += Number(e.payload?.total) || 0
  }
  return { pending, rejected, amount: Math.round(amount * 100) / 100 }
}

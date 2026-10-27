/**
 * A sale financed by a hire purchase plan (any status but cancelled — or cancelled with receipts
 * not voided) cannot be voided, cancelled or fully returned, and its plan lines cannot be
 * returned: the plan's receipts, cheques and journal entries hang on it and a sale void does not
 * undo them. Cancel / settle the plan and void its receipts first. Server-only; used by the sale
 * void, returns / exchange / remove-lines (createReturnInTx), vehicle-sale and work-order cancel.
 */
import { eq, sql } from 'drizzle-orm'
import { installmentPlans } from '@/lib/db/schema'
import type { DbTx } from '@/lib/inventory/db-types'

export const HP_PLAN_EXISTS = 'HP_PLAN_EXISTS'

export interface PlanOnSale {
  id: string
  planNo: string
  status: string
  items: Array<{ itemId?: string | null; saleItemId?: string | null }>
  /** receipts not voided (their journal entries are not undone by a sale void / return) */
  liveReceipts: number
}

/**
 * The plan that blocks voiding / returning a sale: any plan not cancelled, or a cancelled one
 * that still has receipts not voided. Null when the sale is free.
 */
export async function planOnSale(db: DbTx, saleId: string): Promise<PlanOnSale | null> {
  const plans = await db.select({
    id: installmentPlans.id, planNo: installmentPlans.planNo, status: installmentPlans.status, items: installmentPlans.items,
    liveReceipts: sql<number>`(SELECT count(*)::int FROM installment_payments ip WHERE ip.plan_id = installment_plans.id AND ip.voided_at IS NULL)`,
  }).from(installmentPlans)
    .where(eq(installmentPlans.saleId, saleId))
  const blocking = plans.find((p) => p.status !== 'cancelled') ?? plans.find((p) => Number(p.liveReceipts) > 0)
  return blocking ? { ...blocking, liveReceipts: Number(blocking.liveReceipts) } : null
}

export function planBlockMessage(plan: Pick<PlanOnSale, 'planNo' | 'status' | 'liveReceipts'>): string {
  if (plan.status === 'cancelled') {
    return `This sale has hire-purchase plan ${plan.planNo} (cancelled) with ${plan.liveReceipts} receipt(s) — void the plan's receipts first`
  }
  return `This sale has hire-purchase plan ${plan.planNo} — cancel or settle the plan first${plan.liveReceipts > 0 ? ', and void its receipts' : ''}`
}

/**
 * Does returning these sale lines touch the plan? A plan line is matched by its sale line id;
 * a plan line without one matches every sale line of the same item; a plan with no identifiable
 * lines covers the whole sale.
 */
export function returnTouchesPlan(plan: PlanOnSale, lines: Array<{ saleItemId: string; itemId: string | null }>): boolean {
  const lineIds = new Set(plan.items.map((i) => i.saleItemId).filter((x): x is string => !!x))
  const itemIds = new Set(plan.items.filter((i) => !i.saleItemId && i.itemId).map((i) => i.itemId as string))
  if (lineIds.size === 0 && itemIds.size === 0) return lines.length > 0
  return lines.some((l) => lineIds.has(l.saleItemId) || (!!l.itemId && itemIds.has(l.itemId)))
}

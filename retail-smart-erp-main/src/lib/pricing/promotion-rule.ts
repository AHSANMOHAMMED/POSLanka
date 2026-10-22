// H5: drizzle `promotions` row → engine PromotionRule (labels in the management UI / API).
import type { promotions } from '@/lib/db/schema'
import type { PromotionRule } from './engine'

type PromotionRow = typeof promotions.$inferSelect
const n = (v: string | null) => (v === null ? null : Number(v))

export function toPromotionRuleFromRow(r: PromotionRow): PromotionRule {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    applyTo: r.applyTo,
    discountType: r.discountType,
    value: Number(r.value) || 0,
    itemIds: r.itemIds,
    categoryIds: r.categoryIds,
    buyQty: n(r.buyQty),
    getQty: n(r.getQty),
    getItemIds: r.getItemIds,
    getDiscountPercent: n(r.getDiscountPercent) ?? 100,
    bundleItems: r.bundleItems,
    bundlePrice: n(r.bundlePrice),
    minSpend: n(r.minSpend),
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    daysOfWeek: r.daysOfWeek,
    timeFrom: r.timeFrom,
    timeTo: r.timeTo,
    posProfileIds: r.posProfileIds,
    customerTypes: r.customerTypes,
    priority: r.priority,
    stackable: r.stackable,
    couponCode: r.couponCode,
    usageLimit: r.usageLimit,
    perCustomerLimit: r.perCustomerLimit,
    usageCount: r.usageCount,
    isActive: r.isActive,
  }
}

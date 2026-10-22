/**
 * H5: map a validated promotion body (createPromotionSchema) to promotions columns. Fields that
 * do not belong to the chosen type are cleared so stale settings never leak into the engine.
 */
import type { z } from 'zod'
import type { createPromotionSchema } from '@/lib/validation/schemas/pricing'

type PromotionBody = z.infer<typeof createPromotionSchema>
const str = (v: number | undefined) => (v === undefined ? null : String(v))

export function promotionValues(d: PromotionBody) {
  const lineTarget = d.type === 'percent_off' || d.type === 'fixed_off'
  const applyTo = lineTarget ? d.applyTo : d.type === 'min_spend' ? 'cart' as const : 'items' as const
  return {
    name: d.name,
    description: d.description || null,
    type: d.type,
    applyTo,
    discountType: d.type === 'min_spend' ? d.discountType : d.type === 'fixed_off' ? 'fixed' as const : 'percent' as const,
    value: String(lineTarget || d.type === 'min_spend' ? d.value : 0),
    itemIds: (lineTarget && applyTo === 'items') || d.type === 'buy_x_get_y' ? d.itemIds || [] : [],
    categoryIds: (lineTarget && applyTo === 'categories') || d.type === 'buy_x_get_y' ? d.categoryIds || [] : [],
    buyQty: d.type === 'buy_x_get_y' ? str(d.buyQty) : null,
    getQty: d.type === 'buy_x_get_y' ? str(d.getQty) : null,
    getItemIds: d.type === 'buy_x_get_y' ? d.getItemIds || [] : [],
    getDiscountPercent: String(d.type === 'buy_x_get_y' ? d.getDiscountPercent ?? 100 : 100),
    bundleItems: d.type === 'bundle_price' ? d.bundleItems || [] : [],
    bundlePrice: d.type === 'bundle_price' ? str(d.bundlePrice) : null,
    minSpend: str(d.minSpend),
    startsOn: d.startsOn || null,
    endsOn: d.endsOn || null,
    daysOfWeek: [...new Set(d.daysOfWeek || [])].sort(),
    timeFrom: d.timeFrom || null,
    timeTo: d.timeTo || null,
    posProfileIds: d.posProfileIds || [],
    customerTypes: d.customerTypes || [],
    priority: d.priority ?? 0,
    stackable: d.stackable ?? false,
    couponCode: d.couponCode || null,
    usageLimit: d.usageLimit ?? null,
    perCustomerLimit: d.perCustomerLimit ?? null,
    isActive: d.isActive ?? true,
  }
}

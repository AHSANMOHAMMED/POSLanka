/**
 * Business-type-aware item display formatting utilities.
 *
 * Format per business type:
 * - Auto Service / Dealership: Barcode | Name | OEM Part # (or SKU)
 * - Retail: Barcode | Name | SKU
 * - Supermarket: Barcode | Name | PLU Code (or SKU)
 * - Restaurant: Name only (menu items)
 */

export interface ItemDisplayFields {
  name: string
  barcode?: string | null
  sku?: string | null
  oemPartNumber?: string | null
  pluCode?: string | null
}

/**
 * Get the relevant part/identifier number for an item based on business type.
 */
export function getItemPartNumber(
  item: Pick<ItemDisplayFields, 'oemPartNumber' | 'sku' | 'pluCode'>,
  businessType?: string | null
): string | null {
  switch (businessType) {
    case 'auto_service':
    case 'dealership':
      return item.oemPartNumber || item.sku || null
    case 'supermarket':
      return item.pluCode || item.sku || null
    case 'restaurant':
      return null
    case 'retail':
    default:
      return item.sku || null
  }
}

/**
 * Format an item's display label: Barcode | Name | Part Number.
 * Missing parts are skipped. Restaurant shows name only.
 */
export function formatItemLabel(
  item: ItemDisplayFields,
  businessType?: string | null
): string {
  if (businessType === 'restaurant') {
    return item.name
  }

  const partNum = getItemPartNumber(item, businessType)
  const parts = [item.barcode, item.name, partNum].filter(Boolean)
  return parts.join(' | ')
}

export interface SearchableItem extends ItemDisplayFields {
  id: string
  sellingPrice?: string
  costPrice?: string
  availableStock?: string
  trackStock?: boolean
}

/**
 * Build a search option for item select dropdowns.
 * Includes stock info and all item data for form population.
 */
export function buildItemSearchOption(
  item: SearchableItem,
  businessType?: string | null,
  options?: { showStock?: boolean; useCostPrice?: boolean }
): { value: string; label: string; data: Record<string, unknown> } {
  const label = formatItemLabel(item, businessType)
  const stockSuffix = options?.showStock && item.availableStock
    ? ` (${parseFloat(item.availableStock).toFixed(0)} avail)`
    : ''

  return {
    value: item.id,
    label: label + stockSuffix,
    data: {
      name: item.name,
      sellingPrice: item.sellingPrice,
      costPrice: item.costPrice,
      sku: item.sku,
      barcode: item.barcode,
      oemPartNumber: item.oemPartNumber,
      pluCode: item.pluCode,
      availableStock: item.availableStock,
      trackStock: item.trackStock,
    },
  }
}

/**
 * Filter items to only show those with available stock (for sales pages).
 * Non-stock-tracked items are always included.
 */
export function filterAvailableStock<T extends { trackStock?: boolean; availableStock?: string }>(
  items: T[]
): T[] {
  return items.filter(item => !item.trackStock || parseFloat(item.availableStock || '0') > 0)
}

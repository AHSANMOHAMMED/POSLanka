/**
 * Server-side tax template resolver
 * Batch-fetches tax templates for items and provides fallback to default template
 */

import { eq, inArray } from 'drizzle-orm'
import { items, taxTemplates, accountingSettings } from '@/lib/db/schema'
import type { ResolvedTaxTemplate } from './tax-template'

// Accept any drizzle DB or transaction instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any

function toResolved(raw: {
  id: string
  name: string
  items: Array<{
    taxName: string
    rate: string
    accountId: string | null
    includedInPrice: boolean
  }>
}): ResolvedTaxTemplate {
  return {
    id: raw.id,
    name: raw.name,
    items: raw.items.map(i => ({
      taxName: i.taxName,
      rate: Number(i.rate),
      accountId: i.accountId,
      includedInPrice: i.includedInPrice,
    })),
  }
}

/**
 * Batch-resolve tax templates for a set of item IDs.
 * Returns a Map<itemId, ResolvedTaxTemplate | null>.
 */
export async function resolveTaxTemplatesForItems(
  db: DbLike,
  itemIds: string[],
): Promise<Map<string, ResolvedTaxTemplate | null>> {
  const result = new Map<string, ResolvedTaxTemplate | null>()
  if (itemIds.length === 0) return result

  // Fetch items with their taxTemplateId
  const itemRows = await db
    .select({ id: items.id, taxTemplateId: items.taxTemplateId })
    .from(items)
    .where(inArray(items.id, itemIds))

  // Collect unique template IDs
  const templateIds = new Set<string>()
  for (const row of itemRows) {
    if (row.taxTemplateId) templateIds.add(row.taxTemplateId)
  }

  // Batch-fetch templates with their items
  const templateMap = new Map<string, ResolvedTaxTemplate>()
  if (templateIds.size > 0) {
    const templates = await db.query.taxTemplates.findMany({
      where: inArray(taxTemplates.id, Array.from(templateIds)),
      with: { items: true },
    })

    for (const t of templates) {
      if (t.isActive) {
        templateMap.set(t.id, toResolved(t))
      }
    }
  }

  // Build result map
  for (const row of itemRows) {
    if (row.taxTemplateId && templateMap.has(row.taxTemplateId)) {
      result.set(row.id, templateMap.get(row.taxTemplateId)!)
    } else {
      result.set(row.id, null)
    }
  }

  return result
}

/**
 * Fetch the default tax template from accounting settings.
 */
export async function getDefaultTaxTemplate(
  db: DbLike,
  tenantId: string,
): Promise<ResolvedTaxTemplate | null> {
  const settings = await db.query.accountingSettings.findFirst({
    where: eq(accountingSettings.tenantId, tenantId),
  })

  if (!settings?.defaultTaxTemplateId) return null

  const template = await db.query.taxTemplates.findFirst({
    where: eq(taxTemplates.id, settings.defaultTaxTemplateId),
    with: { items: true },
  })

  if (!template || !template.isActive) return null
  return toResolved(template)
}

/**
 * Fetch the default purchase tax template from accounting settings.
 * Mirrors getDefaultTaxTemplate but for purchases (separate default).
 */
export async function getDefaultPurchaseTaxTemplate(
  db: DbLike,
  tenantId: string,
): Promise<ResolvedTaxTemplate | null> {
  const settings = await db.query.accountingSettings.findFirst({
    where: eq(accountingSettings.tenantId, tenantId),
  })

  if (!settings?.defaultPurchaseTaxTemplateId) return null

  const template = await db.query.taxTemplates.findFirst({
    where: eq(taxTemplates.id, settings.defaultPurchaseTaxTemplateId),
    with: { items: true },
  })

  if (!template || !template.isActive) return null
  return toResolved(template)
}

/**
 * Resolve a specific tax template by ID (for transaction-level override).
 */
export async function resolveTransactionTaxTemplate(
  db: DbLike,
  taxTemplateId: string | null | undefined,
): Promise<ResolvedTaxTemplate | null> {
  if (!taxTemplateId) return null

  const template = await db.query.taxTemplates.findFirst({
    where: eq(taxTemplates.id, taxTemplateId),
    with: { items: true },
  })

  if (!template || !template.isActive) return null
  return toResolved(template)
}

/**
 * Get the effective tax template for an item: item-level template or fallback to default.
 */
export function getEffectiveTaxTemplate(
  itemTemplateMap: Map<string, ResolvedTaxTemplate | null>,
  itemId: string | null,
  defaultTemplate: ResolvedTaxTemplate | null,
): ResolvedTaxTemplate | null {
  if (itemId) {
    const itemTemplate = itemTemplateMap.get(itemId)
    if (itemTemplate) return itemTemplate
  }
  return defaultTemplate
}

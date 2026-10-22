/**
 * Country tax templates (H2): seeding from country-wise-tax.ts and the Sri Lanka compliance
 * check shown in Accounting → Tax Templates.
 *
 * Seeding is idempotent (matched by template name) and never touches existing templates. The
 * compliance fix is explicit (the user clicks it): it moves outdated VAT rates to the current
 * rate, retires NBT and adds the missing zero-rated / exempt templates. Historic documents keep
 * the rate they were issued with (sale_items store their own tax).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { accountingSettings, taxTemplateItems, taxTemplates, tenants } from '@/lib/db/schema'
import { getCountryTaxTemplatesForCode } from './country-wise-tax'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

/** Current standard VAT rate in Sri Lanka (since 1 January 2024). */
export const LK_STANDARD_VAT_RATE = 18
/** Former Sri Lanka VAT rates that a tenant may still be configured with. */
const LK_OUTDATED_VAT_RATES = [8, 12, 15]

export interface SeedTaxTemplatesResult {
  created: string[]
  skipped: string[]
  defaultTemplateId: string | null
}

/**
 * Create the country's tax templates that do not exist yet (by name). The default template
 * becomes accounting_settings.default_tax_template_id when none is set (unless setDefault: false).
 */
export async function seedCountryTaxTemplates(
  tx: DbOrTx,
  tenantId: string,
  countryCode: string,
  opts: {
    includeOptional?: boolean
    only?: string[]
    taxAccountId?: string | null
    includedInPrice?: boolean
    /** Make the default template the sales default when none is set (default true). */
    setDefault?: boolean
  } = {}
): Promise<SeedTaxTemplatesResult> {
  const result: SeedTaxTemplatesResult = { created: [], skipped: [], defaultTemplateId: null }
  let defs = getCountryTaxTemplatesForCode(countryCode, opts.includeOptional || !!opts.only?.length)
  if (opts.only?.length) defs = defs.filter((d) => opts.only!.includes(d.templateName))
  if (defs.length === 0) return result

  const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  const taxAccountId = opts.taxAccountId !== undefined ? opts.taxAccountId : settings?.defaultTaxAccountId || null
  let includedInPrice = opts.includedInPrice
  if (includedInPrice === undefined) {
    const [t] = await tx.select({ taxInclusive: tenants.taxInclusive }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    includedInPrice = !!t?.taxInclusive
  }

  const existing: Array<{ id: string; name: string }> = await tx
    .select({ id: taxTemplates.id, name: taxTemplates.name })
    .from(taxTemplates)
    .where(eq(taxTemplates.tenantId, tenantId))
  const byName = new Map(existing.map((t) => [t.name.trim().toLowerCase(), t.id]))

  for (const d of defs) {
    const key = d.templateName.trim().toLowerCase()
    if (byName.has(key)) {
      result.skipped.push(d.templateName)
      if (d.isDefault) result.defaultTemplateId = byName.get(key)!
      continue
    }
    const [tpl] = await tx.insert(taxTemplates).values({
      tenantId,
      name: d.templateName,
      isActive: true,
      taxCategory: d.taxCategory || 'standard',
    }).returning({ id: taxTemplates.id })
    await tx.insert(taxTemplateItems).values({
      tenantId,
      taxTemplateId: tpl.id,
      taxName: d.taxName,
      rate: String(d.taxRate),
      accountId: taxAccountId,
      includedInPrice,
    })
    byName.set(key, tpl.id)
    result.created.push(d.templateName)
    if (d.isDefault) result.defaultTemplateId = tpl.id
  }

  if (opts.setDefault !== false && settings && !settings.defaultTaxTemplateId && result.defaultTemplateId) {
    await tx.update(accountingSettings)
      .set({ defaultTaxTemplateId: result.defaultTemplateId, updatedAt: new Date() })
      .where(eq(accountingSettings.id, settings.id))
  }
  return result
}

export type TaxComplianceIssueCode = 'vat_rate_outdated' | 'nbt_abolished' | 'missing_zero_rated_exempt' | 'legacy_tax_rate'

export interface TaxComplianceIssue {
  code: TaxComplianceIssueCode
  severity: 'warning' | 'info'
  message: string
  templateIds: string[]
}

interface TemplateRow {
  id: string
  name: string
  isActive: boolean
  taxCategory: string
  items: Array<{ id: string; taxName: string; rate: string }>
}

async function loadTemplates(tx: DbOrTx, tenantId: string): Promise<TemplateRow[]> {
  return tx.query.taxTemplates.findMany({
    where: eq(taxTemplates.tenantId, tenantId),
    with: { items: true },
  })
}

const isVat = (name: string) => /\bvat\b/i.test(name)
const isNbt = (name: string) => /\bnbt\b/i.test(name)

/** Compliance check for a tenant's tax configuration (Sri Lanka rules; other countries: none). */
export async function getTaxComplianceIssues(tx: DbOrTx, tenantId: string): Promise<{ country: string; issues: TaxComplianceIssue[] }> {
  const [tenant] = await tx.select({ country: tenants.country, taxRate: tenants.taxRate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const country = tenant?.country || 'LK'
  const issues: TaxComplianceIssue[] = []
  if (country !== 'LK') return { country, issues }

  const templates = (await loadTemplates(tx, tenantId)).filter((t) => t.isActive)
  const outdated = templates.filter((t) => t.items.some((i) => isVat(i.taxName) && LK_OUTDATED_VAT_RATES.includes(Number(i.rate))))
  if (outdated.length) {
    issues.push({
      code: 'vat_rate_outdated',
      severity: 'warning',
      message: `Sri Lanka VAT is ${LK_STANDARD_VAT_RATE}% since 1 January 2024. ${outdated.length} active template(s) still charge an older VAT rate: ${outdated.map((t) => t.name).join(', ')}.`,
      templateIds: outdated.map((t) => t.id),
    })
  }
  const nbt = templates.filter((t) => t.items.some((i) => isNbt(i.taxName) && Number(i.rate) > 0))
  if (nbt.length) {
    issues.push({
      code: 'nbt_abolished',
      severity: 'warning',
      message: `NBT was abolished on 1 December 2019 but is still charged by: ${nbt.map((t) => t.name).join(', ')}.`,
      templateIds: nbt.map((t) => t.id),
    })
  }
  const hasZero = templates.some((t) => t.taxCategory === 'zero_rated')
  const hasExempt = templates.some((t) => t.taxCategory === 'exempt')
  if (!hasZero || !hasExempt) {
    issues.push({
      code: 'missing_zero_rated_exempt',
      severity: 'info',
      message: 'Add "VAT 0% Zero-rated" and "VAT Exempt" templates so the VAT return can separate zero-rated from exempt supplies.',
      templateIds: [],
    })
  }
  if (tenant && LK_OUTDATED_VAT_RATES.includes(Number(tenant.taxRate))) {
    issues.push({
      code: 'legacy_tax_rate',
      severity: 'warning',
      message: `The company's flat tax rate is still ${Number(tenant.taxRate)}% (used where no tax template applies).`,
      templateIds: [],
    })
  }
  return { country, issues }
}

export interface TaxComplianceFixResult {
  updatedTemplates: string[]
  deactivatedTemplates: string[]
  removedNbtItems: number
  seeded: string[]
  legacyRateUpdated: boolean
}

/**
 * One-click fix for the Sri Lanka issues above. Only touches what the check flagged:
 *   - VAT items at an outdated rate → 18% (template names "… 15% …" renamed to "… 18% …"),
 *   - NBT-only templates deactivated, NBT items removed from mixed templates,
 *   - missing zero-rated / exempt templates seeded,
 *   - tenants.tax_rate (legacy flat rate) 15 → 18.
 */
export async function fixTaxCompliance(tx: DbOrTx, tenantId: string): Promise<TaxComplianceFixResult> {
  const res: TaxComplianceFixResult = { updatedTemplates: [], deactivatedTemplates: [], removedNbtItems: 0, seeded: [], legacyRateUpdated: false }
  const [tenant] = await tx.select({ country: tenants.country, taxRate: tenants.taxRate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!tenant || tenant.country !== 'LK') return res

  const templates = (await loadTemplates(tx, tenantId)).filter((t) => t.isActive)
  for (const t of templates) {
    const outdatedItems = t.items.filter((i) => isVat(i.taxName) && LK_OUTDATED_VAT_RATES.includes(Number(i.rate)))
    const nbtItems = t.items.filter((i) => isNbt(i.taxName))
    if (outdatedItems.length) {
      await tx.update(taxTemplateItems)
        .set({ rate: String(LK_STANDARD_VAT_RATE) })
        .where(inArray(taxTemplateItems.id, outdatedItems.map((i) => i.id)))
    }
    if (nbtItems.length && nbtItems.length === t.items.length) {
      await tx.update(taxTemplates).set({ isActive: false, updatedAt: new Date() }).where(eq(taxTemplates.id, t.id))
      res.deactivatedTemplates.push(t.name)
      continue
    }
    if (nbtItems.length) {
      await tx.delete(taxTemplateItems).where(and(eq(taxTemplateItems.taxTemplateId, t.id), inArray(taxTemplateItems.id, nbtItems.map((i) => i.id))))
      res.removedNbtItems += nbtItems.length
    }
    if (outdatedItems.length || nbtItems.length) {
      const renamed = outdatedItems.length
        ? t.name.replace(new RegExp(`\\b(${LK_OUTDATED_VAT_RATES.join('|')})(\\.0+)?\\s*%`, 'g'), `${LK_STANDARD_VAT_RATE}%`)
        : t.name
      const cleaned = nbtItems.length ? renamed.replace(/\s*[+&,]\s*NBT(\s*\d+(\.\d+)?\s*%)?/gi, '').trim() || renamed : renamed
      await tx.update(taxTemplates).set({ name: cleaned, updatedAt: new Date() }).where(eq(taxTemplates.id, t.id))
      res.updatedTemplates.push(cleaned)
    }
  }

  const all = await loadTemplates(tx, tenantId)
  const missing: string[] = []
  if (!all.some((t) => t.isActive && t.taxCategory === 'zero_rated')) missing.push('VAT 0% Zero-rated')
  if (!all.some((t) => t.isActive && t.taxCategory === 'exempt')) missing.push('VAT Exempt')
  if (!all.some((t) => t.isActive && t.items.some((i) => isVat(i.taxName) && Number(i.rate) === LK_STANDARD_VAT_RATE))) missing.push('VAT 18%')
  if (missing.length) {
    const seeded = await seedCountryTaxTemplates(tx, tenantId, 'LK', { only: missing })
    res.seeded = seeded.created
  }

  if (LK_OUTDATED_VAT_RATES.includes(Number(tenant.taxRate))) {
    await tx.update(tenants).set({ taxRate: String(LK_STANDARD_VAT_RATE), updatedAt: new Date() }).where(eq(tenants.id, tenantId))
    res.legacyRateUpdated = true
  }
  return res
}

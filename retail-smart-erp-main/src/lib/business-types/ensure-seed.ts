/**
 * Non-destructive "ensure" seeding for business types a vendor starts running (super admin changes
 * a vendor's type, e.g. supermarket → mall with textile + electronics + food court, or creates a
 * mall). Only INSERTS what is missing — matched by name (categories, accounts, vehicle types …) —
 * and never updates or deletes a row, so every existing record, number and setting is kept.
 *
 * Mirrors what vendor creation (createMinimalDefaults) and the setup wizard seed per type:
 * category suggestions, units of measure, the type's chart-of-accounts additions, cancellation reasons and, for
 * auto service / dealership, vehicle types, inspection templates and insurance companies.
 * Runs inside the caller's transaction with app.tenant_id set (RLS).
 */
import { eq } from 'drizzle-orm'
import {
  categories,
  chartOfAccounts,
  cancellationReasons,
  vehicleTypes,
  inspectionTemplates,
  inspectionCategories,
  inspectionChecklistItems,
  insuranceCompanies,
  tenants,
  units,
} from '@/lib/db/schema'
import { defaultUnitsFor } from '@/lib/pricing/catalog'
import {
  getChartOfAccountsForBusinessType,
  nextFreeAccountNumber,
  walkAccountTemplates,
} from '@/lib/accounting/default-coa'
import {
  getCancellationReasonsForBusinessType,
  getCategoriesForBusinessType,
  defaultVehicleTypes,
  defaultInspectionTemplates,
  defaultInsuranceCompanies,
} from '@/lib/setup/seed-data'
import { hasBusinessType } from './scope'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()

/** Suggested ("selected") categories of these types the tenant does not have yet. */
export async function ensureTypeCategories(tx: Tx, tenantId: string, types: readonly string[]): Promise<number> {
  if (types.length === 0) return 0
  const wanted = getCategoriesForBusinessType(types).filter((c) => c.selected !== false)
  const existing: Array<{ name: string }> = await tx.select({ name: categories.name }).from(categories).where(eq(categories.tenantId, tenantId))
  const have = new Set(existing.map((c) => norm(c.name)))
  const toInsert = wanted.filter((c) => !have.has(norm(c.name)))
  if (toInsert.length === 0) return 0
  await tx.insert(categories).values(toInsert.map((c) => ({ tenantId, name: c.name.trim(), isActive: true })))
  return toInsert.length
}

/**
 * The chart-of-accounts additions of these types (leaf accounts, matched by name) under the
 * tenant's existing groups (matched by number, then name). A taken number moves to the next free
 * one in the group. A tenant without a chart yet is left alone (accounting setup seeds it).
 */
export async function ensureTypeAccounts(tx: Tx, tenantId: string, types: readonly string[], currency: string): Promise<number> {
  if (types.length === 0) return 0
  const rows: Array<{ id: string; name: string; accountNumber: string | null; isGroup: boolean }> = await tx
    .select({ id: chartOfAccounts.id, name: chartOfAccounts.name, accountNumber: chartOfAccounts.accountNumber, isGroup: chartOfAccounts.isGroup })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.tenantId, tenantId))
  if (rows.length === 0) return 0
  const names = new Set(rows.map((r) => norm(r.name)))
  const used = new Set(rows.map((r) => r.accountNumber).filter((n): n is string => !!n))
  const groupsByNumber = new Map(rows.filter((r) => r.isGroup && r.accountNumber).map((r) => [r.accountNumber as string, r]))
  const groupsByName = new Map(rows.filter((r) => r.isGroup).map((r) => [norm(r.name), r]))

  const toInsert: Array<typeof chartOfAccounts.$inferInsert> = []
  walkAccountTemplates(getChartOfAccountsForBusinessType(types), (node, parent) => {
    if (node.isGroup || !parent || names.has(norm(node.name))) return
    const group = groupsByNumber.get(parent.accountNumber) || groupsByName.get(norm(parent.name))
    if (!group) return
    const accountNumber = nextFreeAccountNumber(node.accountNumber, group.accountNumber, used)
    if (!accountNumber) return
    toInsert.push({
      tenantId,
      name: node.name,
      accountNumber,
      rootType: node.rootType,
      accountType: node.accountType as typeof chartOfAccounts.$inferInsert['accountType'],
      isGroup: false,
      isSystemAccount: node.isSystemAccount,
      currency,
      parentId: group.id,
    })
    names.add(norm(node.name))
    used.add(accountNumber)
  })
  if (toInsert.length > 0) await tx.insert(chartOfAccounts).values(toInsert)
  return toInsert.length
}

/**
 * Units of measure of these types (by code). A tenant with no units yet is left alone: its units
 * are seeded on first use (ensureDefaultUnits) from the full new scope.
 */
export async function ensureTypeUnits(tx: Tx, tenantId: string, types: readonly string[]): Promise<number> {
  if (types.length === 0) return 0
  const existing: Array<{ code: string }> = await tx.select({ code: units.code }).from(units).where(eq(units.tenantId, tenantId))
  if (existing.length === 0) return 0
  const have = new Set(existing.map((u) => norm(u.code)))
  const toInsert = defaultUnitsFor(types).filter((u) => !have.has(norm(u.code)))
  if (toInsert.length === 0) return 0
  await tx.insert(units).values(toInsert.map((u) => ({ tenantId, code: u.code, name: u.name, allowFraction: u.allowFraction })))
  return toInsert.length
}

/** Cancellation reasons of these types the tenant does not have yet (per document type). */
export async function ensureTypeCancellationReasons(tx: Tx, tenantId: string, types: readonly string[]): Promise<number> {
  if (types.length === 0) return 0
  const existing: Array<{ documentType: string; reason: string; sortOrder: number | null }> = await tx
    .select({ documentType: cancellationReasons.documentType, reason: cancellationReasons.reason, sortOrder: cancellationReasons.sortOrder })
    .from(cancellationReasons)
    .where(eq(cancellationReasons.tenantId, tenantId))
  const have = new Set(existing.map((r) => `${r.documentType}\u0000${norm(r.reason)}`))
  const nextSort = new Map<string, number>()
  for (const r of existing) nextSort.set(r.documentType, Math.max(nextSort.get(r.documentType) ?? 0, (r.sortOrder ?? 0) + 1))
  const toInsert: Array<typeof cancellationReasons.$inferInsert> = []
  for (const seed of getCancellationReasonsForBusinessType(types)) {
    for (const reason of seed.reasons) {
      const key = `${seed.documentType}\u0000${norm(reason)}`
      if (have.has(key)) continue
      have.add(key)
      const sortOrder = nextSort.get(seed.documentType) ?? 0
      nextSort.set(seed.documentType, sortOrder + 1)
      toInsert.push({ tenantId, documentType: seed.documentType, reason, isActive: true, sortOrder })
    }
  }
  if (toInsert.length > 0) await tx.insert(cancellationReasons).values(toInsert)
  return toInsert.length
}

/** Auto service / dealership: vehicle types, inspection templates and insurance companies by name. */
export async function ensureVehicleServiceDefaults(tx: Tx, tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = { vehicleTypes: 0, inspectionTemplates: 0, insuranceCompanies: 0 }

  const vts: Array<{ name: string }> = await tx.select({ name: vehicleTypes.name }).from(vehicleTypes).where(eq(vehicleTypes.tenantId, tenantId))
  const haveVt = new Set(vts.map((v) => norm(v.name)))
  for (const vt of defaultVehicleTypes) {
    if (haveVt.has(norm(vt.name))) continue
    await tx.insert(vehicleTypes).values({
      tenantId,
      name: vt.name,
      bodyType: vt.bodyType as typeof vehicleTypes.$inferInsert['bodyType'],
      description: vt.description || null,
      wheelCount: vt.wheelCount,
      isSystemDefault: true,
      isActive: true,
    })
    out.vehicleTypes++
  }

  const tpls: Array<{ name: string }> = await tx.select({ name: inspectionTemplates.name }).from(inspectionTemplates).where(eq(inspectionTemplates.tenantId, tenantId))
  const haveTpl = new Set(tpls.map((t) => norm(t.name)))
  for (const tpl of defaultInspectionTemplates) {
    if (haveTpl.has(norm(tpl.name))) continue
    const [createdTemplate] = await tx.insert(inspectionTemplates).values({
      tenantId,
      name: tpl.name,
      inspectionType: tpl.type as typeof inspectionTemplates.$inferInsert['inspectionType'],
      isDefault: true,
      isActive: true,
    }).returning({ id: inspectionTemplates.id })
    for (let catIdx = 0; catIdx < tpl.categories.length; catIdx++) {
      const cat = tpl.categories[catIdx]
      const [createdCat] = await tx.insert(inspectionCategories).values({
        tenantId,
        templateId: createdTemplate.id,
        name: cat.name,
        sortOrder: catIdx,
      }).returning({ id: inspectionCategories.id })
      if (cat.items.length > 0) {
        await tx.insert(inspectionChecklistItems).values(cat.items.map((item, itemIdx) => ({
          tenantId,
          categoryId: createdCat.id,
          itemName: item.name,
          itemType: (item.type || 'checkbox') as typeof inspectionChecklistItems.$inferInsert['itemType'],
          isRequired: item.required || false,
          sortOrder: itemIdx,
        })))
      }
    }
    out.inspectionTemplates++
  }

  const ics: Array<{ name: string }> = await tx.select({ name: insuranceCompanies.name }).from(insuranceCompanies).where(eq(insuranceCompanies.tenantId, tenantId))
  const haveIc = new Set(ics.map((i) => norm(i.name)))
  for (const ic of defaultInsuranceCompanies) {
    if (haveIc.has(norm(ic.name))) continue
    await tx.insert(insuranceCompanies).values({ tenantId, name: ic.name, shortName: ic.shortName, isActive: true })
    out.insuranceCompanies++
  }
  return out
}

/**
 * Everything the given (newly added) business types need, inserted only where missing.
 * Returns how many rows were added per kind (only kinds with additions).
 */
export async function ensureBusinessTypeSeedData(
  tx: Tx,
  tenantId: string,
  types: readonly string[],
): Promise<Record<string, number>> {
  const seeded: Record<string, number> = {}
  if (types.length === 0) return seeded
  const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { currency: true } })
  const add = (key: string, n: number) => { if (n > 0) seeded[key] = (seeded[key] ?? 0) + n }

  add('categories', await ensureTypeCategories(tx, tenantId, types))
  add('units', await ensureTypeUnits(tx, tenantId, types))
  add('accounts', await ensureTypeAccounts(tx, tenantId, types, tenant?.currency || 'LKR'))
  add('cancellationReasons', await ensureTypeCancellationReasons(tx, tenantId, types))
  if (hasBusinessType(types, ['auto_service', 'dealership'])) {
    for (const [k, n] of Object.entries(await ensureVehicleServiceDefaults(tx, tenantId))) add(k, n)
  }
  return seeded
}

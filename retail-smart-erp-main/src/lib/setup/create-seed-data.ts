// Atomically creates seed data for a new company during setup wizard
import { eq, and, sql } from 'drizzle-orm'
import {
  tenants,
  warehouses,
  categories,
  posProfiles,
  posProfilePaymentMethods,
  posProfileUsers,
  restaurantTables,
  serviceTypeGroups,
  serviceTypes,
  chartOfAccounts,
  accountingSettings,
  cancellationReasons,
  fiscalYears,
  costCenters,
  bankAccounts as bankAccountsTable,
  vehicleTypes,
  inspectionTemplates,
  inspectionCategories,
  inspectionChecklistItems,
  insuranceCompanies,
  letterHeads,
  printTemplates,
  modesOfPayment,
} from '@/lib/db/schema'
import { getChartOfAccountsForBusinessType, SYSTEM_ACCOUNT_DEFAULTS, type AccountTemplate } from '@/lib/accounting/default-coa'
import {
  getCancellationReasonsForBusinessType,
  defaultVehicleTypes,
  defaultInspectionTemplates,
  defaultInsuranceCompanies,
  printTemplateDocumentTypes,
} from './seed-data'
import type { ServiceGroupSeed } from './seed-data'

export interface WarehouseInput {
  name: string
  code: string
  address?: string
  phone?: string
  email?: string
  isDefault: boolean
}

export interface BankAccountInput {
  accountName: string
  bankName?: string
  accountNumber?: string
  branchCode?: string
  isDefault: boolean
}

export interface SetupWizardData {
  // Step 1: Business Profile
  taxRate?: number
  taxInclusive?: boolean
  logoUrl?: string
  timezone?: string
  coaTemplate: 'numbered' | 'unnumbered'
  fiscalYearStart?: string
  fiscalYearEnd?: string
  fiscalYearName?: string

  // Step 2: Business-type specific
  selectedCategories: string[]
  // Restaurant specific
  numberOfTables?: number
  tableAreas?: string[]
  // Auto service specific
  selectedServiceGroups?: ServiceGroupSeed[]
  defaultLaborRate?: number

  // Step 3: Warehouses (multiple)
  warehouses?: WarehouseInput[]
  // Backward compat: single warehouse name
  warehouseName?: string

  // Step 4: Cost Centers & Accounting
  costCenters?: string[]
  defaultCostCenter?: string        // Name of the cost center to mark as default
  bankAccounts?: BankAccountInput[] // Bank accounts to create during setup
  accountOverrides?: Record<string, string> // Maps setting key to account number (overrides SYSTEM_ACCOUNT_DEFAULTS)

  // Step 5: POS & Payments
  paymentMethods: string[]
  posProfileName: string
  receiptFormat: string
  posWarehouseName?: string          // Selected warehouse for POS profile
  posCostCenter?: string             // Selected cost center for POS profile

  // Step 6: Document Settings
  invoicePrefix?: string
  invoiceStartNumber?: number
  quotationPrefix?: string
  quotationStartNumber?: number
  defaultTerms?: string
  defaultNotes?: string

  // Step 7: Employees & HR
  employeeStructure?: 'basic' | 'advanced' | 'none'
  payrollCycle?: 'weekly' | 'biweekly' | 'monthly'
  leavePolicy?: 'minimal' | 'standard' | 'generous'
  defaultSalaryStructure?: 'fixed' | 'commission' | 'hybrid'

  // Step 8: Team Invites
  teamInvites?: Array<{
    email: string
    role: string
  }>

  // Step 9: Sales Commissions
  commissionEnabled?: boolean
  commissionStructure?: 'percentage' | 'fixed' | 'tiered'
  defaultCommissionRate?: number
  commissionCalculation?: 'revenue' | 'profit' | 'quantity'

  // Step 10: Loyalty Program
  enableLoyalty?: boolean
  loyaltyProgramName?: string
  loyaltyCollectionFactor?: number
  loyaltyConversionFactor?: number
  loyaltyMinRedemption?: number
  loyaltyExpire?: boolean
  loyaltyExpiryDays?: number

  // Step 11: Notifications
  enableNotifications?: boolean
  smsProvider?: string
  smsConfig?: Record<string, string>
  enabledNotificationTriggers?: string[]

  // Step 12: Users & Permissions
  users?: Array<{
    email: string
    role: string
    sendInvite: boolean
  }>

}

export async function createSeedData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  businessType: string,
  data: SetupWizardData,
  tenantCurrency?: string,
  ownerUserId?: string
) {
  // 1. Update tenant settings
  const tenantUpdate: Record<string, unknown> = {
    setupCompletedAt: new Date(),
    updatedAt: new Date(),
  }
  if (data.logoUrl) tenantUpdate.logoUrl = data.logoUrl
  if (data.taxRate !== undefined) tenantUpdate.taxRate = String(data.taxRate)
  if (data.taxInclusive !== undefined) tenantUpdate.taxInclusive = data.taxInclusive
  if (data.timezone) tenantUpdate.timezone = data.timezone

  await tx.update(tenants).set(tenantUpdate).where(eq(tenants.id, tenantId))

  // 2. Create warehouses (multiple or single for backward compat)
  const defaultWarehouse = await seedWarehouses(tx, tenantId, data)

  // 3. Create categories (deduplicated)
  const cats = data.selectedCategories || []
  const uniqueCats = [...new Set(cats.filter(c => c.trim()))]
  if (uniqueCats.length > 0) {
    await tx.insert(categories).values(
      uniqueCats.map((name: string) => ({
        tenantId,
        name: name.trim(),
        isActive: true,
      }))
    )
  }

  // 4. Create POS profile linked to default warehouse
  const [posProfile] = await tx.insert(posProfiles).values({
    tenantId,
    name: data.posProfileName || 'Default POS',
    code: 'DEFAULT',
    isDefault: true,
    warehouseId: defaultWarehouse.id,
    receiptPrintFormat: data.receiptFormat || '80mm',
    status: 'active',
  }).returning()

  // 5. Create payment methods for POS profile
  const methods = data.paymentMethods || ['cash']
  if (methods.length > 0) {
    await tx.insert(posProfilePaymentMethods).values(
      methods.map((method: string, index: number) => ({
        tenantId,
        posProfileId: posProfile.id,
        paymentMethod: method,
        isDefault: index === 0,
        sortOrder: index,
      }))
    )
  }

  // 5b. Assign the owner to the POS profile
  if (ownerUserId) {
    await tx.insert(posProfileUsers).values({
      tenantId,
      posProfileId: posProfile.id,
      userId: ownerUserId,
      isDefault: true,
    })
  }

  // 6. Business-type specific setup
  if (businessType === 'restaurant' && data.numberOfTables) {
    const clampedTables = Math.min(Math.max(1, data.numberOfTables), 200)
    await createRestaurantTables(tx, tenantId, clampedTables, data.tableAreas || ['Main Hall'])
  }

  if (businessType === 'auto_service') {
    if (data.selectedServiceGroups) {
      await createAutoServiceTypes(tx, tenantId, data.selectedServiceGroups, data.defaultLaborRate)
    }
    // Seed vehicle types, inspection templates, insurance companies
    await seedAutoServiceDefaults(tx, tenantId)
  }

  if (businessType === 'dealership') {
    // Dealerships also need vehicle types + service center defaults
    await seedDealershipDefaults(tx, tenantId)
    // If service groups selected during setup, create service types
    if (data.selectedServiceGroups && data.selectedServiceGroups.length > 0) {
      await createAutoServiceTypes(tx, tenantId, data.selectedServiceGroups, data.defaultLaborRate)
    }
  }

  // 7. Chart of Accounts (always create chart of accounts)
  await seedChartOfAccounts(tx, tenantId, businessType, tenantCurrency || 'LKR', data.accountOverrides, data.coaTemplate)

  // 7a. Modes of Payment (always created — Cash, Bank Transfer, Credit Card, Cheque)
  await seedModesOfPayment(tx, tenantId)

  // 8. Fiscal year (always created — defaults to Jan 1 – Dec 31 current year)
  await seedFiscalYear(tx, tenantId, data)

  // 9. Cost centers (always created — defaults to "Main" if none provided)
  const centers = (data.costCenters || []).map(n => n.trim()).filter(Boolean)
  const centersToCreate = centers.length > 0 ? centers : ['Main']
  const createdCostCenters = await seedCostCenters(tx, tenantId, centersToCreate)

  // 9a. Set default cost center in accounting_settings (always — first one if not specified)
  if (createdCostCenters.length > 0) {
    const defaultCC = (data.defaultCostCenter
      ? createdCostCenters.find(c => c.name.trim().toLowerCase() === data.defaultCostCenter!.trim().toLowerCase())
      : null) || createdCostCenters[0]
    if (defaultCC) {
      await tx.update(accountingSettings)
        .set({ defaultCostCenterId: defaultCC.id })
        .where(eq(accountingSettings.tenantId, tenantId))
    }
  }

  // 9b. Create bank accounts — each gets its own COA leaf under "Bank Accounts" group (#1120)
  if (data.bankAccounts && data.bankAccounts.length > 0) {
    // Find the "Bank Accounts" group (#1120)
    const bankGroup = await tx.query.chartOfAccounts.findFirst({
      where: and(
        eq(chartOfAccounts.tenantId, tenantId),
        eq(chartOfAccounts.accountNumber, '1120'),
        eq(chartOfAccounts.isGroup, true)
      ),
    })

    let nextAccountNum = 1121
    let defaultBankCoaId: string | null = null

    for (const ba of data.bankAccounts) {
      if (!ba.accountName?.trim()) continue

      let coaAccountId: string | null = null

      if (bankGroup) {
        // Create a COA leaf entry for this bank account
        const [coaEntry] = await tx.insert(chartOfAccounts).values({
          tenantId,
          name: ba.accountName.trim(),
          accountNumber: String(nextAccountNum),
          rootType: 'asset',
          accountType: 'bank',
          isGroup: false,
          isSystemAccount: false,
          parentId: bankGroup.id,
        }).returning()

        coaAccountId = coaEntry.id
        nextAccountNum++

        // Track the default bank's COA ID
        if (ba.isDefault || !defaultBankCoaId) {
          defaultBankCoaId = coaEntry.id
        }
      }

      await tx.insert(bankAccountsTable).values({
        tenantId,
        accountName: ba.accountName.trim(),
        bankName: ba.bankName?.trim() || null,
        accountNumber: ba.accountNumber?.trim() || null,
        branchCode: ba.branchCode?.trim() || null,
        accountId: coaAccountId,
        isDefault: ba.isDefault,
      })
    }

    // Set defaultBankAccountId in accounting settings
    if (defaultBankCoaId) {
      await tx.update(accountingSettings)
        .set({ defaultBankAccountId: defaultBankCoaId })
        .where(eq(accountingSettings.tenantId, tenantId))
    }
  }

  // 9c. Update POS profile with selected warehouse and cost center
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posUpdate: any = {}

    if (data.posWarehouseName) {
      // Use case-insensitive match via SQL lower() to handle name casing differences
      const selectedWarehouse = await tx.query.warehouses.findFirst({
        where: and(
          eq(warehouses.tenantId, tenantId),
          sql`lower(trim(${warehouses.name})) = lower(trim(${data.posWarehouseName}))`
        ),
      })
      if (selectedWarehouse) {
        posUpdate.warehouseId = selectedWarehouse.id
      }
    }

    // Always try to assign a cost center — fall back to default or first created
    if (createdCostCenters.length > 0) {
      const selectedCC = data.posCostCenter
        ? createdCostCenters.find(c => c.name.trim().toLowerCase() === data.posCostCenter!.trim().toLowerCase())
        : null
      posUpdate.costCenterId = selectedCC?.id || createdCostCenters[0].id
    }

    if (Object.keys(posUpdate).length > 0) {
      await tx.update(posProfiles)
        .set(posUpdate)
        .where(eq(posProfiles.id, posProfile.id))
    }
  }

  // 10. Letter head & print templates
  const tenantInfo = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  await seedLetterHeadAndTemplates(tx, tenantId, tenantInfo, defaultWarehouse)

  // 11. Cancellation reasons
  await seedCancellationReasons(tx, tenantId, businessType)

  return {
    warehouseId: defaultWarehouse.id,
    posProfileId: posProfile.id,
  }
}

// ==================== WAREHOUSES ====================

async function seedWarehouses(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  data: SetupWizardData
) {
  // Support both multi-warehouse and single warehouse (backward compat)
  if (data.warehouses && data.warehouses.length > 0) {
    let defaultWarehouse = null
    let firstCreatedId: string | null = null
    // Ensure only one default
    let defaultFound = false
    for (const wh of data.warehouses) {
      const name = (wh.name || '').trim() || 'Warehouse'
      const code = (wh.code || '').trim() || name.substring(0, 4).toUpperCase()
      const isDefault = !defaultFound && wh.isDefault
      if (isDefault) defaultFound = true

      const [created] = await tx.insert(warehouses).values({
        tenantId,
        name,
        code,
        address: wh.address || null,
        phone: wh.phone || null,
        email: wh.email || null,
        isDefault,
        isActive: true,
      }).returning()
      if (!firstCreatedId) firstCreatedId = created.id
      if (isDefault) defaultWarehouse = created
    }
    // If no default was set, mark the first inserted warehouse as default
    if (!defaultWarehouse && firstCreatedId) {
      const [first] = await tx.update(warehouses)
        .set({ isDefault: true })
        .where(eq(warehouses.id, firstCreatedId))
        .returning()
      defaultWarehouse = first
    }
    return defaultWarehouse
  }

  // Backward compat: single warehouse
  const [warehouse] = await tx.insert(warehouses).values({
    tenantId,
    name: data.warehouseName || 'Main Warehouse',
    code: 'MAIN',
    isDefault: true,
    isActive: true,
  }).returning()

  return warehouse
}

// ==================== FISCAL YEAR ====================

async function seedFiscalYear(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  data: SetupWizardData
) {
  // Default to Jan 1 – Dec 31 of current year if not provided
  const currentYear = new Date().getFullYear()
  const rawStart = data.fiscalYearStart || `${currentYear}-01-01`
  const rawEnd = data.fiscalYearEnd || `${currentYear}-12-31`

  const startDate = new Date(rawStart)
  const endDate = new Date(rawEnd)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null
  if (startDate >= endDate) return null

  const fyName = data.fiscalYearName || `FY ${startDate.getFullYear()}`

  const [fy] = await tx.insert(fiscalYears).values({
    tenantId,
    name: fyName,
    startDate: rawStart,
    endDate: rawEnd,
  }).returning()

  // Link to accounting settings if they exist
  const existingSettings = await tx.query.accountingSettings.findFirst({
    where: eq(accountingSettings.tenantId, tenantId),
  })
  if (existingSettings) {
    await tx.update(accountingSettings)
      .set({ currentFiscalYearId: fy.id })
      .where(eq(accountingSettings.tenantId, tenantId))
  }

  return fy
}

// ==================== COST CENTERS ====================

async function seedCostCenters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  names: string[]
): Promise<{ id: string; name: string }[]> {
  const created: { id: string; name: string }[] = []
  for (const name of names) {
    const [cc] = await tx.insert(costCenters).values({
      tenantId,
      name,
      isGroup: false,
      isActive: true,
    }).returning()
    created.push({ id: cc.id, name: cc.name })
  }
  return created
}

// ==================== AUTO SERVICE DEFAULTS ====================

async function seedAutoServiceDefaults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string
) {
  // Seed vehicle types (per-tenant, marked as system default)
  for (const vt of defaultVehicleTypes) {
    await tx.insert(vehicleTypes).values({
      tenantId,
      name: vt.name,
      bodyType: vt.bodyType as typeof vehicleTypes.$inferInsert['bodyType'],
      description: vt.description || null,
      wheelCount: vt.wheelCount,
      isSystemDefault: true,
      isActive: true,
    })
  }

  // Seed inspection templates with categories and checklist items
  for (const tpl of defaultInspectionTemplates) {
    const [createdTemplate] = await tx.insert(inspectionTemplates).values({
      tenantId,
      name: tpl.name,
      inspectionType: tpl.type as typeof inspectionTemplates.$inferInsert['inspectionType'],
      isDefault: true,
      isActive: true,
    }).returning()

    for (let catIdx = 0; catIdx < tpl.categories.length; catIdx++) {
      const cat = tpl.categories[catIdx]
      const [createdCat] = await tx.insert(inspectionCategories).values({
        tenantId,
        templateId: createdTemplate.id,
        name: cat.name,
        sortOrder: catIdx,
      }).returning()

      for (let itemIdx = 0; itemIdx < cat.items.length; itemIdx++) {
        const item = cat.items[itemIdx]
        await tx.insert(inspectionChecklistItems).values({
          tenantId,
          categoryId: createdCat.id,
          itemName: item.name,
          itemType: (item.type || 'checkbox') as typeof inspectionChecklistItems.$inferInsert['itemType'],
          isRequired: item.required || false,
          sortOrder: itemIdx,
        })
      }
    }
  }

  // Seed insurance companies (per-tenant)
  for (const ic of defaultInsuranceCompanies) {
    await tx.insert(insuranceCompanies).values({
      tenantId,
      name: ic.name,
      shortName: ic.shortName,
      isActive: true,
    })
  }
}

// ==================== DEALERSHIP DEFAULTS ====================

async function seedDealershipDefaults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string
) {
  // Seed vehicle types (per-tenant, marked as system default)
  for (const vt of defaultVehicleTypes) {
    await tx.insert(vehicleTypes).values({
      tenantId,
      name: vt.name,
      bodyType: vt.bodyType as typeof vehicleTypes.$inferInsert['bodyType'],
      description: vt.description || null,
      wheelCount: vt.wheelCount,
      isSystemDefault: true,
      isActive: true,
    })
  }

  // Seed inspection templates (PDI + trade-in inspections)
  for (const tpl of defaultInspectionTemplates) {
    const [createdTemplate] = await tx.insert(inspectionTemplates).values({
      tenantId,
      name: tpl.name,
      inspectionType: tpl.type as typeof inspectionTemplates.$inferInsert['inspectionType'],
      isDefault: true,
      isActive: true,
    }).returning()

    for (let catIdx = 0; catIdx < tpl.categories.length; catIdx++) {
      const cat = tpl.categories[catIdx]
      const [createdCat] = await tx.insert(inspectionCategories).values({
        tenantId,
        templateId: createdTemplate.id,
        name: cat.name,
        sortOrder: catIdx,
      }).returning()

      for (let itemIdx = 0; itemIdx < cat.items.length; itemIdx++) {
        const item = cat.items[itemIdx]
        await tx.insert(inspectionChecklistItems).values({
          tenantId,
          categoryId: createdCat.id,
          itemName: item.name,
          itemType: (item.type || 'checkbox') as typeof inspectionChecklistItems.$inferInsert['itemType'],
          isRequired: item.required || false,
          sortOrder: itemIdx,
        })
      }
    }
  }

  // Seed insurance companies
  for (const ic of defaultInsuranceCompanies) {
    await tx.insert(insuranceCompanies).values({
      tenantId,
      name: ic.name,
      shortName: ic.shortName,
      isActive: true,
    })
  }
}

// seedGlobalVehicleMakesModels moved to seedGlobalVehicleMakesModelsSafe() (exported, runs outside transaction)

// ==================== LETTER HEAD & PRINT TEMPLATES ====================

async function seedLetterHeadAndTemplates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantInfo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultWarehouse: any
) {
  // Escape HTML entities to prevent stored XSS
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Build header HTML from company info + warehouse contact
  const companyName = escHtml(tenantInfo?.name || 'My Business')
  const address = escHtml(defaultWarehouse?.address || '')
  const phone = escHtml(defaultWarehouse?.phone || '')
  const email = escHtml(defaultWarehouse?.email || '')

  const contactParts = [address, phone, email].filter(Boolean)
  const contactLine = contactParts.length > 0
    ? `<p style="margin:0;font-size:11px;color:#666;">${contactParts.join(' | ')}</p>`
    : ''

  const headerHtml = `<div style="text-align:center;padding:10px 0;">
  <h1 style="margin:0;font-size:20px;font-weight:bold;color:#333;">${companyName}</h1>
  ${contactLine}
</div>`

  const footerHtml = `<div style="text-align:center;padding:8px 0;border-top:1px solid #eee;">
  <p style="margin:0;font-size:10px;color:#999;">Thank you for your business</p>
</div>`

  // Create default letter head
  const [letterHead] = await tx.insert(letterHeads).values({
    tenantId,
    name: 'Default',
    isDefault: true,
    headerHtml,
    footerHtml,
    headerHeight: 60,
    footerHeight: 30,
    alignment: 'center',
    isActive: true,
  }).returning()

  // Create print templates for all document types
  for (const doc of printTemplateDocumentTypes) {
    await tx.insert(printTemplates).values({
      tenantId,
      name: `Default ${doc.name}`,
      documentType: doc.type,
      letterHeadId: letterHead.id,
      paperSize: doc.type === 'receipt' ? '80mm' : 'a4',
      orientation: 'portrait',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      showLogo: true,
      showHeader: true,
      showFooter: true,
      isDefault: true,
      isActive: true,
    })
  }
}

// ==================== RESTAURANT TABLES ====================

async function createRestaurantTables(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  numberOfTables: number,
  areas: string[]
) {
  const tables = []
  const tablesPerArea = Math.ceil(numberOfTables / areas.length)

  let tableNumber = 1
  for (const area of areas) {
    const count = Math.min(tablesPerArea, numberOfTables - tables.length)
    for (let i = 0; i < count; i++) {
      tables.push({
        tenantId,
        name: `T${tableNumber}`,
        area,
        capacity: 4,
        isActive: true,
      })
      tableNumber++
    }
  }

  if (tables.length > 0) {
    await tx.insert(restaurantTables).values(tables)
  }
}

// ==================== AUTO SERVICE TYPES ====================

async function createAutoServiceTypes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  groups: ServiceGroupSeed[],
  defaultLaborRate?: number
) {
  for (const group of groups) {
    const [createdGroup] = await tx.insert(serviceTypeGroups).values({
      tenantId,
      name: group.name,
      description: group.description || null,
      isActive: true,
    }).returning()

    if (group.services.length > 0) {
      await tx.insert(serviceTypes).values(
        group.services.map((service) => ({
          tenantId,
          groupId: createdGroup.id,
          name: service.name,
          defaultHours: service.defaultHours ? String(service.defaultHours) : null,
          defaultRate: defaultLaborRate
            ? String(defaultLaborRate)
            : service.defaultRate
              ? String(service.defaultRate)
              : null,
          isActive: true,
        }))
      )
    }
  }
}

// ==================== MINIMAL DEFAULTS (Skip Setup) ====================

export async function createMinimalDefaults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  businessType?: string,
  tenantCurrency?: string,
  ownerUserId?: string
) {
  const tenantInfo = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  const bType = businessType || tenantInfo?.businessType || 'retail'
  const currency = tenantCurrency || tenantInfo?.currency || 'LKR'

  await tx.update(tenants).set({
    setupCompletedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(tenants.id, tenantId))

  const [warehouse] = await tx.insert(warehouses).values({
    tenantId,
    name: 'Main Warehouse',
    code: 'MAIN',
    isDefault: true,
    isActive: true,
  }).returning()

  const [posProfile] = await tx.insert(posProfiles).values({
    tenantId,
    name: 'Default POS',
    code: 'DEFAULT',
    isDefault: true,
    warehouseId: warehouse.id,
    status: 'active',
  }).returning()

  await tx.insert(posProfilePaymentMethods).values({
    tenantId,
    posProfileId: posProfile.id,
    paymentMethod: 'cash',
    isDefault: true,
    sortOrder: 0,
  })

  // Assign owner to POS profile
  if (ownerUserId) {
    await tx.insert(posProfileUsers).values({
      tenantId,
      posProfileId: posProfile.id,
      userId: ownerUserId,
      isDefault: true,
    })
  }

  // Seed COA and accounting settings even for skip path
  await seedChartOfAccounts(tx, tenantId, bType, currency, undefined, 'numbered')

  // Seed modes of payment (Cash, Bank Transfer, Credit Card, Cheque)
  await seedModesOfPayment(tx, tenantId)

  // Seed default fiscal year (Jan 1 – Dec 31 current year)
  await seedFiscalYear(tx, tenantId, {
    coaTemplate: 'numbered',
    selectedCategories: [],
    paymentMethods: ['cash'],
    posProfileName: 'Default POS',
    receiptFormat: '80mm',
  })

  // Seed default cost center ("Main") and link to accounting settings + POS profile
  const createdCostCenters = await seedCostCenters(tx, tenantId, ['Main'])
  if (createdCostCenters.length > 0) {
    await tx.update(accountingSettings)
      .set({ defaultCostCenterId: createdCostCenters[0].id })
      .where(eq(accountingSettings.tenantId, tenantId))

    await tx.update(posProfiles)
      .set({ costCenterId: createdCostCenters[0].id })
      .where(eq(posProfiles.id, posProfile.id))
  }

  // Seed letter head and print templates
  await seedLetterHeadAndTemplates(tx, tenantId, tenantInfo, warehouse)

  // Seed cancellation reasons for the correct business type
  await seedCancellationReasons(tx, tenantId, bType)

  return { warehouseId: warehouse.id, posProfileId: posProfile.id }
}

// ==================== CHART OF ACCOUNTS ====================

async function seedChartOfAccounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  businessType: string,
  currency: string,
  accountOverrides?: Record<string, string>,
  coaTemplate?: 'numbered' | 'unnumbered'
) {
  const template = getChartOfAccountsForBusinessType(businessType)
  const accountNumberToId = new Map<string, string>()

  // Delete any existing COA and accounting settings for this tenant to handle retries
  await tx.delete(accountingSettings).where(eq(accountingSettings.tenantId, tenantId))
  await tx.delete(chartOfAccounts).where(eq(chartOfAccounts.tenantId, tenantId))

  async function insertAccounts(accounts: AccountTemplate[], parentId: string | null) {
    for (const account of accounts) {
      // For unnumbered template, set account number to null
      const accountNumber = coaTemplate === 'unnumbered' ? null : account.accountNumber

      const [inserted] = await tx.insert(chartOfAccounts).values({
        tenantId,
        name: account.name,
        accountNumber,
        rootType: account.rootType,
        accountType: account.accountType as typeof chartOfAccounts.$inferInsert['accountType'],
        isGroup: account.isGroup,
        isSystemAccount: account.isSystemAccount,
        currency,
        parentId,
      }).returning()

      // Store mapping for system account defaults
      if (accountNumber) {
        accountNumberToId.set(accountNumber, inserted.id)
      }

      // Recursively insert children
      if (account.children && account.children.length > 0) {
        await insertAccounts(account.children, inserted.id)
      }
    }
  }

  await insertAccounts(template, null)

  // Create accounting settings with system account defaults, applying overrides if provided
  const settingsData: Record<string, unknown> = { tenantId }
  for (const [settingKey, defaultAccountNumber] of Object.entries(SYSTEM_ACCOUNT_DEFAULTS)) {
    // Use override if provided, otherwise use default
    const accountNumber = accountOverrides?.[settingKey] || defaultAccountNumber
    const accountId = accountNumberToId.get(accountNumber)
    if (accountId) {
      settingsData[settingKey] = accountId
    }
  }

  // Auto-enable journal posting for sales and purchases
  settingsData.autoPostSales = true
  settingsData.autoPostPurchases = true

  // Insert new settings (existing rows already deleted at top of seedChartOfAccounts)
  await tx.insert(accountingSettings).values(settingsData as typeof accountingSettings.$inferInsert)
}


// ==================== MODES OF PAYMENT ====================

async function seedModesOfPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string
) {
  // Look up COA account IDs for linking
  const cashAccount = await tx.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.tenantId, tenantId),
      eq(chartOfAccounts.accountNumber, '1110')
    ),
    columns: { id: true },
  })
  const bankGroup = await tx.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.tenantId, tenantId),
      eq(chartOfAccounts.accountNumber, '1120')
    ),
    columns: { id: true },
  })

  const cashAccountId = cashAccount?.id || null
  const bankAccountId = bankGroup?.id || null

  // Delete any existing modes for this tenant to avoid duplicate errors on retry
  await tx.delete(modesOfPayment).where(eq(modesOfPayment.tenantId, tenantId))

  const defaultModes = [
    { name: 'Cash', type: 'cash' as const, methodKey: 'cash', accountId: cashAccountId, sortOrder: 1 },
    { name: 'Bank Transfer', type: 'bank' as const, methodKey: 'bank_transfer', accountId: bankAccountId, sortOrder: 2 },
    { name: 'Credit Card', type: 'bank' as const, methodKey: 'card', accountId: bankAccountId, sortOrder: 3 },
    { name: 'Cheque', type: 'bank' as const, methodKey: 'cheque', accountId: bankAccountId, sortOrder: 4 },
  ]

  for (const mode of defaultModes) {
    await tx.insert(modesOfPayment).values({
      tenantId,
      name: mode.name,
      type: mode.type,
      methodKey: mode.methodKey,
      defaultAccountId: mode.accountId,
      isEnabled: true,
      sortOrder: mode.sortOrder,
    })
  }
}

// ==================== CANCELLATION REASONS ====================

async function seedCancellationReasons(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  businessType: string
) {
  const reasonSeeds = getCancellationReasonsForBusinessType(businessType)
  for (const seed of reasonSeeds) {
    await tx.insert(cancellationReasons).values(
      seed.reasons.map((reason, index) => ({
        tenantId,
        documentType: seed.documentType,
        reason,
        isActive: true,
        sortOrder: index,
      }))
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { accountingSettings, chartOfAccounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { updateAccountingSettingsSchema } from '@/lib/validation/schemas/accounting'

export async function GET(_request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const tenantId = session!.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const settings = await db.query.accountingSettings.findFirst({
        where: eq(accountingSettings.tenantId, tenantId),
      })

      return NextResponse.json(settings || {})
    })
  } catch (error) {
    logError('api/accounting/settings', error)
    return NextResponse.json({ error: 'Failed to fetch accounting settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const parsed = await validateBody(request, updateAccountingSettingsSchema)
    if (!parsed.success) return parsed.response
    const {
      defaultReceivableAccountId,
      defaultPayableAccountId,
      defaultIncomeAccountId,
      defaultExpenseAccountId,
      defaultCashAccountId,
      defaultBankAccountId,
      defaultTaxAccountId,
      defaultCOGSAccountId,
      defaultRoundOffAccountId,
      defaultStockAccountId,
      defaultWriteOffAccountId,
      defaultAdvanceReceivedAccountId,
      defaultAdvancePaidAccountId,
      currentFiscalYearId,
      autoPostSales,
      autoPostPurchases,
      // Cost center & stock adjustment
      defaultCostCenterId,
      defaultStockAdjustmentAccountId,
      // Payroll defaults
      defaultSalaryPayableAccountId,
      defaultStatutoryPayableAccountId,
      defaultSalaryExpenseAccountId,
      defaultEmployerContributionAccountId,
      defaultEmployeeAdvanceAccountId,
      defaultGiftCardLiabilityAccountId,
      defaultCashOverShortAccountId,
      defaultTaxTemplateId,
      defaultPurchaseTaxTemplateId,
    } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Check if settings exist
      const existing = await db.query.accountingSettings.findFirst({
        where: eq(accountingSettings.tenantId, tenantId),
      })

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (defaultReceivableAccountId !== undefined) updateData.defaultReceivableAccountId = defaultReceivableAccountId || null
      if (defaultPayableAccountId !== undefined) updateData.defaultPayableAccountId = defaultPayableAccountId || null
      if (defaultIncomeAccountId !== undefined) updateData.defaultIncomeAccountId = defaultIncomeAccountId || null
      if (defaultExpenseAccountId !== undefined) updateData.defaultExpenseAccountId = defaultExpenseAccountId || null
      if (defaultCashAccountId !== undefined) updateData.defaultCashAccountId = defaultCashAccountId || null
      if (defaultBankAccountId !== undefined) updateData.defaultBankAccountId = defaultBankAccountId || null
      if (defaultTaxAccountId !== undefined) updateData.defaultTaxAccountId = defaultTaxAccountId || null
      if (defaultCOGSAccountId !== undefined) updateData.defaultCOGSAccountId = defaultCOGSAccountId || null
      if (defaultRoundOffAccountId !== undefined) updateData.defaultRoundOffAccountId = defaultRoundOffAccountId || null
      if (defaultStockAccountId !== undefined) updateData.defaultStockAccountId = defaultStockAccountId || null
      if (defaultWriteOffAccountId !== undefined) updateData.defaultWriteOffAccountId = defaultWriteOffAccountId || null
      if (defaultAdvanceReceivedAccountId !== undefined) updateData.defaultAdvanceReceivedAccountId = defaultAdvanceReceivedAccountId || null
      if (defaultAdvancePaidAccountId !== undefined) updateData.defaultAdvancePaidAccountId = defaultAdvancePaidAccountId || null
      if (currentFiscalYearId !== undefined) updateData.currentFiscalYearId = currentFiscalYearId || null
      if (autoPostSales !== undefined) updateData.autoPostSales = autoPostSales
      if (autoPostPurchases !== undefined) updateData.autoPostPurchases = autoPostPurchases
      // Cost center & stock adjustment
      if (defaultCostCenterId !== undefined) updateData.defaultCostCenterId = defaultCostCenterId || null
      if (defaultStockAdjustmentAccountId !== undefined) updateData.defaultStockAdjustmentAccountId = defaultStockAdjustmentAccountId || null
      // Payroll defaults
      if (defaultSalaryPayableAccountId !== undefined) updateData.defaultSalaryPayableAccountId = defaultSalaryPayableAccountId || null
      if (defaultStatutoryPayableAccountId !== undefined) updateData.defaultStatutoryPayableAccountId = defaultStatutoryPayableAccountId || null
      if (defaultSalaryExpenseAccountId !== undefined) updateData.defaultSalaryExpenseAccountId = defaultSalaryExpenseAccountId || null
      if (defaultEmployerContributionAccountId !== undefined) updateData.defaultEmployerContributionAccountId = defaultEmployerContributionAccountId || null
      if (defaultEmployeeAdvanceAccountId !== undefined) updateData.defaultEmployeeAdvanceAccountId = defaultEmployeeAdvanceAccountId || null
      // Gift card
      if (defaultGiftCardLiabilityAccountId !== undefined) updateData.defaultGiftCardLiabilityAccountId = defaultGiftCardLiabilityAccountId || null
      // POS cash over/short
      if (defaultCashOverShortAccountId !== undefined) updateData.defaultCashOverShortAccountId = defaultCashOverShortAccountId || null
      // Default tax templates
      if (defaultTaxTemplateId !== undefined) updateData.defaultTaxTemplateId = defaultTaxTemplateId || null
      if (defaultPurchaseTaxTemplateId !== undefined) updateData.defaultPurchaseTaxTemplateId = defaultPurchaseTaxTemplateId || null

      // Fix #2: Validate tax account is a liability account
      if (defaultTaxAccountId) {
        const [taxAccount] = await db.select({ rootType: chartOfAccounts.rootType })
          .from(chartOfAccounts)
          .where(eq(chartOfAccounts.id, defaultTaxAccountId))
          .limit(1)
        if (taxAccount && taxAccount.rootType !== 'liability') {
          return NextResponse.json({
            error: 'Tax account must be a liability account (rootType: liability)',
          }, { status: 400 })
        }
      }

      let result
      if (existing) {
        const [updated] = await db.update(accountingSettings)
          .set(updateData)
          .where(eq(accountingSettings.tenantId, tenantId))
          .returning()
        result = updated
      } else {
        // Create settings if they don't exist (upsert behavior)
        const [created] = await db.insert(accountingSettings).values({
          tenantId,
          ...updateData,
        }).returning()
        result = created
      }

      logAndBroadcast(tenantId, 'accounting-settings', 'updated', result.id)
      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/accounting/settings', error)
    return NextResponse.json({ error: 'Failed to update accounting settings' }, { status: 500 })
  }
}

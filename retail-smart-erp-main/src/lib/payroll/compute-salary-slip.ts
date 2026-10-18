/**
 * Salary slip computation algorithm.
 * Loads employee profile + salary structure, evaluates all components,
 * and returns computed slip data.
 */

import { evaluateFormula, type FormulaContext } from './formula-engine'
import type { TenantDb } from '@/lib/db'
import { eq, and, asc, or } from 'drizzle-orm'
import {
  employeeProfiles,
  salaryStructures,
  salaryStructureComponents,
  salaryComponents,
  employeeAdvances,
} from '@/lib/db/schema'

export interface ComputedComponent {
  componentId: string
  componentName: string
  componentType: 'earning' | 'deduction'
  abbreviation: string
  formulaUsed: string | null
  amount: number
  isStatutory: boolean
  doNotIncludeInTotal: boolean
  isPayableByEmployer: boolean
  sortOrder: number
}

export interface ComputedSlipData {
  baseSalary: number
  grossPay: number
  totalDeductions: number
  totalEmployerContributions: number
  netPay: number
  commissionAmount: number
  advanceDeduction: number
  components: ComputedComponent[]
  salaryStructureId: string | null
  salaryStructureName: string | null
}

interface ComputeOptions {
  employeeProfileId: string
  payrollMonth: number
  payrollYear: number
  totalWorkingDays: number
  paymentDays: number
  commissionAmount?: number
  includeAdvanceRecovery?: boolean
}

export async function computeSalarySlip(
  db: TenantDb,
  options: ComputeOptions
): Promise<ComputedSlipData> {
  const {
    employeeProfileId,
    totalWorkingDays,
    paymentDays,
    commissionAmount = 0,
    includeAdvanceRecovery = true,
  } = options

  // 1. Load employee profile
  const profile = await db.query.employeeProfiles.findFirst({
    where: eq(employeeProfiles.id, employeeProfileId),
  })

  if (!profile) {
    throw new Error('Employee profile not found')
  }

  const baseSalary = Number(profile.baseSalary) || 0

  // 2. Load salary structure and its components
  let structureComponents: Array<{
    componentId: string
    name: string
    abbreviation: string
    componentType: 'earning' | 'deduction'
    formulaExpression: string | null
    defaultAmount: string | null
    overrideFormula: string | null
    overrideAmount: string | null
    isStatutory: boolean
    isFlexibleBenefit: boolean
    dependsOnPaymentDays: boolean
    doNotIncludeInTotal: boolean
    isPayableByEmployer: boolean
    sortOrder: number
  }> = []

  let salaryStructureId: string | null = null
  let salaryStructureName: string | null = null

  if (profile.salaryStructureId) {
    const structure = await db.query.salaryStructures.findFirst({
      where: eq(salaryStructures.id, profile.salaryStructureId),
    })

    if (structure && structure.isActive) {
      salaryStructureId = structure.id
      salaryStructureName = structure.name

      const sscRows = await db
        .select({
          componentId: salaryStructureComponents.componentId,
          overrideFormula: salaryStructureComponents.overrideFormula,
          overrideAmount: salaryStructureComponents.overrideAmount,
          sortOrder: salaryStructureComponents.sortOrder,
          name: salaryComponents.name,
          abbreviation: salaryComponents.abbreviation,
          componentType: salaryComponents.componentType,
          formulaExpression: salaryComponents.formulaExpression,
          defaultAmount: salaryComponents.defaultAmount,
          isStatutory: salaryComponents.isStatutory,
          isFlexibleBenefit: salaryComponents.isFlexibleBenefit,
          dependsOnPaymentDays: salaryComponents.dependsOnPaymentDays,
          doNotIncludeInTotal: salaryComponents.doNotIncludeInTotal,
          isPayableByEmployer: salaryComponents.isPayableByEmployer,
        })
        .from(salaryStructureComponents)
        .innerJoin(salaryComponents, eq(salaryStructureComponents.componentId, salaryComponents.id))
        .where(
          and(
            eq(salaryStructureComponents.structureId, profile.salaryStructureId),
            eq(salaryStructureComponents.isActive, true),
            eq(salaryComponents.isActive, true)
          )
        )
        .orderBy(asc(salaryStructureComponents.sortOrder))

      structureComponents = sscRows.map((r) => ({
        componentId: r.componentId,
        name: r.name,
        abbreviation: r.abbreviation,
        componentType: r.componentType,
        formulaExpression: r.formulaExpression,
        defaultAmount: r.defaultAmount,
        overrideFormula: r.overrideFormula,
        overrideAmount: r.overrideAmount,
        isStatutory: r.isStatutory,
        isFlexibleBenefit: r.isFlexibleBenefit,
        dependsOnPaymentDays: r.dependsOnPaymentDays,
        doNotIncludeInTotal: r.doNotIncludeInTotal,
        isPayableByEmployer: r.isPayableByEmployer,
        sortOrder: r.sortOrder,
      }))
    }
  }

  // 3. Validate pro-rate calculation inputs
  if (totalWorkingDays <= 0) {
    throw new Error('totalWorkingDays must be greater than 0')
  }
  if (paymentDays < 0) {
    throw new Error('paymentDays cannot be negative')
  }
  if (paymentDays > totalWorkingDays) {
    throw new Error('paymentDays cannot exceed totalWorkingDays')
  }

  // 4. Initialize context and totals
  const context: FormulaContext = {
    base: baseSalary,
    gross: 0,
    net: 0,
    amount: 0,
  }

  const computedComponents: ComputedComponent[] = []
  const proRateRatio = paymentDays / totalWorkingDays
  let totalEmployerContributions = 0

  // 4. Process EARNING components
  const earnings = structureComponents.filter((c) => c.componentType === 'earning')
  for (const comp of earnings) {
    const formula = comp.overrideFormula || comp.formulaExpression
    const defaultAmt = Number(comp.overrideAmount || comp.defaultAmount || 0)
    context.amount = defaultAmt

    let amount: number
    if (formula) {
      amount = evaluateFormula(formula, context)
    } else {
      amount = defaultAmt
    }

    // Pro-rate if depends on payment days AND ratio is not exactly 1 (full month)
    if (comp.dependsOnPaymentDays && proRateRatio !== 1) {
      amount = Math.round(amount * proRateRatio * 100) / 100
    }

    context[comp.abbreviation] = amount

    if (!comp.doNotIncludeInTotal) {
      context.gross += amount
    }

    // Add to employer contributions if payable by employer
    if (comp.isPayableByEmployer) {
      totalEmployerContributions += amount
    }

    computedComponents.push({
      componentId: comp.componentId,
      componentName: comp.name,
      componentType: 'earning',
      abbreviation: comp.abbreviation,
      formulaUsed: formula,
      amount,
      isStatutory: comp.isStatutory,
      doNotIncludeInTotal: comp.doNotIncludeInTotal,
      isPayableByEmployer: comp.isPayableByEmployer,
      sortOrder: comp.sortOrder,
    })
  }

  // 5. Add commission as an earning (not a component, but included in gross)
  if (commissionAmount > 0) {
    context.gross += commissionAmount
  }

  context.net = context.gross

  // 6. Process DEDUCTION components
  const deductions = structureComponents.filter((c) => c.componentType === 'deduction')
  for (const comp of deductions) {
    const formula = comp.overrideFormula || comp.formulaExpression
    const defaultAmt = Number(comp.overrideAmount || comp.defaultAmount || 0)
    context.amount = defaultAmt

    let amount: number
    if (formula) {
      amount = evaluateFormula(formula, context)
    } else {
      amount = defaultAmt
    }

    // Pro-rate if depends on payment days
    if (comp.dependsOnPaymentDays && proRateRatio < 1) {
      amount = Math.round(amount * proRateRatio * 100) / 100
    }

    context[comp.abbreviation] = amount

    if (!comp.doNotIncludeInTotal) {
      context.net -= amount
    }

    if (comp.isPayableByEmployer) {
      totalEmployerContributions += amount
    }

    computedComponents.push({
      componentId: comp.componentId,
      componentName: comp.name,
      componentType: 'deduction',
      abbreviation: comp.abbreviation,
      formulaUsed: formula,
      amount,
      isStatutory: comp.isStatutory,
      doNotIncludeInTotal: comp.doNotIncludeInTotal,
      isPayableByEmployer: comp.isPayableByEmployer,
      sortOrder: comp.sortOrder,
    })
  }

  // 7. Calculate advance recovery (optimized database query)
  let advanceDeduction = 0
  if (includeAdvanceRecovery) {
    // Use proper database filtering - Drizzle enum values should match the enum definition
    const pendingAdvances = await db.query.employeeAdvances.findMany({
      where: and(
        eq(employeeAdvances.employeeProfileId, employeeProfileId),
        // Direct enum value comparison for better type safety
        or(
          eq(employeeAdvances.status, 'disbursed'),
          eq(employeeAdvances.status, 'partially_recovered')
        )
      ),
    })

    for (const advance of pendingAdvances) {
      const balance = Number(advance.balanceAmount) || 0
      if (balance <= 0) continue
      
      // Calculate recovery amount: use installment amount if specified, otherwise use balance
      const installment = Number(advance.recoveryAmountPerInstallment) || balance
      const deductAmount = Math.min(installment, balance)
      advanceDeduction += deductAmount
    }
  }

  context.net -= advanceDeduction

  // Calculate totals
  const grossPay = Math.round(context.gross * 100) / 100
  const totalDeductions = Math.round(
    computedComponents
      .filter((c) => c.componentType === 'deduction' && !c.doNotIncludeInTotal && !c.isPayableByEmployer)
      .reduce((sum, c) => sum + c.amount, 0) * 100
  ) / 100
  const netPay = Math.round(context.net * 100) / 100

  return {
    baseSalary,
    grossPay,
    totalDeductions: totalDeductions + advanceDeduction,
    totalEmployerContributions: Math.round(totalEmployerContributions * 100) / 100,
    netPay,
    commissionAmount,
    advanceDeduction,
    components: computedComponents,
    salaryStructureId,
    salaryStructureName,
  }
}

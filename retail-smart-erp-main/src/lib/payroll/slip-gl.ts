/**
 * GL lines for submitted salary slips (individually or consolidated in a payroll run).
 *
 *   Dr Salary Expense                 gross pay
 *   Dr Employer Contribution Expense  employer contributions (EPF 12% / ETF 3% ...)
 *   Cr Salary Payable                 net pay
 *   Cr Statutory Payable              employee statutory deductions + employer contributions
 *   Cr Employee Advances              advance recovery (reduces the advance receivable)
 *
 * gross = net + deductions (deductions include the advance recovery), so this always balances.
 */
import { GLValidationError, type GLEntryInput } from '@/lib/accounting/gl'

interface SlipAmounts {
  userId?: string | null
  slipNo?: string | null
  grossPay: string | number | null
  netPay: string | number | null
  totalDeductions: string | number | null
  totalEmployerContributions: string | number | null
  advanceDeduction: string | number | null
}

interface PayrollAccounts {
  defaultSalaryExpenseAccountId: string | null
  defaultSalaryPayableAccountId: string | null
  defaultStatutoryPayableAccountId: string | null
  defaultEmployerContributionAccountId: string | null
  defaultEmployeeAdvanceAccountId: string | null
}

const c = (v: unknown) => Math.round((Number(v) || 0) * 100)

export function buildSalaryGLEntries(
  settings: PayrollAccounts,
  slips: SlipAmounts[],
  opts: { label: string; party?: { userId: string } | null }
): GLEntryInput[] {
  if (!settings.defaultSalaryExpenseAccountId || !settings.defaultSalaryPayableAccountId) return []

  let gross = 0, net = 0, ded = 0, employer = 0, advance = 0
  for (const s of slips) {
    gross += c(s.grossPay)
    net += c(s.netPay)
    ded += c(s.totalDeductions)
    employer += c(s.totalEmployerContributions)
    advance += c(s.advanceDeduction)
  }
  if (net < 0) {
    throw new GLValidationError(`${opts.label}: net pay is negative (${(net / 100).toFixed(2)}). Deductions exceed gross pay.`)
  }
  const statutory = ded - advance + employer
  const party = opts.party ? { partyType: 'employee' as const, partyId: opts.party.userId } : {}
  const entries: GLEntryInput[] = []

  if (gross > 0) {
    entries.push({ accountId: settings.defaultSalaryExpenseAccountId, debit: gross / 100, ...party, remarks: `${opts.label} - salary expense` })
  }
  if (employer > 0) {
    // Without a dedicated account the employer's contribution is still a salary cost
    entries.push({
      accountId: settings.defaultEmployerContributionAccountId || settings.defaultSalaryExpenseAccountId,
      debit: employer / 100, ...party, remarks: `${opts.label} - employer contributions`,
    })
  }
  if (net > 0) {
    entries.push({ accountId: settings.defaultSalaryPayableAccountId, credit: net / 100, ...party, remarks: `${opts.label} - net salary payable` })
  }
  if (statutory > 0) {
    if (!settings.defaultStatutoryPayableAccountId) {
      throw new GLValidationError(`${opts.label}: statutory deductions/contributions of ${(statutory / 100).toFixed(2)} need a Statutory Payable account. Configure it in Accounting Settings.`)
    }
    entries.push({ accountId: settings.defaultStatutoryPayableAccountId, credit: statutory / 100, remarks: `${opts.label} - statutory contributions payable` })
  }
  if (advance > 0) {
    const advanceAccountId = settings.defaultEmployeeAdvanceAccountId || settings.defaultStatutoryPayableAccountId
    if (!advanceAccountId) {
      throw new GLValidationError(`${opts.label}: advance recovery of ${(advance / 100).toFixed(2)} needs an Employee Advance account. Configure it in Accounting Settings.`)
    }
    entries.push({ accountId: advanceAccountId, credit: advance / 100, ...party, remarks: `${opts.label} - advance recovery` })
  }
  return entries
}

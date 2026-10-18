// Default Chart of Accounts template
// Seeded per tenant on first accounting setup, customized by business type

export interface AccountTemplate {
  accountNumber: string
  name: string
  rootType: 'asset' | 'liability' | 'income' | 'expense' | 'equity'
  accountType: string
  isGroup: boolean
  isSystemAccount: boolean
  children?: AccountTemplate[]
}

// Helper to create a leaf account
function leaf(
  accountNumber: string,
  name: string,
  rootType: AccountTemplate['rootType'],
  accountType: string,
  isSystemAccount = false
): AccountTemplate {
  return { accountNumber, name, rootType, accountType, isGroup: false, isSystemAccount }
}

// Helper to create a group account
function group(
  accountNumber: string,
  name: string,
  rootType: AccountTemplate['rootType'],
  accountType: string,
  children: AccountTemplate[]
): AccountTemplate {
  return { accountNumber, name, rootType, accountType, isGroup: true, isSystemAccount: false, children }
}

/**
 * Base accounts shared across ALL business types.
 * System accounts (isSystemAccount: true) must always exist.
 */
function getBaseAccounts(): AccountTemplate[] {
  return [
    group('1000', 'Assets', 'asset', 'current_asset', [
      group('1100', 'Current Assets', 'asset', 'current_asset', [
        leaf('1110', 'Cash', 'asset', 'cash', true),
        group('1120', 'Bank Accounts', 'asset', 'bank', []),
        leaf('1130', 'Accounts Receivable', 'asset', 'receivable', true),
        leaf('1140', 'Inventory / Stock', 'asset', 'stock', true),
        leaf('1150', 'Advance Payments', 'asset', 'current_asset', true),
        leaf('1160', 'Employee Advances', 'asset', 'current_asset', true),
        leaf('1170', 'Work In Progress', 'asset', 'current_asset', true),
      ]),
      group('1200', 'Fixed Assets', 'asset', 'fixed_asset', [
        leaf('1210', 'Equipment', 'asset', 'fixed_asset'),
        leaf('1220', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation'),
      ]),
    ]),
    group('2000', 'Liabilities', 'liability', 'current_liability', [
      group('2100', 'Current Liabilities', 'liability', 'current_liability', [
        leaf('2110', 'Accounts Payable', 'liability', 'payable', true),
        leaf('2120', 'Tax Payable', 'liability', 'tax', true),
        leaf('2150', 'Customer Advances', 'liability', 'current_liability'),
      ]),
      group('2200', 'Payroll Liabilities', 'liability', 'current_liability', [
        leaf('2210', 'Salary Payable', 'liability', 'payable', true),
        leaf('2220', 'Statutory Payable', 'liability', 'payable', true),
      ]),
    ]),
    group('3000', 'Equity', 'equity', 'equity', [
      leaf('3100', "Owner's Capital", 'equity', 'equity', true),
      leaf('3200', 'Retained Earnings', 'equity', 'equity', true),
    ]),
    group('4000', 'Income', 'income', 'income_account', [
      leaf('4100', 'Sales Revenue', 'income', 'income_account', true),
      leaf('4300', 'Other Income', 'income', 'income_account'),
    ]),
    group('5000', 'Expenses', 'expense', 'expense_account', [
      leaf('5100', 'Cost of Goods Sold', 'expense', 'cost_of_goods_sold', true),
      group('5200', 'Operating Expenses', 'expense', 'expense_account', [
        leaf('5210', 'Contract Labor', 'expense', 'expense_account'),
        leaf('5220', 'Rent', 'expense', 'expense_account'),
        leaf('5230', 'Utilities', 'expense', 'expense_account'),
        leaf('5290', 'Miscellaneous Expense', 'expense', 'expense_account', true),
      ]),
      leaf('5300', 'Tax Expense', 'expense', 'expense_account'),
      group('5400', 'Payroll Expenses', 'expense', 'expense_account', [
        leaf('5410', 'Salary Expense', 'expense', 'expense_account', true),
        leaf('5420', 'Employer Contributions', 'expense', 'expense_account', true),
      ]),
      leaf('5500', 'Stock Adjustment', 'expense', 'expense_account', true),
      leaf('5600', 'Cash Over/Short', 'expense', 'expense_account', true),
      leaf('5800', 'Write Off', 'expense', 'expense_account', true),
      leaf('5900', 'Round Off', 'expense', 'round_off', true),
    ]),
  ]
}

/**
 * Returns the chart of accounts template customized for the given business type.
 * Each type gets the same base accounts plus business-type-specific additions.
 */
export function getChartOfAccountsForBusinessType(businessType: string): AccountTemplate[] {
  const coa = getBaseAccounts()

  // Helper to find a group and add children to it
  function addToGroup(parentNumber: string, ...accounts: AccountTemplate[]) {
    function findAndAdd(nodes: AccountTemplate[]): boolean {
      for (const node of nodes) {
        if (node.accountNumber === parentNumber && node.isGroup && node.children) {
          node.children.push(...accounts)
          return true
        }
        if (node.children && findAndAdd(node.children)) return true
      }
      return false
    }
    findAndAdd(coa)
  }

  switch (businessType) {
    case 'retail':
      // Liabilities
      addToGroup('2100',
        leaf('2130', 'Gift Card Liability', 'liability', 'current_liability'),
        leaf('2140', 'Layaway Deposits', 'liability', 'current_liability'),
      )
      // Income
      addToGroup('4000',
        leaf('4200', 'Online Sales Revenue', 'income', 'income_account'),
      )
      // Expenses
      addToGroup('5200',
        leaf('5240', 'Commission Expense', 'expense', 'expense_account'),
        leaf('5250', 'Shipping & Delivery', 'expense', 'expense_account'),
      )
      break

    case 'restaurant':
      // Income - replace generic with restaurant-specific
      addToGroup('4000',
        leaf('4110', 'Dine-In Revenue', 'income', 'income_account'),
        leaf('4120', 'Takeout Revenue', 'income', 'income_account'),
        leaf('4130', 'Delivery Revenue', 'income', 'income_account'),
      )
      // Liabilities
      addToGroup('2100',
        leaf('2130', 'Gift Card Liability', 'liability', 'current_liability'),
        leaf('2160', 'Reservation Deposits', 'liability', 'current_liability'),
      )
      // Expenses
      addToGroup('5200',
        leaf('5250', 'Food Cost', 'expense', 'expense_account'),
        leaf('5260', 'Beverage Cost', 'expense', 'expense_account'),
        leaf('5270', 'Kitchen Supplies', 'expense', 'expense_account'),
        leaf('5280', 'Waste & Spoilage', 'expense', 'expense_account'),
      )
      break

    case 'supermarket':
      // Liabilities
      addToGroup('2100',
        leaf('2130', 'Gift Card Liability', 'liability', 'current_liability'),
      )
      // Income
      addToGroup('4000',
        leaf('4200', 'Online Sales Revenue', 'income', 'income_account'),
      )
      // Expenses
      addToGroup('5200',
        leaf('5240', 'Shrinkage & Loss', 'expense', 'expense_account'),
        leaf('5250', 'Packaging', 'expense', 'expense_account'),
        leaf('5260', 'Cold Storage', 'expense', 'expense_account'),
      )
      break

    case 'auto_service':
      // Income
      addToGroup('4000',
        leaf('4200', 'Service / Labor Revenue', 'income', 'income_account'),
        leaf('4210', 'Parts Revenue', 'income', 'income_account'),
        leaf('4220', 'Sublet Revenue', 'income', 'income_account'),
        leaf('4230', 'Insurance Revenue', 'income', 'income_account'),
      )
      // Liabilities
      addToGroup('2100',
        leaf('2130', 'Gift Card Liability', 'liability', 'current_liability'),
        leaf('2170', 'Core Deposits Liability', 'liability', 'current_liability'),
        leaf('2180', 'Warranty Claims Payable', 'liability', 'current_liability'),
      )
      // Expenses
      addToGroup('5200',
        leaf('5250', 'Sublet Expense', 'expense', 'expense_account'),
        leaf('5260', 'Shop Supplies', 'expense', 'expense_account'),
        leaf('5270', 'Technician Commissions', 'expense', 'expense_account'),
      )
      break

    case 'dealership':
      // Income
      addToGroup('4000',
        leaf('4200', 'New Vehicle Sales Revenue', 'income', 'income_account'),
        leaf('4210', 'Used Vehicle Sales Revenue', 'income', 'income_account'),
        leaf('4220', 'Finance & Insurance Revenue', 'income', 'income_account'),
        leaf('4230', 'Trade-In Profit', 'income', 'income_account'),
        leaf('4240', 'Extended Warranty Revenue', 'income', 'income_account'),
        leaf('4250', 'Parts & Accessories Revenue', 'income', 'income_account'),
      )
      // Assets
      addToGroup('1100',
        leaf('1180', 'Vehicle Inventory', 'asset', 'stock'),
        leaf('1190', 'Trade-In Inventory', 'asset', 'current_asset'),
      )
      // Liabilities
      addToGroup('2100',
        leaf('2130', 'Gift Card Liability', 'liability', 'current_liability'),
        leaf('2170', 'Vehicle Financing Payable', 'liability', 'current_liability'),
        leaf('2180', 'Warranty Reserve Liability', 'liability', 'current_liability'),
      )
      // Expenses
      addToGroup('5200',
        leaf('5240', 'Vehicle Acquisition Cost', 'expense', 'expense_account'),
        leaf('5250', 'Sales Commission Expense', 'expense', 'expense_account'),
        leaf('5260', 'Vehicle Preparation Expense', 'expense', 'expense_account'),
        leaf('5270', 'Advertising & Marketing', 'expense', 'expense_account'),
        leaf('5280', 'Demo Vehicle Expense', 'expense', 'expense_account'),
      )
      break
  }

  return coa
}

/**
 * Backward-compatible alias — returns the retail template.
 */
export function getDefaultChartOfAccounts(): AccountTemplate[] {
  return getChartOfAccountsForBusinessType('retail')
}

/**
 * Mapping from system account types to their default account numbers.
 * Used to auto-configure accounting settings after seeding.
 */
export const SYSTEM_ACCOUNT_DEFAULTS = {
  defaultCashAccountId: '1110',
  defaultReceivableAccountId: '1130',
  defaultStockAccountId: '1140',
  defaultPayableAccountId: '2110',
  defaultTaxAccountId: '2120',
  defaultIncomeAccountId: '4100',
  defaultExpenseAccountId: '5290',
  defaultCOGSAccountId: '5100',
  defaultAdvancePaidAccountId: '1150',
  defaultRoundOffAccountId: '5900',
  // Payroll accounts
  defaultSalaryPayableAccountId: '2210',
  defaultStatutoryPayableAccountId: '2220',
  defaultSalaryExpenseAccountId: '5410',
  defaultEmployerContributionAccountId: '5420',
  defaultEmployeeAdvanceAccountId: '1160',
  // Additional defaults
  defaultAdvanceReceivedAccountId: '2150',
  defaultWriteOffAccountId: '5800',
  defaultStockAdjustmentAccountId: '5500',
  defaultWipAccountId: '1170',
  defaultGiftCardLiabilityAccountId: '2130',
  defaultCashOverShortAccountId: '5600',
} as const

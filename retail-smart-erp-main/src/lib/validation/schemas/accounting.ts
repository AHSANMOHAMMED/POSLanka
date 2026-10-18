import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema, dateStringSchema, shortTextSchema,
  journalEntryTypeSchema, journalEntryStatusSchema,
  paymentEntryTypeSchema, paymentEntryStatusSchema, paymentEntryPartyTypeSchema,
  accountRootTypeSchema, accountTypeSchema, partyTypeSchema,
  budgetControlActionSchema, budgetStatusSchema,
  optimisticLockSchema, modeOfPaymentTypeSchema, dueDateBasedOnSchema,
  bankTransactionStatusSchema,
} from './common'

// ==================== JOURNAL ENTRIES ====================

// GET /api/accounting/journal-entries
export const journalEntriesListSchema = paginatedSearchSchema.extend({
  status: journalEntryStatusSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})

const journalEntryLineSchema = z.object({
  accountId: uuidSchema,
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  partyType: partyTypeSchema.optional(),
  partyId: optionalUuid,
  costCenterId: optionalUuid,
  remarks: z.string().max(500).optional(),
}).refine(
  data => !(data.debit > 0 && data.credit > 0),
  { message: 'Each line must have either a debit or a credit, not both', path: ['debit'] }
)

// POST /api/accounting/journal-entries
export const createJournalEntrySchema = z.object({
  entryType: journalEntryTypeSchema.default('journal'),
  postingDate: z.string().min(1, 'Posting date is required'),
  remarks: z.string().max(2000).optional(),
  items: z.array(journalEntryLineSchema).min(2, 'At least 2 line items required').max(500),
})

// POST /api/accounting/journal-entries/[id]/cancel
export const cancelJournalEntrySchema = z.object({
  cancellationReason: z.string().max(1000).optional(),
})

// ==================== PAYMENT ENTRIES ====================

// GET /api/accounting/payment-entries
export const paymentEntriesListSchema = paginatedSearchSchema.extend({
  status: paymentEntryStatusSchema.optional(),
  paymentType: paymentEntryTypeSchema.optional(),
  partyType: paymentEntryPartyTypeSchema.optional(),
  partyId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})

const paymentReferenceSchema = z.object({
  referenceType: z.string().max(100),
  referenceId: uuidSchema,
  referenceNumber: z.string().max(100).optional(),
  totalAmount: z.coerce.number(),
  outstandingAmount: z.coerce.number(),
  allocatedAmount: z.coerce.number().positive(),
  paymentScheduleId: optionalUuid,
})

const paymentDeductionSchema = z.object({
  accountId: uuidSchema,
  costCenterId: optionalUuid,
  amount: z.coerce.number().positive(),
  description: z.string().max(500).optional(),
})

// POST /api/accounting/payment-entries
export const createPaymentEntrySchema = z.object({
  paymentType: paymentEntryTypeSchema,
  postingDate: z.string().min(1, 'Posting date is required'),
  partyType: paymentEntryPartyTypeSchema.optional(),
  partyId: optionalUuid,
  partyName: z.string().max(255).optional(),
  paidFromAccountId: optionalUuid,
  paidToAccountId: optionalUuid,
  modeOfPaymentId: uuidSchema,
  paidAmount: z.coerce.number().positive('Paid amount must be greater than zero'),
  receivedAmount: z.coerce.number().min(0).optional(),
  referenceNo: z.string().max(100).optional(),
  referenceDate: z.string().optional(),
  bankAccountId: optionalUuid,
  remarks: z.string().max(2000).optional(),
  references: z.array(paymentReferenceSchema).max(100).optional(),
  deductions: z.array(paymentDeductionSchema).max(50).optional(),
})

// POST /api/accounting/payment-entries/[id]/cancel
export const cancelPaymentEntrySchema = z.object({
  cancellationReason: z.string().trim().min(1, 'Cancellation reason is required').max(1000),
})

// ==================== CHART OF ACCOUNTS ====================

// GET /api/accounting/accounts
export const accountsListSchema = paginatedSearchSchema.extend({
  tree: z.string().optional().transform(v => v === 'true'),
})

// POST /api/accounting/accounts
export const createAccountSchema = z.object({
  name: shortTextSchema,
  accountNumber: z.string().trim().min(1, 'Account number is required').max(50),
  rootType: accountRootTypeSchema,
  accountType: accountTypeSchema,
  parentId: optionalUuid,
  isGroup: z.boolean().default(false),
  description: z.string().max(500).optional(),
  currency: z.string().max(3).optional(),
})

// ==================== BANK ACCOUNTS ====================

// GET /api/accounting/bank-accounts
export const bankAccountsListSchema = paginatedSearchSchema

// POST /api/accounting/bank-accounts
export const createBankAccountSchema = z.object({
  accountName: shortTextSchema,
  bankName: z.string().max(255).optional(),
  accountNumber: z.string().max(50).optional(),
  branchCode: z.string().max(20).optional(),
  iban: z.string().max(34).optional(),
  swiftCode: z.string().max(11).optional(),
  isDefault: z.boolean().default(false),
})

// ==================== FISCAL YEARS ====================

// GET /api/accounting/fiscal-years
export const fiscalYearsListSchema = paginatedSearchSchema

// POST /api/accounting/fiscal-years
export const createFiscalYearSchema = z.object({
  name: shortTextSchema,
  startDate: dateStringSchema,
  endDate: dateStringSchema,
}).refine(
  data => data.startDate < data.endDate,
  { message: 'End date must be after start date', path: ['endDate'] }
)

// ==================== OPENING BALANCES ====================

const openingBalanceEntrySchema = z.object({
  accountId: uuidSchema,
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  remarks: z.string().max(500).optional(),
})

// POST /api/accounting/opening-balances
export const createOpeningBalancesSchema = z.object({
  entries: z.array(openingBalanceEntrySchema).max(500).optional(),
  postingDate: z.string().min(1, 'Posting date is required'),
  importFromExisting: z.boolean().optional(),
})

// ==================== TAX TEMPLATES ====================

// GET /api/accounting/tax-templates
export const taxTemplatesListSchema = paginatedSearchSchema

const taxTemplateItemSchema = z.object({
  taxName: z.string().max(100),
  rate: z.coerce.number().min(0).max(100),
  accountId: optionalUuid,
  includedInPrice: z.boolean().default(false),
})

// POST /api/accounting/tax-templates
export const createTaxTemplateSchema = z.object({
  name: shortTextSchema,
  isActive: z.boolean().default(true),
  items: z.array(taxTemplateItemSchema).max(100).optional(),
})

// ==================== BUDGETS ====================

// GET /api/accounting/budgets
export const budgetsListSchema = paginatedSearchSchema.extend({
  status: z.string().max(50).optional(),
})

const budgetItemSchema = z.object({
  accountId: uuidSchema,
  monthlyAmount: z.coerce.number().min(0).optional(),
  annualAmount: z.coerce.number().min(0).optional(),
  controlAction: budgetControlActionSchema.default('warn'),
})

// POST /api/accounting/budgets
export const createBudgetSchema = z.object({
  name: shortTextSchema,
  fiscalYearId: optionalUuid,
  costCenterId: optionalUuid,
  items: z.array(budgetItemSchema).max(500).optional(),
})

// ==================== COST CENTERS ====================

// GET /api/accounting/cost-centers
export const costCentersListSchema = paginatedSearchSchema.extend({
  tree: z.string().optional().transform(v => v === 'true'),
})

// POST /api/accounting/cost-centers
export const createCostCenterSchema = z.object({
  name: shortTextSchema,
  parentId: optionalUuid,
  isGroup: z.boolean().default(false),
})

// ==================== UPDATE SCHEMAS (detail routes) ====================

// PUT /api/accounting/accounts/[id]
export const updateAccountSchema = z.object({
  name: shortTextSchema.optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  accountNumber: z.string().trim().min(1).max(20).optional(),
  parentId: optionalUuid,
  rootType: accountRootTypeSchema.optional(),
  accountType: accountTypeSchema.optional(),
  isGroup: z.boolean().optional(),
})

// PUT /api/accounting/bank-accounts/[id]
export const updateBankAccountSchema = optimisticLockSchema.extend({
  accountName: shortTextSchema.optional(),
  bankName: z.string().max(255).nullish(),
  accountNumber: z.string().max(50).nullish(),
  branchCode: z.string().max(20).nullish(),
  iban: z.string().max(34).nullish(),
  swiftCode: z.string().max(11).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

// PUT /api/accounting/budgets/[id]
export const updateBudgetSchema = optimisticLockSchema.extend({
  name: shortTextSchema.optional(),
  fiscalYearId: optionalUuid,
  costCenterId: optionalUuid,
  status: budgetStatusSchema.optional(),
  items: z.array(z.object({
    accountId: uuidSchema,
    monthlyAmount: z.coerce.number().min(0).optional(),
    annualAmount: z.coerce.number().min(0).optional(),
    controlAction: budgetControlActionSchema.default('warn'),
  })).max(500).optional(),
})

// PUT /api/accounting/cost-centers/[id]
export const updateCostCenterSchema = z.object({
  name: shortTextSchema.optional(),
  parentId: optionalUuid,
  isGroup: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

// PUT /api/accounting/fiscal-years/[id]
export const updateFiscalYearSchema = z.object({
  name: shortTextSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isClosed: z.boolean().optional(),
})

// PUT /api/accounting/journal-entries/[id]
export const updateJournalEntrySchema = optimisticLockSchema.extend({
  postingDate: z.string().min(1).optional(),
  entryType: journalEntryTypeSchema.optional(),
  remarks: z.string().max(2000).optional(),
  items: z.array(z.object({
    accountId: uuidSchema,
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    partyType: partyTypeSchema.optional(),
    partyId: optionalUuid,
    costCenterId: optionalUuid,
    remarks: z.string().max(500).optional(),
  })).min(2).max(500).optional(),
})

// PUT /api/accounting/payment-entries/[id]
export const updatePaymentEntrySchema = optimisticLockSchema.extend({
  paymentType: paymentEntryTypeSchema.optional(),
  postingDate: z.string().min(1).optional(),
  partyType: paymentEntryPartyTypeSchema.optional(),
  partyId: optionalUuid,
  partyName: z.string().max(255).optional(),
  paidFromAccountId: optionalUuid,
  paidToAccountId: optionalUuid,
  modeOfPaymentId: optionalUuid,
  paidAmount: z.coerce.number().positive().optional(),
  receivedAmount: z.coerce.number().min(0).optional(),
  referenceNo: z.string().max(100).optional(),
  referenceDate: z.string().optional(),
  bankAccountId: optionalUuid,
  remarks: z.string().max(2000).optional(),
  references: z.array(z.object({
    referenceType: z.string().max(100),
    referenceId: uuidSchema,
    referenceNumber: z.string().max(100).optional(),
    totalAmount: z.coerce.number(),
    outstandingAmount: z.coerce.number(),
    allocatedAmount: z.coerce.number().positive(),
    paymentScheduleId: optionalUuid,
  })).max(100).optional(),
  deductions: z.array(z.object({
    accountId: uuidSchema,
    costCenterId: optionalUuid,
    amount: z.coerce.number().positive(),
    description: z.string().max(500).optional(),
  })).max(50).optional(),
})

// PUT /api/accounting/tax-templates/[id]
export const updateTaxTemplateSchema = z.object({
  name: shortTextSchema.optional(),
  isActive: z.boolean().optional(),
  items: z.array(z.object({
    taxName: z.string().max(100),
    rate: z.coerce.number().min(0).max(100),
    accountId: optionalUuid,
    includedInPrice: z.boolean().default(false),
  })).max(100).optional(),
})

// POST /api/accounting/recurring-entries
export const createRecurringEntrySchema = z.object({
  name: shortTextSchema,
  entryType: journalEntryTypeSchema.default('journal'),
  remarks: z.string().max(2000).nullish(),
  recurrencePattern: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  startDate: dateStringSchema,
  endDate: z.string().nullish(),
  items: z.array(z.object({
    accountId: uuidSchema,
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    partyType: partyTypeSchema.nullish(),
    partyId: optionalUuid,
    costCenterId: optionalUuid,
    remarks: z.string().max(500).nullish(),
  })).min(2, 'At least 2 line items are required').max(500),
})

// POST /api/accounting/period-closing
export const createPeriodClosingSchema = z.object({
  fiscalYearId: uuidSchema,
  closingDate: dateStringSchema,
  closingAccountId: uuidSchema,
})

// PUT /api/accounting/recurring-entries/[id]
export const updateRecurringEntrySchema = optimisticLockSchema.extend({
  name: shortTextSchema.optional(),
  entryType: journalEntryTypeSchema.optional(),
  remarks: z.string().max(2000).nullish(),
  recurrencePattern: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullish(),
  isActive: z.boolean().optional(),
  items: z.array(z.object({
    accountId: uuidSchema,
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    partyType: partyTypeSchema.nullish(),
    partyId: optionalUuid,
    costCenterId: optionalUuid,
    remarks: z.string().max(500).nullish(),
  })).min(2).max(500).optional(),
})

// ==================== BANK TRANSACTIONS ====================

// GET /api/accounting/bank-accounts/[id]/transactions
export const bankTransactionsListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: bankTransactionStatusSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})

// POST /api/accounting/bank-accounts/[id]/import-statement
const bankStatementRowSchema = z.object({
  transactionDate: z.string().min(1),
  description: z.string().max(500).optional(),
  referenceNumber: z.string().max(100).optional(),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
})

export const importBankStatementSchema = z.object({
  rows: z.array(bankStatementRowSchema).min(1, 'At least one row is required').max(5000),
})

// POST /api/accounting/bank-accounts/[id]/transactions/[txnId]/match
export const matchBankTransactionSchema = z.object({
  voucherType: z.string().trim().min(1, 'Voucher type is required').max(100),
  voucherId: uuidSchema,
})

// GET /api/accounting/bank-accounts/[id]/match-candidates
export const matchCandidatesQuerySchema = z.object({
  search: z.string().max(200).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// POST /api/accounting/bank-accounts/[id]/reconciliation
export const reconcileBankAccountSchema = z.object({
  fromDate: z.string().min(1, 'From date is required'),
  toDate: z.string().min(1, 'To date is required'),
})

// ==================== OUTSTANDING / UNALLOCATED ====================

// GET /api/accounting/payment-entries/outstanding-invoices
export const outstandingInvoicesQuerySchema = z.object({
  partyType: z.enum(['customer', 'supplier']),
  partyId: uuidSchema,
})

// GET /api/accounting/payment-entries/unallocated-payments
export const unallocatedPaymentsQuerySchema = z.object({
  partyType: z.enum(['customer', 'supplier']),
  partyId: uuidSchema,
})

// ==================== DUNNINGS ====================

// GET /api/accounting/dunnings
export const dunningsListSchema = paginatedSearchSchema.extend({
  status: z.enum(['draft', 'unresolved', 'resolved', 'cancelled']).optional(),
  customerId: z.string().uuid().optional(),
})

// POST /api/accounting/dunnings
export const createDunningSchema = z.object({
  dunningTypeId: uuidSchema,
  customerId: uuidSchema,
  saleId: uuidSchema,
})

// PUT /api/accounting/dunnings/[id]
export const updateDunningSchema = z.object({
  status: z.enum(['draft', 'unresolved', 'resolved', 'cancelled']).optional(),
  sentAt: z.string().nullish(),
})

// ==================== DUNNING TYPES ====================

// GET /api/accounting/dunning-types
export const dunningTypesListSchema = paginatedSearchSchema

// POST /api/accounting/dunning-types
export const createDunningTypeSchema = z.object({
  name: shortTextSchema,
  startDay: z.coerce.number().int().min(0).default(0),
  endDay: z.coerce.number().int().min(0).default(30),
  dunningFee: z.coerce.number().min(0).default(0),
  interestRate: z.coerce.number().min(0).max(100).default(0),
  bodyText: z.string().max(5000).nullish(),
  isActive: z.boolean().default(true),
})

// PUT /api/accounting/dunning-types/[id]
export const updateDunningTypeSchema = z.object({
  name: shortTextSchema.optional(),
  startDay: z.coerce.number().int().min(0).optional(),
  endDay: z.coerce.number().int().min(0).optional(),
  dunningFee: z.coerce.number().min(0).optional(),
  interestRate: z.coerce.number().min(0).max(100).optional(),
  bodyText: z.string().max(5000).nullish(),
  isActive: z.boolean().optional(),
})

// ==================== MODES OF PAYMENT ====================

// GET /api/accounting/modes-of-payment
export const modesOfPaymentListSchema = paginatedSearchSchema.extend({
  enabled: z.string().optional().transform(v => v === 'true'),
})

// POST /api/accounting/modes-of-payment
export const createModeOfPaymentSchema = z.object({
  name: shortTextSchema,
  type: modeOfPaymentTypeSchema.default('general'),
  methodKey: z.string().max(30).optional(),
  defaultAccountId: uuidSchema, // Required — GL account must be set for each mode
  isEnabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

// PUT /api/accounting/modes-of-payment/[id]
export const updateModeOfPaymentSchema = z.object({
  name: shortTextSchema.optional(),
  type: modeOfPaymentTypeSchema.optional(),
  methodKey: z.string().max(30).optional(),
  defaultAccountId: uuidSchema.optional(), // When provided, must be a valid UUID
  isEnabled: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

// ==================== PAYMENT RECONCILIATION ====================

// GET /api/accounting/payment-reconciliation
export const paymentReconciliationQuerySchema = z.object({
  partyType: z.enum(['customer', 'supplier']),
  partyId: uuidSchema,
})

// POST /api/accounting/payment-reconciliation/allocate
export const paymentReconciliationAllocateSchema = z.object({
  payments: z.array(z.object({
    id: uuidSchema,
    sourceType: z.enum(['payment_entry', 'journal_entry_item']).default('payment_entry'),
    unallocatedAmount: z.coerce.number(),
    postingDate: z.string(),
  })).min(1, 'At least one payment is required').max(500),
  invoices: z.array(z.object({
    referenceId: uuidSchema,
    referenceType: z.string().max(100),
    referenceNumber: z.string().max(100).optional(),
    outstandingAmount: z.coerce.number(),
    postingDate: z.string(),
  })).min(1, 'At least one invoice is required').max(500),
})

// POST /api/accounting/payment-reconciliation/reconcile
const reconciliationAllocationSchema = z.object({
  paymentEntryId: uuidSchema.optional(),
  sourceJeItemId: uuidSchema.optional(),
  referenceType: z.string().max(100),
  referenceId: uuidSchema,
  referenceNumber: z.string().max(100).optional(),
  allocatedAmount: z.coerce.number().positive(),
}).refine(
  data => !!(data.paymentEntryId || data.sourceJeItemId),
  { message: 'Either paymentEntryId or sourceJeItemId is required' }
)

export const paymentReconciliationReconcileSchema = z.object({
  allocations: z.array(reconciliationAllocationSchema).min(1, 'At least one allocation is required').max(500),
})

// POST /api/accounting/payment-reconciliation/unreconcile
export const paymentReconciliationUnreconcileSchema = z.object({
  paymentEntryReferenceIds: z.array(uuidSchema).min(1, 'At least one reference ID is required').max(500),
})

// ==================== PAYMENT REQUESTS ====================

// GET /api/accounting/payment-requests
export const paymentRequestsListSchema = paginatedSearchSchema.extend({
  status: z.enum(['draft', 'requested', 'paid', 'cancelled']).optional(),
})

// POST /api/accounting/payment-requests
export const createPaymentRequestSchema = z.object({
  requestType: z.enum(['inward', 'outward']),
  referenceType: z.string().max(100),
  referenceId: uuidSchema,
  partyType: z.enum(['customer', 'supplier']),
  partyId: uuidSchema,
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  currency: z.string().max(3).optional(),
  emailTo: z.string().email().max(255).nullish(),
  subject: z.string().max(255).nullish(),
  message: z.string().max(5000).nullish(),
  modeOfPaymentId: optionalUuid,
})

// PUT /api/accounting/payment-requests/[id]
export const updatePaymentRequestSchema = z.object({
  status: z.enum(['draft', 'requested', 'paid', 'cancelled']).optional(),
  emailTo: z.string().email().max(255).nullish(),
  subject: z.string().max(255).nullish(),
  message: z.string().max(5000).nullish(),
  modeOfPaymentId: optionalUuid,
  paymentEntryId: optionalUuid,
  paidAt: z.string().nullish(),
})

// ==================== PAYMENT TERMS ====================

// GET /api/accounting/payment-terms
export const paymentTermsListSchema = paginatedSearchSchema.extend({
  active: z.string().optional().transform(v => v === 'true'),
})

// POST /api/accounting/payment-terms
export const createPaymentTermSchema = z.object({
  name: shortTextSchema,
  invoicePortion: z.coerce.number().positive().max(100, 'Invoice portion cannot exceed 100'),
  dueDateBasedOn: dueDateBasedOnSchema.default('days_after_invoice'),
  creditDays: z.coerce.number().int().min(0).default(0),
  discountType: z.enum(['percentage', 'fixed']).nullish(),
  discount: z.coerce.number().min(0).nullish(),
  discountValidityDays: z.coerce.number().int().min(0).nullish(),
  description: z.string().max(500).nullish(),
})

// PUT /api/accounting/payment-terms/[id]
export const updatePaymentTermSchema = z.object({
  name: shortTextSchema.optional(),
  invoicePortion: z.coerce.number().positive().max(100).optional(),
  dueDateBasedOn: dueDateBasedOnSchema.optional(),
  creditDays: z.coerce.number().int().min(0).optional(),
  discountType: z.enum(['percentage', 'fixed']).nullish(),
  discount: z.coerce.number().min(0).nullish(),
  discountValidityDays: z.coerce.number().int().min(0).nullish(),
  description: z.string().max(500).nullish(),
  isActive: z.boolean().optional(),
})

// ==================== PAYMENT TERMS TEMPLATES ====================

// GET /api/accounting/payment-terms-templates
export const paymentTermsTemplatesListSchema = paginatedSearchSchema.extend({
  active: z.string().optional().transform(v => v === 'true'),
})

const paymentTermsTemplateItemSchema = z.object({
  paymentTermId: uuidSchema,
  sortOrder: z.coerce.number().int().min(0).optional(),
})

// POST /api/accounting/payment-terms-templates
export const createPaymentTermsTemplateSchema = z.object({
  name: shortTextSchema,
  items: z.array(paymentTermsTemplateItemSchema).max(50).optional(),
})

// PUT /api/accounting/payment-terms-templates/[id]
export const updatePaymentTermsTemplateSchema = z.object({
  name: shortTextSchema.optional(),
  isActive: z.boolean().optional(),
  items: z.array(paymentTermsTemplateItemSchema).max(50).optional(),
})

// ==================== GL ENTRIES ====================

// GET /api/accounting/gl-entries
export const glEntriesListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
  accountId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  partyType: partyTypeSchema.optional(),
  partyId: z.string().uuid().optional(),
  voucherType: z.string().max(100).optional(),
  voucherId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
})

// ==================== ACCOUNTING SETTINGS ====================

// PUT /api/accounting/settings
export const updateAccountingSettingsSchema = z.object({
  defaultReceivableAccountId: optionalUuid,
  defaultPayableAccountId: optionalUuid,
  defaultIncomeAccountId: optionalUuid,
  defaultExpenseAccountId: optionalUuid,
  defaultCashAccountId: optionalUuid,
  defaultBankAccountId: optionalUuid,
  defaultTaxAccountId: optionalUuid,
  defaultCOGSAccountId: optionalUuid,
  defaultRoundOffAccountId: optionalUuid,
  defaultStockAccountId: optionalUuid,
  defaultWriteOffAccountId: optionalUuid,
  defaultAdvanceReceivedAccountId: optionalUuid,
  defaultAdvancePaidAccountId: optionalUuid,
  currentFiscalYearId: optionalUuid,
  autoPostSales: z.boolean().optional(),
  autoPostPurchases: z.boolean().optional(),
  defaultCostCenterId: optionalUuid,
  defaultStockAdjustmentAccountId: optionalUuid,
  defaultSalaryPayableAccountId: optionalUuid,
  defaultStatutoryPayableAccountId: optionalUuid,
  defaultSalaryExpenseAccountId: optionalUuid,
  defaultEmployerContributionAccountId: optionalUuid,
  defaultEmployeeAdvanceAccountId: optionalUuid,
  defaultWipAccountId: optionalUuid,
  defaultGiftCardLiabilityAccountId: optionalUuid,
  defaultCashOverShortAccountId: optionalUuid,
  defaultTaxTemplateId: optionalUuid,
  defaultPurchaseTaxTemplateId: optionalUuid,
})

// ==================== REPORTS ====================

// GET /api/accounting/reports/balance-sheet
export const balanceSheetQuerySchema = z.object({
  asOfDate: z.string().optional(),
  costCenterId: z.string().uuid().optional(),
  compareAsOfDate: z.string().optional(),
})

// GET /api/accounting/reports/profit-and-loss
export const profitAndLossQuerySchema = z.object({
  fromDate: z.string().min(1, 'fromDate is required'),
  toDate: z.string().min(1, 'toDate is required'),
  costCenterId: z.string().uuid().optional(),
  compareFromDate: z.string().optional(),
  compareToDate: z.string().optional(),
})

// GET /api/accounting/reports/trial-balance
export const trialBalanceQuerySchema = z.object({
  fromDate: z.string().min(1, 'fromDate is required'),
  toDate: z.string().min(1, 'toDate is required'),
  costCenterId: z.string().uuid().optional(),
})

// GET /api/accounting/reports/cash-flow
export const cashFlowQuerySchema = z.object({
  fromDate: z.string().min(1, 'fromDate is required'),
  toDate: z.string().min(1, 'toDate is required'),
})

// GET /api/accounting/reports/accounts-receivable, accounts-payable
export const agingReportQuerySchema = z.object({
  asOfDate: z.string().optional(),
})

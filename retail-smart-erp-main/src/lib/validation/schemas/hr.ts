import { z } from 'zod'
import {
  paginatedSearchSchema,
  paginationSchema,
  uuidSchema,
  optionalUuid,
  cancellationSchema,
  employmentTypeSchema,
  employmentStatusSchema,
  salaryComponentTypeSchema,
  payrollRunStatusSchema,
  salarySlipStatusSchema,
  employeeAdvanceStatusSchema,
} from './common'

// ==================== EMPLOYEE PROFILES ====================

// GET /api/employee-profiles
export const employeeProfilesListSchema = paginatedSearchSchema.extend({
  status: employmentStatusSchema.optional(),
})

// POST /api/employee-profiles
export const createEmployeeProfileSchema = z.object({
  userId: uuidSchema,
  employeeCode: z.string().trim().max(50).nullish(),
  employmentType: employmentTypeSchema.default('full_time'),
  employmentStatus: employmentStatusSchema.default('active'),
  department: z.string().trim().max(100).nullish(),
  designation: z.string().trim().max(100).nullish(),
  hireDate: z.string().nullish(),
  confirmationDate: z.string().nullish(),
  baseSalary: z.coerce.number().min(0).default(0),
  salaryFrequency: z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
  // Bank details
  bankName: z.string().trim().max(255).nullish(),
  bankBranch: z.string().trim().max(255).nullish(),
  bankAccountNumber: z.string().trim().max(100).nullish(),
  bankAccountName: z.string().trim().max(255).nullish(),
  bankRoutingNumber: z.string().trim().max(100).nullish(),
  // Tax / ID
  taxId: z.string().trim().max(100).nullish(),
  taxIdType: z.string().trim().max(50).nullish(),
  socialSecurityId: z.string().trim().max(100).nullish(),
  socialSecurityIdType: z.string().trim().max(50).nullish(),
  employerContributionId: z.string().trim().max(100).nullish(),
  employerContributionIdType: z.string().trim().max(50).nullish(),
  // Personal
  dateOfBirth: z.string().nullish(),
  gender: z.string().trim().max(20).nullish(),
  emergencyContactName: z.string().trim().max(255).nullish(),
  emergencyContactPhone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
})

// PUT /api/employee-profiles/[id]
export const updateEmployeeProfileSchema = z.object({
  employeeCode: z.string().trim().max(50).nullish(),
  employmentType: employmentTypeSchema.optional(),
  employmentStatus: employmentStatusSchema.optional(),
  department: z.string().trim().max(100).nullish(),
  designation: z.string().trim().max(100).nullish(),
  hireDate: z.string().nullish(),
  confirmationDate: z.string().nullish(),
  terminationDate: z.string().nullish(),
  baseSalary: z.coerce.number().min(0).optional(),
  salaryFrequency: z.enum(['monthly', 'biweekly', 'weekly']).optional(),
  bankName: z.string().trim().max(255).nullish(),
  bankBranch: z.string().trim().max(255).nullish(),
  bankAccountNumber: z.string().trim().max(100).nullish(),
  bankAccountName: z.string().trim().max(255).nullish(),
  bankRoutingNumber: z.string().trim().max(100).nullish(),
  taxId: z.string().trim().max(100).nullish(),
  taxIdType: z.string().trim().max(50).nullish(),
  socialSecurityId: z.string().trim().max(100).nullish(),
  socialSecurityIdType: z.string().trim().max(50).nullish(),
  employerContributionId: z.string().trim().max(100).nullish(),
  employerContributionIdType: z.string().trim().max(50).nullish(),
  dateOfBirth: z.string().nullish(),
  gender: z.string().trim().max(20).nullish(),
  emergencyContactName: z.string().trim().max(255).nullish(),
  emergencyContactPhone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  expectedUpdatedAt: z.string().optional(),
})

// ==================== SALARY COMPONENTS ====================

// GET /api/salary-components
export const salaryComponentsListSchema = paginatedSearchSchema.extend({
  type: salaryComponentTypeSchema.optional(),
  active: z.string().optional().transform(v => v === 'true'),
})

// POST /api/salary-components
export const createSalaryComponentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  abbreviation: z.string().trim().min(1, 'Abbreviation is required').max(50),
  componentType: salaryComponentTypeSchema,
  formulaExpression: z.string().trim().max(1000).nullish(),
  defaultAmount: z.coerce.number().min(0).nullish(),
  isStatutory: z.boolean().default(false),
  isFlexibleBenefit: z.boolean().default(false),
  dependsOnPaymentDays: z.boolean().default(true),
  doNotIncludeInTotal: z.boolean().default(false),
  isPayableByEmployer: z.boolean().default(false),
  expenseAccountId: optionalUuid,
  payableAccountId: optionalUuid,
  description: z.string().trim().max(1000).nullish(),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

// PUT /api/salary-components/[id]
export const updateSalaryComponentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  abbreviation: z.string().trim().min(1, 'Abbreviation is required').max(50),
  componentType: salaryComponentTypeSchema,
  formulaExpression: z.string().trim().max(1000).nullish(),
  defaultAmount: z.coerce.number().min(0).nullish(),
  isStatutory: z.boolean().default(false),
  isFlexibleBenefit: z.boolean().default(false),
  dependsOnPaymentDays: z.boolean().default(true),
  doNotIncludeInTotal: z.boolean().default(false),
  isPayableByEmployer: z.boolean().default(false),
  expenseAccountId: optionalUuid,
  payableAccountId: optionalUuid,
  description: z.string().trim().max(1000).nullish(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.string().optional(),
})

// ==================== SALARY STRUCTURES ====================

// GET /api/salary-structures
export const salaryStructuresListSchema = paginatedSearchSchema.extend({
  active: z.string().optional().transform(v => v === 'true'),
})

// Salary structure component entry
const salaryStructureComponentSchema = z.object({
  componentId: uuidSchema,
  overrideFormula: z.string().trim().max(1000).nullish(),
  overrideAmount: z.coerce.number().min(0).nullish(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

// POST /api/salary-structures
export const createSalaryStructureSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  description: z.string().trim().max(1000).nullish(),
  components: z.array(salaryStructureComponentSchema).max(100).optional(),
})

// PUT /api/salary-structures/[id]
export const updateSalaryStructureSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().optional(),
  components: z.array(salaryStructureComponentSchema).max(100).optional(),
  expectedUpdatedAt: z.string().optional(),
})

// ==================== PAYROLL RUNS ====================

// GET /api/payroll-runs
export const payrollRunsListSchema = paginationSchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: payrollRunStatusSchema.optional(),
})

// POST /api/payroll-runs
export const createPayrollRunSchema = z.object({
  payrollMonth: z.coerce.number().int().min(1, 'Month must be 1-12').max(12, 'Month must be 1-12'),
  payrollYear: z.coerce.number().int().min(2000).max(2100),
  totalWorkingDays: z.coerce.number().int().min(1).max(31).default(30),
  employmentTypes: z.array(employmentTypeSchema).max(50).nullish(),
  departments: z.array(z.string().trim().max(100)).max(100).nullish(),
})

// POST /api/payroll-runs/[id]/cancel
export const cancelPayrollRunSchema = cancellationSchema

// ==================== SALARY SLIPS ====================

// GET /api/salary-slips
export const salarySlipsListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: salarySlipStatusSchema.optional(),
  employeeProfileId: z.string().uuid().optional(),
  payrollRunId: z.string().uuid().optional(),
})

// POST /api/salary-slips
export const createSalarySlipSchema = z.object({
  employeeProfileId: uuidSchema,
  payrollMonth: z.coerce.number().int().min(1, 'Month must be 1-12').max(12, 'Month must be 1-12'),
  payrollYear: z.coerce.number().int().min(2000).max(2100),
  totalWorkingDays: z.coerce.number().int().min(1).max(31).default(30),
  paymentDays: z.coerce.number().int().min(0).max(31).default(30),
  commissionAmount: z.coerce.number().min(0).default(0),
})

// PUT /api/salary-slips/[id]
export const updateSalarySlipSchema = z.object({
  totalWorkingDays: z.coerce.number().int().min(1).max(31).optional(),
  paymentDays: z.coerce.number().int().min(0).max(31).optional(),
  paymentMethod: z.string().trim().max(50).optional(),
  paymentReference: z.string().trim().max(255).optional(),
})

// POST /api/salary-slips/[id]/cancel
export const cancelSalarySlipSchema = cancellationSchema

// ==================== EMPLOYEE ADVANCES ====================

// GET /api/employee-advances
export const employeeAdvancesListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  status: employeeAdvanceStatusSchema.optional(),
  employeeProfileId: z.string().uuid().optional(),
})

// POST /api/employee-advances
export const createEmployeeAdvanceSchema = z.object({
  employeeProfileId: uuidSchema,
  requestedAmount: z.coerce.number().positive('Requested amount must be greater than zero'),
  recoveryMethod: z.enum(['salary_deduction', 'direct_payment']).default('salary_deduction'),
  recoveryInstallments: z.coerce.number().int().min(1).default(1),
  purpose: z.string().trim().max(500).nullish(),
  reason: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
})

// PUT /api/employee-advances/[id]
export const updateEmployeeAdvanceSchema = z.object({
  requestedAmount: z.coerce.number().positive().optional(),
  recoveryMethod: z.enum(['salary_deduction', 'direct_payment']).optional(),
  recoveryInstallments: z.coerce.number().int().min(1).optional(),
  purpose: z.string().trim().max(500).nullish(),
  reason: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
})

// POST /api/employee-advances/[id]/approve
export const approveAdvanceSchema = z.object({
  approvedAmount: z.coerce.number().positive('Approved amount must be greater than zero').optional(),
  approvalNotes: z.string().trim().max(1000).nullish(),
})

// POST /api/employee-advances/[id]/disburse
export const disburseAdvanceSchema = z.object({
  disbursementMethod: z.enum(['cash', 'bank_transfer', 'cheque']).nullish(),
  disbursementReference: z.string().trim().max(255).nullish(),
})

// POST /api/employee-advances/[id]/cancel
export const cancelEmployeeAdvanceSchema = cancellationSchema

// ==================== MY (Self-service) ====================

// GET /api/my/advances
export const myAdvancesListSchema = paginationSchema

// POST /api/my/advances
export const createMyAdvanceSchema = z.object({
  requestedAmount: z.coerce.number().positive('Requested amount must be greater than zero'),
  recoveryMethod: z.enum(['salary_deduction', 'direct_payment']).default('salary_deduction'),
  recoveryInstallments: z.coerce.number().int().min(1).default(1),
  purpose: z.string().trim().max(500).nullish(),
  reason: z.string().trim().max(1000).nullish(),
})

// GET /api/my/commissions
export const myCommissionsListSchema = paginationSchema.extend({
  view: z.enum(['commissions', 'payouts']).default('commissions'),
})

// GET /api/my/salary-slips
export const mySalarySlipsListSchema = paginationSchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})

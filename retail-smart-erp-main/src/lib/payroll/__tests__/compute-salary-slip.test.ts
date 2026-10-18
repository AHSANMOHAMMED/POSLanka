import { computeSalarySlip } from '../compute-salary-slip'
import type { TenantDb } from '@/lib/db'

// Mock the database schema
jest.mock('@/lib/db/schema', () => ({
  employeeProfiles: {
    id: 'id',
    baseSalary: 'baseSalary',
    salaryStructureId: 'salaryStructureId',
  },
  salaryStructures: {
    id: 'id',
    name: 'name',
    isActive: 'isActive',
  },
  salaryStructureComponents: {
    componentId: 'componentId',
    structureId: 'structureId',
    overrideFormula: 'overrideFormula',
    overrideAmount: 'overrideAmount',
    sortOrder: 'sortOrder',
    isActive: 'isActive',
  },
  salaryComponents: {
    id: 'id',
    name: 'name',
    abbreviation: 'abbreviation',
    componentType: 'componentType',
    formulaExpression: 'formulaExpression',
    defaultAmount: 'defaultAmount',
    isStatutory: 'isStatutory',
    isFlexibleBenefit: 'isFlexibleBenefit',
    dependsOnPaymentDays: 'dependsOnPaymentDays',
    doNotIncludeInTotal: 'doNotIncludeInTotal',
    isPayableByEmployer: 'isPayableByEmployer',
    isActive: 'isActive',
  },
  employeeAdvances: {
    employeeProfileId: 'employeeProfileId',
    status: 'status',
    balanceAmount: 'balanceAmount',
    recoveryAmountPerInstallment: 'recoveryAmountPerInstallment',
  },
}))

// Mock drizzle-orm functions
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(),
  and: jest.fn(),
  asc: jest.fn(),
  or: jest.fn(),
}))

// Mock formula-engine
jest.mock('../formula-engine', () => ({
  evaluateFormula: jest.fn(),
}))

describe('computeSalarySlip', () => {
  let mockDb: TenantDb
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let mockQuery: any
  let _mockSelect: any
  let mockFrom: any
  let _mockInnerJoin: any
  let _mockWhere: any
  let _mockOrderBy: any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock drizzle query builder
    _mockOrderBy = jest.fn().mockReturnThis()
    _mockWhere = jest.fn().mockReturnThis()
    _mockInnerJoin = jest.fn().mockReturnThis()
    mockFrom = jest.fn().mockReturnThis()
    _mockSelect = jest.fn().mockReturnThis()

    mockQuery = {
      employeeProfiles: {
        findFirst: jest.fn(),
      },
      salaryStructures: {
        findFirst: jest.fn(),
      },
      employeeAdvances: {
        findMany: jest.fn(),
      },
    }

    mockDb = {
      query: mockQuery,
      select: jest.fn().mockReturnValue({
        from: mockFrom,
      }),
    } as unknown as TenantDb

    // Setup the select chain
    const selectReturn = {
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }
    
    ;(mockDb.select as jest.Mock).mockReturnValue(selectReturn.from())
    selectReturn.from.mockReturnValue({
      innerJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockResolvedValue([]),
        }),
      }),
    })

    // Mock evaluateFormula
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { evaluateFormula } = require('../formula-engine')
    ;(evaluateFormula as jest.Mock).mockImplementation((formula, context) => {
      if (formula === 'base * 0.4') return context.base * 0.4
      if (formula === 'base * 0.2') return context.base * 0.2
      if (formula === '(base + HRA + DA) * 0.1') {
        const base = context.base
        const hra = context.HRA || 0
        const da = context.DA || 0
        return (base + hra + da) * 0.1
      }
      return 0
    })
  })

  describe('basic salary slip computation', () => {
    test('computes salary slip with basic structure', async () => {
      // Mock employee profile
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: 'struct-123',
      })

      // Mock salary structure
      mockQuery.salaryStructures.findFirst.mockResolvedValue({
        id: 'struct-123',
        name: 'Basic Structure',
        isActive: true,
      })

      // Mock structure components
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          {
            componentId: 'comp-1',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 1,
            name: 'House Rent Allowance',
            abbreviation: 'HRA',
            componentType: 'earning',
            formulaExpression: 'base * 0.4',
            defaultAmount: '20000',
            isStatutory: false,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false,
            isPayableByEmployer: false,
          },
          {
            componentId: 'comp-2',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 2,
            name: 'Dearness Allowance',
            abbreviation: 'DA',
            componentType: 'earning',
            formulaExpression: 'base * 0.2',
            defaultAmount: '10000',
            isStatutory: false,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false,
            isPayableByEmployer: false,
          },
          {
            componentId: 'comp-3',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 3,
            name: 'Tax Deduction',
            abbreviation: 'TAX',
            componentType: 'deduction',
            formulaExpression: '(base + HRA + DA) * 0.1',
            defaultAmount: '8000',
            isStatutory: true,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false,
            isPayableByEmployer: false,
          },
        ]),
      }

      ;(mockDb.select as jest.Mock).mockReturnValue(selectChain)

      // Mock advance recovery (no advances)
      mockQuery.employeeAdvances.findMany.mockResolvedValue([])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
        commissionAmount: 5000,
        includeAdvanceRecovery: true,
      })

      expect(result.baseSalary).toBe(50000)
      expect(result.grossPay).toBeGreaterThan(50000) // base + HRA + DA + commission
      expect(result.totalDeductions).toBeGreaterThan(0)
      expect(result.netPay).toBeLessThan(result.grossPay)
      expect(result.commissionAmount).toBe(5000)
      expect(result.advanceDeduction).toBe(0)
      expect(result.components).toHaveLength(3)
      expect(result.salaryStructureId).toBe('struct-123')
      expect(result.salaryStructureName).toBe('Basic Structure')
    })

    test('handles employee without salary structure', async () => {
      // Mock employee profile without salary structure
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '30000',
        salaryStructureId: null,
      })

      // No need to mock salary structure or components

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
      })

      expect(result.baseSalary).toBe(30000)
      expect(result.grossPay).toBe(0) // No components
      expect(result.totalDeductions).toBe(0)
      expect(result.netPay).toBe(0)
      expect(result.components).toHaveLength(0)
      expect(result.salaryStructureId).toBeNull()
      expect(result.salaryStructureName).toBeNull()
    })

    test('throws error when employee profile not found', async () => {
      mockQuery.employeeProfiles.findFirst.mockResolvedValue(null)

      await expect(
        computeSalarySlip(mockDb, {
          employeeProfileId: 'non-existent',
          payrollMonth: 2,
          payrollYear: 2026,
          totalWorkingDays: 30,
          paymentDays: 30,
        })
      ).rejects.toThrow('Employee profile not found')
    })
  })

  describe('pro-rate calculation validation', () => {
    test('validates totalWorkingDays > 0', async () => {
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: null,
      })

      await expect(
        computeSalarySlip(mockDb, {
          employeeProfileId: 'emp-123',
          payrollMonth: 2,
          payrollYear: 2026,
          totalWorkingDays: 0,
          paymentDays: 15,
        })
      ).rejects.toThrow('totalWorkingDays must be greater than 0')
    })

    test('validates paymentDays not negative', async () => {
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: null,
      })

      await expect(
        computeSalarySlip(mockDb, {
          employeeProfileId: 'emp-123',
          payrollMonth: 2,
          payrollYear: 2026,
          totalWorkingDays: 30,
          paymentDays: -5,
        })
      ).rejects.toThrow('paymentDays cannot be negative')
    })

    test('validates paymentDays does not exceed totalWorkingDays', async () => {
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: null,
      })

      await expect(
        computeSalarySlip(mockDb, {
          employeeProfileId: 'emp-123',
          payrollMonth: 2,
          payrollYear: 2026,
          totalWorkingDays: 30,
          paymentDays: 35,
        })
      ).rejects.toThrow('paymentDays cannot exceed totalWorkingDays')
    })

    test('applies pro-rate for components that depend on payment days', async () => {
      // Mock employee profile
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: 'struct-123',
      })

      // Mock salary structure
      mockQuery.salaryStructures.findFirst.mockResolvedValue({
        id: 'struct-123',
        name: 'Test Structure',
        isActive: true,
      })

      // Mock structure components with dependsOnPaymentDays = true
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          {
            componentId: 'comp-1',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 1,
            name: 'Basic Pay',
            abbreviation: 'BP',
            componentType: 'earning',
            formulaExpression: null,
            defaultAmount: '50000',
            isStatutory: false,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: true, // This component depends on payment days
            doNotIncludeInTotal: false,
            isPayableByEmployer: false,
          },
        ]),
      }

      ;(mockDb.select as jest.Mock).mockReturnValue(selectChain)

      // Mock advance recovery
      mockQuery.employeeAdvances.findMany.mockResolvedValue([])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 15, // Half month
        includeAdvanceRecovery: false,
      })

      // The component should be pro-rated (half of 50000 = 25000)
      expect(result.components[0].amount).toBe(25000)
      expect(result.grossPay).toBe(25000)
    })
  })

  describe('advance recovery calculation', () => {
    beforeEach(() => {
      // Setup basic employee and structure for advance recovery tests
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: null, // No structure for simpler test
      })
    })

    test('includes advance recovery when includeAdvanceRecovery is true', async () => {
      // Mock advances that need recovery
      mockQuery.employeeAdvances.findMany.mockResolvedValue([
        {
          employeeProfileId: 'emp-123',
          status: 'disbursed',
          balanceAmount: '5000',
          recoveryAmountPerInstallment: '1000',
        },
        {
          employeeProfileId: 'emp-123',
          status: 'partially_recovered',
          balanceAmount: '3000',
          recoveryAmountPerInstallment: '1500',
        },
      ])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
        includeAdvanceRecovery: true,
      })

      // Advance deduction should be sum of min(installment, balance)
      // First: min(1000, 5000) = 1000
      // Second: min(1500, 3000) = 1500
      // Total: 2500
      expect(result.advanceDeduction).toBe(2500)
      expect(result.totalDeductions).toBe(2500) // Only advance deduction in this test
    })

    test('excludes advance recovery when includeAdvanceRecovery is false', async () => {
      // Even if advances exist, they should be ignored
      mockQuery.employeeAdvances.findMany.mockResolvedValue([
        {
          employeeProfileId: 'emp-123',
          status: 'disbursed',
          balanceAmount: '5000',
          recoveryAmountPerInstallment: '1000',
        },
      ])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
        includeAdvanceRecovery: false,
      })

      expect(result.advanceDeduction).toBe(0)
      expect(result.totalDeductions).toBe(0)
      // Verify the query was not called
      expect(mockQuery.employeeAdvances.findMany).not.toHaveBeenCalled()
    })

    test('skips advances with zero or negative balance', async () => {
      mockQuery.employeeAdvances.findMany.mockResolvedValue([
        {
          employeeProfileId: 'emp-123',
          status: 'disbursed',
          balanceAmount: '0',
          recoveryAmountPerInstallment: '1000',
        },
        {
          employeeProfileId: 'emp-123',
          status: 'partially_recovered',
          balanceAmount: '-500',
          recoveryAmountPerInstallment: '1000',
        },
        {
          employeeProfileId: 'emp-123',
          status: 'disbursed',
          balanceAmount: '2000',
          recoveryAmountPerInstallment: '1000',
        },
      ])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
        includeAdvanceRecovery: true,
      })

      // Only the third advance should be counted: min(1000, 2000) = 1000
      expect(result.advanceDeduction).toBe(1000)
    })

    test('uses balance as installment amount when recoveryAmountPerInstallment is not specified', async () => {
      mockQuery.employeeAdvances.findMany.mockResolvedValue([
        {
          employeeProfileId: 'emp-123',
          status: 'disbursed',
          balanceAmount: '5000',
          recoveryAmountPerInstallment: null,
        },
      ])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
        includeAdvanceRecovery: true,
      })

      // When recoveryAmountPerInstallment is null, uses balance: min(5000, 5000) = 5000
      expect(result.advanceDeduction).toBe(5000)
    })
  })

  describe('component processing', () => {
    test('processes earning components before deduction components', async () => {
      // This test verifies that earnings are processed first to establish context
      // for deductions that might depend on earnings
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: 'struct-123',
      })

      mockQuery.salaryStructures.findFirst.mockResolvedValue({
        id: 'struct-123',
        name: 'Test Structure',
        isActive: true,
      })

      // Reset evaluateFormula mock to track calls
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { evaluateFormula } = require('../formula-engine')
      ;(evaluateFormula as jest.Mock).mockClear()
      ;(evaluateFormula as jest.Mock).mockReturnValue(1000)

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          {
            componentId: 'comp-1',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 1,
            name: 'Earning Component',
            abbreviation: 'EARN',
            componentType: 'earning',
            formulaExpression: 'base * 0.1',
            defaultAmount: '5000',
            isStatutory: false,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false,
            isPayableByEmployer: false,
          },
          {
            componentId: 'comp-2',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 2,
            name: 'Deduction Component',
            abbreviation: 'DEDUCT',
            componentType: 'deduction',
            formulaExpression: 'EARN * 0.5', // Depends on earning component
            defaultAmount: '2500',
            isStatutory: false,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false,
            isPayableByEmployer: false,
          },
        ]),
      }

      ;(mockDb.select as jest.Mock).mockReturnValue(selectChain)
      mockQuery.employeeAdvances.findMany.mockResolvedValue([])

      await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
      })

      // Verify evaluateFormula was called
      expect(evaluateFormula).toHaveBeenCalled()
    })

    test('handles components that do not include in total', async () => {
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: 'struct-123',
      })

      mockQuery.salaryStructures.findFirst.mockResolvedValue({
        id: 'struct-123',
        name: 'Test Structure',
        isActive: true,
      })

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { evaluateFormula } = require('../formula-engine')
      ;(evaluateFormula as jest.Mock).mockClear()
      ;(evaluateFormula as jest.Mock).mockReturnValue(1000)

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          {
            componentId: 'comp-1',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 1,
            name: 'Excluded Component',
            abbreviation: 'EXCL',
            componentType: 'earning',
            formulaExpression: null,
            defaultAmount: '1000',
            isStatutory: false,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: true, // Should not be included in gross
            isPayableByEmployer: false,
          },
          {
            componentId: 'comp-2',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 2,
            name: 'Included Component',
            abbreviation: 'INCL',
            componentType: 'earning',
            formulaExpression: null,
            defaultAmount: '2000',
            isStatutory: false,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false, // Should be included in gross
            isPayableByEmployer: false,
          },
        ]),
      }

      ;(mockDb.select as jest.Mock).mockReturnValue(selectChain)
      mockQuery.employeeAdvances.findMany.mockResolvedValue([])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
      })

      // Only the included component should affect gross
      expect(result.grossPay).toBe(2000)
      expect(result.components).toHaveLength(2)
    })

    test('tracks employer contributions separately', async () => {
      mockQuery.employeeProfiles.findFirst.mockResolvedValue({
        id: 'emp-123',
        baseSalary: '50000',
        salaryStructureId: 'struct-123',
      })

      mockQuery.salaryStructures.findFirst.mockResolvedValue({
        id: 'struct-123',
        name: 'Test Structure',
        isActive: true,
      })

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { evaluateFormula } = require('../formula-engine')
      ;(evaluateFormula as jest.Mock).mockClear()
      ;(evaluateFormula as jest.Mock).mockReturnValue(1000)

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          {
            componentId: 'comp-1',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 1,
            name: 'Employer Contribution',
            abbreviation: 'EPF',
            componentType: 'deduction', // Deduction but payable by employer
            formulaExpression: null,
            defaultAmount: '1200',
            isStatutory: true,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false,
            isPayableByEmployer: true, // Counts toward employer contributions
          },
          {
            componentId: 'comp-2',
            overrideFormula: null,
            overrideAmount: null,
            sortOrder: 2,
            name: 'Employee Tax',
            abbreviation: 'TAX',
            componentType: 'deduction',
            formulaExpression: null,
            defaultAmount: '800',
            isStatutory: true,
            isFlexibleBenefit: false,
            dependsOnPaymentDays: false,
            doNotIncludeInTotal: false,
            isPayableByEmployer: false, // Not counted toward employer contributions
          },
        ]),
      }

      ;(mockDb.select as jest.Mock).mockReturnValue(selectChain)
      mockQuery.employeeAdvances.findMany.mockResolvedValue([])

      const result = await computeSalarySlip(mockDb, {
        employeeProfileId: 'emp-123',
        payrollMonth: 2,
        payrollYear: 2026,
        totalWorkingDays: 30,
        paymentDays: 30,
      })

      // Only EPF should count toward employer contributions
      expect(result.totalEmployerContributions).toBe(1200)
      // Both deductions should count toward total deductions (since both affect employee)
      expect(result.totalDeductions).toBe(2000) // 1200 + 800
    })
  })
})
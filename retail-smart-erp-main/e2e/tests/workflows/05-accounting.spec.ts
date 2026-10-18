import { test, expect, APIRequestContext, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  loadState,
  updateCompanyState,
  loginToCompany,
  CompanyState,
  getGLEntries,
  assertGLBalance,
  today,
  num,
} from './helpers'

// Run accounting tests for a subset of business types (they share the same engine)
const ACCOUNTING_TYPES: BusinessType[] = ['retail', 'auto_service']

test.describe('Workflow — Accounting: Journal Entries & Reports', () => {
  test.setTimeout(240_000)

  ACCOUNTING_TYPES.forEach((type) => {
    test.describe.serial(`Accounting ${type}`, () => {
      let request: APIRequestContext
      let ctx: BrowserContext
      let company: CompanyState

      test.beforeAll(async ({ browser }) => {
        const state = loadState()
        company = state.companies[type]!
        if (!company?.slug) return
        ctx = await browser.newContext()
        const page = await ctx.newPage()
        await loginToCompany(page.request, company.email, company.password, company.slug)
        request = page.request
      })

      test.afterAll(async () => {
        if (ctx) await ctx.close()
      })

      // ════════════════════════════════════════
      // Journal Entry: Standard
      // ════════════════════════════════════════

      let je1Id: string
      let je1Number: string

      test(`ACC-${type}-001: Create standard journal entry (Dr Expense, Cr Cash)`, async () => {
        test.skip(!request, `${type} not set up`)

        const expenseAccountId = company.accounts.expense
        const cashAccountId = company.accounts.cash
        test.skip(!expenseAccountId || !cashAccountId, 'Missing account IDs')

        const res = await request.post('/api/accounting/journal-entries', {
          data: {
            entryType: 'journal',
            postingDate: today(),
            remarks: `E2E standard journal entry for ${type} — office supplies purchase for main branch, receipt #R-${Date.now()}`,
            items: [
              {
                accountId: expenseAccountId!,
                debit: 5000,
                credit: 0,
                costCenterId: company.costCenterOps,
                remarks: 'Office supplies — paper, pens, printer cartridges',
              },
              {
                accountId: cashAccountId!,
                debit: 0,
                credit: 5000,
                costCenterId: company.costCenterOps,
                remarks: 'Cash payment from petty cash fund',
              },
            ],
          },
        })
        expect(res.ok(), `Create JE failed: ${await res.text()}`).toBeTruthy()
        const je = await res.json()
        je1Id = je.id
        je1Number = je.entryNumber
        expect(je.status).toBe('draft')
        expect(je.entryNumber).toMatch(/^JE-/)
      })

      test(`ACC-${type}-002: Submit journal entry`, async () => {
        test.skip(!request || !je1Id, `${type} not set up`)

        const res = await request.post(`/api/accounting/journal-entries/${je1Id}/submit`)
        expect(res.ok(), `Submit JE failed: ${await res.text()}`).toBeTruthy()
        const je = await res.json()
        expect(je.status).toBe('submitted')
      })

      test(`ACC-${type}-003: Verify GL entries from submitted JE`, async () => {
        test.skip(!request || !je1Id, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: je1Id })
        expect(entries.length).toBeGreaterThanOrEqual(2)
        const { totalDebit, totalCredit } = assertGLBalance(entries)
        expect(totalDebit).toBe(5000)
        expect(totalCredit).toBe(5000)

        company.journalEntries = company.journalEntries || []
        company.journalEntries.push({ id: je1Id, entryNumber: je1Number })
        updateCompanyState(type, { journalEntries: company.journalEntries })
      })

      // ════════════════════════════════════════
      // Journal Entry: With Cost Center
      // ════════════════════════════════════════

      let je2Id: string

      test(`ACC-${type}-004: Create JE with cost center allocation`, async () => {
        test.skip(!request, `${type} not set up`)

        const expenseId = company.accounts.expense
        const cashId = company.accounts.cash
        test.skip(!expenseId || !cashId, 'Missing account IDs')

        const res = await request.post('/api/accounting/journal-entries', {
          data: {
            entryType: 'journal',
            postingDate: today(),
            remarks: 'JE with cost center allocation — operations department utility payment for the month',
            items: [
              {
                accountId: expenseId!,
                debit: 3000,
                credit: 0,
                costCenterId: company.costCenterOps,
                remarks: 'Operations department — electricity and water bill',
              },
              {
                accountId: cashId!,
                debit: 0,
                credit: 3000,
                costCenterId: company.costCenterOps,
                remarks: 'Cash payment for utility bill',
              },
            ],
          },
        })
        expect(res.ok(), `JE with CC failed: ${await res.text()}`).toBeTruthy()
        je2Id = (await res.json()).id

        // Submit
        const subRes = await request.post(`/api/accounting/journal-entries/${je2Id}/submit`)
        expect(subRes.ok()).toBeTruthy()
      })

      test(`ACC-${type}-005: Verify GL entries with cost center`, async () => {
        test.skip(!request || !je2Id, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: je2Id })
        expect(entries.length).toBeGreaterThanOrEqual(2)
        assertGLBalance(entries)
        // At least one entry should have a cost center
        const withCC = entries.filter((e) => e.costCenterId)
        expect(withCC.length).toBeGreaterThan(0)
      })

      // ════════════════════════════════════════
      // Journal Entry: Validation (unbalanced should fail)
      // ════════════════════════════════════════

      test(`ACC-${type}-006: Reject unbalanced journal entry`, async () => {
        test.skip(!request, `${type} not set up`)

        const expenseId = company.accounts.expense
        const cashId = company.accounts.cash
        test.skip(!expenseId || !cashId, 'Missing account IDs')

        const res = await request.post('/api/accounting/journal-entries', {
          data: {
            entryType: 'journal',
            postingDate: today(),
            remarks: 'This should fail — intentionally unbalanced entry for validation testing',
            items: [
              { accountId: expenseId!, debit: 5000, credit: 0, remarks: 'Debit side' },
              { accountId: cashId!, debit: 0, credit: 3000, remarks: 'Credit side — intentionally short' },
            ],
          },
        })
        // Should return 400 for unbalanced entries
        expect(res.status()).toBe(400)
      })

      // ════════════════════════════════════════
      // Journal Entry: Cancel
      // ════════════════════════════════════════

      let je3Id: string

      test(`ACC-${type}-007: Create and submit JE for cancellation`, async () => {
        test.skip(!request, `${type} not set up`)

        const expenseId = company.accounts.expense
        const cashId = company.accounts.cash
        test.skip(!expenseId || !cashId, 'Missing account IDs')

        const createRes = await request.post('/api/accounting/journal-entries', {
          data: {
            entryType: 'journal',
            postingDate: today(),
            remarks: 'JE to be cancelled — entered in error, wrong amount for equipment repair',
            items: [
              {
                accountId: expenseId!,
                debit: 2000,
                credit: 0,
                costCenterId: company.costCenterSales,
                remarks: 'Equipment repair — wrong amount entered',
              },
              {
                accountId: cashId!,
                debit: 0,
                credit: 2000,
                costCenterId: company.costCenterSales,
                remarks: 'Cash payment — to be reversed',
              },
            ],
          },
        })
        expect(createRes.ok()).toBeTruthy()
        je3Id = (await createRes.json()).id

        const subRes = await request.post(`/api/accounting/journal-entries/${je3Id}/submit`)
        expect(subRes.ok()).toBeTruthy()
      })

      test(`ACC-${type}-008: Cancel submitted journal entry`, async () => {
        test.skip(!request || !je3Id, `${type} not set up`)

        const res = await request.post(`/api/accounting/journal-entries/${je3Id}/cancel`, {
          data: { cancellationReason: 'E2E test — entry made in error, incorrect amount for equipment repair expense' },
        })
        expect(res.ok(), `Cancel JE failed: ${await res.text()}`).toBeTruthy()
        const je = await res.json()
        expect(je.status).toBe('cancelled')
      })

      // ════════════════════════════════════════
      // Reports: Trial Balance
      // ════════════════════════════════════════

      test(`ACC-${type}-009: Check Trial Balance`, async () => {
        test.skip(!request, `${type} not set up`)

        const fromDate = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
        const toDate = today()

        const res = await request.get(
          `/api/accounting/reports/trial-balance?fromDate=${fromDate}&toDate=${toDate}`
        )
        expect(res.ok(), `Trial balance failed: ${await res.text()}`).toBeTruthy()
        const report = await res.json()

        expect(report.rows).toBeTruthy()
        expect(report.totals).toBeTruthy()

        if (report.totals) {
          const diff = Math.abs(
            num(report.totals.closingDebit) - num(report.totals.closingCredit)
          )
          expect(diff).toBeLessThan(1)
        }
      })

      // ════════════════════════════════════════
      // Reports: Profit & Loss
      // ════════════════════════════════════════

      test(`ACC-${type}-010: Check Profit & Loss`, async () => {
        test.skip(!request, `${type} not set up`)

        const fromDate = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
        const toDate = today()

        const res = await request.get(
          `/api/accounting/reports/profit-and-loss?fromDate=${fromDate}&toDate=${toDate}`
        )
        expect(res.ok(), `P&L failed: ${await res.text()}`).toBeTruthy()
        const report = await res.json()

        expect(report.income || report.totalIncome !== undefined).toBeTruthy()
        expect(report.expenses || report.totalExpenses !== undefined).toBeTruthy()
      })

      // ════════════════════════════════════════
      // Reports: Balance Sheet
      // ════════════════════════════════════════

      test(`ACC-${type}-011: Check Balance Sheet`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.get(
          `/api/accounting/reports/balance-sheet?asOfDate=${today()}`
        )
        expect(res.ok(), `Balance sheet failed: ${await res.text()}`).toBeTruthy()
        const report = await res.json()

        expect(report.assets || report.totalAssets !== undefined).toBeTruthy()
        expect(report.liabilities || report.totalLiabilities !== undefined).toBeTruthy()
      })

      // ════════════════════════════════════════
      // GL Entries: Filtered queries
      // ════════════════════════════════════════

      test(`ACC-${type}-012: Query GL entries filtered by account`, async () => {
        test.skip(!request, `${type} not set up`)

        if (company.accounts.cash) {
          const entries = await getGLEntries(request, { accountId: company.accounts.cash })
          expect(entries.length).toBeGreaterThan(0)
          for (const e of entries) {
            expect(e.accountId).toBe(company.accounts.cash)
          }
        }
      })
    })
  })
})

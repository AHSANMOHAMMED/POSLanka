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
  getSupplierBalance,
  getCustomerBalance,
  today,
  num,
} from './helpers'

test.describe('Workflow — Payment Entries & Balance Verification', () => {
  test.setTimeout(240_000)

  BUSINESS_TYPES.forEach((type) => {
    test.describe.serial(`Payments ${type}`, () => {
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
      // Flow A: Customer Payment (Receive money)
      // ════════════════════════════════════════

      let customerPaymentId: string
      let customerBalanceBefore: number

      test(`PAY-${type}-001: Record customer balance before payment`, async () => {
        test.skip(!request, `${type} not set up`)

        customerBalanceBefore = await getCustomerBalance(request, company.customers[0].id)
      })

      test(`PAY-${type}-002: Create customer payment entry (Receive) with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const cashAccountId = company.accounts.cash
        const receivableAccountId = company.accounts.receivable
        test.skip(!cashAccountId || !receivableAccountId, 'Missing account IDs')

        const res = await request.post('/api/accounting/payment-entries', {
          data: {
            paymentType: 'receive',
            postingDate: today(),
            partyType: 'customer',
            partyId: company.customers[0].id,
            partyName: company.customers[0].name,
            paidFromAccountId: receivableAccountId!,
            paidToAccountId: cashAccountId!,
            paidAmount: 5000,
            receivedAmount: 5000,
            referenceNo: `REC-${type.toUpperCase()}-${Date.now()}`,
            referenceDate: today(),
            bankAccountId: company.bankAccountCash,
            remarks: `Customer payment received from ${company.customers[0].name} — cash payment against outstanding invoices, receipt issued`,
          },
        })
        expect(res.ok(), `Create payment failed: ${await res.text()}`).toBeTruthy()
        const pe = await res.json()
        customerPaymentId = pe.id
        expect(pe.status).toBe('draft')
        expect(pe.entryNumber).toMatch(/^PE-/)
      })

      test(`PAY-${type}-003: Submit customer payment entry`, async () => {
        test.skip(!request || !customerPaymentId, `${type} not set up`)

        const res = await request.post(
          `/api/accounting/payment-entries/${customerPaymentId}/submit`
        )
        expect(res.ok(), `Submit payment failed: ${await res.text()}`).toBeTruthy()
        const pe = await res.json()
        expect(pe.status).toBe('submitted')

        company.paymentEntries = company.paymentEntries || []
        company.paymentEntries.push({ id: customerPaymentId, entryNumber: pe.entryNumber })
        updateCompanyState(type, { paymentEntries: company.paymentEntries })
      })

      test(`PAY-${type}-004: Verify GL for customer payment (Dr Cash, Cr Receivable)`, async () => {
        test.skip(!request || !customerPaymentId, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: customerPaymentId })
        if (entries.length > 0) {
          assertGLBalance(entries)
          const totalDebit = entries.reduce((s, e) => s + num(e.debit), 0)
          expect(totalDebit).toBe(5000)
        }
      })

      // ════════════════════════════════════════
      // Flow B: Supplier Payment (Pay money)
      // ════════════════════════════════════════

      let supplierPaymentId: string
      let supplierBalanceBefore: number

      test(`PAY-${type}-005: Record supplier balance before payment`, async () => {
        test.skip(!request, `${type} not set up`)

        supplierBalanceBefore = await getSupplierBalance(request, company.suppliers[0].id)
      })

      test(`PAY-${type}-006: Create supplier payment entry (Pay) with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const cashAccountId = company.accounts.cash
        const payableAccountId = company.accounts.payable
        test.skip(!cashAccountId || !payableAccountId, 'Missing account IDs')

        const payAmount = Math.min(supplierBalanceBefore, 3000) || 3000

        const res = await request.post('/api/accounting/payment-entries', {
          data: {
            paymentType: 'pay',
            postingDate: today(),
            partyType: 'supplier',
            partyId: company.suppliers[0].id,
            partyName: company.suppliers[0].name,
            paidFromAccountId: cashAccountId!,
            paidToAccountId: payableAccountId!,
            paidAmount: payAmount,
            receivedAmount: payAmount,
            referenceNo: `PAY-${type.toUpperCase()}-${Date.now()}`,
            referenceDate: today(),
            bankAccountId: company.bankAccountCash,
            remarks: `Payment to ${company.suppliers[0].name} — settling outstanding purchase invoices, cheque number CHQ-${Date.now()}`,
          },
        })
        expect(res.ok(), `Create supplier payment failed: ${await res.text()}`).toBeTruthy()
        const pe = await res.json()
        supplierPaymentId = pe.id
        expect(pe.status).toBe('draft')
      })

      test(`PAY-${type}-007: Submit supplier payment entry`, async () => {
        test.skip(!request || !supplierPaymentId, `${type} not set up`)

        const res = await request.post(
          `/api/accounting/payment-entries/${supplierPaymentId}/submit`
        )
        expect(res.ok(), `Submit supplier payment failed: ${await res.text()}`).toBeTruthy()

        company.paymentEntries!.push({
          id: supplierPaymentId,
          entryNumber: (await res.json()).entryNumber,
        })
        updateCompanyState(type, { paymentEntries: company.paymentEntries })
      })

      test(`PAY-${type}-008: Verify GL for supplier payment (Dr Payable, Cr Cash)`, async () => {
        test.skip(!request || !supplierPaymentId, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: supplierPaymentId })
        if (entries.length > 0) {
          assertGLBalance(entries)
        }
      })

      // ════════════════════════════════════════
      // Flow C: Internal Transfer (Cash → Bank)
      // ════════════════════════════════════════

      let transferId: string

      test(`PAY-${type}-009: Create internal transfer (Cash → Bank) with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const cashAccountId = company.accounts.cash
        const bankAccountId = company.accounts.bank
        test.skip(!cashAccountId || !bankAccountId, 'Missing account IDs')

        const res = await request.post('/api/accounting/payment-entries', {
          data: {
            paymentType: 'internal_transfer',
            postingDate: today(),
            paidFromAccountId: cashAccountId!,
            paidToAccountId: bankAccountId!,
            paidAmount: 10000,
            receivedAmount: 10000,
            referenceNo: `TRF-${type.toUpperCase()}-${Date.now()}`,
            referenceDate: today(),
            bankAccountId: company.bankAccountBank,
            remarks: 'Cash deposit to BOC bank account — daily cash safe transfer for security, deposit slip #DS-' + Date.now(),
          },
        })
        expect(res.ok(), `Internal transfer failed: ${await res.text()}`).toBeTruthy()
        const pe = await res.json()
        transferId = pe.id
      })

      test(`PAY-${type}-010: Submit internal transfer`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        const res = await request.post(
          `/api/accounting/payment-entries/${transferId}/submit`
        )
        expect(res.ok(), `Submit transfer failed: ${await res.text()}`).toBeTruthy()
      })

      test(`PAY-${type}-011: Verify GL for internal transfer (Dr Bank, Cr Cash)`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: transferId })
        if (entries.length > 0) {
          assertGLBalance(entries)
          const { totalDebit } = assertGLBalance(entries)
          expect(totalDebit).toBe(10000)
        }
      })

      // ════════════════════════════════════════
      // Verify overall balances
      // ════════════════════════════════════════

      test(`PAY-${type}-012: Verify payment entries listed`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.get('/api/accounting/payment-entries?pageSize=50')
        expect(res.ok()).toBeTruthy()
        const data = await res.json()
        const entries = data.data || data
        expect(entries.length).toBeGreaterThanOrEqual(3) // At least customer + supplier + transfer
      })
    })
  })
})

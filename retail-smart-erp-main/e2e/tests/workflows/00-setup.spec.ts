import { test, expect, APIRequestContext, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  TestState,
  CompanyState,
  saveState,
  loadState,
  loginToAccount,
  loginToCompany,
  getTestConfig,
} from './helpers'

// Fresh state for this run
const state: TestState = { companies: {} }

test.describe('Workflow Setup — Register & Configure All Business Types', () => {
  test.setTimeout(300_000)

  BUSINESS_TYPES.forEach((type, index) => {
    test.describe.serial(`Setup ${type}`, () => {
      let request: APIRequestContext
      let ctx: BrowserContext
      const config = getTestConfig(type, index)

      // Partial company state built up across tests
      const company: Partial<CompanyState> = {
        email: config.email,
        password: config.password,
        businessType: type,
        categories: [],
        items: [],
        customers: [],
        suppliers: [],
        purchaseOrders: [],
        purchases: [],
        sales: [],
        salesOrders: [],
      }

      test.beforeAll(async ({ browser }) => {
        ctx = await browser.newContext()
        const page = await ctx.newPage()
        request = page.request
      })

      test.afterAll(async () => {
        if (ctx) await ctx.close()
      })

      // ── Step 1: Register ──────────────────────
      test(`Register ${type} account`, async () => {
        const res = await request.post('/api/register', {
          data: {
            fullName: config.fullName,
            email: config.email,
            password: config.password,
            country: 'LK',
            phone: config.phone,
            tosAcceptedAt: new Date().toISOString(),
          },
        })
        if (res.ok()) {
          const data = await res.json()
          expect(data.accountId).toBeTruthy()
          company.accountId = data.accountId
        } else {
          // Rate-limited or email exists — try using existing state from previous run
          const existingState = loadState()
          const existingCompany = existingState.companies[type]
          if (existingCompany?.slug && existingCompany?.email) {
            // Reuse existing state
            Object.assign(company, existingCompany)
            Object.assign(config, { email: existingCompany.email, password: existingCompany.password, slug: existingCompany.slug })
            console.log(`Reusing existing ${type} company: ${existingCompany.slug}`)
          } else {
            expect(res.ok(), `Register failed and no existing state: ${await res.text()}`).toBeTruthy()
          }
        }
      })

      // ── Step 2: Login to account & create company ──
      test(`Create ${type} company`, async () => {
        // If we already have a slug from existing state, skip creation
        if (company.slug) {
          console.log(`Skipping company creation — using existing: ${company.slug}`)
          return
        }

        await loginToAccount(request, config.email, config.password)

        const res = await request.post('/api/account/companies', {
          data: {
            name: config.companyName,
            slug: config.slug,
            businessType: type,
            country: 'LK',
            dateFormat: 'DD/MM/YYYY',
            timeFormat: 'HH:mm',
          },
        })
        expect(res.ok(), `Create company failed: ${await res.text()}`).toBeTruthy()
        const data = await res.json()
        company.tenantId = data.id
        company.slug = data.slug || config.slug
      })

      // ── Step 3: Login to company ──────────────
      test(`Login to ${type} company`, async () => {
        await loginToCompany(request, config.email, config.password, company.slug!)

        // Verify we're authenticated by calling a protected endpoint
        const res = await request.get('/api/warehouses?all=true')
        expect(res.ok()).toBeTruthy()
      })

      // ── Step 4: Setup Chart of Accounts ───────
      test(`Setup ${type} chart of accounts`, async () => {
        const res = await request.post('/api/accounting/setup')
        expect(res.ok(), `COA setup failed: ${await res.text()}`).toBeTruthy()
        const data = await res.json()
        // Accept both fresh setup and already-setup responses
        const validMessages = ['successfully', 'already set up']
        expect(
          validMessages.some((m) => data.message?.includes(m)),
          `Unexpected COA message: ${data.message}`
        ).toBeTruthy()
      })

      // ── Step 5: Extract default account IDs ───
      test(`Extract ${type} account IDs from settings`, async () => {
        const res = await request.get('/api/accounting/settings')
        expect(res.ok()).toBeTruthy()
        const settings = await res.json()

        company.accounts = {
          cash: settings.defaultCashAccountId || undefined,
          bank: settings.defaultBankAccountId || undefined,
          receivable: settings.defaultReceivableAccountId || undefined,
          payable: settings.defaultPayableAccountId || undefined,
          revenue: settings.defaultIncomeAccountId || undefined,
          cogs: settings.defaultCOGSAccountId || undefined,
          inventory: settings.defaultStockAccountId || undefined,
          tax: settings.defaultTaxAccountId || undefined,
          expense: settings.defaultExpenseAccountId || undefined,
        }
        // At minimum cash and revenue should exist
        expect(company.accounts.cash || company.accounts.revenue).toBeTruthy()
      })

      // ── Step 6: Create Warehouses ─────────────
      test(`Create ${type} warehouses`, async () => {
        if (company.warehouseA && company.warehouseB) return // Already set from previous run

        const res1 = await request.post('/api/warehouses', {
          data: {
            name: 'Main Warehouse',
            code: 'WH-MAIN',
            address: '123 Main Street, Colombo 07, Western Province, Sri Lanka',
            phone: '+94111111111',
            email: `main@${config.slug}.test`,
            isDefault: true,
          },
        })
        if (res1.ok()) {
          company.warehouseA = (await res1.json()).id
        } else {
          // Already exists — find it
          const list = await request.get('/api/warehouses?all=true')
          const warehouses = await list.json()
          const all = Array.isArray(warehouses) ? warehouses : warehouses.data || []
          const main = all.find((w: { code: string }) => w.code === 'WH-MAIN')
          expect(main, 'Main warehouse not found').toBeTruthy()
          company.warehouseA = main.id
        }

        const res2 = await request.post('/api/warehouses', {
          data: {
            name: 'Branch Warehouse',
            code: 'WH-BRANCH',
            address: '456 Branch Road, Kandy, Central Province, Sri Lanka',
            phone: '+94222222222',
            email: `branch@${config.slug}.test`,
          },
        })
        if (res2.ok()) {
          company.warehouseB = (await res2.json()).id
        } else {
          const list = await request.get('/api/warehouses?all=true')
          const warehouses = await list.json()
          const all = Array.isArray(warehouses) ? warehouses : warehouses.data || []
          const branch = all.find((w: { code: string }) => w.code === 'WH-BRANCH')
          expect(branch, 'Branch warehouse not found').toBeTruthy()
          company.warehouseB = branch.id
        }
      })

      // ── Step 7: Create Cost Centers ───────────
      test(`Create ${type} cost centers`, async () => {
        if (company.costCenterOps && company.costCenterSales) return

        const createOrFind = async (name: string) => {
          const res = await request.post('/api/accounting/cost-centers', {
            data: { name, isGroup: false },
          })
          if (res.ok()) return (await res.json()).id
          // Already exists — find it
          const list = await request.get('/api/accounting/cost-centers?all=true')
          const data = await list.json()
          const all = Array.isArray(data) ? data : data.data || []
          const found = all.find((c: { name: string }) => c.name === name)
          expect(found, `Cost center "${name}" not found`).toBeTruthy()
          return found.id
        }

        company.costCenterOps = await createOrFind('Operations')
        company.costCenterSales = await createOrFind('Sales')
      })

      // ── Step 8: Create Bank Accounts ──────────
      test(`Create ${type} bank accounts`, async () => {
        if (company.bankAccountCash && company.bankAccountBank) return

        const createOrFind = async (accountName: string, extra: Record<string, unknown>) => {
          const res = await request.post('/api/accounting/bank-accounts', {
            data: { accountName, ...extra },
          })
          if (res.ok()) return (await res.json()).id
          // Already exists — find it
          const list = await request.get('/api/accounting/bank-accounts?all=true')
          const data = await list.json()
          const all = Array.isArray(data) ? data : data.data || []
          const found = all.find((b: { accountName: string }) => b.accountName === accountName)
          expect(found, `Bank account "${accountName}" not found`).toBeTruthy()
          return found.id
        }

        company.bankAccountCash = await createOrFind('Cash on Hand', {
          bankName: 'Cash',
          accountId: company.accounts?.cash || undefined,
          isDefault: true,
        })
        company.bankAccountBank = await createOrFind('BOC Business Account', {
          bankName: 'Bank of Ceylon',
          accountNumber: '8012345678',
          branchCode: 'BOC-001',
          iban: 'LK89BOC00012345678901',
          swiftCode: 'BABORLKX',
          accountId: company.accounts?.bank || undefined,
        })
      })

      // ── Step 9: Create POS Profile ────────────
      test(`Create ${type} POS profile`, async () => {
        if (company.posProfileId) return

        const res = await request.post('/api/pos-profiles', {
          data: {
            name: 'Default Register',
            code: 'REG-001',
            warehouseId: company.warehouseA,
            costCenterId: company.costCenterSales,
            isDefault: true,
            taxRate: 0,
            taxInclusive: false,
            applyDiscountOn: 'grand_total',
            allowRateChange: true,
            allowDiscountChange: true,
            maxDiscountPercent: 100,
            allowNegativeStock: true,
            validateStockOnSave: false,
            hideUnavailableItems: false,
            autoAddItemToCart: true,
            printReceiptOnComplete: false,
            receiptPrintFormat: '80mm',
            showLogoOnReceipt: true,
            receiptHeader: `${config.companyName}\n123 Main Street, Colombo\nTel: +94 11 234 5678`,
            receiptFooter: 'Thank you for your business!\nExchange within 7 days with receipt.',
            defaultPaymentMethod: 'cash',
            allowCreditSale: true,
            paymentMethods: ['cash', 'card', 'bank_transfer'],
          },
        })
        if (res.ok()) {
          company.posProfileId = (await res.json()).id
        } else {
          // Already exists — find it
          const list = await request.get('/api/pos-profiles?all=true')
          const data = await list.json()
          const all = Array.isArray(data) ? data : data.data || []
          const found = all.find((p: { name: string }) => p.name === 'Default Register')
          expect(found, 'POS profile not found').toBeTruthy()
          company.posProfileId = found.id
        }
      })

      // ── Step 10: Configure accounting settings ─
      test(`Configure ${type} accounting settings`, async () => {
        const settingsUpdate: Record<string, unknown> = {
          autoPostSales: true,
          autoPostPurchases: true,
        }
        if (company.costCenterOps) {
          settingsUpdate.defaultCostCenterId = company.costCenterOps
        }

        const res = await request.put('/api/accounting/settings', {
          data: settingsUpdate,
        })
        expect(res.ok(), `Settings failed: ${await res.text()}`).toBeTruthy()
      })

      // ── Step 11: Verify setup ─────────────────
      test(`Verify ${type} setup complete`, async () => {
        // Verify warehouses
        const whRes = await request.get('/api/warehouses?all=true')
        const warehouses = await whRes.json()
        const whList = Array.isArray(warehouses) ? warehouses : warehouses.data || []
        expect(whList.length).toBeGreaterThanOrEqual(2)

        // Verify cost centers
        const ccRes = await request.get('/api/accounting/cost-centers?all=true')
        expect(ccRes.ok()).toBeTruthy()

        // Verify bank accounts
        const baRes = await request.get('/api/accounting/bank-accounts?all=true')
        expect(baRes.ok()).toBeTruthy()

        // Verify POS profiles
        const posRes = await request.get('/api/pos-profiles')
        expect(posRes.ok()).toBeTruthy()

        // Save state
        state.companies[type] = company as CompanyState
        saveState(state)
      })
    })
  })
})

import { test, expect, APIRequestContext, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  loadState,
  saveState,
  updateCompanyState,
  loginToCompany,
  getTestConfig,
  CompanyState,
  ItemConfig,
} from './helpers'

test.describe('Workflow — Master Data Creation', () => {
  test.setTimeout(240_000)

  BUSINESS_TYPES.forEach((type, index) => {
    test.describe.serial(`Master Data ${type}`, () => {
      let request: APIRequestContext
      let ctx: BrowserContext
      let company: CompanyState
      const config = getTestConfig(type, index)

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

      // ── Categories ────────────────────────────
      test(`Create ${type} categories`, async () => {
        test.skip(!request, `${type} not set up`)
        const categoryIds: string[] = []

        for (const catName of config.categories) {
          const res = await request.post('/api/categories', {
            data: { name: catName },
          })
          if (res.ok()) {
            const cat = await res.json()
            categoryIds.push(cat.id)
          } else {
            // Category may already exist from a previous run — find it
            const listRes = await request.get(`/api/categories?search=${encodeURIComponent(catName)}&all=true`)
            const listData = await listRes.json()
            const cats = Array.isArray(listData) ? listData : listData.data || []
            const existing = cats.find((c: { name: string }) => c.name === catName)
            expect(existing, `Category "${catName}" not found and create failed`).toBeTruthy()
            categoryIds.push(existing.id)
          }
        }

        company.categories = categoryIds
        updateCompanyState(type, { categories: categoryIds })
      })

      // ── Items (all fields populated) ─────────
      test(`Create ${type} items with full details`, async () => {
        test.skip(!request, `${type} not set up`)
        const items: CompanyState['items'] = []

        for (let i = 0; i < config.items.length; i++) {
          const itemCfg = config.items[i]
          const sku = itemCfg.sku || `SKU-${type.toUpperCase()}-${i + 1}`
          const categoryId = company.categories[i % company.categories.length] || undefined

          // Build full item payload with all available fields
          const itemData: Record<string, unknown> = {
            name: itemCfg.name,
            sku,
            sellingPrice: String(itemCfg.sellingPrice),
            costPrice: String(itemCfg.costPrice),
            trackStock: itemCfg.trackStock,
            categoryId,
          }

          // Common optional fields
          if (itemCfg.barcode) itemData.barcode = itemCfg.barcode
          if (itemCfg.brand) itemData.brand = itemCfg.brand
          if (itemCfg.unit) itemData.unit = itemCfg.unit
          if (itemCfg.condition) itemData.condition = itemCfg.condition
          if (itemCfg.minStock !== undefined) itemData.minStock = itemCfg.minStock
          if (itemCfg.reorderQty !== undefined) itemData.reorderQty = itemCfg.reorderQty
          if (itemCfg.binLocation) itemData.binLocation = itemCfg.binLocation
          if (itemCfg.weight !== undefined) itemData.weight = itemCfg.weight
          if (itemCfg.dimensions) itemData.dimensions = itemCfg.dimensions
          if (itemCfg.warrantyMonths !== undefined) itemData.warrantyMonths = itemCfg.warrantyMonths

          // Auto service / dealership fields
          if (itemCfg.oemPartNumber) itemData.oemPartNumber = itemCfg.oemPartNumber
          if (itemCfg.supplierPartNumber) itemData.supplierPartNumber = itemCfg.supplierPartNumber

          // Restaurant fields
          if (itemCfg.preparationTime !== undefined) itemData.preparationTime = itemCfg.preparationTime
          if (itemCfg.allergens) itemData.allergens = itemCfg.allergens
          if (itemCfg.calories !== undefined) itemData.calories = itemCfg.calories
          if (itemCfg.isVegetarian !== undefined) itemData.isVegetarian = itemCfg.isVegetarian
          if (itemCfg.isVegan !== undefined) itemData.isVegan = itemCfg.isVegan
          if (itemCfg.isGlutenFree !== undefined) itemData.isGlutenFree = itemCfg.isGlutenFree
          if (itemCfg.spiceLevel) itemData.spiceLevel = itemCfg.spiceLevel
          if (itemCfg.availableFrom) itemData.availableFrom = itemCfg.availableFrom
          if (itemCfg.availableTo) itemData.availableTo = itemCfg.availableTo

          // Supermarket fields
          if (itemCfg.pluCode) itemData.pluCode = itemCfg.pluCode
          if (itemCfg.shelfLifeDays !== undefined) itemData.shelfLifeDays = itemCfg.shelfLifeDays
          if (itemCfg.storageTemp) itemData.storageTemp = itemCfg.storageTemp

          const res = await request.post('/api/items', { data: itemData })
          if (res.ok()) {
            const created = await res.json()
            items.push({
              id: created.id,
              name: created.name,
              sellingPrice: itemCfg.sellingPrice,
              costPrice: itemCfg.costPrice,
              trackStock: itemCfg.trackStock,
            })
          } else {
            // Item may already exist — find it by SKU search
            const listRes = await request.get(`/api/items?search=${encodeURIComponent(sku)}&all=true`)
            const listData = await listRes.json()
            const all = Array.isArray(listData) ? listData : listData.data || []
            const existing = all.find((it: { sku: string }) => it.sku === sku)
            expect(existing, `Item "${itemCfg.name}" (${sku}) not found and create failed`).toBeTruthy()
            items.push({
              id: existing.id,
              name: existing.name,
              sellingPrice: itemCfg.sellingPrice,
              costPrice: itemCfg.costPrice,
              trackStock: itemCfg.trackStock,
            })
          }
        }

        company.items = items
        updateCompanyState(type, { items })
      })

      // ── Customers (all fields populated) ─────
      test(`Create ${type} customers with full profiles`, async () => {
        test.skip(!request, `${type} not set up`)
        const customers: CompanyState['customers'] = []

        for (const custCfg of config.customers) {
          // Build full customer payload
          const custData: Record<string, unknown> = {
            name: custCfg.name,
            firstName: custCfg.firstName,
            lastName: custCfg.lastName,
            email: custCfg.email,
            phone: custCfg.phone,
            addressLine1: custCfg.addressLine1,
            city: custCfg.city,
            state: custCfg.state,
            postalCode: custCfg.postalCode,
            country: custCfg.country,
          }

          // Optional fields
          if (custCfg.mobilePhone) custData.mobilePhone = custCfg.mobilePhone
          if (custCfg.alternatePhone) custData.alternatePhone = custCfg.alternatePhone
          if (custCfg.companyName) custData.companyName = custCfg.companyName
          if (custCfg.addressLine2) custData.addressLine2 = custCfg.addressLine2
          if (custCfg.useSameBillingAddress !== undefined) custData.useSameBillingAddress = custCfg.useSameBillingAddress
          if (custCfg.billingAddressLine1) custData.billingAddressLine1 = custCfg.billingAddressLine1
          if (custCfg.billingCity) custData.billingCity = custCfg.billingCity
          if (custCfg.billingState) custData.billingState = custCfg.billingState
          if (custCfg.billingPostalCode) custData.billingPostalCode = custCfg.billingPostalCode
          if (custCfg.billingCountry) custData.billingCountry = custCfg.billingCountry
          if (custCfg.taxId) custData.taxId = custCfg.taxId
          if (custCfg.taxExempt !== undefined) custData.taxExempt = custCfg.taxExempt
          if (custCfg.businessType) custData.businessType = custCfg.businessType
          if (custCfg.creditLimit !== undefined) custData.creditLimit = custCfg.creditLimit
          if (custCfg.paymentTerms) custData.paymentTerms = custCfg.paymentTerms
          if (custCfg.defaultPaymentMethod) custData.defaultPaymentMethod = custCfg.defaultPaymentMethod
          if (custCfg.customerType) custData.customerType = custCfg.customerType
          if (custCfg.referralSource) custData.referralSource = custCfg.referralSource
          if (custCfg.marketingOptIn !== undefined) custData.marketingOptIn = custCfg.marketingOptIn
          if (custCfg.birthday) custData.birthday = custCfg.birthday
          if (custCfg.notes) custData.notes = custCfg.notes
          if (custCfg.specialInstructions) custData.specialInstructions = custCfg.specialInstructions
          if (custCfg.driverLicenseNumber) custData.driverLicenseNumber = custCfg.driverLicenseNumber

          const res = await request.post('/api/customers', { data: custData })
          if (res.ok()) {
            const created = await res.json()
            customers.push({ id: created.id, name: created.name })
          } else {
            // Customer may already exist — find by name
            const listRes = await request.get(`/api/customers?search=${encodeURIComponent(custCfg.name)}&all=true`)
            const listData = await listRes.json()
            const all = Array.isArray(listData) ? listData : listData.data || []
            const existing = all.find((c: { name: string }) => c.name === custCfg.name)
            expect(existing, `Customer "${custCfg.name}" not found and create failed`).toBeTruthy()
            customers.push({ id: existing.id, name: existing.name })
          }
        }

        company.customers = customers
        updateCompanyState(type, { customers })
      })

      // ── Suppliers (all fields populated) ─────
      test(`Create ${type} suppliers with full details`, async () => {
        test.skip(!request, `${type} not set up`)
        const suppliers: CompanyState['suppliers'] = []

        for (const suppCfg of config.suppliers) {
          const suppData: Record<string, unknown> = {
            name: suppCfg.name,
            email: suppCfg.email,
            phone: suppCfg.phone,
            address: suppCfg.address,
          }
          if (suppCfg.taxId) suppData.taxId = suppCfg.taxId
          if (suppCfg.taxInclusive !== undefined) suppData.taxInclusive = suppCfg.taxInclusive

          const res = await request.post('/api/suppliers', { data: suppData })
          if (res.ok()) {
            const created = await res.json()
            suppliers.push({ id: created.id, name: created.name })
          } else {
            // Supplier may already exist — find by name
            const listRes = await request.get(`/api/suppliers?search=${encodeURIComponent(suppCfg.name)}&all=true`)
            const listData = await listRes.json()
            const all = Array.isArray(listData) ? listData : listData.data || []
            const existing = all.find((s: { name: string }) => s.name === suppCfg.name)
            expect(existing, `Supplier "${suppCfg.name}" not found and create failed`).toBeTruthy()
            suppliers.push({ id: existing.id, name: existing.name })
          }
        }

        company.suppliers = suppliers
        updateCompanyState(type, { suppliers })
      })

      // ── Service Types (auto_service + dealership) ─
      if (type === 'auto_service' || type === 'dealership') {
        test(`Create ${type} service types with descriptions`, async () => {
          test.skip(!request, `${type} not set up`)
          const serviceTypes: NonNullable<CompanyState['serviceTypes']> = []
          const stConfigs = config.serviceTypes || []

          for (const stCfg of stConfigs) {
            const stData: Record<string, unknown> = {
              name: stCfg.name,
              description: stCfg.description,
              defaultHours: stCfg.defaultHours,
              defaultRate: stCfg.defaultRate,
            }

            const res = await request.post('/api/service-types', { data: stData })
            if (res.ok()) {
              const created = await res.json()
              serviceTypes.push({ id: created.id, name: created.name, rate: parseFloat(stCfg.defaultRate) })
            } else {
              // Service type may already exist — find it
              const listRes = await request.get(`/api/service-types?search=${encodeURIComponent(stCfg.name)}&all=true`)
              const listData = await listRes.json()
              const all = Array.isArray(listData) ? listData : listData.data || []
              const existing = all.find((s: { name: string }) => s.name === stCfg.name)
              expect(existing, `Service type "${stCfg.name}" not found and create failed`).toBeTruthy()
              serviceTypes.push({ id: existing.id, name: existing.name, rate: parseFloat(stCfg.defaultRate) })
            }
          }

          company.serviceTypes = serviceTypes
          updateCompanyState(type, { serviceTypes })
        })

        test(`Create ${type} vehicles with full details`, async () => {
          test.skip(!request, `${type} not set up`)
          const vehicles: NonNullable<CompanyState['vehicles']> = []
          const custId = company.customers[0]?.id
          const vehConfigs = config.vehicles || []

          for (const vehCfg of vehConfigs) {
            const vehData: Record<string, unknown> = {
              customerId: custId,
              make: vehCfg.make,
              model: vehCfg.model,
              year: vehCfg.year,
              color: vehCfg.color,
              licensePlate: vehCfg.licensePlate,
              vin: vehCfg.vin,
              currentMileage: vehCfg.currentMileage,
              notes: vehCfg.notes,
            }

            const res = await request.post('/api/vehicles', { data: vehData })
            if (res.ok()) {
              const created = await res.json()
              vehicles.push({ id: created.id, plate: created.licensePlate, customerId: custId })
            } else {
              // Vehicle may already exist — find by plate
              const listRes = await request.get(`/api/vehicles?search=${encodeURIComponent(vehCfg.licensePlate)}&all=true`)
              const listData = await listRes.json()
              const all = Array.isArray(listData) ? listData : listData.data || []
              const existing = all.find((v: { licensePlate: string }) => v.licensePlate === vehCfg.licensePlate)
              expect(existing, `Vehicle "${vehCfg.licensePlate}" not found and create failed`).toBeTruthy()
              vehicles.push({ id: existing.id, plate: existing.licensePlate, customerId: custId })
            }
          }

          company.vehicles = vehicles
          updateCompanyState(type, { vehicles })
        })
      }

      // ── Restaurant Tables (restaurant only) ───
      if (type === 'restaurant') {
        test(`Create restaurant tables with layout`, async () => {
          test.skip(!request, `${type} not set up`)

          const tables = [
            { name: 'Table 1', area: 'Main Hall', capacity: 4, shape: 'square' as const, positionX: 100, positionY: 100, width: 80, height: 80, rotation: 0 },
            { name: 'Table 2', area: 'Main Hall', capacity: 6, shape: 'rectangle' as const, positionX: 250, positionY: 100, width: 120, height: 80, rotation: 0 },
            { name: 'Table 3', area: 'Patio', capacity: 2, shape: 'circle' as const, positionX: 100, positionY: 250, width: 60, height: 60, rotation: 0 },
          ]

          for (const table of tables) {
            const res = await request.post('/api/restaurant-tables', { data: table })
            if (!res.ok()) {
              console.log(`Restaurant table "${table.name}" creation returned ${res.status()} - may already exist`)
            }
          }
        })
      }

      // ── Verify all master data ────────────────
      test(`Verify ${type} master data`, async () => {
        test.skip(!request, `${type} not set up`)

        // Verify items exist
        const itemsRes = await request.get('/api/items?pageSize=10')
        expect(itemsRes.ok()).toBeTruthy()
        const itemsData = await itemsRes.json()
        const items = itemsData.data || itemsData
        expect(items.length).toBeGreaterThanOrEqual(config.items.length)

        // Verify customers exist
        const custRes = await request.get('/api/customers?pageSize=10')
        expect(custRes.ok()).toBeTruthy()

        // Verify suppliers exist
        const suppRes = await request.get('/api/suppliers?pageSize=10')
        expect(suppRes.ok()).toBeTruthy()

        // Final state save
        const fullState = loadState()
        fullState.companies[type] = company
        saveState(fullState)
      })
    })
  })
})

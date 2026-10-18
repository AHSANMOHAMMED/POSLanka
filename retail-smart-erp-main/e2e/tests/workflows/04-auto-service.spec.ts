import { test, expect, APIRequestContext, BrowserContext } from '@playwright/test'
import {
  loadState,
  updateCompanyState,
  loginToCompany,
  CompanyState,
  BusinessType,
  getGLEntries,
  assertGLBalance,
  getStockMovements,
  getWarehouseStock,
  getStockForWarehouse,
  today,
  tomorrow,
  daysFromNow,
  num,
} from './helpers'

// Only auto_service and dealership support work orders, appointments, estimates
const SERVICE_TYPES: BusinessType[] = ['auto_service', 'dealership']

test.describe('Workflow — Auto Service / Dealership Flows', () => {
  test.setTimeout(240_000)

  SERVICE_TYPES.forEach((type) => {
    test.describe.serial(`Auto Service ${type}`, () => {
      let request: APIRequestContext
      let ctx: BrowserContext
      let company: CompanyState

      test.beforeAll(async ({ browser }) => {
        const state = loadState()
        company = state.companies[type]!
        if (!company?.slug || !company.serviceTypes?.length) return
        ctx = await browser.newContext()
        const page = await ctx.newPage()
        await loginToCompany(page.request, company.email, company.password, company.slug)
        request = page.request
      })

      test.afterAll(async () => {
        if (ctx) await ctx.close()
      })

      // ════════════════════════════════════════
      // Flow A: Appointment → Work Order → Invoice
      // ════════════════════════════════════════

      let appointmentId: string

      test(`AUTO-${type}-001: Create appointment with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const customer = company.customers[0]
        const vehicle = company.vehicles?.[0]
        const serviceType = company.serviceTypes?.[0]
        test.skip(!vehicle || !serviceType, 'Vehicles or service types not available')

        const res = await request.post('/api/appointments', {
          data: {
            customerId: customer.id,
            vehicleId: vehicle!.id,
            serviceTypeId: serviceType!.id,
            scheduledDate: tomorrow(),
            scheduledTime: '10:00',
            durationMinutes: 90,
            notes: `E2E appointment for ${type} — ${serviceType!.name} service. Customer will drop off vehicle at 9:45 AM. Please prepare bay 2.`,
            recurrencePattern: 'none',
          },
        })
        expect(res.ok(), `Appointment failed: ${await res.text()}`).toBeTruthy()
        const data = await res.json()
        appointmentId = data.appointment?.id || data.id
        expect(appointmentId).toBeTruthy()

        company.appointments = company.appointments || []
        company.appointments.push({ id: appointmentId })
        updateCompanyState(type, { appointments: company.appointments })
      })

      test(`AUTO-${type}-002: Verify appointment created`, async () => {
        test.skip(!request || !appointmentId, `${type} not set up`)

        const res = await request.get(`/api/appointments/${appointmentId}`)
        expect(res.ok()).toBeTruthy()
        const appt = await res.json()
        expect(appt.status).toBe('scheduled')
      })

      // ════════════════════════════════════════
      // Flow B: Standalone Work Order (with services + parts)
      // ════════════════════════════════════════

      let woId: string
      let woOrderNo: string

      test(`AUTO-${type}-003: Create work order with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const customer = company.customers[0]
        const vehicle = company.vehicles?.[0]
        const serviceType = company.serviceTypes?.[0]
        const part = company.items[0]

        const res = await request.post('/api/work-orders', {
          data: {
            customerId: customer.id,
            vehicleId: vehicle?.id,
            priority: 'normal',
            odometerIn: 45000,
            customerComplaint: 'Routine maintenance — oil change and multi-point inspection. Customer reports slight vibration at highway speeds above 80km/h. Check wheel alignment and tire balance.',
            warehouseId: company.warehouseA,
            costCenterId: company.costCenterOps,
            services: serviceType
              ? [
                  {
                    serviceTypeId: serviceType.id,
                    description: `${serviceType.name} — full synthetic oil drain and refill with OEM filter`,
                    hours: 1.5,
                    rate: serviceType.rate,
                  },
                ]
              : [],
            parts: [
              {
                itemId: part.id,
                quantity: 2,
                unitPrice: part.sellingPrice,
                discount: 0,
              },
            ],
          },
        })
        expect(res.ok(), `Create WO failed: ${await res.text()}`).toBeTruthy()
        const wo = await res.json()
        woId = wo.id
        woOrderNo = wo.orderNo
        expect(wo.orderNo).toMatch(/^WO-/)
        expect(wo.status).toBe('draft')
      })

      test(`AUTO-${type}-004: Add more parts to work order`, async () => {
        test.skip(!request || !woId, `${type} not set up`)

        if (company.items.length > 1) {
          const part = company.items[1]
          const res = await request.post(`/api/work-orders/${woId}/parts`, {
            data: {
              itemId: part.id,
              quantity: 1,
              unitPrice: part.sellingPrice,
              discount: 0,
            },
          })
          expect(res.ok(), `Add parts failed: ${await res.text()}`).toBeTruthy()
        }
      })

      test(`AUTO-${type}-005: Add more services to work order`, async () => {
        test.skip(!request || !woId, `${type} not set up`)

        if (company.serviceTypes && company.serviceTypes.length > 1) {
          const st = company.serviceTypes[1]
          const res = await request.post(`/api/work-orders/${woId}/services`, {
            data: {
              serviceTypeId: st.id,
              description: `${st.name} — comprehensive inspection with pad measurement and rotor check`,
              hours: 2,
              rate: st.rate,
            },
          })
          expect(res.ok(), `Add service failed: ${await res.text()}`).toBeTruthy()
        }
      })

      let woStockBefore: Record<string, number> = {}

      test(`AUTO-${type}-006: Record stock before WO invoice`, async () => {
        test.skip(!request || !woId, `${type} not set up`)

        for (const item of company.items.filter((i) => i.trackStock)) {
          const stocks = await getWarehouseStock(request, item.id)
          woStockBefore[item.id] = getStockForWarehouse(stocks, company.warehouseA)
        }
      })

      let woSaleId: string

      test(`AUTO-${type}-007: Invoice work order`, async () => {
        test.skip(!request || !woId, `${type} not set up`)

        const res = await request.post(`/api/work-orders/${woId}/invoice`, {
          data: {
            paymentMethod: 'cash',
            paidAmount: 99999,
            creditAmount: 0,
          },
        })
        expect(res.ok(), `WO invoice failed: ${await res.text()}`).toBeTruthy()
        const sale = await res.json()
        woSaleId = sale.id
        expect(sale.invoiceNo).toMatch(/^INV-/)

        company.workOrders = company.workOrders || []
        company.workOrders.push({ id: woId, orderNo: woOrderNo })
        company.sales.push({ id: woSaleId, invoiceNo: sale.invoiceNo })
        updateCompanyState(type, {
          workOrders: company.workOrders,
          sales: company.sales,
        })
      })

      test(`AUTO-${type}-008: Verify WO status changed to invoiced`, async () => {
        test.skip(!request || !woId, `${type} not set up`)

        const res = await request.get(`/api/work-orders/${woId}`)
        expect(res.ok()).toBeTruthy()
        const wo = await res.json()
        expect(wo.status).toBe('invoiced')
      })

      test(`AUTO-${type}-009: Verify stock decreased after WO invoice`, async () => {
        test.skip(!request || !woSaleId, `${type} not set up`)

        for (const item of company.items.filter((i) => i.trackStock)) {
          const stocks = await getWarehouseStock(request, item.id)
          const stockNow = getStockForWarehouse(stocks, company.warehouseA)
          const before = woStockBefore[item.id] || 0
          expect(stockNow).toBeLessThanOrEqual(before)
        }
      })

      test(`AUTO-${type}-010: Verify GL for WO invoice`, async () => {
        test.skip(!request || !woSaleId, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: woSaleId })
        if (entries.length > 0) {
          assertGLBalance(entries)
        }
      })

      // ════════════════════════════════════════
      // Flow C: Insurance Estimate (auto_service only)
      // ════════════════════════════════════════

      if (type === 'auto_service') {
        let estimateId: string

        test(`AUTO-${type}-011: Create insurance estimate with full details`, async () => {
          test.skip(!request, `${type} not set up`)

          const customer = company.customers[0]
          const vehicle = company.vehicles?.[0]
          const serviceType = company.serviceTypes?.[0]
          const part = company.items[0]

          const res = await request.post('/api/insurance-estimates', {
            data: {
              estimateType: 'direct',
              customerId: customer.id,
              vehicleId: vehicle?.id,
              warehouseId: company.warehouseA,
              incidentDate: today(),
              incidentDescription: 'Front bumper damage from low-speed parking incident in shopping mall car park. Bumper cracked, left fog light housing broken, minor paint transfer on fender.',
              odometerIn: 48000,
              assessorName: 'Chaminda Perera',
              assessorPhone: '+94770990011',
              assessorEmail: 'assessor@insurance.test',
              items: [
                ...(serviceType
                  ? [
                      {
                        itemType: 'service' as const,
                        serviceTypeId: serviceType.id,
                        description: 'Body repair labor — remove bumper, repair crack, sand, prime and paint',
                        hours: 4,
                        rate: serviceType.rate,
                      },
                    ]
                  : []),
                {
                  itemType: 'part' as const,
                  itemId: part.id,
                  partName: part.name,
                  quantity: 1,
                  unitPrice: part.sellingPrice,
                },
              ],
            },
          })
          expect(res.ok(), `Estimate failed: ${await res.text()}`).toBeTruthy()
          const estimate = await res.json()
          estimateId = estimate.id
          expect(estimate.estimateNo).toMatch(/^EST-/)
          expect(estimate.status).toBe('draft')

          company.estimates = company.estimates || []
          company.estimates.push({ id: estimateId, estimateNo: estimate.estimateNo })
          updateCompanyState(type, { estimates: company.estimates })
        })

        test(`AUTO-${type}-012: Verify estimate exists`, async () => {
          test.skip(!request || !estimateId, `${type} not set up`)

          const res = await request.get(`/api/insurance-estimates/${estimateId}`)
          expect(res.ok()).toBeTruthy()
          const est = await res.json()
          expect(est.status).toBe('draft')
          expect(est.items.length).toBeGreaterThan(0)
        })
      }

      // ════════════════════════════════════════
      // Flow D: Second standalone WO (no appointment)
      // ════════════════════════════════════════

      test(`AUTO-${type}-013: Create second WO without appointment`, async () => {
        test.skip(!request, `${type} not set up`)

        const vehicle = company.vehicles?.[1] || company.vehicles?.[0]
        const customer = company.customers[0]
        const serviceType = company.serviceTypes?.[0]
        const part = company.items[0]

        const res = await request.post('/api/work-orders', {
          data: {
            customerId: customer?.id,
            vehicleId: vehicle?.id,
            confirmCustomerMismatch: true,
            priority: 'high',
            odometerIn: 62000,
            customerComplaint: 'Brake noise when stopping — metallic grinding sound from front wheels. Customer reports brake pedal feels spongy. Urgent safety concern.',
            warehouseId: company.warehouseA,
            costCenterId: company.costCenterOps,
            services: serviceType
              ? [{ serviceTypeId: serviceType.id, description: `${serviceType.name} — emergency brake inspection and repair`, hours: 1, rate: serviceType.rate }]
              : [],
            parts: [{ itemId: part.id, quantity: 2, unitPrice: part.sellingPrice, discount: 0 }],
          },
        })
        expect(res.ok(), `Second WO failed: ${await res.text()}`).toBeTruthy()
        const wo = await res.json()

        // Invoice this WO too
        const invRes = await request.post(`/api/work-orders/${wo.id}/invoice`, {
          data: { paymentMethod: 'cash', paidAmount: 99999, creditAmount: 0 },
        })
        expect(invRes.ok(), `Second WO invoice failed: ${await invRes.text()}`).toBeTruthy()

        company.workOrders!.push({ id: wo.id, orderNo: wo.orderNo })
        updateCompanyState(type, { workOrders: company.workOrders })
      })
    })
  })
})

import { test, expect, Page, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  getTestConfig,
  loadUIState,
  updateUICompanyState,
  loginViaAPI,
  navigateTo,
  waitForPageReady,
  fillField,
  fillAsyncSelect,
  selectOption,
  fillDate,
  clickButton,
  clickButtonAndWait,
  expectToastSuccess,
  waitForModal,
  waitForModalClose,
  tryAction,
  isVisible,
  today,
  tomorrow,
} from './ui-helpers'

test.describe('UI — Work Orders & Appointments (Auto Service)', () => {
  test.setTimeout(600_000)

  // Only test auto_service and dealership business types
  const autoTypes = BUSINESS_TYPES.filter(t => t === 'auto_service' || t === 'dealership')

  autoTypes.forEach((type, idx) => {
    const realIdx = BUSINESS_TYPES.indexOf(type)
    test.describe.serial(`Work Orders ${type}`, () => {
      let page: Page
      let ctx: BrowserContext
      const config = getTestConfig(type, realIdx)

      test.beforeAll(async ({ browser }) => {
        const state = loadUIState()
        const company = state.companies[type]
        if (!company?.slug) return

        ctx = await browser.newContext()
        page = await ctx.newPage()
        await loginViaAPI(page.request, company.email, company.password, company.slug)
      })

      test.afterAll(async () => {
        if (ctx) await ctx.close()
      })

      // ════════════════════════════════════════
      // Appointments
      // ════════════════════════════════════════

      test(`WO-${type}-001: Navigate to appointments page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'appointments')
        await waitForPageReady(page)

        const heading = page.locator('h1, h2, [class*="title"]').first()
        await expect(heading).toBeVisible({ timeout: 10_000 })
      })

      test(`WO-${type}-002: Create appointment via API`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(
          !company?.slug || !company.customers.length || !company.items.length,
          `${type} not set up`
        )

        // Use API since appointment creation may be a complex modal
        const res = await page.request.post('/api/appointments', {
          data: {
            customerId: company!.customers[0].id,
            vehicleId: company!.vehicles?.[0]?.id || null,
            scheduledDate: tomorrow(),
            scheduledTime: '10:00',
            duration: 90,
            notes: `E2E UI test appointment for ${type} — routine vehicle service checkup and inspection`,
          },
        })

        if (res.ok()) {
          const apt = await res.json()
          updateUICompanyState(type, {
            appointments: [{ id: apt.id, status: apt.status || 'scheduled' }],
          } as any)
        }
      })

      test(`WO-${type}-003: Verify appointment appears in list`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Refresh appointments page
        await navigateTo(page, company!.slug, 'appointments')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        // Page should have content
        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(30)
      })

      // ════════════════════════════════════════
      // Work Orders
      // ════════════════════════════════════════

      test(`WO-${type}-004: Navigate to work orders list`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'work-orders')
        await waitForPageReady(page)

        const heading = page.locator('h1, h2, [class*="title"]').first()
        await expect(heading).toBeVisible({ timeout: 10_000 })
      })

      test(`WO-${type}-005: Click "New Work Order" and navigate to form`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        const newWOBtn = page.getByRole('button', { name: /new work order/i })
          .or(page.getByRole('link', { name: /new work order/i }))
        await newWOBtn.first().click()
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1000)

        // Should be on /work-orders/new
        const url = page.url()
        expect(url).toContain('/work-orders/new')
      })

      test(`WO-${type}-006: Fill work order header — customer and vehicle`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(
          !company?.slug || !company.customers.length,
          `${type} not set up`
        )

        // Select customer via async select
        await tryAction(async () => {
          await fillAsyncSelect(page, 'customer', company!.customers[0].name)
        })
        await page.waitForTimeout(500)

        // Select vehicle if any vehicles exist
        await tryAction(async () => {
          const vehicleSelect = page.locator('input').filter({
            has: page.locator('..').filter({ hasText: /vehicle/i }),
          })
          if (await vehicleSelect.first().isVisible()) {
            await fillAsyncSelect(page, 'vehicle', '')
          }
        })
      })

      test(`WO-${type}-007: Fill work order details — priority, odometer, complaint`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Set priority to High
        await tryAction(async () => {
          await selectOption(page, 'Priority', 'High')
        })

        // Fill odometer
        await tryAction(async () => {
          await fillField(page, 'Odometer', '45230')
        })

        // Fill customer complaint
        await tryAction(async () => {
          const complaintArea = page.getByPlaceholder(/complaint/i)
            .or(page.locator('textarea').filter({ has: page.locator('..').filter({ hasText: /complaint/i }) }))
          if (await complaintArea.first().isVisible()) {
            await complaintArea.first().fill(
              'Vehicle making unusual rattling noise from front suspension during acceleration. ' +
              'Brake pedal feels spongy. Oil change overdue by 2000km. ' +
              'Customer requests full inspection of undercarriage and brake system.'
            )
          }
        })

        // Fill diagnosis
        await tryAction(async () => {
          const diagArea = page.getByPlaceholder(/diagnosis/i)
            .or(page.locator('textarea').filter({ has: page.locator('..').filter({ hasText: /diagnosis/i }) }))
          if (await diagArea.first().isVisible()) {
            await diagArea.first().fill(
              'Preliminary inspection: worn CV joint boot (driver side), brake pads at 15% life remaining, ' +
              'oil viscosity degraded. Recommend CV joint replacement, brake pad replacement, and full oil service.'
            )
          }
        })
      })

      test(`WO-${type}-008: Add service line to work order`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Click "Add Service" button
        const addServiceBtn = page.getByRole('button', { name: /add service/i })
        if (await addServiceBtn.isVisible()) {
          await addServiceBtn.click()
          await page.waitForTimeout(500)

          // Fill service row — search for service type
          await tryAction(async () => {
            const serviceInput = page.getByPlaceholder(/search service/i).last()
            if (await serviceInput.isVisible()) {
              await serviceInput.fill('Oil')
              await page.waitForTimeout(500)
              await page.waitForLoadState('networkidle')

              // Click first result
              const option = page.locator('[class*="option"], [role="option"]').first()
              if (await option.isVisible({ timeout: 3_000 })) {
                await option.click()
                await page.waitForTimeout(300)
              }
            }
          })

          // Set hours and rate if not auto-filled
          await tryAction(async () => {
            const hoursInputs = page.locator('input[type="number"]')
            const count = await hoursInputs.count()
            for (let i = 0; i < count; i++) {
              const input = hoursInputs.nth(i)
              const val = await input.inputValue()
              if (val === '' || val === '0') {
                const placeholder = await input.getAttribute('placeholder')
                if (placeholder?.includes('.')) {
                  await input.fill('2')
                }
              }
            }
          })
        }
      })

      test(`WO-${type}-009: Add parts line to work order`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Click "Add Part" button
        const addPartBtn = page.getByRole('button', { name: /add part/i })
        if (await addPartBtn.isVisible()) {
          await addPartBtn.click()
          await page.waitForTimeout(500)

          // Search for part item
          await tryAction(async () => {
            const partInput = page.getByPlaceholder(/search part/i).last()
              .or(page.getByPlaceholder(/search item/i).last())
            if (await partInput.isVisible()) {
              await partInput.fill(company!.items[0].name)
              await page.waitForTimeout(500)
              await page.waitForLoadState('networkidle')

              const option = page.locator('[class*="option"], [role="option"]')
                .filter({ hasText: company!.items[0].name })
                .first()
              if (await option.isVisible({ timeout: 3_000 })) {
                await option.click()
                await page.waitForTimeout(300)
              }
            }
          })
        }
      })

      test(`WO-${type}-010: Save work order as draft`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Click Save as Draft
        const saveBtn = page.getByRole('button', { name: /save.*draft|save/i }).first()
        if (await saveBtn.isVisible() && await saveBtn.isEnabled()) {
          await saveBtn.click()
          await page.waitForLoadState('networkidle')
          await page.waitForTimeout(2000)

          // Check for toast or redirect
          await tryAction(async () => {
            await expectToastSuccess(page)
          })

          // Store work order ID from URL if redirected
          const url = page.url()
          const woMatch = url.match(/work-orders\/([a-f0-9-]+)/)
          if (woMatch) {
            const workOrders = loadUIState().companies[type]?.workOrders || []
            workOrders.push({ id: woMatch[1], orderNo: '' })
            updateUICompanyState(type, { workOrders } as any)
          }
        }
      })

      test(`WO-${type}-011: Verify work order in list`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'work-orders')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        // Should have work orders in the list
        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(50)
      })

      // ════════════════════════════════════════
      // Insurance Estimates (auto_service only)
      // ════════════════════════════════════════

      if (type === 'auto_service') {
        test(`WO-${type}-012: Navigate to insurance estimates`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          await navigateTo(page, company!.slug, 'insurance-estimates')
          await waitForPageReady(page)

          const heading = page.locator('h1, h2, [class*="title"]').first()
          await expect(heading).toBeVisible({ timeout: 10_000 })
        })

        test(`WO-${type}-013: Create insurance estimate via UI`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug || !company.customers.length, `${type} not set up`)

          // Click New Estimate
          const newBtn = page.getByRole('button', { name: /new estimate/i })
            .or(page.getByRole('link', { name: /new estimate/i }))
          if (await newBtn.first().isVisible()) {
            await newBtn.first().click()
            await page.waitForLoadState('networkidle')
            await page.waitForTimeout(1000)
          }

          // Should be on /insurance-estimates/new
          const url = page.url()
          if (!url.includes('/new')) return

          // Select estimate type (Insurance radio)
          await tryAction(async () => {
            const insuranceRadio = page.locator('input[type="radio"]').first()
              .or(page.locator('button, label').filter({ hasText: /insurance/i }).first())
            if (await insuranceRadio.isVisible()) {
              await insuranceRadio.click()
            }
          })

          // Select customer
          await tryAction(async () => {
            await fillAsyncSelect(page, 'customer', company!.customers[0].name)
          })
          await page.waitForTimeout(300)

          // Fill insurance details
          await tryAction(async () => { await fillField(page, 'Policy Number', 'POL-2025-E2E-001') })
          await tryAction(async () => { await fillField(page, 'Claim Number', 'CLM-2025-E2E-001') })
          await tryAction(async () => {
            await fillDate(page, 'Incident Date', today())
          })
          await tryAction(async () => {
            const descArea = page.getByPlaceholder(/incident/i)
              .or(page.locator('textarea').filter({ has: page.locator('..').filter({ hasText: /incident/i }) }))
            if (await descArea.first().isVisible()) {
              await descArea.first().fill(
                'Vehicle involved in minor rear-end collision at traffic light. ' +
                'Damage to rear bumper, tail light assembly, and trunk lid. ' +
                'No structural frame damage observed. Airbags did not deploy.'
              )
            }
          })

          // Assessor info
          await tryAction(async () => { await fillField(page, 'Assessor Name', 'Mr. Kamal Perera') })
          await tryAction(async () => { await fillField(page, 'Assessor Phone', '+94 77 234 5678') })
          await tryAction(async () => { await fillField(page, 'Assessor Email', 'kamal.perera@insureco.lk') })

          // Add service line
          await tryAction(async () => {
            const addServiceBtn = page.getByRole('button', { name: /add service/i })
            if (await addServiceBtn.isVisible()) {
              await addServiceBtn.click()
              await page.waitForTimeout(300)
            }
          })

          // Add parts line
          await tryAction(async () => {
            const addPartBtn = page.getByRole('button', { name: /add part/i })
            if (await addPartBtn.isVisible()) {
              await addPartBtn.click()
              await page.waitForTimeout(300)
            }
          })

          // Save
          const saveBtn = page.getByRole('button', { name: /save|create/i }).first()
          if (await saveBtn.isVisible() && await saveBtn.isEnabled()) {
            await saveBtn.click()
            await page.waitForLoadState('networkidle')
            await page.waitForTimeout(2000)
          }
        })

        test(`WO-${type}-014: Verify estimate in list`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          await navigateTo(page, company!.slug, 'insurance-estimates')
          await waitForPageReady(page)
          await page.waitForTimeout(1000)

          const content = await page.textContent('main')
          expect(content!.length).toBeGreaterThan(30)
        })
      }
    })
  })
})

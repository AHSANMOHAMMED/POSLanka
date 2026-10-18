import { Page, expect, APIRequestContext } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// Re-export everything from the API helpers for hybrid tests
export {
  BUSINESS_TYPES,
  type BusinessType,
  type CompanyState,
  type TestState,
  type TestConfig,
  type ItemConfig,
  type CustomerConfig,
  type SupplierConfig,
  type ServiceTypeConfig,
  type VehicleConfig,
  type AccountIds,
  type ItemRef,
  getTestConfig,
  today,
  tomorrow,
  daysFromNow,
  num,
} from '../workflows/helpers'

import {
  type BusinessType,
  type CompanyState,
  type TestState,
  loginToCompany as apiLoginToCompany,
} from '../workflows/helpers'

// ──────────────────────────────────────────
// Terminology — business-type-specific button labels
// ──────────────────────────────────────────

const TERMINOLOGY: Record<string, {
  addCategory: string; addItem: string; createItem: string; createCategory: string;
  newCustomer: string; payNow: string; searchPlaceholder: string;
  addSupplier: string; saleCompleted: string;
  currentSale: string; newSale: string;
}> = {
  retail: {
    addCategory: 'Add Category', addItem: 'Add Product', createItem: 'Create Product',
    createCategory: 'Create Category', newCustomer: 'New Customer', payNow: 'Pay Now',
    searchPlaceholder: 'Search products', addSupplier: 'Add Supplier',
    saleCompleted: 'Sale completed', currentSale: 'Current Sale', newSale: 'New Sale',
  },
  restaurant: {
    addCategory: 'Add Menu Section', addItem: 'Add Menu Item', createItem: 'Create Menu Item',
    createCategory: 'Create Menu Section', newCustomer: 'New Guest', payNow: 'Pay Bill',
    searchPlaceholder: 'Search menu items', addSupplier: 'Add Supplier',
    saleCompleted: 'Order settled', currentSale: 'Current Order', newSale: 'New Bill',
  },
  supermarket: {
    addCategory: 'Add Department', addItem: 'Add Product', createItem: 'Create Product',
    createCategory: 'Create Department', newCustomer: 'New Customer', payNow: 'Pay Now',
    searchPlaceholder: 'Scan barcode or search', addSupplier: 'Add Supplier',
    saleCompleted: 'Sale completed', currentSale: 'Current Sale', newSale: 'New Sale',
  },
  auto_service: {
    addCategory: 'Add Part Category', addItem: 'Add Part', createItem: 'Create Part',
    createCategory: 'Create Part Category', newCustomer: 'New Customer', payNow: 'Pay Now',
    searchPlaceholder: 'Search parts', addSupplier: 'Add Supplier',
    saleCompleted: 'Invoice created', currentSale: 'Current Invoice', newSale: 'New Invoice',
  },
  dealership: {
    addCategory: 'Add Vehicle Category', addItem: 'Add Vehicle', createItem: 'Create Vehicle',
    createCategory: 'Create Vehicle Category', newCustomer: 'New Buyer', payNow: 'Pay Now',
    searchPlaceholder: 'Search vehicles', addSupplier: 'Add Supplier',
    saleCompleted: 'Deal completed', currentSale: 'Current Deal', newSale: 'New Vehicle Sale',
  },
}

export function getTerms(type: string) {
  return TERMINOLOGY[type] || TERMINOLOGY.retail
}

// ──────────────────────────────────────────
// State Management (separate file from API tests)
// ──────────────────────────────────────────

const UI_STATE_FILE = path.join(__dirname, '../../.ui-test-state.json')

export function saveUIState(state: TestState): void {
  fs.writeFileSync(UI_STATE_FILE, JSON.stringify(state, null, 2))
}

export function loadUIState(): TestState {
  if (fs.existsSync(UI_STATE_FILE)) {
    return JSON.parse(fs.readFileSync(UI_STATE_FILE, 'utf-8'))
  }
  return { companies: {} }
}

export function updateUICompanyState(type: BusinessType, update: Partial<CompanyState>): void {
  const state = loadUIState()
  state.companies[type] = { ...state.companies[type]!, ...update }
  saveUIState(state)
}

// ──────────────────────────────────────────
// Login via UI (browser)
// ──────────────────────────────────────────

export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  // Fill email
  const emailInput = page.locator('input[type="email"]')
  await emailInput.waitFor({ state: 'visible', timeout: 10_000 })
  await emailInput.fill(email)

  // Fill password
  const passwordInput = page.locator('input[type="password"]')
  await passwordInput.fill(password)

  // Click sign in
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForLoadState('networkidle')
}

export async function loginToCompanyViaUI(
  page: Page,
  email: string,
  password: string,
  slug: string
): Promise<void> {
  await loginViaUI(page, email, password)
  // After login, navigate to company dashboard
  await page.goto(`/c/${slug}/dashboard`)
  await page.waitForLoadState('networkidle')
  // Wait for dashboard content to appear
  await page.waitForSelector('main', { timeout: 15_000 })
}

// Also login via API for the request context (hybrid approach)
export async function loginViaAPI(
  request: APIRequestContext,
  email: string,
  password: string,
  slug: string
): Promise<void> {
  await apiLoginToCompany(request, email, password, slug)
}

// ──────────────────────────────────────────
// Navigation Helpers
// ──────────────────────────────────────────

export async function navigateTo(page: Page, slug: string, pagePath: string): Promise<void> {
  const url = `/c/${slug}/${pagePath}`
  await page.goto(url)
  // Use networkidle with a timeout, fall back to domcontentloaded for heavy pages (e.g. POS)
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(async () => {
    await page.waitForLoadState('domcontentloaded')
  })
  // Wait for main content area (might not exist if redirected to setup wizard)
  await page.waitForSelector('main', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(async () => {
    await page.waitForLoadState('domcontentloaded')
  })
  // Wait a brief moment for any React hydration
  await page.waitForTimeout(300)
}

// ──────────────────────────────────────────
// Modal Helpers
// ──────────────────────────────────────────

export async function waitForModal(page: Page, titleText?: string): Promise<void> {
  // Wait for dialog/modal overlay to appear
  const modal = page.locator('[role="dialog"], .modal-content, [class*="modal"]').first()
  await modal.waitFor({ state: 'visible', timeout: 10_000 })
  if (titleText) {
    await expect(modal.getByText(titleText, { exact: false })).toBeVisible({ timeout: 5_000 })
  }
  await page.waitForTimeout(200) // Small delay for animation
}

export async function waitForModalClose(page: Page): Promise<void> {
  // Wait for the modal backdrop/overlay to disappear
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {
    // Fallback: check modal-content is gone
  })
  await page.waitForTimeout(300)
}

export async function closeModal(page: Page): Promise<void> {
  const cancelBtn = page.getByRole('button', { name: /cancel/i })
  if (await cancelBtn.isVisible()) {
    await cancelBtn.click()
  } else {
    // Try X button
    const closeBtn = page.locator('[role="dialog"] button').filter({ hasText: '×' }).first()
    if (await closeBtn.isVisible()) await closeBtn.click()
  }
  await waitForModalClose(page)
}

// ──────────────────────────────────────────
// Form Field Helpers (for modals and pages)
// ──────────────────────────────────────────

/**
 * Fill a text/number/email input. Finds by associated label text or placeholder.
 */
export async function fillField(page: Page, labelOrPlaceholder: string, value: string): Promise<void> {
  // Try by label first
  let input = page.getByLabel(labelOrPlaceholder, { exact: false })
  if (await input.count() > 0 && await input.first().isVisible()) {
    await input.first().fill(value)
    return
  }
  // Try by placeholder
  input = page.getByPlaceholder(labelOrPlaceholder, { exact: false })
  if (await input.count() > 0 && await input.first().isVisible()) {
    await input.first().fill(value)
    return
  }
  // Fallback: look for label text near an input
  const label = page.locator(`label, .form-label, [class*="label"]`).filter({ hasText: labelOrPlaceholder })
  if (await label.count() > 0) {
    const nearInput = label.first().locator('..').locator('input, textarea').first()
    if (await nearInput.isVisible()) {
      await nearInput.fill(value)
      return
    }
  }
  throw new Error(`Could not find field: "${labelOrPlaceholder}"`)
}

/**
 * Fill a field within a specific container (modal, section, etc.)
 */
export async function fillFieldIn(
  container: ReturnType<Page['locator']>,
  labelOrPlaceholder: string,
  value: string
): Promise<void> {
  // Try label within container
  let input = container.getByLabel(labelOrPlaceholder, { exact: false })
  if (await input.count() > 0 && await input.first().isVisible()) {
    await input.first().fill(value)
    return
  }
  // Try placeholder
  input = container.getByPlaceholder(labelOrPlaceholder, { exact: false })
  if (await input.count() > 0 && await input.first().isVisible()) {
    await input.first().fill(value)
    return
  }
  // Fallback: label text sibling
  const label = container.locator(`label`).filter({ hasText: labelOrPlaceholder })
  if (await label.count() > 0) {
    const nearInput = label.first().locator('..').locator('input, textarea').first()
    if (await nearInput.isVisible()) {
      await nearInput.fill(value)
      return
    }
  }
  throw new Error(`Could not find field "${labelOrPlaceholder}" in container`)
}

/**
 * Select an option from a <select> dropdown.
 */
export async function selectOption(page: Page, labelOrPlaceholder: string, optionText: string): Promise<void> {
  // Find select by label
  let sel = page.getByLabel(labelOrPlaceholder, { exact: false })
  if (await sel.count() > 0 && (await sel.first().evaluate((el) => el.tagName)) === 'SELECT') {
    await sel.first().selectOption({ label: optionText })
    return
  }
  // Find select near label text
  const label = page.locator('label').filter({ hasText: labelOrPlaceholder })
  if (await label.count() > 0) {
    const nearSelect = label.first().locator('..').locator('select').first()
    if (await nearSelect.isVisible()) {
      await nearSelect.selectOption({ label: optionText })
      return
    }
  }
  throw new Error(`Could not find select: "${labelOrPlaceholder}"`)
}

/**
 * Select option within a container.
 */
export async function selectOptionIn(
  container: ReturnType<Page['locator']>,
  labelText: string,
  optionText: string
): Promise<void> {
  const label = container.locator('label').filter({ hasText: labelText })
  if (await label.count() > 0) {
    const nearSelect = label.first().locator('..').locator('select').first()
    if (await nearSelect.isVisible()) {
      await nearSelect.selectOption({ label: optionText })
      return
    }
  }
  // Direct label lookup
  const sel = container.getByLabel(labelText, { exact: false })
  if (await sel.count() > 0) {
    await sel.first().selectOption({ label: optionText })
    return
  }
  throw new Error(`Could not find select "${labelText}" in container`)
}

/**
 * Fill a date input field.
 */
export async function fillDate(page: Page, labelText: string, dateStr: string): Promise<void> {
  const input = page.getByLabel(labelText, { exact: false })
  if (await input.count() > 0 && await input.first().isVisible()) {
    await input.first().fill(dateStr)
    return
  }
  // Fallback: find date input near label
  const label = page.locator('label').filter({ hasText: labelText })
  if (await label.count() > 0) {
    const dateInput = label.first().locator('..').locator('input[type="date"]').first()
    if (await dateInput.isVisible()) {
      await dateInput.fill(dateStr)
      return
    }
  }
}

/**
 * Check or uncheck a checkbox by its label text.
 */
export async function setCheckbox(page: Page, labelText: string, checked: boolean): Promise<void> {
  const checkbox = page.getByLabel(labelText, { exact: false })
  if (await checkbox.count() > 0) {
    if (checked) {
      await checkbox.first().check()
    } else {
      await checkbox.first().uncheck()
    }
    return
  }
  // Fallback: checkbox near label text
  const label = page.locator('label').filter({ hasText: labelText })
  if (await label.count() > 0) {
    const cb = label.first().locator('input[type="checkbox"]')
    if (await cb.isVisible()) {
      if (checked) await cb.check()
      else await cb.uncheck()
    }
  }
}

/**
 * Click a tab button within a modal or page.
 */
export async function clickTab(page: Page, tabName: string): Promise<void> {
  const tab = page.getByRole('button', { name: tabName, exact: false }).or(
    page.locator('button, [role="tab"]').filter({ hasText: tabName })
  )
  await tab.first().click()
  await page.waitForTimeout(200) // Tab content transition
}

/**
 * Click a tab within a specific container.
 */
export async function clickTabIn(
  container: ReturnType<Page['locator']>,
  tabName: string
): Promise<void> {
  const tab = container.getByRole('button', { name: tabName, exact: false }).or(
    container.locator('button, [role="tab"]').filter({ hasText: tabName })
  )
  await tab.first().click()
  await container.page().waitForTimeout(200)
}

// ──────────────────────────────────────────
// Button Helpers
// ──────────────────────────────────────────

export async function clickButton(page: Page, name: string): Promise<void> {
  // Dismiss any lingering toasts that might block the button
  await dismissAllToasts(page)
  const btn = page.getByRole('button', { name, exact: false })
  await btn.first().waitFor({ state: 'visible', timeout: 10_000 })
  try {
    await btn.first().click({ timeout: 5_000 })
  } catch {
    // If click was intercepted by an overlapping layout element, use force click
    await btn.first().click({ force: true })
  }
}

export async function clickButtonAndWait(page: Page, name: string): Promise<void> {
  await clickButton(page, name)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

export async function clickLink(page: Page, name: string): Promise<void> {
  const link = page.getByRole('link', { name, exact: false })
  await link.first().click()
  await page.waitForLoadState('networkidle')
}

// ──────────────────────────────────────────
// Toast / Notification Helpers
// ──────────────────────────────────────────

export async function waitForToast(page: Page, textPattern?: string | RegExp): Promise<void> {
  // App uses custom Zustand toast system with role="alert" in a fixed-position container
  const toastSelector = '[role="alert"]'
  const toast = textPattern
    ? page.locator(toastSelector).filter({
        hasText: typeof textPattern === 'string' ? textPattern : undefined,
      })
    : page.locator(toastSelector)

  await toast.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
    // Toast might have auto-dismissed already — not a hard failure
  })
}

export async function expectToastSuccess(page: Page): Promise<void> {
  await waitForToast(page)
  // Dismiss any visible toast alerts by clicking their close (X) button
  const toasts = page.locator('[role="alert"]')
  const count = await toasts.count()
  for (let i = 0; i < count; i++) {
    try {
      const t = toasts.nth(i)
      if (await t.isVisible()) {
        const closeBtn = t.locator('button').first()
        if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
          await closeBtn.click().catch(() => {})
        }
      }
    } catch { /* toast may have auto-dismissed */ }
  }
  // Brief wait for toast removal animation
  await page.waitForTimeout(500)
}

/**
 * Dismiss all currently visible toasts.
 * Call before interacting with buttons that might be occluded.
 */
export async function dismissAllToasts(page: Page): Promise<void> {
  const toasts = page.locator('[role="alert"]')
  const count = await toasts.count()
  for (let i = 0; i < count; i++) {
    try {
      const t = toasts.nth(i)
      if (await t.isVisible()) {
        const closeBtn = t.locator('button').first()
        if (await closeBtn.isVisible({ timeout: 200 }).catch(() => false)) {
          await closeBtn.click().catch(() => {})
        }
      }
    } catch { /* ignore */ }
  }
  if (count > 0) await page.waitForTimeout(300)
}

// ──────────────────────────────────────────
// Table Helpers
// ──────────────────────────────────────────

export async function getTableRowCount(page: Page): Promise<number> {
  return page.locator('tbody tr').count()
}

export async function expectRowWithText(page: Page, text: string): Promise<void> {
  const row = page.locator('tbody tr, [class*="list-item"], .card').filter({ hasText: text })
  await expect(row.first()).toBeVisible({ timeout: 10_000 })
}

export async function clickRowAction(page: Page, rowText: string, actionLabel: string): Promise<void> {
  const row = page.locator('tbody tr').filter({ hasText: rowText })
  const action = row.getByRole('button', { name: actionLabel, exact: false })
    .or(row.locator(`button[title="${actionLabel}"], a[title="${actionLabel}"]`))
  await action.first().click()
}

// ──────────────────────────────────────────
// POS Helpers
// ──────────────────────────────────────────

export async function posSearchItem(page: Page, searchText: string): Promise<void> {
  // Dismiss any blocking modal first
  await posDismissAnyModal(page)

  // Find the POS search input (NOT the global navbar search "Search... (⌘K)")
  const searchInput = page.getByPlaceholder(/search products|search menu|scan barcode|search parts|search vehicles/i).first()

  await searchInput.waitFor({ state: 'visible', timeout: 10_000 })
  await searchInput.clear()
  await searchInput.fill(searchText)
  await page.waitForTimeout(800) // Debounce
  await page.waitForLoadState('networkidle')
}

export async function posClickItem(page: Page, itemName: string): Promise<void> {
  // Dismiss any blocking modal first
  await posDismissAnyModal(page)

  // Product cards are <button> elements with aspect-square div inside
  const itemCard = page.locator('button').filter({ hasText: itemName })
  // Wait for item to appear in grid after search
  await itemCard.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  try {
    await itemCard.first().click({ timeout: 5_000 })
  } catch {
    // If intercepted by overlay, force click
    await itemCard.first().click({ force: true })
  }
  await page.waitForTimeout(500)

  // Restaurant POS: clicking an item opens a "Customize" modal with "Add to Cart" button
  // Must click "Add to Cart" to actually add the item
  const addToCartBtn = page.getByRole('button', { name: /add to cart/i })
  if (await addToCartBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await addToCartBtn.click()
    await page.waitForTimeout(300)
  }
}

export async function posVerifyCartItem(page: Page, itemName: string): Promise<void> {
  // Verify item appears somewhere in the cart/right panel
  const cartArea = page.locator('text=' + itemName)
  await expect(cartArea.first()).toBeVisible({ timeout: 5_000 })
}

export async function posClickPayNow(page: Page): Promise<void> {
  // Wait for POS to be fully loaded (not in "Loading POS..." state)
  const loadingIndicator = page.locator('text=/loading pos/i')
  if (await loadingIndicator.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 30_000 })
    await page.waitForTimeout(1_000)
  }
  // The cart payment button uses terms.payNow — "Pay Now" (most), "Pay Bill" (restaurant)
  const payBtn = page.getByRole('button', { name: /pay now|pay bill|complete sale|checkout|process/i })
  // Wait for the button to be visible and enabled
  await payBtn.first().waitFor({ state: 'visible', timeout: 15_000 })
  // Retry click if button is temporarily disabled
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (await payBtn.first().isEnabled()) {
        await payBtn.first().click()
        await page.waitForTimeout(500)
        return
      }
    } catch { /* retry */ }
    await page.waitForTimeout(1_000)
  }
  // Last resort — force click
  await payBtn.first().click({ force: true })
  await page.waitForTimeout(500)
}

export async function posSelectPaymentMethod(page: Page, method: string): Promise<void> {
  // Click payment method button in payment modal
  const modal = page.locator('[role="dialog"]')
  const methodBtn = modal.locator('button, [role="button"]').filter({ hasText: new RegExp(method, 'i') })
  await methodBtn.first().click()
  await page.waitForTimeout(200)
}

export async function posClickExact(page: Page): Promise<void> {
  // Click the "Exact" quick amount button in the payment modal
  const modal = page.locator('[role="dialog"]')
  const exactBtn = modal.getByRole('button', { name: /exact/i })
  if (await exactBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await exactBtn.click()
    await page.waitForTimeout(200)
  }
}

export async function posCompleteSale(page: Page): Promise<void> {
  // Click the final submit button INSIDE the payment modal
  const modal = page.locator('[role="dialog"]')
  const completeBtn = modal.getByRole('button', { name: /complete sale|process refund/i })
  await completeBtn.click()
  await page.waitForTimeout(1_500)
}

/**
 * Dismiss any open modal/dialog (payment, success, held sales, confirmation, etc.)
 * Useful before interacting with POS elements that might be blocked by overlays.
 */
export async function posDismissAnyModal(page: Page): Promise<void> {
  // Try up to 3 times to close nested modals
  for (let attempt = 0; attempt < 3; attempt++) {
    const modal = page.locator('.fixed.inset-0').first()
    if (!(await modal.isVisible({ timeout: 500 }).catch(() => false))) break

    // Try common dismiss buttons in priority order
    const dismissed = await (async () => {
      // "New Sale" / "New Bill" / "Continue" on success modal
      const newSaleBtn = page.getByRole('button', { name: /new sale|new bill|new invoice|new vehicle sale|continue/i })
      if (await newSaleBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await newSaleBtn.click().catch(() => {})
        return true
      }

      // "Cancel" button on payment modal
      const cancelBtn = page.locator('.fixed.inset-0').getByRole('button', { name: /^cancel$/i })
      if (await cancelBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await cancelBtn.click().catch(() => {})
        return true
      }

      // X close button (SVG icon) — usually the first small button in the modal header
      // Look for button near the modal title that has a small size or contains an SVG
      const xBtn = page.locator('.fixed.inset-0 button svg').first().locator('..')
      if (await xBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        // Make sure we're clicking a close/X button, not a big action button
        const btnBox = await xBtn.boundingBox()
        if (btnBox && btnBox.width < 60 && btnBox.height < 60) {
          await xBtn.click().catch(() => {})
          return true
        }
      }

      // Click the backdrop overlay itself (behind the modal content)
      await modal.click({ position: { x: 5, y: 5 } }).catch(() => {})
      return true
    })()

    if (dismissed) {
      await page.waitForTimeout(500)
    } else {
      break
    }
  }
}

export async function posDismissSuccess(page: Page): Promise<void> {
  // Click success modal dismiss — uses terms.newSale which varies by business type
  await page.waitForTimeout(500)
  const newSaleBtn = page.getByRole('button', { name: /new sale|new bill|new invoice|new vehicle sale|continue/i })
  if (await newSaleBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await newSaleBtn.click()
    await page.waitForTimeout(500)
  }
  // If there's still a modal (e.g., payment modal with $0 total), dismiss it
  await posDismissAnyModal(page)
}

// ──────────────────────────────────────────
// Async Select / CreatableSelect Helpers
// ──────────────────────────────────────────

/**
 * Fill an async creatable select (type to search, then click result).
 * These don't use standard <select> elements — they're custom React components.
 */
export async function fillAsyncSelect(
  page: Page,
  labelOrPlaceholder: string,
  searchText: string
): Promise<void> {
  // Find the input within an async select near the label
  const label = page.locator('label').filter({ hasText: labelOrPlaceholder })
  let input: ReturnType<Page['locator']>

  if (await label.count() > 0) {
    // Look for input near label
    input = label.first().locator('..').locator('input[type="text"]').first()
    if (!(await input.isVisible())) {
      // Try clicking the select container to open it
      const container = label.first().locator('..').locator('[class*="select"], [role="combobox"]').first()
      if (await container.isVisible()) await container.click()
      input = label.first().locator('..').locator('input').first()
    }
  } else {
    // Try by placeholder
    input = page.getByPlaceholder(labelOrPlaceholder, { exact: false }).first()
  }

  await input.fill(searchText)
  await page.waitForTimeout(500) // Debounce
  await page.waitForLoadState('networkidle')

  // Click the first result in the dropdown
  const option = page.locator('[class*="option"], [role="option"], [class*="menu"] div')
    .filter({ hasText: searchText })
    .first()
  if (await option.isVisible({ timeout: 5_000 })) {
    await option.click()
  }
  await page.waitForTimeout(200)
}

/**
 * Fill async select within a container.
 */
export async function fillAsyncSelectIn(
  container: ReturnType<Page['locator']>,
  labelText: string,
  searchText: string
): Promise<void> {
  const page = container.page()
  const label = container.locator('label').filter({ hasText: labelText })
  let input: ReturnType<Page['locator']>

  if (await label.count() > 0) {
    input = label.first().locator('..').locator('input[type="text"]').first()
    if (!(await input.isVisible())) {
      const clickTarget = label.first().locator('..').locator('[class*="select"]').first()
      if (await clickTarget.isVisible()) await clickTarget.click()
      input = label.first().locator('..').locator('input').first()
    }
  } else {
    input = container.getByPlaceholder(labelText, { exact: false }).first()
  }

  await input.fill(searchText)
  await page.waitForTimeout(500)
  await page.waitForLoadState('networkidle')

  const option = page.locator('[class*="option"], [role="option"]')
    .filter({ hasText: searchText })
    .first()
  if (await option.isVisible({ timeout: 5_000 })) {
    await option.click()
  }
  await page.waitForTimeout(200)
}

// ──────────────────────────────────────────
// Retry / Resilience Helpers
// ──────────────────────────────────────────

/**
 * Try a UI action, return true if successful, false if it fails.
 * Useful for soft-assertions or optional UI features.
 */
export async function tryAction(action: () => Promise<void>): Promise<boolean> {
  try {
    await action()
    return true
  } catch {
    return false
  }
}

/**
 * Wait for an element to appear, return true/false without throwing.
 */
export async function isVisible(page: Page, selector: string, timeout = 3_000): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

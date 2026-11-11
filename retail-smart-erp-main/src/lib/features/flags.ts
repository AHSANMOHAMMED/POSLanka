/**
 * Platform / per-vendor feature switches (super admin → vendor → Features).
 * Stored on tenants.settings.featureFlags (jsonb). Missing keys fall back to the defaults below, so
 * existing vendors keep everything they had when a switch is added.
 *
 * Each switch names what it turns off:
 *  - hrefs:   pages (relative to /c/[slug]) hidden from the menus and the module workspaces
 *  - modules: whole top-level modules (navbar tabs)
 *  - api:     API path prefixes (or patterns) refused with 403 FEATURE_DISABLED by the proxy
 * The POS, the mobile app and a few routes read the switches directly (credit sales, loyalty,
 * gift cards, WhatsApp share, variants, batches, prescriptions …).
 *
 * Client-safe: no server imports.
 */

import { type BusinessScope, hasBusinessType, scopeTypes } from '@/lib/business-types/scope'

export const FEATURE_FLAGS = [
  // Sales & POS
  'credit_customer',
  'loyalty',
  'gift_cards',
  'promotions',
  'price_lists',
  'item_discounts',
  'quotation',
  'sales_orders',
  'layaways',
  'commissions',
  'customer_display',
  'cheques',
  'recurring_invoices',
  'projects',
  // Stock
  'multi_warehouse',
  'stock_takes',
  'variants',
  'batches_expiry',
  'serial_numbers',
  'weighing_scale',
  'barcode_labels',
  // Buying & finance
  'purchase',
  'accounting',
  'einvoice',
  'hr_payroll',
  'advanced_reports',
  // Industry
  'pharmacy',
  'appointments',
  'installments',
  'deliveries',
  'warranty_claims',
  'print_jobs',
  'service_jobs',
  'hr_attendance',
  // Communication & platform
  'whatsapp',
  'sms',
  'staff_chat',
  'api_access',
] as const

export type FeatureFlag = (typeof FEATURE_FLAGS)[number]
export type FeatureFlagsMap = Record<FeatureFlag, boolean>

export type FeatureGroup = 'Sales & POS' | 'Stock' | 'Buying & finance' | 'Industry' | 'Communication & platform'
export const FEATURE_GROUPS: FeatureGroup[] = ['Sales & POS', 'Stock', 'Buying & finance', 'Industry', 'Communication & platform']

export interface FeatureDef {
  key: FeatureFlag
  label: string
  description: string
  group: FeatureGroup
  default: boolean
  /** Business types the switch matters to (omitted = all) */
  businessTypes?: string[]
  hrefs?: string[]
  modules?: string[]
  /** '/api/x' = that path and everything under it; a RegExp for anything finer */
  api?: Array<string | RegExp>
  /** Like `api`, but only writes (POST / PUT / PATCH / DELETE) are refused: reads the POS or other
   * modules need while the switch is off (tax templates, modes of payment …) keep working */
  apiWrite?: Array<string | RegExp>
  /** What switching it off does beyond hiding pages / refusing the API (super admin → Features) */
  offEffect?: string
}

/**
 * Analysis reports under /accounting/reports/<x> (API /api/reports/<x>) that follow
 * advanced_reports. The basic ones stay with the switch off: daily-sales, sales-summary,
 * payment-collection, stock-balance, tax-report / vat-schedule (and /pos/daily-summary).
 */
const ADVANCED_REPORT_PAGES = [
  'sales-by-item', 'sales-by-customer', 'stock-movement', 'purchase-summary', 'purchase-by-supplier', 'item-profitability',
  'shrinkage-report', 'margin-analysis', 'expense-report', 'category-sales', 'item-velocity', 'service-revenue',
  'technician-performance', 'job-card-profitability', 'parts-usage', 'warranty-tracker', 'table-turnover',
  'menu-performance', 'food-cost-analysis', 'waste-analysis', 'peak-hours', 'vehicle-aging', 'sales-pipeline', 'saved',
]

export const FEATURE_DEFS: FeatureDef[] = [
  // ------------------------------------------------------------------ Sales & POS
  { key: 'credit_customer', group: 'Sales & POS', default: true, label: 'Credit sales (pay later)',
    description: 'Sell on credit to customers with a credit limit; “Credit” payment at the POS.',
    offEffect: 'The POS and the app refuse “Credit” payments.' },
  { key: 'loyalty', group: 'Sales & POS', default: true, label: 'Loyalty points',
    description: 'Earn and redeem points at the POS; loyalty programmes and tiers.',
    hrefs: ['/settings/loyalty'], api: ['/api/loyalty-programs', '/api/loyalty-transactions'],
    offEffect: 'Sales no longer earn points and points cannot be redeemed (balances are kept).' },
  { key: 'gift_cards', group: 'Sales & POS', default: true, label: 'Gift cards',
    description: 'Sell and redeem gift cards.',
    hrefs: ['/settings/gift-cards'], api: ['/api/gift-cards'],
    offEffect: 'Gift-card items cannot be sold and cards cannot pay at the POS.' },
  { key: 'promotions', group: 'Sales & POS', default: true, label: 'Promotions & coupons',
    description: 'Discount rules, buy-x-get-y, coupon codes applied at the POS.',
    hrefs: ['/promotions', '/accounting/reports/promotions'], api: ['/api/promotions', '/api/reports/promotions'],
    offEffect: 'Automatic promotions stop applying to sales and coupons are refused.' },
  { key: 'price_lists', group: 'Sales & POS', default: true, label: 'Price lists',
    description: 'Wholesale / customer-group prices.',
    hrefs: ['/price-lists'], api: ['/api/price-lists'],
    offEffect: 'Sales are priced at the catalog price; price lists stop applying.' },
  { key: 'item_discounts', group: 'Sales & POS', default: false, label: 'Per-item POS discounts',
    description: 'Cashiers can apply a percentage or fixed-amount discount on every item in the POS cart (with selling price, discount, and net price shown on the bill). Can also be turned off per counter (POS profile).',
    offEffect: 'The POS hides per-item discount controls and manual item-level discounts are refused at checkout.' },
  { key: 'quotation', group: 'Sales & POS', default: true, label: 'Quotations',
    description: 'Quotations that convert to sales orders or invoices.',
    hrefs: ['/quotations'], api: ['/api/quotations'] },
  { key: 'sales_orders', group: 'Sales & POS', default: true, label: 'Sales orders',
    description: 'Orders taken now, invoiced on delivery.',
    hrefs: ['/sales-orders'], api: ['/api/sales-orders'] },
  { key: 'layaways', group: 'Sales & POS', default: true, label: 'Layaways',
    description: 'Hold goods on part payment until paid in full.',
    hrefs: ['/layaways'], api: ['/api/layaways'] },
  { key: 'commissions', group: 'Sales & POS', default: true, label: 'Sales commissions',
    description: 'Commission rates and payouts for staff.',
    hrefs: ['/settings/commissions'], api: ['/api/commissions', '/api/commission-rates', '/api/commission-payouts'] },
  { key: 'customer_display', group: 'Sales & POS', default: true, label: 'Customer display (second screen)',
    description: 'A customer-facing screen opened from the POS (Alt+D): live cart, totals, change due and a thank-you screen. Can also be turned off per counter (POS profile).',
    businessTypes: ['retail', 'supermarket', 'pharmacy', 'restaurant'], hrefs: ['/pos/display'] },
  { key: 'cheques', group: 'Sales & POS', default: true, label: 'Cheques',
    description: 'Take and issue cheques (post-dated too): cheque payments at the POS, against credit and to suppliers; cheques register with deposit / clear / bounce and due reminders.',
    hrefs: ['/accounting/cheques'], api: ['/api/cheques'] },
  { key: 'recurring_invoices', group: 'Sales & POS', default: true, label: 'Recurring invoices',
    description: 'Invoice profiles that raise an invoice for a customer every week / month / N months / year (draft or on account), with run history.',
    hrefs: ['/recurring-invoices'], api: ['/api/recurring-invoices'] },
  { key: 'projects', group: 'Sales & POS', default: true, label: 'Projects & time tracking',
    description: 'Client projects with tasks, staff rates, timesheets and a running timer; bill unbilled hours or a fixed price as an invoice.',
    hrefs: ['/projects'], api: ['/api/projects', '/api/time-entries'] },

  // ------------------------------------------------------------------ Stock
  { key: 'multi_warehouse', group: 'Stock', default: false, label: 'Multiple branches / warehouses',
    description: 'Transfers between branches and per-branch stock.',
    hrefs: ['/stock-transfers'], api: ['/api/stock-transfers'],
    offEffect: 'A single-branch business cannot add a second branch / warehouse (existing branches keep working).' },
  { key: 'stock_takes', group: 'Stock', default: true, label: 'Stock takes',
    description: 'Count stock and post the differences.',
    hrefs: ['/stock-takes'], api: ['/api/stock-takes'] },
  { key: 'variants', group: 'Stock', default: true, label: 'Size / colour variants',
    description: 'One product in many sizes and colours (clothing, footwear, bags), each with its own barcode and stock.',
    api: [/^\/api\/items\/[^/]+\/variants(\/|$)/] },
  { key: 'batches_expiry', group: 'Stock', default: true, label: 'Batches & expiry dates',
    description: 'Batch numbers and expiry dates; first-expiring stock sold first, expired stock blocked.',
    api: ['/api/item-batches', /^\/api\/items\/[^/]+\/batches(\/|$)/] },
  { key: 'serial_numbers', group: 'Stock', default: true, label: 'Serial numbers',
    description: 'Track each unit by serial number (electronics, phones).',
    hrefs: ['/serial-numbers'], api: ['/api/serial-numbers', /^\/api\/items\/[^/]+\/serial-numbers(\/|$)/] },
  { key: 'weighing_scale', group: 'Stock', default: true, label: 'Weighing scale & loose items',
    description: 'Sell by weight; scale barcodes with weight or price.', businessTypes: ['retail', 'supermarket', 'pharmacy', 'hardware'],
    offEffect: 'Scale labels are no longer read (weight / price in the barcode) on the web POS and the app.' },
  { key: 'barcode_labels', group: 'Stock', default: true, label: 'Barcode & shelf labels',
    description: 'Design and print barcode labels.',
    hrefs: ['/barcode'], modules: ['barcode'], api: ['/api/label-templates', '/api/label-settings'] },

  // ------------------------------------------------------------------ Buying & finance
  { key: 'purchase', group: 'Buying & finance', default: true, label: 'Purchasing',
    description: 'Purchase requisitions, supplier quotations, purchase orders, landed costs.',
    modules: ['buying'], hrefs: ['/buying', '/purchase-requisitions', '/supplier-quotations', '/purchase-orders', '/purchases/landed-costs'],
    api: ['/api/purchase-orders', '/api/purchase-requisitions', '/api/supplier-quotations', '/api/landed-cost-vouchers'] },
  { key: 'accounting', group: 'Buying & finance', default: true, label: 'Accounting',
    description: 'Chart of accounts, journals, bank, payments, budgets, financial statements.',
    modules: ['accounting'],
    hrefs: ['/accounting/chart-of-accounts', '/accounting/fiscal-years', '/accounting/cost-centers', '/accounting/payment-entries',
      '/accounting/payment-reconciliation', '/accounting/payment-requests', '/accounting/dunning', '/accounting/journal-entries',
      '/accounting/recurring-entries', '/accounting/general-ledger', '/accounting/bank-accounts', '/accounting/budgets',
      '/accounting/reports/trial-balance', '/accounting/reports/profit-and-loss', '/accounting/reports/balance-sheet',
      '/accounting/reports/cash-flow', '/accounting/reports/general-ledger',
      '/accounting/opening-balances', '/accounting/period-closing', '/accounting/audit', '/accounting/settings',
      '/accounting/tax-templates', '/accounting/modes-of-payment', '/accounting/payment-terms', '/accounting/dunning-types',
      '/accounting/reports/accounts-receivable', '/accounting/reports/accounts-payable', '/accounting/reports/day-book'],
    // The POS, items, quotations and the app read tax templates, modes of payment, payment terms
    // and the accounting settings (default tax): only changing them is refused.
    apiWrite: ['/api/accounting/tax-templates', '/api/accounting/modes-of-payment', '/api/accounting/payment-terms',
      '/api/accounting/payment-terms-templates', '/api/accounting/settings'],
    offEffect: 'Sales and purchases still post to the books in the background, so turning it back on loses nothing.',
    api: ['/api/accounting/audit', '/api/accounting/setup', '/api/accounting/reports/accounts-receivable',
      '/api/accounting/reports/accounts-payable', '/api/reports/day-book', '/api/reports/general-ledger',
      '/api/accounting/accounts', '/api/accounting/bank-accounts', '/api/accounting/budgets', '/api/accounting/cost-centers',
      '/api/accounting/dunning-types', '/api/accounting/dunnings', '/api/accounting/fiscal-years', '/api/accounting/gl-entries',
      '/api/accounting/journal-entries', '/api/accounting/opening-balances', '/api/accounting/payment-entries',
      '/api/accounting/payment-reconciliation', '/api/accounting/payment-requests', '/api/accounting/period-closing',
      '/api/accounting/recurring-entries', '/api/accounting/reports/profit-and-loss', '/api/accounting/reports/balance-sheet',
      '/api/accounting/reports/trial-balance', '/api/accounting/reports/cash-flow', '/api/accounting/reports/general-ledger'] },
  { key: 'einvoice', group: 'Buying & finance', default: true, label: 'E-invoicing (IRD)',
    description: 'Send invoices to the tax authority.',
    hrefs: ['/accounting/e-invoicing'], api: ['/api/einvoice'] },
  { key: 'hr_payroll', group: 'Buying & finance', default: true, label: 'HR & payroll',
    description: 'Employees, salary structures, payroll runs, advances.',
    // Employees (/hr/employees, /api/employee-profiles) are shared with attendance: SHARED_FEATURE_RULES
    modules: ['hr'], hrefs: ['/hr'],
    api: ['/api/employee-advances', '/api/salary-components', '/api/salary-structures', '/api/salary-slips', '/api/payroll-runs',
      '/api/hr/salary-components'] },
  { key: 'advanced_reports', group: 'Buying & finance', default: true, label: 'Advanced reports',
    description: 'The Reports module and analysis reports (by item / customer, margins, stock movement, purchases, industry reports). Daily sales, sales summary, payment collection, stock balance and tax reports stay.',
    modules: ['reports'], hrefs: ['/reports', ...ADVANCED_REPORT_PAGES.map((r) => `/accounting/reports/${r}`)],
    api: ['/api/reports/aged-payables', '/api/reports/supplier-performance', '/api/reports/adjustments-by-reason',
      '/api/reports/inventory-valuation-reconciliation', '/api/reports/staff-performance',
      ...ADVANCED_REPORT_PAGES.map((r) => `/api/reports/${r}`)] },

  // ------------------------------------------------------------------ Industry
  { key: 'pharmacy', group: 'Industry', default: true, label: 'Pharmacy (prescriptions & drug register)',
    description: 'Generic names, drug schedules, prescription capture at the POS, prescription register, expiry report.',
    businessTypes: ['pharmacy'], hrefs: ['/pharmacy'], api: ['/api/prescriptions', '/api/pharmacy'] },
  { key: 'appointments', group: 'Industry', default: true, label: 'Appointments',
    description: 'Book customers in for service.', businessTypes: ['auto_service', 'dealership'],
    hrefs: ['/appointments'], api: ['/api/appointments'] },
  { key: 'installments', group: 'Industry', default: true, label: 'Hire purchase / installments',
    description: 'Installment plans on a sale: down payment, interest, monthly or weekly schedule, guarantor, receipts, late fees, overdue list, early settlement.',
    businessTypes: ['electronics', 'hardware', 'retail'], hrefs: ['/installments'], api: ['/api/installments'] },
  { key: 'deliveries', group: 'Industry', default: true, label: 'Deliveries & installation',
    description: 'Schedule delivery (and installation) of sold goods: date and slot, vehicle, driver, technician, proof of delivery, delivery notes.',
    businessTypes: ['electronics', 'hardware', 'retail', 'supermarket'], hrefs: ['/deliveries'], api: ['/api/deliveries'] },
  { key: 'warranty_claims', group: 'Industry', default: true, label: 'Warranty claims & service',
    description: 'Look up a unit by serial / IMEI, invoice or phone, check warranty, log repairs and replacements, print job sheets.',
    businessTypes: ['electronics', 'retail', 'hardware'], hrefs: ['/warranty-claims'], api: ['/api/warranty-claims'] },
  { key: 'print_jobs', group: 'Industry', default: true, label: 'Print & photo job orders',
    description: 'Job orders by size and quantity with advance payments, due dates and ready-for-pickup tracking.',
    businessTypes: ['print_studio'], hrefs: ['/print-jobs'], api: ['/api/print-jobs'] },
  { key: 'service_jobs', group: 'Industry', default: true, label: 'Service jobs (repairs, tailoring, tickets)',
    description: 'Job cards: repair jobs (device, serial / IMEI, fault, warranty check), tailoring & alteration orders (measurements, fitting date) or service tickets; estimate, advance, parts & labour, status flow, ready SMS, convert to invoice, job card print.',
    businessTypes: ['electronics', 'textile', 'office', 'retail', 'hardware'], hrefs: ['/service-jobs'], api: ['/api/service-jobs'] },
  { key: 'hr_attendance', group: 'Industry', default: true, label: 'Attendance, shifts & leave',
    description: 'Staff attendance (fingerprint devices or manual), work shifts, leave and holidays.',
    modules: ['hr'], hrefs: ['/hr/attendance', '/hr/shifts', '/hr/attendance-devices', '/hr/leave', '/hr/holidays'],
    api: ['/api/hr/attendance', '/api/hr/attendance-devices', '/api/hr/shifts', '/api/hr/shift-assignments', '/api/hr/holidays',
      '/api/hr/leave-types', '/api/hr/leave-requests', '/api/hr/leave-balances', '/api/hr/settings'],
    offEffect: 'Fingerprint devices are refused (they keep their punches and re-send them once it is back on).' },

  // ------------------------------------------------------------------ Communication & platform
  // Both also gate the paid messaging add-on (src/lib/messaging): sending refuses while the switch is
  // off, and turning a channel on in the vendor's messaging plan turns its switch on.
  { key: 'whatsapp', group: 'Communication & platform', default: true, label: 'WhatsApp',
    description: 'Share receipts, invoices and quotations on WhatsApp; WhatsApp messages from the business number when the messaging plan includes WhatsApp.' },
  { key: 'sms', group: 'Communication & platform', default: true, label: 'SMS',
    description: 'SMS to customers (own gateway in Settings → SMS, or the platform’s SMS plan).', api: ['/api/sms-settings', '/api/sms-log'] },
  { key: 'staff_chat', group: 'Communication & platform', default: true, label: 'Staff chat',
    description: 'Messages between staff.', hrefs: ['/chat'], api: ['/api/chat'] },
  { key: 'api_access', group: 'Communication & platform', default: true, label: 'API keys & integrations',
    description: 'API keys for other systems (/api/v1).', hrefs: ['/settings/api-keys'], api: ['/api/settings/api-keys', '/api/v1'] },
]

const DEF_BY_KEY = new Map(FEATURE_DEFS.map((d) => [d.key, d]))

export const FEATURE_FLAG_LABELS = Object.fromEntries(FEATURE_DEFS.map((d) => [d.key, d.label])) as Record<FeatureFlag, string>

/** Default switches for new vendors and for keys a vendor has never saved */
export const DEFAULT_VENDOR_FEATURE_FLAGS = Object.fromEntries(FEATURE_DEFS.map((d) => [d.key, d.default])) as FeatureFlagsMap

/**
 * Switches a new vendor of each business type starts with, on top of the defaults (the super
 * admin can still change any of them later). Only differences from the defaults are listed.
 */
export const BUSINESS_TYPE_FEATURE_PRESETS: Record<string, Partial<FeatureFlagsMap>> = {
  retail: { print_jobs: false },
  supermarket: { installments: false, warranty_claims: false, print_jobs: false, service_jobs: false },
  pharmacy: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, service_jobs: false, variants: false },
  restaurant: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, service_jobs: false, serial_numbers: false, weighing_scale: false, layaways: false },
  auto_service: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, service_jobs: false, weighing_scale: false },
  dealership: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, service_jobs: false, weighing_scale: false },
  // Big-ticket appliance / phone shops: hire purchase, delivery & installation, serial / IMEI warranty
  electronics: {
    installments: true, deliveries: true, warranty_claims: true, serial_numbers: true, service_jobs: true,
    weighing_scale: false, batches_expiry: false, print_jobs: false,
  },
  // Hardware: loose goods by weight / length, credit customers, site deliveries
  hardware: {
    installments: true, deliveries: true, warranty_claims: true, weighing_scale: true, credit_customer: true,
    batches_expiry: false, print_jobs: false,
  },
  print_studio: {
    print_jobs: true, installments: false, deliveries: false, warranty_claims: false, service_jobs: false,
    weighing_scale: false, batches_expiry: false, serial_numbers: false, layaways: false,
  },
  // Offices: staff, attendance, payroll and billing; no counter-retail extras
  office: {
    hr_payroll: true, hr_attendance: true, service_jobs: true,
    installments: false, deliveries: false, warranty_claims: false, print_jobs: false,
    weighing_scale: false, batches_expiry: false, serial_numbers: false, variants: false, layaways: false,
    customer_display: false, loyalty: false, gift_cards: false, promotions: false, barcode_labels: false,
  },
  // Textile & clothing: size / colour variants, fabric by the metre, tailoring & alteration orders
  textile: {
    variants: true, barcode_labels: true, service_jobs: true, layaways: true,
    installments: false, deliveries: false, warranty_claims: false, print_jobs: false,
    weighing_scale: false, batches_expiry: false, serial_numbers: false,
  },
}

/** Per business type: switches the super admin changed for NEW vendors (on top of the code preset). */
export type TypePresetOverrides = Record<string, Partial<FeatureFlagsMap>>

/** The code preset with the saved overrides applied — what `typeDefaults` should show. */
export function mergedTypePresets(overrides?: TypePresetOverrides | null): Record<string, Partial<FeatureFlagsMap>> {
  const out: Record<string, Partial<FeatureFlagsMap>> = {}
  for (const [type, preset] of Object.entries(BUSINESS_TYPE_FEATURE_PRESETS)) out[type] = { ...preset }
  for (const [type, o] of Object.entries(overrides || {})) out[type] = { ...(out[type] || {}), ...o }
  return out
}

/**
 * The switches a new vendor of this business type starts with (defaults + the type's preset).
 * A mall runs several types: a switch starts off only when it is off for ALL of its segments.
 */
export function defaultFeatureFlagsForBusinessType(
  scope: BusinessScope,
  /** Super-admin edits of the presets (system_settings, see src/lib/admin/business-type-features.ts) */
  overrides?: TypePresetOverrides | null,
): FeatureFlagsMap {
  const types = scopeTypes(scope)
  if (types.length <= 1) {
    const businessType = types[0]
    return {
      ...DEFAULT_VENDOR_FEATURE_FLAGS,
      ...((businessType && BUSINESS_TYPE_FEATURE_PRESETS[businessType]) || {}),
      ...((businessType && overrides?.[businessType]) || {}),
    }
  }
  const presets = types.map((t) => defaultFeatureFlagsForBusinessType(t, overrides))
  return Object.fromEntries(FEATURE_FLAGS.map((k) => [k, presets.some((p) => p[k])])) as FeatureFlagsMap
}

export function getFeatureDef(flag: FeatureFlag): FeatureDef | undefined {
  return DEF_BY_KEY.get(flag)
}

/** Does this switch matter to this type of business (a mall: to any of its segments)? */
export function featureAppliesTo(flag: FeatureFlag, scope: BusinessScope): boolean {
  const types = DEF_BY_KEY.get(flag)?.businessTypes
  return !types || scopeTypes(scope).length === 0 || hasBusinessType(scope, types)
}

export function normalizeFeatureFlags(input?: Partial<Record<string, boolean>> | null): FeatureFlagsMap {
  const result = { ...DEFAULT_VENDOR_FEATURE_FLAGS }
  if (!input) return result
  for (const key of FEATURE_FLAGS) {
    if (typeof input[key] === 'boolean') result[key] = input[key]!
  }
  return result
}

export function isFeatureEnabled(flags: Partial<FeatureFlagsMap> | null | undefined, flag: FeatureFlag): boolean {
  return normalizeFeatureFlags(flags)[flag]
}

/**
 * Switches that only exist for their business types (featureAppliesTo): for any other type they
 * count as off everywhere (menus, pages, API), the same way the POS already treats the industry
 * modules. Not for customer_display / weighing_scale: the POS offers those to every type when on.
 */
const TYPE_SCOPE_EXEMPT: ReadonlySet<string> = new Set(['customer_display', 'weighing_scale'])
export function isTypeScopedFeature(flag: FeatureFlag): boolean {
  return !!DEF_BY_KEY.get(flag)?.businessTypes && !TYPE_SCOPE_EXEMPT.has(flag)
}

/**
 * What the business really gets: the saved switches (missing keys = the global default) with
 * type-scoped industry switches turned off for business types they are not meant for.
 */
export function effectiveFeatureFlags(
  input: Partial<Record<string, boolean>> | null | undefined,
  scope: BusinessScope,
): FeatureFlagsMap {
  const flags = normalizeFeatureFlags(input)
  if (scopeTypes(scope).length === 0) return flags
  for (const key of FEATURE_FLAGS) {
    if (flags[key] && isTypeScopedFeature(key) && !featureAppliesTo(key, scope)) flags[key] = false
  }
  return flags
}

/**
 * Pages / APIs that belong to more than one switch: refused only while ALL of them are off.
 * The attendance pages pick employees from the employee list, so employees stay while either HR
 * switch is on.
 */
export const SHARED_FEATURE_RULES: Array<{ flags: FeatureFlag[]; hrefs?: string[]; api?: Array<string | RegExp> }> = [
  { flags: ['hr_payroll', 'hr_attendance'], hrefs: ['/hr/employees'], api: ['/api/employee-profiles'] },
]

function apiMatches(rule: string | RegExp, path: string): boolean {
  return typeof rule === 'string' ? path === rule || path.startsWith(`${rule}/`) : rule.test(path)
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The switches that guard an API path (used by the proxy): the request is refused when every one
 * of them is off. Empty = not switchable. `method` matters for `apiWrite` rules (default GET).
 */
export function featuresForApiPath(path: string, method = 'GET'): FeatureFlag[] {
  if (!path.startsWith('/api/') || path.startsWith('/api/sys-control/') || path.startsWith('/api/features')) return []
  for (const r of SHARED_FEATURE_RULES) {
    if (r.api?.some((a) => apiMatches(a, path))) return [...r.flags]
  }
  const write = !READ_METHODS.has(method.toUpperCase())
  for (const d of FEATURE_DEFS) {
    if (d.api?.some((r) => apiMatches(r, path))) return [d.key]
    if (write && d.apiWrite?.some((r) => apiMatches(r, path))) return [d.key]
  }
  return []
}

/** The (first) switch that guards an API path, if any */
export function featureForApiPath(path: string, method = 'GET'): FeatureFlag | null {
  return featuresForApiPath(path, method)[0] ?? null
}

/** The switches that hide a page (relative href, query ignored): hidden when all are off. The
 * most specific href wins, so /hr/attendance follows hr_attendance while the rest of /hr follows
 * hr_payroll. */
export function featuresForHref(href: string): FeatureFlag[] {
  const path = href.split('?')[0]
  let best: { keys: FeatureFlag[]; len: number } | null = null
  const consider = (h: string, keys: FeatureFlag[]) => {
    if ((path === h || path.startsWith(`${h}/`)) && (!best || h.length > best.len)) best = { keys, len: h.length }
  }
  for (const r of SHARED_FEATURE_RULES) for (const h of r.hrefs || []) consider(h, r.flags)
  for (const d of FEATURE_DEFS) for (const h of d.hrefs || []) consider(h, [d.key])
  return best ? [...(best as { keys: FeatureFlag[] }).keys] : []
}

/** The (first) switch that hides a page, if any */
export function featureForHref(href: string): FeatureFlag | null {
  return featuresForHref(href)[0] ?? null
}

/** The switches that own a whole module (navbar tab): hidden when all are off */
export function featuresForModule(moduleKey: string): FeatureFlag[] {
  return FEATURE_DEFS.filter((d) => d.modules?.includes(moduleKey)).map((d) => d.key)
}

/** The (first) switch that owns a whole module, if any */
export function featureForModule(moduleKey: string): FeatureFlag | null {
  return featuresForModule(moduleKey)[0] ?? null
}

/** Any of these switches on (no switches = not switchable, so allowed) */
export function anyFeatureEnabled(flags: Partial<FeatureFlagsMap> | null | undefined, keys: FeatureFlag[]): boolean {
  if (keys.length === 0) return true
  const all = normalizeFeatureFlags(flags)
  return keys.some((k) => all[k])
}

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

export const FEATURE_FLAGS = [
  // Sales & POS
  'credit_customer',
  'loyalty',
  'gift_cards',
  'promotions',
  'price_lists',
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
}

export const FEATURE_DEFS: FeatureDef[] = [
  // ------------------------------------------------------------------ Sales & POS
  { key: 'credit_customer', group: 'Sales & POS', default: true, label: 'Credit sales (pay later)',
    description: 'Sell on credit to customers with a credit limit; “Credit” payment at the POS.' },
  { key: 'loyalty', group: 'Sales & POS', default: true, label: 'Loyalty points',
    description: 'Earn and redeem points at the POS; loyalty programmes and tiers.',
    hrefs: ['/settings/loyalty'], api: ['/api/loyalty-programs', '/api/loyalty-transactions'] },
  { key: 'gift_cards', group: 'Sales & POS', default: true, label: 'Gift cards',
    description: 'Sell and redeem gift cards.',
    hrefs: ['/settings/gift-cards'], api: ['/api/gift-cards'] },
  { key: 'promotions', group: 'Sales & POS', default: true, label: 'Promotions & coupons',
    description: 'Discount rules, buy-x-get-y, coupon codes applied at the POS.',
    hrefs: ['/promotions', '/accounting/reports/promotions'], api: ['/api/promotions'] },
  { key: 'price_lists', group: 'Sales & POS', default: true, label: 'Price lists',
    description: 'Wholesale / customer-group prices.',
    hrefs: ['/price-lists'], api: ['/api/price-lists'] },
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
    hrefs: ['/stock-transfers'], api: ['/api/stock-transfers'] },
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
    description: 'Sell by weight; scale barcodes with weight or price.', businessTypes: ['retail', 'supermarket', 'pharmacy'] },
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
      '/accounting/reports/cash-flow', '/accounting/reports/general-ledger'],
    api: ['/api/accounting/accounts', '/api/accounting/bank-accounts', '/api/accounting/budgets', '/api/accounting/cost-centers',
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
    modules: ['hr'], hrefs: ['/hr'],
    api: ['/api/employee-profiles', '/api/employee-advances', '/api/salary-components', '/api/salary-structures', '/api/salary-slips', '/api/payroll-runs'] },
  { key: 'advanced_reports', group: 'Buying & finance', default: true, label: 'Advanced reports',
    description: 'The Reports module (analysis beyond the daily summary).', modules: ['reports'], hrefs: ['/reports'] },

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
  { key: 'hr_attendance', group: 'Industry', default: true, label: 'Attendance, shifts & leave',
    description: 'Staff attendance (fingerprint devices or manual), work shifts, leave and holidays.',
    hrefs: ['/hr/attendance', '/hr/shifts', '/hr/attendance-devices', '/hr/leave', '/hr/holidays'],
    api: ['/api/hr/attendance', '/api/hr/attendance-devices', '/api/hr/shifts', '/api/hr/shift-assignments', '/api/hr/holidays',
      '/api/hr/leave-types', '/api/hr/leave-requests', '/api/hr/leave-balances'] },

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
  supermarket: { installments: false, warranty_claims: false, print_jobs: false },
  pharmacy: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, variants: false },
  restaurant: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, serial_numbers: false, weighing_scale: false, layaways: false },
  auto_service: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, weighing_scale: false },
  dealership: { installments: false, deliveries: false, warranty_claims: false, print_jobs: false, weighing_scale: false },
  // Big-ticket appliance / phone shops: hire purchase, delivery & installation, serial / IMEI warranty
  electronics: {
    installments: true, deliveries: true, warranty_claims: true, serial_numbers: true,
    weighing_scale: false, batches_expiry: false, print_jobs: false,
  },
  // Hardware: loose goods by weight / length, credit customers, site deliveries
  hardware: {
    installments: true, deliveries: true, warranty_claims: true, weighing_scale: true, credit_customer: true,
    batches_expiry: false, print_jobs: false,
  },
  print_studio: {
    print_jobs: true, installments: false, deliveries: false, warranty_claims: false,
    weighing_scale: false, batches_expiry: false, serial_numbers: false, layaways: false,
  },
  // Offices: staff, attendance, payroll and billing; no counter-retail extras
  office: {
    hr_payroll: true, hr_attendance: true,
    installments: false, deliveries: false, warranty_claims: false, print_jobs: false,
    weighing_scale: false, batches_expiry: false, serial_numbers: false, variants: false, layaways: false,
    customer_display: false, loyalty: false, gift_cards: false, promotions: false, barcode_labels: false,
  },
}

/** The switches a new vendor of this business type starts with (defaults + the type's preset). */
export function defaultFeatureFlagsForBusinessType(businessType: string | null | undefined): FeatureFlagsMap {
  return { ...DEFAULT_VENDOR_FEATURE_FLAGS, ...((businessType && BUSINESS_TYPE_FEATURE_PRESETS[businessType]) || {}) }
}

export function getFeatureDef(flag: FeatureFlag): FeatureDef | undefined {
  return DEF_BY_KEY.get(flag)
}

/** Does this switch matter to this type of business? */
export function featureAppliesTo(flag: FeatureFlag, businessType: string | null | undefined): boolean {
  const types = DEF_BY_KEY.get(flag)?.businessTypes
  return !types || !businessType || types.includes(businessType)
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

function apiMatches(rule: string | RegExp, path: string): boolean {
  return typeof rule === 'string' ? path === rule || path.startsWith(`${rule}/`) : rule.test(path)
}

/** The switch that guards an API path, if any (used by the proxy) */
export function featureForApiPath(path: string): FeatureFlag | null {
  if (!path.startsWith('/api/') || path.startsWith('/api/sys-control/') || path.startsWith('/api/features')) return null
  for (const d of FEATURE_DEFS) {
    if (d.api?.some((r) => apiMatches(r, path))) return d.key
  }
  return null
}

/** The switch that hides a page (relative href, query ignored), if any. The most specific href
 * wins, so /hr/attendance follows hr_attendance while the rest of /hr follows hr_payroll. */
export function featureForHref(href: string): FeatureFlag | null {
  const path = href.split('?')[0]
  let best: { key: FeatureFlag; len: number } | null = null
  for (const d of FEATURE_DEFS) {
    for (const h of d.hrefs || []) {
      if ((path === h || path.startsWith(`${h}/`)) && (!best || h.length > best.len)) best = { key: d.key, len: h.length }
    }
  }
  return best?.key ?? null
}

/** The switch that hides a whole module (navbar tab), if any */
export function featureForModule(moduleKey: string): FeatureFlag | null {
  return FEATURE_DEFS.find((d) => d.modules?.includes(moduleKey))?.key ?? null
}

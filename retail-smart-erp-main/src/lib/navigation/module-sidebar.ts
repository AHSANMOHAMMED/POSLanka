// Module sidebar configuration for ERPNext-style navigation
// Defines sidebar links per module, with route-to-module mapping
import { getTerms } from '@/lib/terminology'
import { hasPermission, type Permission } from '@/lib/auth/roles'

/**
 * Returns true if the business type supports service center operations
 * (work orders, appointments, service types, vehicles, insurance estimates).
 */
export function isServiceCapable(businessType?: string): boolean {
  return businessType === 'auto_service' || businessType === 'dealership'
}

/** Shops selling goods over a counter: retail (clothing, footwear, bags, stationery, fancy …),
 * supermarket and pharmacy share the store features (departments, scales, velocity, expiry). */
export function isStoreBusiness(businessType?: string | null): boolean {
  return businessType === 'retail' || businessType === 'supermarket' || businessType === 'pharmacy'
}

export interface SidebarItem {
  href: string
  label: string
  icon: string
  autoServiceOnly?: boolean
  /** Store-type businesses: retail, supermarket, pharmacy (departments, zones, velocity …) */
  supermarketOnly?: boolean
  pharmacyOnly?: boolean
  restaurantOnly?: boolean
  dealershipOnly?: boolean
  permission?: Permission
}

export interface SidebarSection {
  title: string
  items: SidebarItem[]
}

// Top-level module tabs shown in the navbar
export interface ModuleTab {
  key: string
  label: string
  href: string // relative to /c/[slug]
  icon: string
  autoServiceOnly?: boolean
  restaurantOnly?: boolean
  dealershipOnly?: boolean
  permission?: Permission
  /**
   * Users lacking `permission` still see the tab when they hold one of these
   * (e.g. cashiers with submitStockIntake reach Stock → Stock Intake). Such users
   * land on `limitedHref` instead of the module workspace.
   */
  altPermissions?: Permission[]
  limitedHref?: string
}

export const MODULE_TABS: ModuleTab[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard', permission: 'viewReports' },
  { key: 'stock', label: 'Stock', href: '/stock', icon: 'Package', permission: 'manageItems', altPermissions: ['submitStockIntake'], limitedHref: '/inventory/stock-intake' },
  { key: 'selling', label: 'Selling', href: '/selling', icon: 'ShoppingCart' },
  { key: 'barcode', label: 'Barcode & Labels', href: '/barcode', icon: 'Barcode', permission: 'manageItems' },
  { key: 'buying', label: 'Buying', href: '/buying', icon: 'Truck', permission: 'managePurchases' },
  { key: 'auto-service', label: 'Auto Service', href: '/auto-service', icon: 'Wrench', autoServiceOnly: true, permission: 'manageWorkOrders' },
  { key: 'dealership', label: 'Dealership', href: '/dealership', icon: 'Car', dealershipOnly: true, permission: 'manageSales' },
  { key: 'restaurant', label: 'Restaurant', href: '/restaurant', icon: 'UtensilsCrossed', restaurantOnly: true, permission: 'manageSales' },
  { key: 'hr', label: 'HR', href: '/hr', icon: 'Users', permission: 'manageEmployees' },
  { key: 'accounting', label: 'Accounting', href: '/accounting', icon: 'BookOpen', permission: 'manageAccounting' },
  { key: 'reports', label: 'Reports', href: '/reports', icon: 'BarChart3', permission: 'viewReports' },
  { key: 'my', label: 'My Portal', href: '/my', icon: 'User', permission: 'viewOwnPaySlips' },
  // Staff managers (manageUsers / manageRoles without manageSettings) still reach Settings → Staff
  { key: 'settings', label: 'Settings', href: '/settings', icon: 'Settings', permission: 'manageSettings', altPermissions: ['manageUsers', 'manageRoles'], limitedHref: '/settings/staff' },
]

// Route-to-module mapping: which module does each route belong to?
// Order matters - first match wins, so put more specific routes first
const ROUTE_MODULE_MAP: [string, string][] = [
  // Dashboard
  ['/dashboard', 'dashboard'],

  // Stock
  ['/stock/temperature-zones', 'stock'],
  ['/stock/departments', 'stock'],
  ['/stock', 'stock'],
  ['/items', 'stock'],
  ['/categories', 'stock'],
  ['/units', 'stock'],
  ['/stock-transfers', 'stock'],
  ['/stock-takes', 'stock'],
  ['/inventory/stock-intake', 'stock'],
  ['/serial-numbers', 'stock'],
  ['/stock-movements', 'stock'],

  // Selling
  ['/selling', 'selling'],
  ['/pos/daily-summary', 'selling'],
  ['/pos', 'selling'],
  ['/sales-orders', 'selling'],
  ['/sales', 'selling'],
  ['/quotations', 'selling'],
  ['/credit-notes', 'selling'],
  ['/debit-notes', 'selling'],
  ['/customers', 'selling'],
  ['/price-lists', 'selling'],
  ['/promotions', 'selling'],
  ['/layaways', 'selling'],
  ['/pharmacy/prescriptions', 'selling'],
  ['/pharmacy/expiry', 'stock'],

  // Barcode & Labels
  ['/barcode/print', 'barcode'],
  ['/barcode/label-templates', 'barcode'],
  ['/barcode/settings', 'barcode'],
  ['/barcode', 'barcode'],

  // Buying
  ['/buying', 'buying'],
  ['/suppliers', 'buying'],
  ['/purchase-requisitions', 'buying'],
  ['/supplier-quotations', 'buying'],
  ['/purchase-orders', 'buying'],
  ['/purchases', 'buying'],
  ['/buying/grn', 'buying'],
  ['/reports/aged-payables', 'buying'],
  ['/reports/supplier-performance', 'buying'],
  ['/reports/adjustments-by-reason', 'stock'],
  ['/reports/inventory-valuation', 'stock'],

  // Auto Service
  ['/auto-service', 'auto-service'],
  ['/work-orders', 'auto-service'],
  ['/appointments', 'auto-service'],
  ['/insurance-estimates', 'auto-service'],
  ['/vehicles', 'auto-service'],
  ['/service-types', 'auto-service'],
  ['/insurance-companies', 'auto-service'],
  ['/settings/labor-guides', 'auto-service'],

  // Dealership
  ['/dealership', 'dealership'],
  ['/dealership/inventory', 'dealership'],
  ['/dealership/inventory/', 'dealership'],
  ['/dealership/imports', 'dealership'],
  ['/dealership/imports/', 'dealership'],
  ['/dealership/sales', 'dealership'],
  ['/dealership/dealers', 'dealership'],
  ['/dealership/dealers/', 'dealership'],
  ['/dealership/allocations', 'dealership'],
  ['/dealership/payments', 'dealership'],
  ['/dealership/test-drives', 'dealership'],
  ['/dealership/trade-ins', 'dealership'],
  ['/dealership/financing', 'dealership'],
  ['/dealership/warranties', 'dealership'],
  ['/dealership/reports', 'dealership'],

  // Restaurant
  ['/restaurant', 'restaurant'],
  ['/restaurant/orders', 'restaurant'],
  ['/restaurant/kitchen', 'restaurant'],
  ['/restaurant/tables', 'restaurant'],
  ['/restaurant/deliveries', 'restaurant'],
  ['/restaurant/recipes', 'restaurant'],
  ['/restaurant/waste-log', 'restaurant'],
  ['/restaurant/floor-plan', 'restaurant'],
  ['/restaurant/reservations', 'restaurant'],
  ['/restaurant/modifiers', 'restaurant'],
  ['/restaurant/waitstaff', 'restaurant'],

  // HR
  ['/hr/employees', 'hr'],
  ['/hr/salary-components', 'hr'],
  ['/hr/salary-structures', 'hr'],
  ['/hr/salary-slips', 'hr'],
  ['/hr/payroll-runs', 'hr'],
  ['/hr/employee-advances', 'hr'],
  ['/hr', 'hr'],

  // My Portal (Self-Service)
  ['/my/salary-slips', 'my'],
  ['/my/commissions', 'my'],
  ['/my/advances', 'my'],
  ['/my', 'my'],

  // Accounting
  ['/accounting/reports/general-ledger', 'accounting'],
  ['/accounting/reports/day-book', 'accounting'],
  ['/accounting/reports/expense-report', 'accounting'],
  ['/accounting/reports/job-card-profitability', 'accounting'],
  ['/accounting/reports/parts-usage', 'accounting'],
  ['/accounting/reports/warranty-tracker', 'accounting'],
  ['/accounting/reports/food-cost-analysis', 'accounting'],
  ['/accounting/reports/waste-analysis', 'accounting'],
  ['/accounting/reports/peak-hours', 'accounting'],
  ['/accounting/reports/vehicle-aging', 'accounting'],
  ['/accounting/reports/sales-pipeline', 'accounting'],
  ['/accounting/reports/shrinkage-report', 'accounting'],
  ['/accounting/reports/margin-analysis', 'accounting'],
  ['/accounting/chart-of-accounts', 'accounting'],
  ['/accounting/general-ledger', 'accounting'],
  ['/accounting/journal-entries', 'accounting'],
  ['/accounting/recurring-entries', 'accounting'],
  ['/accounting/payment-entries', 'accounting'],
  ['/accounting/payment-reconciliation', 'accounting'],
  ['/accounting/payment-terms', 'accounting'],
  ['/accounting/modes-of-payment', 'accounting'],
  ['/accounting/payment-requests', 'accounting'],
  ['/accounting/dunning-types', 'accounting'],
  ['/accounting/dunning', 'accounting'],
  ['/accounting/fiscal-years', 'accounting'],
  ['/accounting/reports', 'accounting'],
  ['/accounting/bank-accounts', 'accounting'],
  ['/accounting/cost-centers', 'accounting'],
  ['/accounting/budgets', 'accounting'],
  ['/accounting/tax-templates', 'accounting'],
  ['/accounting/e-invoicing', 'accounting'],
  ['/accounting/period-closing', 'accounting'],
  ['/accounting/opening-balances', 'accounting'],
  ['/accounting/settings', 'accounting'],
  ['/accounting', 'accounting'],

  // Reports
  ['/reports', 'reports'],
  ['/activity-log', 'reports'],

  // Files
  ['/files', 'settings'],

  // Settings
  ['/settings/module-access', 'settings'],
  ['/settings/system-audit', 'settings'],
  ['/settings/letter-heads', 'settings'],
  ['/settings/print-templates', 'settings'],
  ['/settings/label-templates', 'settings'],
  ['/settings', 'settings'],
]

// Detail page route patterns: resource paths that have a [id] detail view
// These are checked after stripping /c/[slug] prefix
const DETAIL_PAGE_ROUTES = [
  '/barcode/label-templates/',
  '/appointments/',
  '/insurance-estimates/',
  '/purchase-requisitions/',
  '/supplier-quotations/',
  '/purchase-orders/',
  '/purchases/',
  '/sales-orders/',
  '/sales/',
  '/stock-transfers/',
  '/stock-takes/',
  '/inventory/stock-intake/',
  '/work-orders/',
  '/settings/warehouses/',
  '/layaways/',
  '/accounting/journal-entries/',
  '/accounting/recurring-entries/',
  '/accounting/payment-entries/',
  '/accounting/bank-accounts/',
  '/accounting/budgets/',
  '/hr/salary-slips/',
  '/hr/payroll-runs/',
  '/hr/employee-advances/',
]

/**
 * Extract the relative path (e.g. /items, /selling) from a pathname.
 * Handles both formats:
 *   - /c/slug/items  → /items  (local dev, internal router path)
 *   - /items         → /items  (production subdomain, cleaned URL)
 */
function getRelativePath(pathname: string): string {
  const match = pathname.match(/^\/c\/[^/]+(.*)$/)
  if (match) return match[1] || '/'
  // No /c/slug prefix — use pathname directly (subdomain production)
  return pathname || '/'
}

/**
 * Returns true if the pathname is a detail/document page (e.g. /purchase-orders/abc-123)
 * Detail pages hide the module sidebar to use full page width (ERPNext v15 pattern)
 */
export function isDetailPage(pathname: string): boolean {
  const relativePath = getRelativePath(pathname)

  // Check if path matches a detail route and has a segment after it (the ID)
  for (const route of DETAIL_PAGE_ROUTES) {
    if (relativePath.startsWith(route) && relativePath.length > route.length) {
      // Exclude known sub-list pages like /new
      const remainder = relativePath.slice(route.length).split('/')[0]
      if (remainder && remainder !== 'new') {
        return true
      }
    }
  }
  return false
}

/**
 * Given a pathname like /c/my-company/items or /items, returns the module key (e.g. 'stock')
 */
export function getModuleFromPathname(pathname: string, businessType?: string): string | null {
  const relativePath = getRelativePath(pathname)

  for (const [route, moduleKey] of ROUTE_MODULE_MAP) {
    if (relativePath === route || relativePath.startsWith(route + '/')) {
      // Dealership users accessing auto-service routes should stay in dealership module
      if (moduleKey === 'auto-service' && businessType === 'dealership') {
        return 'dealership'
      }
      return moduleKey
    }
  }
  return null
}

// Sidebar sections per module
const MODULE_SIDEBARS: Record<string, SidebarSection[]> = {
  stock: [
    {
      title: 'Masters',
      items: [
        { href: '/items', label: 'Items', icon: 'Package' },
        { href: '/categories', label: 'Categories', icon: 'FolderTree' },
        { href: '/units', label: 'Units of Measure', icon: 'Ruler', permission: 'manageItems' },
        { href: '/settings/warehouses', label: 'Warehouses', icon: 'Warehouse', permission: 'manageSettings' },
      ],
    },
    {
      title: 'Transactions',
      items: [
        { href: '/stock-transfers', label: 'Stock Transfers', icon: 'ArrowRightLeft', permission: 'manageInventory' },
        { href: '/stock-takes', label: 'Stock Takes', icon: 'ClipboardCheck', permission: 'manageInventory' },
        { href: '/inventory/stock-intake', label: 'Stock Intake', icon: 'FileInput', permission: 'submitStockIntake' },
        { href: '/serial-numbers', label: 'Serial Numbers', icon: 'Hash', permission: 'manageItems' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { href: '/stock-movements', label: 'Stock Ledger', icon: 'History', permission: 'manageInventory' },
        { href: '/items?filter=low-stock', label: 'Low Stock Items', icon: 'AlertTriangle' },
        { href: '/stock/reorder-dashboard', label: 'Reorder Dashboard', icon: 'ShoppingCart', permission: 'manageInventory' },
        { href: '/stock/temperature-zones', label: 'Temperature Zones', icon: 'Thermometer', supermarketOnly: true },
        { href: '/stock/departments', label: 'Departments', icon: 'LayoutGrid', supermarketOnly: true },
        { href: '/pharmacy/expiry', label: 'Expiry Report', icon: 'CalendarClock', pharmacyOnly: true, permission: 'manageInventory' },
      ],
    },
    {
      title: 'Bulk & Manufacturing',
      items: [
        { href: '/items/bulk-price-update', label: 'Bulk Price Update', icon: 'DollarSign', permission: 'manageItems' },
        { href: '/stock/bulk-adjustment', label: 'Bulk Stock Adjustment', icon: 'PackageCheck', permission: 'manageInventory' },
        { href: '/stock/breakdown', label: 'Bulk Repack & Breakdown', icon: 'Layers', permission: 'manageInventory' },
      ],
    },
  ],

  barcode: [
    {
      title: 'Print',
      items: [
        { href: '/barcode/print', label: 'Print Barcode', icon: 'Printer' },
      ],
    },
    {
      title: 'Setup',
      items: [
        { href: '/barcode/label-templates', label: 'Label Templates', icon: 'Tag' },
        { href: '/barcode/settings', label: 'Label Settings', icon: 'Settings', permission: 'manageSettings' },
      ],
    },
  ],

  selling: [
    {
      title: 'Masters',
      items: [
        { href: '/customers', label: 'Customers', icon: 'Users' },
        { href: '/price-lists', label: 'Price Lists', icon: 'Tags', permission: 'manageItems' },
        { href: '/promotions', label: 'Promotions', icon: 'BadgePercent', permission: 'manageItems' },
        { href: '/settings/pos-profiles', label: 'POS Profiles', icon: 'Monitor', permission: 'manageSettings' },
        { href: '/settings/loyalty', label: 'Loyalty Program', icon: 'Star', permission: 'manageSettings' },
      ],
    },
    {
      title: 'Transactions',
      items: [
        { href: '/pos', label: 'Point of Sale', icon: 'ShoppingCart', permission: 'createSales' },
        { href: '/pos/daily-summary', label: 'Daily Summary', icon: 'CalendarCheck', permission: 'viewReports' },
        { href: '/sales-orders', label: 'Sales Orders', icon: 'ClipboardList', permission: 'createSales' },
        { href: '/quotations', label: 'Quotations', icon: 'FileText', permission: 'createSales' },
        { href: '/credit-notes', label: 'Credit Notes', icon: 'Receipt', permission: 'manageSales' },
        { href: '/debit-notes', label: 'Debit Notes', icon: 'Receipt', permission: 'manageSales' },
        { href: '/sales', label: 'Sales Invoices', icon: 'Receipt' },
        { href: '/layaways', label: 'Layaways', icon: 'CreditCard', permission: 'createSales' },
        { href: '/pharmacy/prescriptions', label: 'Prescription Register', icon: 'FileText', pharmacyOnly: true, permission: 'createSales' },
      ],
    },
    {
      title: 'Service & Orders',
      items: [
        { href: '/work-orders', label: 'Work Orders', icon: 'Wrench', autoServiceOnly: true, permission: 'manageWorkOrders' },
        { href: '/insurance-estimates', label: 'Insurance Estimates', icon: 'FileText', autoServiceOnly: true, permission: 'manageInsuranceEstimates' },
        { href: '/appointments', label: 'Appointments', icon: 'Calendar', autoServiceOnly: true, permission: 'manageAppointments' },
        { href: '/dealership/sales', label: 'Vehicle Sales', icon: 'Car', dealershipOnly: true },
        { href: '/work-orders', label: 'Work Orders', icon: 'Wrench', dealershipOnly: true, permission: 'manageWorkOrders' },
        { href: '/appointments', label: 'Appointments', icon: 'Calendar', dealershipOnly: true, permission: 'manageAppointments' },
        { href: '/restaurant/orders', label: 'Orders', icon: 'ClipboardList', restaurantOnly: true, permission: 'manageRestaurantOrders' },
        { href: '/restaurant/deliveries', label: 'Deliveries', icon: 'Truck', restaurantOnly: true, permission: 'manageRestaurantOrders' },
        { href: '/restaurant/reservations', label: 'Reservations', icon: 'CalendarCheck', restaurantOnly: true, permission: 'manageRestaurantOrders' },
      ],
    },
  ],

  buying: [
    {
      title: 'Masters',
      items: [
        { href: '/suppliers', label: 'Suppliers', icon: 'Truck', permission: 'managePurchases' },
      ],
    },
    {
      title: 'Transactions',
      items: [
        { href: '/purchase-requisitions', label: 'Purchase Requisitions', icon: 'FileText', permission: 'createRequisitions' },
        { href: '/supplier-quotations', label: 'Supplier Quotations', icon: 'FileText', permission: 'managePurchases' },
        { href: '/purchase-orders', label: 'Purchase Orders', icon: 'ClipboardList', permission: 'managePurchases' },
        { href: '/buying/grn', label: 'GRN', icon: 'Package', permission: 'managePurchases' },
        { href: '/purchases', label: 'Purchase Invoices', icon: 'CreditCard', permission: 'managePurchases' },
        { href: '/purchases/landed-costs', label: 'Landed Costs', icon: 'Truck', permission: 'managePurchases' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { href: '/reports/aged-payables', label: 'Aged Payables', icon: 'Clock', permission: 'managePurchases' },
        { href: '/reports/supplier-performance', label: 'Supplier Performance', icon: 'TrendingUp', permission: 'managePurchases' },
      ],
    },
  ],

  'auto-service': [
    {
      title: 'Masters',
      items: [
        { href: '/vehicles', label: 'Vehicles', icon: 'Car', permission: 'manageVehicles' },
        { href: '/service-types', label: 'Service Types', icon: 'Settings2', permission: 'manageServiceTypes' },
        { href: '/settings/labor-guides', label: 'Labor Guides', icon: 'Clock', permission: 'manageServiceTypes' },
        { href: '/insurance-companies', label: 'Insurance Companies', icon: 'Building2', permission: 'manageInsuranceCompanies' },
      ],
    },
    {
      title: 'Transactions',
      items: [
        { href: '/work-orders', label: 'Work Orders', icon: 'Wrench', permission: 'manageWorkOrders' },
        { href: '/insurance-estimates', label: 'Insurance Estimates', icon: 'FileText', permission: 'manageInsuranceEstimates' },
        { href: '/appointments', label: 'Appointments', icon: 'Calendar', permission: 'manageAppointments' },
      ],
    },
  ],

  dealership: [
    {
      title: 'Vehicle Inventory',
      items: [
        { href: '/dealership/inventory', label: 'All Vehicles', icon: 'Car' },
        { href: '/dealership/imports', label: 'Import Pipeline', icon: 'Ship' },
      ],
    },
    {
      title: 'Sales',
      items: [
        { href: '/dealership/sales', label: 'Vehicle Sales', icon: 'ShoppingCart' },
      ],
    },
    {
      title: 'Dealer Network',
      items: [
        { href: '/dealership/dealers', label: 'Dealers', icon: 'Building2' },
        { href: '/dealership/allocations', label: 'Allocations', icon: 'ArrowLeftRight' },
        { href: '/dealership/payments', label: 'Dealer Payments', icon: 'Wallet' },
      ],
    },
    {
      title: 'Leads & Test Drives',
      items: [
        { href: '/dealership/test-drives', label: 'Test Drives', icon: 'Calendar' },
      ],
    },
    {
      title: 'Financing & Trade-Ins',
      items: [
        { href: '/dealership/financing', label: 'Financing Options', icon: 'Banknote' },
        { href: '/dealership/trade-ins', label: 'Trade-In Valuations', icon: 'ArrowRightLeft' },
      ],
    },
    {
      title: 'After-Sale',
      items: [
        { href: '/dealership/warranties', label: 'Warranties', icon: 'Shield' },
      ],
    },
    {
      title: 'Service Center',
      items: [
        { href: '/work-orders', label: 'Work Orders', icon: 'Wrench', permission: 'manageWorkOrders' },
        { href: '/appointments', label: 'Appointments', icon: 'Calendar', permission: 'manageAppointments' },
        { href: '/service-types', label: 'Service Types', icon: 'Settings2', permission: 'manageServiceTypes' },
        { href: '/vehicles', label: 'Customer Vehicles', icon: 'Car', permission: 'manageVehicles' },
        { href: '/insurance-estimates', label: 'Insurance Estimates', icon: 'FileText', permission: 'manageInsuranceEstimates' },
      ],
    },
    {
      title: 'Parts & Accessories',
      items: [
        { href: '/pos', label: 'Parts Counter', icon: 'ShoppingCart', permission: 'createSales' },
        { href: '/sales', label: 'Sales History', icon: 'Receipt' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { href: '/dealership/reports', label: 'Dealership Reports', icon: 'BarChart3' },
      ],
    },
  ],

  restaurant: [
    {
      title: 'Operations',
      items: [
        { href: '/restaurant/orders', label: 'Orders', icon: 'ClipboardList', permission: 'manageRestaurantOrders' },
        { href: '/restaurant/kitchen', label: 'Kitchen Display', icon: 'UtensilsCrossed', permission: 'manageRestaurantOrders' },
        { href: '/restaurant/deliveries', label: 'Deliveries', icon: 'Truck', permission: 'manageRestaurantOrders' },
        { href: '/restaurant/reservations', label: 'Reservations', icon: 'CalendarCheck', permission: 'manageRestaurantOrders' },
        { href: '/restaurant/waitstaff', label: 'Waitstaff', icon: 'UserCheck', permission: 'manageRestaurantOrders' },
      ],
    },
    {
      title: 'Menu Management',
      items: [
        { href: '/restaurant/recipes', label: 'Recipes', icon: 'BookOpen', permission: 'manageItems' },
        { href: '/restaurant/modifiers', label: 'Modifiers', icon: 'SlidersHorizontal', permission: 'manageItems' },
        { href: '/restaurant/waste-log', label: 'Waste Log', icon: 'Trash2', permission: 'manageItems' },
      ],
    },
    {
      title: 'Masters',
      items: [
        { href: '/restaurant/tables', label: 'Tables', icon: 'LayoutGrid', permission: 'manageTables' },
        { href: '/restaurant/floor-plan', label: 'Floor Plan', icon: 'Map', permission: 'manageTables' },
      ],
    },
  ],

  accounting: [
    {
      title: 'Masters',
      items: [
        { href: '/accounting/chart-of-accounts', label: 'Chart of Accounts', icon: 'BookOpen', permission: 'manageAccounting' },
        { href: '/accounting/fiscal-years', label: 'Fiscal Years', icon: 'Calendar', permission: 'manageAccounting' },
        { href: '/accounting/cost-centers', label: 'Cost Centers', icon: 'Target', permission: 'manageAccounting' },
        { href: '/accounting/tax-templates', label: 'Tax Templates', icon: 'Receipt', permission: 'manageAccounting' },
        { href: '/accounting/e-invoicing', label: 'E-Invoicing', icon: 'FileText', permission: 'manageAccounting' },
      ],
    },
    {
      title: 'Payments',
      items: [
        { href: '/accounting/payment-entries', label: 'Payment Entries', icon: 'ArrowRightLeft', permission: 'manageAccounting' },
        { href: '/accounting/payment-reconciliation', label: 'Payment Reconciliation', icon: 'CheckSquare', permission: 'manageAccounting' },
        { href: '/accounting/payment-requests', label: 'Payment Requests', icon: 'Mail', permission: 'manageAccounting' },
        { href: '/accounting/dunning', label: 'Dunning', icon: 'AlertTriangle', permission: 'manageAccounting' },
      ],
    },
    {
      title: 'Transactions',
      items: [
        { href: '/accounting/journal-entries', label: 'Journal Entry', icon: 'FileText', permission: 'manageAccounting' },
        { href: '/accounting/recurring-entries', label: 'Recurring Entries', icon: 'RefreshCw', permission: 'manageAccounting' },
        { href: '/accounting/general-ledger', label: 'General Ledger', icon: 'List', permission: 'manageAccounting' },
      ],
    },
    {
      title: 'Banking',
      items: [
        { href: '/accounting/bank-accounts', label: 'Bank Accounts', icon: 'Landmark', permission: 'manageAccounting' },
      ],
    },
    {
      title: 'Budgets',
      items: [
        { href: '/accounting/budgets', label: 'Budgets', icon: 'Wallet', permission: 'manageAccounting' },
      ],
    },
    {
      title: 'Financial Reports',
      items: [
        { href: '/accounting/reports/trial-balance', label: 'Trial Balance', icon: 'Scale', permission: 'manageAccounting' },
        { href: '/accounting/reports/profit-and-loss', label: 'Profit & Loss', icon: 'TrendingUp', permission: 'manageAccounting' },
        { href: '/accounting/reports/balance-sheet', label: 'Balance Sheet', icon: 'PieChart', permission: 'manageAccounting' },
        { href: '/accounting/reports/accounts-receivable', label: 'Accounts Receivable', icon: 'ArrowDownRight', permission: 'manageAccounting' },
        { href: '/accounting/reports/accounts-payable', label: 'Accounts Payable', icon: 'ArrowUpRight', permission: 'manageAccounting' },
        { href: '/accounting/reports/cash-flow', label: 'Cash Flow', icon: 'ArrowRightLeft', permission: 'manageAccounting' },
        { href: '/accounting/reports/general-ledger', label: 'General Ledger', icon: 'List', permission: 'manageAccounting' },
        { href: '/accounting/reports/day-book', label: 'Day Book', icon: 'BookOpen', permission: 'manageAccounting' },
        { href: '/accounting/reports/expense-report', label: 'Expense Report', icon: 'Receipt', permission: 'viewReports' },
      ],
    },
    {
      title: 'Sales Reports',
      items: [
        { href: '/accounting/reports/sales-summary', label: 'Sales Summary', icon: 'BarChart3', permission: 'viewReports' },
        { href: '/accounting/reports/sales-by-item', label: 'Sales by Item', icon: 'Package', permission: 'viewReports' },
        { href: '/accounting/reports/sales-by-customer', label: 'Sales by Customer', icon: 'Users', permission: 'viewReports' },
        { href: '/accounting/reports/daily-sales', label: 'Daily Sales', icon: 'CalendarDays', permission: 'viewReports' },
        { href: '/accounting/reports/payment-collection', label: 'Payment Collection', icon: 'Wallet', permission: 'viewReports' },
        { href: '/accounting/reports/promotions', label: 'Promotion Report', icon: 'BadgePercent', permission: 'viewReports' },
        { href: '/accounting/reports/tax-report', label: 'Tax Report', icon: 'Receipt', permission: 'viewReports' },
        { href: '/accounting/reports/vat-schedule', label: 'VAT Schedules', icon: 'FileText', permission: 'viewReports' },
      ],
    },
    {
      title: 'Inventory Reports',
      items: [
        { href: '/accounting/reports/stock-balance', label: 'Stock Balance', icon: 'Boxes', permission: 'viewReports' },
        { href: '/accounting/reports/stock-movement', label: 'Stock Movement', icon: 'History', permission: 'viewReports' },
        { href: '/accounting/reports/purchase-summary', label: 'Purchase Summary', icon: 'Truck', permission: 'viewReports' },
        { href: '/accounting/reports/purchase-by-supplier', label: 'Purchase by Supplier', icon: 'Building2', permission: 'viewReports' },
        { href: '/accounting/reports/item-profitability', label: 'Item Profitability', icon: 'DollarSign', permission: 'viewReports' },
        { href: '/accounting/reports/shrinkage-report', label: 'Shrinkage Report', icon: 'AlertTriangle', permission: 'viewReports' },
        { href: '/accounting/reports/margin-analysis', label: 'Margin Analysis', icon: 'TrendingUp', permission: 'viewReports' },
      ],
    },
    {
      title: 'Business Reports',
      items: [
        { href: '/accounting/reports/service-revenue', label: 'Service Revenue', icon: 'Wrench', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/technician-performance', label: 'Technician Performance', icon: 'UserCheck', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/job-card-profitability', label: 'Job Card Profitability', icon: 'DollarSign', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/parts-usage', label: 'Parts Usage', icon: 'Package', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/warranty-tracker', label: 'Warranty Tracker', icon: 'Shield', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/table-turnover', label: 'Table Turnover', icon: 'UtensilsCrossed', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/menu-performance', label: 'Menu Performance', icon: 'ChefHat', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/food-cost-analysis', label: 'Food Cost Analysis', icon: 'Receipt', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/waste-analysis', label: 'Waste Analysis', icon: 'Trash2', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/peak-hours', label: 'Peak Hours', icon: 'Clock', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/vehicle-aging', label: 'Vehicle Aging', icon: 'Car', dealershipOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/sales-pipeline', label: 'Sales Pipeline', icon: 'TrendingUp', dealershipOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/category-sales', label: 'Category Sales', icon: 'LayoutGrid', supermarketOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/item-velocity', label: 'Item Velocity', icon: 'Activity', supermarketOnly: true, permission: 'viewReports' },
      ],
    },
    {
      title: 'Saved',
      items: [
        { href: '/accounting/reports/saved', label: 'Saved Reports', icon: 'Bookmark', permission: 'viewReports' },
      ],
    },
    {
      title: 'Period Closing',
      items: [
        { href: '/accounting/period-closing', label: 'Period Closing', icon: 'Lock', permission: 'manageAccounting' },
        { href: '/accounting/opening-balances', label: 'Opening Balances', icon: 'PlayCircle', permission: 'manageAccounting' },
      ],
    },
    {
      title: 'Settings',
      items: [
        { href: '/accounting/modes-of-payment', label: 'Modes of Payment', icon: 'CreditCard', permission: 'manageAccounting' },
        { href: '/accounting/payment-terms', label: 'Payment Terms', icon: 'Clock', permission: 'manageAccounting' },
        { href: '/accounting/dunning-types', label: 'Dunning Types', icon: 'AlertCircle', permission: 'manageAccounting' },
        { href: '/accounting/settings', label: 'Accounting Settings', icon: 'Settings', permission: 'manageAccounting' },
      ],
    },
  ],

  hr: [
    {
      title: 'Masters',
      items: [
        { href: '/hr/employees', label: 'Employees', icon: 'Users', permission: 'manageEmployees' },
        { href: '/hr/salary-components', label: 'Salary Components', icon: 'Calculator', permission: 'manageSalaryComponents' },
        { href: '/hr/salary-structures', label: 'Salary Structures', icon: 'Layers', permission: 'manageSalaryComponents' },
      ],
    },
    {
      title: 'Payroll',
      items: [
        { href: '/hr/salary-slips', label: 'Salary Slips', icon: 'FileText', permission: 'viewPayroll' },
        { href: '/hr/payroll-runs', label: 'Payroll Runs', icon: 'Play', permission: 'processPayroll' },
      ],
    },
    {
      title: 'Advances',
      items: [
        { href: '/hr/employee-advances', label: 'Employee Advances', icon: 'Banknote', permission: 'approveAdvances' },
      ],
    },
  ],

  my: [
    {
      title: 'Self Service',
      items: [
        { href: '/my', label: 'Overview', icon: 'LayoutDashboard', permission: 'viewOwnPaySlips' },
        { href: '/my/salary-slips', label: 'My Salary Slips', icon: 'FileText', permission: 'viewOwnPaySlips' },
        { href: '/my/commissions', label: 'My Commissions', icon: 'DollarSign', permission: 'viewOwnCommissions' },
        { href: '/my/advances', label: 'My Advances', icon: 'Banknote', permission: 'requestAdvance' },
      ],
    },
  ],

  reports: [
    {
      title: 'Financial Reports',
      items: [
        { href: '/accounting/reports/trial-balance', label: 'Trial Balance', icon: 'Scale', permission: 'manageAccounting' },
        { href: '/accounting/reports/profit-and-loss', label: 'Profit & Loss', icon: 'TrendingUp', permission: 'manageAccounting' },
        { href: '/accounting/reports/balance-sheet', label: 'Balance Sheet', icon: 'PieChart', permission: 'manageAccounting' },
        { href: '/accounting/reports/cash-flow', label: 'Cash Flow', icon: 'ArrowRightLeft', permission: 'manageAccounting' },
        { href: '/accounting/reports/general-ledger', label: 'General Ledger', icon: 'List', permission: 'manageAccounting' },
        { href: '/accounting/reports/day-book', label: 'Day Book', icon: 'BookOpen', permission: 'manageAccounting' },
        { href: '/accounting/reports/expense-report', label: 'Expense Report', icon: 'Receipt', permission: 'viewReports' },
        { href: '/accounting/reports/accounts-receivable', label: 'Accounts Receivable', icon: 'ArrowDownRight', permission: 'manageAccounting' },
        { href: '/accounting/reports/accounts-payable', label: 'Accounts Payable', icon: 'ArrowUpRight', permission: 'manageAccounting' },
      ],
    },
    {
      title: 'Sales Reports',
      items: [
        { href: '/accounting/reports/sales-summary', label: 'Sales Summary', icon: 'BarChart3', permission: 'viewReports' },
        { href: '/accounting/reports/sales-by-item', label: 'Sales by Item', icon: 'Package', permission: 'viewReports' },
        { href: '/accounting/reports/sales-by-customer', label: 'Sales by Customer', icon: 'Users', permission: 'viewReports' },
        { href: '/accounting/reports/daily-sales', label: 'Daily Sales', icon: 'CalendarDays', permission: 'viewReports' },
        { href: '/accounting/reports/payment-collection', label: 'Payment Collection', icon: 'Wallet', permission: 'viewReports' },
        { href: '/accounting/reports/promotions', label: 'Promotion Report', icon: 'BadgePercent', permission: 'viewReports' },
        { href: '/accounting/reports/tax-report', label: 'Tax Report', icon: 'Receipt', permission: 'viewReports' },
        { href: '/accounting/reports/vat-schedule', label: 'VAT Schedules', icon: 'FileText', permission: 'viewReports' },
      ],
    },
    {
      title: 'Inventory Reports',
      items: [
        { href: '/accounting/reports/stock-balance', label: 'Stock Balance', icon: 'Boxes', permission: 'viewReports' },
        { href: '/accounting/reports/stock-movement', label: 'Stock Movement', icon: 'History', permission: 'viewReports' },
        { href: '/accounting/reports/purchase-summary', label: 'Purchase Summary', icon: 'Truck', permission: 'viewReports' },
        { href: '/accounting/reports/purchase-by-supplier', label: 'Purchase by Supplier', icon: 'Building2', permission: 'viewReports' },
        { href: '/accounting/reports/item-profitability', label: 'Item Profitability', icon: 'DollarSign', permission: 'viewReports' },
        { href: '/accounting/reports/shrinkage-report', label: 'Shrinkage Report', icon: 'AlertTriangle', permission: 'viewReports' },
        { href: '/accounting/reports/margin-analysis', label: 'Margin Analysis', icon: 'TrendingUp', permission: 'viewReports' },
      ],
    },
    {
      title: 'Auto Service Reports',
      items: [
        { href: '/accounting/reports/service-revenue', label: 'Service Revenue', icon: 'Wrench', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/technician-performance', label: 'Technician Performance', icon: 'UserCheck', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/job-card-profitability', label: 'Job Card Profitability', icon: 'DollarSign', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/parts-usage', label: 'Parts Usage', icon: 'Package', autoServiceOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/warranty-tracker', label: 'Warranty Tracker', icon: 'Shield', autoServiceOnly: true, permission: 'viewReports' },
      ],
    },
    {
      title: 'Restaurant Reports',
      items: [
        { href: '/accounting/reports/table-turnover', label: 'Table Turnover', icon: 'UtensilsCrossed', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/menu-performance', label: 'Menu Performance', icon: 'ChefHat', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/food-cost-analysis', label: 'Food Cost Analysis', icon: 'Receipt', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/waste-analysis', label: 'Waste Analysis', icon: 'Trash2', restaurantOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/peak-hours', label: 'Peak Hours', icon: 'Clock', restaurantOnly: true, permission: 'viewReports' },
      ],
    },
    {
      title: 'Dealership Reports',
      items: [
        { href: '/accounting/reports/vehicle-aging', label: 'Vehicle Aging', icon: 'Car', dealershipOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/sales-pipeline', label: 'Sales Pipeline', icon: 'TrendingUp', dealershipOnly: true, permission: 'viewReports' },
      ],
    },
    {
      title: 'Supermarket Reports',
      items: [
        { href: '/accounting/reports/category-sales', label: 'Category Sales', icon: 'LayoutGrid', supermarketOnly: true, permission: 'viewReports' },
        { href: '/accounting/reports/item-velocity', label: 'Item Velocity', icon: 'Activity', supermarketOnly: true, permission: 'viewReports' },
      ],
    },
    {
      title: 'Other',
      items: [
        { href: '/activity-log', label: 'Activity Log', icon: 'Activity', permission: 'viewReports' },
        { href: '/accounting/reports/saved', label: 'Saved Reports', icon: 'Bookmark', permission: 'viewReports' },
        { href: '/reports/aged-payables', label: 'Aged Payables', icon: 'Clock', permission: 'managePurchases' },
        { href: '/reports/supplier-performance', label: 'Supplier Performance', icon: 'TrendingUp', permission: 'managePurchases' },
      ],
    },
  ],

  settings: [
    {
      title: 'General',
      items: [
        { href: '/settings/staff', label: 'Staff', icon: 'Users', permission: 'manageUsers' },
        { href: '/settings/commissions', label: 'Commissions', icon: 'DollarSign', permission: 'manageCommissions' },
        { href: '/settings/notifications', label: 'Notifications', icon: 'Bell' },
        { href: '/files', label: 'File Manager', icon: 'FolderTree', permission: 'manageFiles' },
        { href: '/settings/ai-logs', label: 'AI Intelligence', icon: 'Sparkles', permission: 'manageUsers' },
      ],
    },
    {
      title: 'Configuration',
      items: [
        { href: '/settings/warehouses', label: 'Warehouses', icon: 'Warehouse' },
        { href: '/settings/pos-profiles', label: 'POS Profiles', icon: 'Monitor' },
        { href: '/settings/loyalty', label: 'Loyalty Program', icon: 'Star' },
        { href: '/settings/gift-cards', label: 'Gift Cards', icon: 'CreditCard' },
      ],
    },
    {
      title: 'Print & Branding',
      items: [
        { href: '/settings/letter-heads', label: 'Letter Heads', icon: 'FileText', permission: 'manageSettings' },
        { href: '/settings/print-templates', label: 'Print Templates', icon: 'Printer', permission: 'manageSettings' },
        { href: '/settings/label-templates', label: 'Label Templates', icon: 'Tag', permission: 'manageSettings' },
      ],
    },
    {
      title: 'System',
      items: [
        { href: '/settings/module-access', label: 'Module Access', icon: 'Shield', permission: 'manageSettings' },
        { href: '/settings/system-audit', label: 'System Audit', icon: 'ShieldCheck', permission: 'manageSettings' },
      ],
    },
    {
      title: 'Service & Vehicles',
      items: [
        { href: '/settings/vehicle-types', label: 'Vehicle Types', icon: 'Car', autoServiceOnly: true },
        { href: '/settings/labor-guides', label: 'Labor Guides', icon: 'Clock', autoServiceOnly: true, permission: 'manageServiceTypes' },
        { href: '/settings/inspection-templates', label: 'Inspections', icon: 'ClipboardList', autoServiceOnly: true },
      ],
    },
  ],
}

// Label overrides per business type for sidebar items
const LABEL_OVERRIDES: Record<string, string> = {
  'Items': 'items',
  'Categories': 'categories',
  'Customers': 'customers',
  'Sales Invoices': 'sales',
}

/**
 * Check if a module tab should be visible based on business type, permissions, and module access config.
 */
export function isModuleTabVisible(
  tab: ModuleTab,
  businessType?: string,
  role?: string,
  isModuleEnabled?: (moduleKey: string, role?: string) => boolean,
  /** Server-effective permission check (custom roles, overrides); defaults to role defaults */
  can?: (permission: Permission) => boolean,
): boolean {
  if (tab.autoServiceOnly && businessType !== 'auto_service') return false
  if (tab.dealershipOnly && businessType !== 'dealership') return false
  if (tab.restaurantOnly && businessType !== 'restaurant') return false
  const check = can || ((p: Permission) => !!role && hasPermission(role, p))
  if (tab.permission && role && !check(tab.permission)
    && !(tab.altPermissions || []).some((p) => check(p))) return false
  if (isModuleEnabled && role && !isModuleEnabled(tab.key, role)) return false
  return true
}

/**
 * The href a role should open for a module tab: the module workspace, or the
 * tab's `limitedHref` when the role only qualifies through `altPermissions`.
 */
export function getModuleTabHref(tab: ModuleTab, role?: string, can?: (permission: Permission) => boolean): string {
  const check = can || ((p: Permission) => !!role && hasPermission(role, p))
  if (tab.limitedHref && tab.permission && role && !check(tab.permission)) {
    return tab.limitedHref
  }
  return tab.href
}

/**
 * Get sidebar sections for a given module, filtered by business type, user role,
 * and optional module access configuration.
 */
export function getModuleSidebar(
  moduleKey: string,
  businessType?: string,
  role?: string,
  isModuleEnabled?: (moduleKey: string, role?: string) => boolean,
  can?: (permission: Permission) => boolean,
): SidebarSection[] {
  const check = can || ((p: Permission) => !!role && hasPermission(role, p))
  // If module access check is provided and module is disabled, return empty
  if (isModuleEnabled && role && !isModuleEnabled(moduleKey, role)) {
    return []
  }
  const sections = MODULE_SIDEBARS[moduleKey]
  if (!sections) return []

  const isAutoServiceCapable = isServiceCapable(businessType)
  const isStore = isStoreBusiness(businessType)
  const isPharmacy = businessType === 'pharmacy'
  const isRestaurant = businessType === 'restaurant'
  const isDealership = businessType === 'dealership'
  const t = getTerms(businessType)

  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => {
          if (item.autoServiceOnly && !isAutoServiceCapable) return false
          if (item.supermarketOnly && !isStore) return false
          if (item.pharmacyOnly && !isPharmacy) return false
          if (item.restaurantOnly && !isRestaurant) return false
          if (item.dealershipOnly && !isDealership) return false
          if (item.permission && role && !check(item.permission)) return false
          return true
        })
        .map((item) => {
          const termKey = LABEL_OVERRIDES[item.label]
          if (termKey) {
            return { ...item, label: t[termKey as keyof typeof t] }
          }
          return item
        }),
    }))
    .filter((section) => section.items.length > 0)
}

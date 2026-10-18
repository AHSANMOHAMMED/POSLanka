/**
 * System Knowledge Base for AI Chat Assistant
 *
 * This file provides the AI assistant with comprehensive knowledge about
 * the multi-tenant POS/ERP system, including page navigation, feature
 * explanations, and workflow guidance.
 *
 * All paths are relative (without /c/{slug} prefix). The client prepends
 * the tenant-scoped prefix before rendering links.
 */

import { hasPermission, type Permission } from '@/lib/auth/roles'

// ============================================================================
// TYPES
// ============================================================================

export interface PageEntry {
  /** Relative path, e.g. '/dashboard', '/items', '/pos' */
  path: string
  /** Display name, e.g. 'Dashboard', 'Items & Products' */
  name: string
  /** What you can do on this page */
  description: string
  /** Module grouping */
  module: 'dashboard' | 'stock' | 'selling' | 'buying' | 'auto-service' | 'dealership' | 'restaurant' | 'hr' | 'my-portal' | 'accounting' | 'reports' | 'settings'
  /** If only for certain business types. Omit = all types. */
  businessTypes?: string[]
  /** Required permissions. Omit = all users. */
  permissions?: Permission[]
  /** Search keywords for matching */
  keywords: string[]
}

export interface FeatureEntry {
  /** Feature name */
  name: string
  /** What this feature does */
  description: string
  /** Step-by-step guide on how to use it */
  howToUse: string
  /** Related page paths */
  relatedPages: string[]
  /** Search keywords for matching */
  keywords: string[]
}

export interface WorkflowEntry {
  /** Workflow name */
  name: string
  /** Ordered steps to complete the workflow */
  steps: string[]
  /** Related page paths */
  relatedPages: string[]
  /** Search keywords for matching */
  keywords: string[]
}

// ============================================================================
// PAGE REGISTRY
// ============================================================================

export const PAGE_REGISTRY: PageEntry[] = [
  // ---- Dashboard ----
  {
    path: '/dashboard',
    name: 'Dashboard',
    description: 'Overview of your business with key metrics, charts, recent activity, and quick actions. Shows sales, revenue, pending tasks, and alerts.',
    module: 'dashboard',
    keywords: ['dashboard', 'home', 'overview', 'metrics', 'kpi', 'summary', 'main', 'start'],
  },

  // ---- Stock Module ----
  {
    path: '/stock',
    name: 'Stock Overview',
    description: 'Stock module hub page with links to inventory management, transfers, adjustments, and stock reports.',
    module: 'stock',
    keywords: ['stock', 'inventory', 'overview', 'hub'],
  },
  {
    path: '/items',
    name: 'Items & Products',
    description: 'Manage inventory items with SKUs, barcodes, pricing (cost and selling price), images, variants, and stock levels. Search, filter, and bulk manage products.',
    module: 'stock',
    keywords: ['items', 'products', 'inventory', 'sku', 'barcode', 'price', 'pricing', 'goods', 'merchandise', 'parts', 'catalog'],
  },
  {
    path: '/categories',
    name: 'Categories',
    description: 'Organize items into hierarchical categories. Create, edit, and delete categories. Assign items to categories for better organization.',
    module: 'stock',
    keywords: ['categories', 'groups', 'organize', 'classification', 'item groups', 'product categories'],
  },
  {
    path: '/serial-numbers',
    name: 'Serial Numbers',
    description: 'Track serialized items with unique serial numbers. View serial number history, current location, and warranty information.',
    module: 'stock',
    keywords: ['serial', 'serial numbers', 'serialized', 'tracking', 'imei', 'warranty'],
  },
  {
    path: '/stock-transfers',
    name: 'Stock Transfers',
    description: 'Transfer stock between warehouses. Create transfer requests, approve transfers, and track in-transit inventory.',
    module: 'stock',
    permissions: ['manageInventory'],
    keywords: ['transfer', 'stock transfer', 'warehouse transfer', 'move stock', 'relocate', 'inter-warehouse'],
  },
  {
    path: '/stock-takes',
    name: 'Stock Takes',
    description: 'Conduct physical inventory counts. Compare counted quantities with system quantities and reconcile differences.',
    module: 'stock',
    permissions: ['manageInventory'],
    keywords: ['stock take', 'physical count', 'inventory count', 'stocktake', 'cycle count', 'reconciliation'],
  },
  {
    path: '/stock-movements',
    name: 'Stock Movements',
    description: 'View complete history of all stock movements including sales, purchases, transfers, adjustments, and returns.',
    module: 'stock',
    keywords: ['stock movements', 'movement history', 'stock history', 'inventory log', 'stock log'],
  },
  {
    path: '/stock/reorder-dashboard',
    name: 'Reorder Dashboard',
    description: 'Smart reorder suggestions based on minimum stock levels and sales velocity. Quickly create purchase orders for items that need restocking.',
    module: 'stock',
    keywords: ['reorder', 'restock', 'replenish', 'low stock', 'minimum stock', 'auto order', 'suggestions'],
  },
  {
    path: '/stock/bulk-adjustment',
    name: 'Bulk Stock Adjustment',
    description: 'Adjust stock quantities for multiple items at once. Useful for corrections, write-offs, and opening stock entry.',
    module: 'stock',
    permissions: ['manageInventory'],
    keywords: ['bulk adjustment', 'stock adjustment', 'adjust', 'correction', 'write-off', 'opening stock'],
  },
  {
    path: '/items/bulk-price-update',
    name: 'Bulk Price Update',
    description: 'Update selling prices or cost prices for multiple items at once. Apply percentage or flat amount changes.',
    module: 'stock',
    permissions: ['manageItems'],
    keywords: ['bulk price', 'price update', 'mass update', 'change prices', 'price adjustment'],
  },
  {
    path: '/stock/temperature-zones',
    name: 'Temperature Zones',
    description: 'Manage temperature-controlled storage zones for perishable goods. Set temperature ranges and monitor compliance.',
    module: 'stock',
    businessTypes: ['supermarket'],
    keywords: ['temperature', 'cold storage', 'freezer', 'chilled', 'perishable', 'zones'],
  },
  {
    path: '/stock/departments',
    name: 'Departments',
    description: 'Manage supermarket departments like bakery, deli, produce, dairy. Assign items and track departmental performance.',
    module: 'stock',
    businessTypes: ['supermarket'],
    keywords: ['departments', 'sections', 'bakery', 'deli', 'produce', 'dairy', 'supermarket departments'],
  },

  // ---- Selling Module ----
  {
    path: '/selling',
    name: 'Selling Overview',
    description: 'Selling module hub page with links to POS, sales orders, invoices, customers, and layaways.',
    module: 'selling',
    keywords: ['selling', 'sales', 'overview', 'hub'],
  },
  {
    path: '/pos',
    name: 'Point of Sale',
    description: 'Process sales transactions. Scan barcodes, search items, apply discounts, accept multiple payment methods (cash, card, bank transfer), print receipts, and manage the cash register.',
    module: 'selling',
    permissions: ['createSales'],
    keywords: ['pos', 'point of sale', 'checkout', 'register', 'sell', 'scan', 'barcode', 'receipt', 'cash register', 'billing', 'counter'],
  },
  {
    path: '/pos/daily-summary',
    name: 'POS Daily Summary',
    description: 'End-of-day cash-up and reconciliation. View total sales, payment method breakdown, expected vs actual cash, and close the register.',
    module: 'selling',
    permissions: ['createSales'],
    keywords: ['daily summary', 'cash up', 'end of day', 'eod', 'reconciliation', 'register close', 'z report'],
  },
  {
    path: '/sales-orders',
    name: 'Sales Orders',
    description: 'Create and manage sales orders before converting them to invoices. Track order status, delivery dates, and partial fulfillment.',
    module: 'selling',
    permissions: ['manageSales'],
    keywords: ['sales orders', 'orders', 'order management', 'quotation', 'proforma'],
  },
  {
    path: '/sales',
    name: 'Sales Invoices',
    description: 'View completed sales and invoices. Search by date, customer, or invoice number. Process returns, view payment status, and reprint receipts.',
    module: 'selling',
    keywords: ['sales', 'invoices', 'transactions', 'receipts', 'returns', 'refunds', 'history', 'sales history'],
  },
  {
    path: '/customers',
    name: 'Customers',
    description: 'Manage customer profiles including contact information, credit limits, loyalty points, purchase history, and outstanding balances.',
    module: 'selling',
    permissions: ['manageCustomers'],
    keywords: ['customers', 'clients', 'buyers', 'contacts', 'customer list', 'credit', 'loyalty'],
  },
  {
    path: '/layaways',
    name: 'Layaways',
    description: 'Manage layaway/installment sales. Create layaway plans, track payments, and convert to completed sales when fully paid.',
    module: 'selling',
    keywords: ['layaway', 'installment', 'lay-by', 'payment plan', 'hire purchase'],
  },

  // ---- Buying Module ----
  {
    path: '/buying',
    name: 'Buying Overview',
    description: 'Buying module hub page with links to purchase requisitions, quotations, orders, and invoices.',
    module: 'buying',
    permissions: ['managePurchases'],
    keywords: ['buying', 'purchasing', 'procurement', 'overview', 'hub'],
  },
  {
    path: '/suppliers',
    name: 'Suppliers',
    description: 'Manage supplier profiles with contact details, payment terms, credit limits, and purchase history. Track supplier performance.',
    module: 'buying',
    permissions: ['managePurchases'],
    keywords: ['suppliers', 'vendors', 'supplier list', 'vendor management', 'provider'],
  },
  {
    path: '/purchase-requisitions',
    name: 'Purchase Requisitions',
    description: 'Create internal purchase requests for items needed. Submit for approval before converting to purchase orders.',
    module: 'buying',
    permissions: ['createRequisitions'],
    keywords: ['requisition', 'purchase request', 'material request', 'request to buy', 'internal request'],
  },
  {
    path: '/supplier-quotations',
    name: 'Supplier Quotations',
    description: 'Request and manage quotations from suppliers. Record supplier pricing and terms for comparison.',
    module: 'buying',
    permissions: ['managePurchases'],
    keywords: ['quotation', 'quote', 'rfq', 'request for quotation', 'supplier quote', 'pricing'],
  },
  {
    path: '/supplier-quotations/compare',
    name: 'Compare Quotations',
    description: 'Side-by-side comparison of supplier quotations. Compare prices, terms, and delivery times across multiple suppliers.',
    module: 'buying',
    permissions: ['managePurchases'],
    keywords: ['compare', 'quotation comparison', 'side by side', 'best price', 'supplier comparison'],
  },
  {
    path: '/purchase-orders',
    name: 'Purchase Orders',
    description: 'Create and track purchase orders to suppliers. Manage order status, expected delivery, and partial receipts.',
    module: 'buying',
    permissions: ['managePurchases'],
    keywords: ['purchase order', 'po', 'buy order', 'ordering', 'procurement order'],
  },
  {
    path: '/purchases',
    name: 'Purchase Invoices',
    description: 'Record received goods and supplier invoices. Match against purchase orders, update stock, and track payment obligations.',
    module: 'buying',
    permissions: ['managePurchases'],
    keywords: ['purchase invoice', 'goods receipt', 'receiving', 'grn', 'supplier invoice', 'bills'],
  },

  // ---- Auto Service Module ----
  {
    path: '/auto-service',
    name: 'Auto Service Overview',
    description: 'Auto service module hub with links to work orders, appointments, vehicles, insurance estimates, and service types.',
    module: 'auto-service',
    businessTypes: ['auto_service'],
    keywords: ['auto service', 'workshop', 'garage', 'overview', 'hub'],
  },
  {
    path: '/work-orders',
    name: 'Work Orders',
    description: 'Create and manage vehicle service jobs. Add parts, services, and labor. Track job progress from draft to completion and invoicing.',
    module: 'auto-service',
    businessTypes: ['auto_service'],
    permissions: ['manageWorkOrders'],
    keywords: ['work order', 'job card', 'service job', 'repair', 'maintenance', 'job sheet', 'work ticket'],
  },
  {
    path: '/appointments',
    name: 'Appointments',
    description: 'Schedule and manage service appointments. View calendar, set time slots, assign technicians, and send reminders.',
    module: 'auto-service',
    businessTypes: ['auto_service'],
    permissions: ['manageAppointments'],
    keywords: ['appointment', 'schedule', 'booking', 'calendar', 'service booking', 'time slot'],
  },
  {
    path: '/insurance-estimates',
    name: 'Insurance Estimates',
    description: 'Create detailed insurance claim estimates with itemized parts, labor, and supplementary costs. Generate professional estimate documents.',
    module: 'auto-service',
    businessTypes: ['auto_service'],
    permissions: ['manageInsuranceEstimates'],
    keywords: ['insurance', 'estimate', 'claim', 'insurance claim', 'damage assessment', 'body shop'],
  },
  {
    path: '/vehicles',
    name: 'Vehicles',
    description: 'Manage customer vehicle profiles with make, model, year, VIN, registration, mileage, and complete service history.',
    module: 'auto-service',
    businessTypes: ['auto_service'],
    permissions: ['manageVehicles'],
    keywords: ['vehicle', 'car', 'automobile', 'registration', 'vin', 'vehicle profile', 'fleet'],
  },
  {
    path: '/service-types',
    name: 'Service Types',
    description: 'Define service offerings with descriptions, standard pricing, and estimated duration. Organize services into categories.',
    module: 'auto-service',
    businessTypes: ['auto_service'],
    permissions: ['manageServiceTypes'],
    keywords: ['service type', 'service catalog', 'offerings', 'service menu', 'service list', 'labor rates'],
  },
  {
    path: '/insurance-companies',
    name: 'Insurance Companies',
    description: 'Manage insurance provider contacts, policy details, and claim procedures for streamlined insurance estimate processing.',
    module: 'auto-service',
    businessTypes: ['auto_service'],
    permissions: ['manageInsuranceCompanies'],
    keywords: ['insurance company', 'insurer', 'insurance provider', 'policy', 'coverage'],
  },

  // ---- Dealership Module ----
  {
    path: '/dealership/inventory',
    name: 'Vehicle Inventory',
    description: 'Manage dealer vehicle stock with VINs, specifications, pricing, images, and availability status. Track days in stock.',
    module: 'dealership',
    businessTypes: ['dealership'],
    keywords: ['vehicle inventory', 'dealer stock', 'vin', 'lot', 'showroom', 'vehicle stock', 'dealer inventory'],
  },
  {
    path: '/dealership/sales',
    name: 'Vehicle Sales',
    description: 'Track vehicle sale transactions including buyer details, financing, trade-ins, add-ons, and document generation.',
    module: 'dealership',
    businessTypes: ['dealership'],
    keywords: ['vehicle sales', 'car sales', 'deal', 'transaction', 'sold vehicles'],
  },
  {
    path: '/dealership/test-drives',
    name: 'Test Drives',
    description: 'Schedule and track customer test drives. Record feedback, assign vehicles, manage availability, and follow up with prospects.',
    module: 'dealership',
    businessTypes: ['dealership'],
    keywords: ['test drive', 'demo', 'trial', 'test ride', 'schedule drive'],
  },
  {
    path: '/dealership/trade-ins',
    name: 'Trade-Ins',
    description: 'Valuate and manage trade-in vehicles. Record appraisal details, condition reports, and apply trade-in value to new sales.',
    module: 'dealership',
    businessTypes: ['dealership'],
    keywords: ['trade-in', 'trade in', 'appraisal', 'valuation', 'exchange', 'part exchange'],
  },
  {
    path: '/dealership/financing',
    name: 'Financing Options',
    description: 'Configure lender financing plans, interest rates, terms, and monthly payment calculators for vehicle purchases.',
    module: 'dealership',
    businessTypes: ['dealership'],
    keywords: ['financing', 'loan', 'finance', 'credit', 'installment', 'emi', 'lender', 'leasing'],
  },
  {
    path: '/dealership/warranties',
    name: 'Warranties',
    description: 'Track vehicle warranty coverage including manufacturer and extended warranties. Manage warranty claims and expiry dates.',
    module: 'dealership',
    businessTypes: ['dealership'],
    keywords: ['warranty', 'guarantee', 'coverage', 'extended warranty', 'warranty claim'],
  },

  // ---- Restaurant Module ----
  {
    path: '/restaurant/orders',
    name: 'Restaurant Orders',
    description: 'Manage dine-in, takeaway, and delivery orders. View order queue, modify items, apply discounts, and process payments.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    permissions: ['manageRestaurantOrders'],
    keywords: ['restaurant order', 'order', 'dine-in', 'takeaway', 'delivery', 'food order', 'table order'],
  },
  {
    path: '/restaurant/kitchen',
    name: 'Kitchen Display',
    description: 'Real-time kitchen order queue (KDS). View incoming orders, mark items as preparing/ready, and manage preparation priority.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    keywords: ['kitchen', 'kds', 'kitchen display', 'cook', 'preparation', 'food prep', 'order queue'],
  },
  {
    path: '/restaurant/tables',
    name: 'Table Management',
    description: 'View and manage table status (available, occupied, reserved, cleaning). Assign covers and track table timing.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    permissions: ['manageTables'],
    keywords: ['tables', 'table management', 'seating', 'covers', 'table status', 'occupy', 'available'],
  },
  {
    path: '/restaurant/floor-plan',
    name: 'Floor Plan',
    description: 'Visual drag-and-drop table layout designer. Create floor sections, position tables, and design your restaurant layout.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    permissions: ['manageTables'],
    keywords: ['floor plan', 'layout', 'table layout', 'restaurant map', 'seating plan', 'design'],
  },
  {
    path: '/restaurant/deliveries',
    name: 'Deliveries',
    description: 'Track delivery orders from preparation to dispatch and completion. Manage delivery drivers and routes.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    keywords: ['delivery', 'dispatch', 'deliver', 'rider', 'driver', 'food delivery'],
  },
  {
    path: '/restaurant/recipes',
    name: 'Recipes',
    description: 'Recipe costing and ingredient management. Define recipes with ingredients, portions, and calculate food cost per dish.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    keywords: ['recipe', 'ingredients', 'food cost', 'costing', 'portion', 'menu costing'],
  },
  {
    path: '/restaurant/modifiers',
    name: 'Modifiers',
    description: 'Configure menu item modifiers and options like toppings, sizes, spice levels, and add-ons with optional pricing.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    keywords: ['modifier', 'option', 'add-on', 'topping', 'customization', 'extra', 'variant'],
  },
  {
    path: '/restaurant/reservations',
    name: 'Reservations',
    description: 'Manage table reservations with date, time, party size, and special requests. View reservation calendar and availability.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    keywords: ['reservation', 'booking', 'reserve', 'table booking', 'party', 'dining reservation'],
  },
  {
    path: '/restaurant/waitstaff',
    name: 'Waitstaff Dashboard',
    description: 'Server performance tracking including tables served, order accuracy, tips, and shift performance metrics.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    keywords: ['waitstaff', 'waiter', 'server', 'staff performance', 'tips', 'service'],
  },
  {
    path: '/restaurant/waste-log',
    name: 'Waste Log',
    description: 'Track food waste with reasons, quantities, and costs. Analyze waste patterns to reduce loss and improve efficiency.',
    module: 'restaurant',
    businessTypes: ['restaurant'],
    keywords: ['waste', 'food waste', 'spoilage', 'wastage', 'loss', 'expired'],
  },

  // ---- HR Module ----
  {
    path: '/hr',
    name: 'HR Overview',
    description: 'Human resources module hub with links to employees, payroll, salary structures, and employee advances.',
    module: 'hr',
    permissions: ['manageEmployees'],
    keywords: ['hr', 'human resources', 'people', 'overview', 'hub'],
  },
  {
    path: '/hr/employees',
    name: 'Employees',
    description: 'Manage employee profiles including personal details, job information, documents, attendance records, and employment history.',
    module: 'hr',
    permissions: ['manageEmployees'],
    keywords: ['employees', 'staff', 'team', 'workforce', 'personnel', 'employee list'],
  },
  {
    path: '/hr/salary-components',
    name: 'Salary Components',
    description: 'Define earnings (basic pay, allowances, overtime) and deduction types (tax, insurance, loan repayments) used in salary structures.',
    module: 'hr',
    permissions: ['manageSalaryComponents'],
    keywords: ['salary component', 'earnings', 'deductions', 'allowance', 'basic pay', 'overtime', 'tax'],
  },
  {
    path: '/hr/salary-structures',
    name: 'Salary Structures',
    description: 'Define salary breakdown templates with percentage or fixed amounts for each component. Assign structures to employees.',
    module: 'hr',
    permissions: ['manageSalaryComponents'],
    keywords: ['salary structure', 'pay structure', 'compensation', 'salary template', 'pay grade'],
  },
  {
    path: '/hr/salary-slips',
    name: 'Salary Slips',
    description: 'View and manage individual employee payslips. Shows earnings breakdown, deductions, net pay, and payment status.',
    module: 'hr',
    permissions: ['viewPayroll'],
    keywords: ['salary slip', 'payslip', 'pay slip', 'wage slip', 'pay stub'],
  },
  {
    path: '/hr/payroll-runs',
    name: 'Payroll Runs',
    description: 'Process bulk payroll for all or selected employees. Calculate salaries, generate slips, and create accounting entries.',
    module: 'hr',
    permissions: ['processPayroll'],
    keywords: ['payroll', 'payroll run', 'salary processing', 'pay run', 'bulk payroll', 'monthly payroll'],
  },
  {
    path: '/hr/employee-advances',
    name: 'Employee Advances',
    description: 'Manage salary advance requests. Review, approve, disburse advances, and track repayment deductions from future salaries.',
    module: 'hr',
    permissions: ['approveAdvances'],
    keywords: ['advance', 'salary advance', 'loan', 'advance request', 'cash advance'],
  },

  // ---- My Portal (Self-Service) ----
  {
    path: '/my',
    name: 'My Portal',
    description: 'Employee self-service dashboard. Quick access to personal payslips, commissions, advance requests, and profile information.',
    module: 'my-portal',
    keywords: ['my portal', 'self service', 'personal', 'my account', 'employee portal'],
  },
  {
    path: '/my/salary-slips',
    name: 'My Salary Slips',
    description: 'View your own salary slips and payment history. Download or print payslips.',
    module: 'my-portal',
    permissions: ['viewOwnPaySlips'],
    keywords: ['my salary', 'my payslip', 'my pay', 'my earnings', 'my salary slip'],
  },
  {
    path: '/my/commissions',
    name: 'My Commissions',
    description: 'View your own commission earnings from sales. Track commission rates, totals, and payment status.',
    module: 'my-portal',
    permissions: ['viewOwnCommissions'],
    keywords: ['my commission', 'my earnings', 'commission history', 'sales commission'],
  },
  {
    path: '/my/advances',
    name: 'My Advances',
    description: 'Request and track your salary advances. View request status, approved amounts, and repayment schedule.',
    module: 'my-portal',
    permissions: ['requestAdvance'],
    keywords: ['my advance', 'request advance', 'salary advance request', 'my loan'],
  },

  // ---- Accounting Module ----
  {
    path: '/accounting',
    name: 'Accounting Dashboard',
    description: 'Financial overview with revenue, expenses, profit margins, cash flow summary, and quick links to key accounting functions.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['accounting', 'finance', 'financial', 'overview', 'dashboard'],
  },
  {
    path: '/accounting/chart-of-accounts',
    name: 'Chart of Accounts',
    description: 'Set up and manage the account tree structure. Create accounts under Asset, Liability, Equity, Income, and Expense root types.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['chart of accounts', 'coa', 'account tree', 'accounts', 'ledger accounts', 'gl accounts'],
  },
  {
    path: '/accounting/journal-entries',
    name: 'Journal Entries',
    description: 'View and manage double-entry journal entries. Filter by date, account, type, and posting status.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['journal entry', 'journal', 'double entry', 'debit credit', 'manual entry', 'adjusting entry'],
  },
  {
    path: '/accounting/journal-entries/new',
    name: 'New Journal Entry',
    description: 'Create a manual double-entry journal entry. Add multiple debit and credit lines ensuring they balance.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['new journal', 'create journal', 'manual entry', 'post entry'],
  },
  {
    path: '/accounting/payment-entries',
    name: 'Payment Entries',
    description: 'Record customer payments (receive) and supplier payments (pay). Link payments to specific invoices.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['payment entry', 'receive payment', 'pay supplier', 'payment', 'collection', 'disbursement'],
  },
  {
    path: '/accounting/payment-reconciliation',
    name: 'Payment Reconciliation',
    description: 'Match unallocated payments to outstanding invoices. Reconcile customer and supplier accounts.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['reconciliation', 'payment matching', 'allocate', 'match payments', 'unallocated'],
  },
  {
    path: '/accounting/bank-accounts',
    name: 'Bank Accounts',
    description: 'Manage bank accounts with opening balances, current balances, and transaction history. Link to chart of accounts.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['bank', 'bank account', 'banking', 'bank balance', 'bank statement'],
  },
  {
    path: '/accounting/budgets',
    name: 'Budgets',
    description: 'Create and track budgets by account, cost center, and fiscal period. Compare actual vs budgeted amounts.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['budget', 'budgeting', 'financial plan', 'budget vs actual', 'variance'],
  },
  {
    path: '/accounting/fiscal-years',
    name: 'Fiscal Years',
    description: 'Define financial year periods with start and end dates. Manage fiscal year status (open/closed).',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['fiscal year', 'financial year', 'accounting period', 'year end'],
  },
  {
    path: '/accounting/cost-centers',
    name: 'Cost Centers',
    description: 'Create cost centers for department or branch-level cost tracking. Allocate expenses to specific business units.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['cost center', 'department', 'branch', 'cost allocation', 'profit center'],
  },
  {
    path: '/accounting/tax-templates',
    name: 'Tax Templates',
    description: 'Configure tax rate templates (VAT, GST, sales tax). Set up inclusive/exclusive tax calculation and multi-rate templates.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['tax', 'tax template', 'vat', 'gst', 'sales tax', 'tax rate', 'tax setup'],
  },
  {
    path: '/accounting/payment-terms',
    name: 'Payment Terms',
    description: 'Define payment term templates like Net 30, Net 60, COD, and custom terms. Assign to customers and suppliers.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['payment terms', 'net 30', 'net 60', 'cod', 'due date', 'credit terms'],
  },
  {
    path: '/accounting/modes-of-payment',
    name: 'Modes of Payment',
    description: 'Configure payment modes such as cash, credit card, bank transfer, cheque, and mobile payment methods.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['payment mode', 'payment method', 'cash', 'card', 'bank transfer', 'cheque', 'mobile money'],
  },
  {
    path: '/accounting/period-closing',
    name: 'Period Closing',
    description: 'Close accounting periods to prevent further postings. Run period-end processes and generate closing entries.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['period closing', 'month end', 'close period', 'lock period', 'period end'],
  },
  {
    path: '/accounting/opening-balances',
    name: 'Opening Balances',
    description: 'Set starting account balances when migrating from another system or starting a new fiscal year.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['opening balance', 'starting balance', 'initial balance', 'migration', 'beginning balance'],
  },
  {
    path: '/accounting/recurring-entries',
    name: 'Recurring Journal Entries',
    description: 'Set up automatic recurring journal entries for regular transactions like rent, subscriptions, and depreciation.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['recurring', 'automatic', 'repeat', 'scheduled', 'recurring journal', 'auto entry'],
  },
  {
    path: '/accounting/payment-requests',
    name: 'Payment Requests',
    description: 'Create and manage payment requests for customers. Send payment links and track request status.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['payment request', 'request payment', 'payment link', 'collect payment'],
  },
  {
    path: '/accounting/dunning',
    name: 'Dunning',
    description: 'Manage dunning notices for overdue invoices. Send automated payment reminders and escalation letters.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['dunning', 'overdue', 'reminder', 'collection', 'payment reminder', 'late payment'],
  },
  {
    path: '/accounting/dunning-types',
    name: 'Dunning Types',
    description: 'Configure dunning escalation levels with reminder intervals, fees, and letter templates.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['dunning type', 'escalation', 'reminder level', 'collection level'],
  },
  {
    path: '/accounting/settings',
    name: 'Accounting Settings',
    description: 'Configure default accounts, auto-posting rules, number series, and other accounting preferences.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['accounting settings', 'configuration', 'defaults', 'auto posting', 'number series'],
  },

  // ---- Accounting Reports ----
  {
    path: '/accounting/reports/trial-balance',
    name: 'Trial Balance',
    description: 'View trial balance report showing all account balances. Verify debits equal credits for a selected period.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['trial balance', 'tb', 'account balances', 'debit credit balance'],
  },
  {
    path: '/accounting/reports/profit-and-loss',
    name: 'Profit & Loss Statement',
    description: 'Income statement showing revenue, cost of goods sold, gross profit, operating expenses, and net income/loss.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['profit and loss', 'p&l', 'income statement', 'pnl', 'revenue', 'expenses', 'net income'],
  },
  {
    path: '/accounting/reports/balance-sheet',
    name: 'Balance Sheet',
    description: 'Financial position report showing total assets, liabilities, and equity at a point in time.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['balance sheet', 'financial position', 'assets', 'liabilities', 'equity', 'net worth'],
  },
  {
    path: '/accounting/general-ledger',
    name: 'General Ledger',
    description: 'View all general ledger transactions with filtering by account, date range, and cost center.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['general ledger', 'gl', 'ledger', 'all transactions', 'account history'],
  },
  {
    path: '/accounting/reports/accounts-receivable',
    name: 'Accounts Receivable',
    description: 'Customer balances report showing outstanding amounts, aging analysis, and collection status.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['accounts receivable', 'ar', 'receivables', 'customer balances', 'money owed', 'outstanding'],
  },
  {
    path: '/accounting/reports/accounts-payable',
    name: 'Accounts Payable',
    description: 'Supplier balances report showing amounts owed, aging analysis, and payment schedule.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['accounts payable', 'ap', 'payables', 'supplier balances', 'we owe', 'bills due'],
  },
  {
    path: '/accounting/reports/cash-flow',
    name: 'Cash Flow Statement',
    description: 'Cash flow report showing operating, investing, and financing activities over a period.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['cash flow', 'cash flow statement', 'cash position', 'liquidity'],
  },
  {
    path: '/accounting/reports/sales-summary',
    name: 'Sales Summary Report',
    description: 'Aggregated sales report by period with totals, averages, growth trends, and comparison charts.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['sales summary', 'sales report', 'revenue report', 'sales overview'],
  },
  {
    path: '/accounting/reports/sales-by-item',
    name: 'Sales by Item Report',
    description: 'Breakdown of sales revenue and quantity by individual item or product.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['sales by item', 'item sales', 'product sales', 'item revenue'],
  },
  {
    path: '/accounting/reports/sales-by-customer',
    name: 'Sales by Customer Report',
    description: 'Sales analysis grouped by customer showing purchase totals, frequency, and trends.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['sales by customer', 'customer sales', 'customer revenue', 'customer analysis'],
  },
  {
    path: '/accounting/reports/daily-sales',
    name: 'Daily Sales Report',
    description: 'Day-by-day sales breakdown with transaction counts, totals, and payment method summary.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['daily sales', 'daily report', 'day sales', 'daily revenue'],
  },
  {
    path: '/accounting/reports/payment-collection',
    name: 'Payment Collection Report',
    description: 'Report on payment collections showing amounts received, pending, and overdue by customer.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['payment collection', 'collections', 'received payments', 'payment report'],
  },
  {
    path: '/accounting/reports/tax-report',
    name: 'Tax Report',
    description: 'Tax liability report showing collected and paid taxes by tax template for filing purposes.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['tax report', 'tax liability', 'vat report', 'gst report', 'tax filing', 'tax return'],
  },
  {
    path: '/accounting/reports/stock-balance',
    name: 'Stock Balance Report',
    description: 'Current stock quantities and values across all warehouses with cost valuation methods.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['stock balance', 'inventory balance', 'stock value', 'warehouse stock'],
  },
  {
    path: '/accounting/reports/stock-movement',
    name: 'Stock Movement Report',
    description: 'Detailed stock movement history with in/out quantities, sources, and running balances.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['stock movement report', 'inventory movement', 'stock in out'],
  },
  {
    path: '/accounting/reports/purchase-summary',
    name: 'Purchase Summary Report',
    description: 'Aggregated purchase report by period showing total spend, order counts, and supplier analysis.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['purchase summary', 'purchase report', 'buying report', 'procurement report'],
  },
  {
    path: '/accounting/reports/purchase-by-supplier',
    name: 'Purchase by Supplier Report',
    description: 'Purchase analysis grouped by supplier with spend totals, order frequency, and lead times.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['purchase by supplier', 'supplier purchases', 'vendor spend', 'supplier analysis'],
  },
  {
    path: '/accounting/reports/item-profitability',
    name: 'Item Profitability Report',
    description: 'Profit analysis per item showing revenue, cost, gross margin, and margin percentage.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['item profitability', 'product profitability', 'margin', 'profit per item', 'gross margin'],
  },
  {
    path: '/accounting/reports/service-revenue',
    name: 'Service Revenue Report',
    description: 'Revenue breakdown by service type for auto service businesses. Shows labor vs parts revenue.',
    module: 'accounting',
    businessTypes: ['auto_service'],
    permissions: ['manageAccounting'],
    keywords: ['service revenue', 'labor revenue', 'parts revenue', 'workshop revenue'],
  },
  {
    path: '/accounting/reports/technician-performance',
    name: 'Technician Performance Report',
    description: 'Technician productivity metrics including jobs completed, revenue generated, and efficiency rates.',
    module: 'accounting',
    businessTypes: ['auto_service'],
    permissions: ['manageAccounting'],
    keywords: ['technician performance', 'mechanic performance', 'productivity', 'efficiency'],
  },
  {
    path: '/accounting/reports/table-turnover',
    name: 'Table Turnover Report',
    description: 'Table utilization metrics showing average dining duration, turnovers per shift, and revenue per table.',
    module: 'accounting',
    businessTypes: ['restaurant'],
    permissions: ['manageAccounting'],
    keywords: ['table turnover', 'table utilization', 'seating efficiency', 'table revenue'],
  },
  {
    path: '/accounting/reports/menu-performance',
    name: 'Menu Performance Report',
    description: 'Menu item analysis with sales mix, popularity ranking, food cost percentage, and contribution margin.',
    module: 'accounting',
    businessTypes: ['restaurant'],
    permissions: ['manageAccounting'],
    keywords: ['menu performance', 'menu analysis', 'food cost', 'dish performance', 'menu mix'],
  },
  {
    path: '/accounting/reports/category-sales',
    name: 'Category Sales Report',
    description: 'Sales analysis by product category showing category contribution, trends, and growth.',
    module: 'accounting',
    businessTypes: ['supermarket'],
    permissions: ['manageAccounting'],
    keywords: ['category sales', 'department sales', 'category revenue', 'section performance'],
  },
  {
    path: '/accounting/reports/item-velocity',
    name: 'Item Velocity Report',
    description: 'Item movement speed analysis showing fast-moving, slow-moving, and dead stock items.',
    module: 'accounting',
    businessTypes: ['supermarket'],
    permissions: ['manageAccounting'],
    keywords: ['item velocity', 'fast moving', 'slow moving', 'dead stock', 'stock turnover'],
  },
  {
    path: '/accounting/reports/saved',
    name: 'Saved Reports',
    description: 'Access previously saved report configurations and scheduled reports.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['saved reports', 'my reports', 'scheduled reports', 'report templates'],
  },
  {
    path: '/accounting/audit',
    name: 'Accounting Audit',
    description: 'Audit trail for accounting transactions showing who posted what and when. Useful for compliance.',
    module: 'accounting',
    permissions: ['manageAccounting'],
    keywords: ['accounting audit', 'audit trail', 'compliance', 'transaction log'],
  },

  // ---- Reports Module ----
  {
    path: '/reports',
    name: 'Reports Dashboard',
    description: 'Central hub for all reports. Quick access to sales, inventory, financial, and operational reports.',
    module: 'reports',
    permissions: ['viewReports'],
    keywords: ['reports', 'reporting', 'analytics', 'dashboard', 'report hub'],
  },
  {
    path: '/activity-log',
    name: 'Activity Log',
    description: 'System activity log showing user actions, changes to records, login events, and audit trail.',
    module: 'reports',
    keywords: ['activity log', 'audit log', 'history', 'changes', 'who did what', 'user activity'],
  },
  {
    path: '/reports/aged-payables',
    name: 'Aged Payables Report',
    description: 'Aging analysis of amounts owed to suppliers grouped by 30/60/90/120+ day buckets.',
    module: 'reports',
    permissions: ['viewReports'],
    keywords: ['aged payables', 'aging', 'overdue payables', 'supplier aging'],
  },
  {
    path: '/reports/supplier-performance',
    name: 'Supplier Performance Report',
    description: 'Supplier evaluation metrics including delivery times, quality, pricing consistency, and order fulfillment rates.',
    module: 'reports',
    permissions: ['viewReports'],
    keywords: ['supplier performance', 'vendor performance', 'delivery time', 'supplier rating'],
  },

  // ---- Settings Module ----
  {
    path: '/settings',
    name: 'Company Settings',
    description: 'Configure business name, type, currency, logo, address, tax ID, print header/footer, and general preferences.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['settings', 'company settings', 'business settings', 'configuration', 'preferences', 'company info'],
  },
  {
    path: '/settings/staff',
    name: 'Staff Management',
    description: 'Add and manage staff accounts. Assign roles (owner, manager, cashier, technician, chef, waiter), set permissions, and activate/deactivate users.',
    module: 'settings',
    permissions: ['manageUsers'],
    keywords: ['staff', 'users', 'team', 'roles', 'permissions', 'add user', 'manage users', 'access control'],
  },
  {
    path: '/settings/commissions',
    name: 'Commission Settings',
    description: 'Configure sales commission rates by role, item category, or individual. Set percentage or flat commission amounts.',
    module: 'settings',
    permissions: ['manageCommissions'],
    keywords: ['commission', 'sales commission', 'incentive', 'bonus', 'commission rate'],
  },
  {
    path: '/settings/notifications',
    name: 'Notifications',
    description: 'Configure email and SMS notification templates, delivery settings, and view notification logs.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['notifications', 'email', 'sms', 'alerts', 'reminders', 'templates'],
  },
  {
    path: '/settings/module-access',
    name: 'Module Access',
    description: 'Enable or disable system modules per role. Control which features are available to different user roles.',
    module: 'settings',
    permissions: ['manageModuleAccess'],
    keywords: ['module access', 'feature toggle', 'enable module', 'disable module', 'access control'],
  },
  {
    path: '/settings/warehouses',
    name: 'Warehouses',
    description: 'Manage inventory warehouse locations. Set default warehouse, view warehouse stock, and configure warehouse details.',
    module: 'settings',
    keywords: ['warehouse', 'location', 'store', 'stockroom', 'storage', 'inventory location'],
  },
  {
    path: '/settings/pos-profiles',
    name: 'POS Profiles',
    description: 'Configure POS terminal profiles with default warehouse, payment methods, receipt format, and user assignments.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['pos profile', 'terminal', 'register profile', 'pos configuration', 'pos setup'],
  },
  {
    path: '/settings/loyalty',
    name: 'Loyalty Program',
    description: 'Configure customer loyalty programs with points earning rules, tier levels, rewards, and redemption policies.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['loyalty', 'loyalty program', 'points', 'rewards', 'tiers', 'membership'],
  },
  {
    path: '/settings/gift-cards',
    name: 'Gift Cards',
    description: 'Create and manage gift cards. Set denominations, track balances, and process gift card payments.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['gift card', 'voucher', 'gift voucher', 'prepaid', 'gift certificate'],
  },
  {
    path: '/settings/letter-heads',
    name: 'Letter Heads',
    description: 'Configure company branding for printed documents including logos, headers, footers, and watermarks.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['letter head', 'letterhead', 'header', 'branding', 'print header', 'company logo'],
  },
  {
    path: '/settings/print-templates',
    name: 'Print Templates',
    description: 'Customize print layouts for receipts, invoices, work orders, and other documents. Supports multiple template formats.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['print template', 'receipt template', 'invoice format', 'print layout', 'receipt design'],
  },
  {
    path: '/settings/system-audit',
    name: 'System Audit',
    description: 'Run system diagnostics, check data integrity, and view system health metrics and performance stats.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['system audit', 'diagnostics', 'health check', 'data integrity', 'system check'],
  },
  {
    path: '/settings/ai-logs',
    name: 'AI Logs',
    description: 'View application error logs with AI-powered analysis. Get suggestions for resolving recurring issues.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['ai logs', 'error logs', 'errors', 'exceptions', 'debugging', 'error analysis'],
  },
  {
    path: '/settings/files',
    name: 'File Manager',
    description: 'Upload and manage documents, images, and attachments. Organize files and manage storage usage.',
    module: 'settings',
    permissions: ['manageFiles'],
    keywords: ['files', 'file manager', 'uploads', 'documents', 'attachments', 'storage'],
  },
  {
    path: '/settings/import-export',
    name: 'Import/Export',
    description: 'Bulk import items, customers, and suppliers from CSV/Excel. Export data for backups or external analysis.',
    module: 'settings',
    permissions: ['manageSettings'],
    keywords: ['import', 'export', 'csv', 'excel', 'bulk import', 'data migration', 'backup'],
  },
  {
    path: '/settings/vehicle-types',
    name: 'Vehicle Types',
    description: 'Manage vehicle body types (sedan, SUV, truck, etc.) used for classification in work orders and estimates.',
    module: 'settings',
    businessTypes: ['auto_service'],
    permissions: ['manageVehicleTypes'],
    keywords: ['vehicle type', 'body type', 'car type', 'sedan', 'suv', 'truck'],
  },
  {
    path: '/settings/inspection-templates',
    name: 'Inspection Templates',
    description: 'Create vehicle inspection checklists with customizable checkpoints for different inspection types (pre-service, pre-delivery).',
    module: 'settings',
    businessTypes: ['auto_service'],
    permissions: ['manageInspectionTemplates'],
    keywords: ['inspection', 'checklist', 'inspection template', 'vehicle inspection', 'pre-service check'],
  },
  {
    path: '/settings/labor-guides',
    name: 'Labor Guides',
    description: 'Define standard labor time and cost guides for common service operations. Helps estimate job duration and pricing.',
    module: 'settings',
    businessTypes: ['auto_service'],
    keywords: ['labor guide', 'time guide', 'flat rate', 'labor time', 'job duration', 'standard time'],
  },
]

// ============================================================================
// FEATURE KNOWLEDGE
// ============================================================================

export const FEATURE_KNOWLEDGE: FeatureEntry[] = [
  {
    name: 'Point of Sale (POS)',
    description: 'Full-featured POS interface for processing sales. Supports barcode scanning, item search, quantity adjustments, line-item discounts, overall discounts, multiple payment splits, customer assignment, hold/recall transactions, and receipt printing.',
    howToUse: 'Go to the POS page. Scan a barcode or search for items to add them to the cart. Adjust quantities, apply discounts if needed. When ready, click Pay, select payment method(s), enter the amount, and complete the sale. The receipt will be generated automatically.',
    relatedPages: ['/pos', '/pos/daily-summary', '/items', '/customers', '/settings/pos-profiles'],
    keywords: ['pos', 'point of sale', 'sell', 'checkout', 'scan', 'barcode', 'receipt', 'cash register', 'payment', 'sale'],
  },
  {
    name: 'Barcode Scanning',
    description: 'Scan product barcodes using a USB/Bluetooth scanner or device camera to quickly add items to POS, look up inventory, or process stock operations.',
    howToUse: 'Connect a barcode scanner to your device. In the POS screen, the cursor is automatically in the search field. Scan a barcode and the matching item will be added to the cart. You can also scan barcodes on the Items page to quickly find products.',
    relatedPages: ['/pos', '/items'],
    keywords: ['barcode', 'scan', 'scanner', 'upc', 'ean', 'qr code', 'sku scan'],
  },
  {
    name: 'Multiple Payment Methods',
    description: 'Accept split payments across different methods: cash, credit/debit card, bank transfer, cheque, mobile payments, gift cards, and loyalty points.',
    howToUse: 'At checkout in POS, click the payment method button to select the type. You can split payment across multiple methods by entering partial amounts. For example, pay part by card and part by cash. The system tracks change due for cash payments.',
    relatedPages: ['/pos', '/accounting/modes-of-payment'],
    keywords: ['payment', 'cash', 'card', 'split payment', 'multiple payments', 'bank transfer', 'mobile payment'],
  },
  {
    name: 'Inventory Management',
    description: 'Complete inventory control with multi-warehouse support, stock levels, minimum stock alerts, reorder suggestions, stock transfers between warehouses, physical stock takes, and detailed movement history.',
    howToUse: 'Navigate to Items to manage your product catalog. Set minimum stock levels on each item to receive low-stock alerts. Use the Reorder Dashboard for smart restocking suggestions. Perform Stock Takes for physical counts and Stock Transfers to move goods between warehouses.',
    relatedPages: ['/items', '/stock-movements', '/stock/reorder-dashboard', '/stock-takes', '/stock-transfers', '/stock/bulk-adjustment', '/settings/warehouses'],
    keywords: ['inventory', 'stock', 'warehouse', 'stock level', 'minimum stock', 'reorder', 'stock control'],
  },
  {
    name: 'Stock Alerts & Reorder Dashboard',
    description: 'Automatic low-stock alerts when items fall below their minimum stock level. The Reorder Dashboard provides smart suggestions based on sales velocity and current stock.',
    howToUse: 'Set minimum stock levels on each item in the Items page. The dashboard will show alerts when items run low. Visit the Reorder Dashboard for AI-powered suggestions. You can create purchase orders directly from the reorder suggestions.',
    relatedPages: ['/stock/reorder-dashboard', '/items', '/purchase-orders'],
    keywords: ['alert', 'low stock', 'reorder', 'out of stock', 'stock alert', 'minimum stock', 'reorder point'],
  },
  {
    name: 'Customer Management',
    description: 'Maintain customer profiles with contact details, purchase history, credit limits, loyalty points, and outstanding balances. Supports customer groups and targeted pricing.',
    howToUse: 'Go to Customers to create and manage customer records. Add contact details, set credit limits if offering credit sales. View purchase history and outstanding balances from the customer detail view. Assign customers to sales in POS for tracking.',
    relatedPages: ['/customers', '/pos', '/sales'],
    keywords: ['customer', 'client', 'contact', 'profile', 'credit limit', 'purchase history', 'customer management'],
  },
  {
    name: 'Loyalty Program',
    description: 'Points-based customer loyalty system with configurable earning rules, tier levels (bronze, silver, gold), rewards catalog, and point redemption at POS.',
    howToUse: 'Set up the loyalty program in Settings > Loyalty. Define points per currency unit, tier thresholds, and rewards. Customers automatically earn points on purchases when assigned to a sale. Points can be redeemed as payment in POS.',
    relatedPages: ['/settings/loyalty', '/customers', '/pos'],
    keywords: ['loyalty', 'points', 'rewards', 'tier', 'membership', 'loyalty program', 'earn points', 'redeem'],
  },
  {
    name: 'Gift Cards',
    description: 'Issue and manage gift cards with customizable amounts. Gift cards can be used as payment method at POS and support partial redemption with remaining balance tracking.',
    howToUse: 'Go to Settings > Gift Cards to create gift cards with specific amounts. Each card gets a unique code. At POS checkout, select Gift Card as payment method and enter the card code. The system deducts from the card balance.',
    relatedPages: ['/settings/gift-cards', '/pos'],
    keywords: ['gift card', 'voucher', 'prepaid card', 'gift certificate', 'store credit'],
  },
  {
    name: 'Work Orders',
    description: 'Create and manage vehicle service job cards with assigned technicians, parts, services, labor hours, and cost tracking. Supports status workflow from draft to completion and invoicing.',
    howToUse: 'Go to Work Orders and create a new order. Select the customer and vehicle (or create new). Add services from your service catalog and parts from inventory. Assign a technician. Update status as work progresses: Draft > Confirmed > In Progress > Completed > Invoiced.',
    relatedPages: ['/work-orders', '/vehicles', '/service-types', '/items', '/appointments'],
    keywords: ['work order', 'job card', 'service job', 'repair', 'maintenance', 'vehicle service', 'workshop'],
  },
  {
    name: 'Appointments',
    description: 'Schedule service appointments with calendar view, time slot management, technician assignment, and automated customer reminders via SMS/email.',
    howToUse: 'Navigate to Appointments and click New Appointment. Select the customer and vehicle, choose a date/time, assign a technician, and add notes. The customer can receive a confirmation notification. Convert confirmed appointments into work orders.',
    relatedPages: ['/appointments', '/work-orders', '/vehicles', '/customers'],
    keywords: ['appointment', 'schedule', 'booking', 'calendar', 'time slot', 'service appointment'],
  },
  {
    name: 'Insurance Estimates',
    description: 'Create detailed insurance claim estimates with itemized parts, labor, paint, and supplementary costs. Generate professional PDF documents for insurance companies.',
    howToUse: 'Go to Insurance Estimates and create a new estimate. Select the vehicle and insurance company. Add damaged areas, required parts, labor operations, and paint work. The system calculates totals with markups. Print or export the estimate for submission to the insurance company.',
    relatedPages: ['/insurance-estimates', '/insurance-companies', '/vehicles'],
    keywords: ['insurance', 'estimate', 'claim', 'body shop', 'collision', 'damage assessment', 'insurance claim'],
  },
  {
    name: 'Kitchen Display System (KDS)',
    description: 'Real-time kitchen order display showing incoming orders with items, modifiers, and special requests. Kitchen staff can mark items as preparing and ready.',
    howToUse: 'Open the Kitchen Display page on a screen in the kitchen. Orders from the restaurant POS appear automatically in real-time. Click on an order to expand details. Mark items as preparing when the chef starts, and ready when done. The waiter is notified when food is ready.',
    relatedPages: ['/restaurant/kitchen', '/restaurant/orders'],
    keywords: ['kitchen', 'kds', 'kitchen display', 'cook', 'preparation', 'order display', 'food ready'],
  },
  {
    name: 'Table Management',
    description: 'Visual table management showing real-time status of all tables (available, occupied, reserved, needs cleaning). Supports table merging and splitting for group dining.',
    howToUse: 'Go to Table Management to see all tables with their current status. Click a table to view the active order or start a new one. Use the Floor Plan page to design your restaurant layout by dragging and positioning tables.',
    relatedPages: ['/restaurant/tables', '/restaurant/floor-plan', '/restaurant/orders'],
    keywords: ['table', 'seating', 'floor plan', 'table status', 'occupy', 'available', 'restaurant tables'],
  },
  {
    name: 'Floor Plan Designer',
    description: 'Visual drag-and-drop restaurant floor plan designer. Create multiple floor sections, position different table shapes, and organize your dining area layout.',
    howToUse: 'Navigate to Floor Plan under the Restaurant module. Drag tables from the palette onto the floor area. Resize and position them to match your physical layout. Create sections for indoor, outdoor, or private dining areas. The floor plan syncs with table management.',
    relatedPages: ['/restaurant/floor-plan', '/restaurant/tables'],
    keywords: ['floor plan', 'layout', 'design', 'table arrangement', 'restaurant layout', 'visual'],
  },
  {
    name: 'Recipes & Food Costing',
    description: 'Define recipes with ingredients, portions, and preparation steps. Automatically calculate food cost per dish based on ingredient prices to determine menu pricing and margins.',
    howToUse: 'Go to Recipes and create a new recipe. Add ingredients from your inventory with exact quantities. The system calculates the cost per serving based on current ingredient prices. Use this to set profitable menu prices and track food cost percentages.',
    relatedPages: ['/restaurant/recipes', '/items', '/restaurant/modifiers'],
    keywords: ['recipe', 'food cost', 'ingredient', 'portion', 'menu pricing', 'cost per dish'],
  },
  {
    name: 'Vehicle Inventory (Dealership)',
    description: 'Manage dealer vehicle stock with VIN tracking, full specifications, pricing (MSRP, invoice, selling price), images, and real-time availability status.',
    howToUse: 'Go to Dealership > Vehicle Inventory to add vehicles. Enter VIN, make/model/year, specifications, and pricing details. Upload photos. Set status as available, reserved, or sold. Track days in stock and total carrying cost.',
    relatedPages: ['/dealership/inventory', '/dealership/sales'],
    keywords: ['vehicle inventory', 'vin', 'dealer stock', 'car lot', 'showroom', 'dealership inventory'],
  },
  {
    name: 'Test Drives',
    description: 'Schedule and manage customer test drives. Record customer details, assign vehicles, track drive duration, and capture customer feedback for follow-up.',
    howToUse: 'Navigate to Dealership > Test Drives. Schedule a test drive by selecting the customer, vehicle, date, and time. After the drive, record customer feedback and interest level. Follow up with prospects who showed interest.',
    relatedPages: ['/dealership/test-drives', '/dealership/inventory', '/customers'],
    keywords: ['test drive', 'demo drive', 'trial', 'vehicle demo', 'schedule drive'],
  },
  {
    name: 'Trade-Ins',
    description: 'Evaluate and manage trade-in vehicles. Record vehicle condition, market value, appraisal details, and apply trade-in value as credit toward new vehicle purchases.',
    howToUse: 'Go to Dealership > Trade-Ins when a customer wants to trade in their vehicle. Enter the vehicle details, perform an appraisal, and set the trade-in value. When completing a vehicle sale, apply the trade-in credit to reduce the purchase price.',
    relatedPages: ['/dealership/trade-ins', '/dealership/sales', '/dealership/inventory'],
    keywords: ['trade-in', 'appraisal', 'valuation', 'part exchange', 'trade in value'],
  },
  {
    name: 'Vehicle Financing',
    description: 'Configure financing options from different lenders with interest rates, term lengths, down payment requirements, and monthly payment calculations.',
    howToUse: 'Set up financing plans in Dealership > Financing. Define lender details, interest rates, available term lengths, and minimum down payments. When completing a vehicle sale, select a financing plan and the system calculates monthly payments for the customer.',
    relatedPages: ['/dealership/financing', '/dealership/sales'],
    keywords: ['financing', 'loan', 'emi', 'monthly payment', 'interest rate', 'lender', 'credit'],
  },
  {
    name: 'Double-Entry Accounting',
    description: 'Full double-entry bookkeeping system with chart of accounts, journal entries, general ledger, trial balance, profit & loss, and balance sheet. Supports auto-posting from sales and purchases.',
    howToUse: 'Start by setting up your Chart of Accounts with the required accounts. Configure Accounting Settings for default accounts and auto-posting. Sales and purchases automatically create GL entries. Use Journal Entries for manual adjustments. View financial statements from the Reports section.',
    relatedPages: ['/accounting/chart-of-accounts', '/accounting/journal-entries', '/accounting/settings', '/accounting/reports/trial-balance', '/accounting/reports/profit-and-loss', '/accounting/reports/balance-sheet'],
    keywords: ['accounting', 'double entry', 'bookkeeping', 'debit', 'credit', 'ledger', 'financial statements'],
  },
  {
    name: 'Chart of Accounts',
    description: 'Hierarchical account tree supporting five root types: Asset, Liability, Equity, Income, and Expense. Create sub-accounts for detailed tracking.',
    howToUse: 'Navigate to Chart of Accounts. The system comes with a default chart that you can customize. Click Add Account to create new accounts under the appropriate root type. Group accounts can contain sub-accounts for organizational hierarchy.',
    relatedPages: ['/accounting/chart-of-accounts', '/accounting/settings'],
    keywords: ['chart of accounts', 'account tree', 'gl accounts', 'asset', 'liability', 'equity', 'income', 'expense'],
  },
  {
    name: 'Journal Entries',
    description: 'Manual double-entry journal entries for adjustments, corrections, accruals, and non-standard transactions. Each entry must have balanced debits and credits.',
    howToUse: 'Go to Journal Entries and click New. Add debit and credit lines selecting the appropriate accounts. The total debits must equal total credits. Add a posting date, reference, and remarks. Submit to post the entry to the general ledger.',
    relatedPages: ['/accounting/journal-entries', '/accounting/journal-entries/new', '/accounting/general-ledger'],
    keywords: ['journal entry', 'manual entry', 'adjustment', 'accrual', 'correction', 'debit credit'],
  },
  {
    name: 'Payroll & Salary Management',
    description: 'End-to-end payroll processing with salary component configuration, salary structures, payroll runs for bulk processing, and individual salary slips with earnings and deduction breakdowns.',
    howToUse: 'First, set up Salary Components (basic pay, allowances, deductions). Create Salary Structures that combine components into templates. Assign structures to employees. Run Payroll to generate salary slips for all employees at once. Review and submit for payment.',
    relatedPages: ['/hr/salary-components', '/hr/salary-structures', '/hr/payroll-runs', '/hr/salary-slips', '/hr/employees'],
    keywords: ['payroll', 'salary', 'wages', 'pay', 'compensation', 'payslip', 'salary processing'],
  },
  {
    name: 'Employee Advances',
    description: 'Manage salary advance requests with approval workflow. Track advance disbursement and automatic deduction from future salary slips.',
    howToUse: 'Employees can request advances from My Portal > My Advances. Managers approve or reject requests. Once approved, the advance is disbursed. The repayment is automatically deducted from subsequent salary slips over the configured number of installments.',
    relatedPages: ['/hr/employee-advances', '/my/advances', '/hr/salary-slips'],
    keywords: ['advance', 'salary advance', 'loan', 'cash advance', 'advance request', 'repayment'],
  },
  {
    name: 'Role-Based Access Control',
    description: 'Granular permission system with predefined roles (owner, manager, cashier, technician, chef, waiter) and specialized roles (accounts_manager, sales_manager, etc.). Each role has specific permissions.',
    howToUse: 'Go to Settings > Staff to manage users and assign roles. Each role has predefined permissions (e.g., cashier can create sales but cannot delete them). Use Module Access to control which modules are visible to each role.',
    relatedPages: ['/settings/staff', '/settings/module-access'],
    keywords: ['role', 'permission', 'access control', 'rbac', 'user role', 'authorization', 'restrict'],
  },
  {
    name: 'Module Access Control',
    description: 'Enable or disable entire feature modules per user role. For example, hide accounting from cashiers or restrict HR to owners only.',
    howToUse: 'Navigate to Settings > Module Access. Toggle modules on/off for each role. Changes take effect immediately. Users will only see sidebar menu items for modules they have access to.',
    relatedPages: ['/settings/module-access', '/settings/staff'],
    keywords: ['module access', 'feature toggle', 'hide module', 'restrict access', 'enable disable'],
  },
  {
    name: 'AI Chat Assistant',
    description: 'Built-in AI assistant that can answer questions about the system, query business data (sales, inventory, customers), and guide users through workflows. Accessible from the chat icon.',
    howToUse: 'Click the chat icon in the bottom-right corner of any page. Ask questions in natural language like "What were today\'s sales?", "Show me low stock items", "How do I create a work order?", or "Where can I find the balance sheet?".',
    relatedPages: ['/dashboard'],
    keywords: ['ai', 'chat', 'assistant', 'help', 'ask', 'question', 'chatbot', 'smart assistant'],
  },
  {
    name: 'Smart Warnings & Anomaly Detection',
    description: 'AI-powered anomaly detection that flags unusual patterns like abnormal discounts, suspicious void rates, price changes, and inventory discrepancies.',
    howToUse: 'Smart warnings appear automatically on the dashboard and relevant pages when anomalies are detected. Review the warnings and take appropriate action. Configure sensitivity in Settings.',
    relatedPages: ['/dashboard', '/settings/ai-logs'],
    keywords: ['smart warning', 'anomaly', 'alert', 'suspicious', 'fraud detection', 'unusual activity'],
  },
  {
    name: 'Multi-Tenant Data Isolation',
    description: 'Each company operates in complete data isolation using Row Level Security (RLS). One user can belong to multiple companies, but data never crosses company boundaries.',
    howToUse: 'This is automatic. When you log in, all data is scoped to your current company. If you have access to multiple companies, switch between them from the account menu. Each company has its own items, customers, sales, and settings.',
    relatedPages: ['/dashboard', '/settings'],
    keywords: ['multi-tenant', 'data isolation', 'rls', 'security', 'separate data', 'company data'],
  },
  {
    name: 'Real-Time Sync (WebSocket)',
    description: 'All pages update in real-time when data changes. If a cashier creates a sale, the dashboard, inventory counts, and reports update instantly for all users without page refresh.',
    howToUse: 'This works automatically. When any user makes changes, all connected users see updates in real-time. A green indicator shows you are connected to the real-time service. If it turns red, data may be stale and a refresh is recommended.',
    relatedPages: ['/dashboard'],
    keywords: ['real-time', 'live update', 'sync', 'websocket', 'instant update', 'auto refresh'],
  },
  {
    name: 'Multi-Currency Support',
    description: 'Support for multiple currencies with automatic formatting based on tenant configuration. Currency is set at the company level and applies to all monetary displays.',
    howToUse: 'Set your default currency in Company Settings. All prices, totals, and reports will display in your configured currency with proper formatting (symbol, decimal places, thousand separators).',
    relatedPages: ['/settings'],
    keywords: ['currency', 'multi-currency', 'exchange', 'money format', 'currency symbol'],
  },
  {
    name: 'Print Templates & Letter Heads',
    description: 'Customizable print layouts for receipts, invoices, work orders, estimates, and reports. Letter heads provide company branding with logo, address, and footer text.',
    howToUse: 'Set up your company branding in Settings > Letter Heads. Then customize print layouts in Settings > Print Templates. You can create multiple templates for different document types (POS receipt vs detailed invoice).',
    relatedPages: ['/settings/print-templates', '/settings/letter-heads'],
    keywords: ['print', 'template', 'receipt', 'invoice', 'letterhead', 'branding', 'print format'],
  },
  {
    name: 'Import/Export',
    description: 'Bulk import items, customers, and suppliers from CSV or Excel files. Export data for backups, external analysis, or migration to other systems.',
    howToUse: 'Go to Settings > Import/Export. Select the data type to import (items, customers, suppliers). Download the template CSV, fill in your data, and upload. The system validates data before importing. For export, select the data type and date range.',
    relatedPages: ['/settings/import-export'],
    keywords: ['import', 'export', 'csv', 'excel', 'bulk upload', 'data migration', 'backup', 'download'],
  },
]

// ============================================================================
// COMMON WORKFLOWS
// ============================================================================

export const COMMON_WORKFLOWS: WorkflowEntry[] = [
  {
    name: 'Creating a Sale (POS)',
    steps: [
      'Open the Point of Sale page.',
      'Scan a barcode or search for items to add them to the cart.',
      'Adjust quantities or apply line-item discounts as needed.',
      'Optionally assign a customer to the sale for tracking and loyalty points.',
      'Click the Pay button when the cart is ready.',
      'Select the payment method (cash, card, split, etc.) and enter the amount.',
      'Complete the sale. The receipt will be generated automatically.',
      'If the customer paid cash, the system calculates and displays the change due.',
    ],
    relatedPages: ['/pos', '/items', '/customers'],
    keywords: ['sell', 'sale', 'pos', 'checkout', 'ring up', 'process sale', 'billing'],
  },
  {
    name: 'Adding a New Item',
    steps: [
      'Go to the Items & Products page.',
      'Click the "New Item" or "+" button.',
      'Enter the item name, SKU (optional), and barcode (optional).',
      'Set the cost price and selling price.',
      'Select a category for organization.',
      'Set the unit of measure (each, kg, liter, etc.).',
      'Optionally configure minimum stock level for reorder alerts.',
      'Upload an image if desired.',
      'Save the item. It will be available in POS and inventory.',
    ],
    relatedPages: ['/items', '/categories'],
    keywords: ['add item', 'new product', 'create item', 'add product', 'new item'],
  },
  {
    name: 'Processing a Return/Refund',
    steps: [
      'Go to Sales Invoices and find the original sale.',
      'Open the sale detail page.',
      'Click the "Return" or "Credit Note" button.',
      'Select the items being returned and enter return quantities.',
      'Choose the refund method (cash, card, store credit).',
      'Confirm the return. Stock will be automatically adjusted.',
      'A credit note is generated and linked to the original invoice.',
    ],
    relatedPages: ['/sales', '/pos'],
    keywords: ['return', 'refund', 'credit note', 'exchange', 'money back', 'return item'],
  },
  {
    name: 'Creating a Work Order (Auto Service)',
    steps: [
      'Go to Work Orders and click "New Work Order".',
      'Select the customer (or create new).',
      'Select or register the vehicle with make, model, year, and registration.',
      'Add services from the service type catalog.',
      'Add parts from inventory that will be used.',
      'Assign a technician to the job.',
      'Set the estimated completion date.',
      'Save as Draft, then confirm when ready to begin.',
      'Update status to In Progress when work starts.',
      'Mark as Completed when done, then create an invoice.',
    ],
    relatedPages: ['/work-orders', '/vehicles', '/service-types', '/items', '/customers'],
    keywords: ['work order', 'job card', 'service job', 'repair order', 'create work order'],
  },
  {
    name: 'Running Payroll',
    steps: [
      'Ensure salary components are set up in HR > Salary Components.',
      'Create salary structures in HR > Salary Structures and assign to employees.',
      'Go to HR > Payroll Runs and click "New Payroll Run".',
      'Select the payroll month/period and employee group.',
      'The system calculates salaries based on assigned structures.',
      'Review each salary slip for accuracy.',
      'Submit the payroll run to generate accounting entries.',
      'Process bank transfers or record cash payments.',
    ],
    relatedPages: ['/hr/payroll-runs', '/hr/salary-components', '/hr/salary-structures', '/hr/salary-slips', '/hr/employees'],
    keywords: ['payroll', 'run payroll', 'salary processing', 'pay employees', 'monthly salary'],
  },
  {
    name: 'Creating a Journal Entry',
    steps: [
      'Go to Accounting > Journal Entries and click "New Entry".',
      'Select the posting date.',
      'Add a debit line: select an account and enter the debit amount.',
      'Add a credit line: select another account and enter the credit amount.',
      'Ensure total debits equal total credits (the system shows a balance indicator).',
      'Add a reference number and remarks for documentation.',
      'Click Submit/Post to record the entry in the general ledger.',
    ],
    relatedPages: ['/accounting/journal-entries/new', '/accounting/journal-entries', '/accounting/chart-of-accounts'],
    keywords: ['journal entry', 'manual entry', 'accounting entry', 'debit credit', 'post entry'],
  },
  {
    name: 'Setting Up a New Company',
    steps: [
      'Register for an account at the registration page.',
      'Enter your company name, business type (retail, restaurant, supermarket, auto_service, dealership), and other details.',
      'Complete email verification.',
      'Log in to your new company workspace.',
      'Go to Settings to configure company details, currency, and logo.',
      'Set up warehouses for inventory management.',
      'Add your items/products to the catalog.',
      'Configure POS profiles for your terminals.',
      'Add staff members and assign roles.',
    ],
    relatedPages: ['/settings', '/settings/warehouses', '/items', '/settings/pos-profiles', '/settings/staff'],
    keywords: ['new company', 'setup', 'onboarding', 'get started', 'configure', 'first time'],
  },
  {
    name: 'Adding Staff Members',
    steps: [
      'Go to Settings > Staff Management.',
      'Click "Add Staff" or "Invite User".',
      'Enter the staff member\'s name, email, and phone number.',
      'Select their role (manager, cashier, technician, chef, waiter, etc.).',
      'Set an initial password or send an invitation email.',
      'The new staff member can now log in with the company slug and their credentials.',
      'Optionally configure Module Access to restrict what they can see.',
    ],
    relatedPages: ['/settings/staff', '/settings/module-access'],
    keywords: ['add staff', 'new user', 'invite', 'add employee', 'create account', 'team member'],
  },
  {
    name: 'Configuring a POS Terminal',
    steps: [
      'Go to Settings > POS Profiles.',
      'Click "New Profile".',
      'Enter a profile name (e.g., "Counter 1", "Drive-thru").',
      'Select the default warehouse for stock deduction.',
      'Choose allowed payment methods.',
      'Set the default customer (optional, for walk-in sales).',
      'Configure receipt format and printer settings.',
      'Assign the profile to specific users if needed.',
      'Save. Users can now select this profile when opening POS.',
    ],
    relatedPages: ['/settings/pos-profiles', '/pos', '/settings/warehouses'],
    keywords: ['pos profile', 'terminal setup', 'configure pos', 'register setup', 'pos configuration'],
  },
  {
    name: 'Processing a Stock Transfer',
    steps: [
      'Go to Stock Transfers and click "New Transfer".',
      'Select the source warehouse (where stock is coming from).',
      'Select the destination warehouse (where stock is going).',
      'Add items to transfer and specify quantities.',
      'Submit the transfer request.',
      'The receiving warehouse confirms receipt of goods.',
      'Stock levels update automatically in both warehouses.',
    ],
    relatedPages: ['/stock-transfers', '/settings/warehouses', '/stock-movements'],
    keywords: ['stock transfer', 'move stock', 'warehouse transfer', 'transfer goods', 'relocate inventory'],
  },
  {
    name: 'Purchase Order Flow (Requisition to Invoice)',
    steps: [
      'Create a Purchase Requisition to request items needed.',
      'Once approved, request Supplier Quotations from one or more vendors.',
      'Use the Compare Quotations page to evaluate supplier offers side-by-side.',
      'Select the best quotation and convert it to a Purchase Order.',
      'Send the Purchase Order to the supplier.',
      'When goods arrive, create a Purchase Invoice from the PO.',
      'Verify received quantities against the order.',
      'Stock levels update automatically upon invoice confirmation.',
      'Record the supplier payment in Payment Entries.',
    ],
    relatedPages: ['/purchase-requisitions', '/supplier-quotations', '/supplier-quotations/compare', '/purchase-orders', '/purchases', '/accounting/payment-entries'],
    keywords: ['purchase order', 'procurement', 'buying flow', 'purchase process', 'requisition', 'quotation', 'order to invoice'],
  },
  {
    name: 'Recording a Vehicle Sale (Dealership)',
    steps: [
      'Go to Dealership > Vehicle Sales and click "New Sale".',
      'Select the vehicle from dealer inventory.',
      'Assign the customer (buyer).',
      'If the customer has a trade-in, record the appraisal and apply the trade-in value.',
      'Select a financing plan if applicable, or record as cash/direct payment.',
      'Add any additional items (accessories, service packages, warranties).',
      'Generate the sale contract and required documents.',
      'Complete the sale. The vehicle status updates to "sold" in inventory.',
    ],
    relatedPages: ['/dealership/sales', '/dealership/inventory', '/dealership/trade-ins', '/dealership/financing', '/customers'],
    keywords: ['vehicle sale', 'car sale', 'sell vehicle', 'dealership sale', 'close deal'],
  },
  {
    name: 'Scheduling a Test Drive (Dealership)',
    steps: [
      'Go to Dealership > Test Drives.',
      'Click "Schedule Test Drive".',
      'Select or create the customer profile.',
      'Choose the vehicle from available inventory.',
      'Set the date, time, and estimated duration.',
      'Assign a sales representative if needed.',
      'Save the booking. An optional confirmation notification can be sent to the customer.',
      'After the test drive, record customer feedback and interest level.',
      'Follow up with interested prospects.',
    ],
    relatedPages: ['/dealership/test-drives', '/dealership/inventory', '/customers'],
    keywords: ['test drive', 'schedule drive', 'book test drive', 'demo appointment'],
  },
  {
    name: 'Managing Table Reservations (Restaurant)',
    steps: [
      'Go to Restaurant > Reservations.',
      'Click "New Reservation".',
      'Enter the guest name, contact number, and party size.',
      'Select the preferred date and time.',
      'The system shows available tables for that time slot.',
      'Assign a table or let the system auto-assign.',
      'Add any special requests or notes (birthday, allergies, etc.).',
      'Save the reservation. It appears on the reservation calendar.',
      'When the guest arrives, mark the reservation as seated.',
    ],
    relatedPages: ['/restaurant/reservations', '/restaurant/tables', '/restaurant/floor-plan'],
    keywords: ['reservation', 'table booking', 'book table', 'restaurant reservation', 'dining booking'],
  },
]

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Calculates a relevance score for a search query against a set of fields.
 * Higher score = better match.
 */
function calculateRelevance(query: string, name: string, description: string, keywords: string[]): number {
  const normalizedQuery = query.toLowerCase().trim()
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 1)

  if (queryWords.length === 0) return 0

  let score = 0
  const normalizedName = name.toLowerCase()
  const normalizedDesc = description.toLowerCase()
  const normalizedKeywords = keywords.map(k => k.toLowerCase())

  // Exact name match (highest priority)
  if (normalizedName === normalizedQuery) {
    score += 100
  }

  // Name contains full query
  if (normalizedName.includes(normalizedQuery)) {
    score += 50
  }

  // Exact keyword match on full query
  if (normalizedKeywords.includes(normalizedQuery)) {
    score += 40
  }

  // Per-word scoring
  for (const word of queryWords) {
    // Word matches in name
    if (normalizedName.includes(word)) {
      score += 15
    }

    // Exact keyword match on individual word
    if (normalizedKeywords.includes(word)) {
      score += 12
    }

    // Partial keyword match (keyword contains the word or vice versa)
    for (const kw of normalizedKeywords) {
      if (kw.includes(word) || word.includes(kw)) {
        score += 6
        break
      }
    }

    // Word matches in description
    if (normalizedDesc.includes(word)) {
      score += 3
    }
  }

  return score
}

/**
 * Check if a user role can access a page based on its required permissions.
 */
function canAccessPage(page: PageEntry, userRole?: string): boolean {
  if (!page.permissions || page.permissions.length === 0) return true
  if (!userRole) return true // If no role specified, don't filter by permission
  return page.permissions.some(perm => hasPermission(userRole, perm))
}

/**
 * Check if a page is applicable to a given business type.
 */
function isApplicableBusinessType(page: PageEntry, businessType?: string): boolean {
  if (!page.businessTypes || page.businessTypes.length === 0) return true
  if (!businessType) return true // If no business type specified, don't filter
  return page.businessTypes.includes(businessType)
}

/**
 * Search pages by query string. Returns top matches sorted by relevance.
 * @param query - Search query string
 * @param businessType - Optional business type filter (e.g., 'auto_service', 'restaurant')
 * @param userRole - Optional user role for permission filtering
 * @returns Top matching pages sorted by relevance
 */
export function searchPages(query: string, businessType?: string, userRole?: string): PageEntry[] {
  if (!query || !query.trim()) return []

  const results = PAGE_REGISTRY
    .filter(page => isApplicableBusinessType(page, businessType))
    .filter(page => canAccessPage(page, userRole))
    .map(page => ({
      page,
      score: calculateRelevance(query, page.name, page.description, page.keywords),
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(r => r.page)

  return results
}

/**
 * Search features by query string. Returns top matches sorted by relevance.
 * @param query - Search query string
 * @returns Top matching features sorted by relevance
 */
export function searchFeatures(query: string): FeatureEntry[] {
  if (!query || !query.trim()) return []

  const results = FEATURE_KNOWLEDGE
    .map(feature => ({
      feature,
      score: calculateRelevance(query, feature.name, feature.description, feature.keywords),
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => r.feature)

  return results
}

/**
 * Search workflows by query string. Returns top matches sorted by relevance.
 * @param query - Search query string
 * @returns Top matching workflows sorted by relevance
 */
export function searchWorkflows(query: string): WorkflowEntry[] {
  if (!query || !query.trim()) return []

  const results = COMMON_WORKFLOWS
    .map(workflow => ({
      workflow,
      score: calculateRelevance(query, workflow.name, workflow.steps.join(' '), workflow.keywords),
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => r.workflow)

  return results
}

/**
 * Get all pages accessible to a specific user based on their business type and role.
 * @param businessType - Business type (e.g., 'retail', 'restaurant', 'auto_service', 'supermarket', 'dealership')
 * @param userRole - User role (e.g., 'owner', 'manager', 'cashier')
 * @returns Array of accessible pages grouped by module
 */
export function getAccessiblePages(businessType: string, userRole: string): PageEntry[] {
  return PAGE_REGISTRY
    .filter(page => isApplicableBusinessType(page, businessType))
    .filter(page => canAccessPage(page, userRole))
}

// ============================================================================
// SYSTEM KNOWLEDGE CATALOG (for LLM tool selection prompts)
// ============================================================================

/**
 * Returns a compact catalog string describing the system knowledge search
 * capabilities. Used in LLM prompts for tool selection.
 */
export function getSystemKnowledgeCatalog(): string {
  const moduleGroups = new Map<string, number>()
  for (const page of PAGE_REGISTRY) {
    moduleGroups.set(page.module, (moduleGroups.get(page.module) || 0) + 1)
  }

  const moduleSummary = Array.from(moduleGroups.entries())
    .map(([mod, count]) => `${mod} (${count} pages)`)
    .join(', ')

  return [
    '=== System Knowledge Base ===',
    `Pages: ${PAGE_REGISTRY.length} registered pages across modules: ${moduleSummary}`,
    `Features: ${FEATURE_KNOWLEDGE.length} documented features with how-to guides`,
    `Workflows: ${COMMON_WORKFLOWS.length} step-by-step workflow guides`,
    '',
    'Available search functions:',
    '- searchPages(query, businessType?, userRole?) - Find pages by name, description, or keywords. Returns paths the user can navigate to.',
    '- searchFeatures(query) - Find feature explanations and how-to-use guides.',
    '- searchWorkflows(query) - Find step-by-step workflow instructions.',
    '- getAccessiblePages(businessType, userRole) - Get all pages a user can access.',
    '',
    'Business types: retail, restaurant, supermarket, auto_service, dealership',
    'User roles: owner, manager, cashier, technician, chef, waiter, system_manager, accounts_manager, sales_manager, purchase_manager, hr_manager, stock_manager, pos_user, report_user',
    '',
    'Use these functions to answer questions like:',
    '- "Where can I find X?" -> searchPages',
    '- "How does X work?" -> searchFeatures',
    '- "How do I do X?" -> searchWorkflows',
    '- "What pages can I access?" -> getAccessiblePages',
  ].join('\n')
}

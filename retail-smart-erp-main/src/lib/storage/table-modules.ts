/**
 * Module-to-table mapping for storage breakdown display.
 * Groups all tenant-scoped tables into business modules with
 * human-readable labels, colors, and byte-per-row estimates.
 *
 * Byte estimates are BASE values (before 1.2× index overhead).
 * The API multiplies by 1.2 when calculating.
 */

export interface TableInfo {
  label: string
  bytesPerRow: number
}

export interface ModuleInfo {
  label: string
  color: string
  tables: Record<string, TableInfo>
}

export const TABLE_MODULES: Record<string, ModuleInfo> = {
  core: {
    label: 'Core & Users',
    color: '#6366f1',
    tables: {
      users: { label: 'Users', bytesPerRow: 500 },
      customers: { label: 'Customers', bytesPerRow: 400 },
      customer_credit_transactions: { label: 'Credit Transactions', bytesPerRow: 200 },
    },
  },

  inventory: {
    label: 'Inventory',
    color: '#f59e0b',
    tables: {
      items: { label: 'Items', bytesPerRow: 600 },
      categories: { label: 'Categories', bytesPerRow: 200 },
      warehouses: { label: 'Warehouses', bytesPerRow: 250 },
      user_warehouses: { label: 'User Warehouses', bytesPerRow: 100 },
      warehouse_stock: { label: 'Warehouse Stock', bytesPerRow: 200 },
      stock_movements: { label: 'Stock Movements', bytesPerRow: 250 },
      stock_transfers: { label: 'Stock Transfers', bytesPerRow: 300 },
      stock_transfer_items: { label: 'Transfer Items', bytesPerRow: 200 },
      stock_takes: { label: 'Stock Takes', bytesPerRow: 300 },
      stock_take_items: { label: 'Stock Take Items', bytesPerRow: 200 },
      item_serial_numbers: { label: 'Serial Numbers', bytesPerRow: 250 },
      serial_number_movements: { label: 'Serial Movements', bytesPerRow: 200 },
      item_batches: { label: 'Batches', bytesPerRow: 250 },
      serial_numbers: { label: 'Serial Numbers (Legacy)', bytesPerRow: 250 },
      part_compatibility: { label: 'Part Compatibility', bytesPerRow: 150 },
    },
  },

  sales: {
    label: 'Sales & POS',
    color: '#22c55e',
    tables: {
      sales: { label: 'Sales', bytesPerRow: 450 },
      sale_items: { label: 'Sale Items', bytesPerRow: 250 },
      payments: { label: 'Payments', bytesPerRow: 300 },
      refunds: { label: 'Refunds', bytesPerRow: 300 },
      held_sales: { label: 'Held Sales', bytesPerRow: 500 },
      sales_orders: { label: 'Sales Orders', bytesPerRow: 400 },
      sales_order_items: { label: 'Sales Order Items', bytesPerRow: 250 },
      layaways: { label: 'Layaways', bytesPerRow: 400 },
      layaway_items: { label: 'Layaway Items', bytesPerRow: 250 },
      layaway_payments: { label: 'Layaway Payments', bytesPerRow: 200 },
      gift_cards: { label: 'Gift Cards', bytesPerRow: 300 },
      gift_card_transactions: { label: 'Gift Card Transactions', bytesPerRow: 200 },
      loyalty_programs: { label: 'Loyalty Programs', bytesPerRow: 250 },
      loyalty_tiers: { label: 'Loyalty Tiers', bytesPerRow: 200 },
      loyalty_transactions: { label: 'Loyalty Transactions', bytesPerRow: 200 },
      commission_rates: { label: 'Commission Rates', bytesPerRow: 200 },
      commissions: { label: 'Commissions', bytesPerRow: 250 },
      commission_payouts: { label: 'Commission Payouts', bytesPerRow: 250 },
    },
  },

  pos: {
    label: 'POS Configuration',
    color: '#06b6d4',
    tables: {
      pos_profiles: { label: 'POS Profiles', bytesPerRow: 200 },
      pos_profile_payment_methods: { label: 'POS Payment Methods', bytesPerRow: 100 },
      pos_profile_users: { label: 'POS Profile Users', bytesPerRow: 100 },
      pos_profile_item_groups: { label: 'POS Item Groups', bytesPerRow: 100 },
      pos_opening_entries: { label: 'Opening Entries', bytesPerRow: 250 },
      pos_opening_balances: { label: 'Opening Balances', bytesPerRow: 150 },
      pos_closing_entries: { label: 'Closing Entries', bytesPerRow: 350 },
      pos_closing_reconciliation: { label: 'Closing Reconciliation', bytesPerRow: 200 },
      pos_shifts: { label: 'POS Shifts', bytesPerRow: 300 },
      day_end_sessions: { label: 'Day End Sessions', bytesPerRow: 200 },
    },
  },

  purchases: {
    label: 'Purchases',
    color: '#f97316',
    tables: {
      suppliers: { label: 'Suppliers', bytesPerRow: 350 },
      purchases: { label: 'Purchases', bytesPerRow: 400 },
      purchase_items: { label: 'Purchase Items', bytesPerRow: 250 },
      purchase_orders: { label: 'Purchase Orders', bytesPerRow: 400 },
      purchase_order_items: { label: 'Purchase Order Items', bytesPerRow: 250 },
      purchase_payments: { label: 'Purchase Payments', bytesPerRow: 200 },
      supplier_balance_audit: { label: 'Supplier Balance Audit', bytesPerRow: 200 },
      purchase_receipts: { label: 'Purchase Receipts', bytesPerRow: 350 },
      purchase_receipt_items: { label: 'Receipt Items', bytesPerRow: 250 },
      purchase_requisitions: { label: 'Purchase Requisitions', bytesPerRow: 400 },
      purchase_requisition_items: { label: 'Requisition Items', bytesPerRow: 250 },
      supplier_quotations: { label: 'Supplier Quotations', bytesPerRow: 400 },
      supplier_quotation_items: { label: 'Quotation Items', bytesPerRow: 250 },
    },
  },

  accounting: {
    label: 'Accounting',
    color: '#3b82f6',
    tables: {
      chart_of_accounts: { label: 'Chart of Accounts', bytesPerRow: 300 },
      gl_entries: { label: 'GL Entries', bytesPerRow: 250 },
      journal_entries: { label: 'Journal Entries', bytesPerRow: 400 },
      journal_entry_items: { label: 'Journal Entry Items', bytesPerRow: 250 },
      recurring_journal_templates: { label: 'Recurring Templates', bytesPerRow: 450 },
      fiscal_years: { label: 'Fiscal Years', bytesPerRow: 200 },
      accounting_settings: { label: 'Accounting Settings', bytesPerRow: 200 },
      cost_centers: { label: 'Cost Centers', bytesPerRow: 200 },
      bank_accounts: { label: 'Bank Accounts', bytesPerRow: 300 },
      bank_transactions: { label: 'Bank Transactions', bytesPerRow: 300 },
      budgets: { label: 'Budgets', bytesPerRow: 300 },
      budget_items: { label: 'Budget Items', bytesPerRow: 200 },
      tax_templates: { label: 'Tax Templates', bytesPerRow: 250 },
      tax_template_items: { label: 'Tax Template Items', bytesPerRow: 200 },
      period_closing_vouchers: { label: 'Period Closing', bytesPerRow: 200 },
      modes_of_payment: { label: 'Modes of Payment', bytesPerRow: 200 },
      payment_terms: { label: 'Payment Terms', bytesPerRow: 250 },
      payment_terms_templates: { label: 'Payment Terms Templates', bytesPerRow: 200 },
      payment_terms_template_items: { label: 'PT Template Items', bytesPerRow: 200 },
      payment_schedules: { label: 'Payment Schedules', bytesPerRow: 200 },
      payment_entries: { label: 'Payment Entries', bytesPerRow: 400 },
      payment_entry_references: { label: 'Payment References', bytesPerRow: 200 },
      payment_entry_deductions: { label: 'Payment Deductions', bytesPerRow: 250 },
      payment_allocations: { label: 'Payment Allocations', bytesPerRow: 200 },
      payment_ledger: { label: 'Payment Ledger', bytesPerRow: 250 },
      payment_requests: { label: 'Payment Requests', bytesPerRow: 350 },
      dunning_types: { label: 'Dunning Types', bytesPerRow: 350 },
      dunnings: { label: 'Dunnings', bytesPerRow: 250 },
      cancellation_reasons: { label: 'Cancellation Reasons', bytesPerRow: 200 },
    },
  },

  work_orders: {
    label: 'Work Orders',
    color: '#ef4444',
    tables: {
      service_type_groups: { label: 'Service Groups', bytesPerRow: 200 },
      service_types: { label: 'Service Types', bytesPerRow: 400 },
      labor_guides: { label: 'Labor Guides', bytesPerRow: 200 },
      work_orders: { label: 'Work Orders', bytesPerRow: 800 },
      work_order_services: { label: 'WO Services', bytesPerRow: 300 },
      work_order_parts: { label: 'WO Parts', bytesPerRow: 300 },
      work_order_assignment_history: { label: 'Assignment History', bytesPerRow: 200 },
      core_returns: { label: 'Core Returns', bytesPerRow: 300 },
      appointments: { label: 'Appointments', bytesPerRow: 350 },
      insurance_companies: { label: 'Insurance Companies', bytesPerRow: 250 },
      insurance_assessors: { label: 'Insurance Assessors', bytesPerRow: 250 },
      insurance_estimates: { label: 'Insurance Estimates', bytesPerRow: 600 },
      insurance_estimate_items: { label: 'Estimate Items', bytesPerRow: 300 },
      insurance_estimate_revisions: { label: 'Estimate Revisions', bytesPerRow: 500 },
      insurance_estimate_attachments: { label: 'Estimate Attachments', bytesPerRow: 250 },
      estimate_templates: { label: 'Estimate Templates', bytesPerRow: 400 },
      activity_logs: { label: 'Activity Logs', bytesPerRow: 300 },
    },
  },

  inspections: {
    label: 'Inspections',
    color: '#0ea5e9',
    tables: {
      inspection_templates: { label: 'Templates', bytesPerRow: 250 },
      inspection_categories: { label: 'Categories', bytesPerRow: 150 },
      inspection_checklist_items: { label: 'Checklist Items', bytesPerRow: 200 },
      vehicle_inspections: { label: 'Inspections', bytesPerRow: 300 },
      inspection_responses: { label: 'Responses', bytesPerRow: 200 },
      inspection_damage_marks: { label: 'Damage Marks', bytesPerRow: 200 },
      inspection_photos: { label: 'Photos', bytesPerRow: 200 },
    },
  },

  restaurant: {
    label: 'Restaurant',
    color: '#ec4899',
    tables: {
      table_groups: { label: 'Table Groups', bytesPerRow: 200 },
      table_group_members: { label: 'Group Members', bytesPerRow: 100 },
      restaurant_tables: { label: 'Tables', bytesPerRow: 200 },
      modifier_groups: { label: 'Modifier Groups', bytesPerRow: 250 },
      modifiers: { label: 'Modifiers', bytesPerRow: 200 },
      modifier_options: { label: 'Modifier Options', bytesPerRow: 150 },
      modifier_group_items: { label: 'Group Items', bytesPerRow: 100 },
      restaurant_orders: { label: 'Orders', bytesPerRow: 400 },
      restaurant_order_items: { label: 'Order Items', bytesPerRow: 250 },
      kitchen_orders: { label: 'Kitchen Orders', bytesPerRow: 250 },
      kitchen_order_items: { label: 'Kitchen Items', bytesPerRow: 200 },
      recipes: { label: 'Recipes', bytesPerRow: 300 },
      recipe_ingredients: { label: 'Ingredients', bytesPerRow: 150 },
      waste_log: { label: 'Waste Log', bytesPerRow: 200 },
      reservations: { label: 'Reservations', bytesPerRow: 300 },
    },
  },

  vehicles: {
    label: 'Vehicles & Dealership',
    color: '#14b8a6',
    tables: {
      vehicles: { label: 'Vehicles', bytesPerRow: 350 },
      vehicle_types: { label: 'Vehicle Types', bytesPerRow: 250 },
      vehicle_type_diagram_views: { label: 'Diagram Views', bytesPerRow: 200 },
      vehicle_ownership_history: { label: 'Ownership History', bytesPerRow: 250 },
      vehicle_inventory: { label: 'Vehicle Inventory', bytesPerRow: 500 },
      test_drives: { label: 'Test Drives', bytesPerRow: 300 },
      trade_in_vehicles: { label: 'Trade-Ins', bytesPerRow: 300 },
      financing_options: { label: 'Financing Options', bytesPerRow: 300 },
      vehicle_sale_details: { label: 'Sale Details', bytesPerRow: 350 },
      vehicle_warranties: { label: 'Warranties', bytesPerRow: 300 },
      dealers: { label: 'Dealers', bytesPerRow: 300 },
      vehicle_imports: { label: 'Imports', bytesPerRow: 450 },
      dealer_allocations: { label: 'Allocations', bytesPerRow: 250 },
      vehicle_expenses: { label: 'Vehicle Expenses', bytesPerRow: 250 },
      dealership_inspections: { label: 'Inspections', bytesPerRow: 400 },
      dealer_payments: { label: 'Dealer Payments', bytesPerRow: 250 },
      vehicle_documents: { label: 'Documents', bytesPerRow: 250 },
      dealership_services: { label: 'Dealership Services', bytesPerRow: 300 },
    },
  },

  hr: {
    label: 'HR & Payroll',
    color: '#8b5cf6',
    tables: {
      employee_profiles: { label: 'Employees', bytesPerRow: 400 },
      salary_components: { label: 'Salary Components', bytesPerRow: 300 },
      salary_structures: { label: 'Salary Structures', bytesPerRow: 300 },
      salary_structure_components: { label: 'Structure Components', bytesPerRow: 200 },
      salary_slips: { label: 'Salary Slips', bytesPerRow: 400 },
      salary_slip_components: { label: 'Slip Components', bytesPerRow: 200 },
      payroll_runs: { label: 'Payroll Runs', bytesPerRow: 300 },
      employee_advances: { label: 'Advances', bytesPerRow: 250 },
      advance_recovery_records: { label: 'Recovery Records', bytesPerRow: 150 },
    },
  },

  system: {
    label: 'Settings & System',
    color: '#64748b',
    tables: {
      module_access: { label: 'Module Access', bytesPerRow: 150 },
      settings: { label: 'Settings', bytesPerRow: 200 },
      workspace_configs: { label: 'Workspace Configs', bytesPerRow: 350 },
      setup_progress: { label: 'Setup Progress', bytesPerRow: 250 },
      subscriptions: { label: 'Subscriptions', bytesPerRow: 250 },
      lockout_events: { label: 'Lockout Events', bytesPerRow: 250 },
      storage_alerts: { label: 'Storage Alerts', bytesPerRow: 200 },
      sms_settings: { label: 'SMS Settings', bytesPerRow: 300 },
      email_settings: { label: 'Email Settings', bytesPerRow: 200 },
      notification_templates: { label: 'Notification Templates', bytesPerRow: 300 },
      notification_logs: { label: 'Notification Logs', bytesPerRow: 300 },
      notification_usage: { label: 'Notification Usage', bytesPerRow: 150 },
      letter_heads: { label: 'Letter Heads', bytesPerRow: 400 },
      print_templates: { label: 'Print Templates', bytesPerRow: 400 },
      label_templates: { label: 'Label Templates', bytesPerRow: 500 },
      saved_reports: { label: 'Saved Reports', bytesPerRow: 350 },
      ai_error_logs: { label: 'AI Error Logs', bytesPerRow: 500 },
      ai_alerts: { label: 'AI Alerts', bytesPerRow: 300 },
      ai_chat_messages: { label: 'AI Chat Messages', bytesPerRow: 350 },
      document_tags: { label: 'Document Tags', bytesPerRow: 150 },
      staff_chat_conversations: { label: 'Chat Conversations', bytesPerRow: 250 },
      staff_chat_participants: { label: 'Chat Participants', bytesPerRow: 100 },
      staff_chat_messages: { label: 'Chat Messages', bytesPerRow: 300 },
    },
  },

  files: {
    label: 'Files & Documents',
    color: '#84cc16',
    tables: {
      files: { label: 'Files', bytesPerRow: 300 },
      file_versions: { label: 'File Versions', bytesPerRow: 250 },
      collections: { label: 'Collections', bytesPerRow: 200 },
      collection_files: { label: 'Collection Files', bytesPerRow: 100 },
      file_audit_logs: { label: 'File Audit Logs', bytesPerRow: 250 },
    },
  },
}

/**
 * Tables that have tenant_id but are NOT tenant content data.
 * Excluded from storage quota calculations in both SQL and TypeScript.
 */
export const EXCLUDED_TENANT_TABLES = new Set([
  'account_sessions',    // Session management
  'account_tenants',     // Account-tenant junction
  'tenant_usage',        // Meta tracking (would count itself)
  'subscription_payments', // Billing data
])

/** Index: table name → module key (built once at import time) */
const tableToModule: Record<string, string> = {}
for (const [moduleKey, mod] of Object.entries(TABLE_MODULES)) {
  for (const tableName of Object.keys(mod.tables)) {
    tableToModule[tableName] = moduleKey
  }
}

/** Find which module a table belongs to. Returns 'other' if not mapped. */
export function getModuleForTable(tableName: string): string {
  return tableToModule[tableName] || 'other'
}

/** Get a human-readable label for a table name. Falls back to title-cased name. */
export function getTableLabel(tableName: string): string {
  for (const mod of Object.values(TABLE_MODULES)) {
    if (mod.tables[tableName]) return mod.tables[tableName].label
  }
  return tableName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Get byte estimate for a table (base, before 1.2× overhead). */
export function getBytesPerRow(tableName: string): number {
  for (const mod of Object.values(TABLE_MODULES)) {
    if (mod.tables[tableName]) return mod.tables[tableName].bytesPerRow
  }
  return 250 // default
}

/** File MIME type → category for file breakdown chart */
export function getFileCategory(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'Images'
  if (mimeType === 'application/pdf') return 'Documents'
  if (mimeType.startsWith('application/vnd.')) return 'Documents'
  if (mimeType.startsWith('text/')) return 'Documents'
  return 'Other'
}

/** Colors for file categories */
export const FILE_CATEGORY_COLORS: Record<string, string> = {
  'Documents': '#3b82f6',
  'Images': '#22c55e',
  'Item Images': '#f59e0b',
  'Logos': '#a855f7',
  'Other': '#64748b',
}

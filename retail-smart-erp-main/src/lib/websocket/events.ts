// WebSocket event type definitions

export type EntityType =
  | 'item'
  | 'service'
  | 'service-type'
  | 'service-type-group'
  | 'category'
  | 'work-order'
  | 'sale'
  | 'appointment'
  | 'customer'
  | 'vehicle'
  | 'estimate'
  | 'supplier'
  | 'purchase'
  | 'purchase-order'
  | 'purchase-receipt'
  | 'stock-take'
  | 'item-batch'
  | 'purchase-requisition'
  | 'supplier-quotation'
  | 'table'
  | 'reservation'
  | 'user'
  | 'vehicle-type'
  | 'inspection-template'
  | 'insurance-company'
  | 'insurance-assessor'
  | 'estimate-template'
  | 'held-sale'
  | 'settings'
  | 'tenant'
  | 'warehouse'
  | 'warehouse-stock'
  | 'stock-transfer'
  | 'pos-profile'
  | 'pos-shift'
  | 'pos-closing'
  | 'notification-template'
  | 'notification-log'
  | 'sms-settings'
  | 'email-settings'
  | 'loyalty-program'
  | 'file'
  | 'workspace'
  | 'gift-card'
  | 'layaway'
  | 'restaurant-order'
  | 'kitchen-order'
  | 'commission'
  | 'commission-rate'
  | 'commission-payout'
  | 'sales-order'
  | 'stock-movement'
  | 'recipe'
  | 'waste-log'
  | 'labor-guide'
  | 'account'
  | 'accounting-settings'
  | 'gl-entry'
  | 'journal-entry'
  | 'fiscal-year'
  | 'bank-account'
  | 'bank-transaction'
  | 'budget'
  | 'tax-template'
  | 'cost-center'
  | 'period-closing'
  | 'payment-entry'
  | 'payment-term'
  | 'payment-terms-template'
  | 'mode-of-payment'
  | 'payment-request'
  | 'dunning'
  | 'dunning-type'
  | 'ai-alert'
  | 'ai-error'
  | 'audit-progress'
  | 'employee-profile'
  | 'salary-component'
  | 'salary-structure'
  | 'salary-slip'
  | 'payroll-run'
  | 'employee-advance'
  | 'module-access'
  | 'letter-head'
  | 'print-template'
  | 'staff-chat'
  | 'recurring-entry'
  | 'modifier-group'
  | 'table-group'
  | 'serial-number'
  | 'vehicle-inventory'
  | 'test-drive'
  | 'trade-in'
  | 'financing-option'
  | 'vehicle-warranty'
  | 'vehicle-sale'
  | 'vehicle-import'
  | 'vehicle-inspection'
  | 'vehicle-document'
  | 'dealer-allocation'
  | 'dealer-payment'
  | 'dealer'
  | 'vehicle-expense'
  | 'saved-report'
  | 'collection'
  | 'vehicle-make'
  | 'vehicle-model'
  | 'staff-invite'
  | 'import-job'
  | 'item-supplier-cost'
  | 'item-cost-history'
  | 'label-template'
  // Account-level entity types (not tenant-scoped)
  | 'account-notification'
  | 'account-wallet'
  | 'account-message'
  | 'account-subscription'
  | 'account-site'
  | 'account-billing'
  | 'account-usage'

export type ActionType = 'created' | 'updated' | 'deleted'

export interface DataChangeEvent {
  type: EntityType
  action: ActionType
  tenantId?: string  // optional for account-level events
  userId?: string    // target user for account-level events
  id: string
  data?: Record<string, unknown>
  timestamp: number
}

export interface PresenceEvent {
  type: 'presence'
  action: 'joined' | 'left' | 'editing'
  userId: string
  userName: string
  resource: string // e.g., 'work-order:123'
  timestamp: number
}

export interface SubscribeMessage {
  type: 'subscribe'
  channels: string[]
}

export interface UnsubscribeMessage {
  type: 'unsubscribe'
  channels: string[]
}

export interface PingMessage {
  type: 'ping'
}

export interface PongMessage {
  type: 'pong'
}

export interface ErrorMessage {
  type: 'error'
  message: string
  code?: string
}

export interface AuthenticatedMessage {
  type: 'authenticated'
  tenantId?: string
  userId: string
  mode: 'tenant' | 'account'
}

export interface AuthenticateMessage {
  type: 'authenticate'
  token: string
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage | AuthenticateMessage

export type ServerMessage =
  | DataChangeEvent
  | PresenceEvent
  | PongMessage
  | ErrorMessage
  | AuthenticatedMessage

// Map database table names to entity types
export const tableToEntityMap: Record<string, EntityType> = {
  items: 'item',
  service_types: 'service',
  service_type_groups: 'service-type-group',
  categories: 'category',
  work_orders: 'work-order',
  sales: 'sale',
  appointments: 'appointment',
  customers: 'customer',
  vehicles: 'vehicle',
  insurance_estimates: 'estimate',
  suppliers: 'supplier',
  purchases: 'purchase',
  purchase_orders: 'purchase-order',
  purchase_receipts: 'purchase-receipt',
  stock_takes: 'stock-take',
  item_batches: 'item-batch',
  restaurant_tables: 'table',
  reservations: 'reservation',
  users: 'user',
  vehicle_types: 'vehicle-type',
  inspection_templates: 'inspection-template',
  insurance_companies: 'insurance-company',
  insurance_assessors: 'insurance-assessor',
  estimate_templates: 'estimate-template',
  held_sales: 'held-sale',
  print_settings: 'settings',
  warehouses: 'warehouse',
  warehouse_stock: 'warehouse-stock',
  stock_transfers: 'stock-transfer',
  pos_profiles: 'pos-profile',
  pos_opening_entries: 'pos-shift',
  pos_closing_entries: 'pos-closing',
  notification_templates: 'notification-template',
  notification_logs: 'notification-log',
  sms_settings: 'sms-settings',
  email_settings: 'email-settings',
  loyalty_programs: 'loyalty-program',
  files: 'file',
  workspace_configs: 'workspace',
  gift_cards: 'gift-card',
  layaways: 'layaway',
  restaurant_orders: 'restaurant-order',
  kitchen_orders: 'kitchen-order',
  commissions: 'commission',
  commission_rates: 'commission-rate',
  commission_payouts: 'commission-payout',
  sales_orders: 'sales-order',
  stock_movements: 'stock-movement',
  recipes: 'recipe',
  waste_logs: 'waste-log',
  labor_guides: 'labor-guide',
  chart_of_accounts: 'account',
  gl_entries: 'gl-entry',
  journal_entries: 'journal-entry',
  fiscal_years: 'fiscal-year',
  bank_accounts: 'bank-account',
  bank_transactions: 'bank-transaction',
  budgets: 'budget',
  tax_templates: 'tax-template',
  cost_centers: 'cost-center',
  period_closing_vouchers: 'period-closing',
  payment_entries: 'payment-entry',
  payment_terms: 'payment-term',
  payment_terms_templates: 'payment-terms-template',
  modes_of_payment: 'mode-of-payment',
  payment_requests: 'payment-request',
  dunnings: 'dunning',
  dunning_types: 'dunning-type',
  ai_alerts: 'ai-alert',
  ai_error_logs: 'ai-error',
  employee_profiles: 'employee-profile',
  salary_components: 'salary-component',
  salary_structures: 'salary-structure',
  salary_slips: 'salary-slip',
  payroll_runs: 'payroll-run',
  employee_advances: 'employee-advance',
  module_access: 'module-access',
  staff_chat_messages: 'staff-chat',
  recurring_journal_templates: 'recurring-entry',
  purchase_requisitions: 'purchase-requisition',
  supplier_quotations: 'supplier-quotation',
  modifier_groups: 'modifier-group',
  table_groups: 'table-group',
  item_serial_numbers: 'serial-number',
  vehicle_inventory: 'vehicle-inventory',
  test_drives: 'test-drive',
  trade_in_valuations: 'trade-in',
  financing_options: 'financing-option',
  vehicle_warranties: 'vehicle-warranty',
  vehicle_sales: 'vehicle-sale',
  vehicle_imports: 'vehicle-import',
  dealership_inspections: 'vehicle-inspection',
  vehicle_documents: 'vehicle-document',
  dealer_allocations: 'dealer-allocation',
  dealer_payments: 'dealer-payment',
  dealers: 'dealer',
  vehicle_expenses: 'vehicle-expense',
  vehicle_makes: 'vehicle-make',
  vehicle_models: 'vehicle-model',
  staff_invites: 'staff-invite',
  tenants: 'tenant',
  accounting_settings: 'accounting-settings',
  letter_heads: 'letter-head',
  print_templates: 'print-template',
  saved_reports: 'saved-report',
  collections: 'collection',
  item_supplier_costs: 'item-supplier-cost',
  item_cost_history: 'item-cost-history',
  label_templates: 'label-template',
}

import { pgTable, uuid, varchar, text, timestamp, decimal, integer, boolean, jsonb, date, time, pgEnum, uniqueIndex, bigint, real } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ==================== ENUMS ====================

export const planEnum = pgEnum('plan', ['trial', 'basic', 'standard', 'premium'])
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'cancelled', 'locked'])
export const businessTypeEnum = pgEnum('business_type', ['retail', 'restaurant', 'supermarket', 'auto_service', 'dealership'])
export const userRoleEnum = pgEnum('user_role', [
  'owner', 'manager', 'cashier', 'technician', 'chef', 'waiter',
  'system_manager', 'accounts_manager', 'sales_manager', 'purchase_manager',
  'hr_manager', 'stock_manager', 'pos_user', 'report_user', 'dealer_sales'
])
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'card', 'bank_transfer', 'credit', 'gift_card'])
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'credit' | 'gift_card'
export const saleStatusEnum = pgEnum('sale_status', ['pending', 'partial', 'completed', 'void'])
export const workOrderStatusEnum = pgEnum('work_order_status', ['draft', 'confirmed', 'in_progress', 'completed', 'invoiced', 'cancelled'])
export const appointmentStatusEnum = pgEnum('appointment_status', ['scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'])
export const reservationStatusEnum = pgEnum('reservation_status', ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'])
export const tableStatusEnum = pgEnum('table_status', ['available', 'occupied', 'reserved', 'unavailable'])
export const orderTypeEnum = pgEnum('order_type', ['dine_in', 'takeaway', 'delivery'])
export const deliveryStatusEnum = pgEnum('delivery_status', ['pending', 'dispatched', 'in_transit', 'delivered', 'failed'])
export const kitchenOrderStatusEnum = pgEnum('kitchen_order_status', ['pending', 'preparing', 'ready', 'served', 'cancelled'])
export const stockMovementTypeEnum = pgEnum('stock_movement_type', ['in', 'out', 'adjustment'])
export const layawayStatusEnum = pgEnum('layaway_status', ['active', 'fully_paid', 'completed', 'cancelled', 'forfeited'])
export const giftCardStatusEnum = pgEnum('gift_card_status', ['inactive', 'active', 'used', 'expired', 'blocked'])
export const loyaltyTierEnum = pgEnum('loyalty_tier', ['bronze', 'silver', 'gold', 'platinum'])
export const commissionStatusEnum = pgEnum('commission_status', ['pending', 'approved', 'paid', 'cancelled'])
export const payoutStatusEnum = pgEnum('payout_status', ['draft', 'approved', 'paid', 'cancelled'])
export const coreReturnStatusEnum = pgEnum('core_return_status', ['pending', 'returned', 'forfeited'])

// Insurance Estimate enums
export const estimateTypeEnum = pgEnum('estimate_type', ['insurance', 'direct'])
export const insuranceEstimateStatusEnum = pgEnum('insurance_estimate_status', [
  'draft', 'submitted', 'under_review', 'approved',
  'partially_approved', 'rejected', 'work_order_created', 'cancelled'
])
export const estimateItemStatusEnum = pgEnum('estimate_item_status', [
  'pending', 'approved', 'price_adjusted', 'rejected', 'requires_reinspection'
])
export const estimateItemTypeEnum = pgEnum('estimate_item_type', ['service', 'part'])

// Vehicle Body Type enum
export const vehicleBodyTypeEnum = pgEnum('vehicle_body_type', [
  'motorcycle', 'scooter', 'three_wheeler',
  'sedan', 'hatchback', 'suv', 'pickup', 'van',
  'coupe', 'wagon', 'convertible', 'mini_truck',
  'lorry', 'bus', 'other'
])

// Vehicle Inspection enums
export const inspectionTypeEnum = pgEnum('inspection_type', ['check_in', 'check_out'])
export const inspectionStatusEnum = pgEnum('inspection_status', ['draft', 'completed'])
export const checklistResponseEnum = pgEnum('checklist_response', ['ok', 'concern', 'fail', 'na'])
export const damageTypeEnum = pgEnum('damage_type', [
  'scratch', 'dent', 'crack', 'rust', 'paint', 'broken', 'missing', 'other'
])
export const damageSeverityEnum = pgEnum('damage_severity', ['minor', 'moderate', 'severe'])
export const checklistItemTypeEnum = pgEnum('checklist_item_type', ['checkbox', 'select', 'text', 'number'])

// A17: Recurring Appointment enums
export const recurrencePatternEnum = pgEnum('recurrence_pattern', ['none', 'daily', 'weekly', 'biweekly', 'monthly'])

// X4: Activity log enum
export const activityActionEnum = pgEnum('activity_action', [
  'create', 'update', 'delete', 'status_change',
  'submit', 'approve', 'reject', 'cancel', 'convert',
  'login', 'logout', 'print', 'export', 'import'
])

// Multi-company support enums
export const subscriptionStatusEnum = pgEnum('subscription_status', ['trial', 'active', 'past_due', 'cancelled', 'locked'])
export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'pending', 'paid', 'failed'])
export const paymentDepositStatusEnum = pgEnum('payment_deposit_status', ['pending', 'approved', 'rejected'])

// PayHere transaction status enum
export const payhereTransactionStatusEnum = pgEnum('payhere_transaction_status', ['pending', 'success', 'failed', 'cancelled', 'refunded', 'charged_back'])

// Lockout event type enum
export const lockoutEventTypeEnum = pgEnum('lockout_event_type', [
  'trial_expiring', 'trial_expired', 'storage_warning', 'storage_critical',
  'subscription_expiring', 'subscription_expired',
  'locked', 'deletion_warning', 'deleted', 'unlocked'
])

// Admin security enums
export const adminAuditActionEnum = pgEnum('admin_audit_action', [
  'login', 'logout', 'view', 'create', 'update', 'delete', 'approve', 'reject', 'extend'
])

// Pending company status enum
export const pendingCompanyStatusEnum = pgEnum('pending_company_status', [
  'pending_payment', 'pending_approval', 'approved', 'rejected', 'expired'
])

// Stock transfer status enum
export const stockTransferStatusEnum = pgEnum('stock_transfer_status', [
  'draft', 'pending_approval', 'approved', 'in_transit', 'completed', 'cancelled', 'rejected'
])

// Purchase order status enum (similar to estimates workflow)
// Workflow: draft → submitted → confirmed → partially_received/fully_received → invoice_created → (cancelled)
export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'draft', 'submitted', 'confirmed', 'partially_received', 'fully_received', 'invoice_created', 'cancelled'
])

// Sales order status enum
// Workflow: draft → confirmed → partially_fulfilled/fulfilled → (cancelled)
export const salesOrderStatusEnum = pgEnum('sales_order_status', [
  'draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled'
])

// Purchase invoice status enum
export const purchaseStatusEnum = pgEnum('purchase_status', [
  'draft', 'pending', 'partial', 'paid', 'cancelled'
])

// Purchase receipt (GRN) status enum
export const purchaseReceiptStatusEnum = pgEnum('purchase_receipt_status', [
  'draft', 'completed', 'cancelled'
])

// Stock take status enum
export const stockTakeStatusEnum = pgEnum('stock_take_status', [
  'draft', 'in_progress', 'pending_review', 'completed', 'cancelled'
])

// Batch status enum
export const batchStatusEnum = pgEnum('batch_status', [
  'active', 'quarantine', 'expired', 'consumed'
])

export const serialNumberStatusEnum = pgEnum('serial_number_status', [
  'available', 'reserved', 'sold', 'returned', 'defective', 'scrapped', 'lost'
])

export const purchaseRequisitionStatusEnum = pgEnum('purchase_requisition_status', [
  'draft', 'pending_approval', 'approved', 'partially_ordered', 'ordered', 'rejected', 'cancelled'
])

export const supplierQuotationStatusEnum = pgEnum('supplier_quotation_status', [
  'draft', 'submitted', 'received', 'awarded', 'rejected', 'expired', 'cancelled'
])

// Cost change source enum
export const costChangeSourceEnum = pgEnum('cost_change_source', [
  'purchase', 'purchase_cancellation', 'manual_adjustment', 'purchase_return'
])

// ==================== HR & PAYROLL ENUMS ====================

export const employmentTypeEnum = pgEnum('employment_type', ['full_time', 'part_time', 'contract', 'intern', 'probation'])
export const employmentStatusEnum = pgEnum('employment_status', ['active', 'on_leave', 'suspended', 'terminated', 'resigned'])
export const salaryComponentTypeEnum = pgEnum('salary_component_type', ['earning', 'deduction'])
export const salarySlipStatusEnum = pgEnum('salary_slip_status', ['draft', 'submitted', 'cancelled'])
export const payrollRunStatusEnum = pgEnum('payroll_run_status', ['draft', 'processing', 'completed', 'failed', 'cancelled'])
export const employeeAdvanceStatusEnum = pgEnum('employee_advance_status', [
  'draft', 'pending_approval', 'approved', 'disbursed', 'partially_recovered', 'fully_recovered', 'cancelled'
])

// ==================== ACCOUNTING MODULE ====================

// Account root types (balance sheet classification)
export const accountRootTypeEnum = pgEnum('account_root_type', ['asset', 'liability', 'income', 'expense', 'equity'])

// Account types (specific classifications)
export const accountTypeEnum = pgEnum('account_type', [
  'bank', 'cash', 'receivable', 'payable', 'stock', 'cost_of_goods_sold',
  'income_account', 'expense_account', 'tax', 'fixed_asset', 'depreciation',
  'accumulated_depreciation', 'equity', 'round_off', 'temporary',
  'current_asset', 'current_liability', 'capital_work_in_progress'
])

// GL entry party types
export const partyTypeEnum = pgEnum('party_type', ['customer', 'supplier', 'employee'])

// Journal entry types
export const journalEntryTypeEnum = pgEnum('journal_entry_type', ['journal', 'opening', 'adjustment', 'depreciation', 'closing'])

// Journal entry status
export const journalEntryStatusEnum = pgEnum('journal_entry_status', ['draft', 'submitted', 'cancelled'])

// Bank transaction status
export const bankTransactionStatusEnum = pgEnum('bank_transaction_status', ['unmatched', 'matched', 'reconciled'])

// Budget control action
export const budgetControlActionEnum = pgEnum('budget_control_action', ['warn', 'stop', 'ignore'])

// Budget status
export const budgetStatusEnum = pgEnum('budget_status', ['draft', 'active', 'cancelled'])

// Period closing status
export const periodClosingStatusEnum = pgEnum('period_closing_status', ['draft', 'submitted'])

// ==================== MULTI-COMPANY SUPPORT ====================

// Global user accounts (cross-tenant identity)
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull().unique(),
  country: varchar('country', { length: 2 }).notNull().default('LK'), // ISO 3166-1 alpha-2
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'), // ISO 4217
  // Preferences
  language: varchar('language', { length: 10 }).notNull().default('en'),
  timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Colombo'),
  dateFormat: varchar('date_format', { length: 20 }).notNull().default('DD/MM/YYYY'),
  theme: varchar('theme', { length: 20 }).notNull().default('system'), // 'light', 'dark', 'system'
  // Notification preferences
  notifyEmail: boolean('notify_email').notNull().default(true),
  notifyBilling: boolean('notify_billing').notNull().default(true),
  notifySecurity: boolean('notify_security').notNull().default(true),
  notifyMarketing: boolean('notify_marketing').notNull().default(false),
  // Wallet balance
  walletBalance: decimal('wallet_balance', { precision: 10, scale: 2 }).notNull().default('0'),
  googleId: varchar('google_id', { length: 255 }),
  tosAcceptedAt: timestamp('tos_accepted_at'),
  emailVerified: boolean('email_verified').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  deactivatedAt: timestamp('deactivated_at'),
  deactivationReason: text('deactivation_reason'),
  avatarUrl: text('avatar_url'),
  passwordChangedAt: timestamp('password_changed_at'),
  lastLoginAt: timestamp('last_login_at'),
  lastActiveAt: timestamp('last_active_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Active login sessions for session management & revocation
export const accountSessions = pgTable('account_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
  scope: varchar('scope', { length: 20 }).notNull().default('company'), // 'account' | 'company'
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  tenantSlug: varchar('tenant_slug', { length: 100 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  deviceName: varchar('device_name', { length: 255 }),
  lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
  isRevoked: boolean('is_revoked').notNull().default(false),
  revokedAt: timestamp('revoked_at'),
  revokedReason: varchar('revoked_reason', { length: 100 }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Pricing tiers for subscriptions
export const pricingTiers = pgTable('pricing_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull(), // 'trial', 'starter', 'professional', 'business', 'enterprise'
  displayName: varchar('display_name', { length: 100 }).notNull(),
  priceMonthly: decimal('price_monthly', { precision: 10, scale: 2 }),
  priceYearly: decimal('price_yearly', { precision: 10, scale: 2 }),
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'), // ISO 4217 currency code
  maxUsers: integer('max_users'),
  maxSalesMonthly: integer('max_sales_monthly'),
  maxDatabaseBytes: bigint('max_database_bytes', { mode: 'number' }),
  maxFileStorageBytes: bigint('max_file_storage_bytes', { mode: 'number' }),
  features: jsonb('features').default('{}'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== MULTI-TENANT CORE ====================

// Tenants (Your customers - the businesses)
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(), // subdomain
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  address: text('address'),
  logoUrl: text('logo_url'),
  logoSize: integer('logo_size'), // Logo file size in bytes (for storage tracking)
  businessType: businessTypeEnum('business_type').notNull().default('retail'),
  country: varchar('country', { length: 2 }).notNull().default('LK'), // ISO 3166-1 alpha-2
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'), // ISO 4217
  dateFormat: varchar('date_format', { length: 20 }).notNull().default('DD/MM/YYYY'),
  timeFormat: varchar('time_format', { length: 10 }).notNull().default('12h'),
  timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Colombo'),
  plan: planEnum('plan').notNull().default('trial'),
  planExpiresAt: timestamp('plan_expires_at'),
  status: tenantStatusEnum('status').notNull().default('active'),
  settings: jsonb('settings').default('{}'), // TODO: Currently unused — reserved for future tenant-level config
  // DEPRECATED: Legacy flat-rate tax. Use tax templates via accountingSettings instead.
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxInclusive: boolean('tax_inclusive').notNull().default(false),
  // AI opt-in (per-tenant consent required for third-party AI features)
  aiEnabled: boolean('ai_enabled').notNull().default(false),
  aiConsentAcceptedAt: timestamp('ai_consent_accepted_at'),
  // Multi-company support
  primaryOwnerId: uuid('primary_owner_id'), // References accounts.id (nullable for migration)
  // Setup wizard
  setupCompletedAt: timestamp('setup_completed_at'),
  // Lockout fields
  lockedAt: timestamp('locked_at'),
  lockedReason: varchar('locked_reason', { length: 50 }), // 'trial_expired', 'storage_full', 'subscription_expired'
  deletionScheduledAt: timestamp('deletion_scheduled_at'),
  lastWarningSentAt: timestamp('last_warning_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Subscription Plans
export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  priceMonthly: decimal('price_monthly', { precision: 10, scale: 2 }).notNull(),
  maxUsers: integer('max_users'),
  maxWorkOrdersMonthly: integer('max_work_orders_monthly'),
  features: jsonb('features').default('[]'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Subscription Payments
export const subscriptionPayments = pgTable('subscription_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  planId: uuid('plan_id').references(() => subscriptionPlans.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 50 }),
  paymentReference: varchar('payment_reference', { length: 255 }),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Account-to-Tenant memberships
export const accountTenants = pgTable('account_tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  role: userRoleEnum('role').notNull().default('cashier'),
  isOwner: boolean('is_owner').notNull().default(false), // Can manage billing
  isActive: boolean('is_active').notNull().default(true),
  invitedBy: uuid('invited_by'), // References accounts.id
  acceptedAt: timestamp('accepted_at'),
  customRoleId: uuid('custom_role_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Staff invitations (multi-company)
export const staffInvites = pgTable('staff_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  tenantAssignments: jsonb('tenant_assignments').notNull(), // [{tenantId, role}]
  invitedBy: uuid('invited_by').references(() => accounts.id),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Subscriptions (per-tenant)
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  billingAccountId: uuid('billing_account_id').notNull().references(() => accounts.id),
  tierId: uuid('tier_id').notNull().references(() => pricingTiers.id),
  status: subscriptionStatusEnum('status').notNull().default('trial'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  trialEndsAt: timestamp('trial_ends_at'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  overrideDatabaseBytes: bigint('override_database_bytes', { mode: 'number' }),
  overrideFileStorageBytes: bigint('override_file_storage_bytes', { mode: 'number' }),
  billingCycle: varchar('billing_cycle', { length: 20 }).default('monthly'),
  payhereSubscriptionId: varchar('payhere_subscription_id', { length: 100 }),
  lastPaymentAt: timestamp('last_payment_at'),
  subscribedPriceMonthly: decimal('subscribed_price_monthly', { precision: 10, scale: 2 }),
  subscribedPriceYearly: decimal('subscribed_price_yearly', { precision: 10, scale: 2 }),
  priceLockedAt: timestamp('price_locked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Account Subscription Credits — remaining time saved when a company is deleted mid-plan
export const accountSubscriptionCredits = pgTable('account_subscription_credits', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  tierId: uuid('tier_id').notNull().references(() => pricingTiers.id),
  billingCycle: varchar('billing_cycle', { length: 20 }).notNull().default('monthly'),
  type: varchar('type', { length: 20 }).notNull().default('trial'), // 'trial' | 'paid'
  remainingDays: integer('remaining_days').notNull(),
  originalEnd: timestamp('original_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  usedAt: timestamp('used_at'),
  usedTenantId: uuid('used_tenant_id'),
})

// Tenant Usage Tracking (auto-updated by database triggers)
export const tenantUsage = pgTable('tenant_usage', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),

  // Core counts
  usersCount: integer('users_count').notNull().default(0),
  customersCount: integer('customers_count').notNull().default(0),
  vehiclesCount: integer('vehicles_count').notNull().default(0),

  // Inventory counts
  itemsCount: integer('items_count').notNull().default(0),
  categoriesCount: integer('categories_count').notNull().default(0),
  serviceTypesCount: integer('service_types_count').notNull().default(0),
  suppliersCount: integer('suppliers_count').notNull().default(0),

  // Transaction counts
  salesCount: integer('sales_count').notNull().default(0),
  saleItemsCount: integer('sale_items_count').notNull().default(0),
  workOrdersCount: integer('work_orders_count').notNull().default(0),
  workOrderServicesCount: integer('work_order_services_count').notNull().default(0),
  workOrderPartsCount: integer('work_order_parts_count').notNull().default(0),
  appointmentsCount: integer('appointments_count').notNull().default(0),

  // Document counts
  insuranceEstimatesCount: integer('insurance_estimates_count').notNull().default(0),
  purchasesCount: integer('purchases_count').notNull().default(0),
  purchaseOrdersCount: integer('purchase_orders_count').notNull().default(0),
  stockTransfersCount: integer('stock_transfers_count').notNull().default(0),

  // Storage tracking (in bytes)
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  fileStorageBytes: bigint('file_storage_bytes', { mode: 'number' }).notNull().default(0),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// Billing invoices (consolidated)
export const billingInvoices = pgTable('billing_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  volumeDiscount: decimal('volume_discount', { precision: 12, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  status: invoiceStatusEnum('status').notNull().default('draft'),
  paidAt: timestamp('paid_at'),
  lineItems: jsonb('line_items').notNull().default('[]'), // [{tenantId, tenantName, tierName, amount}]
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Bank deposit payments
export const paymentDeposits = pgTable('payment_deposits', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'),
  bankReference: varchar('bank_reference', { length: 100 }), // Bank transaction reference
  depositDate: date('deposit_date').notNull(), // When user made the deposit
  receiptUrl: text('receipt_url'), // Uploaded receipt image
  notes: text('notes'), // User notes
  status: paymentDepositStatusEnum('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => accounts.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'), // Admin notes
  periodMonths: integer('period_months').notNull().default(1), // How many months this payment covers
  // For wallet credit deposits (not subscription payments)
  isWalletDeposit: boolean('is_wallet_deposit').notNull().default(false),
  // For pending company payments
  pendingCompanyId: uuid('pending_company_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Pending companies (waiting for payment before creation)
export const pendingCompanies = pgTable('pending_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  // Company details
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  address: text('address'),
  businessType: businessTypeEnum('business_type').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  dateFormat: varchar('date_format', { length: 20 }).notNull(),
  timeFormat: varchar('time_format', { length: 10 }).notNull(),
  // Selected plan
  tierId: uuid('tier_id').notNull().references(() => pricingTiers.id),
  billingCycle: varchar('billing_cycle', { length: 20 }).notNull().default('monthly'),
  // Status
  status: pendingCompanyStatusEnum('status').notNull().default('pending_payment'),
  paymentDepositId: uuid('payment_deposit_id'),
  expiresAt: timestamp('expires_at').notNull(),
  adminNotes: text('admin_notes'),
  rejectionReason: text('rejection_reason'),
  // Admin user for the company (created on activation)
  adminEmail: varchar('admin_email', { length: 255 }),
  adminFullName: varchar('admin_full_name', { length: 255 }),
  adminPasswordHash: text('admin_password_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Credit transactions for wallet
export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  type: varchar('type', { length: 10 }).notNull(), // 'credit' or 'debit'
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'),
  description: text('description').notNull(),
  balanceAfter: decimal('balance_after', { precision: 12, scale: 2 }).notNull(),
  // Reference to payment deposit if this was from a bank deposit
  paymentDepositId: uuid('payment_deposit_id').references(() => paymentDeposits.id),
  // Reference to subscription if this was a debit for subscription
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== ACCOUNT NOTIFICATIONS ====================

// Account notifications - in-app notifications for users
export const accountNotifications = pgTable('account_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  type: varchar('type', { length: 50 }).notNull(), // 'payment', 'subscription', 'security', 'billing', 'info'
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  link: varchar('link', { length: 500 }), // Optional link to related page
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at'),
  metadata: jsonb('metadata').default('{}'), // Additional context
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Messaging system - conversations between accounts and admin support
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  subject: varchar('subject', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('open'), // open, closed, archived
  priority: varchar('priority', { length: 20 }).notNull().default('normal'), // low, normal, high, urgent
  category: varchar('category', { length: 50 }), // billing, technical, account, general
  lastMessageAt: timestamp('last_message_at').defaultNow(),
  lastMessagePreview: text('last_message_preview'),
  unreadByAccount: boolean('unread_by_account').notNull().default(false),
  unreadByAdmin: boolean('unread_by_admin').notNull().default(true),
  closedAt: timestamp('closed_at'),
  closedBy: varchar('closed_by', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderType: varchar('sender_type', { length: 20 }).notNull(), // account, admin
  senderId: uuid('sender_id'),
  senderName: varchar('sender_name', { length: 255 }),
  content: text('content').notNull(),
  metadata: jsonb('metadata').default('{}'),
  isSystemMessage: boolean('is_system_message').notNull().default(false),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  account: one(accounts, { fields: [conversations.accountId], references: [accounts.id] }),
  messages: many(messages),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
}))

// ==================== STAFF CHAT ====================

export const staffChatConversations = pgTable('staff_chat_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: varchar('type', { length: 20 }).notNull().default('direct'),
  name: varchar('name', { length: 255 }),
  description: text('description'),
  avatarColor: varchar('avatar_color', { length: 20 }),
  lastMessageAt: timestamp('last_message_at').defaultNow(),
  lastMessagePreview: text('last_message_preview'),
  lastMessageSenderName: varchar('last_message_sender_name', { length: 255 }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const staffChatParticipants = pgTable('staff_chat_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => staffChatConversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  unreadCount: integer('unread_count').notNull().default(0),
  lastReadAt: timestamp('last_read_at'),
  isMuted: boolean('is_muted').notNull().default(false),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  leftAt: timestamp('left_at'),
})

export const staffChatMessages = pgTable('staff_chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => staffChatConversations.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  senderId: uuid('sender_id').notNull().references(() => users.id),
  senderName: varchar('sender_name', { length: 255 }).notNull(),
  content: text('content').notNull(),
  messageType: varchar('message_type', { length: 20 }).notNull().default('text'),
  metadata: jsonb('metadata').default('{}'),
  editedAt: timestamp('edited_at'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const staffChatConversationsRelations = relations(staffChatConversations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [staffChatConversations.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [staffChatConversations.createdBy], references: [users.id] }),
  participants: many(staffChatParticipants),
  messages: many(staffChatMessages),
}))

export const staffChatParticipantsRelations = relations(staffChatParticipants, ({ one }) => ({
  conversation: one(staffChatConversations, { fields: [staffChatParticipants.conversationId], references: [staffChatConversations.id] }),
  user: one(users, { fields: [staffChatParticipants.userId], references: [users.id] }),
}))

export const staffChatMessagesRelations = relations(staffChatMessages, ({ one }) => ({
  conversation: one(staffChatConversations, { fields: [staffChatMessages.conversationId], references: [staffChatConversations.id] }),
  sender: one(users, { fields: [staffChatMessages.senderId], references: [users.id] }),
}))

// Storage alerts tracking
export const storageAlerts = pgTable('storage_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  alertType: varchar('alert_type', { length: 20 }).notNull(), // 'db_80','db_90','db_100','file_80','file_90','file_100'
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  acknowledgedAt: timestamp('acknowledged_at'),
})

// ==================== ADMIN SECURITY ====================

// Admin audit logs - track all admin actions
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  action: adminAuditActionEnum('action').notNull(),
  resource: varchar('resource', { length: 100 }).notNull(), // e.g., 'payment', 'user', 'subscription'
  resourceId: uuid('resource_id'), // ID of the affected resource
  details: jsonb('details').default('{}'), // Additional details about the action
  ipAddress: varchar('ip_address', { length: 45 }), // IPv4 or IPv6
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Admin sessions - track active admin sessions with timeout
export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  superAdminId: uuid('super_admin_id').notNull().references(() => superAdmins.id),
  sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Rate limiting - track request counts per IP
export const adminRateLimits = pgTable('admin_rate_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  requestCount: integer('request_count').notNull().default(1),
  windowStart: timestamp('window_start').defaultNow().notNull(),
})

// System settings - global configuration
export const systemSettings = pgTable('system_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: jsonb('value').notNull().default('{}'),
  description: text('description'),
  updatedBy: uuid('updated_by').references(() => accounts.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== COUPON CODES ====================

export const couponCodes = pgTable('coupon_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  description: text('description'),
  discountType: varchar('discount_type', { length: 20 }).notNull().default('percentage'), // 'percentage' | 'fixed_amount'
  discountValue: decimal('discount_value', { precision: 10, scale: 2 }).notNull().default('0'),
  applicableTiers: jsonb('applicable_tiers'), // array of tier IDs, null = all
  minBillingCycle: varchar('min_billing_cycle', { length: 20 }), // null | 'monthly' | 'annual'
  maxUses: integer('max_uses'), // null = unlimited
  usedCount: integer('used_count').notNull().default(0),
  maxUsesPerAccount: integer('max_uses_per_account').notNull().default(1),
  validFrom: timestamp('valid_from'),
  validUntil: timestamp('valid_until'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== SUPER ADMINS (ISOLATED TABLE) ====================
// This table is completely separate from user accounts for security
// DO NOT include in any migration resets or bulk operations
// DO NOT reference from any other table
export const superAdmins = pgTable('super_admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  lastLoginIp: varchar('last_login_ip', { length: 45 }),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
  // TOTP two-factor authentication
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Push-notification device registry (Expo push tokens). Rows may belong to a tenant user,
// an account owner, or a super admin.
export const userDevices = pgTable('user_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),
  accountId: uuid('account_id'),
  superAdminId: uuid('super_admin_id').references(() => superAdmins.id, { onDelete: 'cascade' }),
  pushToken: varchar('push_token', { length: 255 }).notNull().unique(),
  platform: varchar('platform', { length: 20 }).notNull().default('android'),
  deviceName: varchar('device_name', { length: 255 }),
  appVersion: varchar('app_version', { length: 50 }),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== USERS ====================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  accountId: uuid('account_id').references(() => accounts.id), // Link to global account (nullable for migration)
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull().default('cashier'),
  isActive: boolean('is_active').notNull().default(true),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  lastLoginAt: timestamp('last_login_at'),
  passwordChangedAt: timestamp('password_changed_at'),
  lastActiveAt: timestamp('last_active_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  dealerId: uuid('dealer_id').references(() => dealers.id), // References dealers table - for dealer portal users
  customRoleId: uuid('custom_role_id').references(() => customRoles.id),
  // Short numeric PIN (bcrypt hash) for POS lock-screen unlock and supervisor overrides
  pinHash: text('pin_hash'),
})

// ==================== WAREHOUSES ====================

// Warehouse locations
export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(), // Short code like "MAIN", "WH2"
  address: text('address'),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  isDefault: boolean('is_default').notNull().default(false), // Default warehouse for new inventory
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// User-to-warehouse assignment (many-to-many)
export const userWarehouses = pgTable('user_warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Per-warehouse inventory levels
export const warehouseStock = pgTable('warehouse_stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  currentStock: decimal('current_stock', { precision: 12, scale: 3 }).notNull().default('0'),
  reservedStock: decimal('reserved_stock', { precision: 12, scale: 3 }).notNull().default('0'),
  minStock: decimal('min_stock', { precision: 12, scale: 3 }).notNull().default('0'),
  reorderQty: decimal('reorder_qty', { precision: 12, scale: 3 }),
  binLocation: varchar('bin_location', { length: 50 }), // Shelf A-3, Rack B-2
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // Unique constraint on (warehouseId, itemId) handled at DB level
})

// Inter-warehouse stock transfers
export const stockTransfers = pgTable('stock_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  transferNo: varchar('transfer_no', { length: 50 }).notNull(),
  fromWarehouseId: uuid('from_warehouse_id').notNull().references(() => warehouses.id),
  toWarehouseId: uuid('to_warehouse_id').notNull().references(() => warehouses.id),
  status: stockTransferStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),
  requestedBy: uuid('requested_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  shippedAt: timestamp('shipped_at'),
  shippedBy: uuid('shipped_by').references(() => users.id),
  receivedAt: timestamp('received_at'),
  receivedBy: uuid('received_by').references(() => users.id),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  // Rejection tracking (STW-8)
  rejectedAt: timestamp('rejected_at'),
  rejectedBy: uuid('rejected_by').references(() => users.id),
  rejectionReason: text('rejection_reason'),
  approvalNotes: text('approval_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Items in a stock transfer
export const stockTransferItems = pgTable('stock_transfer_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  transferId: uuid('transfer_id').notNull().references(() => stockTransfers.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  receivedQuantity: decimal('received_quantity', { precision: 12, scale: 3 }), // May differ on receipt
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).default('0'),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).default('0'),
  notes: text('notes'),
  serialNumberIds: jsonb('serial_number_ids').$type<string[]>(),
})

// ==================== POS PROFILES & SHIFT MANAGEMENT ====================

// Discount type enum
export const discountTypeEnum = pgEnum('discount_type', ['percentage', 'fixed'])

// POS shift status enum
export const posShiftStatusEnum = pgEnum('pos_shift_status', ['open', 'closed', 'cancelled'])

// POS closing status enum
export const posClosingStatusEnum = pgEnum('pos_closing_status', ['draft', 'submitted', 'cancelled'])

// Enhanced POS Profiles (ERPNext-style)
export const posProfiles = pgTable('pos_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 20 }),
  isDefault: boolean('is_default').notNull().default(false),

  // Core Settings
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  defaultCustomerId: uuid('default_customer_id').references(() => customers.id),

  // Tax moved to tenant-level settings (tenants.tax_rate, tenants.tax_inclusive)
  applyDiscountOn: varchar('apply_discount_on', { length: 20 }).notNull().default('grand_total'), // 'grand_total', 'net_total'

  // Permissions
  allowRateChange: boolean('allow_rate_change').notNull().default(true),
  allowDiscountChange: boolean('allow_discount_change').notNull().default(true),
  maxDiscountPercent: decimal('max_discount_percent', { precision: 5, scale: 2 }).notNull().default('100'),
  allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
  validateStockOnSave: boolean('validate_stock_on_save').notNull().default(true),

  // Display Options
  hideUnavailableItems: boolean('hide_unavailable_items').notNull().default(true),
  autoAddItemToCart: boolean('auto_add_item_to_cart').notNull().default(false),

  // Print Settings
  printReceiptOnComplete: boolean('print_receipt_on_complete').notNull().default(false),
  skipPrintPreview: boolean('skip_print_preview').notNull().default(false),
  receiptPrintFormat: varchar('receipt_print_format', { length: 20 }).notNull().default('80mm'), // '58mm', '80mm', 'A4'
  showLogoOnReceipt: boolean('show_logo_on_receipt').notNull().default(true),
  receiptHeader: text('receipt_header'),
  receiptFooter: text('receipt_footer'),

  // Payment Settings
  defaultPaymentMethod: varchar('default_payment_method', { length: 30 }).notNull().default('cash'),
  allowCreditSale: boolean('allow_credit_sale').notNull().default(true),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),

  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// POS Profile Payment Methods (enabled payment methods per profile)
export const posProfilePaymentMethods = pgTable('pos_profile_payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  posProfileId: uuid('pos_profile_id').notNull().references(() => posProfiles.id, { onDelete: 'cascade' }),
  paymentMethod: varchar('payment_method', { length: 30 }).notNull(), // 'cash', 'card', 'bank_transfer', 'credit', 'gift_card'
  isDefault: boolean('is_default').notNull().default(false),
  allowInReturns: boolean('allow_in_returns').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  accountId: uuid('account_id').references(() => chartOfAccounts.id),
})

// POS Profile Users (who can use this profile)
export const posProfileUsers = pgTable('pos_profile_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  posProfileId: uuid('pos_profile_id').notNull().references(() => posProfiles.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// POS Profile Item Groups (filter items by category)
export const posProfileItemGroups = pgTable('pos_profile_item_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  posProfileId: uuid('pos_profile_id').notNull().references(() => posProfiles.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
})

// POS Opening Entry (shift start)
export const posOpeningEntries = pgTable('pos_opening_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entryNumber: varchar('entry_number', { length: 30 }).notNull(),

  posProfileId: uuid('pos_profile_id').notNull().references(() => posProfiles.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),

  openingTime: timestamp('opening_time').defaultNow().notNull(),
  status: posShiftStatusEnum('status').notNull().default('open'),

  notes: text('notes'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Opening Entry Payment Balances (cash in drawer at start)
export const posOpeningBalances = pgTable('pos_opening_balances', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  openingEntryId: uuid('opening_entry_id').notNull().references(() => posOpeningEntries.id, { onDelete: 'cascade' }),
  paymentMethod: varchar('payment_method', { length: 30 }).notNull(),
  openingAmount: decimal('opening_amount', { precision: 15, scale: 2 }).notNull().default('0'),
})

// POS Closing Entry (shift end)
export const posClosingEntries = pgTable('pos_closing_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entryNumber: varchar('entry_number', { length: 30 }).notNull(),

  openingEntryId: uuid('opening_entry_id').notNull().references(() => posOpeningEntries.id),
  posProfileId: uuid('pos_profile_id').notNull().references(() => posProfiles.id),
  userId: uuid('user_id').notNull().references(() => users.id),

  openingTime: timestamp('opening_time').notNull(),
  closingTime: timestamp('closing_time').defaultNow().notNull(),

  // Totals
  totalSales: decimal('total_sales', { precision: 15, scale: 2 }).notNull().default('0'),
  totalReturns: decimal('total_returns', { precision: 15, scale: 2 }).notNull().default('0'),
  netSales: decimal('net_sales', { precision: 15, scale: 2 }).notNull().default('0'),
  totalTransactions: integer('total_transactions').notNull().default(0),

  status: posClosingStatusEnum('status').notNull().default('draft'),
  submittedAt: timestamp('submitted_at'),
  submittedBy: uuid('submitted_by').references(() => users.id),

  notes: text('notes'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Closing Entry Payment Reconciliation
export const posClosingReconciliation = pgTable('pos_closing_reconciliation', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  closingEntryId: uuid('closing_entry_id').notNull().references(() => posClosingEntries.id, { onDelete: 'cascade' }),
  paymentMethod: varchar('payment_method', { length: 30 }).notNull(),
  openingAmount: decimal('opening_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  expectedAmount: decimal('expected_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  actualAmount: decimal('actual_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  // Note: difference is calculated client-side as (actualAmount - expectedAmount)
})

// Loyalty Program Configuration
export const loyaltyPrograms = pgTable('loyalty_programs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),

  // Points Configuration
  collectionFactor: decimal('collection_factor', { precision: 10, scale: 4 }).notNull().default('1'), // points per currency unit
  conversionFactor: decimal('conversion_factor', { precision: 10, scale: 4 }).notNull().default('0.01'), // currency per point
  minRedemptionPoints: integer('min_redemption_points').notNull().default(100),

  // Expiry
  pointsExpire: boolean('points_expire').notNull().default(false),
  expiryDays: integer('expiry_days').notNull().default(365),

  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== CUSTOMERS ====================

export const customerBusinessTypeEnum = pgEnum('customer_business_type', ['individual', 'company'])
export const customerTypeEnum = pgEnum('customer_type', ['retail', 'wholesale', 'vip'])

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

  // Basic Information
  name: varchar('name', { length: 255 }).notNull(), // Display name (auto-generated from first+last or company)
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  companyName: varchar('company_name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  mobilePhone: varchar('mobile_phone', { length: 50 }),
  alternatePhone: varchar('alternate_phone', { length: 50 }),

  // Primary Address
  address: text('address'), // Legacy field - keep for backward compatibility
  addressLine1: varchar('address_line_1', { length: 255 }),
  addressLine2: varchar('address_line_2', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  postalCode: varchar('postal_code', { length: 20 }),
  country: varchar('country', { length: 100 }),

  // Billing Address
  useSameBillingAddress: boolean('use_same_billing_address').default(true),
  billingAddressLine1: varchar('billing_address_line_1', { length: 255 }),
  billingAddressLine2: varchar('billing_address_line_2', { length: 255 }),
  billingCity: varchar('billing_city', { length: 100 }),
  billingState: varchar('billing_state', { length: 100 }),
  billingPostalCode: varchar('billing_postal_code', { length: 20 }),
  billingCountry: varchar('billing_country', { length: 100 }),

  // Business/Tax
  taxId: varchar('tax_id', { length: 50 }),
  taxExempt: boolean('tax_exempt').default(false),
  businessType: customerBusinessTypeEnum('business_type').default('individual'),

  // Financial
  balance: decimal('balance', { precision: 12, scale: 2 }).notNull().default('0'),
  creditLimit: decimal('credit_limit', { precision: 12, scale: 2 }),
  paymentTerms: varchar('payment_terms', { length: 50 }), // e.g., 'Net 30', 'COD', 'Due on Receipt' (legacy)
  paymentTermsTemplateId: uuid('payment_terms_template_id'), // FK to paymentTermsTemplates
  defaultPaymentMethod: varchar('default_payment_method', { length: 50 }), // e.g., 'cash', 'card', 'credit'

  // Marketing
  customerType: customerTypeEnum('customer_type').default('retail'),
  referralSource: varchar('referral_source', { length: 100 }),
  marketingOptIn: boolean('marketing_opt_in').default(false),
  birthday: date('birthday'),

  // Notes
  notes: text('notes'),
  specialInstructions: text('special_instructions'),

  // Auto Service
  driverLicenseNumber: varchar('driver_license_number', { length: 50 }),

  // Loyalty
  loyaltyTier: loyaltyTierEnum('loyalty_tier').default('bronze'),
  loyaltyPoints: integer('loyalty_points').notNull().default(0),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Customer credit transactions
export const customerCreditTransactions = pgTable('customer_credit_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  type: varchar('type', { length: 20 }).notNull(), // 'add', 'use', 'refund', 'adjustment'
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  balanceAfter: decimal('balance_after', { precision: 12, scale: 2 }).notNull(),
  referenceType: varchar('reference_type', { length: 50 }), // 'sale', 'work_order', 'manual', 'overpayment'
  referenceId: uuid('reference_id'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== VEHICLES (Auto Service) ====================

export const vehicleMakes = pgTable('vehicle_makes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  country: varchar('country', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
})

export const vehicleModels = pgTable('vehicle_models', {
  id: uuid('id').primaryKey().defaultRandom(),
  makeId: uuid('make_id').notNull().references(() => vehicleMakes.id),
  name: varchar('name', { length: 100 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
})

// Vehicle Types (customizable per tenant)
export const vehicleTypes = pgTable('vehicle_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id), // null = system default
  name: varchar('name', { length: 100 }).notNull(),
  bodyType: vehicleBodyTypeEnum('body_type').notNull(),
  description: text('description'),
  wheelCount: integer('wheel_count').notNull().default(4),
  isSystemDefault: boolean('is_system_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Vehicle Type Diagram Views (image-based diagrams for each vehicle type)
export const vehicleTypeDiagramViews = pgTable('vehicle_type_diagram_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  vehicleTypeId: uuid('vehicle_type_id').notNull().references(() => vehicleTypes.id, { onDelete: 'cascade' }),
  viewName: varchar('view_name', { length: 50 }).notNull().default('top'), // simplified to single view
  imageUrl: text('image_url'), // path to uploaded master diagram image
  imageWidth: integer('image_width'), // original image width for aspect ratio
  imageHeight: integer('image_height'), // original image height for aspect ratio
  sortOrder: integer('sort_order').notNull().default(0),
})

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleTypeId: uuid('vehicle_type_id').references(() => vehicleTypes.id),
  make: varchar('make', { length: 100 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  year: integer('year'),
  vin: varchar('vin', { length: 50 }),
  licensePlate: varchar('license_plate', { length: 20 }),
  color: varchar('color', { length: 50 }),
  currentMileage: integer('current_mileage'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Vehicle Ownership History - tracks when vehicles change owners
export const vehicleOwnershipHistory = pgTable('vehicle_ownership_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }), // Preserve history if vehicle deleted
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }), // Preserve history if customer deleted
  previousCustomerId: uuid('previous_customer_id').references(() => customers.id, { onDelete: 'set null' }),
  // Denormalized fields for historical accuracy
  vehiclePlate: varchar('vehicle_plate', { length: 20 }), // Snapshot of license plate at time of change
  vehicleDescription: varchar('vehicle_description', { length: 255 }), // e.g., "2020 Toyota Corolla"
  customerName: varchar('customer_name', { length: 255 }), // New owner name at time of change
  previousCustomerName: varchar('previous_customer_name', { length: 255 }), // Previous owner name
  changedAt: timestamp('changed_at').defaultNow().notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  changedByName: varchar('changed_by_name', { length: 255 }), // Who made the change
  notes: text('notes'),
})

// ==================== DEALERSHIP ====================

export const vehicleInventory = pgTable('vehicle_inventory', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  vin: varchar('vin', { length: 50 }),
  stockNo: varchar('stock_no', { length: 50 }),
  makeId: uuid('make_id').references(() => vehicleMakes.id),
  modelId: uuid('model_id').references(() => vehicleModels.id),
  year: integer('year'),
  trim: varchar('trim', { length: 100 }),
  exteriorColor: varchar('exterior_color', { length: 50 }),
  interiorColor: varchar('interior_color', { length: 50 }),
  mileage: integer('mileage'),
  condition: varchar('condition', { length: 20 }).default('new'), // new, used, certified_preowned, demo
  bodyType: varchar('body_type', { length: 50 }),
  engineType: varchar('engine_type', { length: 50 }),
  transmission: varchar('transmission', { length: 50 }), // auto, manual, cvt
  fuelType: varchar('fuel_type', { length: 50 }),
  drivetrain: varchar('drivetrain', { length: 50 }), // FWD, RWD, AWD, 4WD
  purchasePrice: decimal('purchase_price', { precision: 12, scale: 2 }),
  askingPrice: decimal('asking_price', { precision: 12, scale: 2 }),
  minimumPrice: decimal('minimum_price', { precision: 12, scale: 2 }),
  status: varchar('status', { length: 20 }).default('available'), // available, reserved, sold, in_transit, in_preparation
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  location: varchar('location', { length: 100 }),
  description: text('description'),
  features: jsonb('features').default([]),
  photos: jsonb('photos').default([]),
  purchasedFrom: varchar('purchased_from', { length: 255 }),
  purchaseDate: date('purchase_date'),
  soldDate: date('sold_date'),
  soldPrice: decimal('sold_price', { precision: 12, scale: 2 }),
  saleId: uuid('sale_id').references(() => sales.id),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // Import & dealer fields
  source: varchar('source', { length: 20 }).default('direct'), // import, local_purchase, trade_in, consignment, direct
  landedCost: decimal('landed_cost', { precision: 14, scale: 2 }),
  totalExpenses: decimal('total_expenses', { precision: 14, scale: 2 }).default('0'),
  registrationNo: varchar('registration_no', { length: 50 }),
  engineCapacityCc: integer('engine_capacity_cc'),
  enginePowerKw: decimal('engine_power_kw', { precision: 8, scale: 2 }),
}, (table) => [
  uniqueIndex('vehicle_inventory_tenant_vin').on(table.tenantId, table.vin),
])

export const testDrives = pgTable('test_drives', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  vehicleInventoryId: uuid('vehicle_inventory_id').notNull().references(() => vehicleInventory.id),
  customerId: uuid('customer_id').references(() => customers.id),
  customerName: varchar('customer_name', { length: 255 }),
  customerPhone: varchar('customer_phone', { length: 50 }),
  customerEmail: varchar('customer_email', { length: 255 }),
  scheduledDate: date('scheduled_date').notNull(),
  scheduledTime: varchar('scheduled_time', { length: 10 }),
  durationMinutes: integer('duration_minutes').default(30),
  status: varchar('status', { length: 20 }).default('scheduled'), // scheduled, completed, cancelled, no_show
  salespersonId: uuid('salesperson_id').references(() => users.id),
  notes: text('notes'),
  feedback: text('feedback'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const tradeInVehicles = pgTable('trade_in_vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  saleId: uuid('sale_id').references(() => sales.id),
  make: varchar('make', { length: 100 }),
  model: varchar('model', { length: 100 }),
  year: integer('year'),
  vin: varchar('vin', { length: 50 }),
  mileage: integer('mileage'),
  condition: varchar('condition', { length: 20 }),
  color: varchar('color', { length: 50 }),
  appraisalValue: decimal('appraisal_value', { precision: 12, scale: 2 }),
  tradeInAllowance: decimal('trade_in_allowance', { precision: 12, scale: 2 }),
  conditionNotes: text('condition_notes'),
  status: varchar('status', { length: 20 }).default('pending'), // pending, accepted, rejected, added_to_inventory
  addedToInventoryId: uuid('added_to_inventory_id').references(() => vehicleInventory.id),
  appraisedBy: uuid('appraised_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const financingOptions = pgTable('financing_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  lenderName: varchar('lender_name', { length: 100 }).notNull(),
  contactInfo: varchar('contact_info', { length: 255 }),
  loanType: varchar('loan_type', { length: 50 }), // new, used, refinance
  minAmount: decimal('min_amount', { precision: 12, scale: 2 }),
  maxAmount: decimal('max_amount', { precision: 12, scale: 2 }),
  minTermMonths: integer('min_term_months'),
  maxTermMonths: integer('max_term_months'),
  interestRateMin: decimal('interest_rate_min', { precision: 5, scale: 2 }),
  interestRateMax: decimal('interest_rate_max', { precision: 5, scale: 2 }),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const vehicleSaleDetails = pgTable('vehicle_sale_details', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  saleId: uuid('sale_id').notNull().references(() => sales.id),
  vehicleInventoryId: uuid('vehicle_inventory_id').notNull().references(() => vehicleInventory.id),
  tradeInVehicleId: uuid('trade_in_vehicle_id').references(() => tradeInVehicles.id),
  tradeInAllowance: decimal('trade_in_allowance', { precision: 12, scale: 2 }),
  financingOptionId: uuid('financing_option_id').references(() => financingOptions.id),
  downPayment: decimal('down_payment', { precision: 12, scale: 2 }),
  financeAmount: decimal('finance_amount', { precision: 12, scale: 2 }),
  loanTermMonths: integer('loan_term_months'),
  interestRate: decimal('interest_rate', { precision: 5, scale: 2 }),
  monthlyPayment: decimal('monthly_payment', { precision: 12, scale: 2 }),
  warrantyType: varchar('warranty_type', { length: 50 }),
  warrantyMonths: integer('warranty_months'),
  warrantyMileage: integer('warranty_mileage'),
  warrantyPrice: decimal('warranty_price', { precision: 12, scale: 2 }),
  salespersonId: uuid('salesperson_id').references(() => users.id),
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }),
  deliveryDate: date('delivery_date'),
  deliveryNotes: text('delivery_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('vehicle_sale_details_sale_unique').on(table.saleId),
])

export const vehicleWarranties = pgTable('vehicle_warranties', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  saleId: uuid('sale_id').notNull().references(() => sales.id),
  vehicleInventoryId: uuid('vehicle_inventory_id').notNull().references(() => vehicleInventory.id),
  warrantyType: varchar('warranty_type', { length: 50 }), // manufacturer, extended, certified_preowned, powertrain
  provider: varchar('provider', { length: 255 }),
  policyNumber: varchar('policy_number', { length: 100 }),
  startDate: date('start_date'),
  endDate: date('end_date'),
  mileageLimit: integer('mileage_limit'),
  coverageDetails: text('coverage_details'),
  price: decimal('price', { precision: 12, scale: 2 }),
  status: varchar('status', { length: 20 }).default('active'), // active, expired, claimed, cancelled
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Dealers in the dealer network
export const dealers = pgTable('dealers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  type: varchar('type', { length: 20 }).default('authorized'), // authorized, sub_dealer, agent, franchise
  contactPerson: varchar('contact_person', { length: 255 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  address: text('address'),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  territory: varchar('territory', { length: 255 }),
  commissionRate: decimal('commission_rate', { precision: 5, scale: 2 }),
  creditLimit: decimal('credit_limit', { precision: 14, scale: 2 }),
  currentBalance: decimal('current_balance', { precision: 14, scale: 2 }).default('0'),
  paymentTermDays: integer('payment_term_days').default(30),
  status: varchar('status', { length: 20 }).default('active'), // active, suspended, inactive
  contractStartDate: date('contract_start_date'),
  contractEndDate: date('contract_end_date'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('dealers_tenant_code').on(table.tenantId, table.code),
])

// Vehicle imports - CIF and tax tracking for imported vehicles
export const vehicleImports = pgTable('vehicle_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  vehicleInventoryId: uuid('vehicle_inventory_id').references(() => vehicleInventory.id),
  importNo: varchar('import_no', { length: 50 }).notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  // CIF Components
  fobValue: decimal('fob_value', { precision: 14, scale: 2 }),
  freightCost: decimal('freight_cost', { precision: 14, scale: 2 }),
  insuranceCost: decimal('insurance_cost', { precision: 14, scale: 2 }),
  cifValue: decimal('cif_value', { precision: 14, scale: 2 }),
  cifCurrency: varchar('cif_currency', { length: 3 }).default('USD'),
  exchangeRate: decimal('exchange_rate', { precision: 12, scale: 6 }),
  cifValueLkr: decimal('cif_value_lkr', { precision: 14, scale: 2 }),
  // Sri Lanka Tax Breakdown
  customsImportDuty: decimal('customs_import_duty', { precision: 14, scale: 2 }),
  customsImportDutyRate: decimal('customs_import_duty_rate', { precision: 5, scale: 2 }),
  surcharge: decimal('surcharge', { precision: 14, scale: 2 }),
  surchargeRate: decimal('surcharge_rate', { precision: 5, scale: 2 }),
  exciseDuty: decimal('excise_duty', { precision: 14, scale: 2 }),
  exciseDutyRate: decimal('excise_duty_rate', { precision: 7, scale: 2 }),
  luxuryTax: decimal('luxury_tax', { precision: 14, scale: 2 }),
  luxuryTaxRate: decimal('luxury_tax_rate', { precision: 5, scale: 2 }),
  vatAmount: decimal('vat_amount', { precision: 14, scale: 2 }),
  vatRate: decimal('vat_rate', { precision: 5, scale: 2 }),
  palCharge: decimal('pal_charge', { precision: 14, scale: 2 }),
  cessFee: decimal('cess_fee', { precision: 14, scale: 2 }),
  totalTaxes: decimal('total_taxes', { precision: 14, scale: 2 }),
  totalLandedCost: decimal('total_landed_cost', { precision: 14, scale: 2 }),
  // Vehicle Identification
  hsCode: varchar('hs_code', { length: 20 }),
  engineCapacityCc: integer('engine_capacity_cc'),
  enginePowerKw: decimal('engine_power_kw', { precision: 8, scale: 2 }),
  importCountry: varchar('import_country', { length: 100 }),
  yearOfManufacture: integer('year_of_manufacture'),
  // Tracking
  billOfLadingNo: varchar('bill_of_lading_no', { length: 100 }),
  lcNo: varchar('lc_no', { length: 100 }),
  customsDeclarationNo: varchar('customs_declaration_no', { length: 100 }),
  portOfEntry: varchar('port_of_entry', { length: 100 }),
  arrivalDate: date('arrival_date'),
  clearanceDate: date('clearance_date'),
  registrationNo: varchar('registration_no', { length: 50 }),
  status: varchar('status', { length: 20 }).default('pending'), // pending, in_transit, at_port, customs_clearing, cleared, registered
  notes: text('notes'),
  additionalCosts: decimal('additional_costs', { precision: 14, scale: 2 }),
  additionalCostsBreakdown: jsonb('additional_costs_breakdown').default([]),
  documents: jsonb('documents').default([]),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('vehicle_imports_tenant_no').on(table.tenantId, table.importNo),
])

// Dealer inventory allocations
export const dealerAllocations = pgTable('dealer_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  dealerId: uuid('dealer_id').notNull().references(() => dealers.id),
  vehicleInventoryId: uuid('vehicle_inventory_id').notNull().references(() => vehicleInventory.id),
  allocatedAt: timestamp('allocated_at').defaultNow().notNull(),
  allocatedBy: uuid('allocated_by').references(() => users.id),
  returnedAt: timestamp('returned_at'),
  returnedBy: uuid('returned_by').references(() => users.id),
  returnReason: text('return_reason'),
  status: varchar('status', { length: 20 }).default('allocated'), // allocated, returned, sold
  stockTransferId: uuid('stock_transfer_id').references(() => stockTransfers.id),
  askingPrice: decimal('asking_price', { precision: 12, scale: 2 }),
  minimumPrice: decimal('minimum_price', { precision: 12, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Vehicle expenses (preparation, transport, registration, etc.)
export const vehicleExpenses = pgTable('vehicle_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  vehicleInventoryId: uuid('vehicle_inventory_id').notNull().references(() => vehicleInventory.id),
  category: varchar('category', { length: 50 }).notNull(), // preparation, transport, registration, repair, marketing, inspection, storage, other
  description: varchar('description', { length: 255 }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  vendorName: varchar('vendor_name', { length: 255 }),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  receiptNo: varchar('receipt_no', { length: 100 }),
  expenseDate: date('expense_date'),
  isCapitalized: boolean('is_capitalized').notNull().default(true),
  glPosted: boolean('gl_posted').notNull().default(false),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Dealership inspections (PDI, trade-in, receiving)
export const dealershipInspections = pgTable('dealership_inspections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  vehicleInventoryId: uuid('vehicle_inventory_id').references(() => vehicleInventory.id),
  type: varchar('type', { length: 20 }).notNull(), // pdi, trade_in, service_check, receiving
  inspectedBy: uuid('inspected_by').references(() => users.id),
  inspectionDate: date('inspection_date'),
  overallRating: varchar('overall_rating', { length: 20 }), // excellent, good, fair, poor
  checklist: jsonb('checklist').default([]),
  photos: jsonb('photos').default([]),
  mileageAtInspection: integer('mileage_at_inspection'),
  notes: text('notes'),
  status: varchar('status', { length: 20 }).default('draft'), // draft, completed
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Dealer payments and settlements
export const dealerPayments = pgTable('dealer_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  dealerId: uuid('dealer_id').notNull().references(() => dealers.id),
  paymentNo: varchar('payment_no', { length: 50 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // advance, settlement, commission, refund, adjustment
  direction: varchar('direction', { length: 10 }).notNull(), // inbound (dealer->company), outbound (company->dealer)
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 20 }), // cash, bank_transfer, cheque, offset
  referenceNo: varchar('reference_no', { length: 100 }),
  // Linked records
  vehicleInventoryId: uuid('vehicle_inventory_id').references(() => vehicleInventory.id),
  dealerAllocationId: uuid('dealer_allocation_id').references(() => dealerAllocations.id),
  saleId: uuid('sale_id').references(() => sales.id),
  // Balance tracking
  balanceBefore: decimal('balance_before', { precision: 14, scale: 2 }),
  balanceAfter: decimal('balance_after', { precision: 14, scale: 2 }),
  // GL integration
  glPosted: boolean('gl_posted').notNull().default(false),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  // Meta
  paymentDate: date('payment_date'),
  dueDate: date('due_date'),
  status: varchar('status', { length: 20 }).default('pending'), // pending, confirmed, cancelled
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('dealer_payments_tenant_no').on(table.tenantId, table.paymentNo),
])

// Vehicle documents (centralized document store)
export const vehicleDocuments = pgTable('vehicle_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  // Polymorphic links
  vehicleInventoryId: uuid('vehicle_inventory_id').references(() => vehicleInventory.id),
  vehicleImportId: uuid('vehicle_import_id').references(() => vehicleImports.id),
  dealerId: uuid('dealer_id').references(() => dealers.id),
  // Document info
  documentType: varchar('document_type', { length: 50 }).notNull(), // bill_of_lading, letter_of_credit, customs_declaration, insurance_certificate, registration_certificate, revenue_license, emission_certificate, purchase_invoice, tax_receipt, inspection_report, dealer_contract, dealer_license, warranty_certificate, other
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  fileUrl: varchar('file_url', { length: 500 }),
  fileType: varchar('file_type', { length: 50 }),
  fileSize: integer('file_size'),
  // Validity tracking
  issueDate: date('issue_date'),
  expiryDate: date('expiry_date'),
  isExpired: boolean('is_expired').notNull().default(false),
  alertBeforeDays: integer('alert_before_days').default(30),
  // Meta
  documentNo: varchar('document_no', { length: 100 }),
  issuedBy: varchar('issued_by', { length: 255 }),
  status: varchar('status', { length: 20 }).default('valid'), // valid, expired, revoked, pending
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== INVENTORY ====================

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  parentId: uuid('parent_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Part condition enum for auto parts
export const partConditionEnum = pgEnum('part_condition', ['new', 'refurbished', 'used'])

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

  // Identification
  sku: varchar('sku', { length: 100 }),
  barcode: varchar('barcode', { length: 100 }),
  oemPartNumber: varchar('oem_part_number', { length: 100 }), // Original manufacturer part number
  alternatePartNumbers: jsonb('alternate_part_numbers').$type<string[]>(), // Cross-reference numbers

  // Basic info
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  categoryId: uuid('category_id').references(() => categories.id),
  brand: varchar('brand', { length: 100 }), // Bosch, Denso, OEM, Generic, etc.
  condition: partConditionEnum('condition').default('new'), // new, refurbished, used

  // Pricing
  costPrice: decimal('cost_price', { precision: 12, scale: 2 }).notNull().default('0'),
  sellingPrice: decimal('selling_price', { precision: 12, scale: 2 }).notNull().default('0'),
  valuationRate: decimal('valuation_rate', { precision: 12, scale: 2 }).notNull().default('0'),
  coreCharge: decimal('core_charge', { precision: 12, scale: 2 }), // Deposit for returnable parts

  // Inventory (stock levels are in warehouseStock table)
  trackStock: boolean('track_stock').notNull().default(true),
  trackBatches: boolean('track_batches').notNull().default(false),
  trackSerialNumbers: boolean('track_serial_numbers').notNull().default(false),
  unit: varchar('unit', { length: 50 }).default('pcs'),
  isWeighable: boolean('is_weighable').notNull().default(false),

  // Supplier
  supplierId: uuid('supplier_id'), // Primary supplier (reference added in relations)
  supplierPartNumber: varchar('supplier_part_number', { length: 100 }), // Supplier's own code
  leadTimeDays: integer('lead_time_days'), // Expected delivery time

  // Physical attributes
  weight: decimal('weight', { precision: 10, scale: 3 }), // Weight in kg for shipping
  dimensions: varchar('dimensions', { length: 50 }), // L x W x H (e.g., "10x5x3 cm")

  // Additional
  warrantyMonths: integer('warranty_months'), // 6, 12, 24 months
  imageUrl: text('image_url'), // Product image
  imageSize: integer('image_size'), // Image file size in bytes (for storage tracking)
  supersededBy: uuid('superseded_by'), // Replacement part when discontinued

  // Restaurant fields
  preparationTime: integer('preparation_time'), // Minutes
  allergens: jsonb('allergens').$type<string[]>(), // e.g. ['gluten', 'dairy', 'nuts']
  calories: integer('calories'),
  isVegetarian: boolean('is_vegetarian').notNull().default(false),
  isVegan: boolean('is_vegan').notNull().default(false),
  isGlutenFree: boolean('is_gluten_free').notNull().default(false),
  spiceLevel: varchar('spice_level', { length: 20 }), // none, mild, medium, hot, extra_hot
  availableFrom: time('available_from'),
  availableTo: time('available_to'),

  // Supermarket fields
  pluCode: varchar('plu_code', { length: 20 }), // Price Look-Up code
  shelfLifeDays: integer('shelf_life_days'),
  storageTemp: varchar('storage_temp', { length: 20 }), // ambient, chilled, frozen
  expiryDate: date('expiry_date'),

  // Tax
  taxInclusive: boolean('tax_inclusive').notNull().default(false), // DEPRECATED: use taxTemplateId instead
  taxTemplateId: uuid('tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  // Flags
  isGiftCard: boolean('is_gift_card').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),

  // Product variants (parent SKU + size/color attributes)
  parentItemId: uuid('parent_item_id'),
  variantAttributes: jsonb('variant_attributes').$type<Record<string, string>>().default({}),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id), // Nullable for migration
  itemId: uuid('item_id').notNull().references(() => items.id),
  type: stockMovementTypeEnum('type').notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  referenceType: varchar('reference_type', { length: 50 }),
  referenceId: uuid('reference_id'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const partCompatibility = pgTable('part_compatibility', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  makeId: uuid('make_id').references(() => vehicleMakes.id),
  modelId: uuid('model_id').references(() => vehicleModels.id),
  yearFrom: integer('year_from'),
  yearTo: integer('year_to'),
})

// ==================== SERVICES (Auto Service) ====================

export const serviceTypeGroups = pgTable('service_type_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const serviceTypes = pgTable('service_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  groupId: uuid('group_id').references(() => serviceTypeGroups.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  defaultHours: decimal('default_hours', { precision: 6, scale: 2 }),
  defaultRate: decimal('default_rate', { precision: 12, scale: 2 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const laborGuides = pgTable('labor_guides', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  makeId: uuid('make_id').references(() => vehicleMakes.id),
  modelId: uuid('model_id').references(() => vehicleModels.id),
  yearFrom: integer('year_from'),
  yearTo: integer('year_to'),
  hours: decimal('hours', { precision: 6, scale: 2 }).notNull(),
})

// ==================== WORK ORDERS (Auto Service) ====================

export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  orderNo: varchar('order_no', { length: 50 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id), // Inventory warehouse
  // Denormalized fields for historical accuracy
  customerName: varchar('customer_name', { length: 255 }), // Snapshot at time of creation
  vehiclePlate: varchar('vehicle_plate', { length: 20 }), // Snapshot at time of creation
  vehicleDescription: varchar('vehicle_description', { length: 255 }), // e.g., "2020 Toyota Corolla"
  status: workOrderStatusEnum('status').notNull().default('draft'),
  priority: varchar('priority', { length: 20 }).default('normal'),
  odometerIn: integer('odometer_in'),
  customerComplaint: text('customer_complaint'),
  diagnosis: text('diagnosis'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  saleId: uuid('sale_id'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  assignedToName: varchar('assigned_to_name', { length: 255 }), // Snapshot of technician name
  createdBy: uuid('created_by').references(() => users.id),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const workOrderServices = pgTable('work_order_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id),
  serviceTypeId: uuid('service_type_id').references(() => serviceTypes.id),
  description: text('description'),
  hours: decimal('hours', { precision: 6, scale: 2 }).notNull(),
  rate: decimal('rate', { precision: 12, scale: 2 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  technicianId: uuid('technician_id').references(() => users.id),
})

export const workOrderParts = pgTable('work_order_parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  coreCharge: decimal('core_charge', { precision: 12, scale: 2 }),
})

// Work Order Assignment History - tracks technician assignments
export const workOrderAssignmentHistory = pgTable('work_order_assignment_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id),
  assignedTo: uuid('assigned_to').references(() => users.id),
  previousAssignedTo: uuid('previous_assigned_to').references(() => users.id),
  // Denormalized for history preservation
  assignedToName: varchar('assigned_to_name', { length: 255 }),
  previousAssignedToName: varchar('previous_assigned_to_name', { length: 255 }),
  changedBy: uuid('changed_by').references(() => users.id),
  changedByName: varchar('changed_by_name', { length: 255 }),
  reason: text('reason'),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
})

export const coreReturns = pgTable('core_returns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  workOrderId: uuid('work_order_id').references(() => workOrders.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  customerId: uuid('customer_id').references(() => customers.id),
  depositAmount: decimal('deposit_amount', { precision: 12, scale: 2 }).notNull(),
  status: coreReturnStatusEnum('status').notNull().default('pending'),
  returnedAt: timestamp('returned_at'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== VEHICLE INSPECTIONS ====================

// Inspection Templates (checklist templates per vehicle type)
export const inspectionTemplates = pgTable('inspection_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id), // null = system default
  vehicleTypeId: uuid('vehicle_type_id').references(() => vehicleTypes.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  inspectionType: inspectionTypeEnum('inspection_type').notNull().default('check_in'),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Inspection Categories (checklist categories like Exterior, Mechanical, etc.)
export const inspectionCategories = pgTable('inspection_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  templateId: uuid('template_id').notNull().references(() => inspectionTemplates.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// Inspection Checklist Items
export const inspectionChecklistItems = pgTable('inspection_checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  categoryId: uuid('category_id').notNull().references(() => inspectionCategories.id, { onDelete: 'cascade' }),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  itemType: checklistItemTypeEnum('item_type').notNull().default('checkbox'),
  options: jsonb('options').default('[]'), // for select type
  isRequired: boolean('is_required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

// Vehicle Inspections (inspection records linked to work orders)
export const vehicleInspections = pgTable('vehicle_inspections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  templateId: uuid('template_id').references(() => inspectionTemplates.id),
  inspectionType: inspectionTypeEnum('inspection_type').notNull().default('check_in'),
  status: inspectionStatusEnum('status').notNull().default('draft'),
  fuelLevel: integer('fuel_level'), // 0-100
  odometerReading: integer('odometer_reading'),
  inspectedBy: uuid('inspected_by').references(() => users.id),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  customerSignature: text('customer_signature'), // base64 encoded
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Inspection Responses (checklist item responses)
export const inspectionResponses = pgTable('inspection_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  inspectionId: uuid('inspection_id').notNull().references(() => vehicleInspections.id, { onDelete: 'cascade' }),
  checklistItemId: uuid('checklist_item_id').notNull().references(() => inspectionChecklistItems.id),
  response: checklistResponseEnum('response'), // ok, concern, fail, na
  value: text('value'), // for text/number types
  notes: text('notes'),
})

// Inspection Damage Marks (damage markings on diagram)
export const inspectionDamageMarks = pgTable('inspection_damage_marks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  inspectionId: uuid('inspection_id').notNull().references(() => vehicleInspections.id, { onDelete: 'cascade' }),
  diagramViewId: uuid('diagram_view_id').references(() => vehicleTypeDiagramViews.id),
  positionX: decimal('position_x', { precision: 6, scale: 2 }).notNull(), // percentage 0-100
  positionY: decimal('position_y', { precision: 6, scale: 2 }).notNull(), // percentage 0-100
  damageType: damageTypeEnum('damage_type').notNull(),
  severity: damageSeverityEnum('severity').notNull().default('minor'),
  description: text('description'),
  isPreExisting: boolean('is_pre_existing').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Inspection Photos
export const inspectionPhotos = pgTable('inspection_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  inspectionId: uuid('inspection_id').notNull().references(() => vehicleInspections.id, { onDelete: 'cascade' }),
  damageMarkId: uuid('damage_mark_id').references(() => inspectionDamageMarks.id, { onDelete: 'set null' }),
  responseId: uuid('response_id').references(() => inspectionResponses.id, { onDelete: 'set null' }),
  photoUrl: varchar('photo_url', { length: 500 }).notNull(),
  caption: text('caption'),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== APPOINTMENTS ====================

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  serviceTypeId: uuid('service_type_id').references(() => serviceTypes.id),
  // Denormalized fields for historical accuracy
  customerName: varchar('customer_name', { length: 255 }), // Snapshot at time of creation
  vehiclePlate: varchar('vehicle_plate', { length: 20 }), // Snapshot at time of creation
  vehicleDescription: varchar('vehicle_description', { length: 255 }), // e.g., "2020 Toyota Corolla"
  serviceName: varchar('service_name', { length: 255 }), // Snapshot of service type name
  scheduledDate: date('scheduled_date').notNull(),
  scheduledTime: time('scheduled_time').notNull(),
  durationMinutes: integer('duration_minutes').default(60),
  status: appointmentStatusEnum('status').notNull().default('scheduled'),
  notes: text('notes'),
  workOrderId: uuid('work_order_id').references(() => workOrders.id),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  // A17: Recurring appointment fields
  recurrencePattern: recurrencePatternEnum('recurrence_pattern').default('none'),
  recurrenceEndDate: date('recurrence_end_date'),
  parentAppointmentId: uuid('parent_appointment_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== INSURANCE ESTIMATES (Auto Service) ====================

export const insuranceCompanies = pgTable('insurance_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  shortName: varchar('short_name', { length: 50 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  claimHotline: varchar('claim_hotline', { length: 50 }),
  isPartnerGarage: boolean('is_partner_garage').notNull().default(false),
  estimateThreshold: decimal('estimate_threshold', { precision: 12, scale: 2 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const insuranceAssessors = pgTable('insurance_assessors', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  insuranceCompanyId: uuid('insurance_company_id').references(() => insuranceCompanies.id),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const insuranceEstimates = pgTable('insurance_estimates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  estimateNo: varchar('estimate_no', { length: 50 }).notNull(),
  estimateType: estimateTypeEnum('estimate_type').notNull().default('insurance'),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id), // Inventory warehouse
  insuranceCompanyId: uuid('insurance_company_id').references(() => insuranceCompanies.id),
  policyNumber: varchar('policy_number', { length: 100 }),
  claimNumber: varchar('claim_number', { length: 100 }),
  assessorId: uuid('assessor_id').references(() => insuranceAssessors.id),
  assessorName: varchar('assessor_name', { length: 255 }),
  assessorPhone: varchar('assessor_phone', { length: 50 }),
  assessorEmail: varchar('assessor_email', { length: 255 }),
  incidentDate: date('incident_date'),
  incidentDescription: text('incident_description'),
  odometerIn: integer('odometer_in'),
  status: insuranceEstimateStatusEnum('status').notNull().default('draft'),
  revisionNumber: integer('revision_number').notNull().default(1),
  originalSubtotal: decimal('original_subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  originalTaxAmount: decimal('original_tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  originalTotal: decimal('original_total', { precision: 12, scale: 2 }).notNull().default('0'),
  approvedSubtotal: decimal('approved_subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  approvedTaxAmount: decimal('approved_tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  approvedTotal: decimal('approved_total', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  taxTemplateId: uuid('tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  insuranceRemarks: text('insurance_remarks'),
  reviewedAt: timestamp('reviewed_at'),
  workOrderId: uuid('work_order_id').references(() => workOrders.id),
  workOrderIds: text('work_order_ids').array().default([]), // Track multiple partial conversions (AEW-3)
  createdBy: uuid('created_by').references(() => users.id),
  submittedBy: uuid('submitted_by').references(() => users.id),
  submittedAt: timestamp('submitted_at'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  holdStock: boolean('hold_stock').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const insuranceEstimateItems = pgTable('insurance_estimate_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  estimateId: uuid('estimate_id').notNull().references(() => insuranceEstimates.id),
  itemType: estimateItemTypeEnum('item_type').notNull(),
  // For services
  serviceTypeId: uuid('service_type_id').references(() => serviceTypes.id),
  description: text('description'),
  hours: decimal('hours', { precision: 6, scale: 2 }),
  rate: decimal('rate', { precision: 12, scale: 2 }),
  // For parts
  itemId: uuid('item_id').references(() => items.id),
  partName: varchar('part_name', { length: 255 }),
  quantity: decimal('quantity', { precision: 12, scale: 3 }),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }),
  // Amounts
  originalAmount: decimal('original_amount', { precision: 12, scale: 2 }).notNull(),
  approvedAmount: decimal('approved_amount', { precision: 12, scale: 2 }),
  // Status
  status: estimateItemStatusEnum('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  assessorNotes: text('assessor_notes'),
  // Conversion tracking
  convertedToWorkOrderId: uuid('converted_to_work_order_id').references(() => workOrders.id),
  conversionSkippedReason: text('conversion_skipped_reason'), // e.g., "Insufficient stock (need: 4, available: 0)"
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const insuranceEstimateRevisions = pgTable('insurance_estimate_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  estimateId: uuid('estimate_id').notNull().references(() => insuranceEstimates.id),
  revisionNumber: integer('revision_number').notNull(),
  estimateSnapshot: jsonb('estimate_snapshot').notNull(),
  itemsSnapshot: jsonb('items_snapshot').notNull(),
  changeReason: text('change_reason'),
  changedBy: uuid('changed_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// X4: Activity Logs
export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id),
  action: activityActionEnum('action').notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(), // e.g., 'work_order', 'estimate', 'customer'
  entityId: uuid('entity_id'),
  entityName: varchar('entity_name', { length: 255 }), // Human-readable name/number
  description: text('description'),
  metadata: jsonb('metadata'), // Additional context
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// X5: Document comments — threaded comments on any document type
export const documentComments = pgTable('document_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  documentType: varchar('document_type', { length: 50 }).notNull(), // purchase_order, purchase, sales_order, work_order, etc.
  documentId: uuid('document_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// E25: Estimate templates
export const estimateTemplates = pgTable('estimate_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  itemsTemplate: jsonb('items_template').notNull().default('[]'), // Array of template items
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// E23: Photo attachments for estimates
export const insuranceEstimateAttachments = pgTable('insurance_estimate_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  estimateId: uuid('estimate_id').notNull().references(() => insuranceEstimates.id),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileType: varchar('file_type', { length: 100 }).notNull(), // e.g., 'image/jpeg', 'image/png'
  fileSize: integer('file_size').notNull(), // Size in bytes
  filePath: text('file_path').notNull(), // Storage path
  fileHash: varchar('file_hash', { length: 64 }), // SHA-256 hash for duplicate detection
  category: varchar('category', { length: 50 }), // e.g., 'damage', 'document', 'before', 'after'
  description: text('description'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== SALES ====================

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  clientSaleId: uuid('client_sale_id'),
  invoiceNo: varchar('invoice_no', { length: 50 }).notNull(),
  workOrderId: uuid('work_order_id').references(() => workOrders.id),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id), // Track which vehicle the sale is for
  warehouseId: uuid('warehouse_id').references(() => warehouses.id), // Inventory warehouse
  // POS Shift link
  posOpeningEntryId: uuid('pos_opening_entry_id').references(() => posOpeningEntries.id),
  // Denormalized fields for historical accuracy
  customerName: varchar('customer_name', { length: 255 }), // Snapshot at time of sale
  vehiclePlate: varchar('vehicle_plate', { length: 20 }), // Snapshot at time of sale
  vehicleDescription: varchar('vehicle_description', { length: 255 }), // e.g., "2020 Toyota Corolla"
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  discountType: discountTypeEnum('discount_type'),
  discountReason: text('discount_reason'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  paidAmount: decimal('paid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  paymentMethod: paymentMethodEnum('payment_method'),
  paymentTermsTemplateId: uuid('payment_terms_template_id'), // FK to paymentTermsTemplates
  status: saleStatusEnum('status').notNull().default('pending'),
  isReturn: boolean('is_return').notNull().default(false),
  returnAgainst: uuid('return_against'),
  notes: text('notes'),
  voidReason: text('void_reason'),
  voidedAt: timestamp('voided_at'),
  restaurantOrderId: uuid('restaurant_order_id'), // References restaurant_orders.id (no FK to avoid circular dep)
  salesOrderId: uuid('sales_order_id'), // References sales_orders.id (no FK to avoid circular dep, added after table defined)
  createdBy: uuid('created_by').references(() => users.id),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const saleItems = pgTable('sale_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  saleId: uuid('sale_id').notNull().references(() => sales.id),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).notNull().default('0'),
  discountType: discountTypeEnum('discount_type'),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'), // DEPRECATED: unused, use taxAmount instead
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxTemplateId: uuid('tax_template_id'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  serialNumberIds: jsonb('serial_number_ids').$type<string[]>(),
})

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  saleId: uuid('sale_id').notNull().references(() => sales.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  method: paymentMethodEnum('method').notNull(),
  reference: varchar('reference', { length: 255 }),
  receivedBy: uuid('received_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Void tracking for audit trail (RC-12)
  voidedAt: timestamp('voided_at'),
  voidedBy: uuid('voided_by').references(() => users.id),
  voidReason: text('void_reason'),
})

// Refund audit trail (8K)
export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  saleId: uuid('sale_id').notNull().references(() => sales.id),
  originalSaleId: uuid('original_sale_id').references(() => sales.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  method: varchar('method', { length: 50 }).notNull(),
  processedBy: uuid('processed_by').references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Held/Parked Sales for POS
export const heldSales = pgTable('held_sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  holdNumber: varchar('hold_number', { length: 20 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id), // Inventory warehouse
  // Denormalized fields for display
  customerName: varchar('customer_name', { length: 255 }),
  vehiclePlate: varchar('vehicle_plate', { length: 20 }),
  vehicleDescription: varchar('vehicle_description', { length: 255 }),
  cartItems: jsonb('cart_items').notNull(), // Array of {itemId, name, quantity, unitPrice, total}
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  notes: text('notes'),
  heldBy: uuid('held_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull().$default(() => new Date(Date.now() + 24 * 60 * 60 * 1000)),
})

// ==================== RESTAURANT ====================

export const tableGroups = pgTable('table_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  combinedCapacity: integer('combined_capacity').notNull().default(0),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  serverId: uuid('server_id').references(() => users.id),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  disbandedAt: timestamp('disbanded_at'),
})

export const tableGroupMembers = pgTable('table_group_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  tableGroupId: uuid('table_group_id').notNull().references(() => tableGroups.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => restaurantTables.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const restaurantTables = pgTable('restaurant_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 50 }).notNull(),
  area: varchar('area', { length: 100 }),
  capacity: integer('capacity').notNull().default(4),
  status: tableStatusEnum('status').notNull().default('available'),
  positionX: integer('position_x'),
  positionY: integer('position_y'),
  width: integer('width'),
  height: integer('height'),
  shape: varchar('shape', { length: 20 }).default('rectangle'),
  rotation: integer('rotation').default(0),
  isActive: boolean('is_active').notNull().default(true),
  serverId: uuid('server_id').references(() => users.id),
  currentOrderId: uuid('current_order_id'),
  tableGroupId: uuid('table_group_id'),
  occupiedAt: timestamp('occupied_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const modifierGroups = pgTable('modifier_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  minSelections: integer('min_selections').default(0),
  maxSelections: integer('max_selections'),
  isRequired: boolean('is_required').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const modifiers = pgTable('modifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  groupId: uuid('group_id').notNull().references(() => modifierGroups.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  price: decimal('price', { precision: 12, scale: 2 }).notNull().default('0'),
  sku: varchar('sku', { length: 50 }),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').notNull().default(true),
  allergens: text('allergens').array(),
  calories: integer('calories'),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const modifierGroupItems = pgTable('modifier_group_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  modifierGroupId: uuid('modifier_group_id').notNull().references(() => modifierGroups.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const restaurantOrders = pgTable('restaurant_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  orderNo: varchar('order_no', { length: 50 }).notNull(),
  tableId: uuid('table_id').references(() => restaurantTables.id),
  customerId: uuid('customer_id').references(() => customers.id),
  orderType: orderTypeEnum('order_type').notNull().default('dine_in'),
  status: varchar('status', { length: 50 }).notNull().default('open'),
  customerCount: integer('customer_count').default(1),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  tipAmount: decimal('tip_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  saleId: uuid('sale_id').references(() => sales.id),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  // Delivery fields
  deliveryAddress: text('delivery_address'),
  deliveryPhone: varchar('delivery_phone', { length: 50 }),
  deliveryNotes: text('delivery_notes'),
  driverName: varchar('driver_name', { length: 255 }),
  driverPhone: varchar('driver_phone', { length: 50 }),
  estimatedDeliveryTime: timestamp('estimated_delivery_time'),
  actualDeliveryTime: timestamp('actual_delivery_time'),
  deliveryStatus: deliveryStatusEnum('delivery_status').default('pending'),
  deliveryFee: decimal('delivery_fee', { precision: 12, scale: 2 }).default('0'),
  serverId: uuid('server_id').references(() => users.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const restaurantOrderItems = pgTable('restaurant_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  orderId: uuid('order_id').notNull().references(() => restaurantOrders.id),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  modifiers: jsonb('modifiers').default('[]'),
  notes: text('notes'),
  status: varchar('status', { length: 50 }).default('pending'),
})

export const kitchenOrders = pgTable('kitchen_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  restaurantOrderId: uuid('restaurant_order_id').notNull().references(() => restaurantOrders.id),
  status: kitchenOrderStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const kitchenOrderItems = pgTable('kitchen_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  kitchenOrderId: uuid('kitchen_order_id').notNull().references(() => kitchenOrders.id),
  restaurantOrderItemId: uuid('restaurant_order_item_id').notNull().references(() => restaurantOrderItems.id),
  status: kitchenOrderStatusEnum('status').notNull().default('pending'),
})

// ============================================
// Recipes & Waste Log (Restaurant / Food Cost)
// ============================================
export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  itemId: uuid('item_id').references(() => items.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  yieldQuantity: decimal('yield_quantity', { precision: 12, scale: 2 }).notNull().default('1'),
  yieldUnit: varchar('yield_unit', { length: 50 }).default('portion'),
  preparationTime: integer('preparation_time'),
  instructions: text('instructions'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  ingredientItemId: uuid('ingredient_item_id').notNull().references(() => items.id),
  quantity: decimal('quantity', { precision: 12, scale: 4 }).notNull(),
  unit: varchar('unit', { length: 50 }).notNull().default('pcs'),
  wastePercentage: decimal('waste_percentage', { precision: 5, scale: 2 }).default('0'),
  notes: text('notes'),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const wasteLog = pgTable('waste_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  quantity: decimal('quantity', { precision: 12, scale: 4 }).notNull(),
  unit: varchar('unit', { length: 50 }).notNull().default('pcs'),
  reason: varchar('reason', { length: 100 }).notNull(),
  notes: text('notes'),
  costAmount: decimal('cost_amount', { precision: 12, scale: 2 }),
  recordedBy: uuid('recorded_by').references(() => users.id),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
})

export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerId: uuid('customer_id').references(() => customers.id),
  customerName: varchar('customer_name', { length: 255 }),
  customerPhone: varchar('customer_phone', { length: 50 }),
  customerEmail: varchar('customer_email', { length: 255 }),
  tableId: uuid('table_id').references(() => restaurantTables.id),
  reservationDate: date('reservation_date').notNull(),
  reservationTime: time('reservation_time').notNull(),
  partySize: integer('party_size').notNull().default(2),
  estimatedDuration: integer('estimated_duration').default(60),
  status: reservationStatusEnum('status').notNull().default('pending'),
  notes: text('notes'),
  specialRequests: text('special_requests'),
  source: varchar('source', { length: 50 }).default('walk_in'),
  confirmationCode: varchar('confirmation_code', { length: 20 }),
  waitlistPosition: integer('waitlist_position'),
  estimatedSeatingTime: timestamp('estimated_seating_time'),
  reminderSentAt: timestamp('reminder_sent_at'),
  confirmationSentAt: timestamp('confirmation_sent_at'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  restaurantOrderId: uuid('restaurant_order_id').references(() => restaurantOrders.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// ==================== LAYAWAY ====================

export const layaways = pgTable('layaways', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  layawayNo: varchar('layaway_no', { length: 50 }).notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  taxTemplateId: uuid('tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  depositAmount: decimal('deposit_amount', { precision: 12, scale: 2 }).notNull(),
  paidAmount: decimal('paid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  balanceDue: decimal('balance_due', { precision: 12, scale: 2 }).notNull(),
  status: layawayStatusEnum('status').notNull().default('active'),
  dueDate: date('due_date'),
  notes: text('notes'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const layawayItems = pgTable('layaway_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  layawayId: uuid('layaway_id').notNull().references(() => layaways.id),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  taxTemplateId: uuid('tax_template_id'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
})

export const layawayPayments = pgTable('layaway_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  layawayId: uuid('layaway_id').notNull().references(() => layaways.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  reference: varchar('reference', { length: 255 }),
  receivedBy: uuid('received_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== GIFT CARDS ====================

export const giftCards = pgTable('gift_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  cardNumber: varchar('card_number', { length: 50 }).notNull(),
  pin: varchar('pin', { length: 10 }),
  initialBalance: decimal('initial_balance', { precision: 12, scale: 2 }).notNull(),
  currentBalance: decimal('current_balance', { precision: 12, scale: 2 }).notNull(),
  status: giftCardStatusEnum('status').notNull().default('inactive'),
  expiryDate: date('expiry_date'),
  issuedTo: uuid('issued_to').references(() => customers.id),
  createdBy: uuid('created_by').references(() => users.id),
  purchaseSaleId: uuid('purchase_sale_id').references(() => sales.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const giftCardTransactions = pgTable('gift_card_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  giftCardId: uuid('gift_card_id').notNull().references(() => giftCards.id),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  balanceAfter: decimal('balance_after', { precision: 12, scale: 2 }).notNull(),
  saleId: uuid('sale_id').references(() => sales.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== LOYALTY ====================

export const loyaltyTiers = pgTable('loyalty_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  tier: loyaltyTierEnum('tier').notNull(),
  minPoints: integer('min_points').notNull().default(0),
  earnRate: decimal('earn_rate', { precision: 6, scale: 2 }).notNull(),
  redeemRate: decimal('redeem_rate', { precision: 6, scale: 2 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
})

export const loyaltyTransactions = pgTable('loyalty_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  type: varchar('type', { length: 50 }).notNull(),
  points: integer('points').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  saleId: uuid('sale_id').references(() => sales.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== COMMISSIONS ====================

export const commissionRates = pgTable('commission_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id),
  serviceTypeId: uuid('service_type_id').references(() => serviceTypes.id),
  categoryId: uuid('category_id').references(() => categories.id),
  rate: decimal('rate', { precision: 6, scale: 2 }).notNull(),
  rateType: varchar('rate_type', { length: 20 }).notNull().default('percentage'),
  isActive: boolean('is_active').notNull().default(true),
})

export const commissions = pgTable('commissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  saleId: uuid('sale_id').references(() => sales.id),
  workOrderId: uuid('work_order_id').references(() => workOrders.id),
  itemName: varchar('item_name', { length: 255 }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  rate: decimal('rate', { precision: 6, scale: 2 }).notNull(),
  rateType: varchar('rate_type', { length: 20 }).notNull(),
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }).notNull(),
  status: commissionStatusEnum('status').notNull().default('pending'),
  payoutId: uuid('payout_id'),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const commissionPayouts = pgTable('commission_payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  payoutNo: varchar('payout_no', { length: 50 }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
  commissionsCount: integer('commissions_count').notNull(),
  status: payoutStatusEnum('status').notNull().default('draft'),
  paymentMethod: varchar('payment_method', { length: 50 }),
  paymentReference: varchar('payment_reference', { length: 255 }),
  paidAt: timestamp('paid_at'),
  paidBy: uuid('paid_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  salarySlipId: uuid('salary_slip_id'),
})

// ==================== HR & PAYROLL ====================

// Employee profiles (1:1 extension of users for HR data)
export const employeeProfiles = pgTable('employee_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  // Employment details
  employeeCode: varchar('employee_code', { length: 50 }),
  employmentType: employmentTypeEnum('employment_type').notNull().default('full_time'),
  employmentStatus: employmentStatusEnum('employment_status').notNull().default('active'),
  department: varchar('department', { length: 100 }),
  designation: varchar('designation', { length: 100 }),
  hireDate: date('hire_date'),
  confirmationDate: date('confirmation_date'),
  terminationDate: date('termination_date'),
  // Compensation
  baseSalary: decimal('base_salary', { precision: 12, scale: 2 }).notNull().default('0'),
  salaryFrequency: varchar('salary_frequency', { length: 20 }).notNull().default('monthly'), // monthly, biweekly, weekly
  // Bank details
  bankName: varchar('bank_name', { length: 100 }),
  bankBranch: varchar('bank_branch', { length: 100 }),
  bankAccountNumber: varchar('bank_account_number', { length: 50 }),
  bankAccountName: varchar('bank_account_name', { length: 100 }),
  bankRoutingNumber: varchar('bank_routing_number', { length: 50 }),
  // Statutory IDs (international - generic field names)
  taxId: varchar('tax_id', { length: 50 }),
  taxIdType: varchar('tax_id_type', { length: 30 }), // NIC, SSN, TIN, etc.
  socialSecurityId: varchar('social_security_id', { length: 50 }),
  socialSecurityIdType: varchar('social_security_id_type', { length: 30 }), // EPF No, Social Security No
  employerContributionId: varchar('employer_contribution_id', { length: 50 }),
  employerContributionIdType: varchar('employer_contribution_id_type', { length: 30 }), // ETF No, etc.
  // Personal
  dateOfBirth: date('date_of_birth'),
  gender: varchar('gender', { length: 20 }),
  emergencyContactName: varchar('emergency_contact_name', { length: 100 }),
  emergencyContactPhone: varchar('emergency_contact_phone', { length: 50 }),
  address: text('address'),
  // Salary structure assignment (Phase 2)
  salaryStructureId: uuid('salary_structure_id'),
  // Metadata
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Salary components (ERPNext-style configurable earning/deduction types)
export const salaryComponents = pgTable('salary_components', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  abbreviation: varchar('abbreviation', { length: 20 }).notNull(), // e.g. "BP", "EPF_E"
  componentType: salaryComponentTypeEnum('component_type').notNull(),
  // Formula
  formulaExpression: text('formula_expression'), // e.g. "base * 0.08"
  defaultAmount: decimal('default_amount', { precision: 12, scale: 2 }),
  // Flags
  isStatutory: boolean('is_statutory').notNull().default(false),
  isFlexibleBenefit: boolean('is_flexible_benefit').notNull().default(false),
  dependsOnPaymentDays: boolean('depends_on_payment_days').notNull().default(true),
  doNotIncludeInTotal: boolean('do_not_include_in_total').notNull().default(false),
  isPayableByEmployer: boolean('is_payable_by_employer').notNull().default(false),
  // Accounting links
  expenseAccountId: uuid('expense_account_id').references(() => chartOfAccounts.id),
  payableAccountId: uuid('payable_account_id').references(() => chartOfAccounts.id),
  // Metadata
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Salary structures (templates grouping components)
export const salaryStructures = pgTable('salary_structures', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Salary structure components (structure <-> component join)
export const salaryStructureComponents = pgTable('salary_structure_components', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  structureId: uuid('structure_id').notNull().references(() => salaryStructures.id),
  componentId: uuid('component_id').notNull().references(() => salaryComponents.id),
  overrideFormula: text('override_formula'),
  overrideAmount: decimal('override_amount', { precision: 12, scale: 2 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
})

// Salary slips (monthly payroll document per employee)
export const salarySlips = pgTable('salary_slips', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  slipNo: varchar('slip_no', { length: 50 }).notNull(),
  // Employee
  employeeProfileId: uuid('employee_profile_id').notNull().references(() => employeeProfiles.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  employeeName: varchar('employee_name', { length: 255 }).notNull(), // snapshot
  // Period
  payrollMonth: integer('payroll_month').notNull(), // 1-12
  payrollYear: integer('payroll_year').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  // Working days
  totalWorkingDays: decimal('total_working_days', { precision: 5, scale: 1 }).notNull().default('30'),
  paymentDays: decimal('payment_days', { precision: 5, scale: 1 }).notNull().default('30'),
  baseSalary: decimal('base_salary', { precision: 12, scale: 2 }).notNull(), // snapshot
  // Totals
  grossPay: decimal('gross_pay', { precision: 12, scale: 2 }).notNull().default('0'),
  totalDeductions: decimal('total_deductions', { precision: 12, scale: 2 }).notNull().default('0'),
  totalEmployerContributions: decimal('total_employer_contributions', { precision: 12, scale: 2 }).notNull().default('0'),
  netPay: decimal('net_pay', { precision: 12, scale: 2 }).notNull().default('0'),
  // Commission link
  commissionPayoutId: uuid('commission_payout_id'),
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // Advance deduction (Phase 3)
  advanceDeduction: decimal('advance_deduction', { precision: 12, scale: 2 }).notNull().default('0'),
  // Structure snapshot
  salaryStructureId: uuid('salary_structure_id'),
  salaryStructureName: varchar('salary_structure_name', { length: 100 }),
  // Status
  status: salarySlipStatusEnum('status').notNull().default('draft'),
  submittedAt: timestamp('submitted_at'),
  submittedBy: uuid('submitted_by'),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by'),
  cancellationReason: text('cancellation_reason'),
  // Payment
  paymentMethod: varchar('payment_method', { length: 50 }),
  paymentReference: varchar('payment_reference', { length: 255 }),
  paidAt: timestamp('paid_at'),
  // Accounting
  journalEntryId: uuid('journal_entry_id'),
  payrollRunId: uuid('payroll_run_id'),
  // Metadata
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Salary slip components (line items in a slip)
export const salarySlipComponents = pgTable('salary_slip_components', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  salarySlipId: uuid('salary_slip_id').notNull().references(() => salarySlips.id, { onDelete: 'cascade' }),
  componentId: uuid('component_id').references(() => salaryComponents.id),
  // Snapshots
  componentName: varchar('component_name', { length: 100 }).notNull(),
  componentType: salaryComponentTypeEnum('component_type').notNull(),
  abbreviation: varchar('abbreviation', { length: 20 }).notNull(),
  formulaUsed: text('formula_used'),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // Flag snapshots
  isStatutory: boolean('is_statutory').notNull().default(false),
  doNotIncludeInTotal: boolean('do_not_include_in_total').notNull().default(false),
  isPayableByEmployer: boolean('is_payable_by_employer').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

// Payroll runs (bulk processing batch)
export const payrollRuns = pgTable('payroll_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  runNo: varchar('run_no', { length: 50 }).notNull(),
  payrollMonth: integer('payroll_month').notNull(),
  payrollYear: integer('payroll_year').notNull(),
  // Filters
  employmentTypes: jsonb('employment_types').$type<string[]>(),
  departments: jsonb('departments').$type<string[]>(),
  // Totals
  totalEmployees: integer('total_employees').notNull().default(0),
  totalGrossPay: decimal('total_gross_pay', { precision: 15, scale: 2 }).notNull().default('0'),
  totalDeductions: decimal('total_deductions', { precision: 15, scale: 2 }).notNull().default('0'),
  totalEmployerContributions: decimal('total_employer_contributions', { precision: 15, scale: 2 }).notNull().default('0'),
  totalNetPay: decimal('total_net_pay', { precision: 15, scale: 2 }).notNull().default('0'),
  totalCommissions: decimal('total_commissions', { precision: 15, scale: 2 }).notNull().default('0'),
  // Status
  status: payrollRunStatusEnum('status').notNull().default('draft'),
  processedAt: timestamp('processed_at'),
  processedBy: uuid('processed_by'),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by'),
  cancellationReason: text('cancellation_reason'),
  // Accounting
  journalEntryId: uuid('journal_entry_id'),
  // Metadata
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Employee advances
export const employeeAdvances = pgTable('employee_advances', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  advanceNo: varchar('advance_no', { length: 50 }).notNull(),
  employeeProfileId: uuid('employee_profile_id').notNull().references(() => employeeProfiles.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  employeeName: varchar('employee_name', { length: 255 }).notNull(),
  // Amounts
  requestedAmount: decimal('requested_amount', { precision: 12, scale: 2 }).notNull(),
  approvedAmount: decimal('approved_amount', { precision: 12, scale: 2 }),
  disbursedAmount: decimal('disbursed_amount', { precision: 12, scale: 2 }),
  recoveredAmount: decimal('recovered_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  balanceAmount: decimal('balance_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // Recovery
  recoveryMethod: varchar('recovery_method', { length: 30 }).notNull().default('salary_deduction'), // salary_deduction, lump_sum
  recoveryInstallments: integer('recovery_installments'),
  recoveryAmountPerInstallment: decimal('recovery_amount_per_installment', { precision: 12, scale: 2 }),
  // Details
  purpose: varchar('purpose', { length: 255 }),
  reason: text('reason'),
  status: employeeAdvanceStatusEnum('status').notNull().default('draft'),
  // Approval workflow
  requestedAt: timestamp('requested_at'),
  approvedAt: timestamp('approved_at'),
  approvedBy: uuid('approved_by'),
  approvalNotes: text('approval_notes'),
  // Disbursement
  disbursedAt: timestamp('disbursed_at'),
  disbursedBy: uuid('disbursed_by'),
  disbursementMethod: varchar('disbursement_method', { length: 50 }),
  disbursementReference: varchar('disbursement_reference', { length: 255 }),
  // Cancellation
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by'),
  cancellationReason: text('cancellation_reason'),
  // Accounting
  journalEntryId: uuid('journal_entry_id'),
  // Metadata
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Advance recovery records (tracks each salary slip deduction)
export const advanceRecoveryRecords = pgTable('advance_recovery_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  advanceId: uuid('advance_id').notNull().references(() => employeeAdvances.id),
  salarySlipId: uuid('salary_slip_id').notNull().references(() => salarySlips.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  balanceAfter: decimal('balance_after', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Module access (admin-configurable module visibility per role)
export const moduleAccess = pgTable('module_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  moduleKey: varchar('module_key', { length: 50 }).notNull(),
  role: userRoleEnum('role').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== CUSTOM ROLES & PERMISSION OVERRIDES ====================

// Tenant-created custom roles based on built-in roles
export const customRoles = pgTable('custom_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 50 }).notNull(),
  baseRole: userRoleEnum('base_role').notNull(),
  description: text('description'),
  color: varchar('color', { length: 7 }),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_custom_roles_tenant_slug').on(table.tenantId, table.slug),
])

// Per-tenant permission overrides for built-in roles or custom roles
export const rolePermissionOverrides = pgTable('role_permission_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  role: userRoleEnum('role'),
  customRoleId: uuid('custom_role_id').references(() => customRoles.id, { onDelete: 'cascade' }),
  permissionKey: varchar('permission_key', { length: 60 }).notNull(),
  isGranted: boolean('is_granted').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== DAY END SESSIONS ====================

export const dayEndSessions = pgTable('day_end_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  sessionDate: date('session_date').notNull(),
  openingCash: decimal('opening_cash', { precision: 12, scale: 2 }).notNull().default('0'),
  closingCash: decimal('closing_cash', { precision: 12, scale: 2 }),
  expectedCash: decimal('expected_cash', { precision: 12, scale: 2 }),
  difference: decimal('difference', { precision: 12, scale: 2 }),
  totalSales: decimal('total_sales', { precision: 12, scale: 2 }).notNull().default('0'),
  totalReturns: decimal('total_returns', { precision: 12, scale: 2 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  openedBy: uuid('opened_by').references(() => users.id),
  closedBy: uuid('closed_by').references(() => users.id),
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
  notes: text('notes'),
})

// ==================== SUPPLIERS & PURCHASES ====================

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  address: text('address'),
  taxId: varchar('tax_id', { length: 50 }),
  balance: decimal('balance', { precision: 12, scale: 2 }).notNull().default('0'),
  paymentTermsTemplateId: uuid('payment_terms_template_id'), // FK to paymentTermsTemplates
  taxInclusive: boolean('tax_inclusive').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  purchaseNo: varchar('purchase_no', { length: 50 }).notNull(),
  purchaseOrderId: uuid('purchase_order_id'), // Link to purchase order (if converted from PO)
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id), // Receiving warehouse
  // Supplier invoice details (moved from purchase orders)
  supplierInvoiceNo: varchar('supplier_invoice_no', { length: 100 }),
  supplierBillDate: date('supplier_bill_date'),
  paymentTerm: varchar('payment_term', { length: 20 }).default('cash'), // 'cash' or 'credit'
  paymentTermsTemplateId: uuid('payment_terms_template_id'), // FK to paymentTermsTemplates
  // Amounts
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'), // Array of TaxBreakdownItem for per-account GL posting
  taxTemplateId: uuid('tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  paidAmount: decimal('paid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // Status tracks payment: pending (unpaid), partial, paid, cancelled
  status: purchaseStatusEnum('status').notNull().default('pending'),
  isReturn: boolean('is_return').notNull().default(false),
  returnAgainst: uuid('return_against'),
  returnReason: varchar('return_reason', { length: 50 }), // defective, wrong_item, excess_quantity, damaged, expired, other
  notes: text('notes'),
  tags: text('tags'), // JSON array of tag strings
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdBy: uuid('created_by').references(() => users.id),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const purchaseItems = pgTable('purchase_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'), // LEGACY: flat amount, kept for backward compat
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  taxTemplateId: uuid('tax_template_id'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
})

// ==================== PURCHASE ORDERS ====================

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  orderNo: varchar('order_no', { length: 50 }).notNull(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  expectedDeliveryDate: date('expected_delivery_date'),
  // Note: supplierInvoiceNo and supplierBillDate are now on purchases table
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  taxTemplateId: uuid('tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  // Status: draft → submitted → confirmed → invoice_created → (cancelled)
  status: purchaseOrderStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),
  tags: text('tags'), // JSON array of tag strings
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  receivedQuantity: decimal('received_quantity', { precision: 12, scale: 3 }).notNull().default('0'),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'), // LEGACY: flat amount, kept for backward compat
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  taxTemplateId: uuid('tax_template_id'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
})

// Purchase payments for tracking payment history
export const purchasePayments = pgTable('purchase_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull().default('cash'),
  paymentReference: varchar('payment_reference', { length: 100 }),
  notes: text('notes'),
  paidAt: timestamp('paid_at').defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Supplier balance audit trail - tracks all changes to supplier balances
export const supplierBalanceAudit = pgTable('supplier_balance_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  type: varchar('type', { length: 50 }).notNull(), // 'purchase', 'payment', 'cancel', 'adjustment', 'delete'
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  previousBalance: decimal('previous_balance', { precision: 12, scale: 2 }).notNull(),
  newBalance: decimal('new_balance', { precision: 12, scale: 2 }).notNull(),
  referenceType: varchar('reference_type', { length: 50 }), // 'purchase', 'purchase_payment'
  referenceId: uuid('reference_id'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== ITEM SUPPLIER COSTS ====================

export const itemSupplierCosts = pgTable('item_supplier_costs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  lastCostPrice: decimal('last_cost_price', { precision: 12, scale: 2 }).notNull().default('0'),
  lastPurchaseDate: timestamp('last_purchase_date'),
  lastPurchaseId: uuid('last_purchase_id').references(() => purchases.id),
  totalPurchasedQty: decimal('total_purchased_qty', { precision: 12, scale: 3 }).notNull().default('0'),
  supplierPartNumber: varchar('supplier_part_number', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== ITEM COST HISTORY ====================

export const itemCostHistory = pgTable('item_cost_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  source: costChangeSourceEnum('source').notNull(),
  previousCostPrice: decimal('previous_cost_price', { precision: 12, scale: 2 }).notNull().default('0'),
  newCostPrice: decimal('new_cost_price', { precision: 12, scale: 2 }).notNull().default('0'),
  purchasePrice: decimal('purchase_price', { precision: 12, scale: 2 }),
  quantity: decimal('quantity', { precision: 12, scale: 3 }),
  stockBefore: decimal('stock_before', { precision: 12, scale: 3 }),
  stockAfter: decimal('stock_after', { precision: 12, scale: 3 }),
  referenceId: uuid('reference_id'),
  referenceNo: varchar('reference_no', { length: 50 }),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== PURCHASE RECEIPTS (GRN) ====================

export const purchaseReceipts = pgTable('purchase_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  receiptNo: varchar('receipt_no', { length: 50 }).notNull(), // GRN-YYYYMMDD-###
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  receiptDate: date('receipt_date').notNull(),
  status: purchaseReceiptStatusEnum('status').notNull().default('draft'),
  supplierInvoiceNo: varchar('supplier_invoice_no', { length: 100 }),
  supplierBillDate: date('supplier_bill_date'),
  notes: text('notes'),
  receivedBy: uuid('received_by').references(() => users.id),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const purchaseReceiptItems = pgTable('purchase_receipt_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  receiptId: uuid('receipt_id').notNull().references(() => purchaseReceipts.id, { onDelete: 'cascade' }),
  purchaseOrderItemId: uuid('purchase_order_item_id').references(() => purchaseOrderItems.id),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantityReceived: decimal('quantity_received', { precision: 12, scale: 3 }).notNull(),
  quantityAccepted: decimal('quantity_accepted', { precision: 12, scale: 3 }).notNull(),
  quantityRejected: decimal('quantity_rejected', { precision: 12, scale: 3 }).notNull().default('0'),
  rejectionReason: text('rejection_reason'),
  notes: text('notes'),
})

// ==================== STOCK TAKES (PHYSICAL INVENTORY COUNT) ====================

export const stockTakes = pgTable('stock_takes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  countNo: varchar('count_no', { length: 50 }).notNull(), // SC-YYYYMMDD-###
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  status: stockTakeStatusEnum('status').notNull().default('draft'),
  countType: varchar('count_type', { length: 20 }).notNull().default('full'), // full, partial, category
  categoryId: uuid('category_id').references(() => categories.id), // For category-based counts
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  totalItems: integer('total_items').notNull().default(0),
  itemsCounted: integer('items_counted').notNull().default(0),
  varianceCount: integer('variance_count').notNull().default(0),
  totalVarianceValue: decimal('total_variance_value', { precision: 12, scale: 2 }).notNull().default('0'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const stockTakeItems = pgTable('stock_take_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  stockTakeId: uuid('stock_take_id').notNull().references(() => stockTakes.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  itemSku: varchar('item_sku', { length: 100 }),
  binLocation: varchar('bin_location', { length: 50 }),
  expectedQuantity: decimal('expected_quantity', { precision: 12, scale: 3 }).notNull(),
  countedQuantity: decimal('counted_quantity', { precision: 12, scale: 3 }),
  variance: decimal('variance', { precision: 12, scale: 3 }),
  varianceValue: decimal('variance_value', { precision: 12, scale: 2 }),
  costPrice: decimal('cost_price', { precision: 12, scale: 2 }).notNull().default('0'),
  countedBy: uuid('counted_by').references(() => users.id),
  countedAt: timestamp('counted_at'),
  notes: text('notes'),
})

// ==================== ITEM BATCHES (LOT/BATCH TRACKING) ====================

export const itemBatches = pgTable('item_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  batchNumber: varchar('batch_number', { length: 100 }).notNull(),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  manufacturingDate: date('manufacturing_date'),
  expiryDate: date('expiry_date'),
  initialQuantity: decimal('initial_quantity', { precision: 12, scale: 3 }).notNull(),
  currentQuantity: decimal('current_quantity', { precision: 12, scale: 3 }).notNull(),
  supplierBatchNumber: varchar('supplier_batch_number', { length: 100 }),
  purchaseReceiptId: uuid('purchase_receipt_id').references(() => purchaseReceipts.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  status: batchStatusEnum('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== SERIAL NUMBER TRACKING ====================

export const itemSerialNumbers = pgTable('item_serial_numbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  serialNumber: varchar('serial_number', { length: 255 }).notNull(),
  status: serialNumberStatusEnum('status').notNull().default('available'),
  warrantyStartDate: date('warranty_start_date'),
  warrantyEndDate: date('warranty_end_date'),
  warrantyNotes: text('warranty_notes'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const serialNumberMovements = pgTable('serial_number_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  serialNumberId: uuid('serial_number_id').notNull().references(() => itemSerialNumbers.id),
  fromStatus: serialNumberStatusEnum('from_status'),
  toStatus: serialNumberStatusEnum('to_status').notNull(),
  fromWarehouseId: uuid('from_warehouse_id').references(() => warehouses.id),
  toWarehouseId: uuid('to_warehouse_id').references(() => warehouses.id),
  referenceType: varchar('reference_type', { length: 50 }),
  referenceId: uuid('reference_id'),
  changedBy: uuid('changed_by').references(() => users.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== PURCHASE REQUISITIONS ====================

export const purchaseRequisitions = pgTable('purchase_requisitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  requisitionNo: varchar('requisition_no', { length: 50 }).notNull(),
  status: purchaseRequisitionStatusEnum('status').notNull().default('draft'),
  requestedBy: uuid('requested_by').references(() => users.id),
  department: varchar('department', { length: 100 }),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  requiredByDate: date('required_by_date'),
  purpose: text('purpose'),
  notes: text('notes'),
  estimatedTotal: decimal('estimated_total', { precision: 12, scale: 2 }).notNull().default('0'),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  approvalNotes: text('approval_notes'),
  rejectedBy: uuid('rejected_by').references(() => users.id),
  rejectedAt: timestamp('rejected_at'),
  rejectionReason: text('rejection_reason'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const purchaseRequisitionItems = pgTable('purchase_requisition_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  requisitionId: uuid('requisition_id').notNull().references(() => purchaseRequisitions.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  orderedQuantity: decimal('ordered_quantity', { precision: 12, scale: 3 }).notNull().default('0'),
  estimatedUnitPrice: decimal('estimated_unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
  estimatedTotal: decimal('estimated_total', { precision: 12, scale: 2 }).notNull().default('0'),
  preferredSupplierId: uuid('preferred_supplier_id').references(() => suppliers.id),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  notes: text('notes'),
})

// ==================== SUPPLIER QUOTATIONS ====================

export const supplierQuotations = pgTable('supplier_quotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  quotationNo: varchar('quotation_no', { length: 50 }).notNull(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  requisitionId: uuid('requisition_id').references(() => purchaseRequisitions.id),
  status: supplierQuotationStatusEnum('status').notNull().default('draft'),
  validUntil: date('valid_until'),
  deliveryDays: integer('delivery_days'),
  paymentTerms: varchar('payment_terms', { length: 255 }),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  taxTemplateId: uuid('tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  supplierReference: varchar('supplier_reference', { length: 100 }),
  notes: text('notes'),
  convertedToPOId: uuid('converted_to_po_id').references(() => purchaseOrders.id),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const supplierQuotationItems = pgTable('supplier_quotation_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  quotationId: uuid('quotation_id').notNull().references(() => supplierQuotations.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'), // LEGACY: flat amount, kept for backward compat
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  taxTemplateId: uuid('tax_template_id'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  deliveryDays: integer('delivery_days'),
  notes: text('notes'),
})

// ==================== SETTINGS ====================

export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  key: varchar('key', { length: 100 }).notNull(),
  value: text('value'),
  type: varchar('type', { length: 20 }).default('string'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== UNIFIED FILE SYSTEM ====================

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileSize: integer('file_size'),
  fileType: varchar('file_type', { length: 100 }),
  contentHash: varchar('content_hash', { length: 64 }),
  isPrivate: boolean('is_private').notNull().default(false),
  isFolder: boolean('is_folder').notNull().default(false),
  folderId: uuid('folder_id'),
  attachedToType: varchar('attached_to_type', { length: 50 }),
  attachedToId: uuid('attached_to_id'),
  attachedToField: varchar('attached_to_field', { length: 50 }),
  thumbnailUrl: text('thumbnail_url'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
  description: text('description'),
  category: varchar('category', { length: 50 }),
  uploadedBy: uuid('uploaded_by').references(() => users.id),

  // Enhanced metadata
  metadata: jsonb('metadata'), // EXIF data, document properties, etc.
  tags: text('tags').array(), // Tags for organization
  processingStatus: varchar('processing_status', { length: 20 }).default('none'), // none, pending, processing, completed, failed
  previewUrl: text('preview_url'), // Generated preview URL

  // Versioning
  versionNumber: integer('version_number').default(1),
  latestVersionId: uuid('latest_version_id'), // Self-ref to latest version (for original files)
  originalFileId: uuid('original_file_id'), // Points to the original file (for versioned copies)

  // Full-text search
  searchContent: text('search_content'), // Extracted text from documents

  // Starred/pinned
  isStarred: boolean('is_starred').default(false),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== FILE SYSTEM ENHANCEMENTS ====================

// File version history
export const fileVersions = pgTable('file_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  fileUrl: text('file_url').notNull(),
  fileSize: integer('file_size'),
  contentHash: varchar('content_hash', { length: 64 }),
  changeDescription: text('change_description'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// User-created collections for organizing files
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  color: varchar('color', { length: 7 }), // Hex color like #FF5733
  icon: varchar('icon', { length: 50 }), // Icon name
  isSmartCollection: boolean('is_smart_collection').default(false),
  filterRules: jsonb('filter_rules'), // For smart collections
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Junction table: collections <-> files
export const collectionFiles = pgTable('collection_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
  addedBy: uuid('added_by').references(() => users.id),
  addedAt: timestamp('added_at').defaultNow().notNull(),
})

// File audit log - tracks access and modifications
export const fileAuditLogs = pgTable('file_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 50 }).notNull(), // 'viewed', 'downloaded', 'uploaded', 'deleted', 'renamed', 'moved', 'shared', 'version_created', 'restored'
  fileName: varchar('file_name', { length: 255 }), // Snapshot of file name at time of action
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  details: jsonb('details'), // Additional context
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== NOTIFICATION SYSTEM ====================

// SMS Settings (per tenant)
export const smsSettings = pgTable('sms_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }).unique(),

  provider: varchar('provider', { length: 50 }).notNull().default('none'), // 'none', 'websms_lk', 'twilio', 'generic_http'
  isEnabled: boolean('is_enabled').notNull().default(false),

  // WebSMS.lk / Newsletters.lk
  websmsApiKey: varchar('websms_api_key', { length: 255 }),
  websmsApiToken: varchar('websms_api_token', { length: 255 }),
  websmsSenderId: varchar('websms_sender_id', { length: 20 }),

  // Twilio
  twilioAccountSid: varchar('twilio_account_sid', { length: 100 }),
  twilioAuthToken: varchar('twilio_auth_token', { length: 255 }),
  twilioPhoneNumber: varchar('twilio_phone_number', { length: 20 }),

  // Generic HTTP Gateway
  genericApiUrl: varchar('generic_api_url', { length: 500 }),
  genericMethod: varchar('generic_method', { length: 10 }).default('POST'),
  genericHeaders: jsonb('generic_headers').default('{}'),
  genericBodyTemplate: text('generic_body_template'),
  genericAuthType: varchar('generic_auth_type', { length: 20 }), // 'none', 'basic', 'bearer', 'api_key'
  genericAuthValue: varchar('generic_auth_value', { length: 255 }),
  // ERPNext-style params
  genericMessageParam: varchar('generic_message_param', { length: 50 }).default('text'),
  genericRecipientParam: varchar('generic_recipient_param', { length: 50 }).default('to'),
  genericStaticParams: jsonb('generic_static_params').default('[]'), // Array of {key, value}

  dailyLimit: integer('daily_limit').default(500),
  monthlyLimit: integer('monthly_limit').default(10000),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Email Settings (per tenant)
export const emailSettings = pgTable('email_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }).unique(),

  provider: varchar('provider', { length: 50 }).notNull().default('none'), // 'none', 'smtp', 'sendgrid', 'resend'
  isEnabled: boolean('is_enabled').notNull().default(false),

  fromName: varchar('from_name', { length: 100 }),
  fromEmail: varchar('from_email', { length: 255 }),
  replyToEmail: varchar('reply_to_email', { length: 255 }),

  // SMTP (Nodemailer)
  smtpHost: varchar('smtp_host', { length: 255 }),
  smtpPort: integer('smtp_port').default(587),
  smtpSecure: boolean('smtp_secure').default(true),
  smtpUser: varchar('smtp_user', { length: 255 }),
  smtpPassword: varchar('smtp_password', { length: 255 }),

  // SendGrid
  sendgridApiKey: varchar('sendgrid_api_key', { length: 255 }),

  // Resend
  resendApiKey: varchar('resend_api_key', { length: 255 }),

  dailyLimit: integer('daily_limit').default(500),
  monthlyLimit: integer('monthly_limit').default(10000),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Notification Templates
export const notificationTemplates = pgTable('notification_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 100 }).notNull(),
  channel: varchar('channel', { length: 20 }).notNull(), // 'sms', 'email', 'both'

  // Auto-trigger settings
  triggerEvent: varchar('trigger_event', { length: 100 }), // 'work_order.created', 'appointment.reminder', etc.
  isAutoTrigger: boolean('is_auto_trigger').default(false),

  // SMS content
  smsContent: text('sms_content'),

  // Email content
  emailSubject: varchar('email_subject', { length: 255 }),
  emailBody: text('email_body'),

  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Notification Logs (message history)
export const notificationLogs = pgTable('notification_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),

  channel: varchar('channel', { length: 20 }).notNull(), // 'sms', 'email'
  status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending', 'sent', 'delivered', 'failed'

  // Recipient info
  recipientType: varchar('recipient_type', { length: 50 }), // 'customer', 'supplier', 'staff', 'manual'
  recipientId: uuid('recipient_id'),
  recipientName: varchar('recipient_name', { length: 255 }),
  recipientContact: varchar('recipient_contact', { length: 255 }).notNull(), // phone number or email

  // Message content
  templateId: uuid('template_id').references(() => notificationTemplates.id, { onDelete: 'set null' }),
  subject: varchar('subject', { length: 255 }), // for emails
  content: text('content').notNull(),

  // Related entity
  entityType: varchar('entity_type', { length: 50 }), // 'work_order', 'appointment', 'sale', etc.
  entityId: uuid('entity_id'),
  entityReference: varchar('entity_reference', { length: 50 }), // work order number, invoice number, etc.

  // Provider response
  provider: varchar('provider', { length: 50 }),
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  providerResponse: jsonb('provider_response'),
  errorMessage: text('error_message'),

  // Cost tracking
  cost: decimal('cost', { precision: 10, scale: 4 }).default('0'),
  segments: integer('segments').default(1), // SMS segments

  // Timestamps
  sentBy: uuid('sent_by').references(() => users.id),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Usage Tracking (monthly aggregates)
export const notificationUsage = pgTable('notification_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 20 }).notNull(), // 'sms', 'email'
  periodMonth: date('period_month').notNull(), // First day of month
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).default('0'),
})

// ==================== WORKSPACE CONFIGS ====================

export const workspaceConfigs = pgTable('workspace_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  workspaceKey: varchar('workspace_key', { length: 50 }).notNull(),
  blocks: jsonb('blocks').notNull(), // WorkspaceBlock[]
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('workspace_configs_tenant_user_key').on(table.tenantId, table.userId, table.workspaceKey),
])

// ==================== RELATIONS ====================

// Account relations (global user accounts)
export const accountsRelations = relations(accounts, ({ many }) => ({
  accountTenants: many(accountTenants),
  staffInvites: many(staffInvites),
  subscriptions: many(subscriptions),
  billingInvoices: many(billingInvoices),
  users: many(users),
  adminAuditLogs: many(adminAuditLogs),
  adminSessions: many(adminSessions),
  accountSessions: many(accountSessions),
  pendingCompanies: many(pendingCompanies),
  payhereTransactions: many(payhereTransactions),
}))

export const accountSessionsRelations = relations(accountSessions, ({ one }) => ({
  account: one(accounts, {
    fields: [accountSessions.accountId],
    references: [accounts.id],
  }),
}))

// Account-Tenant membership relations
export const accountTenantsRelations = relations(accountTenants, ({ one }) => ({
  account: one(accounts, { fields: [accountTenants.accountId], references: [accounts.id] }),
  tenant: one(tenants, { fields: [accountTenants.tenantId], references: [tenants.id] }),
  invitedByAccount: one(accounts, { fields: [accountTenants.invitedBy], references: [accounts.id] }),
}))

// Pricing tier relations
export const pricingTiersRelations = relations(pricingTiers, ({ many }) => ({
  subscriptions: many(subscriptions),
  pendingCompanies: many(pendingCompanies),
}))

// Pending company relations
export const pendingCompaniesRelations = relations(pendingCompanies, ({ one }) => ({
  account: one(accounts, { fields: [pendingCompanies.accountId], references: [accounts.id] }),
  tier: one(pricingTiers, { fields: [pendingCompanies.tierId], references: [pricingTiers.id] }),
}))

// Subscription relations
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  tenant: one(tenants, { fields: [subscriptions.tenantId], references: [tenants.id] }),
  billingAccount: one(accounts, { fields: [subscriptions.billingAccountId], references: [accounts.id] }),
  tier: one(pricingTiers, { fields: [subscriptions.tierId], references: [pricingTiers.id] }),
}))

// Staff invite relations
export const staffInvitesRelations = relations(staffInvites, ({ one }) => ({
  invitedByAccount: one(accounts, { fields: [staffInvites.invitedBy], references: [accounts.id] }),
}))

// Billing invoice relations
export const billingInvoicesRelations = relations(billingInvoices, ({ one }) => ({
  account: one(accounts, { fields: [billingInvoices.accountId], references: [accounts.id] }),
}))

export const paymentDepositsRelations = relations(paymentDeposits, ({ one }) => ({
  account: one(accounts, { fields: [paymentDeposits.accountId], references: [accounts.id] }),
  subscription: one(subscriptions, { fields: [paymentDeposits.subscriptionId], references: [subscriptions.id] }),
  reviewer: one(accounts, { fields: [paymentDeposits.reviewedBy], references: [accounts.id] }),
}))

// Admin audit log relations
export const adminAuditLogsRelations = relations(adminAuditLogs, ({ one }) => ({
  account: one(accounts, { fields: [adminAuditLogs.accountId], references: [accounts.id] }),
}))

// Admin session relations
export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  superAdmin: one(superAdmins, { fields: [adminSessions.superAdminId], references: [superAdmins.id] }),
}))

// Tenant relations
export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  primaryOwner: one(accounts, { fields: [tenants.primaryOwnerId], references: [accounts.id] }),
  accountTenants: many(accountTenants),
  subscription: one(subscriptions),
  users: many(users),
  customers: many(customers),
  items: many(items),
  categories: many(categories),
  sales: many(sales),
  workOrders: many(workOrders),
  vehicles: many(vehicles),
  appointments: many(appointments),
  serviceTypes: many(serviceTypes),
  insuranceCompanies: many(insuranceCompanies),
  insuranceEstimates: many(insuranceEstimates),
  vehicleTypes: many(vehicleTypes),
  inspectionTemplates: many(inspectionTemplates),
  vehicleInspections: many(vehicleInspections),
  warehouses: many(warehouses),
  stockTransfers: many(stockTransfers),
  usage: one(tenantUsage),
  lockoutEvents: many(lockoutEvents),
  vehicleInventory: many(vehicleInventory),
}))

// Tenant Usage relations
export const tenantUsageRelations = relations(tenantUsage, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantUsage.tenantId], references: [tenants.id] }),
}))

// User relations
export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  account: one(accounts, { fields: [users.accountId], references: [accounts.id] }),
  dealer: one(dealers, { fields: [users.dealerId], references: [dealers.id] }),
  employeeProfile: one(employeeProfiles),
  sales: many(sales),
  workOrdersAssigned: many(workOrders),
  workOrdersCreated: many(workOrders),
  userWarehouses: many(userWarehouses),
  posProfileUsers: many(posProfileUsers),
  posOpeningEntries: many(posOpeningEntries),
}))

// Customer relations
export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  vehicles: many(vehicles),
  sales: many(sales),
  workOrders: many(workOrders),
  appointments: many(appointments),
  creditTransactions: many(customerCreditTransactions),
  insuranceEstimates: many(insuranceEstimates),
}))

// Customer credit transaction relations
export const customerCreditTransactionsRelations = relations(customerCreditTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [customerCreditTransactions.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [customerCreditTransactions.customerId], references: [customers.id] }),
  createdByUser: one(users, { fields: [customerCreditTransactions.createdBy], references: [users.id] }),
}))

// ==================== WAREHOUSE RELATIONS ====================

// Warehouse relations
export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [warehouses.tenantId], references: [tenants.id] }),
  userWarehouses: many(userWarehouses),
  warehouseStock: many(warehouseStock),
  transfersFrom: many(stockTransfers, { relationName: 'fromWarehouse' }),
  transfersTo: many(stockTransfers, { relationName: 'toWarehouse' }),
  posProfiles: many(posProfiles),
  sales: many(sales),
  workOrders: many(workOrders),
  purchases: many(purchases),
  heldSales: many(heldSales),
  insuranceEstimates: many(insuranceEstimates),
  stockMovements: many(stockMovements),
}))

// User-Warehouse assignment relations
export const userWarehousesRelations = relations(userWarehouses, ({ one }) => ({
  tenant: one(tenants, { fields: [userWarehouses.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [userWarehouses.userId], references: [users.id] }),
  warehouse: one(warehouses, { fields: [userWarehouses.warehouseId], references: [warehouses.id] }),
}))

// Warehouse stock relations
export const warehouseStockRelations = relations(warehouseStock, ({ one }) => ({
  tenant: one(tenants, { fields: [warehouseStock.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [warehouseStock.warehouseId], references: [warehouses.id] }),
  item: one(items, { fields: [warehouseStock.itemId], references: [items.id] }),
}))

// Stock transfer relations
export const stockTransfersRelations = relations(stockTransfers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [stockTransfers.tenantId], references: [tenants.id] }),
  fromWarehouse: one(warehouses, { fields: [stockTransfers.fromWarehouseId], references: [warehouses.id], relationName: 'fromWarehouse' }),
  toWarehouse: one(warehouses, { fields: [stockTransfers.toWarehouseId], references: [warehouses.id], relationName: 'toWarehouse' }),
  requestedByUser: one(users, { fields: [stockTransfers.requestedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [stockTransfers.approvedBy], references: [users.id] }),
  shippedByUser: one(users, { fields: [stockTransfers.shippedBy], references: [users.id] }),
  receivedByUser: one(users, { fields: [stockTransfers.receivedBy], references: [users.id] }),
  items: many(stockTransferItems),
}))

// Stock transfer items relations
export const stockTransferItemsRelations = relations(stockTransferItems, ({ one }) => ({
  tenant: one(tenants, { fields: [stockTransferItems.tenantId], references: [tenants.id] }),
  transfer: one(stockTransfers, { fields: [stockTransferItems.transferId], references: [stockTransfers.id] }),
  item: one(items, { fields: [stockTransferItems.itemId], references: [items.id] }),
}))

// POS profile relations
export const posProfilesRelations = relations(posProfiles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [posProfiles.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [posProfiles.warehouseId], references: [warehouses.id] }),
  defaultCustomer: one(customers, { fields: [posProfiles.defaultCustomerId], references: [customers.id] }),
  costCenter: one(costCenters, { fields: [posProfiles.costCenterId], references: [costCenters.id] }),
  paymentMethods: many(posProfilePaymentMethods),
  users: many(posProfileUsers),
  itemGroups: many(posProfileItemGroups),
  openingEntries: many(posOpeningEntries),
}))

// POS Profile Payment Methods relations
export const posProfilePaymentMethodsRelations = relations(posProfilePaymentMethods, ({ one }) => ({
  tenant: one(tenants, { fields: [posProfilePaymentMethods.tenantId], references: [tenants.id] }),
  posProfile: one(posProfiles, { fields: [posProfilePaymentMethods.posProfileId], references: [posProfiles.id] }),
  account: one(chartOfAccounts, { fields: [posProfilePaymentMethods.accountId], references: [chartOfAccounts.id] }),
}))

// POS Profile Users relations
export const posProfileUsersRelations = relations(posProfileUsers, ({ one }) => ({
  tenant: one(tenants, { fields: [posProfileUsers.tenantId], references: [tenants.id] }),
  posProfile: one(posProfiles, { fields: [posProfileUsers.posProfileId], references: [posProfiles.id] }),
  user: one(users, { fields: [posProfileUsers.userId], references: [users.id] }),
}))

// POS Profile Item Groups relations
export const posProfileItemGroupsRelations = relations(posProfileItemGroups, ({ one }) => ({
  tenant: one(tenants, { fields: [posProfileItemGroups.tenantId], references: [tenants.id] }),
  posProfile: one(posProfiles, { fields: [posProfileItemGroups.posProfileId], references: [posProfiles.id] }),
  category: one(categories, { fields: [posProfileItemGroups.categoryId], references: [categories.id] }),
}))

// POS Opening Entry relations
export const posOpeningEntriesRelations = relations(posOpeningEntries, ({ one, many }) => ({
  tenant: one(tenants, { fields: [posOpeningEntries.tenantId], references: [tenants.id] }),
  posProfile: one(posProfiles, { fields: [posOpeningEntries.posProfileId], references: [posProfiles.id] }),
  user: one(users, { fields: [posOpeningEntries.userId], references: [users.id], relationName: 'posOpeningUser' }),
  cancelledByUser: one(users, { fields: [posOpeningEntries.cancelledBy], references: [users.id], relationName: 'posOpeningCancelledBy' }),
  warehouse: one(warehouses, { fields: [posOpeningEntries.warehouseId], references: [warehouses.id] }),
  balances: many(posOpeningBalances),
  closingEntry: one(posClosingEntries),
  sales: many(sales),
}))

// POS Opening Balances relations
export const posOpeningBalancesRelations = relations(posOpeningBalances, ({ one }) => ({
  tenant: one(tenants, { fields: [posOpeningBalances.tenantId], references: [tenants.id] }),
  openingEntry: one(posOpeningEntries, { fields: [posOpeningBalances.openingEntryId], references: [posOpeningEntries.id] }),
}))

// POS Closing Entry relations
export const posClosingEntriesRelations = relations(posClosingEntries, ({ one, many }) => ({
  tenant: one(tenants, { fields: [posClosingEntries.tenantId], references: [tenants.id] }),
  openingEntry: one(posOpeningEntries, { fields: [posClosingEntries.openingEntryId], references: [posOpeningEntries.id] }),
  posProfile: one(posProfiles, { fields: [posClosingEntries.posProfileId], references: [posProfiles.id] }),
  user: one(users, { fields: [posClosingEntries.userId], references: [users.id], relationName: 'posClosingUser' }),
  submittedByUser: one(users, { fields: [posClosingEntries.submittedBy], references: [users.id], relationName: 'posClosingSubmittedBy' }),
  cancelledByUser: one(users, { fields: [posClosingEntries.cancelledBy], references: [users.id], relationName: 'posClosingCancelledBy' }),
  reconciliation: many(posClosingReconciliation),
}))

// POS Closing Reconciliation relations
export const posClosingReconciliationRelations = relations(posClosingReconciliation, ({ one }) => ({
  tenant: one(tenants, { fields: [posClosingReconciliation.tenantId], references: [tenants.id] }),
  closingEntry: one(posClosingEntries, { fields: [posClosingReconciliation.closingEntryId], references: [posClosingEntries.id] }),
}))

// Loyalty Programs relations
export const loyaltyProgramsRelations = relations(loyaltyPrograms, ({ one }) => ({
  tenant: one(tenants, { fields: [loyaltyPrograms.tenantId], references: [tenants.id] }),
}))

export const loyaltyTiersRelations = relations(loyaltyTiers, ({ one }) => ({
  tenant: one(tenants, { fields: [loyaltyTiers.tenantId], references: [tenants.id] }),
}))

export const loyaltyTransactionsRelations = relations(loyaltyTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [loyaltyTransactions.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [loyaltyTransactions.customerId], references: [customers.id] }),
  sale: one(sales, { fields: [loyaltyTransactions.saleId], references: [sales.id] }),
}))

// Category relations
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [categories.tenantId], references: [tenants.id] }),
  items: many(items),
  posProfileItemGroups: many(posProfileItemGroups),
}))

// Item relations
export const itemsRelations = relations(items, ({ one, many }) => ({
  tenant: one(tenants, { fields: [items.tenantId], references: [tenants.id] }),
  category: one(categories, { fields: [items.categoryId], references: [categories.id] }),
  supplier: one(suppliers, { fields: [items.supplierId], references: [suppliers.id] }),
  supersededByItem: one(items, { fields: [items.supersededBy], references: [items.id] }),
  taxTemplate: one(taxTemplates, { fields: [items.taxTemplateId], references: [taxTemplates.id] }),
  saleItems: many(saleItems),
  workOrderParts: many(workOrderParts),
  compatibility: many(partCompatibility),
  warehouseStock: many(warehouseStock),
  supplierCosts: many(itemSupplierCosts),
  costHistory: many(itemCostHistory),
}))

// Vehicle Make relations
export const vehicleMakesRelations = relations(vehicleMakes, ({ many }) => ({
  models: many(vehicleModels),
  vehicleInventory: many(vehicleInventory),
}))

// Vehicle Model relations
export const vehicleModelsRelations = relations(vehicleModels, ({ one, many }) => ({
  make: one(vehicleMakes, { fields: [vehicleModels.makeId], references: [vehicleMakes.id] }),
  vehicleInventory: many(vehicleInventory),
}))

// Vehicle Type relations
export const vehicleTypesRelations = relations(vehicleTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [vehicleTypes.tenantId], references: [tenants.id] }),
  diagramViews: many(vehicleTypeDiagramViews),
  vehicles: many(vehicles),
  inspectionTemplates: many(inspectionTemplates),
}))

// Vehicle Type Diagram View relations
export const vehicleTypeDiagramViewsRelations = relations(vehicleTypeDiagramViews, ({ one }) => ({
  tenant: one(tenants, { fields: [vehicleTypeDiagramViews.tenantId], references: [tenants.id] }),
  vehicleType: one(vehicleTypes, { fields: [vehicleTypeDiagramViews.vehicleTypeId], references: [vehicleTypes.id] }),
}))

// Vehicle relations
export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [vehicles.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [vehicles.customerId], references: [customers.id] }),
  vehicleType: one(vehicleTypes, { fields: [vehicles.vehicleTypeId], references: [vehicleTypes.id] }),
  workOrders: many(workOrders),
  appointments: many(appointments),
  insuranceEstimates: many(insuranceEstimates),
  inspections: many(vehicleInspections),
  ownershipHistory: many(vehicleOwnershipHistory),
}))

export const vehicleOwnershipHistoryRelations = relations(vehicleOwnershipHistory, ({ one }) => ({
  tenant: one(tenants, { fields: [vehicleOwnershipHistory.tenantId], references: [tenants.id] }),
  vehicle: one(vehicles, { fields: [vehicleOwnershipHistory.vehicleId], references: [vehicles.id] }),
  customer: one(customers, { fields: [vehicleOwnershipHistory.customerId], references: [customers.id] }),
  previousCustomer: one(customers, { fields: [vehicleOwnershipHistory.previousCustomerId], references: [customers.id] }),
  changedByUser: one(users, { fields: [vehicleOwnershipHistory.changedBy], references: [users.id] }),
}))

// Service Type Group relations
export const serviceTypeGroupsRelations = relations(serviceTypeGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [serviceTypeGroups.tenantId], references: [tenants.id] }),
  serviceTypes: many(serviceTypes),
}))

// Service Type relations
export const serviceTypesRelations = relations(serviceTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [serviceTypes.tenantId], references: [tenants.id] }),
  group: one(serviceTypeGroups, { fields: [serviceTypes.groupId], references: [serviceTypeGroups.id] }),
  workOrderServices: many(workOrderServices),
  appointments: many(appointments),
  laborGuides: many(laborGuides),
}))

// Labor Guide relations
export const laborGuidesRelations = relations(laborGuides, ({ one }) => ({
  tenant: one(tenants, { fields: [laborGuides.tenantId], references: [tenants.id] }),
  serviceType: one(serviceTypes, { fields: [laborGuides.serviceTypeId], references: [serviceTypes.id] }),
  make: one(vehicleMakes, { fields: [laborGuides.makeId], references: [vehicleMakes.id] }),
  model: one(vehicleModels, { fields: [laborGuides.modelId], references: [vehicleModels.id] }),
}))

// Work Order relations
export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workOrders.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [workOrders.customerId], references: [customers.id] }),
  vehicle: one(vehicles, { fields: [workOrders.vehicleId], references: [vehicles.id] }),
  warehouse: one(warehouses, { fields: [workOrders.warehouseId], references: [warehouses.id] }),
  assignedUser: one(users, { fields: [workOrders.assignedTo], references: [users.id] }),
  createdByUser: one(users, { fields: [workOrders.createdBy], references: [users.id] }),
  services: many(workOrderServices),
  parts: many(workOrderParts),
  appointments: many(appointments),
  insuranceEstimates: many(insuranceEstimates),
  inspections: many(vehicleInspections),
  assignmentHistory: many(workOrderAssignmentHistory),
  sales: many(sales),
}))

// Work Order Assignment History relations
export const workOrderAssignmentHistoryRelations = relations(workOrderAssignmentHistory, ({ one }) => ({
  tenant: one(tenants, { fields: [workOrderAssignmentHistory.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [workOrderAssignmentHistory.workOrderId], references: [workOrders.id] }),
  assignedToUser: one(users, { fields: [workOrderAssignmentHistory.assignedTo], references: [users.id] }),
  previousAssignedToUser: one(users, { fields: [workOrderAssignmentHistory.previousAssignedTo], references: [users.id] }),
  changedByUser: one(users, { fields: [workOrderAssignmentHistory.changedBy], references: [users.id] }),
}))

// Work Order Service relations
export const workOrderServicesRelations = relations(workOrderServices, ({ one }) => ({
  tenant: one(tenants, { fields: [workOrderServices.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [workOrderServices.workOrderId], references: [workOrders.id] }),
  serviceType: one(serviceTypes, { fields: [workOrderServices.serviceTypeId], references: [serviceTypes.id] }),
  technician: one(users, { fields: [workOrderServices.technicianId], references: [users.id] }),
}))

// Work Order Parts relations
export const workOrderPartsRelations = relations(workOrderParts, ({ one }) => ({
  tenant: one(tenants, { fields: [workOrderParts.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [workOrderParts.workOrderId], references: [workOrders.id] }),
  item: one(items, { fields: [workOrderParts.itemId], references: [items.id] }),
}))

// Appointment relations
export const appointmentsRelations = relations(appointments, ({ one }) => ({
  tenant: one(tenants, { fields: [appointments.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [appointments.customerId], references: [customers.id] }),
  vehicle: one(vehicles, { fields: [appointments.vehicleId], references: [vehicles.id] }),
  serviceType: one(serviceTypes, { fields: [appointments.serviceTypeId], references: [serviceTypes.id] }),
  workOrder: one(workOrders, { fields: [appointments.workOrderId], references: [workOrders.id] }),
}))

// Insurance Company relations
export const insuranceCompaniesRelations = relations(insuranceCompanies, ({ one, many }) => ({
  tenant: one(tenants, { fields: [insuranceCompanies.tenantId], references: [tenants.id] }),
  estimates: many(insuranceEstimates),
  assessors: many(insuranceAssessors),
}))

// Insurance Assessor relations
export const insuranceAssessorsRelations = relations(insuranceAssessors, ({ one, many }) => ({
  tenant: one(tenants, { fields: [insuranceAssessors.tenantId], references: [tenants.id] }),
  insuranceCompany: one(insuranceCompanies, { fields: [insuranceAssessors.insuranceCompanyId], references: [insuranceCompanies.id] }),
  estimates: many(insuranceEstimates),
}))

// Insurance Estimate relations
export const insuranceEstimatesRelations = relations(insuranceEstimates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [insuranceEstimates.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [insuranceEstimates.customerId], references: [customers.id] }),
  vehicle: one(vehicles, { fields: [insuranceEstimates.vehicleId], references: [vehicles.id] }),
  warehouse: one(warehouses, { fields: [insuranceEstimates.warehouseId], references: [warehouses.id] }),
  insuranceCompany: one(insuranceCompanies, { fields: [insuranceEstimates.insuranceCompanyId], references: [insuranceCompanies.id] }),
  assessor: one(insuranceAssessors, { fields: [insuranceEstimates.assessorId], references: [insuranceAssessors.id] }),
  workOrder: one(workOrders, { fields: [insuranceEstimates.workOrderId], references: [workOrders.id] }),
  createdByUser: one(users, { fields: [insuranceEstimates.createdBy], references: [users.id] }),
  submittedByUser: one(users, { fields: [insuranceEstimates.submittedBy], references: [users.id] }),
  items: many(insuranceEstimateItems),
  revisions: many(insuranceEstimateRevisions),
  attachments: many(insuranceEstimateAttachments), // E23
}))

// Insurance Estimate Item relations
export const insuranceEstimateItemsRelations = relations(insuranceEstimateItems, ({ one }) => ({
  tenant: one(tenants, { fields: [insuranceEstimateItems.tenantId], references: [tenants.id] }),
  estimate: one(insuranceEstimates, { fields: [insuranceEstimateItems.estimateId], references: [insuranceEstimates.id] }),
  serviceType: one(serviceTypes, { fields: [insuranceEstimateItems.serviceTypeId], references: [serviceTypes.id] }),
  item: one(items, { fields: [insuranceEstimateItems.itemId], references: [items.id] }),
}))

// E23: Insurance Estimate Attachment relations
export const insuranceEstimateAttachmentsRelations = relations(insuranceEstimateAttachments, ({ one }) => ({
  tenant: one(tenants, { fields: [insuranceEstimateAttachments.tenantId], references: [tenants.id] }),
  estimate: one(insuranceEstimates, { fields: [insuranceEstimateAttachments.estimateId], references: [insuranceEstimates.id] }),
  uploadedByUser: one(users, { fields: [insuranceEstimateAttachments.uploadedBy], references: [users.id] }),
}))

// E25: Estimate Template relations
export const estimateTemplatesRelations = relations(estimateTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [estimateTemplates.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [estimateTemplates.createdBy], references: [users.id] }),
}))

// X4: Activity Log relations
export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [activityLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [activityLogs.userId], references: [users.id] }),
}))

export const documentCommentsRelations = relations(documentComments, ({ one }) => ({
  tenant: one(tenants, { fields: [documentComments.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [documentComments.userId], references: [users.id] }),
}))

// Insurance Estimate Revision relations
export const insuranceEstimateRevisionsRelations = relations(insuranceEstimateRevisions, ({ one }) => ({
  tenant: one(tenants, { fields: [insuranceEstimateRevisions.tenantId], references: [tenants.id] }),
  estimate: one(insuranceEstimates, { fields: [insuranceEstimateRevisions.estimateId], references: [insuranceEstimates.id] }),
  changedByUser: one(users, { fields: [insuranceEstimateRevisions.changedBy], references: [users.id] }),
}))

// Sale relations
export const salesRelations = relations(sales, ({ one, many }) => ({
  tenant: one(tenants, { fields: [sales.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [sales.customerId], references: [customers.id] }),
  vehicle: one(vehicles, { fields: [sales.vehicleId], references: [vehicles.id] }),
  warehouse: one(warehouses, { fields: [sales.warehouseId], references: [warehouses.id] }),
  posOpeningEntry: one(posOpeningEntries, { fields: [sales.posOpeningEntryId], references: [posOpeningEntries.id] }),
  user: one(users, { fields: [sales.createdBy], references: [users.id] }),
  workOrder: one(workOrders, { fields: [sales.workOrderId], references: [workOrders.id] }),
  restaurantOrder: one(restaurantOrders, { fields: [sales.restaurantOrderId], references: [restaurantOrders.id] }),
  items: many(saleItems),
  payments: many(payments),
  refunds: many(refunds),
  vehicleSaleDetails: one(vehicleSaleDetails),
  tradeInVehicles: many(tradeInVehicles),
  vehicleWarranties: many(vehicleWarranties),
  vehicleInventorySold: many(vehicleInventory),
}))

// Sale Items relations
export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  tenant: one(tenants, { fields: [saleItems.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  item: one(items, { fields: [saleItems.itemId], references: [items.id] }),
}))

// Payment relations
export const paymentsRelations = relations(payments, ({ one }) => ({
  tenant: one(tenants, { fields: [payments.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [payments.saleId], references: [sales.id] }),
  receivedByUser: one(users, { fields: [payments.receivedBy], references: [users.id] }),
}))

// Refund relations
export const refundsRelations = relations(refunds, ({ one }) => ({
  tenant: one(tenants, { fields: [refunds.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [refunds.saleId], references: [sales.id], relationName: 'refundSale' }),
  originalSale: one(sales, { fields: [refunds.originalSaleId], references: [sales.id], relationName: 'refundOriginalSale' }),
  processedByUser: one(users, { fields: [refunds.processedBy], references: [users.id] }),
}))

// Held Sales relations
export const heldSalesRelations = relations(heldSales, ({ one }) => ({
  tenant: one(tenants, { fields: [heldSales.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [heldSales.customerId], references: [customers.id] }),
  vehicle: one(vehicles, { fields: [heldSales.vehicleId], references: [vehicles.id] }),
  warehouse: one(warehouses, { fields: [heldSales.warehouseId], references: [warehouses.id] }),
  heldByUser: one(users, { fields: [heldSales.heldBy], references: [users.id] }),
}))

// Stock Movement relations
export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  tenant: one(tenants, { fields: [stockMovements.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [stockMovements.warehouseId], references: [warehouses.id] }),
  item: one(items, { fields: [stockMovements.itemId], references: [items.id] }),
  createdByUser: one(users, { fields: [stockMovements.createdBy], references: [users.id] }),
}))

// ==================== PURCHASING RELATIONS ====================

// Supplier relations
export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [suppliers.tenantId], references: [tenants.id] }),
  items: many(items),
  purchases: many(purchases),
  purchaseOrders: many(purchaseOrders),
  balanceAudit: many(supplierBalanceAudit),
  itemCosts: many(itemSupplierCosts),
}))

// Purchase relations
export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  tenant: one(tenants, { fields: [purchases.tenantId], references: [tenants.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [purchases.purchaseOrderId], references: [purchaseOrders.id] }),
  supplier: one(suppliers, { fields: [purchases.supplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [purchases.warehouseId], references: [warehouses.id] }),
  createdByUser: one(users, { fields: [purchases.createdBy], references: [users.id] }),
  items: many(purchaseItems),
  payments: many(purchasePayments),
}))

// Purchase Items relations
export const purchaseItemsRelations = relations(purchaseItems, ({ one }) => ({
  tenant: one(tenants, { fields: [purchaseItems.tenantId], references: [tenants.id] }),
  purchase: one(purchases, { fields: [purchaseItems.purchaseId], references: [purchases.id] }),
  item: one(items, { fields: [purchaseItems.itemId], references: [items.id] }),
}))

// Purchase Order relations
export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [purchaseOrders.tenantId], references: [tenants.id] }),
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [purchaseOrders.warehouseId], references: [warehouses.id] }),
  createdByUser: one(users, { fields: [purchaseOrders.createdBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [purchaseOrders.approvedBy], references: [users.id] }),
  items: many(purchaseOrderItems),
  receipts: many(purchaseReceipts),
}))

// Purchase Order Items relations
export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  tenant: one(tenants, { fields: [purchaseOrderItems.tenantId], references: [tenants.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderItems.purchaseOrderId], references: [purchaseOrders.id] }),
  item: one(items, { fields: [purchaseOrderItems.itemId], references: [items.id] }),
}))

// Purchase Payments relations
export const purchasePaymentsRelations = relations(purchasePayments, ({ one }) => ({
  tenant: one(tenants, { fields: [purchasePayments.tenantId], references: [tenants.id] }),
  purchase: one(purchases, { fields: [purchasePayments.purchaseId], references: [purchases.id] }),
  createdByUser: one(users, { fields: [purchasePayments.createdBy], references: [users.id] }),
}))

// Supplier Balance Audit relations
export const supplierBalanceAuditRelations = relations(supplierBalanceAudit, ({ one }) => ({
  tenant: one(tenants, { fields: [supplierBalanceAudit.tenantId], references: [tenants.id] }),
  supplier: one(suppliers, { fields: [supplierBalanceAudit.supplierId], references: [suppliers.id] }),
  createdByUser: one(users, { fields: [supplierBalanceAudit.createdBy], references: [users.id] }),
}))

// Item Supplier Costs relations
export const itemSupplierCostsRelations = relations(itemSupplierCosts, ({ one }) => ({
  tenant: one(tenants, { fields: [itemSupplierCosts.tenantId], references: [tenants.id] }),
  item: one(items, { fields: [itemSupplierCosts.itemId], references: [items.id] }),
  supplier: one(suppliers, { fields: [itemSupplierCosts.supplierId], references: [suppliers.id] }),
  lastPurchase: one(purchases, { fields: [itemSupplierCosts.lastPurchaseId], references: [purchases.id] }),
}))

// Item Cost History relations
export const itemCostHistoryRelations = relations(itemCostHistory, ({ one }) => ({
  tenant: one(tenants, { fields: [itemCostHistory.tenantId], references: [tenants.id] }),
  item: one(items, { fields: [itemCostHistory.itemId], references: [items.id] }),
  supplier: one(suppliers, { fields: [itemCostHistory.supplierId], references: [suppliers.id] }),
  createdByUser: one(users, { fields: [itemCostHistory.createdBy], references: [users.id] }),
}))

// Purchase Receipt relations
export const purchaseReceiptsRelations = relations(purchaseReceipts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [purchaseReceipts.tenantId], references: [tenants.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [purchaseReceipts.purchaseOrderId], references: [purchaseOrders.id] }),
  warehouse: one(warehouses, { fields: [purchaseReceipts.warehouseId], references: [warehouses.id] }),
  supplier: one(suppliers, { fields: [purchaseReceipts.supplierId], references: [suppliers.id] }),
  receivedByUser: one(users, { fields: [purchaseReceipts.receivedBy], references: [users.id] }),
  items: many(purchaseReceiptItems),
}))

// Purchase Receipt Items relations
export const purchaseReceiptItemsRelations = relations(purchaseReceiptItems, ({ one }) => ({
  tenant: one(tenants, { fields: [purchaseReceiptItems.tenantId], references: [tenants.id] }),
  receipt: one(purchaseReceipts, { fields: [purchaseReceiptItems.receiptId], references: [purchaseReceipts.id] }),
  purchaseOrderItem: one(purchaseOrderItems, { fields: [purchaseReceiptItems.purchaseOrderItemId], references: [purchaseOrderItems.id] }),
  item: one(items, { fields: [purchaseReceiptItems.itemId], references: [items.id] }),
}))

// Stock Take relations
export const stockTakesRelations = relations(stockTakes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [stockTakes.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [stockTakes.warehouseId], references: [warehouses.id] }),
  category: one(categories, { fields: [stockTakes.categoryId], references: [categories.id] }),
  createdByUser: one(users, { fields: [stockTakes.createdBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [stockTakes.approvedBy], references: [users.id] }),
  items: many(stockTakeItems),
}))

export const stockTakeItemsRelations = relations(stockTakeItems, ({ one }) => ({
  tenant: one(tenants, { fields: [stockTakeItems.tenantId], references: [tenants.id] }),
  stockTake: one(stockTakes, { fields: [stockTakeItems.stockTakeId], references: [stockTakes.id] }),
  item: one(items, { fields: [stockTakeItems.itemId], references: [items.id] }),
  countedByUser: one(users, { fields: [stockTakeItems.countedBy], references: [users.id] }),
}))

// Item Batch relations
export const itemBatchesRelations = relations(itemBatches, ({ one }) => ({
  tenant: one(tenants, { fields: [itemBatches.tenantId], references: [tenants.id] }),
  item: one(items, { fields: [itemBatches.itemId], references: [items.id] }),
  warehouse: one(warehouses, { fields: [itemBatches.warehouseId], references: [warehouses.id] }),
  purchaseReceipt: one(purchaseReceipts, { fields: [itemBatches.purchaseReceiptId], references: [purchaseReceipts.id] }),
  supplier: one(suppliers, { fields: [itemBatches.supplierId], references: [suppliers.id] }),
}))

// ==================== SERIAL NUMBER RELATIONS ====================

export const itemSerialNumbersRelations = relations(itemSerialNumbers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [itemSerialNumbers.tenantId], references: [tenants.id] }),
  item: one(items, { fields: [itemSerialNumbers.itemId], references: [items.id] }),
  warehouse: one(warehouses, { fields: [itemSerialNumbers.warehouseId], references: [warehouses.id] }),
  createdByUser: one(users, { fields: [itemSerialNumbers.createdBy], references: [users.id] }),
  movements: many(serialNumberMovements),
}))

export const serialNumberMovementsRelations = relations(serialNumberMovements, ({ one }) => ({
  tenant: one(tenants, { fields: [serialNumberMovements.tenantId], references: [tenants.id] }),
  serialNumber: one(itemSerialNumbers, { fields: [serialNumberMovements.serialNumberId], references: [itemSerialNumbers.id] }),
  changedByUser: one(users, { fields: [serialNumberMovements.changedBy], references: [users.id] }),
}))

// ==================== INSPECTION RELATIONS ====================

// Inspection Template relations
export const inspectionTemplatesRelations = relations(inspectionTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionTemplates.tenantId], references: [tenants.id] }),
  vehicleType: one(vehicleTypes, { fields: [inspectionTemplates.vehicleTypeId], references: [vehicleTypes.id] }),
  categories: many(inspectionCategories),
  inspections: many(vehicleInspections),
}))

// Inspection Category relations
export const inspectionCategoriesRelations = relations(inspectionCategories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionCategories.tenantId], references: [tenants.id] }),
  template: one(inspectionTemplates, { fields: [inspectionCategories.templateId], references: [inspectionTemplates.id] }),
  items: many(inspectionChecklistItems),
}))

// Inspection Checklist Item relations
export const inspectionChecklistItemsRelations = relations(inspectionChecklistItems, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionChecklistItems.tenantId], references: [tenants.id] }),
  category: one(inspectionCategories, { fields: [inspectionChecklistItems.categoryId], references: [inspectionCategories.id] }),
  responses: many(inspectionResponses),
}))

// Vehicle Inspection relations
export const vehicleInspectionsRelations = relations(vehicleInspections, ({ one, many }) => ({
  tenant: one(tenants, { fields: [vehicleInspections.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [vehicleInspections.workOrderId], references: [workOrders.id] }),
  vehicle: one(vehicles, { fields: [vehicleInspections.vehicleId], references: [vehicles.id] }),
  template: one(inspectionTemplates, { fields: [vehicleInspections.templateId], references: [inspectionTemplates.id] }),
  inspectedByUser: one(users, { fields: [vehicleInspections.inspectedBy], references: [users.id] }),
  responses: many(inspectionResponses),
  damageMarks: many(inspectionDamageMarks),
  photos: many(inspectionPhotos),
}))

// Inspection Response relations
export const inspectionResponsesRelations = relations(inspectionResponses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionResponses.tenantId], references: [tenants.id] }),
  inspection: one(vehicleInspections, { fields: [inspectionResponses.inspectionId], references: [vehicleInspections.id] }),
  checklistItem: one(inspectionChecklistItems, { fields: [inspectionResponses.checklistItemId], references: [inspectionChecklistItems.id] }),
  photos: many(inspectionPhotos),
}))

// Inspection Damage Mark relations
export const inspectionDamageMarksRelations = relations(inspectionDamageMarks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionDamageMarks.tenantId], references: [tenants.id] }),
  inspection: one(vehicleInspections, { fields: [inspectionDamageMarks.inspectionId], references: [vehicleInspections.id] }),
  diagramView: one(vehicleTypeDiagramViews, { fields: [inspectionDamageMarks.diagramViewId], references: [vehicleTypeDiagramViews.id] }),
  photos: many(inspectionPhotos),
}))

// Inspection Photo relations
export const inspectionPhotosRelations = relations(inspectionPhotos, ({ one }) => ({
  tenant: one(tenants, { fields: [inspectionPhotos.tenantId], references: [tenants.id] }),
  inspection: one(vehicleInspections, { fields: [inspectionPhotos.inspectionId], references: [vehicleInspections.id] }),
  damageMark: one(inspectionDamageMarks, { fields: [inspectionPhotos.damageMarkId], references: [inspectionDamageMarks.id] }),
  response: one(inspectionResponses, { fields: [inspectionPhotos.responseId], references: [inspectionResponses.id] }),
}))

// ==================== NOTIFICATION SYSTEM RELATIONS ====================

// SMS Settings relations
export const smsSettingsRelations = relations(smsSettings, ({ one }) => ({
  tenant: one(tenants, { fields: [smsSettings.tenantId], references: [tenants.id] }),
}))

// Email Settings relations
export const emailSettingsRelations = relations(emailSettings, ({ one }) => ({
  tenant: one(tenants, { fields: [emailSettings.tenantId], references: [tenants.id] }),
}))

// Notification Templates relations
export const notificationTemplatesRelations = relations(notificationTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [notificationTemplates.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [notificationTemplates.createdBy], references: [users.id] }),
  logs: many(notificationLogs),
}))

// Notification Logs relations
export const notificationLogsRelations = relations(notificationLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [notificationLogs.tenantId], references: [tenants.id] }),
  template: one(notificationTemplates, { fields: [notificationLogs.templateId], references: [notificationTemplates.id] }),
  sentByUser: one(users, { fields: [notificationLogs.sentBy], references: [users.id] }),
}))

// Notification Usage relations
export const notificationUsageRelations = relations(notificationUsage, ({ one }) => ({
  tenant: one(tenants, { fields: [notificationUsage.tenantId], references: [tenants.id] }),
}))

// ==================== UNIFIED FILE SYSTEM RELATIONS ====================

export const filesRelations = relations(files, ({ one, many }) => ({
  tenant: one(tenants, { fields: [files.tenantId], references: [tenants.id] }),
  uploadedByUser: one(users, { fields: [files.uploadedBy], references: [users.id] }),
  parentFolder: one(files, { fields: [files.folderId], references: [files.id], relationName: 'children' }),
  versions: many(fileVersions),
  auditLogs: many(fileAuditLogs),
  collectionFiles: many(collectionFiles),
  originalFile: one(files, { fields: [files.originalFileId], references: [files.id], relationName: 'fileVersions' }),
}))

export const fileVersionsRelations = relations(fileVersions, ({ one }) => ({
  tenant: one(tenants, { fields: [fileVersions.tenantId], references: [tenants.id] }),
  file: one(files, { fields: [fileVersions.fileId], references: [files.id] }),
  uploadedByUser: one(users, { fields: [fileVersions.uploadedBy], references: [users.id] }),
}))

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  tenant: one(tenants, { fields: [collections.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [collections.createdBy], references: [users.id] }),
  collectionFiles: many(collectionFiles),
}))

export const collectionFilesRelations = relations(collectionFiles, ({ one }) => ({
  collection: one(collections, { fields: [collectionFiles.collectionId], references: [collections.id] }),
  file: one(files, { fields: [collectionFiles.fileId], references: [files.id] }),
  addedByUser: one(users, { fields: [collectionFiles.addedBy], references: [users.id] }),
}))

export const fileAuditLogsRelations = relations(fileAuditLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [fileAuditLogs.tenantId], references: [tenants.id] }),
  file: one(files, { fields: [fileAuditLogs.fileId], references: [files.id] }),
  user: one(users, { fields: [fileAuditLogs.userId], references: [users.id] }),
}))

// ==================== WORKSPACE CONFIG RELATIONS ====================

export const workspaceConfigsRelations = relations(workspaceConfigs, ({ one }) => ({
  tenant: one(tenants, { fields: [workspaceConfigs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [workspaceConfigs.userId], references: [users.id] }),
}))

// Gift Card relations
export const giftCardsRelations = relations(giftCards, ({ one, many }) => ({
  tenant: one(tenants, { fields: [giftCards.tenantId], references: [tenants.id] }),
  issuedToCustomer: one(customers, { fields: [giftCards.issuedTo], references: [customers.id] }),
  createdByUser: one(users, { fields: [giftCards.createdBy], references: [users.id] }),
  purchaseSale: one(sales, { fields: [giftCards.purchaseSaleId], references: [sales.id] }),
  transactions: many(giftCardTransactions),
}))

export const giftCardTransactionsRelations = relations(giftCardTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [giftCardTransactions.tenantId], references: [tenants.id] }),
  giftCard: one(giftCards, { fields: [giftCardTransactions.giftCardId], references: [giftCards.id] }),
  sale: one(sales, { fields: [giftCardTransactions.saleId], references: [sales.id] }),
  createdByUser: one(users, { fields: [giftCardTransactions.createdBy], references: [users.id] }),
}))

// Restaurant Tables relations
export const tableGroupsRelations = relations(tableGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [tableGroups.tenantId], references: [tenants.id] }),
  server: one(users, { fields: [tableGroups.serverId], references: [users.id] }),
  members: many(tableGroupMembers),
}))

export const tableGroupMembersRelations = relations(tableGroupMembers, ({ one }) => ({
  tenant: one(tenants, { fields: [tableGroupMembers.tenantId], references: [tenants.id] }),
  tableGroup: one(tableGroups, { fields: [tableGroupMembers.tableGroupId], references: [tableGroups.id] }),
  table: one(restaurantTables, { fields: [tableGroupMembers.tableId], references: [restaurantTables.id] }),
}))

export const modifierGroupsRelations = relations(modifierGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [modifierGroups.tenantId], references: [tenants.id] }),
  modifiers: many(modifiers),
  itemAssociations: many(modifierGroupItems),
}))

export const modifiersRelations = relations(modifiers, ({ one }) => ({
  tenant: one(tenants, { fields: [modifiers.tenantId], references: [tenants.id] }),
  group: one(modifierGroups, { fields: [modifiers.groupId], references: [modifierGroups.id] }),
}))

export const modifierGroupItemsRelations = relations(modifierGroupItems, ({ one }) => ({
  tenant: one(tenants, { fields: [modifierGroupItems.tenantId], references: [tenants.id] }),
  modifierGroup: one(modifierGroups, { fields: [modifierGroupItems.modifierGroupId], references: [modifierGroups.id] }),
  item: one(items, { fields: [modifierGroupItems.itemId], references: [items.id] }),
}))

export const restaurantTablesRelations = relations(restaurantTables, ({ one, many }) => ({
  tenant: one(tenants, { fields: [restaurantTables.tenantId], references: [tenants.id] }),
  server: one(users, { fields: [restaurantTables.serverId], references: [users.id] }),
  orders: many(restaurantOrders),
  reservations: many(reservations),
  groupMemberships: many(tableGroupMembers),
}))

// Restaurant Orders relations
export const restaurantOrdersRelations = relations(restaurantOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [restaurantOrders.tenantId], references: [tenants.id] }),
  table: one(restaurantTables, { fields: [restaurantOrders.tableId], references: [restaurantTables.id] }),
  customer: one(customers, { fields: [restaurantOrders.customerId], references: [customers.id] }),
  createdByUser: one(users, { fields: [restaurantOrders.createdBy], references: [users.id] }),
  sale: one(sales, { fields: [restaurantOrders.saleId], references: [sales.id] }),
  items: many(restaurantOrderItems),
  kitchenOrder: one(kitchenOrders),
}))

// Restaurant Order Items relations
export const restaurantOrderItemsRelations = relations(restaurantOrderItems, ({ one }) => ({
  tenant: one(tenants, { fields: [restaurantOrderItems.tenantId], references: [tenants.id] }),
  order: one(restaurantOrders, { fields: [restaurantOrderItems.orderId], references: [restaurantOrders.id] }),
  item: one(items, { fields: [restaurantOrderItems.itemId], references: [items.id] }),
}))

// Kitchen Orders relations
export const kitchenOrdersRelations = relations(kitchenOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [kitchenOrders.tenantId], references: [tenants.id] }),
  restaurantOrder: one(restaurantOrders, { fields: [kitchenOrders.restaurantOrderId], references: [restaurantOrders.id] }),
  items: many(kitchenOrderItems),
}))

// Kitchen Order Items relations
export const kitchenOrderItemsRelations = relations(kitchenOrderItems, ({ one }) => ({
  tenant: one(tenants, { fields: [kitchenOrderItems.tenantId], references: [tenants.id] }),
  kitchenOrder: one(kitchenOrders, { fields: [kitchenOrderItems.kitchenOrderId], references: [kitchenOrders.id] }),
  restaurantOrderItem: one(restaurantOrderItems, { fields: [kitchenOrderItems.restaurantOrderItemId], references: [restaurantOrderItems.id] }),
}))

// Recipes relations
export const recipesRelations = relations(recipes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [recipes.tenantId], references: [tenants.id] }),
  item: one(items, { fields: [recipes.itemId], references: [items.id] }),
  ingredients: many(recipeIngredients),
}))

// Recipe Ingredients relations
export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  tenant: one(tenants, { fields: [recipeIngredients.tenantId], references: [tenants.id] }),
  recipe: one(recipes, { fields: [recipeIngredients.recipeId], references: [recipes.id] }),
  ingredientItem: one(items, { fields: [recipeIngredients.ingredientItemId], references: [items.id] }),
}))

// Waste Log relations
export const wasteLogRelations = relations(wasteLog, ({ one }) => ({
  tenant: one(tenants, { fields: [wasteLog.tenantId], references: [tenants.id] }),
  item: one(items, { fields: [wasteLog.itemId], references: [items.id] }),
  recordedByUser: one(users, { fields: [wasteLog.recordedBy], references: [users.id] }),
}))

// Reservations relations
export const reservationsRelations = relations(reservations, ({ one }) => ({
  tenant: one(tenants, { fields: [reservations.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [reservations.customerId], references: [customers.id] }),
  table: one(restaurantTables, { fields: [reservations.tableId], references: [restaurantTables.id] }),
  restaurantOrder: one(restaurantOrders, { fields: [reservations.restaurantOrderId], references: [restaurantOrders.id] }),
}))

// ==================== LAYAWAY RELATIONS ====================

// Layaway relations
export const layawaysRelations = relations(layaways, ({ one, many }) => ({
  tenant: one(tenants, { fields: [layaways.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [layaways.customerId], references: [customers.id] }),
  createdByUser: one(users, { fields: [layaways.createdBy], references: [users.id] }),
  items: many(layawayItems),
  payments: many(layawayPayments),
}))

// Layaway Items relations
export const layawayItemsRelations = relations(layawayItems, ({ one }) => ({
  tenant: one(tenants, { fields: [layawayItems.tenantId], references: [tenants.id] }),
  layaway: one(layaways, { fields: [layawayItems.layawayId], references: [layaways.id] }),
  item: one(items, { fields: [layawayItems.itemId], references: [items.id] }),
}))

// Layaway Payments relations
export const layawayPaymentsRelations = relations(layawayPayments, ({ one }) => ({
  tenant: one(tenants, { fields: [layawayPayments.tenantId], references: [tenants.id] }),
  layaway: one(layaways, { fields: [layawayPayments.layawayId], references: [layaways.id] }),
  receivedByUser: one(users, { fields: [layawayPayments.receivedBy], references: [users.id] }),
}))

// ==================== SALES ORDERS ====================

export const salesOrders = pgTable('sales_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  orderNo: varchar('order_no', { length: 50 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  customerName: varchar('customer_name', { length: 255 }),
  vehiclePlate: varchar('vehicle_plate', { length: 20 }),
  vehicleDescription: varchar('vehicle_description', { length: 255 }),
  expectedDeliveryDate: date('expected_delivery_date'),
  deliveryAddress: text('delivery_address'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  discountType: discountTypeEnum('discount_type'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxBreakdown: jsonb('tax_breakdown'),
  taxTemplateId: uuid('tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  status: salesOrderStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt: timestamp('cancelled_at'),
  confirmedAt: timestamp('confirmed_at'),
  createdBy: uuid('created_by').references(() => users.id),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const salesOrderItems = pgTable('sales_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  salesOrderId: uuid('sales_order_id').notNull().references(() => salesOrders.id),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  fulfilledQuantity: decimal('fulfilled_quantity', { precision: 12, scale: 3 }).notNull().default('0'),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).notNull().default('0'),
  discountType: discountTypeEnum('discount_type'),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxTemplateId: uuid('tax_template_id'),
  taxBreakdown: jsonb('tax_breakdown'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
})

// Sales Orders relations
export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [salesOrders.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [salesOrders.customerId], references: [customers.id] }),
  vehicle: one(vehicles, { fields: [salesOrders.vehicleId], references: [vehicles.id] }),
  warehouse: one(warehouses, { fields: [salesOrders.warehouseId], references: [warehouses.id] }),
  createdByUser: one(users, { fields: [salesOrders.createdBy], references: [users.id] }),
  confirmedByUser: one(users, { fields: [salesOrders.confirmedBy], references: [users.id] }),
  items: many(salesOrderItems),
}))

// Sales Order Items relations
export const salesOrderItemsRelations = relations(salesOrderItems, ({ one }) => ({
  tenant: one(tenants, { fields: [salesOrderItems.tenantId], references: [tenants.id] }),
  salesOrder: one(salesOrders, { fields: [salesOrderItems.salesOrderId], references: [salesOrders.id] }),
  item: one(items, { fields: [salesOrderItems.itemId], references: [items.id] }),
}))

// ==================== BILLING OVERHAUL ====================

// PayHere transactions - tracks all PayHere payments
export const payhereTransactions = pgTable('payhere_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
  pendingCompanyId: uuid('pending_company_id').references(() => pendingCompanies.id),
  orderId: varchar('order_id', { length: 100 }).notNull().unique(),
  payherePaymentId: varchar('payhere_payment_id', { length: 100 }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'),
  status: payhereTransactionStatusEnum('status').notNull().default('pending'),
  paymentMethod: varchar('payment_method', { length: 50 }),
  description: text('description'),
  periodMonths: integer('period_months').notNull().default(1),
  billingCycle: varchar('billing_cycle', { length: 20 }).default('monthly'),
  statusCode: varchar('status_code', { length: 10 }),
  statusMessage: text('status_message'),
  md5sig: varchar('md5sig', { length: 100 }),
  cardHolderName: varchar('card_holder_name', { length: 255 }),
  cardNo: varchar('card_no', { length: 20 }),
  newTierId: uuid('new_tier_id').references(() => pricingTiers.id),
  walletCreditApplied: decimal('wallet_credit_applied', { precision: 12, scale: 2 }).default('0'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// PayHere transactions relations
export const payhereTransactionsRelations = relations(payhereTransactions, ({ one }) => ({
  account: one(accounts, { fields: [payhereTransactions.accountId], references: [accounts.id] }),
  subscription: one(subscriptions, { fields: [payhereTransactions.subscriptionId], references: [subscriptions.id] }),
  pendingCompany: one(pendingCompanies, { fields: [payhereTransactions.pendingCompanyId], references: [pendingCompanies.id] }),
  newTier: one(pricingTiers, { fields: [payhereTransactions.newTierId], references: [pricingTiers.id] }),
}))

// Lockout events - audit trail for lockout lifecycle
export const lockoutEvents = pgTable('lockout_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventType: lockoutEventTypeEnum('event_type').notNull(),
  details: jsonb('details').default('{}'),
  notificationSent: boolean('notification_sent').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Lockout events relations
export const lockoutEventsRelations = relations(lockoutEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [lockoutEvents.tenantId], references: [tenants.id] }),
}))

// Exchange rate cache - server-side rate storage
export const exchangeRateCache = pgTable('exchange_rate_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull().default('USD'),
  rates: jsonb('rates').notNull().default('{}'),
  source: varchar('source', { length: 50 }),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
})

// ==================== ACCOUNTING MODULE TABLES ====================

// Fiscal Years
export const fiscalYears = pgTable('fiscal_years', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 50 }).notNull(), // e.g. '2025-2026'
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  isClosed: boolean('is_closed').notNull().default(false),
  closedAt: timestamp('closed_at'),
  closedBy: uuid('closed_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const fiscalYearsRelations = relations(fiscalYears, ({ one }) => ({
  tenant: one(tenants, { fields: [fiscalYears.tenantId], references: [tenants.id] }),
}))

// Chart of Accounts
export const chartOfAccounts = pgTable('chart_of_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  accountNumber: varchar('account_number', { length: 20 }).notNull(),
  parentId: uuid('parent_id'), // self-reference for tree structure
  rootType: accountRootTypeEnum('root_type').notNull(),
  accountType: accountTypeEnum('account_type').notNull(),
  isGroup: boolean('is_group').notNull().default(false),
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'),
  balance: decimal('balance', { precision: 15, scale: 2 }).notNull().default('0'),
  isSystemAccount: boolean('is_system_account').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const chartOfAccountsRelations = relations(chartOfAccounts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [chartOfAccounts.tenantId], references: [tenants.id] }),
  parent: one(chartOfAccounts, { fields: [chartOfAccounts.parentId], references: [chartOfAccounts.id], relationName: 'parentChild' }),
  children: many(chartOfAccounts, { relationName: 'parentChild' }),
  glEntries: many(glEntries),
}))

// General Ledger Entries
export const glEntries = pgTable('gl_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  postingDate: date('posting_date').notNull(),
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
  debit: decimal('debit', { precision: 15, scale: 2 }).notNull().default('0'),
  credit: decimal('credit', { precision: 15, scale: 2 }).notNull().default('0'),
  partyType: partyTypeEnum('party_type'),
  partyId: uuid('party_id'),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  voucherType: varchar('voucher_type', { length: 50 }).notNull(), // 'sale','purchase','payment','payment_entry','journal_entry','refund','stock_adjustment'
  voucherId: uuid('voucher_id').notNull(),
  voucherNumber: varchar('voucher_number', { length: 100 }),
  // Against voucher fields - for tracking which invoice a payment settles
  againstVoucherType: varchar('against_voucher_type', { length: 50 }), // 'sale','purchase'
  againstVoucherId: uuid('against_voucher_id'),
  remarks: text('remarks'),
  isOpening: boolean('is_opening').notNull().default(false),
  fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const glEntriesRelations = relations(glEntries, ({ one }) => ({
  tenant: one(tenants, { fields: [glEntries.tenantId], references: [tenants.id] }),
  account: one(chartOfAccounts, { fields: [glEntries.accountId], references: [chartOfAccounts.id] }),
  fiscalYear: one(fiscalYears, { fields: [glEntries.fiscalYearId], references: [fiscalYears.id] }),
}))

// Accounting Settings (per tenant)
export const accountingSettings = pgTable('accounting_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  defaultReceivableAccountId: uuid('default_receivable_account_id').references(() => chartOfAccounts.id),
  defaultPayableAccountId: uuid('default_payable_account_id').references(() => chartOfAccounts.id),
  defaultIncomeAccountId: uuid('default_income_account_id').references(() => chartOfAccounts.id),
  defaultExpenseAccountId: uuid('default_expense_account_id').references(() => chartOfAccounts.id),
  defaultCashAccountId: uuid('default_cash_account_id').references(() => chartOfAccounts.id),
  defaultBankAccountId: uuid('default_bank_account_id').references(() => chartOfAccounts.id),
  defaultTaxAccountId: uuid('default_tax_account_id').references(() => chartOfAccounts.id),
  defaultCOGSAccountId: uuid('default_cogs_account_id').references(() => chartOfAccounts.id),
  defaultRoundOffAccountId: uuid('default_round_off_account_id').references(() => chartOfAccounts.id),
  defaultStockAccountId: uuid('default_stock_account_id').references(() => chartOfAccounts.id),
  defaultWriteOffAccountId: uuid('default_write_off_account_id').references(() => chartOfAccounts.id),
  defaultAdvanceReceivedAccountId: uuid('default_advance_received_account_id').references(() => chartOfAccounts.id),
  defaultAdvancePaidAccountId: uuid('default_advance_paid_account_id').references(() => chartOfAccounts.id),
  currentFiscalYearId: uuid('current_fiscal_year_id').references(() => fiscalYears.id),
  autoPostSales: boolean('auto_post_sales').notNull().default(true),
  autoPostPurchases: boolean('auto_post_purchases').notNull().default(true),
  // Payroll defaults
  defaultSalaryPayableAccountId: uuid('default_salary_payable_account_id').references(() => chartOfAccounts.id),
  defaultStatutoryPayableAccountId: uuid('default_statutory_payable_account_id').references(() => chartOfAccounts.id),
  defaultSalaryExpenseAccountId: uuid('default_salary_expense_account_id').references(() => chartOfAccounts.id),
  defaultEmployerContributionAccountId: uuid('default_employer_contribution_account_id').references(() => chartOfAccounts.id),
  defaultEmployeeAdvanceAccountId: uuid('default_employee_advance_account_id').references(() => chartOfAccounts.id),
  // Cost center & stock adjustment defaults
  defaultCostCenterId: uuid('default_cost_center_id').references(() => costCenters.id),
  defaultStockAdjustmentAccountId: uuid('default_stock_adjustment_account_id').references(() => chartOfAccounts.id),
  // Work In Progress (WIP) for work orders
  defaultWipAccountId: uuid('default_wip_account_id').references(() => chartOfAccounts.id),
  // Gift card liability account
  defaultGiftCardLiabilityAccountId: uuid('default_gift_card_liability_account_id').references(() => chartOfAccounts.id),
  // POS shift closing - cash over/short
  defaultCashOverShortAccountId: uuid('default_cash_over_short_account_id').references(() => chartOfAccounts.id, { onDelete: 'set null' }),
  // Default tax templates (sales + purchase)
  defaultTaxTemplateId: uuid('default_tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  defaultPurchaseTaxTemplateId: uuid('default_purchase_tax_template_id').references(() => taxTemplates.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const accountingSettingsRelations = relations(accountingSettings, ({ one }) => ({
  tenant: one(tenants, { fields: [accountingSettings.tenantId], references: [tenants.id] }),
  defaultReceivableAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultReceivableAccountId], references: [chartOfAccounts.id], relationName: 'receivable' }),
  defaultPayableAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultPayableAccountId], references: [chartOfAccounts.id], relationName: 'payable' }),
  defaultIncomeAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultIncomeAccountId], references: [chartOfAccounts.id], relationName: 'income' }),
  defaultExpenseAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultExpenseAccountId], references: [chartOfAccounts.id], relationName: 'expense' }),
  defaultCashAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultCashAccountId], references: [chartOfAccounts.id], relationName: 'cash' }),
  defaultBankAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultBankAccountId], references: [chartOfAccounts.id], relationName: 'bank' }),
  defaultTaxAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultTaxAccountId], references: [chartOfAccounts.id], relationName: 'tax' }),
  defaultCOGSAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultCOGSAccountId], references: [chartOfAccounts.id], relationName: 'cogs' }),
  defaultRoundOffAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultRoundOffAccountId], references: [chartOfAccounts.id], relationName: 'roundOff' }),
  defaultStockAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultStockAccountId], references: [chartOfAccounts.id], relationName: 'stock' }),
  defaultWriteOffAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultWriteOffAccountId], references: [chartOfAccounts.id], relationName: 'writeOff' }),
  defaultAdvanceReceivedAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultAdvanceReceivedAccountId], references: [chartOfAccounts.id], relationName: 'advanceReceived' }),
  defaultAdvancePaidAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultAdvancePaidAccountId], references: [chartOfAccounts.id], relationName: 'advancePaid' }),
  currentFiscalYear: one(fiscalYears, { fields: [accountingSettings.currentFiscalYearId], references: [fiscalYears.id] }),
  defaultSalaryPayableAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultSalaryPayableAccountId], references: [chartOfAccounts.id], relationName: 'salaryPayable' }),
  defaultStatutoryPayableAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultStatutoryPayableAccountId], references: [chartOfAccounts.id], relationName: 'statutoryPayable' }),
  defaultSalaryExpenseAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultSalaryExpenseAccountId], references: [chartOfAccounts.id], relationName: 'salaryExpense' }),
  defaultEmployerContributionAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultEmployerContributionAccountId], references: [chartOfAccounts.id], relationName: 'employerContribution' }),
  defaultEmployeeAdvanceAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultEmployeeAdvanceAccountId], references: [chartOfAccounts.id], relationName: 'employeeAdvance' }),
  defaultGiftCardLiabilityAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultGiftCardLiabilityAccountId], references: [chartOfAccounts.id], relationName: 'giftCardLiability' }),
  defaultCashOverShortAccount: one(chartOfAccounts, { fields: [accountingSettings.defaultCashOverShortAccountId], references: [chartOfAccounts.id], relationName: 'cashOverShort' }),
  defaultTaxTemplate: one(taxTemplates, { fields: [accountingSettings.defaultTaxTemplateId], references: [taxTemplates.id], relationName: 'defaultSalesTaxTemplate' }),
  defaultPurchaseTaxTemplate: one(taxTemplates, { fields: [accountingSettings.defaultPurchaseTaxTemplateId], references: [taxTemplates.id], relationName: 'defaultPurchaseTaxTemplate' }),
}))

// Journal Entries
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entryNumber: varchar('entry_number', { length: 50 }).notNull(),
  entryType: journalEntryTypeEnum('entry_type').notNull().default('journal'),
  postingDate: date('posting_date').notNull(),
  totalDebit: decimal('total_debit', { precision: 15, scale: 2 }).notNull().default('0'),
  totalCredit: decimal('total_credit', { precision: 15, scale: 2 }).notNull().default('0'),
  status: journalEntryStatusEnum('status').notNull().default('draft'),
  remarks: text('remarks'),
  fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by'),
  cancellationReason: text('cancellation_reason'),
  submittedAt: timestamp('submitted_at'),
  submittedBy: uuid('submitted_by'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  tenant: one(tenants, { fields: [journalEntries.tenantId], references: [tenants.id] }),
  fiscalYear: one(fiscalYears, { fields: [journalEntries.fiscalYearId], references: [fiscalYears.id] }),
  items: many(journalEntryItems),
}))

// Journal Entry Items (line items for each journal entry)
export const journalEntryItems = pgTable('journal_entry_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
  debit: decimal('debit', { precision: 15, scale: 2 }).notNull().default('0'),
  credit: decimal('credit', { precision: 15, scale: 2 }).notNull().default('0'),
  partyType: partyTypeEnum('party_type'),
  partyId: uuid('party_id'),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  remarks: text('remarks'),
})

export const journalEntryItemsRelations = relations(journalEntryItems, ({ one }) => ({
  tenant: one(tenants, { fields: [journalEntryItems.tenantId], references: [tenants.id] }),
  journalEntry: one(journalEntries, { fields: [journalEntryItems.journalEntryId], references: [journalEntries.id] }),
  account: one(chartOfAccounts, { fields: [journalEntryItems.accountId], references: [chartOfAccounts.id] }),
}))

// Recurring Journal Templates
export const recurringJournalTemplates = pgTable('recurring_journal_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  entryType: varchar('entry_type', { length: 50 }).notNull().default('journal'),
  remarks: text('remarks'),
  recurrencePattern: varchar('recurrence_pattern', { length: 20 }).notNull().default('monthly'),
  startDate: varchar('start_date', { length: 10 }).notNull(),
  endDate: varchar('end_date', { length: 10 }),
  nextRunDate: varchar('next_run_date', { length: 10 }),
  items: jsonb('items').notNull().default([]),
  lastGeneratedAt: timestamp('last_generated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const recurringJournalTemplatesRelations = relations(recurringJournalTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [recurringJournalTemplates.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [recurringJournalTemplates.createdBy], references: [users.id] }),
}))

// Payment Allocations (links payments to invoices for AR/AP)
export const paymentAllocations = pgTable('payment_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  paymentId: uuid('payment_id').notNull(),
  paymentType: varchar('payment_type', { length: 50 }).notNull(), // 'sale_payment','purchase_payment'
  invoiceId: uuid('invoice_id').notNull(),
  invoiceType: varchar('invoice_type', { length: 50 }).notNull(), // 'sale','purchase'
  allocatedAmount: decimal('allocated_amount', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentAllocations.tenantId], references: [tenants.id] }),
}))

// Cost Centers (hierarchical)
export const costCenters = pgTable('cost_centers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  parentId: uuid('parent_id'), // self-reference
  isGroup: boolean('is_group').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const costCentersRelations = relations(costCenters, ({ one, many }) => ({
  tenant: one(tenants, { fields: [costCenters.tenantId], references: [tenants.id] }),
  parent: one(costCenters, { fields: [costCenters.parentId], references: [costCenters.id], relationName: 'parentChild' }),
  children: many(costCenters, { relationName: 'parentChild' }),
}))

// ==================== PHASE 4: Bank Accounts + Reconciliation ====================

export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  accountName: varchar('account_name', { length: 255 }).notNull(),
  bankName: varchar('bank_name', { length: 255 }),
  accountNumber: varchar('account_number', { length: 100 }),
  branchCode: varchar('branch_code', { length: 50 }),
  iban: varchar('iban', { length: 50 }),
  swiftCode: varchar('swift_code', { length: 20 }),
  accountId: uuid('account_id').references(() => chartOfAccounts.id), // links to CoA bank ledger
  isDefault: boolean('is_default').notNull().default(false),
  currentBalance: decimal('current_balance', { precision: 15, scale: 2 }).notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [bankAccounts.tenantId], references: [tenants.id] }),
  coaAccount: one(chartOfAccounts, { fields: [bankAccounts.accountId], references: [chartOfAccounts.id] }),
  transactions: many(bankTransactions),
}))

export const bankTransactions = pgTable('bank_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id),
  transactionDate: date('transaction_date').notNull(),
  description: text('description'),
  referenceNumber: varchar('reference_number', { length: 255 }),
  debit: decimal('debit', { precision: 15, scale: 2 }).notNull().default('0'),
  credit: decimal('credit', { precision: 15, scale: 2 }).notNull().default('0'),
  status: bankTransactionStatusEnum('status').notNull().default('unmatched'),
  matchedVoucherType: varchar('matched_voucher_type', { length: 50 }),
  matchedVoucherId: uuid('matched_voucher_id'),
  importBatch: varchar('import_batch', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [bankTransactions.tenantId], references: [tenants.id] }),
  bankAccount: one(bankAccounts, { fields: [bankTransactions.bankAccountId], references: [bankAccounts.id] }),
}))

// ==================== PHASE 5: Budgets + Tax Templates ====================

export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  status: budgetStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const budgetsRelations = relations(budgets, ({ one, many }) => ({
  tenant: one(tenants, { fields: [budgets.tenantId], references: [tenants.id] }),
  fiscalYear: one(fiscalYears, { fields: [budgets.fiscalYearId], references: [fiscalYears.id] }),
  costCenter: one(costCenters, { fields: [budgets.costCenterId], references: [costCenters.id] }),
  items: many(budgetItems),
}))

export const budgetItems = pgTable('budget_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  budgetId: uuid('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
  monthlyAmount: decimal('monthly_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  annualAmount: decimal('annual_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  controlAction: budgetControlActionEnum('control_action').notNull().default('warn'),
})

export const budgetItemsRelations = relations(budgetItems, ({ one }) => ({
  tenant: one(tenants, { fields: [budgetItems.tenantId], references: [tenants.id] }),
  budget: one(budgets, { fields: [budgetItems.budgetId], references: [budgets.id] }),
  account: one(chartOfAccounts, { fields: [budgetItems.accountId], references: [chartOfAccounts.id] }),
}))

export const taxTemplates = pgTable('tax_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const taxTemplatesRelations = relations(taxTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [taxTemplates.tenantId], references: [tenants.id] }),
  items: many(taxTemplateItems),
}))

export const taxTemplateItems = pgTable('tax_template_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  taxTemplateId: uuid('tax_template_id').notNull().references(() => taxTemplates.id, { onDelete: 'cascade' }),
  taxName: varchar('tax_name', { length: 100 }).notNull(),
  rate: decimal('rate', { precision: 5, scale: 2 }).notNull(),
  accountId: uuid('account_id').references(() => chartOfAccounts.id),
  includedInPrice: boolean('included_in_price').notNull().default(false),
})

export const taxTemplateItemsRelations = relations(taxTemplateItems, ({ one }) => ({
  tenant: one(tenants, { fields: [taxTemplateItems.tenantId], references: [tenants.id] }),
  taxTemplate: one(taxTemplates, { fields: [taxTemplateItems.taxTemplateId], references: [taxTemplates.id] }),
  account: one(chartOfAccounts, { fields: [taxTemplateItems.accountId], references: [chartOfAccounts.id] }),
}))

// ==================== PHASE 6: Period Closing ====================

export const periodClosingVouchers = pgTable('period_closing_vouchers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id),
  closingDate: date('closing_date').notNull(),
  closingAccountId: uuid('closing_account_id').notNull().references(() => chartOfAccounts.id), // e.g. Retained Earnings
  netProfitLoss: decimal('net_profit_loss', { precision: 15, scale: 2 }).notNull().default('0'),
  status: periodClosingStatusEnum('status').notNull().default('draft'),
  submittedAt: timestamp('submitted_at'),
  submittedBy: uuid('submitted_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const periodClosingVouchersRelations = relations(periodClosingVouchers, ({ one }) => ({
  tenant: one(tenants, { fields: [periodClosingVouchers.tenantId], references: [tenants.id] }),
  fiscalYear: one(fiscalYears, { fields: [periodClosingVouchers.fiscalYearId], references: [fiscalYears.id] }),
  closingAccount: one(chartOfAccounts, { fields: [periodClosingVouchers.closingAccountId], references: [chartOfAccounts.id] }),
}))

// ==================== PAYMENT MODULE ====================

// Enums for payment module
export const modeOfPaymentTypeEnum = pgEnum('mode_of_payment_type', ['cash', 'bank', 'general'])
export const dueDateBasedOnEnum = pgEnum('due_date_based_on', ['days_after_invoice', 'days_after_month_end', 'months_after_month_end'])
export const paymentScheduleStatusEnum = pgEnum('payment_schedule_status', ['unpaid', 'partly_paid', 'paid', 'overdue'])
export const paymentEntryTypeEnum = pgEnum('payment_entry_type', ['receive', 'pay', 'internal_transfer'])
export const paymentEntryStatusEnum = pgEnum('payment_entry_status', ['draft', 'submitted', 'cancelled'])
export const paymentEntryPartyTypeEnum = pgEnum('payment_entry_party_type', ['customer', 'supplier'])
export const paymentLedgerAccountTypeEnum = pgEnum('payment_ledger_account_type', ['receivable', 'payable'])
export const paymentRequestTypeEnum = pgEnum('payment_request_type', ['inward', 'outward'])
export const paymentRequestStatusEnum = pgEnum('payment_request_status', ['draft', 'requested', 'paid', 'cancelled'])
export const dunningStatusEnum = pgEnum('dunning_status', ['draft', 'unresolved', 'resolved', 'cancelled'])

// Phase 1: Modes of Payment
export const modesOfPayment = pgTable('modes_of_payment', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  type: modeOfPaymentTypeEnum('type').notNull().default('general'),
  methodKey: varchar('method_key', { length: 30 }), // Maps to POS payment method strings: 'cash', 'card', 'bank_transfer', etc.
  defaultAccountId: uuid('default_account_id').references(() => chartOfAccounts.id),
  isEnabled: boolean('is_enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const modesOfPaymentRelations = relations(modesOfPayment, ({ one }) => ({
  tenant: one(tenants, { fields: [modesOfPayment.tenantId], references: [tenants.id] }),
  defaultAccount: one(chartOfAccounts, { fields: [modesOfPayment.defaultAccountId], references: [chartOfAccounts.id] }),
}))

// Phase 2: Payment Terms
export const paymentTerms = pgTable('payment_terms', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  invoicePortion: decimal('invoice_portion', { precision: 5, scale: 2 }).notNull(), // percentage e.g. 100, 50
  dueDateBasedOn: dueDateBasedOnEnum('due_date_based_on').notNull().default('days_after_invoice'),
  creditDays: integer('credit_days').notNull().default(0),
  discountType: varchar('discount_type', { length: 20 }), // 'percentage' | 'amount' | null
  discount: decimal('discount', { precision: 5, scale: 2 }),
  discountValidityDays: integer('discount_validity_days'),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const paymentTermsRelations = relations(paymentTerms, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentTerms.tenantId], references: [tenants.id] }),
}))

export const paymentTermsTemplates = pgTable('payment_terms_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const paymentTermsTemplatesRelations = relations(paymentTermsTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [paymentTermsTemplates.tenantId], references: [tenants.id] }),
  items: many(paymentTermsTemplateItems),
}))

export const paymentTermsTemplateItems = pgTable('payment_terms_template_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  templateId: uuid('template_id').notNull().references(() => paymentTermsTemplates.id, { onDelete: 'cascade' }),
  paymentTermId: uuid('payment_term_id').notNull().references(() => paymentTerms.id),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const paymentTermsTemplateItemsRelations = relations(paymentTermsTemplateItems, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentTermsTemplateItems.tenantId], references: [tenants.id] }),
  template: one(paymentTermsTemplates, { fields: [paymentTermsTemplateItems.templateId], references: [paymentTermsTemplates.id] }),
  paymentTerm: one(paymentTerms, { fields: [paymentTermsTemplateItems.paymentTermId], references: [paymentTerms.id] }),
}))

export const paymentSchedules = pgTable('payment_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  invoiceType: varchar('invoice_type', { length: 20 }).notNull(), // 'sale' | 'purchase'
  invoiceId: uuid('invoice_id').notNull(),
  paymentTermId: uuid('payment_term_id').references(() => paymentTerms.id),
  dueDate: date('due_date').notNull(),
  invoicePortion: decimal('invoice_portion', { precision: 5, scale: 2 }).notNull(),
  paymentAmount: decimal('payment_amount', { precision: 15, scale: 2 }).notNull(),
  paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  outstanding: decimal('outstanding', { precision: 15, scale: 2 }).notNull(),
  discountType: varchar('discount_type', { length: 20 }),
  discount: decimal('discount', { precision: 5, scale: 2 }),
  discountDate: date('discount_date'),
  status: paymentScheduleStatusEnum('status').notNull().default('unpaid'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const paymentSchedulesRelations = relations(paymentSchedules, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentSchedules.tenantId], references: [tenants.id] }),
  paymentTerm: one(paymentTerms, { fields: [paymentSchedules.paymentTermId], references: [paymentTerms.id] }),
}))

// Phase 3: Payment Entries
export const paymentEntries = pgTable('payment_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entryNumber: varchar('entry_number', { length: 50 }).notNull(),
  paymentType: paymentEntryTypeEnum('payment_type').notNull(),
  postingDate: date('posting_date').notNull(),
  partyType: paymentEntryPartyTypeEnum('party_type'),
  partyId: uuid('party_id'),
  partyName: varchar('party_name', { length: 255 }),

  // Account fields
  paidFromAccountId: uuid('paid_from_account_id').references(() => chartOfAccounts.id),
  paidToAccountId: uuid('paid_to_account_id').references(() => chartOfAccounts.id),
  modeOfPaymentId: uuid('mode_of_payment_id').references(() => modesOfPayment.id),

  // Amount fields
  paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  receivedAmount: decimal('received_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  totalAllocatedAmount: decimal('total_allocated_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  unallocatedAmount: decimal('unallocated_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  writeOffAmount: decimal('write_off_amount', { precision: 15, scale: 2 }).notNull().default('0'),

  // Reference fields
  referenceNo: varchar('reference_no', { length: 255 }),
  referenceDate: date('reference_date'),
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
  clearanceDate: date('clearance_date'),

  // Status
  status: paymentEntryStatusEnum('status').notNull().default('draft'),
  remarks: text('remarks'),

  // Audit
  submittedAt: timestamp('submitted_at'),
  submittedBy: uuid('submitted_by'),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by'),
  cancellationReason: text('cancellation_reason'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const paymentEntriesRelations = relations(paymentEntries, ({ one, many }) => ({
  tenant: one(tenants, { fields: [paymentEntries.tenantId], references: [tenants.id] }),
  paidFromAccount: one(chartOfAccounts, { fields: [paymentEntries.paidFromAccountId], references: [chartOfAccounts.id], relationName: 'paidFrom' }),
  paidToAccount: one(chartOfAccounts, { fields: [paymentEntries.paidToAccountId], references: [chartOfAccounts.id], relationName: 'paidTo' }),
  modeOfPayment: one(modesOfPayment, { fields: [paymentEntries.modeOfPaymentId], references: [modesOfPayment.id] }),
  bankAccount: one(bankAccounts, { fields: [paymentEntries.bankAccountId], references: [bankAccounts.id] }),
  references: many(paymentEntryReferences),
  deductions: many(paymentEntryDeductions),
}))

export const paymentEntryReferences = pgTable('payment_entry_references', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  paymentEntryId: uuid('payment_entry_id').references(() => paymentEntries.id, { onDelete: 'cascade' }),
  sourceJeItemId: uuid('source_je_item_id').references(() => journalEntryItems.id),
  referenceType: varchar('reference_type', { length: 50 }).notNull(), // 'sale' | 'purchase' | 'journal_entry'
  referenceId: uuid('reference_id').notNull(),
  referenceNumber: varchar('reference_number', { length: 100 }),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull(),
  outstandingAmount: decimal('outstanding_amount', { precision: 15, scale: 2 }).notNull(),
  allocatedAmount: decimal('allocated_amount', { precision: 15, scale: 2 }).notNull(),
  paymentScheduleId: uuid('payment_schedule_id').references(() => paymentSchedules.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const paymentEntryReferencesRelations = relations(paymentEntryReferences, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentEntryReferences.tenantId], references: [tenants.id] }),
  paymentEntry: one(paymentEntries, { fields: [paymentEntryReferences.paymentEntryId], references: [paymentEntries.id] }),
  sourceJeItem: one(journalEntryItems, { fields: [paymentEntryReferences.sourceJeItemId], references: [journalEntryItems.id] }),
  paymentSchedule: one(paymentSchedules, { fields: [paymentEntryReferences.paymentScheduleId], references: [paymentSchedules.id] }),
}))

export const paymentEntryDeductions = pgTable('payment_entry_deductions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  paymentEntryId: uuid('payment_entry_id').notNull().references(() => paymentEntries.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
  costCenterId: uuid('cost_center_id').references(() => costCenters.id),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: text('description'),
})

export const paymentEntryDeductionsRelations = relations(paymentEntryDeductions, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentEntryDeductions.tenantId], references: [tenants.id] }),
  paymentEntry: one(paymentEntries, { fields: [paymentEntryDeductions.paymentEntryId], references: [paymentEntries.id] }),
  account: one(chartOfAccounts, { fields: [paymentEntryDeductions.accountId], references: [chartOfAccounts.id] }),
  costCenter: one(costCenters, { fields: [paymentEntryDeductions.costCenterId], references: [costCenters.id] }),
}))

// Phase 7: Payment Ledger
export const paymentLedger = pgTable('payment_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  postingDate: date('posting_date').notNull(),
  accountType: paymentLedgerAccountTypeEnum('account_type').notNull(),
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
  partyType: paymentEntryPartyTypeEnum('party_type').notNull(),
  partyId: uuid('party_id').notNull(),
  voucherType: varchar('voucher_type', { length: 50 }).notNull(), // 'sale','purchase','payment_entry','journal_entry'
  voucherId: uuid('voucher_id').notNull(),
  againstVoucherType: varchar('against_voucher_type', { length: 50 }),
  againstVoucherId: uuid('against_voucher_id'),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(), // positive = increases outstanding, negative = reduces
  dueDate: date('due_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const paymentLedgerRelations = relations(paymentLedger, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentLedger.tenantId], references: [tenants.id] }),
  account: one(chartOfAccounts, { fields: [paymentLedger.accountId], references: [chartOfAccounts.id] }),
}))

// Phase 8: Payment Requests
export const paymentRequests = pgTable('payment_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  requestNumber: varchar('request_number', { length: 50 }).notNull(),
  requestType: paymentRequestTypeEnum('request_type').notNull(),
  referenceType: varchar('reference_type', { length: 50 }).notNull(), // 'sale' | 'purchase'
  referenceId: uuid('reference_id').notNull(),
  partyType: paymentEntryPartyTypeEnum('party_type').notNull(),
  partyId: uuid('party_id').notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('LKR'),
  emailTo: varchar('email_to', { length: 255 }),
  subject: varchar('subject', { length: 255 }),
  message: text('message'),
  paymentUrl: text('payment_url'),
  status: paymentRequestStatusEnum('status').notNull().default('draft'),
  modeOfPaymentId: uuid('mode_of_payment_id').references(() => modesOfPayment.id),
  paidAt: timestamp('paid_at'),
  paymentEntryId: uuid('payment_entry_id').references(() => paymentEntries.id),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const paymentRequestsRelations = relations(paymentRequests, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentRequests.tenantId], references: [tenants.id] }),
  modeOfPayment: one(modesOfPayment, { fields: [paymentRequests.modeOfPaymentId], references: [modesOfPayment.id] }),
  paymentEntry: one(paymentEntries, { fields: [paymentRequests.paymentEntryId], references: [paymentEntries.id] }),
}))

// Phase 9: Dunning
export const dunningTypes = pgTable('dunning_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  startDay: integer('start_day').notNull(),
  endDay: integer('end_day').notNull(),
  dunningFee: decimal('dunning_fee', { precision: 12, scale: 2 }).notNull().default('0'),
  interestRate: decimal('interest_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  bodyText: text('body_text'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const dunningTypesRelations = relations(dunningTypes, ({ one }) => ({
  tenant: one(tenants, { fields: [dunningTypes.tenantId], references: [tenants.id] }),
}))

export const dunnings = pgTable('dunnings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  dunningNumber: varchar('dunning_number', { length: 50 }).notNull(),
  dunningTypeId: uuid('dunning_type_id').notNull().references(() => dunningTypes.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  saleId: uuid('sale_id').notNull().references(() => sales.id),
  outstandingAmount: decimal('outstanding_amount', { precision: 15, scale: 2 }).notNull(),
  dunningFee: decimal('dunning_fee', { precision: 12, scale: 2 }).notNull().default('0'),
  dunningInterest: decimal('dunning_interest', { precision: 12, scale: 2 }).notNull().default('0'),
  grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull(),
  status: dunningStatusEnum('status').notNull().default('draft'),
  sentAt: timestamp('sent_at'),
  resolvedAt: timestamp('resolved_at'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const dunningsRelations = relations(dunnings, ({ one }) => ({
  tenant: one(tenants, { fields: [dunnings.tenantId], references: [tenants.id] }),
  dunningType: one(dunningTypes, { fields: [dunnings.dunningTypeId], references: [dunningTypes.id] }),
  customer: one(customers, { fields: [dunnings.customerId], references: [customers.id] }),
  sale: one(sales, { fields: [dunnings.saleId], references: [sales.id] }),
}))

// ==================== CANCELLATION REASONS ====================

export const cancellationReasons = pgTable('cancellation_reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  documentType: varchar('document_type', { length: 30 }).notNull(),
  // Values: 'purchase_order', 'purchase_invoice', 'sales_order',
  //         'sales_invoice', 'estimate', 'work_order'
  reason: text('reason').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== EMAIL VERIFICATION ====================

// Email verification OTPs (global, no RLS)
export const emailVerificationOtps = pgTable('email_verification_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  otpHash: text('otp_hash').notNull(),
  type: varchar('type', { length: 20 }).notNull().default('registration'), // 'registration' | 'password_reset'
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== AI INTELLIGENCE ====================

// AI error log levels
export const aiLogLevelEnum = pgEnum('ai_log_level', ['error', 'warning', 'info'])

// AI alert types
export const aiAlertTypeEnum = pgEnum('ai_alert_type', ['anomaly', 'insight', 'error', 'suggestion'])
export const aiAlertSeverityEnum = pgEnum('ai_alert_severity', ['low', 'medium', 'high', 'critical'])

// Centralized error logging with AI analysis
export const aiErrorLogs = pgTable('ai_error_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id), // nullable — some errors are system-wide
  level: aiLogLevelEnum('level').notNull().default('error'),
  source: varchar('source', { length: 255 }).notNull(), // API route path or component name
  message: text('message').notNull(),
  stack: text('stack'),
  context: jsonb('context'), // { userId, method, path, body, params }
  aiAnalysis: text('ai_analysis'), // AI-generated explanation (filled async)
  aiSuggestion: text('ai_suggestion'), // AI-generated fix suggestion
  groupHash: varchar('group_hash', { length: 64 }), // hash for grouping similar errors
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Error logging enhancements
  reportedByUserId: uuid('reported_by_user_id').references(() => users.id), // who reported (user bug reports)
  userDescription: text('user_description'), // user's bug description
  reportedUrl: text('reported_url'), // URL where error occurred
  errorSource: varchar('error_source', { length: 20 }).default('system'), // 'system' | 'user_report' | 'frontend'
  resolutionStatus: varchar('resolution_status', { length: 20 }).default('open'), // 'open' | 'investigating' | 'resolved' | 'wont_fix'
  resolutionNotes: text('resolution_notes'), // admin notes on resolution
  errorFingerprint: varchar('error_fingerprint', { length: 64 }), // hash for dedup (message + first stack frame)
  occurrenceCount: integer('occurrence_count').default(1), // count of duplicate errors
  lastOccurredAt: timestamp('last_occurred_at'), // when this error last occurred
  userAgent: text('user_agent'), // browser/client info
  browserInfo: jsonb('browser_info'), // structured browser data for frontend errors
})

export const aiErrorLogsRelations = relations(aiErrorLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [aiErrorLogs.tenantId], references: [tenants.id] }),
  reportedBy: one(users, { fields: [aiErrorLogs.reportedByUserId], references: [users.id] }),
}))

// AI alerts for anomalies, insights, and suggestions
export const aiAlerts = pgTable('ai_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: aiAlertTypeEnum('type').notNull(),
  severity: aiAlertSeverityEnum('severity').notNull().default('medium'),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  entityType: varchar('entity_type', { length: 50 }), // sale, work_order, item, etc.
  entityId: uuid('entity_id'),
  metadata: jsonb('metadata'),
  readAt: timestamp('read_at'),
  dismissedAt: timestamp('dismissed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const aiAlertsRelations = relations(aiAlerts, ({ one }) => ({
  tenant: one(tenants, { fields: [aiAlerts.tenantId], references: [tenants.id] }),
}))

// ==================== AI CHAT MESSAGES ====================

export const aiChatMessages = pgTable('ai_chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  toolsUsed: jsonb('tools_used'), // string[] of tool names used
  metadata: jsonb('metadata'), // { page, businessType, etc. }
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const aiChatMessagesRelations = relations(aiChatMessages, ({ one }) => ({
  tenant: one(tenants, { fields: [aiChatMessages.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [aiChatMessages.userId], references: [users.id] }),
}))

// ==================== LETTER HEADS ====================

export const letterHeadAlignmentEnum = pgEnum('letter_head_alignment', ['left', 'center', 'right'])

export const letterHeads = pgTable('letter_heads', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  headerHtml: text('header_html'),
  footerHtml: text('footer_html'),
  headerImage: text('header_image'),
  footerImage: text('footer_image'),
  headerHeight: integer('header_height').notNull().default(60),
  footerHeight: integer('footer_height').notNull().default(30),
  alignment: letterHeadAlignmentEnum('alignment').notNull().default('center'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const letterHeadsRelations = relations(letterHeads, ({ one }) => ({
  tenant: one(tenants, { fields: [letterHeads.tenantId], references: [tenants.id] }),
}))

// ==================== PRINT TEMPLATES ====================

export const printTemplates = pgTable('print_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  documentType: varchar('document_type', { length: 50 }).notNull(),
  letterHeadId: uuid('letter_head_id').references(() => letterHeads.id),
  paperSize: varchar('paper_size', { length: 20 }).notNull().default('a4'),
  orientation: varchar('orientation', { length: 10 }).notNull().default('portrait'),
  margins: jsonb('margins').$type<{ top: number; right: number; bottom: number; left: number }>(),
  showLogo: boolean('show_logo').notNull().default(true),
  showHeader: boolean('show_header').notNull().default(true),
  showFooter: boolean('show_footer').notNull().default(true),
  customCss: text('custom_css'),
  headerFields: jsonb('header_fields').$type<string[]>(),
  bodyFields: jsonb('body_fields').$type<string[]>(),
  footerFields: jsonb('footer_fields').$type<string[]>(),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const printTemplatesRelations = relations(printTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [printTemplates.tenantId], references: [tenants.id] }),
  letterHead: one(letterHeads, { fields: [printTemplates.letterHeadId], references: [letterHeads.id] }),
}))

// ==================== LABEL TEMPLATES ====================

export const labelTemplates = pgTable('label_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  widthMm: decimal('width_mm', { precision: 6, scale: 2 }).notNull(),
  heightMm: decimal('height_mm', { precision: 6, scale: 2 }).notNull(),
  labelShape: varchar('label_shape', { length: 30 }).default('rectangle').notNull(),
  cornerRadius: real('corner_radius'),
  elements: jsonb('elements').$type<import('@/lib/labels/types').LabelElement[]>().notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const labelTemplatesRelations = relations(labelTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [labelTemplates.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [labelTemplates.createdBy], references: [users.id] }),
}))

// ==================== SAVED REPORTS ====================

export const savedReports = pgTable('saved_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  reportType: varchar('report_type', { length: 50 }).notNull(),
  filters: jsonb('filters').notNull(),
  columns: jsonb('columns').$type<string[]>(),
  createdBy: uuid('created_by').references(() => users.id),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const savedReportsRelations = relations(savedReports, ({ one }) => ({
  tenant: one(tenants, { fields: [savedReports.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [savedReports.createdBy], references: [users.id] }),
}))

// ==================== SETUP PROGRESS ====================

export const setupProgress = pgTable('setup_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull().default(0),
  data: jsonb('data').notNull().default('{}'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('setup_progress_tenant_step').on(table.tenantId, table.stepIndex),
])

export const setupProgressRelations = relations(setupProgress, ({ one }) => ({
  tenant: one(tenants, { fields: [setupProgress.tenantId], references: [tenants.id] }),
}))

// ==================== HR & PAYROLL RELATIONS ====================

export const employeeProfilesRelations = relations(employeeProfiles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [employeeProfiles.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [employeeProfiles.userId], references: [users.id] }),
  salaryStructure: one(salaryStructures, { fields: [employeeProfiles.salaryStructureId], references: [salaryStructures.id] }),
  salarySlips: many(salarySlips),
  advances: many(employeeAdvances),
}))

export const salaryComponentsRelations = relations(salaryComponents, ({ one }) => ({
  tenant: one(tenants, { fields: [salaryComponents.tenantId], references: [tenants.id] }),
  expenseAccount: one(chartOfAccounts, { fields: [salaryComponents.expenseAccountId], references: [chartOfAccounts.id], relationName: 'salaryComponentExpense' }),
  payableAccount: one(chartOfAccounts, { fields: [salaryComponents.payableAccountId], references: [chartOfAccounts.id], relationName: 'salaryComponentPayable' }),
}))

export const salaryStructuresRelations = relations(salaryStructures, ({ one, many }) => ({
  tenant: one(tenants, { fields: [salaryStructures.tenantId], references: [tenants.id] }),
  components: many(salaryStructureComponents),
  employees: many(employeeProfiles),
}))

export const salaryStructureComponentsRelations = relations(salaryStructureComponents, ({ one }) => ({
  tenant: one(tenants, { fields: [salaryStructureComponents.tenantId], references: [tenants.id] }),
  structure: one(salaryStructures, { fields: [salaryStructureComponents.structureId], references: [salaryStructures.id] }),
  component: one(salaryComponents, { fields: [salaryStructureComponents.componentId], references: [salaryComponents.id] }),
}))

export const salarySlipsRelations = relations(salarySlips, ({ one, many }) => ({
  tenant: one(tenants, { fields: [salarySlips.tenantId], references: [tenants.id] }),
  employeeProfile: one(employeeProfiles, { fields: [salarySlips.employeeProfileId], references: [employeeProfiles.id] }),
  user: one(users, { fields: [salarySlips.userId], references: [users.id] }),
  components: many(salarySlipComponents),
  recoveryRecords: many(advanceRecoveryRecords),
}))

export const salarySlipComponentsRelations = relations(salarySlipComponents, ({ one }) => ({
  tenant: one(tenants, { fields: [salarySlipComponents.tenantId], references: [tenants.id] }),
  salarySlip: one(salarySlips, { fields: [salarySlipComponents.salarySlipId], references: [salarySlips.id] }),
  component: one(salaryComponents, { fields: [salarySlipComponents.componentId], references: [salaryComponents.id] }),
}))

export const payrollRunsRelations = relations(payrollRuns, ({ one }) => ({
  tenant: one(tenants, { fields: [payrollRuns.tenantId], references: [tenants.id] }),
}))

export const employeeAdvancesRelations = relations(employeeAdvances, ({ one, many }) => ({
  tenant: one(tenants, { fields: [employeeAdvances.tenantId], references: [tenants.id] }),
  employeeProfile: one(employeeProfiles, { fields: [employeeAdvances.employeeProfileId], references: [employeeProfiles.id] }),
  user: one(users, { fields: [employeeAdvances.userId], references: [users.id] }),
  recoveryRecords: many(advanceRecoveryRecords),
}))

export const advanceRecoveryRecordsRelations = relations(advanceRecoveryRecords, ({ one }) => ({
  tenant: one(tenants, { fields: [advanceRecoveryRecords.tenantId], references: [tenants.id] }),
  advance: one(employeeAdvances, { fields: [advanceRecoveryRecords.advanceId], references: [employeeAdvances.id] }),
  salarySlip: one(salarySlips, { fields: [advanceRecoveryRecords.salarySlipId], references: [salarySlips.id] }),
}))

export const moduleAccessRelations = relations(moduleAccess, ({ one }) => ({
  tenant: one(tenants, { fields: [moduleAccess.tenantId], references: [tenants.id] }),
}))

export const purchaseRequisitionsRelations = relations(purchaseRequisitions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [purchaseRequisitions.tenantId], references: [tenants.id] }),
  requestedByUser: one(users, { fields: [purchaseRequisitions.requestedBy], references: [users.id], relationName: 'requisitionRequester' }),
  approvedByUser: one(users, { fields: [purchaseRequisitions.approvedBy], references: [users.id], relationName: 'requisitionApprover' }),
  rejectedByUser: one(users, { fields: [purchaseRequisitions.rejectedBy], references: [users.id], relationName: 'requisitionRejecter' }),
  costCenter: one(costCenters, { fields: [purchaseRequisitions.costCenterId], references: [costCenters.id] }),
  items: many(purchaseRequisitionItems),
}))

export const purchaseRequisitionItemsRelations = relations(purchaseRequisitionItems, ({ one }) => ({
  tenant: one(tenants, { fields: [purchaseRequisitionItems.tenantId], references: [tenants.id] }),
  requisition: one(purchaseRequisitions, { fields: [purchaseRequisitionItems.requisitionId], references: [purchaseRequisitions.id] }),
  item: one(items, { fields: [purchaseRequisitionItems.itemId], references: [items.id] }),
  preferredSupplier: one(suppliers, { fields: [purchaseRequisitionItems.preferredSupplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [purchaseRequisitionItems.warehouseId], references: [warehouses.id] }),
}))

export const supplierQuotationsRelations = relations(supplierQuotations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [supplierQuotations.tenantId], references: [tenants.id] }),
  supplier: one(suppliers, { fields: [supplierQuotations.supplierId], references: [suppliers.id] }),
  requisition: one(purchaseRequisitions, { fields: [supplierQuotations.requisitionId], references: [purchaseRequisitions.id] }),
  convertedToPO: one(purchaseOrders, { fields: [supplierQuotations.convertedToPOId], references: [purchaseOrders.id] }),
  createdByUser: one(users, { fields: [supplierQuotations.createdBy], references: [users.id] }),
  items: many(supplierQuotationItems),
}))

export const supplierQuotationItemsRelations = relations(supplierQuotationItems, ({ one }) => ({
  tenant: one(tenants, { fields: [supplierQuotationItems.tenantId], references: [tenants.id] }),
  quotation: one(supplierQuotations, { fields: [supplierQuotationItems.quotationId], references: [supplierQuotations.id] }),
  item: one(items, { fields: [supplierQuotationItems.itemId], references: [items.id] }),
}))

// ==================== DEALERSHIP RELATIONS ====================

// Vehicle Inventory relations
export const vehicleInventoryRelations = relations(vehicleInventory, ({ one, many }) => ({
  tenant: one(tenants, { fields: [vehicleInventory.tenantId], references: [tenants.id] }),
  make: one(vehicleMakes, { fields: [vehicleInventory.makeId], references: [vehicleMakes.id] }),
  model: one(vehicleModels, { fields: [vehicleInventory.modelId], references: [vehicleModels.id] }),
  warehouse: one(warehouses, { fields: [vehicleInventory.warehouseId], references: [warehouses.id] }),
  sale: one(sales, { fields: [vehicleInventory.saleId], references: [sales.id] }),
  createdByUser: one(users, { fields: [vehicleInventory.createdBy], references: [users.id] }),
  testDrives: many(testDrives),
  vehicleSaleDetails: many(vehicleSaleDetails),
  vehicleWarranties: many(vehicleWarranties),
  vehicleImports: many(vehicleImports),
  dealerAllocations: many(dealerAllocations),
  expenses: many(vehicleExpenses),
  dealershipInspections: many(dealershipInspections),
  documents: many(vehicleDocuments),
  dealerPayments: many(dealerPayments),
}))

// Test Drive relations
export const testDrivesRelations = relations(testDrives, ({ one }) => ({
  tenant: one(tenants, { fields: [testDrives.tenantId], references: [tenants.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [testDrives.vehicleInventoryId], references: [vehicleInventory.id] }),
  customer: one(customers, { fields: [testDrives.customerId], references: [customers.id] }),
  salesperson: one(users, { fields: [testDrives.salespersonId], references: [users.id] }),
}))

// Trade-In Vehicle relations
export const tradeInVehiclesRelations = relations(tradeInVehicles, ({ one }) => ({
  tenant: one(tenants, { fields: [tradeInVehicles.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [tradeInVehicles.saleId], references: [sales.id] }),
  addedToInventory: one(vehicleInventory, { fields: [tradeInVehicles.addedToInventoryId], references: [vehicleInventory.id] }),
  appraisedByUser: one(users, { fields: [tradeInVehicles.appraisedBy], references: [users.id] }),
}))

// Financing Option relations
export const financingOptionsRelations = relations(financingOptions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [financingOptions.tenantId], references: [tenants.id] }),
  vehicleSaleDetails: many(vehicleSaleDetails),
}))

// Vehicle Sale Details relations
export const vehicleSaleDetailsRelations = relations(vehicleSaleDetails, ({ one }) => ({
  tenant: one(tenants, { fields: [vehicleSaleDetails.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [vehicleSaleDetails.saleId], references: [sales.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [vehicleSaleDetails.vehicleInventoryId], references: [vehicleInventory.id] }),
  tradeInVehicle: one(tradeInVehicles, { fields: [vehicleSaleDetails.tradeInVehicleId], references: [tradeInVehicles.id] }),
  financingOption: one(financingOptions, { fields: [vehicleSaleDetails.financingOptionId], references: [financingOptions.id] }),
  salesperson: one(users, { fields: [vehicleSaleDetails.salespersonId], references: [users.id] }),
}))

// Vehicle Warranty relations
export const vehicleWarrantiesRelations = relations(vehicleWarranties, ({ one }) => ({
  tenant: one(tenants, { fields: [vehicleWarranties.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [vehicleWarranties.saleId], references: [sales.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [vehicleWarranties.vehicleInventoryId], references: [vehicleInventory.id] }),
}))

// Dealer relations
export const dealersRelations = relations(dealers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [dealers.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [dealers.warehouseId], references: [warehouses.id] }),
  users: many(users),
  allocations: many(dealerAllocations),
  payments: many(dealerPayments),
  documents: many(vehicleDocuments),
}))

// Vehicle Import relations
export const vehicleImportsRelations = relations(vehicleImports, ({ one, many }) => ({
  tenant: one(tenants, { fields: [vehicleImports.tenantId], references: [tenants.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [vehicleImports.vehicleInventoryId], references: [vehicleInventory.id] }),
  supplier: one(suppliers, { fields: [vehicleImports.supplierId], references: [suppliers.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [vehicleImports.purchaseOrderId], references: [purchaseOrders.id] }),
  createdByUser: one(users, { fields: [vehicleImports.createdBy], references: [users.id] }),
  documents: many(vehicleDocuments),
}))

// Dealer Allocation relations
export const dealerAllocationsRelations = relations(dealerAllocations, ({ one }) => ({
  tenant: one(tenants, { fields: [dealerAllocations.tenantId], references: [tenants.id] }),
  dealer: one(dealers, { fields: [dealerAllocations.dealerId], references: [dealers.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [dealerAllocations.vehicleInventoryId], references: [vehicleInventory.id] }),
  allocatedByUser: one(users, { fields: [dealerAllocations.allocatedBy], references: [users.id] }),
  returnedByUser: one(users, { fields: [dealerAllocations.returnedBy], references: [users.id] }),
  stockTransfer: one(stockTransfers, { fields: [dealerAllocations.stockTransferId], references: [stockTransfers.id] }),
}))

// Vehicle Expense relations
export const vehicleExpensesRelations = relations(vehicleExpenses, ({ one }) => ({
  tenant: one(tenants, { fields: [vehicleExpenses.tenantId], references: [tenants.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [vehicleExpenses.vehicleInventoryId], references: [vehicleInventory.id] }),
  supplier: one(suppliers, { fields: [vehicleExpenses.supplierId], references: [suppliers.id] }),
  journalEntry: one(journalEntries, { fields: [vehicleExpenses.journalEntryId], references: [journalEntries.id] }),
  createdByUser: one(users, { fields: [vehicleExpenses.createdBy], references: [users.id] }),
}))

// Dealership Inspection relations
export const dealershipInspectionsRelations = relations(dealershipInspections, ({ one }) => ({
  tenant: one(tenants, { fields: [dealershipInspections.tenantId], references: [tenants.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [dealershipInspections.vehicleInventoryId], references: [vehicleInventory.id] }),
  inspectedByUser: one(users, { fields: [dealershipInspections.inspectedBy], references: [users.id] }),
}))

// Dealer Payment relations
export const dealerPaymentsRelations = relations(dealerPayments, ({ one }) => ({
  tenant: one(tenants, { fields: [dealerPayments.tenantId], references: [tenants.id] }),
  dealer: one(dealers, { fields: [dealerPayments.dealerId], references: [dealers.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [dealerPayments.vehicleInventoryId], references: [vehicleInventory.id] }),
  dealerAllocation: one(dealerAllocations, { fields: [dealerPayments.dealerAllocationId], references: [dealerAllocations.id] }),
  sale: one(sales, { fields: [dealerPayments.saleId], references: [sales.id] }),
  journalEntry: one(journalEntries, { fields: [dealerPayments.journalEntryId], references: [journalEntries.id] }),
  createdByUser: one(users, { fields: [dealerPayments.createdBy], references: [users.id] }),
  confirmedByUser: one(users, { fields: [dealerPayments.confirmedBy], references: [users.id] }),
}))

// Vehicle Document relations
export const vehicleDocumentsRelations = relations(vehicleDocuments, ({ one }) => ({
  tenant: one(tenants, { fields: [vehicleDocuments.tenantId], references: [tenants.id] }),
  vehicleInventory: one(vehicleInventory, { fields: [vehicleDocuments.vehicleInventoryId], references: [vehicleInventory.id] }),
  vehicleImport: one(vehicleImports, { fields: [vehicleDocuments.vehicleImportId], references: [vehicleImports.id] }),
  dealer: one(dealers, { fields: [vehicleDocuments.dealerId], references: [dealers.id] }),
  uploadedByUser: one(users, { fields: [vehicleDocuments.uploadedBy], references: [users.id] }),
}))

// ==================== CUSTOM ROLES & PERMISSION OVERRIDES RELATIONS ====================

export const customRolesRelations = relations(customRoles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customRoles.tenantId], references: [tenants.id] }),
  permissionOverrides: many(rolePermissionOverrides),
}))

export const rolePermissionOverridesRelations = relations(rolePermissionOverrides, ({ one }) => ({
  tenant: one(tenants, { fields: [rolePermissionOverrides.tenantId], references: [tenants.id] }),
  customRole: one(customRoles, { fields: [rolePermissionOverrides.customRoleId], references: [customRoles.id] }),
}))

// ==================== POSLANKA: CUSTOMER QUOTATIONS & CREDIT NOTES ====================

export const quotationStatusEnum = pgEnum('quotation_status', [
  'draft', 'sent', 'accepted', 'rejected', 'converted', 'expired', 'cancelled'
])

export const quotations = pgTable('quotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  quotationNo: varchar('quotation_no', { length: 50 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  customerName: varchar('customer_name', { length: 255 }),
  customerPhone: varchar('customer_phone', { length: 50 }),
  customerEmail: varchar('customer_email', { length: 255 }),
  status: quotationStatusEnum('status').notNull().default('draft'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  discount: decimal('discount', { precision: 12, scale: 2 }).notNull().default('0'),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  notes: text('notes'),
  validUntil: date('valid_until'),
  convertedSaleId: uuid('converted_sale_id'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const quotationItems = pgTable('quotation_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  quotationId: uuid('quotation_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
  discount: decimal('discount', { precision: 12, scale: 2 }).notNull().default('0'),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
})

export const creditNoteStatusEnum = pgEnum('credit_note_status', [
  'draft', 'issued', 'applied', 'cancelled'
])

export const creditNotes = pgTable('credit_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  creditNoteNo: varchar('credit_note_no', { length: 50 }).notNull(),
  saleId: uuid('sale_id').references(() => sales.id),
  customerId: uuid('customer_id').references(() => customers.id),
  customerName: varchar('customer_name', { length: 255 }),
  status: creditNoteStatusEnum('status').notNull().default('draft'),
  reason: text('reason'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const creditNoteItems = pgTable('credit_note_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  creditNoteId: uuid('credit_note_id').notNull().references(() => creditNotes.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
})

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [quotations.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [quotations.customerId], references: [customers.id] }),
  items: many(quotationItems),
}))

export const quotationItemsRelations = relations(quotationItems, ({ one }) => ({
  quotation: one(quotations, { fields: [quotationItems.quotationId], references: [quotations.id] }),
  item: one(items, { fields: [quotationItems.itemId], references: [items.id] }),
}))

export const creditNotesRelations = relations(creditNotes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [creditNotes.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [creditNotes.saleId], references: [sales.id] }),
  customer: one(customers, { fields: [creditNotes.customerId], references: [customers.id] }),
  items: many(creditNoteItems),
}))

export const creditNoteItemsRelations = relations(creditNoteItems, ({ one }) => ({
  creditNote: one(creditNotes, { fields: [creditNoteItems.creditNoteId], references: [creditNotes.id] }),
  item: one(items, { fields: [creditNoteItems.itemId], references: [items.id] }),
}))

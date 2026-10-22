import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { CompanySession } from '@/lib/auth'
// Permission cache functions — registered at runtime by authWithCompany() via
// dynamic import('./permission-cache'). This avoids bundling pg/db in client code.
let _getPermissionOverride: ((tenantId: string, role: string, permission: string) => boolean | undefined) | null = null
let _getCustomRolePermission: ((tenantId: string, customRoleId: string, permission: string) => boolean | undefined) | null = null
let _getCustomRoleBaseRole: ((tenantId: string, customRoleId: string) => string | undefined) | null = null

/**
 * Called once from authWithCompany() after dynamic-importing permission-cache.
 * Wires the cache lookup functions into hasPermission without a static import.
 */
export function registerPermissionOverrides(fns: {
  getPermissionOverride: typeof _getPermissionOverride
  getCustomRolePermission: typeof _getCustomRolePermission
  getCustomRoleBaseRole: typeof _getCustomRoleBaseRole
}) {
  _getPermissionOverride = fns.getPermissionOverride
  _getCustomRolePermission = fns.getCustomRolePermission
  _getCustomRoleBaseRole = fns.getCustomRoleBaseRole
}

// Role hierarchy: owner > manager > cashier/technician/chef/waiter > specialized managers
export type UserRole = 'owner' | 'manager' | 'cashier' | 'technician' | 'chef' | 'waiter' | 'system_manager' | 'accounts_manager' | 'sales_manager' | 'purchase_manager' | 'hr_manager' | 'stock_manager' | 'pos_user' | 'report_user' | 'dealer_sales'

// Define which roles can perform which actions
export const ROLE_PERMISSIONS = {
  // Settings and configuration
  manageSettings: ['owner', 'system_manager'],
  manageTenant: ['owner'],

  // User management
  manageUsers: ['owner', 'manager', 'system_manager'],

  // Inventory management
  manageItems: ['owner', 'manager', 'stock_manager'],
  manageCategories: ['owner', 'manager', 'stock_manager'],
  manageInventory: ['owner', 'manager', 'stock_manager'], // Stock transfers, warehouse stock adjustments
  submitStockIntake: ['owner', 'manager', 'stock_manager', 'cashier', 'pos_user'], // W3: create/scan stock intake batches
  postStockIntake: ['owner', 'manager', 'stock_manager'], // W3: sync intake batches into stock

  // Service configuration (auto_service)
  manageServiceTypes: ['owner', 'manager'],
  manageVehicleTypes: ['owner', 'manager'],
  manageInspectionTemplates: ['owner', 'manager'],
  manageVehicles: ['owner', 'manager', 'technician'],

  // Work orders
  manageWorkOrders: ['owner', 'manager', 'technician'],
  deleteWorkOrders: ['owner', 'manager'],
  invoiceWorkOrders: ['owner', 'manager', 'cashier'],

  // Sales — cashier is POS-only (create sales + manage POS); no inventory/reports/settings
  createSales: ['owner', 'manager', 'cashier', 'waiter', 'sales_manager', 'dealer_sales', 'pos_user'],
  voidSales: ['owner', 'manager', 'sales_manager'],
  processReturns: ['owner', 'manager', 'sales_manager'],
  manageSales: ['owner', 'manager', 'sales_manager'],

  // Purchases & Suppliers
  managePurchases: ['owner', 'manager', 'purchase_manager'],
  createRequisitions: ['owner', 'manager', 'technician', 'purchase_manager'],
  approveRequisitions: ['owner', 'manager', 'purchase_manager'],

  // Customers — cashier may view limited credit at POS only (no manageCustomers)
  manageCustomers: ['owner', 'manager', 'waiter', 'sales_manager', 'dealer_sales'],
  manageCustomerCredit: ['owner', 'manager', 'sales_manager'],

  // Appointments
  manageAppointments: ['owner', 'manager', 'technician', 'waiter'],

  // Restaurant
  manageRestaurantOrders: ['owner', 'manager', 'chef', 'waiter'],
  manageTables: ['owner', 'manager', 'chef', 'waiter'],

  // Insurance (auto_service)
  manageInsuranceEstimates: ['owner', 'manager'],
  manageInsuranceCompanies: ['owner', 'manager'],

  // Files
  manageFiles: ['owner', 'manager', 'system_manager'],
  uploadFiles: ['owner', 'manager', 'technician', 'chef', 'waiter', 'system_manager'],
  deleteFiles: ['owner', 'manager', 'system_manager'],

  // Reports
  viewReports: ['owner', 'manager', 'sales_manager', 'purchase_manager', 'hr_manager', 'stock_manager', 'report_user'],

  // Commissions
  manageCommissions: ['owner', 'manager', 'sales_manager'],

  // Dealers
  manageDealers: ['owner', 'manager', 'dealer_sales'],

  // POS operations
  managePOS: ['owner', 'manager', 'pos_user', 'cashier', 'sales_manager'],

  // Print templates & letterheads
  managePrintTemplates: ['owner', 'manager', 'system_manager'],

  // Reports & activity
  viewActivityLogs: ['owner', 'manager', 'system_manager'],
  manageSavedReports: ['owner', 'manager', 'report_user'],

  // Accounting
  viewAccounting: ['owner', 'manager', 'accounts_manager'],
  manageAccounting: ['owner', 'manager', 'accounts_manager'],

  // HR & Payroll
  manageEmployees: ['owner', 'manager', 'hr_manager'],
  manageSalaryComponents: ['owner', 'hr_manager'],
  processPayroll: ['owner', 'hr_manager'],
  viewPayroll: ['owner', 'manager', 'hr_manager'],
  viewOwnPaySlips: ['owner', 'manager', 'cashier', 'technician', 'chef', 'waiter', 'hr_manager', 'sales_manager', 'purchase_manager', 'stock_manager', 'dealer_sales', 'system_manager', 'accounts_manager', 'pos_user', 'report_user'],
  viewOwnCommissions: ['owner', 'manager', 'cashier', 'technician', 'chef', 'waiter', 'sales_manager', 'dealer_sales', 'accounts_manager', 'pos_user'],
  requestAdvance: ['owner', 'manager', 'cashier', 'technician', 'chef', 'waiter', 'hr_manager', 'sales_manager', 'purchase_manager', 'stock_manager', 'dealer_sales', 'system_manager', 'accounts_manager', 'pos_user', 'report_user'],
  approveAdvances: ['owner', 'manager', 'hr_manager'],
  disburseAdvances: ['owner', 'hr_manager'],
  manageModuleAccess: ['owner'],
} as const

export type Permission = keyof typeof ROLE_PERMISSIONS

// Permissions grouped by category for the settings UI
export const PERMISSION_CATEGORIES: Record<string, Permission[]> = {
  'Settings & System': ['manageSettings', 'manageTenant', 'manageModuleAccess'],
  'User Management': ['manageUsers'],
  'Inventory': ['manageItems', 'manageCategories', 'manageInventory', 'submitStockIntake', 'postStockIntake'],
  'Sales': ['createSales', 'voidSales', 'processReturns', 'manageSales', 'managePOS'],
  'Purchases': ['managePurchases', 'createRequisitions', 'approveRequisitions'],
  'Customers': ['manageCustomers', 'manageCustomerCredit'],
  'Auto Service': [
    'manageServiceTypes', 'manageVehicleTypes', 'manageVehicles',
    'manageWorkOrders', 'deleteWorkOrders', 'invoiceWorkOrders',
    'manageInspectionTemplates', 'manageInsuranceEstimates', 'manageInsuranceCompanies',
  ],
  'Restaurant': ['manageRestaurantOrders', 'manageTables', 'manageAppointments'],
  'Accounting': ['viewAccounting', 'manageAccounting'],
  'HR & Payroll': [
    'manageEmployees', 'manageSalaryComponents', 'processPayroll',
    'viewPayroll', 'viewOwnPaySlips', 'requestAdvance', 'approveAdvances', 'disburseAdvances',
  ],
  'Files & Reports': [
    'manageFiles', 'uploadFiles', 'deleteFiles', 'viewReports',
    'viewActivityLogs', 'manageSavedReports', 'managePrintTemplates',
  ],
  'Commissions & Dealers': ['manageCommissions', 'manageDealers', 'viewOwnCommissions'],
}

// Human-readable labels for permissions
export const PERMISSION_LABELS: Record<Permission, string> = {
  manageSettings: 'Manage Settings',
  manageTenant: 'Manage Tenant',
  manageModuleAccess: 'Manage Module Access',
  manageUsers: 'Manage Users',
  manageItems: 'Manage Items',
  manageCategories: 'Manage Categories',
  manageInventory: 'Manage Inventory',
  submitStockIntake: 'Submit Stock Intake',
  postStockIntake: 'Post (Sync) Stock Intake',
  manageServiceTypes: 'Manage Service Types',
  manageVehicleTypes: 'Manage Vehicle Types',
  manageInspectionTemplates: 'Manage Inspection Templates',
  manageVehicles: 'Manage Vehicles',
  manageWorkOrders: 'Manage Work Orders',
  deleteWorkOrders: 'Delete Work Orders',
  invoiceWorkOrders: 'Invoice Work Orders',
  createSales: 'Create Sales',
  voidSales: 'Void Sales',
  processReturns: 'Process Returns',
  manageSales: 'Manage Sales',
  managePurchases: 'Manage Purchases',
  createRequisitions: 'Create Requisitions',
  approveRequisitions: 'Approve Requisitions',
  manageCustomers: 'Manage Customers',
  manageCustomerCredit: 'Manage Customer Credit',
  manageAppointments: 'Manage Appointments',
  manageRestaurantOrders: 'Manage Restaurant Orders',
  manageTables: 'Manage Tables',
  manageInsuranceEstimates: 'Manage Insurance Estimates',
  manageInsuranceCompanies: 'Manage Insurance Companies',
  manageFiles: 'Manage Files',
  uploadFiles: 'Upload Files',
  deleteFiles: 'Delete Files',
  viewReports: 'View Reports',
  manageCommissions: 'Manage Commissions',
  manageDealers: 'Manage Dealers',
  managePOS: 'Manage POS',
  managePrintTemplates: 'Manage Print Templates',
  viewActivityLogs: 'View Activity Logs',
  manageSavedReports: 'Manage Saved Reports',
  viewAccounting: 'View Accounting',
  manageAccounting: 'Manage Accounting',
  manageEmployees: 'Manage Employees',
  manageSalaryComponents: 'Manage Salary Components',
  processPayroll: 'Process Payroll',
  viewPayroll: 'View Payroll',
  viewOwnPaySlips: 'View Own Pay Slips',
  viewOwnCommissions: 'View Own Commissions',
  requestAdvance: 'Request Advance',
  approveAdvances: 'Approve Advances',
  disburseAdvances: 'Disburse Advances',
}

// Permissions that cannot be granted to non-owner roles (protected)
export const OWNER_ONLY_PERMISSIONS: Permission[] = ['manageTenant', 'manageModuleAccess']

// Roles that are specific to certain business types
// Roles NOT listed here are shown for ALL business types
export const BUSINESS_TYPE_ROLES: Record<string, UserRole[]> = {
  restaurant: ['chef', 'waiter'],
  auto_service: ['technician'],
  dealership: ['technician', 'dealer_sales'],
}

// Permission categories specific to certain business types
// Categories NOT listed here are shown for ALL business types
export const BUSINESS_TYPE_CATEGORIES: Record<string, string[]> = {
  restaurant: ['Restaurant'],
  auto_service: ['Auto Service'],
  dealership: ['Auto Service', 'Commissions & Dealers'],
}

/**
 * Get built-in roles relevant to a business type.
 * Universal roles are always included; business-specific roles are added per type.
 */
export function getRolesForBusinessType(businessType: string): UserRole[] {
  // Collect all business-specific roles
  const allSpecificRoles = new Set<UserRole>()
  for (const roles of Object.values(BUSINESS_TYPE_ROLES)) {
    for (const r of roles) allSpecificRoles.add(r)
  }

  // Start with universal roles (those not specific to any business type)
  const result: UserRole[] = []
  const allRoles: UserRole[] = [
    'owner', 'manager', 'system_manager',
    'accounts_manager', 'sales_manager', 'purchase_manager', 'hr_manager', 'stock_manager',
    'cashier', 'technician', 'chef', 'waiter',
    'pos_user', 'report_user', 'dealer_sales',
  ]

  // Roles allowed for this business type
  const allowedSpecific = new Set(BUSINESS_TYPE_ROLES[businessType] || [])

  for (const role of allRoles) {
    if (!allSpecificRoles.has(role) || allowedSpecific.has(role)) {
      result.push(role)
    }
  }

  return result
}

/**
 * Get permission categories relevant to a business type.
 * Universal categories are always included; business-specific categories are added per type.
 */
export function getCategoriesForBusinessType(businessType: string): Record<string, Permission[]> {
  // Collect all business-specific categories
  const allSpecificCategories = new Set<string>()
  for (const cats of Object.values(BUSINESS_TYPE_CATEGORIES)) {
    for (const c of cats) allSpecificCategories.add(c)
  }

  const allowedSpecific = new Set(BUSINESS_TYPE_CATEGORIES[businessType] || [])

  const result: Record<string, Permission[]> = {}
  for (const [category, perms] of Object.entries(PERMISSION_CATEGORIES)) {
    if (!allSpecificCategories.has(category) || allowedSpecific.has(category)) {
      result[category] = perms
    }
  }
  return result
}

/**
 * Role hierarchy levels (higher = more privileged).
 * Used to enforce that users can only modify users at a lower rank.
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner: 100,
  manager: 80,
  system_manager: 70,
  accounts_manager: 60,
  sales_manager: 60,
  purchase_manager: 60,
  hr_manager: 60,
  stock_manager: 60,
  cashier: 40,
  technician: 40,
  chef: 40,
  waiter: 40,
  pos_user: 30,
  report_user: 30,
  dealer_sales: 40,
}

export function getRoleLevel(role: string): number {
  return ROLE_HIERARCHY[role as UserRole] || 0
}

/**
 * Check if the acting user can modify the target user.
 * Rules:
 * - Owner can modify anyone
 * - Non-owners can NEVER modify an owner (owner protection)
 * - Users can modify users at same level or below
 * - Cannot promote someone to 'owner' (only via account dashboard)
 * - Cannot promote someone above your own level
 */
export function canModifyUser(
  actorRole: string,
  targetCurrentRole: string,
  targetNewRole?: string
): boolean {
  // Owner can do anything
  if (actorRole === 'owner') return true

  // Non-owners can NEVER modify an owner
  if (targetCurrentRole === 'owner') return false

  const actorLevel = getRoleLevel(actorRole)
  const targetLevel = getRoleLevel(targetCurrentRole)

  // Can only modify users at same level or below
  if (targetLevel > actorLevel) return false

  // Cannot promote someone to owner or above your level
  if (targetNewRole) {
    if (targetNewRole === 'owner') return false
    if (getRoleLevel(targetNewRole) > actorLevel) return false
  }

  return true
}

/**
 * Permissions the target role would have that the actor lacks (tenant overrides included).
 * Rank alone is not enough: a manager (rank 80) outranks system_manager / hr_manager but does
 * NOT hold manageSettings / processPayroll — creating such a user would let a manager gain
 * those powers by logging in as it. Owners may grant anything.
 */
export function rolePermissionsNotHeld(
  actorRole: string,
  targetRole: string,
  tenantId?: string,
  actorCustomRoleId?: string | null,
): Permission[] {
  if (actorRole === 'owner' && !actorCustomRoleId) return []
  const missing: Permission[] = []
  for (const perm of Object.keys(ROLE_PERMISSIONS) as Permission[]) {
    if (hasPermission(targetRole, perm, tenantId) && !hasPermission(actorRole, perm, tenantId, actorCustomRoleId)) {
      missing.push(perm)
    }
  }
  return missing
}

/**
 * Check if a user role has a specific permission.
 * When tenantId is provided, checks tenant-specific overrides first.
 * When customRoleId is provided, checks custom role permissions.
 */
export function hasPermission(
  role: string,
  permission: Permission,
  tenantId?: string,
  customRoleId?: string | null,
): boolean {
  if (!role) return false

  // Owner always has all permissions (cannot be overridden)
  if (role === 'owner' && !customRoleId) return true

  let effectiveRole = role

  // 1. Custom role check: explicit permissions for the custom role
  if (tenantId && customRoleId && typeof _getCustomRolePermission === 'function') {
    const customPerm = _getCustomRolePermission(tenantId, customRoleId, permission)
    if (customPerm !== undefined) return customPerm
    // Fall through to base role defaults
    if (typeof _getCustomRoleBaseRole === 'function') {
      const baseRole = _getCustomRoleBaseRole(tenantId, customRoleId)
      if (baseRole) effectiveRole = baseRole
    }
  }

  // 2. Built-in role override check (tenant-specific)
  if (tenantId && typeof _getPermissionOverride === 'function') {
    const override = _getPermissionOverride(tenantId, effectiveRole, permission)
    if (override !== undefined) return override
  }

  // 3. System default
  const allowedRoles = ROLE_PERMISSIONS[permission] as readonly string[]
  return allowedRoles.includes(effectiveRole)
}

/**
 * Check if user has required role level
 * Returns true if user's role is in the allowed roles list
 */
export function hasRole(userRole: string, allowedRoles: UserRole[]): boolean {
  if (!userRole) return false
  return allowedRoles.includes(userRole as UserRole)
}

/**
 * API route helper - returns error response if user lacks permission.
 * Automatically uses tenant-specific overrides from the permission cache.
 */
export function requirePermission(session: Session | CompanySession | null, permission: Permission): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = (session.user as Record<string, unknown>)?.tenantId as string | undefined
  const customRoleId = (session.user as Record<string, unknown>)?.customRoleId as string | undefined

  if (!hasPermission(session.user.role, permission, tenantId, customRoleId)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  return null // User has permission
}

/**
 * Get all effective permissions for a user, accounting for overrides and custom roles.
 * Returns a complete map of permission → boolean.
 */
export function getEffectivePermissions(
  role: string,
  tenantId?: string,
  customRoleId?: string | null,
): Record<Permission, boolean> {
  const allPermissions = Object.keys(ROLE_PERMISSIONS) as Permission[]
  const result = {} as Record<Permission, boolean>
  for (const perm of allPermissions) {
    result[perm] = hasPermission(role, perm, tenantId, customRoleId)
  }
  return result
}

/**
 * API route helper - returns error response if user lacks required role
 */
export function requireRole(session: Session | CompanySession | null, allowedRoles: UserRole[]): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasRole(session.user.role, allowedRoles)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  return null // User has required role
}

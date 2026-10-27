/**
 * Where a signed-in staff member lands, by role (and business type). Client-safe (no DB).
 * Cashiers go straight to the till, kitchen staff to the kitchen screen, stock staff to items …
 * Owners and managers open the dashboard.
 */
export function landingPathForRole(role: string | null | undefined, businessType?: string | null): string {
  switch (role) {
    case 'cashier':
    case 'pos_user':
      return '/pos'
    case 'waiter':
      return businessType === 'restaurant' ? '/restaurant/orders' : '/pos'
    case 'chef':
      return businessType === 'restaurant' ? '/restaurant/kitchen' : '/dashboard'
    case 'technician':
      if (businessType === 'auto_service' || businessType === 'dealership') return '/work-orders'
      if (businessType === 'electronics') return '/warranty-claims'
      if (businessType === 'print_studio') return '/print-jobs'
      return '/dashboard'
    case 'dealer_sales':
      return businessType === 'dealership' ? '/dealership/sales' : '/pos'
    case 'stock_manager':
      return '/items'
    case 'purchase_manager':
      return '/purchase-orders'
    case 'accounts_manager':
      return '/accounting'
    case 'hr_manager':
      return '/hr'
    case 'report_user':
      return '/reports'
    case 'sales_manager':
      return '/selling'
    default:
      return '/dashboard'
  }
}

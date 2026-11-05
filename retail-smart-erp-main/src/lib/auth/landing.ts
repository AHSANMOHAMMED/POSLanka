/**
 * Where a signed-in staff member lands, by role (and business type). Client-safe (no DB).
 * Cashiers go straight to the till, kitchen staff to the kitchen screen, stock staff to items …
 * Owners and managers open the dashboard. A mall (several business types) lands a role on the
 * page of whichever of its types uses that role (chef → kitchen when it runs a food court).
 */
import { type BusinessScope, hasBusinessType } from '@/lib/business-types/scope'

export function landingPathForRole(role: string | null | undefined, businessType?: BusinessScope): string {
  const runs = (t: string | readonly string[]) => hasBusinessType(businessType, t)
  switch (role) {
    case 'cashier':
    case 'pos_user':
      return '/pos'
    case 'waiter':
      return runs('restaurant') ? '/restaurant/orders' : '/pos'
    case 'chef':
      return runs('restaurant') ? '/restaurant/kitchen' : '/dashboard'
    case 'technician':
      if (runs(['auto_service', 'dealership'])) return '/work-orders'
      // repair technicians / tailors open their job list (service jobs, 0193)
      if (runs(['electronics', 'textile'])) return '/service-jobs'
      if (runs('print_studio')) return '/print-jobs'
      return '/dashboard'
    case 'dealer_sales':
      return runs('dealership') ? '/dealership/sales' : '/pos'
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

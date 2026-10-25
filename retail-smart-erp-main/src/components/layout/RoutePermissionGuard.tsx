'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ShieldX } from 'lucide-react'
import { hasPermission } from '@/lib/auth/roles'
import { useEffectivePermissions } from '@/hooks/useEffectivePermissions'
import { routePermissionsFor } from '@/lib/navigation/module-sidebar'

/**
 * Pages that open for a role whose menus hide them and whose data the API then refuses (found by
 * crawling every page as every role). Only these are guarded: a page that some role without the
 * menu permission legitimately uses (e.g. a cashier's own POS daily summary) is left to its API.
 */
const GUARDED_PATHS = new Set([
  '/accounting',
  '/accounting/bank-accounts',
  '/accounting/budgets',
  '/accounting/budgets/new',
  '/accounting/chart-of-accounts',
  '/accounting/cheques',
  '/accounting/e-invoicing',
  '/accounting/expenses',
  '/accounting/fiscal-years',
  '/accounting/general-ledger',
  '/accounting/journal-entries',
  '/accounting/journal-entries/new',
  '/accounting/modes-of-payment',
  '/accounting/opening-balances',
  '/accounting/payment-entries',
  '/accounting/payment-entries/new',
  '/accounting/period-closing',
  '/accounting/recurring-entries/new',
  '/accounting/reports/general-ledger',
  '/accounting/settings',
  '/accounting/tax-templates',
  '/appointments',
  '/buying/grn',
  '/credit-notes',
  '/debit-notes',
  '/hr/employee-advances',
  '/hr/employee-advances/new',
  '/hr/employees',
  '/hr/salary-components',
  '/hr/salary-slips',
  '/hr/salary-structures',
  '/inventory/stock-intake',
  '/my/commissions',
  '/pharmacy/expiry',
  '/pos',
  '/price-lists',
  '/promotions',
  '/purchases/landed-costs/new',
  '/reports/aged-payables',
  '/reports/supplier-performance',
  '/restaurant/kitchen',
  '/restaurant/tables',
  '/settings/ai-logs',
  '/settings/staff',
  '/stock-movements',
  '/work-orders',
])

/**
 * A page opened by URL (bookmark, typed link) whose menu entry the user's role does not get shows
 * "no access" instead of an empty page full of refused requests. The rule comes from the menus
 * (routePermissionsFor); the API enforces the same permissions regardless.
 */
export function RoutePermissionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const { slug } = useParams<{ slug: string }>()
  const { data: session, status } = useSession()
  const { permissions: effective, loading } = useEffectivePermissions()
  const relative = pathname.replace(/^\/c\/[^/]+/, '') || '/'
  const needed = GUARDED_PATHS.has(relative.replace(/\/+$/, '') || '/') ? routePermissionsFor(relative) : null
  if (!needed) return <>{children}</>
  // Wait for the permissions before mounting the page, so a refused page never calls its API
  if (status === 'loading' || (loading && !effective)) {
    return <div className="mx-auto mt-16 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-label="Loading" />
  }
  const role = session?.user?.role
  const allowed = needed.some((p) => (effective ? effective[p] === true : !!role && hasPermission(role, p)))
  if (allowed) return <>{children}</>
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <ShieldX className="mx-auto mb-3 h-10 w-10 text-gray-400" aria-hidden />
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">No access to this page</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Your role does not include this part of the system. Ask the owner or a manager if you need it.
      </p>
      <Link href={`/c/${slug}/dashboard`} className="mt-5 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Back to my work
      </Link>
    </div>
  )
}

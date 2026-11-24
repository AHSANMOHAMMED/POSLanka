'use client'

import { AlertCircle, ArrowRight } from 'lucide-react'
import { formatDueAmount, type DueNotice } from '@/lib/tenant/lock-message'

interface DueNoticeBannerProps {
  notice: DueNotice | null
  tenantId: string
  userRole: string
}

const BILLING_ROLES = new Set(['owner', 'manager', 'system_manager'])

/**
 * Persistent payment-due / server subscription notice banner set by Super Admin.
 * Shown to Owner/Manager (and optionally Cashiers if showToCashier is enabled).
 */
export function DueNoticeBanner({ notice, tenantId, userRole }: DueNoticeBannerProps) {
  if (!notice || !notice.enabled) return null
  const isBillingRole = BILLING_ROLES.has(userRole)
  if (!isBillingRole && !notice.showToCashier) return null

  const amount = formatDueAmount(notice.dueAmount, notice.dueCurrency)

  return (
    <div className="bg-amber-600 text-white px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 sm:mt-0" />
          <div className="text-sm min-w-0">
            <span className="font-semibold">{notice.title}</span>
            {amount && isBillingRole && (
              <span className="ml-2 inline-block rounded bg-white/20 px-2 py-0.5 text-xs font-bold">
                Due: {amount}
              </span>
            )}
            {notice.dueDate && (
              <span className="ml-2 text-xs text-amber-100">
                (Due {new Date(notice.dueDate).toLocaleDateString()})
              </span>
            )}
            <p className="text-xs sm:text-sm text-amber-50 mt-0.5">
              {isBillingRole
                ? notice.message
                : 'A subscription payment notice is active for this store. Please inform your Store Owner or Manager.'}
              {isBillingRole && notice.contactNote ? ` · ${notice.contactNote}` : ''}
            </p>
          </div>
        </div>
        {isBillingRole && (
          <a
            href={`/account/subscription/${tenantId}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-white text-amber-800 hover:bg-amber-50 text-xs sm:text-sm font-semibold rounded transition-colors flex-shrink-0"
          >
            View Billing
            <ArrowRight className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  )
}

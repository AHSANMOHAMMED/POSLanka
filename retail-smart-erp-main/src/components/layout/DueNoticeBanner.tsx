'use client'

import Link from 'next/link'
import { AlertCircle, ArrowRight, Calendar, Receipt } from 'lucide-react'
import {
  formatDueAmount,
  resolveDueNoticeUrgency,
  type DueNotice,
} from '@/lib/tenant/lock-message'

interface DueNoticeBannerProps {
  notice: DueNotice | null
  tenantId: string
  companySlug?: string
  userRole: string
}

const BILLING_ROLES = new Set(['owner', 'manager', 'system_manager'])

const TONE_STYLES = {
  green: {
    bar: 'bg-emerald-700 text-white border-b border-emerald-800',
    badge: 'bg-emerald-900/60 text-emerald-100 border border-emerald-400/40',
    subtext: 'text-emerald-100',
    btn: 'bg-white text-emerald-900 hover:bg-emerald-50',
  },
  amber: {
    bar: 'bg-amber-600 text-white border-b border-amber-700',
    badge: 'bg-amber-900/50 text-amber-50 border border-amber-200/40',
    subtext: 'text-amber-50',
    btn: 'bg-white text-amber-900 hover:bg-amber-50',
  },
  red: {
    bar: 'bg-red-600 text-white border-b border-red-700',
    badge: 'bg-red-950/60 text-red-100 border border-red-300/40',
    subtext: 'text-red-50',
    btn: 'bg-white text-red-700 hover:bg-red-50',
  },
} as const

/**
 * Persistent DigitalOcean-style payment-due / server subscription notice banner.
 * Uses traffic-light ("road lamp") colors: Green (>7d upcoming), Amber (1-7d due soon), Red (<=0d overdue).
 * Shown to Owner/Manager with full billing link, and optionally to Cashiers as a clean reminder strip.
 */
export function DueNoticeBanner({ notice, tenantId, companySlug, userRole }: DueNoticeBannerProps) {
  if (!notice || !notice.enabled) return null
  const isBillingRole = BILLING_ROLES.has(userRole)
  if (!isBillingRole && !notice.showToCashier) return null

  const amount = formatDueAmount(notice.dueAmount, notice.dueCurrency)
  const urgency = resolveDueNoticeUrgency(notice)
  const palette = TONE_STYLES[urgency.color]
  const billingHref = companySlug ? `/c/${companySlug}/billing` : `/account/subscription/${tenantId}`

  return (
    <div className={`${palette.bar} px-4 py-2.5 shadow-sm`}>
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
          {/* 3-lamp Traffic Light indicator */}
          <div
            className="hidden sm:flex items-center gap-1 bg-black/30 px-2 py-1.5 rounded-full border border-white/15 shrink-0"
            title={`Payment status: ${urgency.label}`}
          >
            <span className={`w-2 h-2 rounded-full ${urgency.color === 'red' ? 'bg-red-400 shadow-[0_0_6px_#f87171]' : 'bg-white/20'}`} />
            <span className={`w-2 h-2 rounded-full ${urgency.color === 'amber' ? 'bg-amber-300 shadow-[0_0_6px_#fcd34d]' : 'bg-white/20'}`} />
            <span className={`w-2 h-2 rounded-full ${urgency.color === 'green' ? 'bg-emerald-300 shadow-[0_0_6px_#6ee7b7]' : 'bg-white/20'}`} />
          </div>

          <AlertCircle className="w-5 h-5 flex-shrink-0 sm:hidden mt-0.5" />

          <div className="text-sm min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-extrabold tracking-wider uppercase ${palette.badge}`}>
                {urgency.label}
              </span>
              <span className="font-bold">
                {isBillingRole ? notice.title : 'Store Server & Subscription Notice'}
              </span>
              {amount && isBillingRole && (
                <span className="inline-flex items-center gap-1 rounded bg-white/20 px-2 py-0.5 text-xs font-extrabold">
                  Due: {amount}
                </span>
              )}
              {(urgency.countdownText || notice.dueDate) && (
                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${palette.subtext}`}>
                  <Calendar className="w-3.5 h-3.5" />
                  {urgency.countdownText ? `${urgency.countdownText}` : ''}
                  {notice.dueDate ? ` (${new Date(notice.dueDate).toLocaleDateString()})` : ''}
                </span>
              )}
              {isBillingRole && notice.billingPeriod && (
                <span className={`text-xs opacity-90 hidden md:inline ${palette.subtext}`}>
                  · {notice.billingPeriod}
                </span>
              )}
            </div>

            <p className={`text-xs sm:text-sm mt-0.5 ${palette.subtext}`}>
              {isBillingRole
                ? notice.message
                : urgency.color === 'red'
                ? 'Urgent: Store subscription payment is due/overdue. Please notify your Store Owner or Manager immediately to avoid service interruption.'
                : 'A scheduled server & subscription payment reminder is active for this store. Please inform your Store Owner or Manager.'}
              {isBillingRole && notice.contactNote ? ` · ${notice.contactNote}` : ''}
            </p>
          </div>
        </div>

        {isBillingRole && (
          <Link
            href={billingHref}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 ${palette.btn} text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors flex-shrink-0`}
          >
            <Receipt className="w-4 h-4" />
            View Billing
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  )
}

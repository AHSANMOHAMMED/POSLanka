'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Calendar, CheckCircle2, Clock, Receipt, X } from 'lucide-react'
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
 * Persistent DigitalOcean-style payment-due & payment-received banner.
 * - Live ticking day/hour/minute/second countdown visible to Owner and Cashier.
 * - Traffic-light ("road lamp") colors: Green (>7d upcoming), Amber (1-7d due soon), Red (<=0d overdue).
 * - Verified Emerald "Payment Received" banner once Super Admin confirms payment.
 */
export function DueNoticeBanner({ notice, tenantId, companySlug, userRole }: DueNoticeBannerProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [dismissedPaidAt, setDismissedPaidAt] = useState<string | null>(null)

  const isPaid = notice?.status === 'paid'
  const shouldTick = Boolean(notice?.enabled && !isPaid && notice?.dueDate)

  useEffect(() => {
    if (!shouldTick) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [shouldTick])

  if (!notice || !notice.enabled) return null
  const isBillingRole = BILLING_ROLES.has(userRole)
  if (!isBillingRole && !notice.showToCashier) return null
  if (isPaid && dismissedPaidAt === notice.updatedAt) return null

  const billingHref = companySlug ? `/c/${companySlug}/billing` : `/account/subscription/${tenantId}`

  if (isPaid) {
    const paid = notice.paidDetails
    const paidAmt = formatDueAmount(paid?.amount ?? notice.dueAmount, paid?.currency ?? notice.dueCurrency)
    return (
      <div className="bg-emerald-700 text-white border-b border-emerald-800 px-4 py-2.5 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-200 flex-shrink-0 mt-0.5 sm:mt-0" />
            <div className="text-sm min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-extrabold tracking-wider uppercase bg-emerald-900/60 text-emerald-100 border border-emerald-400/40">
                  PAYMENT RECEIVED
                </span>
                <span className="font-bold">
                  {isBillingRole ? notice.title : 'Store Subscription Payment Verified'}
                </span>
                {paidAmt && isBillingRole && (
                  <span className="inline-flex items-center rounded bg-white/20 px-2 py-0.5 text-xs font-extrabold">
                    Paid: {paidAmt}
                  </span>
                )}
                {isBillingRole && paid?.method && (
                  <span className="text-xs text-emerald-100 font-semibold">
                    via {paid.method}
                    {paid.reference ? ` (Ref: ${paid.reference})` : ''}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-emerald-50 mt-0.5">
                {isBillingRole
                  ? `${notice.message}${paid?.paidAt ? ` · Received ${new Date(paid.paidAt).toLocaleString()}` : ''}`
                  : 'Store server & subscription payment has been received and verified. Thank you!'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isBillingRole && (
              <Link
                href={billingHref}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-900 hover:bg-emerald-50 text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors"
              >
                <Receipt className="w-4 h-4" />
                View Receipt
              </Link>
            )}
            <button
              type="button"
              onClick={() => setDismissedPaidAt(notice.updatedAt)}
              className="p-1.5 rounded-lg hover:bg-white/15 text-emerald-100 transition-colors"
              aria-label="Dismiss payment confirmation"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  const amount = formatDueAmount(notice.dueAmount, notice.dueCurrency)
  const urgency = resolveDueNoticeUrgency(notice, nowMs)
  const palette = TONE_STYLES[urgency.color]

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
              {urgency.liveCountdown && (
                <span className="inline-flex items-center gap-1 rounded bg-black/25 px-2 py-0.5 text-xs font-mono font-bold">
                  <Clock className="w-3.5 h-3.5" />
                  {urgency.liveCountdown}
                </span>
              )}
              {notice.dueDate && (
                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${palette.subtext}`}>
                  <Calendar className="w-3.5 h-3.5" />
                  {urgency.countdownText ? `${urgency.countdownText} · ` : ''}
                  {new Date(notice.dueDate).toLocaleDateString()}
                  {notice.dueTime ? ` ${notice.dueTime}` : ''}
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
                ? `Urgent: Store subscription payment is due/overdue${urgency.liveCountdown ? ` (${urgency.liveCountdown})` : ''}. Please notify your Store Owner or Manager immediately.`
                : `Server & subscription payment reminder${urgency.countdownText ? ` (${urgency.countdownText})` : ''}. Please inform your Store Owner or Manager.`}
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

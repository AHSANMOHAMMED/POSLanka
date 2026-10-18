'use client'

import { useState, useEffect } from 'react'
import { X, Clock, ArrowRight, Zap } from 'lucide-react'
import { useUserRole } from '@/hooks'

interface TrialBannerProps {
  companySlug: string
}

interface SubscriptionInfo {
  status: string
  trialEndsAt: string | null
  tierName: string
}

// Only these roles should see the trial banner
const BILLING_ROLES = new Set(['owner', 'manager', 'system_manager'])

export function TrialBanner({ companySlug }: TrialBannerProps) {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(true)
  const userRole = useUserRole()

  // Don't show to non-billing roles (cashiers, technicians, etc.)
  const canSeeBanner = userRole ? BILLING_ROLES.has(userRole) : false

  useEffect(() => {
    if (!canSeeBanner) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }

    // Check if dismissed for this company
    const dismissedKey = `trial_banner_dismissed_${companySlug}`
    const dismissedTime = localStorage.getItem(dismissedKey)
    if (dismissedTime) {
      // Only keep dismissed for 24 hours
      const dismissedAt = new Date(dismissedTime).getTime()
      const now = new Date().getTime()
      if (now - dismissedAt < 24 * 60 * 60 * 1000) {
        setDismissed(true)
        setLoading(false)
        return
      }
    }

    // Fetch subscription info
    fetch(`/api/company/subscription`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => {
        if (data.status) {
          setSubscription(data)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [companySlug, canSeeBanner])

  // Hide if: not trial, no trial end date (free plan), dismissed, or non-billing role
  if (loading || dismissed || !canSeeBanner || !subscription || subscription.status !== 'trial' || !subscription.trialEndsAt) {
    return null
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem(`trial_banner_dismissed_${companySlug}`, new Date().toISOString())
  }

  // Calculate days remaining
  let daysRemaining = 0
  let urgencyLevel: 'low' | 'medium' | 'high' = 'low'
  if (subscription.trialEndsAt) {
    const trialEnd = new Date(subscription.trialEndsAt).getTime()
    const now = new Date().getTime()
    daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)))

    if (daysRemaining <= 3) {
      urgencyLevel = 'high'
    } else if (daysRemaining <= 7) {
      urgencyLevel = 'medium'
    }
  }

  const bannerStyles = {
    low: 'bg-blue-600',
    medium: 'bg-orange-500',
    high: 'bg-red-600',
  }

  return (
    <div className={`${bannerStyles[urgencyLevel]} text-white px-4 py-2.5`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {urgencyLevel === 'high' ? (
            <Zap className="w-5 h-5 flex-shrink-0" />
          ) : (
            <Clock className="w-5 h-5 flex-shrink-0" />
          )}
          <p className="text-sm font-medium">
            {daysRemaining === 0
              ? 'Your plan ends today!'
              : daysRemaining === 1
              ? 'Your plan ends tomorrow!'
              : `${daysRemaining} days left on your plan`}
            <span className="hidden sm:inline ml-1">
              {' '}
              - Upgrade now to keep all your data and features.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={`${process.env.NEXT_PUBLIC_APP_DOMAIN ? `https://${process.env.NEXT_PUBLIC_APP_DOMAIN}` : ''}/account/plans`}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-medium rounded transition-colors"
          >
            Upgrade Now
            <ArrowRight className="w-4 h-4" />
          </a>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

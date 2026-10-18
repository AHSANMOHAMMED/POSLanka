'use client'

import { useState, useCallback, use } from 'react'
import { useRealtimeDataMultiple } from '@/hooks'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  CreditCard,
  AlertTriangle,
  Loader2,
  Crown,
  Database,
  HardDrive,
  Sparkles,
  X,
  Zap,
  Users,
  ShoppingCart,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Info,
  CheckCircle2,
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface Tier {
  id: string
  name: string
  displayName: string
  priceMonthly: string | null
  priceYearly: string | null
  maxUsers: number | null
  maxSalesMonthly: number | null
  maxDatabaseBytes: number | null
  maxFileStorageBytes: number | null
  features: Record<string, unknown>
}

interface SubscriptionData {
  subscription: {
    id: string
    status: string
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    trialEndsAt: string | null
    cancelAtPeriodEnd: boolean
  }
  currentTier: Tier | null
  availableTiers: Tier[]
  canManage: boolean
  usage?: {
    databaseBytes: number
    fileStorageBytes: number
  }
}

interface ProrationPreview {
  currentTier: { id: string; name: string; price: number }
  newTier: { id: string; name: string; price: number }
  proration?: {
    daysRemaining: number
    totalDaysInPeriod: number
    creditAmount: number
    newPlanCost: number
  }
  amountDue: number
  isUpgrade: boolean
  billingCycle: string
  currentBillingCycle?: string
  cycleChanging?: boolean
  walletBalance: number
  noProration?: boolean
}


function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function SubscriptionPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = use(params)
  const [data, setData] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [walletBalance, setWalletBalance] = useState<number>(0)
  const [walletCurrency, setWalletCurrency] = useState<string>('USD')

  // Proration modal state
  const [showProrationModal, setShowProrationModal] = useState(false)
  const [prorationPreview, setProrationPreview] = useState<ProrationPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)

  const fetchSubscription = useCallback(async () => {
    try {
      const res = await fetch(`/api/account/subscriptions/${tenantId}`)
      if (res.ok) {
        const subData = await res.json()
        setData(subData)
      } else {
        setError('Unable to load subscription')
      }
    } catch {
      setError('Failed to load subscription')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  const fetchWalletBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/account/wallet')
      if (res.ok) {
        const walletData = await res.json()
        setWalletBalance(Number(walletData.balance || 0))
        setWalletCurrency(walletData.currency || 'LKR')
      }
    } catch {
      // Non-critical, don't block UI
    }
  }, [])

  // Real-time updates via WebSocket
  useRealtimeDataMultiple([fetchSubscription, fetchWalletBalance], {
    entityType: ['account-subscription', 'account-wallet'],
  })

  // Preview proration when user clicks on a tier
  const handlePreviewChange = async (tierId: string) => {
    if (!data?.canManage) return

    setSelectedTierId(tierId)
    setPreviewLoading(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch(`/api/account/subscriptions/${tenantId}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newTierId: tierId,
          billingCycle,
          action: 'preview',
        }),
      })

      if (!res.ok) {
        const errData = await res.json()
        setError(errData.error || 'Failed to preview plan change')
        setPreviewLoading(false)
        return
      }

      const preview = await res.json()
      setProrationPreview(preview)
      setShowProrationModal(true)
    } catch {
      setError('Failed to preview plan change')
    } finally {
      setPreviewLoading(false)
    }
  }

  // Execute the upgrade/downgrade
  const handleExecuteChange = async () => {
    if (!selectedTierId || !prorationPreview) return

    setUpdating(true)
    setError('')

    try {
      const res = await fetch(`/api/account/subscriptions/${tenantId}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newTierId: selectedTierId,
          billingCycle,
          action: 'execute',
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setError(result.error || 'Failed to change plan')
        return
      }

      // Handle different responses
      if (result.requiresPayment) {
        // Need PayHere payment - redirect to checkout
        try {
          const checkoutRes = await fetch('/api/payhere/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriptionId: result.subscriptionId,
              tierId: selectedTierId,
              billingCycle: result.billingCycle,
              newTierId: result.newTierId,
              walletCreditApplied: result.walletCredit || 0,
              amount: result.amount,
            }),
          })

          const checkoutData = await checkoutRes.json()

          if (!checkoutRes.ok) {
            setError(checkoutData.error || 'Failed to initiate payment')
            return
          }

          // Redirect to PayHere checkout (validate domain to prevent open redirect)
          const PAYHERE_DOMAINS = ['payhere.lk', 'sandbox.payhere.lk', 'www.payhere.lk']
          if (checkoutData.checkoutUrl) {
            try {
              const checkoutHost = new URL(checkoutData.checkoutUrl).hostname
              if (!PAYHERE_DOMAINS.includes(checkoutHost)) {
                setError('Invalid checkout URL')
                return
              }
            } catch {
              setError('Invalid checkout URL')
              return
            }
            window.location.href = checkoutData.checkoutUrl
            return
          }

          // If no redirect URL, submit form (PayHere form-based checkout)
          if (checkoutData.params) {
            const rawAction = checkoutData.params.checkout_url || 'https://sandbox.payhere.lk/pay/checkout'
            let validatedAction = 'https://sandbox.payhere.lk/pay/checkout'
            try {
              const actionHost = new URL(String(rawAction)).hostname
              if (PAYHERE_DOMAINS.includes(actionHost)) validatedAction = String(rawAction)
            } catch { /* use default */ }
            const form = document.createElement('form')
            form.method = 'POST'
            form.action = validatedAction
            Object.entries(checkoutData.params).forEach(([key, value]) => {
              if (key === 'checkout_url') return
              const input = document.createElement('input')
              input.type = 'hidden'
              input.name = key
              input.value = String(value)
              form.appendChild(input)
            })
            document.body.appendChild(form)
            form.submit()
            return
          }
        } catch {
          setError('Failed to initiate payment')
          return
        }
      }

      // Success - plan changed
      setShowProrationModal(false)
      setProrationPreview(null)
      setSelectedTierId(null)

      if (result.paidFromWallet) {
        setSuccess(`Plan upgraded successfully! ${formatCurrencyWithSymbol(result.amountCharged, walletCurrency)} charged from wallet.`)
        setWalletBalance(Number(result.newWalletBalance))
      } else if (result.creditApplied) {
        setSuccess(`Plan changed successfully! ${formatCurrencyWithSymbol(result.creditApplied, walletCurrency)} credited to your wallet.`)
        setWalletBalance(Number(result.newWalletBalance))
      } else {
        setSuccess('Plan changed successfully!')
      }

      await fetchSubscription()
      await fetchWalletBalance()
    } catch {
      setError('Failed to change plan')
    } finally {
      setUpdating(false)
    }
  }

  const handleToggleCancellation = async () => {
    if (!data?.canManage) return

    setUpdating(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch(`/api/account/subscriptions/${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cancelAtPeriodEnd: !data.subscription.cancelAtPeriodEnd,
        }),
      })

      if (!res.ok) {
        const errData = await res.json()
        setError(errData.error || 'Failed to update subscription')
        return
      }

      await fetchSubscription()
    } catch {
      setError('Failed to update subscription')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mb-4">
          <X className="w-8 h-8 text-red-500 dark:text-red-400" />
        </div>
        <p className="text-gray-500 dark:text-gray-400">{error || 'Subscription not found'}</p>
        <Link
          href="/account"
          className="mt-4 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
        >
          Back to Account
        </Link>
      </div>
    )
  }

  const { subscription, currentTier, availableTiers, canManage } = data
  const dbUsed = data.usage?.databaseBytes || 0
  const fileUsed = data.usage?.fileStorageBytes || 0
  const dbLimit = currentTier?.maxDatabaseBytes
  const fileLimit = currentTier?.maxFileStorageBytes
  const dbPercent = dbLimit ? Math.min((dbUsed / dbLimit) * 100, 100) : 0
  const filePercent = fileLimit ? Math.min((fileUsed / fileLimit) * 100, 100) : 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/account"
          className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>

      {/* Hero Section */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-4">
          <CreditCard className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Manage Subscription</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">View and manage your subscription plan</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/50 rounded-md flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-md flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-green-700 dark:text-green-400">{success}</p>
        </div>
      )}

      {/* Wallet Balance Card */}
      {canManage && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/50 rounded-md flex items-center justify-center">
                <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-emerald-700 dark:text-emerald-400">Wallet Balance</p>
                <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100">{formatCurrencyWithSymbol(walletBalance, walletCurrency)}</p>
              </div>
            </div>
            <Link
              href="/account/wallet"
              className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
            >
              View Wallet
            </Link>
          </div>
        </div>
      )}

      {/* Current Plan Card with Storage Usage */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24" />

        <div className="relative">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center">
                <Crown className="w-7 h-7 text-yellow-400" />
              </div>
              <div>
                <p className="text-gray-400 text-sm">Current Plan</p>
                <h2 className="text-2xl font-bold">{currentTier?.displayName || 'No plan'}</h2>
              </div>
            </div>
            <span
              className={`px-4 py-2 text-sm font-medium rounded-md ${
                subscription.status === 'active'
                  ? 'bg-green-500/20 text-green-400'
                  : subscription.status === 'trial'
                  ? 'bg-green-500/20 text-green-400'
                  : subscription.status === 'past_due'
                  ? 'bg-red-500/20 text-red-400'
                  : subscription.status === 'locked'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {subscription.status === 'trial' ? 'Free Plan' : subscription.status === 'locked' ? 'Locked' : subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
            </span>
          </div>

          {currentTier && (
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-4xl font-bold">{formatCurrencyWithSymbol(Number(currentTier.priceMonthly), 'LKR')}</span>
              <span className="text-gray-400">/month</span>
            </div>
          )}

          {/* Storage Usage Bars */}
          <div className="grid gap-3 md:grid-cols-2 mt-6">
            <div className="bg-white/10 rounded-md p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-gray-300">Database</span>
                </div>
                <span className="text-sm text-gray-400">
                  {formatBytes(dbUsed)}{dbLimit ? ` / ${formatBytes(dbLimit)}` : ''}
                </span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${dbPercent >= 90 ? 'bg-red-500' : dbPercent >= 80 ? 'bg-yellow-500' : 'bg-purple-500'}`}
                  style={{ width: dbLimit ? `${dbPercent}%` : '0%' }}
                />
              </div>
            </div>
            <div className="bg-white/10 rounded-md p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-gray-300">Files</span>
                </div>
                <span className="text-sm text-gray-400">
                  {formatBytes(fileUsed)}{fileLimit ? ` / ${formatBytes(fileLimit)}` : ''}
                </span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${filePercent >= 90 ? 'bg-red-500' : filePercent >= 80 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: fileLimit ? `${filePercent}%` : '0%' }}
                />
              </div>
            </div>
          </div>

          {subscription.cancelAtPeriodEnd && (
            <div className="flex items-center gap-2 p-3 bg-red-500/20 rounded-md mt-4">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <p className="text-red-300 text-sm">Subscription will cancel at period end</p>
            </div>
          )}

          {subscription.currentPeriodEnd && (
            <p className="text-gray-400 text-sm mt-4">
              Current period ends: {formatDate(subscription.currentPeriodEnd)}
            </p>
          )}
        </div>
      </div>

      {/* Free Plan Notice */}
      {subscription.status === 'trial' && subscription.trialEndsAt && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/50 rounded-md flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Free Plan Active</h3>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Your free plan is active with full access to all features.
                Upgrade to a paid plan for additional storage and capabilities.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Unlimited Badge */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-full">
          <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Unlimited Users</span>
          <span className="text-emerald-300 dark:text-emerald-600 mx-1">|</span>
          <ShoppingCart className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Unlimited Transactions</span>
        </div>
      </div>

      {/* Billing Cycle Toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
          Monthly
        </span>
        <button
          onClick={() => setBillingCycle(prev => prev === 'monthly' ? 'yearly' : 'monthly')}
          className={`relative w-14 h-7 rounded-full transition-colors ${
            billingCycle === 'yearly' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <div
            className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
              billingCycle === 'yearly' ? 'translate-x-7' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className={`text-sm font-medium ${billingCycle === 'yearly' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
          Yearly
        </span>
        {billingCycle === 'yearly' && (
          <span className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
            Save ~17%
          </span>
        )}
      </div>

      {/* Available Plans */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Available Plans</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {availableTiers.filter(t => t.name !== 'trial').map((tier) => {
            const isCurrent = currentTier?.id === tier.id
            const isPopular = tier.name === 'professional'
            const isCustomTier = tier.priceMonthly == null && tier.priceYearly == null
            const displayPrice = isCustomTier ? null : (billingCycle === 'yearly' ? tier.priceYearly : tier.priceMonthly)
            const monthlyEquiv = !isCustomTier && billingCycle === 'yearly' && tier.priceYearly
              ? (parseFloat(tier.priceYearly) / 12).toFixed(0)
              : null
            const storageGainDb = tier.maxDatabaseBytes && currentTier?.maxDatabaseBytes
              ? tier.maxDatabaseBytes - currentTier.maxDatabaseBytes
              : 0
            const storageGainFile = tier.maxFileStorageBytes && currentTier?.maxFileStorageBytes
              ? tier.maxFileStorageBytes - currentTier.maxFileStorageBytes
              : 0
            const isUpgrade = !isCustomTier && parseFloat(tier.priceMonthly || '0') > parseFloat(currentTier?.priceMonthly || '0')
            const isPreviewingThis = previewLoading && selectedTierId === tier.id

            return (
              <div
                key={tier.id}
                className={`relative bg-white dark:bg-gray-800 rounded-2xl border-2 p-6 transition-all hover:shadow-xl ${
                  isCurrent
                    ? 'border-blue-500 ring-4 ring-blue-100 dark:ring-blue-900/50'
                    : isPopular
                    ? 'border-blue-500'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {isPopular && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold rounded-full">
                      <Zap className="w-3 h-3" />
                      Popular
                    </span>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500 text-white text-xs font-semibold rounded-full">
                      <Check className="w-3 h-3" />
                      Current
                    </span>
                  </div>
                )}

                <div className="mb-4 pt-2">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{tier.displayName}</h3>
                </div>

                <div className="mb-4">
                  {isCustomTier ? (
                    <span className="text-xl font-bold text-gray-900 dark:text-white">Custom Pricing</span>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-gray-900 dark:text-white">
                          {formatCurrencyWithSymbol(Number(displayPrice), 'LKR')}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 text-sm">/{billingCycle === 'yearly' ? 'yr' : 'mo'}</span>
                      </div>
                      {monthlyEquiv && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">~{formatCurrencyWithSymbol(Number(monthlyEquiv), 'LKR')}/mo</p>
                      )}
                    </>
                  )}
                </div>

                {/* Storage Info */}
                <div className="space-y-2 mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
                  <div className="flex items-center gap-2 text-sm dark:text-gray-300">
                    <Database className="w-4 h-4 text-purple-500" />
                    <span className="font-medium">{tier.maxDatabaseBytes ? formatBytes(tier.maxDatabaseBytes) : 'Custom'} DB</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm dark:text-gray-300">
                    <HardDrive className="w-4 h-4 text-green-500" />
                    <span className="font-medium">{tier.maxFileStorageBytes ? formatBytes(tier.maxFileStorageBytes) : 'Custom'} Files</span>
                  </div>
                </div>

                {/* Storage gain indicator */}
                {!isCurrent && (storageGainDb > 0 || storageGainFile > 0) && (
                  <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded p-2 mb-4">
                    {storageGainDb > 0 && <span>+{formatBytes(storageGainDb)} DB </span>}
                    {storageGainFile > 0 && <span>+{formatBytes(storageGainFile)} Files</span>}
                  </div>
                )}

                <ul className="space-y-2 mb-4">
                  <li className="flex items-center gap-2 text-sm dark:text-gray-300">
                    <Check className="w-3.5 h-3.5 text-green-500" />
                    <span>All features included</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm dark:text-gray-300">
                    <Check className="w-3.5 h-3.5 text-green-500" />
                    <span>Unlimited users & sales</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm dark:text-gray-300">
                    <Check className="w-3.5 h-3.5 text-green-500" />
                    <span>All business types</span>
                  </li>
                </ul>

                {canManage && !isCurrent && isCustomTier && (
                  <Link
                    href="/contact"
                    className="block w-full py-2.5 px-4 rounded-md font-medium text-center text-sm bg-gray-900 text-white hover:bg-gray-800 transition-colors"
                  >
                    Contact Us
                  </Link>
                )}

                {canManage && !isCurrent && !isCustomTier && (
                  <button
                    onClick={() => handlePreviewChange(tier.id)}
                    disabled={previewLoading || updating}
                    className={`w-full py-2.5 px-4 rounded-md font-medium transition-all disabled:opacity-50 text-sm ${
                      isUpgrade
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {isPreviewingThis ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading...
                      </span>
                    ) : isUpgrade ? (
                      'Upgrade'
                    ) : (
                      'Downgrade'
                    )}
                  </button>
                )}

                {isCurrent && (
                  <div className="w-full py-2.5 px-4 rounded-md font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-center text-sm">
                    Current Plan
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Cancel Subscription */}
      {canManage && subscription.status === 'active' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border-2 border-red-200 dark:border-red-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-red-100 dark:border-red-800 bg-red-50 dark:bg-red-900/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/50 rounded-md flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-red-900 dark:text-red-300">Cancel Subscription</h3>
                <p className="text-sm text-red-600 dark:text-red-400">
                  {subscription.cancelAtPeriodEnd
                    ? 'Your subscription will be cancelled at the end of the current period.'
                    : 'Cancel your subscription. You can still use the service until the end of your billing period.'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <button
              onClick={handleToggleCancellation}
              disabled={updating}
              className={`px-6 py-3 rounded-md font-medium transition-all disabled:opacity-50 ${
                subscription.cancelAtPeriodEnd
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-red-500 text-white hover:bg-red-600'
              }`}
            >
              {updating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </span>
              ) : subscription.cancelAtPeriodEnd ? (
                'Resume Subscription'
              ) : (
                'Cancel Subscription'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Proration Preview Modal */}
      {showProrationModal && prorationPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => {
              setShowProrationModal(false)
              setProrationPreview(null)
              setSelectedTierId(null)
            }}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="p-6 pb-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center ${
                    prorationPreview.isUpgrade
                      ? 'bg-blue-100 dark:bg-blue-900/50'
                      : 'bg-amber-100 dark:bg-amber-900/50'
                  }`}>
                    {prorationPreview.isUpgrade ? (
                      <ArrowUpRight className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <ArrowDownRight className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    {prorationPreview.isUpgrade ? 'Upgrade' : 'Downgrade'} Plan
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setShowProrationModal(false)
                    setProrationPreview(null)
                    setSelectedTierId(null)
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </button>
              </div>

              {/* Plan Change Summary */}
              <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-md mb-4">
                <div className="flex-1 text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Current</p>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">{prorationPreview.currentTier.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatCurrencyWithSymbol(prorationPreview.currentTier.price, 'LKR')}</p>
                </div>
                <div className="text-gray-300 dark:text-gray-600">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <div className="flex-1 text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">New</p>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">{prorationPreview.newTier.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatCurrencyWithSymbol(prorationPreview.newTier.price, 'LKR')}/{billingCycle === 'yearly' ? 'yr' : 'mo'}
                  </p>
                </div>
              </div>
            </div>

            {/* Proration Breakdown */}
            <div className="px-6 pb-4">
              {prorationPreview.noProration ? (
                <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-md mb-4">
                  <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-300">Full payment required</p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                      As you&apos;re on the free plan, the full plan price will be charged to start your subscription.
                    </p>
                  </div>
                </div>
              ) : prorationPreview.proration ? (
                <div className="space-y-3 mb-4">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Proration Details
                  </h4>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Days remaining in period</span>
                      <span className="font-medium dark:text-gray-200">{prorationPreview.proration.daysRemaining} / {prorationPreview.proration.totalDaysInPeriod}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Credit from current plan</span>
                      <span className="font-medium text-green-600 dark:text-green-400">-{formatCurrencyWithSymbol(prorationPreview.proration.creditAmount, walletCurrency)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">New plan cost (remaining days)</span>
                      <span className="font-medium dark:text-gray-200">+{formatCurrencyWithSymbol(prorationPreview.proration.newPlanCost, walletCurrency)}</span>
                    </div>
                    {prorationPreview.cycleChanging && (
                      <div className="flex items-start gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                        <Info className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Billing cycle changing from {prorationPreview.currentBillingCycle} to {prorationPreview.billingCycle}.
                          The new cycle will start at your next renewal.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Amount Due */}
              <div className={`p-4 rounded-md mb-4 ${
                prorationPreview.amountDue > 0
                  ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800'
                  : prorationPreview.amountDue < 0
                  ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800'
                  : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {prorationPreview.amountDue > 0 ? 'Amount Due' : prorationPreview.amountDue < 0 ? 'Credit to Wallet' : 'No charge'}
                  </span>
                  <span className={`text-xl font-bold ${
                    prorationPreview.amountDue > 0 ? 'text-blue-700 dark:text-blue-400' : prorationPreview.amountDue < 0 ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'
                  }`}>
                    {prorationPreview.amountDue === 0
                      ? formatCurrencyWithSymbol(0, walletCurrency)
                      : formatCurrencyWithSymbol(Math.abs(prorationPreview.amountDue), walletCurrency)
                    }
                  </span>
                </div>

                {/* Payment source info */}
                {prorationPreview.amountDue > 0 && (
                  <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800 space-y-1">
                    {prorationPreview.walletBalance >= prorationPreview.amountDue ? (
                      <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
                        <Wallet className="w-4 h-4" />
                        <span>Will be paid from wallet (balance: {formatCurrencyWithSymbol(prorationPreview.walletBalance, walletCurrency)})</span>
                      </div>
                    ) : prorationPreview.walletBalance > 0 ? (
                      <>
                        <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
                          <Wallet className="w-4 h-4" />
                          <span>{formatCurrencyWithSymbol(prorationPreview.walletBalance, walletCurrency)} from wallet</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
                          <CreditCard className="w-4 h-4" />
                          <span>{formatCurrencyWithSymbol(prorationPreview.amountDue - prorationPreview.walletBalance, walletCurrency)} via PayHere</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
                        <CreditCard className="w-4 h-4" />
                        <span>Will be charged via PayHere</span>
                      </div>
                    )}
                  </div>
                )}

                {prorationPreview.amountDue < 0 && (
                  <p className="text-sm text-green-700 dark:text-green-400 mt-2">
                    The prorated credit will be added to your wallet balance.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowProrationModal(false)
                    setProrationPreview(null)
                    setSelectedTierId(null)
                  }}
                  disabled={updating}
                  className="flex-1 py-3 px-4 rounded-md font-medium border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteChange}
                  disabled={updating}
                  className={`flex-1 py-3 px-4 rounded-md font-medium transition-all disabled:opacity-50 ${
                    prorationPreview.isUpgrade
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  {updating ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </span>
                  ) : prorationPreview.amountDue > 0 && prorationPreview.walletBalance < prorationPreview.amountDue ? (
                    `Pay ${formatCurrencyWithSymbol(prorationPreview.amountDue > prorationPreview.walletBalance ? prorationPreview.amountDue - prorationPreview.walletBalance : prorationPreview.amountDue, walletCurrency)}`
                  ) : (
                    `Confirm ${prorationPreview.isUpgrade ? 'Upgrade' : 'Downgrade'}`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

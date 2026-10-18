'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Loader2,
  Plus,
  CheckCircle,
  Clock,
  XCircle,
  Building2,
  Banknote,
  Calendar,
  FileText,
  AlertCircle,
  Wallet,
  ArrowUpRight,
  CreditCard
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'
import { PageSkeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'

interface BankDetails {
  bankName: string
  accountNumber: string
  accountName: string
  branchName: string
  notes?: string
}

interface Subscription {
  id: string
  status: string
  tenant: {
    id: string
    name: string
    slug: string
  } | null
  tier: {
    id: string
    name: string
    displayName: string
    priceMonthly: string
    priceYearly: string
    currency: string
  } | null
}

interface Payment {
  id: string
  amount: string
  currency: string
  bankReference: string | null
  depositDate: string
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewNotes: string | null
  periodMonths: number
  isWalletDeposit: boolean
  createdAt: string
  subscription: {
    tenant: {
      name: string
    } | null
    tier: {
      displayName: string
    } | null
  } | null
}

interface WalletInfo {
  balance: number
  currency: string
}

interface PendingCompany {
  id: string
  name: string
  slug: string
  businessType: string
  status: string
  expiresAt: string
  tier: {
    id: string
    name: string
    displayName: string
    priceMonthly: number
    priceYearly: number
    currency: string
  }
  billingCycle: string
}


function PaymentsContent() {
  const searchParams = useSearchParams()
  const isWalletDeposit = searchParams.get('type') === 'wallet'
  const pendingCompanyId = searchParams.get('pendingCompany')

  const [payments, setPayments] = useState<Payment[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null)
  const [wallet, setWallet] = useState<WalletInfo>({ balance: 0, currency: 'LKR' })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(isWalletDeposit || !!pendingCompanyId)
  const [submitting, setSubmitting] = useState(false)
  const [depositType, setDepositType] = useState<'subscription' | 'wallet' | 'pending_company'>(
    pendingCompanyId ? 'pending_company' : isWalletDeposit ? 'wallet' : 'subscription'
  )
  const [pendingCompany, setPendingCompany] = useState<PendingCompany | null>(null)

  const [formData, setFormData] = useState({
    subscriptionId: '',
    amount: '',
    bankReference: '',
    depositDate: new Date().toISOString().split('T')[0],
    notes: '',
    periodMonths: 1,
  })

  const fetchPayments = useCallback(async () => {
    try {
      const res = await fetch('/api/account/payments')
      if (res.ok) {
        const data = await res.json()
        setPayments(data)
      }
    } catch (error) {
      console.error('Failed to fetch payments:', error)
    }
  }, [])

  const fetchSubscriptions = useCallback(async () => {
    try {
      const res = await fetch('/api/account/subscriptions')
      if (res.ok) {
        const data = await res.json()
        setSubscriptions(data)
      }
    } catch (error) {
      console.error('Failed to fetch subscriptions:', error)
    }
  }, [])

  const fetchBankDetails = useCallback(async () => {
    try {
      const res = await fetch('/api/account/bank-details')
      if (res.ok) {
        const data = await res.json()
        if (data.value) {
          setBankDetails(data.value)
        }
      }
    } catch (error) {
      console.error('Failed to fetch bank details:', error)
    }
  }, [])

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/account/wallet')
      if (res.ok) {
        const data = await res.json()
        setWallet({ balance: data.balance || 0, currency: data.currency || 'LKR' })
      }
    } catch (error) {
      console.error('Failed to fetch wallet:', error)
    }
  }, [])

  const fetchPendingCompany = useCallback(async () => {
    if (!pendingCompanyId) return
    try {
      const res = await fetch(`/api/account/pending-companies/${pendingCompanyId}`)
      if (res.ok) {
        const data = await res.json()
        setPendingCompany(data)

        // Calculate amount directly in LKR
        const price = data.billingCycle === 'yearly'
          ? data.tier.priceYearly || data.tier.priceMonthly * 12 * 0.83
          : data.tier.priceMonthly

        setFormData(prev => ({
          ...prev,
          amount: String(Math.round(price * 100) / 100),
          periodMonths: data.billingCycle === 'yearly' ? 12 : 1,
        }))
      }
    } catch (error) {
      console.error('Failed to fetch pending company:', error)
    }
  }, [pendingCompanyId])

  useEffect(() => {
    Promise.all([fetchPayments(), fetchSubscriptions(), fetchBankDetails(), fetchWallet()]).finally(() => {
      setLoading(false)
    })
  }, [fetchPayments, fetchSubscriptions, fetchBankDetails, fetchWallet])

  useEffect(() => {
    if (pendingCompanyId && !loading) {
      fetchPendingCompany()
    }
  }, [pendingCompanyId, loading, fetchPendingCompany])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      let payload: Record<string, unknown>

      if (depositType === 'wallet') {
        payload = {
          amount: formData.amount,
          bankReference: formData.bankReference,
          depositDate: formData.depositDate,
          notes: formData.notes,
          isWalletDeposit: true,
        }
      } else if (depositType === 'pending_company' && pendingCompany) {
        payload = {
          amount: formData.amount,
          bankReference: formData.bankReference,
          depositDate: formData.depositDate,
          notes: formData.notes,
          pendingCompanyId: pendingCompany.id,
          periodMonths: pendingCompany.billingCycle === 'yearly' ? 12 : 1,
          isWalletDeposit: false,
        }
      } else {
        payload = {
          subscriptionId: formData.subscriptionId,
          amount: formData.amount,
          bankReference: formData.bankReference,
          depositDate: formData.depositDate,
          notes: formData.notes,
          periodMonths: formData.periodMonths,
          isWalletDeposit: false,
        }
      }

      const res = await fetch('/api/account/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        toast.success('Payment submitted successfully. It will be reviewed shortly.')
        setShowForm(false)
        setFormData({
          subscriptionId: '',
          amount: '',
          bankReference: '',
          depositDate: new Date().toISOString().split('T')[0],
          notes: '',
          periodMonths: 1,
        })
        setDepositType('subscription')
        setPendingCompany(null)
        fetchPayments()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to submit payment')
      }
    } catch (error) {
      console.error('Failed to submit payment:', error)
      toast.error('Failed to submit payment')
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
            <CheckCircle className="w-3.5 h-3.5" />
            Approved
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
            <Clock className="w-3.5 h-3.5" />
            Under Review
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full">
            <XCircle className="w-3.5 h-3.5" />
            Rejected
          </span>
        )
      default:
        return null
    }
  }

  const selectedSubscription = subscriptions.find(s => s.id === formData.subscriptionId)
  const monthlyPrice = selectedSubscription?.tier?.priceMonthly
    ? Number(selectedSubscription.tier.priceMonthly)
    : 0

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Submit bank deposits and track payments</p>
        </div>
        <PageSkeleton layout="list" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Submit bank deposit receipts for subscription payments or wallet credits
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors font-medium"
        >
          <Plus className="w-4 h-4" />
          Submit Payment
        </button>
      </div>

      {/* Bank Details Card - LKR domestic, no SWIFT */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl border border-blue-200 dark:border-blue-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-blue-200 dark:border-blue-800 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-md flex items-center justify-center">
            <Banknote className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100">Bank Transfer Details</h2>
            <p className="text-sm text-blue-700 dark:text-blue-300">Transfer to this account and submit your receipt</p>
          </div>
        </div>
        <div className="p-6">
          {bankDetails ? (
            <>
              <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
                <div className="bg-white/60 dark:bg-gray-800/60 rounded-md p-4">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Bank Name</p>
                  <p className="text-lg text-blue-900 dark:text-blue-100 font-semibold">{bankDetails.bankName}</p>
                </div>
                <div className="bg-white/60 dark:bg-gray-800/60 rounded-md p-4">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Account Number</p>
                  <p className="text-lg text-blue-900 dark:text-blue-100 font-mono font-semibold">{bankDetails.accountNumber}</p>
                </div>
                <div className="bg-white/60 dark:bg-gray-800/60 rounded-md p-4">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Account Name</p>
                  <p className="text-lg text-blue-900 dark:text-blue-100 font-semibold">{bankDetails.accountName}</p>
                </div>
                <div className="bg-white/60 dark:bg-gray-800/60 rounded-md p-4">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Branch</p>
                  <p className="text-lg text-blue-900 dark:text-blue-100 font-semibold">{bankDetails.branchName}</p>
                </div>
              </div>
              {bankDetails.notes && (
                <p className="text-sm mt-4 text-blue-700 dark:text-blue-300 bg-blue-100/50 dark:bg-blue-900/30 p-3 rounded-md">
                  {bankDetails.notes}
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-6 text-blue-700 dark:text-blue-300">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-blue-400 dark:text-blue-500" />
              <p>Bank details not configured yet. Please contact support.</p>
            </div>
          )}
        </div>
      </div>

      {/* Submit Payment Form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-md flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Submit Payment Details</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Fill in the details of your bank deposit</p>
            </div>
          </div>
          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Deposit Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Payment Type
                </label>
                {pendingCompany && (
                  <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      <span className="font-semibold text-blue-900 dark:text-blue-100">New Business: {pendingCompany.name}</span>
                    </div>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
                      Plan: {pendingCompany.tier.displayName} ({pendingCompany.billingCycle})
                    </p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">
                      Submit your bank deposit to activate this business.
                    </p>
                  </div>
                )}
                <div className={`grid gap-4 ${pendingCompany ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {pendingCompany ? (
                    <button
                      type="button"
                      onClick={() => setDepositType('pending_company')}
                      className={`flex items-center gap-4 p-5 rounded-md border-2 transition-all ${
                        depositType === 'pending_company'
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      <Building2 className={`w-6 h-6 ${depositType === 'pending_company' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`} />
                      <div className="text-left">
                        <p className="font-semibold text-gray-900 dark:text-white">Payment for {pendingCompany.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {pendingCompany.tier.displayName} - {pendingCompany.billingCycle === 'yearly' ? 'Annual' : 'Monthly'} plan
                        </p>
                      </div>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setDepositType('subscription')}
                        className={`flex items-center gap-4 p-5 rounded-md border-2 transition-all ${
                          depositType === 'subscription'
                            ? 'border-gray-900 dark:border-gray-100 bg-gray-50 dark:bg-gray-700'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                      >
                        <Building2 className={`w-6 h-6 ${depositType === 'subscription' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`} />
                        <div className="text-left">
                          <p className="font-semibold text-gray-900 dark:text-white">Subscription Payment</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Pay for a specific subscription</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDepositType('wallet')}
                        className={`flex items-center gap-4 p-5 rounded-md border-2 transition-all ${
                          depositType === 'wallet'
                            ? 'border-gray-900 dark:border-gray-100 bg-gray-50 dark:bg-gray-700'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                      >
                        <Wallet className={`w-6 h-6 ${depositType === 'wallet' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`} />
                        <div className="text-left">
                          <p className="font-semibold text-gray-900 dark:text-white">Wallet Credit</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Add funds to your wallet</p>
                        </div>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:gap-5 md:grid-cols-2">
                {depositType === 'subscription' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Company / Subscription
                      </label>
                      <select
                        value={formData.subscriptionId}
                        onChange={(e) => {
                          const sub = subscriptions.find(s => s.id === e.target.value)
                          const price = sub?.tier?.priceMonthly ? Number(sub.tier.priceMonthly) : 0
                          setFormData({
                            ...formData,
                            subscriptionId: e.target.value,
                            amount: String(Math.round(price * formData.periodMonths * 100) / 100),
                          })
                        }}
                        required
                        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-gray-900 dark:focus:border-gray-100 bg-white dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">Select a subscription</option>
                        {subscriptions.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.tenant?.name || 'Unknown'} - {sub.tier?.displayName || sub.tier?.name || 'N/A'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Period (Months)
                      </label>
                      <select
                        value={formData.periodMonths}
                        onChange={(e) => {
                          const months = Number(e.target.value)
                          setFormData({
                            ...formData,
                            periodMonths: months,
                            amount: String(Math.round(monthlyPrice * months * 100) / 100),
                          })
                        }}
                        required
                        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-gray-900 dark:focus:border-gray-100 bg-white dark:bg-gray-700 dark:text-white"
                      >
                        <option value={1}>1 Month</option>
                        <option value={3}>3 Months</option>
                        <option value={6}>6 Months</option>
                        <option value={12}>12 Months (1 Year)</option>
                      </select>
                    </div>
                  </>
                )}

                <div className={depositType === 'wallet' ? 'md:col-span-1' : ''}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Amount
                  </label>
                  <input
                    type="number"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-gray-900 dark:focus:border-gray-100 dark:bg-gray-700 dark:text-white"
                  />
                  {depositType === 'subscription' && monthlyPrice > 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Expected: {formatCurrencyWithSymbol(monthlyPrice * formData.periodMonths, selectedSubscription?.tier?.currency || wallet.currency)}
                    </p>
                  )}
                  {depositType === 'wallet' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Current wallet balance: {formatCurrencyWithSymbol(wallet.balance, wallet.currency)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Bank Reference / Receipt No.
                  </label>
                  <input
                    type="text"
                    value={formData.bankReference}
                    onChange={(e) => setFormData({ ...formData, bankReference: e.target.value })}
                    placeholder="e.g., TXN123456789"
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-gray-900 dark:focus:border-gray-100 dark:bg-gray-700 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Deposit Date
                  </label>
                  <input
                    type="date"
                    value={formData.depositDate}
                    onChange={(e) => setFormData({ ...formData, depositDate: e.target.value })}
                    required
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-gray-900 dark:focus:border-gray-100 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  placeholder="Any additional information about the payment..."
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-gray-900 dark:focus:border-gray-100 dark:bg-gray-700 dark:text-white resize-none"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setDepositType('subscription')
                  }}
                  className="px-5 py-2.5 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-50 font-medium"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-4 h-4" />
                      Submit Payment
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment History */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center">
            <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Payment History</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{payments.length} payment{payments.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        {payments.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-300 dark:text-gray-500" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No payment submissions yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Submit your first bank deposit to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="px-6 py-5 flex items-start justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-md flex items-center justify-center ${
                    payment.isWalletDeposit ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'
                  }`}>
                    {payment.isWalletDeposit ? (
                      <Wallet className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Building2 className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {payment.isWalletDeposit
                        ? 'Wallet Credit Deposit'
                        : payment.subscription?.tenant?.name || 'Unknown Company'}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {payment.isWalletDeposit
                        ? 'Adding funds to wallet'
                        : `${payment.subscription?.tier?.displayName || 'Subscription'} - ${payment.periodMonths} month${payment.periodMonths > 1 ? 's' : ''}`}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        {new Date(payment.depositDate).toLocaleDateString()}
                      </span>
                      {payment.bankReference && (
                        <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2.5 py-1 rounded">
                          {payment.bankReference}
                        </span>
                      )}
                    </div>
                    {payment.status === 'rejected' && payment.reviewNotes && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-2 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded">
                        Rejection reason: {payment.reviewNotes}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatCurrencyWithSymbol(Number(payment.amount), payment.currency)}
                  </p>
                  <div className="mt-2">
                    {getStatusBadge(payment.status)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Submit bank deposits and track payments</p>
        </div>
        <PageSkeleton layout="list" />
      </div>
    }>
      <PaymentsContent />
    </Suspense>
  )
}

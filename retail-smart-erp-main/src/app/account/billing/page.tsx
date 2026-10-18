'use client'

import { useState, useCallback } from 'react'
import { useRealtimeData } from '@/hooks'
import {
  CreditCard,
  Building2,
  TrendingDown,
  Receipt,
  AlertCircle,
  Sparkles,
  Download,
  Calendar,
  Database,
  HardDrive,
  Clock,
} from 'lucide-react'
import Link from 'next/link'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface BillingData {
  summary: {
    companyCount: number
    discountPercent: number
    subtotal: number
    discount: number
    total: number
    currency: string
  }
  lineItems: Array<{
    tenantId: string
    tenantName: string
    tierName: string
    priceMonthly: number
    tierCurrency: string
    status: string
    trialEndsAt: string | null
    dbUsed?: number
    dbLimit?: number | null
    fileUsed?: number
    fileLimit?: number | null
  }>
  discountTiers: Array<{
    minCompanies: number
    discount: number
  }>
  recentInvoices: Array<{
    id: string
    invoiceNumber: string
    periodStart: string
    periodEnd: string
    subtotal: string
    volumeDiscount: string
    total: string
    status: string
    paidAt: string | null
  }>
  userCurrency: string
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}


export default function BillingPage() {
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchBilling = useCallback(async () => {
    try {
      const res = await fetch('/api/account/billing')
      if (res.ok) {
        const data = await res.json()
        setBilling(data)
      }
    } catch (error) {
      console.error('Failed to fetch billing:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Real-time updates via WebSocket
  useRealtimeData(fetchBilling, { entityType: ['account-billing', 'account-subscription'] })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
      </div>
    )
  }

  if (!billing) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <AlertCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-gray-500 dark:text-gray-400">Unable to load billing information</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Billing & Subscriptions</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your subscriptions and view billing history
          </p>
        </div>
        <Link
          href="/account/plans"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-700 text-white text-sm font-medium rounded-md hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Upgrade Plan
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Monthly Subtotal */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Monthly Subtotal</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {formatCurrencyWithSymbol(billing.summary.subtotal, billing.summary.currency)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {billing.summary.companyCount} active {billing.summary.companyCount === 1 ? 'company' : 'companies'}
          </p>
        </div>

        {/* Volume Discount */}
        <div className={`rounded-2xl border p-6 transition-all ${
          billing.summary.discountPercent > 0
            ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-green-200 dark:border-green-700 hover:shadow-lg hover:border-green-300 dark:hover:border-green-600'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-md flex items-center justify-center ${
              billing.summary.discountPercent > 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <TrendingDown className={`w-5 h-5 ${
                billing.summary.discountPercent > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
              }`} />
            </div>
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Volume Discount</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {billing.summary.discountPercent > 0 ? `${billing.summary.discountPercent}%` : '0%'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {billing.summary.discountPercent > 0
              ? `Saving ${formatCurrencyWithSymbol(billing.summary.discount, billing.summary.currency)}/month`
              : 'Add more companies to unlock discounts'}
          </p>
        </div>

        {/* Monthly Total */}
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white hover:shadow-lg transition-all">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/10 rounded-md flex items-center justify-center">
              <Receipt className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-medium text-gray-300">Monthly Total</span>
          </div>
          <p className="text-3xl font-bold">
            {formatCurrencyWithSymbol(billing.summary.total, billing.summary.currency)}
          </p>
          <p className="text-sm text-gray-400 mt-2">
            After discounts
          </p>
        </div>
      </div>

      {/* Volume Discount Tiers */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Volume Discounts</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Save more by managing multiple companies</p>
          </div>
        </div>
        <div className="p-6">
          <div className="flex flex-wrap gap-4">
            {billing.discountTiers.map((tier, i) => (
              <div
                key={i}
                className={`flex-1 min-w-[160px] p-5 rounded-md border-2 transition-all ${
                  billing.summary.companyCount >= tier.minCompanies
                    ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-green-300 dark:border-green-700'
                    : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{tier.discount}% off</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {tier.minCompanies}+ companies
                </div>
                {billing.summary.companyCount >= tier.minCompanies && (
                  <div className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium mt-2 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                    Active
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Subscriptions with Mini Storage Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
            <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Active Subscriptions</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{billing.lineItems.length} total subscriptions</p>
          </div>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {billing.lineItems.map((item) => {
            const dbPercent = item.dbLimit ? Math.min((item.dbUsed || 0) / item.dbLimit * 100, 100) : 0
            const filePercent = item.fileLimit ? Math.min((item.fileUsed || 0) / item.fileLimit * 100, 100) : 0

            return (
              <div
                key={item.tenantId}
                className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{item.tenantName}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                        {item.tierName}
                        {item.status === 'trial' && (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full">
                            Free Plan
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {item.status === 'trial' ? 'Free' : formatCurrencyWithSymbol(item.priceMonthly, item.tierCurrency)}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">/month</div>
                  </div>
                </div>
                {/* Mini storage bars */}
                {(item.dbLimit || item.fileLimit) && (
                  <div className="flex gap-4 ml-14">
                    {item.dbLimit && (
                      <div className="flex items-center gap-2 flex-1">
                        <Database className="w-3 h-3 text-purple-400 dark:text-purple-300" />
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full flex-1">
                          <div
                            className={`h-full rounded-full ${dbPercent >= 90 ? 'bg-red-500' : dbPercent >= 80 ? 'bg-yellow-500' : 'bg-purple-500'}`}
                            style={{ width: `${dbPercent}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{Math.round(dbPercent)}%</span>
                      </div>
                    )}
                    {item.fileLimit && (
                      <div className="flex items-center gap-2 flex-1">
                        <HardDrive className="w-3 h-3 text-green-400 dark:text-green-300" />
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full flex-1">
                          <div
                            className={`h-full rounded-full ${filePercent >= 90 ? 'bg-red-500' : filePercent >= 80 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${filePercent}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{Math.round(filePercent)}%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Next Payment Due Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border border-blue-200 dark:border-blue-700 rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center flex-shrink-0">
            <Clock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Next Payment Due</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {billing.summary.total > 0
                ? `${formatCurrencyWithSymbol(billing.summary.total, billing.summary.currency)} due at the start of your next billing period`
                : 'No active paid subscriptions'}
            </p>
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-md flex items-center justify-center">
            <Receipt className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Invoices</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Your billing history</p>
          </div>
        </div>
        {billing.recentInvoices.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Receipt className="w-8 h-8 text-gray-300 dark:text-gray-600" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No invoices yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Your invoices will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Invoice</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Period</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Amount</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                  <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {billing.recentInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900 dark:text-white">{invoice.invoiceNumber}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Calendar className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                        {formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {formatCurrencyWithSymbol(parseFloat(invoice.total), billing.summary.currency)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${
                          invoice.status === 'paid'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : invoice.status === 'pending'
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

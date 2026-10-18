'use client'

import { useState, useCallback } from 'react'
import { useRealtimeData } from '@/hooks'
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Loader2,
  Zap,
  Banknote,
  CreditCard,
  AlertCircle,
  TrendingUp,
  Sparkles
} from 'lucide-react'
import Link from 'next/link'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface Transaction {
  id: string
  type: 'credit' | 'debit'
  amount: number
  description: string
  createdAt: string
  balanceAfter: number
}

export default function WalletPage() {
  const [balance, setBalance] = useState(0)
  const [currency, setCurrency] = useState('LKR')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/account/wallet')
      if (res.ok) {
        const data = await res.json()
        setBalance(data.balance || 0)
        setCurrency(data.currency || 'LKR')
        setTransactions(data.transactions || [])
      }
    } catch (error) {
      console.error('Failed to fetch wallet:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Real-time updates via WebSocket
  useRealtimeData(fetchWallet, { entityType: 'account-wallet' })

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatTime = (date: string) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Wallet</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your credits and view transaction history</p>
      </div>

      {/* Balance Card */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-3xl p-8 text-white relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"></div>

        <div className="relative flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-gray-400 text-sm font-medium mb-2">
              <Wallet className="w-4 h-4" />
              Available Balance
            </div>
            <p className="text-5xl font-bold tracking-tight">
              {formatCurrencyWithSymbol(balance, currency)}
            </p>
            <p className="text-gray-400 text-sm mt-3">
              Credits are used for subscriptions and services
            </p>
          </div>
          <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
            <Sparkles className="w-8 h-8" />
          </div>
        </div>

        {/* Quick Stats */}
        <div className="relative grid grid-cols-2 gap-4 mt-8 pt-6 border-t border-white/10">
          <div>
            <div className="text-gray-400 text-sm">This Month</div>
            <div className="text-xl font-semibold flex items-center gap-2 mt-1">
              {formatCurrencyWithSymbol(0, currency)}
              <TrendingUp className="w-4 h-4 text-green-400" />
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-sm">Total Transactions</div>
            <div className="text-xl font-semibold mt-1">{transactions.length}</div>
          </div>
        </div>
      </div>

      {/* Add Credits Section */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-md flex items-center justify-center">
            <Zap className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add Credits</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Choose your preferred payment method</p>
          </div>
        </div>

        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Bank Deposit Option */}
            <div className="group border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-6 hover:border-gray-900 dark:hover:border-gray-400 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                  <Banknote className="w-7 h-7 text-blue-600 dark:text-blue-400 group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Bank Deposit</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Transfer funds to our bank account and submit your receipt for verification
                  </p>
                  <Link
                    href="/account/payments?type=wallet"
                    className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
                  >
                    <Banknote className="w-4 h-4" />
                    Make Bank Deposit
                    <ArrowUpRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Payment Gateway Option (Coming Soon) */}
            <div className="border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-6 bg-gray-50 dark:bg-gray-700 opacity-75">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-gray-200 dark:bg-gray-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-7 h-7 text-gray-400 dark:text-gray-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Card Payment</h3>
                    <span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold rounded-full">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Pay instantly with credit/debit card via secure payment gateway
                  </p>
                  <button
                    disabled
                    className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 rounded-md text-sm font-medium cursor-not-allowed"
                  >
                    <CreditCard className="w-4 h-4" />
                    Pay with Card
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Info Note */}
          <div className="mt-6 flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-md border border-blue-100 dark:border-blue-800">
            <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p className="font-semibold">How it works</p>
              <p className="mt-1">
                Credits added to your wallet can be used to pay for subscriptions. When your subscription renews,
                the amount will be deducted from your wallet balance. If your wallet doesn&apos;t have enough funds,
                you&apos;ll need to add more credits.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center">
              <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Transaction History</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{transactions.length} transactions</p>
            </div>
          </div>
        </div>

        {transactions.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-gray-300 dark:text-gray-500" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No transactions yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Add credits to get started
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.map((tx) => (
              <div key={tx.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-md flex items-center justify-center ${
                      tx.type === 'credit' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
                    }`}
                  >
                    {tx.type === 'credit' ? (
                      <ArrowDownRight className="w-6 h-6 text-green-600 dark:text-green-400" />
                    ) : (
                      <ArrowUpRight className="w-6 h-6 text-red-600 dark:text-red-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{tx.description}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(tx.createdAt)} at {formatTime(tx.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={`text-lg font-semibold ${
                      tx.type === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {tx.type === 'credit' ? '+' : '-'}
                    {formatCurrencyWithSymbol(Math.abs(tx.amount), currency)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Balance: {formatCurrencyWithSymbol(tx.balanceAfter, currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

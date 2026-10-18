'use client'

import { useState, useEffect, useCallback } from 'react'
import { Check, X, Eye, Loader2, Clock, CheckCircle, XCircle, FileText, Zap, Building2 } from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface Payment {
  id: string
  accountId: string
  amount: string
  currency: string
  bankReference: string | null
  depositDate: string
  receiptUrl: string | null
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  periodMonths: number
  reviewNotes: string | null
  createdAt: string
  account: {
    id: string
    email: string
    fullName: string
  } | null
  subscription: {
    id: string
    tenantId: string
    status: string
    tier?: {
      priceMonthly: string
      displayName: string
    }
    tenant?: {
      name: string
      slug: string
    }
  } | null
}

interface PayhereTransaction {
  id: string
  orderId: string
  payherePaymentId: string | null
  amount: string
  currency: string
  status: 'pending' | 'success' | 'failed' | 'cancelled' | 'refunded' | 'charged_back'
  paymentMethod: string | null
  description: string | null
  periodMonths: number | null
  billingCycle: string | null
  statusMessage: string | null
  paidAt: string | null
  createdAt: string
  account: {
    id: string
    email: string
    fullName: string
  } | null
  subscription: {
    id: string
    tenant: { name: string; slug: string } | null
    tier: { displayName: string } | null
  } | null
}


type Tab = 'bank_deposits' | 'payhere'

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('bank_deposits')
  const [payments, setPayments] = useState<Payment[]>([])
  const [payhereTransactions, setPayhereTransactions] = useState<PayhereTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [phFilter, setPhFilter] = useState<'all' | 'pending' | 'success' | 'failed' | 'cancelled'>('all')
  const [processing, setProcessing] = useState<string | null>(null)
  const [viewingPayment, setViewingPayment] = useState<Payment | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sys-control/payments?status=${filter}`)
      if (res.ok) {
        const data = await res.json()
        setPayments(data)
      }
    } catch (error) {
      console.error('Failed to fetch payments:', error)
    } finally {
      setLoading(false)
    }
  }, [filter])

  const fetchPayhereTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sys-control/payhere-transactions?status=${phFilter}`)
      if (res.ok) {
        const data = await res.json()
        setPayhereTransactions(data)
      }
    } catch (error) {
      console.error('Failed to fetch PayHere transactions:', error)
    } finally {
      setLoading(false)
    }
  }, [phFilter])

  useEffect(() => {
    if (activeTab === 'bank_deposits') {
      fetchPayments()
    } else {
      fetchPayhereTransactions()
    }
  }, [activeTab, fetchPayments, fetchPayhereTransactions])

  const handleAction = async (paymentId: string, action: 'approve' | 'reject') => {
    setProcessing(paymentId)
    try {
      const res = await fetch(`/api/sys-control/payments/${paymentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewNotes,
        }),
      })

      if (res.ok) {
        fetchPayments()
        setReviewNotes('')
        setViewingPayment(null)
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to update payment')
      }
    } catch (error) {
      console.error('Failed to update payment:', error)
      alert('Failed to update payment')
    } finally {
      setProcessing(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        )
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
            <CheckCircle className="w-3 h-3" />
            Approved
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
            <XCircle className="w-3 h-3" />
            Rejected
          </span>
        )
      default:
        return null
    }
  }

  // Quick stats
  const pendingCount = payments.filter(p => p.status === 'pending').length
  const pendingTotal = payments
    .filter(p => p.status === 'pending')
    .reduce((sum, p) => sum + Number(p.amount), 0)

  const getPhStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full"><Clock className="w-3 h-3" />Pending</span>
      case 'success':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full"><CheckCircle className="w-3 h-3" />Success</span>
      case 'failed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full"><XCircle className="w-3 h-3" />Failed</span>
      case 'cancelled':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full"><X className="w-3 h-3" />Cancelled</span>
      case 'refunded':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">Refunded</span>
      case 'charged_back':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Charged Back</span>
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Review PayHere transactions and bank deposit payments</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded p-1 w-fit">
        <button
          onClick={() => setActiveTab('bank_deposits')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'bank_deposits'
              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Bank Deposits
        </button>
        <button
          onClick={() => setActiveTab('payhere')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'payhere'
              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          <Zap className="w-4 h-4" />
          PayHere Transactions
        </button>
      </div>

      {activeTab === 'bank_deposits' && (
        <>
          {/* Quick Stats */}
          {filter === 'pending' && pendingCount > 0 && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-orange-600" />
                <span className="font-medium text-orange-900 dark:text-orange-300">
                  {pendingCount} pending payment{pendingCount !== 1 ? 's' : ''} totaling{' '}
                  <strong>{formatCurrencyWithSymbol(pendingTotal, 'USD')}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-2">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  filter === status
                    ? 'bg-gray-900 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          {/* Bank Deposits Table */}
          <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                No {filter !== 'all' ? filter : ''} payments found
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">User</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Company</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Amount</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Expected</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Period</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Reference</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {payments.map((payment) => {
                    const expectedAmount = payment.subscription?.tier?.priceMonthly
                      ? Number(payment.subscription.tier.priceMonthly) * payment.periodMonths
                      : null
                    const amountMatches = expectedAmount !== null && Math.abs(Number(payment.amount) - expectedAmount) < 1

                    return (
                      <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{payment.account?.fullName}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{payment.account?.email}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-gray-900 dark:text-white">{payment.subscription?.tenant?.name || '-'}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{payment.subscription?.tier?.displayName || ''}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-semibold text-gray-900 dark:text-white">{formatCurrencyWithSymbol(Number(payment.amount), payment.currency)}</p>
                        </td>
                        <td className="px-6 py-4">
                          {expectedAmount !== null ? (
                            <div>
                              <p className={`text-sm font-medium ${amountMatches ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrencyWithSymbol(expectedAmount, payment.currency)}
                              </p>
                              {!amountMatches && <p className="text-xs text-red-500">Mismatch</p>}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">N/A</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-600 dark:text-gray-400">{payment.periodMonths} month(s)</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-600 dark:text-gray-400 font-mono text-sm">{payment.bankReference || '-'}</p>
                        </td>
                        <td className="px-6 py-4">{getStatusBadge(payment.status)}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setViewingPayment(payment)}
                              className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                              title="View Details"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                            {payment.receiptUrl && (
                              <button
                                onClick={() => window.open(payment.receiptUrl!, '_blank')}
                                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                title="View Receipt"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            {payment.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleAction(payment.id, 'approve')}
                                  disabled={processing === payment.id}
                                  className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded disabled:opacity-50"
                                  title="Approve"
                                >
                                  {processing === payment.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => handleAction(payment.id, 'reject')}
                                  disabled={processing === payment.id}
                                  className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded disabled:opacity-50"
                                  title="Reject"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Payment Detail Modal */}
          {viewingPayment && (
            <div
              className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50"
              onClick={() => setViewingPayment(null)}
            >
              <div
                className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Payment Details</h3>
                  <button onClick={() => setViewingPayment(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Customer</p>
                      <p className="font-medium text-gray-900 dark:text-white">{viewingPayment.account?.fullName}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{viewingPayment.account?.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Company</p>
                      <p className="font-medium text-gray-900 dark:text-white">{viewingPayment.subscription?.tenant?.name || '-'}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{viewingPayment.subscription?.tier?.displayName || ''}</p>
                    </div>
                  </div>

                  <hr className="dark:border-gray-700" />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Amount Paid</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrencyWithSymbol(Number(viewingPayment.amount), viewingPayment.currency)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Expected Amount</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">
                        {viewingPayment.subscription?.tier?.priceMonthly
                          ? formatCurrencyWithSymbol(Number(viewingPayment.subscription.tier.priceMonthly) * viewingPayment.periodMonths, viewingPayment.currency)
                          : 'N/A'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Period</p>
                      <p className="font-medium text-gray-900 dark:text-white">{viewingPayment.periodMonths} month(s)</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Bank Reference</p>
                      <p className="font-medium text-gray-900 dark:text-white font-mono">{viewingPayment.bankReference || '-'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Deposit Date</p>
                      <p className="font-medium text-gray-900 dark:text-white">{new Date(viewingPayment.depositDate).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Submitted</p>
                      <p className="font-medium text-gray-900 dark:text-white">{new Date(viewingPayment.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {viewingPayment.notes && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Customer Notes</p>
                      <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 rounded p-3 text-sm">{viewingPayment.notes}</p>
                    </div>
                  )}

                  {viewingPayment.receiptUrl && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Receipt</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={viewingPayment.receiptUrl} alt="Payment Receipt" className="max-w-full rounded border" />
                    </div>
                  )}

                  {viewingPayment.reviewNotes && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Review Notes</p>
                      <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 rounded p-3 text-sm">{viewingPayment.reviewNotes}</p>
                    </div>
                  )}

                  {viewingPayment.status === 'pending' && (
                    <>
                      <hr className="dark:border-gray-700" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Review Notes (optional)</label>
                        <textarea
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          placeholder="Add notes about this payment..."
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                          rows={3}
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleAction(viewingPayment.id, 'approve')}
                          disabled={processing === viewingPayment.id}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 font-medium"
                        >
                          {processing === viewingPayment.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          Approve
                        </button>
                        <button
                          onClick={() => handleAction(viewingPayment.id, 'reject')}
                          disabled={processing === viewingPayment.id}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium"
                        >
                          <X className="w-4 h-4" />
                          Reject
                        </button>
                      </div>
                    </>
                  )}

                  {viewingPayment.status !== 'pending' && (
                    <div className="flex justify-center pt-2">{getStatusBadge(viewingPayment.status)}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* PayHere Transactions Tab */}
      {activeTab === 'payhere' && (
        <>
          {/* Filters */}
          <div className="flex gap-2">
            {(['all', 'pending', 'success', 'failed', 'cancelled'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setPhFilter(status)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  phFilter === status
                    ? 'bg-gray-900 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          {/* PayHere Transactions Table */}
          <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            ) : payhereTransactions.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                No {phFilter !== 'all' ? phFilter : ''} PayHere transactions found
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Order ID</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">User</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Company</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Amount</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Method</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {payhereTransactions.map((tx) => {
                    const sub = Array.isArray(tx.subscription) ? tx.subscription[0] : tx.subscription
                    const account = Array.isArray(tx.account) ? tx.account[0] : tx.account
                    const tenant = sub?.tenant ? (Array.isArray(sub.tenant) ? sub.tenant[0] : sub.tenant) : null
                    const tier = sub?.tier ? (Array.isArray(sub.tier) ? sub.tier[0] : sub.tier) : null

                    return (
                      <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4">
                          <p className="font-mono text-sm text-gray-900 dark:text-white">{tx.orderId}</p>
                          {tx.payherePaymentId && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">PH: {tx.payherePaymentId}</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{account?.fullName || '-'}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{account?.email || ''}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-gray-900 dark:text-white">{tenant?.name || '-'}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{tier?.displayName || ''}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-semibold text-gray-900 dark:text-white">{formatCurrencyWithSymbol(Number(tx.amount), tx.currency)}</p>
                          {tx.billingCycle && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">{tx.billingCycle}</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-600 dark:text-gray-400 text-sm">{tx.paymentMethod || '-'}</p>
                        </td>
                        <td className="px-6 py-4">
                          {getPhStatusBadge(tx.status)}
                          {tx.statusMessage && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{tx.statusMessage}</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {tx.paidAt
                              ? new Date(tx.paidAt).toLocaleDateString()
                              : new Date(tx.createdAt).toLocaleDateString()
                            }
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {tx.paidAt
                              ? new Date(tx.paidAt).toLocaleTimeString()
                              : new Date(tx.createdAt).toLocaleTimeString()
                            }
                          </p>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

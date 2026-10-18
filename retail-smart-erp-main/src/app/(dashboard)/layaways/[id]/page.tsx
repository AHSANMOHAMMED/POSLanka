'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Calendar, CreditCard, User, Package, Receipt,
  Plus, CheckCircle, Ban, AlertTriangle, Banknote, Building2
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Modal } from '@/components/ui/modal'
import { AlertModal } from '@/components/ui/alert-modal'
import { CancellationReasonModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useCurrency } from '@/hooks/useCurrency'
import { formatItemLabel } from '@/lib/utils/item-display'

const paymentMethodLabels: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', credit: 'Credit', gift_card: 'Gift Card',
}

interface LayawayItem {
  id: string
  itemId: string | null
  itemName: string
  itemSku: string | null
  itemBarcode: string | null
  itemOemPartNumber: string | null
  itemPluCode: string | null
  quantity: string
  unitPrice: string
  total: string
}

interface LayawayPayment {
  id: string
  amount: string
  paymentMethod: string
  reference: string | null
  receivedByName: string | null
  createdAt: string
}

interface LayawayDetail {
  id: string
  layawayNo: string
  customerId: string
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  subtotal: string
  taxAmount: string
  total: string
  depositAmount: string
  paidAmount: string
  balanceDue: string
  status: 'active' | 'completed' | 'cancelled' | 'forfeited'
  dueDate: string | null
  notes: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string | null
  items: LayawayItem[]
  payments: LayawayPayment[]
}

const statusColors: Record<string, string> = {
  active: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  forfeited: 'bg-orange-100 text-orange-800',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  forfeited: 'Forfeited',
}

export default function LayawayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { currency: currencyCode } = useCurrency()
  const { tenantSlug, businessType } = useCompany()

  const [layaway, setLayaway] = useState<LayawayDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)

  // Modals
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showCompleteModal, setShowCompleteModal] = useState(false)
  const [showForfeitModal, setShowForfeitModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [alertModal, setAlertModal] = useState<{
    open: boolean
    title: string
    message: string
    variant: 'error' | 'success' | 'warning' | 'info'
  }>({ open: false, title: '', message: '', variant: 'info' })

  // Payment form
  const [paymentData, setPaymentData] = useState({
    amount: '',
    method: 'cash' as 'cash' | 'card' | 'bank_transfer',
    reference: '',
  })

  // Forfeit form
  const [forfeitData, setForfeitData] = useState({
    refundPercentage: 0,
    refundToCredit: true,
    reason: '',
  })

  const fetchLayaway = useCallback(async () => {
    try {
      const res = await fetch(`/api/layaways/${id}`)
      if (res.ok) {
        const data = await res.json()
        setLayaway(data)
      } else if (res.status === 404) {
        router.push(tenantSlug ? `/c/${tenantSlug}/layaways` : '/layaways')
      }
    } catch (error) {
      console.error('Error fetching layaway:', error)
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  useEffect(() => {
    fetchLayaway()
  }, [fetchLayaway])

  // Real-time updates
  useRealtimeData(fetchLayaway, { entityType: 'layaway' })

  async function handleAddPayment() {
    if (!layaway || !paymentData.amount) return

    const amount = parseFloat(paymentData.amount)
    if (amount <= 0) {
      setAlertModal({
        open: true,
        title: 'Invalid Amount',
        message: 'Please enter a valid payment amount',
        variant: 'warning',
      })
      return
    }

    const balanceDue = parseFloat(layaway.balanceDue)
    if (amount > balanceDue + 0.01) {
      setAlertModal({
        open: true,
        title: 'Amount Exceeds Balance',
        message: `Payment amount cannot exceed remaining balance of ${currencyCode} ${balanceDue.toFixed(2)}`,
        variant: 'warning',
      })
      return
    }

    setProcessing(true)
    try {
      const res = await fetch(`/api/layaways/${id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          paymentMethod: paymentData.method,
          reference: paymentData.reference || null,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setShowPaymentModal(false)
        setPaymentData({ amount: '', method: 'cash', reference: '' })
        setAlertModal({
          open: true,
          title: 'Payment Added',
          message: data.autoCompleted
            ? 'Payment recorded. Layaway is now fully paid and ready for completion.'
            : `Payment of ${currencyCode} ${amount.toFixed(2)} recorded successfully.`,
          variant: 'success',
        })
        fetchLayaway()
      } else {
        const error = await res.json()
        setAlertModal({
          open: true,
          title: 'Payment Failed',
          message: error.error || 'Failed to add payment',
          variant: 'error',
        })
      }
    } catch (error) {
      console.error('Error adding payment:', error)
      setAlertModal({
        open: true,
        title: 'Error',
        message: 'An error occurred while processing the payment',
        variant: 'error',
      })
    } finally {
      setProcessing(false)
    }
  }

  async function handleComplete() {
    if (!layaway) return

    setProcessing(true)
    try {
      const res = await fetch(`/api/layaways/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (res.ok) {
        const data = await res.json()
        setShowCompleteModal(false)
        setAlertModal({
          open: true,
          title: 'Layaway Completed',
          message: `Layaway has been completed and converted to sale ${data.sale.invoiceNo}`,
          variant: 'success',
        })
        fetchLayaway()
      } else {
        const error = await res.json()
        setAlertModal({
          open: true,
          title: 'Completion Failed',
          message: error.error || 'Failed to complete layaway',
          variant: 'error',
        })
      }
    } catch (error) {
      console.error('Error completing layaway:', error)
      setAlertModal({
        open: true,
        title: 'Error',
        message: 'An error occurred while completing the layaway',
        variant: 'error',
      })
    } finally {
      setProcessing(false)
    }
  }

  async function handleForfeit() {
    if (!layaway) return

    setProcessing(true)
    try {
      const res = await fetch(`/api/layaways/${id}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundPercentage: forfeitData.refundPercentage,
          refundToCredit: forfeitData.refundToCredit,
          reason: forfeitData.reason || null,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setShowForfeitModal(false)
        setForfeitData({ refundPercentage: 0, refundToCredit: true, reason: '' })
        setAlertModal({
          open: true,
          title: 'Layaway Forfeited',
          message: `Layaway forfeited. ${data.summary.refundProcessed ? `Refund of ${currencyCode} ${data.summary.refundAmount} added to customer credit.` : 'No refund processed.'}`,
          variant: 'success',
        })
        fetchLayaway()
      } else {
        const error = await res.json()
        setAlertModal({
          open: true,
          title: 'Forfeit Failed',
          message: error.error || 'Failed to forfeit layaway',
          variant: 'error',
        })
      }
    } catch (error) {
      console.error('Error forfeiting layaway:', error)
      setAlertModal({
        open: true,
        title: 'Error',
        message: 'An error occurred while forfeiting the layaway',
        variant: 'error',
      })
    } finally {
      setProcessing(false)
    }
  }

  async function handleCancel(reason: string) {
    if (!layaway) return

    setProcessing(true)
    try {
      const res = await fetch(`/api/layaways/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancellationReason: reason,
          expectedUpdatedAt: layaway.updatedAt,
        }),
      })

      if (res.ok) {
        setShowCancelModal(false)
        setAlertModal({
          open: true,
          title: 'Layaway Cancelled',
          message: 'Layaway has been cancelled successfully.',
          variant: 'success',
        })
        fetchLayaway()
      } else {
        const error = await res.json()
        setAlertModal({
          open: true,
          title: 'Cancellation Failed',
          message: error.error || 'Failed to cancel layaway',
          variant: 'error',
        })
      }
    } catch (error) {
      console.error('Error cancelling layaway:', error)
      setAlertModal({
        open: true,
        title: 'Error',
        message: 'An error occurred while cancelling the layaway',
        variant: 'error',
      })
    } finally {
      setProcessing(false)
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function formatDateTime(dateString: string) {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function isOverdue() {
    if (!layaway?.dueDate || layaway.status !== 'active') return false
    return new Date(layaway.dueDate) < new Date()
  }

  if (loading) {
    return <PageLoading text="Loading layaway..." />
  }

  if (!layaway) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Layaway not found</p>
        <Link href={tenantSlug ? `/c/${tenantSlug}/layaways` : '/layaways'} className="text-blue-600 hover:underline mt-2 inline-block">
          Back to Layaways
        </Link>
      </div>
    )
  }

  const balanceDue = parseFloat(layaway.balanceDue)
  const isFullyPaid = balanceDue <= 0.01
  const paidAmount = parseFloat(layaway.paidAmount)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={tenantSlug ? `/c/${tenantSlug}/layaways` : '/layaways'}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          aria-label="Back to layaways"
        >
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold dark:text-white">{layaway.layawayNo}</h1>
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[layaway.status]}`}>
              {statusLabels[layaway.status]}
            </span>
            {isOverdue() && (
              <span className="px-3 py-1 text-sm font-medium rounded-full bg-red-100 text-red-800">
                Overdue
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Created {formatDateTime(layaway.createdAt)}
            {layaway.createdByName && ` by ${layaway.createdByName}`}
          </p>
        </div>

        {/* Actions for active layaways */}
        {layaway.status === 'active' && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setPaymentData(prev => ({ ...prev, amount: balanceDue.toFixed(2) }))
                setShowPaymentModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <Plus size={18} />
              Add Payment
            </button>
            {isFullyPaid && (
              <button
                onClick={() => setShowCompleteModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                <CheckCircle size={18} />
                Complete
              </button>
            )}
            <button
              onClick={() => setShowForfeitModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
            >
              <AlertTriangle size={18} />
              Forfeit
            </button>
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              <Ban size={18} />
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 dark:text-white">
              <User size={20} className="text-gray-400" />
              Customer
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Name:</span>
                <p className="font-medium dark:text-white">{layaway.customerName || 'Unknown'}</p>
              </div>
              {layaway.customerPhone && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Phone:</span>
                  <p className="font-medium dark:text-white">{layaway.customerPhone}</p>
                </div>
              )}
              {layaway.customerEmail && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Email:</span>
                  <p className="font-medium dark:text-white">{layaway.customerEmail}</p>
                </div>
              )}
              {layaway.dueDate && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Due Date:</span>
                  <p className={`font-medium ${isOverdue() ? 'text-red-600' : 'dark:text-white'}`}>
                    {formatDate(layaway.dueDate)}
                    {isOverdue() && ' (Overdue)'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="p-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                <Package size={20} className="text-gray-400" />
                Items ({layaway.items.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Item</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Qty</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Price</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {layaway.items.map((item) => (
                    <tr key={item.id} className="border-t dark:border-gray-700">
                      <td className="px-4 py-3">
                        <p className="font-medium dark:text-white">{formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemOemPartNumber, pluCode: item.itemPluCode }, businessType)}</p>
                      </td>
                      <td className="px-4 py-3 text-right dark:text-white">
                        {parseFloat(item.quantity).toFixed(0)}
                      </td>
                      <td className="px-4 py-3 text-right dark:text-white">
                        {currencyCode} {parseFloat(item.unitPrice).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium dark:text-white">
                        {currencyCode} {parseFloat(item.total).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payments */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="p-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                <Receipt size={20} className="text-gray-400" />
                Payments ({layaway.payments.length})
              </h2>
            </div>
            {layaway.payments.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No payments recorded</div>
            ) : (
              <div className="divide-y dark:divide-gray-700">
                {layaway.payments.map((payment) => (
                  <div key={payment.id} className="p-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          payment.paymentMethod === 'cash'
                            ? 'bg-green-100 text-green-700'
                            : payment.paymentMethod === 'card'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                        }`}>
                          {paymentMethodLabels[payment.paymentMethod] || payment.paymentMethod}
                        </span>
                        {payment.reference && (
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {payment.reference}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {formatDateTime(payment.createdAt)}
                        {payment.receivedByName && ` - ${payment.receivedByName}`}
                      </p>
                    </div>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      + {currencyCode} {parseFloat(payment.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes & Cancellation Info */}
          {(layaway.notes || layaway.cancellationReason) && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
              {layaway.notes && (
                <div className="mb-4">
                  <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</h3>
                  <p className="text-gray-600 dark:text-gray-400">{layaway.notes}</p>
                </div>
              )}
              {layaway.cancellationReason && (
                <div className="border-l-4 border-red-500 pl-3">
                  <h3 className="font-medium text-red-700 dark:text-red-400 mb-1">
                    {layaway.status === 'forfeited' ? 'Forfeit Reason' : 'Cancellation Reason'}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">{layaway.cancellationReason}</p>
                  {layaway.cancelledAt && (
                    <p className="text-xs text-gray-500 mt-1">
                      {formatDateTime(layaway.cancelledAt)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar - Summary */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 dark:text-white">
              <CreditCard size={20} className="text-gray-400" />
              Summary
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Subtotal:</span>
                <span className="dark:text-white">{currencyCode} {parseFloat(layaway.subtotal).toFixed(2)}</span>
              </div>
              {parseFloat(layaway.taxAmount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Tax:</span>
                  <span className="dark:text-white">{currencyCode} {parseFloat(layaway.taxAmount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t dark:border-gray-700 pt-3">
                <span className="dark:text-white">Total:</span>
                <span className="dark:text-white">{currencyCode} {parseFloat(layaway.total).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Initial Deposit:</span>
                <span className="dark:text-white">{currencyCode} {parseFloat(layaway.depositAmount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>Total Paid:</span>
                <span>{currencyCode} {paidAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t dark:border-gray-700 pt-3">
                <span className={balanceDue > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}>
                  Balance Due:
                </span>
                <span className={balanceDue > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}>
                  {currencyCode} {balanceDue.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>Payment Progress</span>
                <span>{Math.round((paidAmount / parseFloat(layaway.total)) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (paidAmount / parseFloat(layaway.total)) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Due Date Card */}
          {layaway.dueDate && (
            <div className={`rounded border p-4 ${
              isOverdue()
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}>
              <div className="flex items-center gap-2">
                <Calendar size={20} className={isOverdue() ? 'text-red-500' : 'text-gray-400'} />
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Due Date</p>
                  <p className={`font-medium ${isOverdue() ? 'text-red-600 dark:text-red-400' : 'dark:text-white'}`}>
                    {formatDate(layaway.dueDate)}
                    {isOverdue() && ' (Overdue)'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false)
          setPaymentData({ amount: '', method: 'cash', reference: '' })
        }}
        title="Add Payment"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Balance Due:</span>
              <span className="font-medium text-orange-600">{currencyCode} {balanceDue.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 dark:text-white">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentData(prev => ({ ...prev, method: 'cash' }))}
                className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                  paymentData.method === 'cash'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-600'
                }`}
              >
                <Banknote size={24} />
                <span className="text-sm font-medium">Cash</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentData(prev => ({ ...prev, method: 'card' }))}
                className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                  paymentData.method === 'card'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-600'
                }`}
              >
                <CreditCard size={24} />
                <span className="text-sm font-medium">Card</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentData(prev => ({ ...prev, method: 'bank_transfer' }))}
                className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                  paymentData.method === 'bank_transfer'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-600'
                }`}
              >
                <Building2 size={24} />
                <span className="text-sm font-medium">Transfer</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-white">Amount</label>
            <input
              type="number"
              step="0.01"
              value={paymentData.amount}
              onChange={(e) => setPaymentData(prev => ({ ...prev, amount: e.target.value }))}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-lg"
              placeholder="0.00"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setPaymentData(prev => ({ ...prev, amount: balanceDue.toFixed(2) }))}
                className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200"
              >
                Full Balance
              </button>
            </div>
          </div>

          {paymentData.method !== 'cash' && (
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-white">Reference</label>
              <input
                type="text"
                value={paymentData.reference}
                onChange={(e) => setPaymentData(prev => ({ ...prev, reference: e.target.value }))}
                className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder={paymentData.method === 'card' ? 'Last 4 digits' : 'Transaction ID'}
              />
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={() => {
              setShowPaymentModal(false)
              setPaymentData({ amount: '', method: 'cash', reference: '' })
            }}
            disabled={processing}
            className="flex-1 px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleAddPayment}
            disabled={processing || !paymentData.amount}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {processing ? 'Processing...' : 'Add Payment'}
          </button>
        </div>
      </Modal>

      {/* Complete Modal */}
      <ConfirmModal
        isOpen={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        onConfirm={handleComplete}
        title="Complete Layaway"
        message={`This will convert layaway ${layaway.layawayNo} to a sale and release the items to the customer. This action cannot be undone.`}
        confirmText={processing ? 'Processing...' : 'Complete Layaway'}
        variant="success"
      />

      {/* Forfeit Modal */}
      <Modal
        isOpen={showForfeitModal}
        onClose={() => {
          setShowForfeitModal(false)
          setForfeitData({ refundPercentage: 0, refundToCredit: true, reason: '' })
        }}
        title="Forfeit Layaway"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded p-3">
            <p className="text-sm text-orange-800 dark:text-orange-200">
              Customer has paid {currencyCode} {paidAmount.toFixed(2)}. You can choose to refund a percentage of this amount.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-white">Refund Percentage</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100"
                value={forfeitData.refundPercentage}
                onChange={(e) => setForfeitData(prev => ({ ...prev, refundPercentage: parseInt(e.target.value) }))}
                className="flex-1"
              />
              <span className="w-16 text-right font-medium dark:text-white">{forfeitData.refundPercentage}%</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-gray-500 dark:text-gray-400">Refund Amount:</span>
              <span className="font-medium text-green-600">
                {currencyCode} {(paidAmount * forfeitData.refundPercentage / 100).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Forfeited Amount:</span>
              <span className="font-medium text-orange-600">
                {currencyCode} {(paidAmount * (100 - forfeitData.refundPercentage) / 100).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="refundToCredit"
              checked={forfeitData.refundToCredit}
              onChange={(e) => setForfeitData(prev => ({ ...prev, refundToCredit: e.target.checked }))}
              className="rounded border-gray-300"
            />
            <label htmlFor="refundToCredit" className="text-sm dark:text-white">
              Add refund to customer credit balance
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-white">Reason (Optional)</label>
            <textarea
              value={forfeitData.reason}
              onChange={(e) => setForfeitData(prev => ({ ...prev, reason: e.target.value }))}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              rows={3}
              placeholder="Enter reason for forfeiture..."
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={() => {
              setShowForfeitModal(false)
              setForfeitData({ refundPercentage: 0, refundToCredit: true, reason: '' })
            }}
            disabled={processing}
            className="flex-1 px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleForfeit}
            disabled={processing}
            className="flex-1 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
          >
            {processing ? 'Processing...' : 'Forfeit Layaway'}
          </button>
        </div>
      </Modal>

      {/* Cancel Modal */}
      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        title="Cancel Layaway"
        itemName={`Layaway ${layaway.layawayNo}`}
        processing={processing}
        documentType="sales_order"
      />

      {/* Alert Modal */}
      <AlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal(prev => ({ ...prev, open: false }))}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </div>
  )
}

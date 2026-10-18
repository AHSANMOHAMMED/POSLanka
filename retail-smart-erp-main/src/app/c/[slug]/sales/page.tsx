'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Plus, X, CreditCard, Banknote, Building2, Ban, Download } from 'lucide-react'
import { usePaginatedData, useTerminology, useDateFormat } from '@/hooks'
import { formatItemLabel } from '@/lib/utils/item-display'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { Pagination } from '@/components/ui/pagination'
import { AlertModal } from '@/components/ui/alert-modal'
import { CancellationReasonModal } from '@/components/modals'
import { useCurrency } from '@/hooks/useCurrency'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { SalesDashboard } from '@/components/pos'

const paymentMethodLabels: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  credit: 'Credit',
  gift_card: 'Gift Card',
}

interface SaleItem {
  id: string
  quantity: string
  unitPrice: string
  total: string
  item: {
    name: string
    barcode?: string | null
    sku?: string | null
    oemPartNumber?: string | null
    pluCode?: string | null
  } | null
  itemName?: string
}

interface Payment {
  id: string
  amount: string
  method: string
  reference: string | null
  receivedBy: string | null
  createdAt: string
}

interface Sale {
  id: string
  invoiceNo: string
  subtotal: string
  discountAmount: string
  taxAmount: string
  total: string
  paidAmount: string
  paymentMethod: string
  status: string
  createdAt: string
  customer: {
    id: string
    name: string
    balance?: string
  } | null
  user: {
    fullName: string
  }
  items: SaleItem[]
  isReturn?: boolean
  returnAgainst?: string
  originalSale?: {
    id: string
    invoiceNo: string
  } | null
  returnStatus?: 'none' | 'partial' | 'full'
  linkedReturns?: {
    id: string
    invoiceNo: string
    total: string
  }[]
}

export default function SalesPage() {
  const t = useTerminology()
  const { currency: currencyCode } = useCurrency()
  const router = useRouter()
  const { tenantSlug, businessType } = useCompany()
  const { fDateTime } = useDateFormat()
  const { showExportDialog, openExport, closeExport } = useExport()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean
    sale: Sale | null
    payments: Payment[]
    totalPaid: string
    balanceDue: string
  }>({ open: false, sale: null, payments: [], totalPaid: '0', balanceDue: '0' })
  const [paymentData, setPaymentData] = useState({
    amount: '',
    method: 'cash' as 'cash' | 'card' | 'bank_transfer',
    reference: '',
    creditAmount: '',
    overpaymentAction: 'return' as 'return' | 'credit',
  })
  const [customerCredit, setCustomerCredit] = useState<number>(0)
  const [processing, setProcessing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all')
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string; variant: 'error' | 'success' | 'warning' | 'info' }>({ open: false, title: '', message: '', variant: 'error' })
  const [showVoidModal, setShowVoidModal] = useState(false)
  const [voidingSaleId, setVoidingSaleId] = useState<string | null>(null)
  const [voidingSaleNo, setVoidingSaleNo] = useState<string>('')

  // Memoize additionalParams to prevent infinite re-renders
  const additionalParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (statusFilter !== 'all') params.status = statusFilter
    return params
  }, [statusFilter])

  // Paginated sales with server-side search and status filter
  const {
    data: sales,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: fetchSales,
  } = usePaginatedData<Sale>({
    endpoint: '/api/sales',
    entityType: 'sale',
    storageKey: 'sales-page-size',
    additionalParams,
  })

  async function openPaymentModal(sale: Sale) {
    try {
      // Fetch payments for this sale
      const res = await fetch(`/api/sales/${sale.id}/payments`)
      if (res.ok) {
        const data = await res.json()
        setPaymentModal({
          open: true,
          sale,
          payments: data.payments,
          totalPaid: data.totalPaid,
          balanceDue: data.balanceDue,
        })
        setPaymentData({
          amount: data.balanceDue,
          method: 'cash',
          reference: '',
          creditAmount: '',
          overpaymentAction: 'return',
        })

        // Fetch customer credit if customer exists
        if (sale.customer?.id) {
          const creditRes = await fetch(`/api/customers/${sale.customer.id}/credit`)
          if (creditRes.ok) {
            const creditData = await creditRes.json()
            setCustomerCredit(parseFloat(creditData.balance) || 0)
          }
        } else {
          setCustomerCredit(0)
        }
      }
    } catch (error) {
      console.error('Error fetching payments:', error)
    }
  }

  async function addPayment() {
    if (!paymentModal.sale) return

    const creditUsed = parseFloat(paymentData.creditAmount) || 0
    const balanceDue = parseFloat(paymentModal.balanceDue)
    const remainingAfterCredit = Math.max(0, balanceDue - creditUsed)
    const cashAmount = parseFloat(paymentData.amount) || 0
    // For card/transfer, cap at remaining amount (no overpayment)
    const effectiveCashAmount = paymentData.method === 'cash' ? cashAmount : Math.min(cashAmount, remainingAfterCredit)

    if (effectiveCashAmount <= 0 && creditUsed <= 0) {
      setAlertModal({ open: true, title: 'Payment Required', message: 'Please enter a payment amount', variant: 'warning' })
      return
    }

    setProcessing(true)
    try {
      const res = await fetch(`/api/sales/${paymentModal.sale.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: effectiveCashAmount,
          method: paymentData.method,
          reference: paymentData.reference || null,
          creditAmount: creditUsed,
          addOverpaymentToCredit: paymentData.method === 'cash' && paymentData.overpaymentAction === 'credit',
        }),
      })

      if (res.ok) {
        // Refresh sales list
        await fetchSales()
        setPaymentModal({ open: false, sale: null, payments: [], totalPaid: '0', balanceDue: '0' })
        setPaymentData({ amount: '', method: 'cash', reference: '', creditAmount: '', overpaymentAction: 'return' })
      } else {
        const error = await res.json()
        setAlertModal({ open: true, title: 'Payment Error', message: error.error || 'Failed to add payment', variant: 'error' })
      }
    } catch (error) {
      console.error('Error adding payment:', error)
      setAlertModal({ open: true, title: 'Payment Error', message: 'Failed to add payment', variant: 'error' })
    } finally {
      setProcessing(false)
    }
  }

  function useCredit() {
    const balanceDue = parseFloat(paymentModal.balanceDue)
    const creditToUse = Math.min(customerCredit, balanceDue)
    setPaymentData(prev => ({
      ...prev,
      creditAmount: String(creditToUse),
      amount: String(Math.max(0, balanceDue - creditToUse)),
    }))
  }

  async function handleVoidSale(reason: string) {
    if (!voidingSaleId) return
    setProcessing(true)
    try {
      const res = await fetch(`/api/sales/${voidingSaleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voidReason: reason }),
      })
      if (res.ok) {
        setShowVoidModal(false)
        setVoidingSaleId(null)
        setAlertModal({ open: true, title: 'Sale Voided', message: `Sale ${voidingSaleNo} has been voided successfully.`, variant: 'success' })
        fetchSales()
      } else {
        const data = await res.json()
        setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to void sale', variant: 'error' })
      }
    } catch {
      setAlertModal({ open: true, title: 'Error', message: 'Failed to void sale', variant: 'error' })
    } finally {
      setProcessing(false)
    }
  }

  // Date formatting now uses tenant settings via useDateFormat hook

  if (loading && sales.length === 0) {
    return <PageLoading text="Loading sales..." />
  }

  const pendingCount = sales.filter(s => s.status === 'pending').length
  const hasFilters = statusFilter !== 'all'

  return (
    <>
    <ListPageLayout
      module={t.sellingModule}
      moduleHref="/selling"
      title={t.sale}
      actionContent={
        <div className="flex items-center gap-2">
          <button
            onClick={openExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={() => router.push(`/c/${tenantSlug}/sales/new`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            {t.newSale}
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={fetchSales}
      searchPlaceholder="Invoice number, customer..."
      filterContent={
        <>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'pending' | 'completed')}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending{pendingCount > 0 ? ` (${pendingCount})` : ''}</option>
            <option value="completed">Completed</option>
          </select>
          {hasFilters && (
            <button onClick={() => setStatusFilter('all')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <SalesDashboard />
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 flex-1 overflow-auto">
        {sales.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            {search ? 'No sales match your search' : 'No sales yet'}
          </div>
        ) : (
          <div className="divide-y">
            {sales.map((sale) => (
              <div key={sale.id}>
                <div
                  className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium ${sale.isReturn ? 'text-red-600' : 'text-blue-600'}`}>{sale.invoiceNo}</span>
                        {/* Return indicator for return invoices */}
                        {sale.isReturn && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            Return
                          </span>
                        )}
                        {/* Return status for original sales */}
                        {!sale.isReturn && sale.returnStatus === 'full' && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                            Returned
                          </span>
                        )}
                        {!sale.isReturn && sale.returnStatus === 'partial' && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            Partial Return
                          </span>
                        )}
                        {/* Payment status */}
                        {sale.status !== 'void' && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            sale.status === 'completed'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {sale.status === 'completed' ? 'Paid' : 'Pending'}
                          </span>
                        )}
                        {sale.status === 'void' && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            Void
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {sale.customer?.name || 'Walk-in Customer'} | {sale.user.fullName}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {fDateTime(sale.createdAt)}
                      </div>
                      {/* Show linked original sale for returns */}
                      {sale.isReturn && sale.originalSale && (
                        <div className="text-xs text-gray-500 mt-1">
                          Return for: <span className="font-medium text-blue-600">{sale.originalSale.invoiceNo}</span>
                        </div>
                      )}
                      {/* Show linked returns for original sales */}
                      {!sale.isReturn && sale.linkedReturns && sale.linkedReturns.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          Returns: {sale.linkedReturns.map((r, idx) => (
                            <span key={r.id}>
                              {idx > 0 && ', '}
                              <span className="font-medium text-red-600">{r.invoiceNo}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <div>
                        <div className={`font-bold text-lg ${sale.isReturn ? 'text-red-600' : ''}`}>
                          {sale.isReturn ? '-' : ''}{currencyCode} {Math.abs(parseFloat(sale.total)).toFixed(2)}
                        </div>
                        {!sale.isReturn && sale.status === 'pending' && (
                          <div className="text-sm text-orange-600 font-medium">
                            Due: {currencyCode} {(parseFloat(sale.total) - parseFloat(sale.paidAmount)).toFixed(2)}
                          </div>
                        )}
                        {sale.isReturn && (
                          <div className="text-xs text-red-500">Refund</div>
                        )}
                        <div className="text-sm mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            sale.paymentMethod === 'cash'
                              ? 'bg-green-100 text-green-700'
                              : sale.paymentMethod === 'credit'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-blue-100 text-blue-700'
                          }`}>
                            {paymentMethodLabels[sale.paymentMethod] || sale.paymentMethod}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!sale.isReturn && sale.status === 'pending' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              openPaymentModal(sale)
                            }}
                            aria-label={`Add payment to sale ${sale.invoiceNo}`}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center gap-1"
                          >
                            <Plus size={16} />
                            Add Payment
                          </button>
                        )}
                        {!sale.isReturn && sale.status !== 'void' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setVoidingSaleId(sale.id)
                              setVoidingSaleNo(sale.invoiceNo)
                              setShowVoidModal(true)
                            }}
                            aria-label={`Void sale ${sale.invoiceNo}`}
                            className="px-3 py-1.5 bg-red-50 text-red-600 text-sm rounded hover:bg-red-100 flex items-center gap-1 border border-red-200"
                          >
                            <Ban size={14} />
                            Void
                          </button>
                        )}
                      </div>
                      {expandedId === sale.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                {expandedId === sale.id && (
                  <div className="px-4 pb-4 bg-gray-50 dark:bg-gray-700/50">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Items in sale {sale.invoiceNo}</caption>
                      <thead>
                        <tr className="text-gray-500 dark:text-gray-400">
                          <th scope="col" className="text-left py-2">Item</th>
                          <th scope="col" className="text-right py-2">Qty</th>
                          <th scope="col" className="text-right py-2">Price</th>
                          <th scope="col" className="text-right py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sale.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-1">{item.item ? formatItemLabel(item.item, businessType) : (item.itemName || 'Unknown Item')}</td>
                            <td className="text-right">{parseFloat(item.quantity).toFixed(0)}</td>
                            <td className="text-right">{parseFloat(item.unitPrice).toFixed(2)}</td>
                            <td className="text-right">{parseFloat(item.total).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t">
                        <tr>
                          <td colSpan={3} className="py-2 text-right font-medium">Subtotal:</td>
                          <td className="text-right">{parseFloat(sale.subtotal).toFixed(2)}</td>
                        </tr>
                        {parseFloat(sale.discountAmount) > 0 && (
                          <tr>
                            <td colSpan={3} className="text-right text-red-600">Discount:</td>
                            <td className="text-right text-red-600">-{parseFloat(sale.discountAmount).toFixed(2)}</td>
                          </tr>
                        )}
                        {parseFloat(sale.taxAmount) > 0 && (
                          <tr>
                            <td colSpan={3} className="text-right">Tax:</td>
                            <td className="text-right">{parseFloat(sale.taxAmount).toFixed(2)}</td>
                          </tr>
                        )}
                        <tr className="font-bold">
                          <td colSpan={3} className="py-2 text-right">Total:</td>
                          <td className="text-right">{parseFloat(sale.total).toFixed(2)}</td>
                        </tr>
                        <tr className="text-green-600">
                          <td colSpan={3} className="text-right">Paid:</td>
                          <td className="text-right">{parseFloat(sale.paidAmount).toFixed(2)}</td>
                        </tr>
                        {sale.status === 'pending' && (
                          <tr className="text-orange-600 font-medium">
                            <td colSpan={3} className="text-right">Balance Due:</td>
                            <td className="text-right">{(parseFloat(sale.total) - parseFloat(sale.paidAmount)).toFixed(2)}</td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t px-4"
        />
      </div>
    </ListPageLayout>

    {/* Payment Modal */}
    {paymentModal.open && paymentModal.sale && (() => {
        const creditUsed = parseFloat(paymentData.creditAmount) || 0
        const balanceDue = parseFloat(paymentModal.balanceDue)
        const remainingAfterCredit = Math.max(0, balanceDue - creditUsed)
        // For card/transfer, cap at remaining amount (no overpayment allowed)
        const maxCardAmount = remainingAfterCredit
        const cashAmount = parseFloat(paymentData.amount) || 0
        // For card/transfer, use capped amount
        const effectiveCashAmount = paymentData.method === 'cash' ? cashAmount : Math.min(cashAmount, maxCardAmount)
        const totalPayment = effectiveCashAmount + creditUsed
        const overpayment = paymentData.method === 'cash' ? Math.max(0, totalPayment - balanceDue) : 0
        const remainingAfterPayment = Math.max(0, balanceDue - totalPayment)

        return (
          <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center p-4 border-b dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
                <h2 className="text-lg font-semibold dark:text-white">Add Payment</h2>
                <button
                  onClick={() => setPaymentModal({ open: false, sale: null, payments: [], totalPaid: '0', balanceDue: '0' })}
                  disabled={processing}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {/* Sale Info */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-3">
                  <div className="flex justify-between text-sm dark:text-gray-300">
                    <span>Invoice:</span>
                    <span className="font-medium dark:text-white">{paymentModal.sale.invoiceNo}</span>
                  </div>
                  <div className="flex justify-between text-sm dark:text-gray-300">
                    <span>Customer:</span>
                    <span className="font-medium dark:text-white">{paymentModal.sale.customer?.name || 'Walk-in Customer'}</span>
                  </div>
                  <div className="flex justify-between text-sm dark:text-gray-300">
                    <span>Total:</span>
                    <span className="font-medium dark:text-white">{currencyCode} {parseFloat(paymentModal.sale.total).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm dark:text-gray-300">
                    <span>Paid:</span>
                    <span className="text-green-600 font-medium">{currencyCode} {parseFloat(paymentModal.totalPaid).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold mt-2 pt-2 border-t dark:border-gray-600 dark:text-white">
                    <span>Balance Due:</span>
                    <span className="text-orange-600">{currencyCode} {balanceDue.toFixed(2)}</span>
                  </div>
                </div>

                {/* Payment History */}
                {paymentModal.payments.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Payment History</h3>
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded divide-y dark:divide-gray-600">
                      {paymentModal.payments.map((payment) => (
                        <div key={payment.id} className="p-3 flex justify-between items-center">
                          <div>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              payment.method === 'cash' ? 'bg-green-100 text-green-700' :
                              payment.method === 'credit' ? 'bg-purple-100 text-purple-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {paymentMethodLabels[payment.method] || payment.method}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                              {fDateTime(payment.createdAt)}
                            </span>
                          </div>
                          <span className="font-medium dark:text-white">{currencyCode} {parseFloat(payment.amount).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Customer Credit */}
                {paymentModal.sale.customer && customerCredit > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="text-sm font-medium text-green-800">Customer Credit Available</div>
                        <div className="text-lg font-bold text-green-700">{currencyCode} {customerCredit.toFixed(2)}</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={useCredit}
                          className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Use Credit
                        </button>
                        {creditUsed > 0 && (
                          <button
                            onClick={() => setPaymentData(prev => ({ ...prev, creditAmount: '', amount: paymentModal.balanceDue }))}
                            className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    {creditUsed > 0 && (
                      <div className="mt-2 pt-2 border-t border-green-200">
                        <label className="block text-sm font-medium text-green-800 mb-1">Credit Amount to Use</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={customerCredit}
                          value={paymentData.creditAmount}
                          onChange={(e) => {
                            const val = Math.min(parseFloat(e.target.value) || 0, customerCredit)
                            setPaymentData(prev => ({ ...prev, creditAmount: val > 0 ? String(val) : '' }))
                          }}
                          className="w-full px-3 py-2 border border-green-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Payment Method */}
                <div>
                  <label className="block text-sm font-medium dark:text-white mb-2">Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentData(prev => ({ ...prev, method: 'cash' }))}
                      className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                        paymentData.method === 'cash'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 dark:text-gray-300'
                      }`}
                    >
                      <Banknote size={24} />
                      <span className="text-sm font-medium">Cash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Cap amount when switching to card
                        const currentAmount = parseFloat(paymentData.amount) || 0
                        setPaymentData(prev => ({
                          ...prev,
                          method: 'card',
                          amount: currentAmount > remainingAfterCredit ? String(remainingAfterCredit) : prev.amount,
                        }))
                      }}
                      className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                        paymentData.method === 'card'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 dark:text-gray-300'
                      }`}
                    >
                      <CreditCard size={24} />
                      <span className="text-sm font-medium">Card</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Cap amount when switching to transfer
                        const currentAmount = parseFloat(paymentData.amount) || 0
                        setPaymentData(prev => ({
                          ...prev,
                          method: 'bank_transfer',
                          amount: currentAmount > remainingAfterCredit ? String(remainingAfterCredit) : prev.amount,
                        }))
                      }}
                      className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                        paymentData.method === 'bank_transfer'
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 dark:text-gray-300'
                      }`}
                    >
                      <Building2 size={24} />
                      <span className="text-sm font-medium">Transfer</span>
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium dark:text-white mb-1">
                    {paymentData.method === 'cash' ? 'Cash' : paymentData.method === 'card' ? 'Card' : 'Transfer'} Amount
                    {paymentData.method !== 'cash' && <span className="text-gray-500 dark:text-gray-400 font-normal"> (max: {currencyCode} {remainingAfterCredit.toFixed(2)})</span>}
                  </label>
                  <input
                    type="number"
                    value={paymentData.amount}
                    max={paymentData.method !== 'cash' ? remainingAfterCredit : undefined}
                    onChange={(e) => {
                      let val = e.target.value
                      // For card/transfer, cap at remaining amount
                      if (paymentData.method !== 'cash' && parseFloat(val) > remainingAfterCredit) {
                        val = String(remainingAfterCredit)
                      }
                      setPaymentData(prev => ({ ...prev, amount: val }))
                    }}
                    className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg dark:bg-gray-700 dark:text-white"
                    step="0.01"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setPaymentData(prev => ({ ...prev, amount: String(remainingAfterCredit) }))}
                      className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      Exact
                    </button>
                    {paymentData.method === 'cash' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPaymentData(prev => ({ ...prev, amount: String(Math.ceil(balanceDue / 100) * 100) }))}
                          className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          Round 100
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentData(prev => ({ ...prev, amount: String(Math.ceil(balanceDue / 500) * 500) }))}
                          className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          Round 500
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setPaymentData(prev => ({ ...prev, amount: '0' }))}
                      className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      Zero
                    </button>
                  </div>
                </div>

                {/* Reference */}
                {paymentData.method !== 'cash' && (
                  <div>
                    <label className="block text-sm font-medium dark:text-white mb-1">
                      Reference {paymentData.method === 'card' ? '(Last 4 digits)' : '(Transaction ID)'}
                    </label>
                    <input
                      type="text"
                      value={paymentData.reference}
                      onChange={(e) => setPaymentData(prev => ({ ...prev, reference: e.target.value }))}
                      placeholder={paymentData.method === 'card' ? 'XXXX' : 'Transaction reference'}
                      className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                )}

                {/* Payment Summary */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-3 space-y-1">
                  <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Payment Summary</div>
                  {creditUsed > 0 && (
                    <div className="flex justify-between text-sm dark:text-gray-300">
                      <span>Credit Used:</span>
                      <span className="text-green-600">{currencyCode} {creditUsed.toFixed(2)}</span>
                    </div>
                  )}
                  {effectiveCashAmount > 0 && (
                    <div className="flex justify-between text-sm dark:text-gray-300">
                      <span>{paymentData.method === 'cash' ? 'Cash' : paymentData.method === 'card' ? 'Card' : 'Transfer'}:</span>
                      <span>{currencyCode} {effectiveCashAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium border-t dark:border-gray-600 pt-1 mt-1 dark:text-white">
                    <span>Total Payment:</span>
                    <span>{currencyCode} {totalPayment.toFixed(2)}</span>
                  </div>
                </div>

                {/* Overpayment handling (cash only) */}
                {overpayment > 0 && paymentData.method === 'cash' && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <div className="text-sm text-blue-800 mb-2">
                      Overpayment: <strong>{currencyCode} {overpayment.toFixed(2)}</strong>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentData(prev => ({ ...prev, overpaymentAction: 'return' }))}
                        className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                          paymentData.overpaymentAction === 'return'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white border border-blue-300 text-blue-700 hover:bg-blue-50'
                        }`}
                      >
                        Return as Change
                      </button>
                      {paymentModal.sale.customer && (
                        <button
                          type="button"
                          onClick={() => setPaymentData(prev => ({ ...prev, overpaymentAction: 'credit' }))}
                          className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                            paymentData.overpaymentAction === 'credit'
                              ? 'bg-green-600 text-white'
                              : 'bg-white border border-green-300 text-green-700 hover:bg-green-50'
                          }`}
                        >
                          Add to Credit
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Remaining balance warning */}
                {remainingAfterPayment > 0 && totalPayment > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
                    <span className="text-yellow-800">
                      Remaining balance after payment: <strong>{currencyCode} {remainingAfterPayment.toFixed(2)}</strong>
                    </span>
                  </div>
                )}
              </div>
              <div className="flex gap-2 p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800 sticky bottom-0">
                <button
                  onClick={() => setPaymentModal({ open: false, sale: null, payments: [], totalPaid: '0', balanceDue: '0' })}
                  disabled={processing}
                  className="flex-1 px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={addPayment}
                  disabled={processing || totalPayment <= 0}
                  className={`flex-1 px-4 py-3 text-white rounded font-medium disabled:opacity-50 ${
                    remainingAfterPayment > 0 ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {processing ? 'Processing...' : `Add Payment - ${currencyCode} ${totalPayment.toFixed(2)}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

    <AlertModal
      isOpen={alertModal.open}
      onClose={() => setAlertModal({ ...alertModal, open: false })}
      title={alertModal.title}
      message={alertModal.message}
      variant={alertModal.variant}
    />

    <CancellationReasonModal
      isOpen={showVoidModal}
      onClose={() => {
        setShowVoidModal(false)
        setVoidingSaleId(null)
      }}
      onConfirm={handleVoidSale}
      title="Void Sale"
      itemName={`Sale ${voidingSaleNo}`}
      processing={processing}
      documentType="sales_invoice"
    />

    <ExportDialog
      isOpen={showExportDialog}
      onClose={closeExport}
      entity="sales"
      currentFilters={{ search, status: statusFilter !== 'all' ? statusFilter : '' }}
    />
    </>
  )
}

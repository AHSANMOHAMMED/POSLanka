'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  Loader2,
  ArrowRightLeft,
  Search,
  CheckCircle,
  Undo2,
  X,
  Plus,
  ArrowRight,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'
import { format } from 'date-fns'
import { AsyncCreatableSelect, type AsyncSelectOption } from '@/components/ui/async-creatable-select'

interface UnallocatedPayment {
  id: string
  sourceType: 'payment_entry' | 'journal_entry_item'
  entryNumber: string
  postingDate: string
  paidAmount: string
  unallocatedAmount: string
  referenceNo: string | null
}

interface OutstandingInvoice {
  referenceType: string
  referenceId: string
  referenceNumber: string
  postingDate: string
  totalAmount: number
  outstandingAmount: number
}

interface Allocation {
  paymentEntryId: string | null
  sourceJeItemId: string | null
  referenceType: string
  referenceId: string
  referenceNumber: string
  allocatedAmount: number
}

const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export default function PaymentReconciliationPage() {
  const { currency } = useCurrency()
  const [partyType, setPartyType] = useState<'customer' | 'supplier'>('customer')
  const [partyId, setPartyId] = useState('')
  const [selectedPartyOption, setSelectedPartyOption] = useState<AsyncSelectOption | null>(null)
  const [payments, setPayments] = useState<UnallocatedPayment[]>([])
  const [invoices, setInvoices] = useState<OutstandingInvoice[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [loading, setLoading] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [autoAllocating, setAutoAllocating] = useState(false)

  // Manual allocation state
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [manualAmount, setManualAmount] = useState('')

  // Compute remaining amounts after pending allocations
  const pendingPaymentAllocated = useMemo(() => {
    return allocations.reduce((map, a) => {
      const key = a.paymentEntryId || a.sourceJeItemId || ''
      map[key] = (map[key] || 0) + a.allocatedAmount
      return map
    }, {} as Record<string, number>)
  }, [allocations])

  const pendingInvoiceAllocated = useMemo(() => {
    return allocations.reduce((map, a) => {
      map[a.referenceId] = (map[a.referenceId] || 0) + a.allocatedAmount
      return map
    }, {} as Record<string, number>)
  }, [allocations])

  const getPaymentRemaining = useCallback((p: UnallocatedPayment) => {
    return Number(p.unallocatedAmount) - (pendingPaymentAllocated[p.id] || 0)
  }, [pendingPaymentAllocated])

  const getInvoiceRemaining = useCallback((inv: OutstandingInvoice) => {
    return Math.abs(inv.outstandingAmount) - (pendingInvoiceAllocated[inv.referenceId] || 0)
  }, [pendingInvoiceAllocated])

  // Auto-fill manual amount when both sides are selected
  const selectedPayment = payments.find(p => p.id === selectedPaymentId) || null
  const selectedInvoice = invoices.find(inv => inv.referenceId === selectedInvoiceId) || null

  useEffect(() => {
    if (selectedPayment && selectedInvoice) {
      const payRemaining = getPaymentRemaining(selectedPayment)
      const invRemaining = getInvoiceRemaining(selectedInvoice)
      const defaultAmount = Math.min(payRemaining, invRemaining)
      setManualAmount(defaultAmount > 0 ? defaultAmount.toFixed(2) : '')
    } else {
      setManualAmount('')
    }
  }, [selectedPaymentId, selectedInvoiceId, selectedPayment, selectedInvoice, getPaymentRemaining, getInvoiceRemaining])

  function handleAddManualAllocation() {
    if (!selectedPayment || !selectedInvoice) return
    const amount = parseFloat(manualAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid amount greater than 0')
      return
    }
    const payRemaining = getPaymentRemaining(selectedPayment)
    const invRemaining = getInvoiceRemaining(selectedInvoice)
    if (amount > payRemaining + 0.005) {
      toast.error(`Amount exceeds payment remaining (${formatCurrency(payRemaining, currency)})`)
      return
    }
    if (amount > invRemaining + 0.005) {
      toast.error(`Amount exceeds invoice outstanding (${formatCurrency(invRemaining, currency)})`)
      return
    }

    const newAllocation: Allocation = {
      paymentEntryId: selectedPayment.sourceType === 'payment_entry' ? selectedPayment.id : null,
      sourceJeItemId: selectedPayment.sourceType === 'journal_entry_item' ? selectedPayment.id : null,
      referenceType: selectedInvoice.referenceType,
      referenceId: selectedInvoice.referenceId,
      referenceNumber: selectedInvoice.referenceNumber,
      allocatedAmount: Math.round(amount * 100) / 100,
    }
    setAllocations(prev => [...prev, newAllocation])
    setSelectedPaymentId(null)
    setSelectedInvoiceId(null)
    setManualAmount('')
    toast.success('Allocation added')
  }

  function handleRemoveAllocation(index: number) {
    setAllocations(prev => prev.filter((_, i) => i !== index))
  }

  const searchCustomers = useCallback(async (search: string): Promise<AsyncSelectOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/customers?${params}`)
    const result = await res.json()
    const data = Array.isArray(result) ? result : result.data || []
    return data.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name }))
  }, [])

  const searchSuppliers = useCallback(async (search: string): Promise<AsyncSelectOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/suppliers?${params}`)
    const result = await res.json()
    const data = Array.isArray(result) ? result : result.data || []
    return data.map((s: { id: string; name: string }) => ({ value: s.id, label: s.name }))
  }, [])

  async function fetchData() {
    if (!partyId) { toast.error('Select a party first'); return }
    setLoading(true)
    setAllocations([])
    setSelectedPaymentId(null)
    setSelectedInvoiceId(null)
    setManualAmount('')
    try {
      const params = new URLSearchParams({ partyType, partyId })
      const res = await fetch(`/api/accounting/payment-reconciliation?${params}`)
      if (res.ok) {
        const data = await res.json()
        setPayments(data.payments || [])
        setInvoices(data.invoices || [])
      }
    } catch {
      toast.error('Failed to load reconciliation data')
    } finally {
      setLoading(false)
    }
  }

  async function handleAutoAllocate() {
    if (payments.length === 0 || invoices.length === 0) {
      toast.error('Need both payments and invoices to allocate')
      return
    }
    setAutoAllocating(true)
    try {
      const res = await fetch('/api/accounting/payment-reconciliation/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payments, invoices }),
      })
      if (res.ok) {
        const data = await res.json()
        setAllocations(data.allocations || [])
        if (data.allocations?.length > 0) {
          toast.success(`${data.allocations.length} allocation(s) proposed`)
        } else {
          toast.info('No allocations possible')
        }
      }
    } catch {
      toast.error('Failed to auto-allocate')
    } finally {
      setAutoAllocating(false)
    }
  }

  async function handleReconcile() {
    if (allocations.length === 0) {
      toast.error('No allocations to reconcile')
      return
    }
    setReconciling(true)
    try {
      const res = await fetch('/api/accounting/payment-reconciliation/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocations }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`${data.reconciled} allocation(s) reconciled`)
        setAllocations([])
        fetchData()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to reconcile')
      }
    } catch {
      toast.error('Error during reconciliation')
    } finally {
      setReconciling(false)
    }
  }

  const partySearchFn = partyType === 'customer' ? searchCustomers : searchSuppliers
  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocatedAmount, 0)

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Payment Reconciliation"
      onRefresh={partyId ? fetchData : undefined}
    >
      {/* Party Selector */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="w-40">
            <select
              value={partyType}
              onChange={(e) => { setPartyType(e.target.value as 'customer' | 'supplier'); setPartyId(''); setSelectedPartyOption(null); setPayments([]); setInvoices([]); setAllocations([]) }}
              className={selectClass}
            >
              <option value="customer">Customer</option>
              <option value="supplier">Supplier</option>
            </select>
          </div>
          <div className="flex-1 max-w-md">
            <AsyncCreatableSelect
              key={partyType}
              fetchOptions={partySearchFn}
              value={partyId}
              onChange={(val, option) => {
                setPartyId(val)
                setSelectedPartyOption(option)
              }}
              placeholder={`Search ${partyType}...`}
              selectedOption={selectedPartyOption}
            />
          </div>
          <button
            onClick={fetchData}
            disabled={!partyId || loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Get Entries
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Payments Panel */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Unallocated Payments ({payments.length})</h3>
              {payments.length > 0 && (
                <span className="text-[10px] text-gray-400">Click to select</span>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {payments.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">
                  {partyId ? 'No unallocated payments found' : 'Select a party to load data'}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Entry #</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Paid</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {payments.map((p) => {
                      const remaining = getPaymentRemaining(p)
                      const isFullyAllocated = remaining <= 0.005
                      const isSelected = selectedPaymentId === p.id
                      return (
                        <tr
                          key={p.id}
                          onClick={() => {
                            if (isFullyAllocated) return
                            setSelectedPaymentId(isSelected ? null : p.id)
                          }}
                          className={`transition-colors ${
                            isFullyAllocated
                              ? 'opacity-40 cursor-not-allowed'
                              : isSelected
                                ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-l-blue-500 cursor-pointer'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer'
                          }`}
                        >
                          <td className="px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400">
                            {p.entryNumber}
                            {p.sourceType === 'journal_entry_item' && (
                              <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">JE</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">{format(new Date(p.postingDate), 'MMM dd')}</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-600 dark:text-gray-400">{formatCurrency(Number(p.paidAmount), currency)}</td>
                          <td className="px-3 py-2 text-sm text-right font-medium">
                            {isFullyAllocated ? (
                              <span className="text-green-600 dark:text-green-400">Allocated</span>
                            ) : remaining < Number(p.unallocatedAmount) ? (
                              <span className="text-amber-600 dark:text-amber-400">{formatCurrency(remaining, currency)}</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">{formatCurrency(Number(p.unallocatedAmount), currency)}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Invoices Panel */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Outstanding Invoices & Returns ({invoices.length})</h3>
              {invoices.length > 0 && (
                <span className="text-[10px] text-gray-400">Click to select</span>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {invoices.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">
                  {partyId ? 'No outstanding invoices found' : 'Select a party to load data'}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Invoice #</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {invoices.map((inv) => {
                      const isReturn = inv.outstandingAmount < 0
                      const remaining = getInvoiceRemaining(inv)
                      const isFullyAllocated = remaining <= 0.005
                      const isSelected = selectedInvoiceId === inv.referenceId
                      return (
                        <tr
                          key={inv.referenceId}
                          onClick={() => {
                            if (isFullyAllocated) return
                            setSelectedInvoiceId(isSelected ? null : inv.referenceId)
                          }}
                          className={`transition-colors ${
                            isFullyAllocated
                              ? 'opacity-40 cursor-not-allowed'
                              : isSelected
                                ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-l-blue-500 cursor-pointer'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer'
                          }`}
                        >
                          <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                            {inv.referenceNumber}
                            {inv.referenceType === 'journal_entry' && (
                              <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">JE</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">{format(new Date(inv.postingDate), 'MMM dd')}</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-600 dark:text-gray-400">{formatCurrency(inv.totalAmount, currency)}</td>
                          <td className="px-3 py-2 text-sm text-right font-medium">
                            {isFullyAllocated ? (
                              <span className="text-green-600 dark:text-green-400">Allocated</span>
                            ) : remaining < Math.abs(inv.outstandingAmount) ? (
                              <span className={isReturn ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{formatCurrency(remaining, currency)}</span>
                            ) : (
                              <span className={isReturn ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{formatCurrency(Math.abs(inv.outstandingAmount), currency)}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Manual Allocation Bar */}
        {selectedPayment && selectedInvoice && (
          <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-blue-700 dark:text-blue-300">{selectedPayment.entryNumber}</span>
                <span className="text-blue-500 dark:text-blue-400">({formatCurrency(getPaymentRemaining(selectedPayment), currency)} remaining)</span>
              </div>
              <ArrowRight size={14} className="text-blue-400 shrink-0" />
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-blue-700 dark:text-blue-300">{selectedInvoice.referenceNumber}</span>
                <span className="text-blue-500 dark:text-blue-400">({formatCurrency(getInvoiceRemaining(selectedInvoice), currency)} remaining)</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-gray-500 dark:text-gray-400">Amount:</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddManualAllocation() }}
                  className="w-32 border border-blue-300 dark:border-blue-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-right"
                />
                <button
                  onClick={handleAddManualAllocation}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  <Plus size={14} />
                  Add
                </button>
                <button
                  onClick={() => { setSelectedPaymentId(null); setSelectedInvoiceId(null); setManualAmount('') }}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title="Cancel selection"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Allocations */}
        {(payments.length > 0 || invoices.length > 0) && (
          <div className="mt-4 bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Allocations {allocations.length > 0 && `(${allocations.length})`}
              </h3>
              <div className="flex items-center gap-2">
                {allocations.length > 0 && (
                  <button
                    onClick={() => setAllocations([])}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  >
                    <Undo2 size={12} />
                    Clear All
                  </button>
                )}
                <button
                  onClick={handleAutoAllocate}
                  disabled={autoAllocating || payments.length === 0 || invoices.length === 0}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {autoAllocating ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />}
                  Auto Allocate (FIFO)
                </button>
                <button
                  onClick={handleReconcile}
                  disabled={reconciling || allocations.length === 0}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {reconciling ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  Reconcile
                </button>
              </div>
            </div>

            {allocations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Payment Entry</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Invoice</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                      <th className="px-4 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {allocations.map((alloc, i) => {
                      const paymentSourceId = alloc.paymentEntryId || alloc.sourceJeItemId
                      const payment = payments.find((p) => p.id === paymentSourceId)
                      return (
                        <tr key={i} className="group">
                          <td className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400">
                            {payment?.entryNumber || paymentSourceId?.slice(0, 8) || '—'}
                            {alloc.sourceJeItemId && (
                              <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">JE</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">{alloc.referenceNumber}</td>
                          <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 capitalize">{alloc.referenceType === 'journal_entry' ? 'Journal Entry' : alloc.referenceType}</td>
                          <td className="px-4 py-2 text-sm text-right font-medium text-gray-900 dark:text-white">{formatCurrency(alloc.allocatedAmount, currency)}</td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => handleRemoveAllocation(i)}
                              className="p-0.5 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                              title="Remove allocation"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-gray-50 dark:bg-gray-900">
                      <td colSpan={3} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 text-right">Total Allocated:</td>
                      <td className="px-4 py-2 text-sm text-right font-semibold text-gray-900 dark:text-white">{formatCurrency(totalAllocated, currency)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                Select a payment and invoice above, or click &quot;Auto Allocate&quot; to propose matches
              </div>
            )}
          </div>
        )}
      </div>
    </ListPageLayout>
  )
}

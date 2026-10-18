'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  ChevronRight,
  Loader2,
  X,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRightLeft,
  Search,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'
import { AsyncCreatableSelect, AsyncSelectOption } from '@/components/ui/async-creatable-select'

interface Account {
  id: string
  accountNumber: string
  name: string
  rootType: string
  accountType: string
  isGroup: boolean
}

interface ModeOfPayment {
  id: string
  name: string
  type: string
  defaultAccountId: string | null
}

interface AccountingSettings {
  defaultReceivableAccountId?: string | null
  defaultPayableAccountId?: string | null
  defaultCashAccountId?: string | null
  defaultBankAccountId?: string | null
}

interface OutstandingInvoice {
  referenceType: string
  referenceId: string
  referenceNumber: string
  postingDate: string
  totalAmount: number
  outstandingAmount: number
}

interface ReferenceRow {
  referenceType: string
  referenceId: string
  referenceNumber: string
  totalAmount: number
  outstandingAmount: number
  allocatedAmount: number
}

interface DeductionRow {
  accountId: string
  costCenterId: string
  amount: number
  description: string
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
const disabledSelectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 cursor-not-allowed'

export default function NewPaymentEntryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [modes, setModes] = useState<ModeOfPayment[]>([])
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [selectedPartyOption, setSelectedPartyOption] = useState<AsyncSelectOption | null>(null)
  const [returnUrl] = useState(() => searchParams.get('returnUrl') || '')
  const prePopulated = useRef(false)

  const [form, setForm] = useState({
    paymentType: 'receive' as 'receive' | 'pay' | 'internal_transfer',
    postingDate: new Date().toISOString().split('T')[0],
    partyType: 'customer' as 'customer' | 'supplier',
    partyId: '',
    partyName: '',
    paidFromAccountId: '',
    paidToAccountId: '',
    modeOfPaymentId: '',
    paidAmount: '',
    referenceNo: '',
    referenceDate: '',
    remarks: '',
  })

  const [references, setReferences] = useState<ReferenceRow[]>([])
  const [deductions, _setDeductions] = useState<DeductionRow[]>([])

  // Read URL query params for pre-population
  const qPaymentType = searchParams.get('paymentType') as 'receive' | 'pay' | null
  const qPartyType = searchParams.get('partyType') as 'customer' | 'supplier' | null
  const qPartyId = searchParams.get('partyId')
  const qPartyName = searchParams.get('partyName')
  const qReferenceType = searchParams.get('referenceType')
  const qReferenceId = searchParams.get('referenceId')
  const qAmount = searchParams.get('amount')

  useEffect(() => {
    Promise.all([
      fetch('/api/accounting/accounts?all=true').then((r) => r.json()),
      fetch('/api/accounting/modes-of-payment?all=true').then((r) => r.json()),
      fetch('/api/accounting/settings').then((r) => r.json()),
    ]).then(([accountsData, modesData, settingsData]) => {
      const accountList = Array.isArray(accountsData) ? accountsData : accountsData.data || []
      setAccounts(accountList)
      setModes(Array.isArray(modesData) ? modesData : modesData.data || [])

      const s = settingsData || {}
      setSettings(s)

      // Determine payment type from URL params or default
      const paymentType = qPaymentType || 'receive'
      const partyType = qPartyType || (paymentType === 'pay' ? 'supplier' : 'customer')

      // Set default accounts based on payment type
      let paidFromAccountId = ''
      let paidToAccountId = ''
      if (paymentType === 'receive') {
        paidFromAccountId = s.defaultReceivableAccountId || ''
        paidToAccountId = s.defaultBankAccountId || s.defaultCashAccountId || ''
      } else if (paymentType === 'pay') {
        paidFromAccountId = s.defaultBankAccountId || s.defaultCashAccountId || ''
        paidToAccountId = s.defaultPayableAccountId || ''
      }

      setForm((prev) => ({
        ...prev,
        paymentType,
        partyType,
        partyId: qPartyId || '',
        partyName: qPartyName || '',
        paidFromAccountId,
        paidToAccountId,
        paidAmount: qAmount || '',
      }))

      // Set party option for AsyncCreatableSelect display
      if (qPartyId && qPartyName) {
        setSelectedPartyOption({ value: qPartyId, label: qPartyName })
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-fetch outstanding invoices when pre-populated from URL params
  useEffect(() => {
    if (prePopulated.current) return
    if (!qPartyId || !qPartyType || !settings) return

    prePopulated.current = true
    const partyType = qPartyType
    const partyId = qPartyId

    setLoadingInvoices(true)
    const params = new URLSearchParams({ partyType, partyId })
    fetch(`/api/accounting/payment-entries/outstanding-invoices?${params}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return
        const invoices: OutstandingInvoice[] = data.data || data
        const refs = invoices.map((inv) => ({
          referenceType: inv.referenceType,
          referenceId: inv.referenceId,
          referenceNumber: inv.referenceNumber,
          totalAmount: inv.totalAmount,
          outstandingAmount: inv.outstandingAmount,
          allocatedAmount: 0,
        }))

        // If a specific referenceId was provided, auto-allocate to it
        if (qReferenceId) {
          const amount = parseFloat(qAmount || '0')
          const allocated = refs.map((ref) => {
            if (ref.referenceId === qReferenceId && amount > 0) {
              return { ...ref, allocatedAmount: Math.min(amount, ref.outstandingAmount) }
            }
            return ref
          })
          setReferences(allocated)
        } else {
          setReferences(refs)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingInvoices(false))
  }, [settings, qPartyId, qPartyType, qReferenceId, qAmount])

  // Async search functions for party dropdown
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

  // Get filtered accounts based on payment type and field
  function getFilteredAccounts(field: 'from' | 'to'): Account[] {
    const nonGroupAccounts = accounts.filter((a) => !a.isGroup)

    if (form.paymentType === 'receive') {
      if (field === 'from') return nonGroupAccounts.filter((a) => a.accountType === 'receivable')
      if (field === 'to') return nonGroupAccounts.filter((a) => a.accountType === 'bank' || a.accountType === 'cash')
    } else if (form.paymentType === 'pay') {
      if (field === 'from') return nonGroupAccounts.filter((a) => a.accountType === 'bank' || a.accountType === 'cash')
      if (field === 'to') return nonGroupAccounts.filter((a) => a.accountType === 'payable')
    } else {
      // Internal transfer — only bank/cash on both sides
      return nonGroupAccounts.filter((a) => a.accountType === 'bank' || a.accountType === 'cash')
    }

    return nonGroupAccounts
  }

  // Get labels based on payment type
  function getAccountLabels(): { from: string; to: string } {
    if (form.paymentType === 'receive') {
      return { from: 'Receivable Account', to: 'Bank/Cash Account' }
    } else if (form.paymentType === 'pay') {
      return { from: 'Bank/Cash Account', to: 'Payable Account' }
    }
    return { from: 'From Account', to: 'To Account' }
  }

  // Auto-set accounts when mode of payment changes
  function handleModeChange(modeId: string) {
    setForm((prev) => ({ ...prev, modeOfPaymentId: modeId }))
    const mode = modes.find((m) => m.id === modeId)
    if (mode?.defaultAccountId) {
      if (form.paymentType === 'receive') {
        setForm((prev) => ({ ...prev, modeOfPaymentId: modeId, paidToAccountId: mode.defaultAccountId! }))
      } else if (form.paymentType === 'pay') {
        setForm((prev) => ({ ...prev, modeOfPaymentId: modeId, paidFromAccountId: mode.defaultAccountId! }))
      }
    }
  }

  // Auto-set party type and default accounts based on payment type
  function handleTypeChange(type: 'receive' | 'pay' | 'internal_transfer') {
    const partyType = type === 'receive' ? 'customer' : type === 'pay' ? 'supplier' : form.partyType

    let paidFromAccountId = ''
    let paidToAccountId = ''

    if (settings) {
      if (type === 'receive') {
        paidFromAccountId = settings.defaultReceivableAccountId || ''
        paidToAccountId = settings.defaultBankAccountId || settings.defaultCashAccountId || ''
      } else if (type === 'pay') {
        paidFromAccountId = settings.defaultBankAccountId || settings.defaultCashAccountId || ''
        paidToAccountId = settings.defaultPayableAccountId || ''
      }
    }

    setForm((prev) => ({
      ...prev,
      paymentType: type,
      partyType: partyType as 'customer' | 'supplier',
      partyId: '',
      partyName: '',
      paidFromAccountId,
      paidToAccountId,
    }))
    setSelectedPartyOption(null)
    setReferences([])
  }

  // Set partyName when partyId changes
  function handlePartyChange(partyId: string, option: AsyncSelectOption | null) {
    setForm((prev) => ({ ...prev, partyId, partyName: option?.label || '' }))
    setSelectedPartyOption(option)
    setReferences([])
  }

  // Fetch outstanding invoices
  async function fetchOutstandingInvoices() {
    if (!form.partyType || !form.partyId) {
      toast.error('Select a party first')
      return
    }
    setLoadingInvoices(true)
    try {
      const params = new URLSearchParams({ partyType: form.partyType, partyId: form.partyId })
      const res = await fetch(`/api/accounting/payment-entries/outstanding-invoices?${params}`)
      if (res.ok) {
        const data = await res.json()
        const invoices: OutstandingInvoice[] = data.data || data
        // Add invoices that aren't already in references
        const existingIds = new Set(references.map((r) => r.referenceId))
        const newRefs = invoices
          .filter((inv) => !existingIds.has(inv.referenceId))
          .map((inv) => ({
            referenceType: inv.referenceType,
            referenceId: inv.referenceId,
            referenceNumber: inv.referenceNumber,
            totalAmount: inv.totalAmount,
            outstandingAmount: inv.outstandingAmount,
            allocatedAmount: 0,
          }))
        setReferences([...references, ...newRefs])
      }
    } catch {
      toast.error('Failed to fetch invoices')
    } finally {
      setLoadingInvoices(false)
    }
  }

  // Auto-allocate FIFO
  function autoAllocate() {
    const amount = parseFloat(form.paidAmount) || 0
    if (amount <= 0) { toast.error('Enter paid amount first'); return }

    let remaining = amount
    const updated = references.map((ref) => {
      if (remaining <= 0) return { ...ref, allocatedAmount: 0 }
      const allocate = Math.min(remaining, ref.outstandingAmount)
      remaining -= allocate
      return { ...ref, allocatedAmount: Math.round(allocate * 100) / 100 }
    })
    setReferences(updated)
  }

  const totalAllocated = references.reduce((sum, r) => sum + r.allocatedAmount, 0)
  const totalDeductions = deductions.reduce((sum, d) => sum + Math.abs(d.amount), 0)
  const unallocated = Math.round(((parseFloat(form.paidAmount) || 0) - totalAllocated - totalDeductions) * 100) / 100

  async function handleSave(andSubmit = false) {
    if (!form.paymentType || !form.postingDate || !form.paidAmount) {
      toast.error('Payment type, posting date, and amount are required')
      return
    }
    if (form.paymentType !== 'internal_transfer' && !form.partyId) {
      toast.error('Select a party')
      return
    }
    if (!form.modeOfPaymentId) {
      toast.error('Please select a mode of payment')
      return
    }

    setSaving(true)
    try {
      const body = {
        ...form,
        paidAmount: parseFloat(form.paidAmount),
        receivedAmount: parseFloat(form.paidAmount),
        references: references.filter((r) => r.allocatedAmount > 0),
        deductions: deductions.filter((d) => d.amount > 0),
      }

      const res = await fetch('/api/accounting/payment-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        const entry = await res.json()

        if (andSubmit) {
          const submitRes = await fetch(`/api/accounting/payment-entries/${entry.id}/submit`, { method: 'POST' })
          if (submitRes.ok) {
            toast.success('Payment entry created and submitted')
          } else {
            const err = await submitRes.json()
            toast.error(err.error || 'Created but failed to submit')
          }
        } else {
          toast.success('Payment entry created as draft')
        }

        // Redirect to returnUrl if provided (from sale/purchase/work order), otherwise to payment entry detail
        if (returnUrl && andSubmit) {
          router.push(returnUrl)
        } else {
          router.push(`/c/${tenantSlug}/accounting/payment-entries/${entry.id}`)
        }
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create payment entry')
      }
    } catch {
      toast.error('Error creating payment entry')
    } finally {
      setSaving(false)
    }
  }

  const partySearchFn = form.partyType === 'customer' ? searchCustomers : searchSuppliers
  const accountLabels = getAccountLabels()
  const fromAccounts = getFilteredAccounts('from')
  const toAccounts = getFilteredAccounts('to')

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Breadcrumb */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600"><Home size={14} /></Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/accounting`} className="hover:text-blue-600">Accounting</Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/accounting/payment-entries`} className="hover:text-blue-600">Payment Entries</Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">New</span>
        </div>
      </div>

      {/* Title */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New Payment Entry</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => router.back()} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </button>
            <button onClick={() => handleSave(false)} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-600 text-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save as Draft
            </button>
            <button onClick={() => handleSave(true)} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save & Submit
            </button>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Payment Type Selection */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Payment Type *</label>
            <div className="grid grid-cols-3 gap-3">
              {([
                { value: 'receive', label: 'Receive', icon: ArrowDownRight, color: 'green' },
                { value: 'pay', label: 'Pay', icon: ArrowUpRight, color: 'red' },
                { value: 'internal_transfer', label: 'Internal Transfer', icon: ArrowRightLeft, color: 'blue' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleTypeChange(opt.value)}
                  className={`flex items-center gap-2 px-4 py-3 rounded border-2 text-sm font-medium transition-all ${
                    form.paymentType === opt.value
                      ? `border-${opt.color}-500 bg-${opt.color}-50 text-${opt.color}-700 dark:bg-${opt.color}-900/20 dark:text-${opt.color}-400`
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                  }`}
                >
                  <opt.icon size={18} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Party & Account Details */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Posting Date *</label>
                <input type="date" value={form.postingDate} onChange={(e) => setForm({ ...form, postingDate: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mode of Payment *</label>
                <select value={form.modeOfPaymentId} onChange={(e) => handleModeChange(e.target.value)} className={selectClass}>
                  <option value="">Select mode</option>
                  {modes.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
                </select>
              </div>

              {form.paymentType !== 'internal_transfer' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Party Type *</label>
                    <select
                      value={form.partyType}
                      disabled
                      className={disabledSelectClass}
                    >
                      <option value="customer">Customer</option>
                      <option value="supplier">Supplier</option>
                    </select>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Auto-set based on payment type
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {form.partyType === 'customer' ? 'Customer' : 'Supplier'} *
                    </label>
                    <AsyncCreatableSelect
                      key={form.partyType}
                      fetchOptions={partySearchFn}
                      value={form.partyId}
                      onChange={handlePartyChange}
                      placeholder={`Search ${form.partyType}...`}
                      selectedOption={selectedPartyOption}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {accountLabels.from} *
                </label>
                <select value={form.paidFromAccountId} onChange={(e) => setForm({ ...form, paidFromAccountId: e.target.value })} className={selectClass}>
                  <option value="">Select account</option>
                  {fromAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.accountNumber} - {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {accountLabels.to} *
                </label>
                <select value={form.paidToAccountId} onChange={(e) => setForm({ ...form, paidToAccountId: e.target.value })} className={selectClass}>
                  <option value="">Select account</option>
                  {toAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.accountNumber} - {a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Paid Amount *</label>
                <input type="number" step="0.01" min="0" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} className={inputClass} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference No</label>
                <input type="text" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} className={inputClass} placeholder="Cheque/Transaction ref" />
              </div>
            </div>
          </div>

          {/* Invoice References */}
          {form.paymentType !== 'internal_transfer' && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Invoice References</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={autoAllocate}
                    disabled={references.length === 0}
                    className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
                  >
                    Auto Allocate (FIFO)
                  </button>
                  <button
                    type="button"
                    onClick={fetchOutstandingInvoices}
                    disabled={loadingInvoices || !form.partyId}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {loadingInvoices ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    Get Outstanding Invoices
                  </button>
                </div>
              </div>

              {references.length > 0 ? (
                <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Invoice #</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Outstanding</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-32">Allocated</th>
                        <th className="px-3 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {references.map((ref, index) => (
                        <tr key={ref.referenceId} className="bg-white dark:bg-gray-800">
                          <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 capitalize">{ref.referenceType === 'journal_entry' ? 'Journal Entry' : ref.referenceType}</td>
                          <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">{ref.referenceNumber}</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-600 dark:text-gray-400">{formatCurrency(ref.totalAmount, currency)}</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-600 dark:text-gray-400">{formatCurrency(ref.outstandingAmount, currency)}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={ref.outstandingAmount}
                              value={ref.allocatedAmount || ''}
                              onChange={(e) => {
                                const updated = [...references]
                                updated[index] = { ...updated[index], allocatedAmount: parseFloat(e.target.value) || 0 }
                                setReferences(updated)
                              }}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setReferences(references.filter((_, i) => i !== index))}
                              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-6 text-sm text-gray-400">
                  Click &quot;Get Outstanding Invoices&quot; to load invoices for allocation
                </div>
              )}

              {/* Summary */}
              <div className="mt-3 flex items-center justify-end gap-6 text-sm">
                <div className="text-gray-500 dark:text-gray-400">
                  Allocated: <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(totalAllocated, currency)}</span>
                </div>
                <div className="text-gray-500 dark:text-gray-400">
                  Unallocated: <span className={`font-medium ${unallocated > 0 ? 'text-amber-600' : 'text-gray-900 dark:text-white'}`}>{formatCurrency(Math.max(0, unallocated), currency)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Remarks */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Remarks</label>
            <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inputClass} rows={2} placeholder="Optional notes..." />
          </div>
        </div>
      </div>
    </div>
  )
}

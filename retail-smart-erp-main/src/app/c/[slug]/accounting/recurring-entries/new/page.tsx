'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Home, ChevronRight, Plus, X, Loader2, Save } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
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

interface CostCenter {
  id: string
  name: string
  isGroup: boolean
}

interface LineItem {
  id: string
  accountId: string
  debit: string
  credit: string
  partyType: string
  partyId: string
  costCenterId: string
  remarks: string
}

let lineCounter = 0
function newLineItem(): LineItem {
  lineCounter++
  return {
    id: `line-${lineCounter}-${Date.now()}`,
    accountId: '',
    debit: '',
    credit: '',
    partyType: '',
    partyId: '',
    costCenterId: '',
    remarks: '',
  }
}

const entryTypes = [
  { value: 'journal', label: 'Journal' },
  { value: 'opening', label: 'Opening' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'depreciation', label: 'Depreciation' },
  { value: 'closing', label: 'Closing' },
]

const recurrencePatterns = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
]

const partyTypes = [
  { value: '', label: 'None' },
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'employee', label: 'Employee' },
]

export default function NewRecurringEntryPage() {
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [entryType, setEntryType] = useState('journal')
  const [recurrencePattern, setRecurrencePattern] = useState('monthly')
  const [startDate, setStartDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<LineItem[]>([newLineItem(), newLineItem()])
  const [partyOptions, setPartyOptions] = useState<Record<string, AsyncSelectOption>>({})

  // Async search functions for party dropdowns
  const searchCustomers = useCallback(async (search: string): Promise<AsyncSelectOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/customers?${params}`)
    const result = await res.json()
    const data = Array.isArray(result) ? result : result.data || []
    return data.map((c: { id: string; name: string }) => ({
      value: c.id,
      label: c.name,
    }))
  }, [])

  const searchSuppliers = useCallback(async (search: string): Promise<AsyncSelectOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/suppliers?${params}`)
    const result = await res.json()
    const data = Array.isArray(result) ? result : result.data || []
    return data.map((s: { id: string; name: string }) => ({
      value: s.id,
      label: s.name,
    }))
  }, [])

  useEffect(() => {
    async function loadData() {
      try {
        const [accountsRes, costCentersRes] = await Promise.all([
          fetch('/api/accounting/accounts?all=true').then((r) => r.json()),
          fetch('/api/accounting/cost-centers?all=true').then((r) => r.json()),
        ])

        const accountList = Array.isArray(accountsRes) ? accountsRes : accountsRes.data || []
        setAccounts(accountList.filter((a: Account) => !a.isGroup))

        const costCenterList = Array.isArray(costCentersRes) ? costCentersRes : costCentersRes.data || []
        setCostCenters(costCenterList.filter((c: CostCenter) => !c.isGroup))
      } catch {
        toast.error('Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0)
  const difference = totalDebit - totalCredit

  function addRow() {
    setLines([...lines, newLineItem()])
  }

  function removeRow(id: string) {
    if (lines.length <= 2) {
      toast.error('A template must have at least 2 lines')
      return
    }
    setLines(lines.filter((l) => l.id !== id))
  }

  function updateLine(id: string, field: keyof LineItem, value: string) {
    setLines(lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)))
  }

  function getAccountType(accountId: string): string {
    const account = accounts.find((a) => a.id === accountId)
    return account?.accountType || ''
  }

  function isPartyAccount(accountId: string): boolean {
    const type = getAccountType(accountId)
    return type === 'receivable' || type === 'payable'
  }

  function isIncomeOrExpenseAccount(accountId: string): boolean {
    const type = getAccountType(accountId)
    return type === 'income_account' || type === 'expense_account'
  }

  function handleAccountChange(lineId: string, accountId: string) {
    const account = accounts.find((a) => a.id === accountId)
    const updates: Partial<LineItem> = { accountId }

    if (account?.accountType === 'receivable') {
      updates.partyType = 'customer'
      updates.partyId = ''
    } else if (account?.accountType === 'payable') {
      updates.partyType = 'supplier'
      updates.partyId = ''
    } else {
      updates.partyType = ''
      updates.partyId = ''
    }

    setLines(lines.map((l) => (l.id === lineId ? { ...l, ...updates } : l)))
  }

  function getPartySearchFn(partyType: string) {
    if (partyType === 'customer') return searchCustomers
    if (partyType === 'supplier') return searchSuppliers
    return null
  }

  function validate(): boolean {
    if (!name.trim()) {
      toast.error('Name is required')
      return false
    }

    if (!startDate) {
      toast.error('Start date is required')
      return false
    }

    if (endDate && endDate < startDate) {
      toast.error('End date must be after start date')
      return false
    }

    const validLines = lines.filter((l) => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
    if (validLines.length < 2) {
      toast.error('At least 2 line items with accounts and amounts are required')
      return false
    }

    const lineDebit = validLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0)
    const lineCredit = validLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0)
    if (Math.round((lineDebit - lineCredit) * 100) / 100 !== 0) {
      toast.error('Total debits must equal total credits')
      return false
    }

    for (const line of validLines) {
      if (parseFloat(line.debit) && parseFloat(line.credit)) {
        toast.error('A line item cannot have both debit and credit amounts')
        return false
      }
    }

    // Validate party required for receivable/payable accounts
    for (const line of validLines) {
      const accountType = getAccountType(line.accountId)
      if ((accountType === 'receivable' || accountType === 'payable') && !line.partyId) {
        const account = accounts.find((a) => a.id === line.accountId)
        toast.error(`Party is required for account "${account?.name || 'Unknown'}" (${accountType})`)
        return false
      }
    }

    // Validate cost center required for income/expense accounts
    if (costCenters.length > 0) {
      for (const line of validLines) {
        if (isIncomeOrExpenseAccount(line.accountId) && !line.costCenterId) {
          const account = accounts.find((a) => a.id === line.accountId)
          toast.error(`Cost Center is required for account "${account?.name || 'Unknown'}" (${getAccountType(line.accountId)})`)
          return false
        }
      }
    }

    return true
  }

  async function handleSave() {
    if (!validate()) return

    setSaving(true)
    try {
      const validLines = lines
        .filter((l) => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
        .map((l) => ({
          accountId: l.accountId,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          partyType: l.partyType || null,
          partyId: l.partyId || null,
          costCenterId: l.costCenterId || null,
          remarks: l.remarks || null,
        }))

      const body = {
        name: name.trim(),
        entryType,
        recurrencePattern,
        startDate,
        endDate: endDate || null,
        remarks: remarks || null,
        items: validLines,
      }

      const res = await fetch('/api/accounting/recurring-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to create recurring entry template')
        return
      }

      const created = await res.json()
      toast.success('Recurring entry template created')
      router.push(`/c/${tenantSlug}/accounting/recurring-entries/${created.id}`)
    } catch {
      toast.error('Error creating recurring entry template')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <PageLoading text="Loading..." />
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
  const selectClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/accounting`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Accounting
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/accounting/recurring-entries`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Recurring Entries
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">New</span>
      </div>

      {/* Title */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New Recurring Entry Template</h1>
      </div>

      {/* Header Fields */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Template Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="e.g., Monthly Rent, Quarterly Depreciation"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Entry Type
            </label>
            <select
              value={entryType}
              onChange={(e) => setEntryType(e.target.value)}
              className={selectClass}
            >
              {entryTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Recurrence Pattern *
            </label>
            <select
              value={recurrencePattern}
              onChange={(e) => setRecurrencePattern(e.target.value)}
              className={selectClass}
            >
              {recurrencePatterns.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Start Date *
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Remarks
            </label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className={inputClass}
              placeholder="Optional remarks..."
            />
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Line Items</h2>
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
          >
            <Plus size={14} />
            Add Row
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Recurring entry template line items</caption>
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[250px]">
                  Account *
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[130px]">
                  Debit
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[130px]">
                  Credit
                </th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[120px]">
                  Party Type
                </th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[180px]">
                  Party
                </th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[160px]">
                  Cost Center
                </th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[160px]">
                  Remarks
                </th>
                <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400 w-[50px]">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const showParty = isPartyAccount(line.accountId) || line.partyType
                const partySearchFn = getPartySearchFn(line.partyType)

                return (
                  <tr key={line.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2">
                      <select
                        value={line.accountId}
                        onChange={(e) => handleAccountChange(line.id, e.target.value)}
                        className={selectClass}
                      >
                        <option value="">Select account...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountNumber} - {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={line.debit}
                        onChange={(e) => updateLine(line.id, 'debit', e.target.value)}
                        className={`${inputClass} text-right`}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={line.credit}
                        onChange={(e) => updateLine(line.id, 'credit', e.target.value)}
                        className={`${inputClass} text-right`}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="px-4 py-2">
                      {showParty ? (
                        <select
                          value={line.partyType}
                          onChange={(e) => {
                            setLines(lines.map((l) =>
                              l.id === line.id ? { ...l, partyType: e.target.value, partyId: '' } : l
                            ))
                          }}
                          className={selectClass}
                        >
                          {partyTypes.map((pt) => (
                            <option key={pt.value} value={pt.value}>
                              {pt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-gray-500 px-1">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {showParty && line.partyType && partySearchFn ? (
                        <AsyncCreatableSelect
                          fetchOptions={partySearchFn}
                          value={line.partyId}
                          onChange={(val, option) => {
                            updateLine(line.id, 'partyId', val)
                            if (option) {
                              setPartyOptions(prev => ({ ...prev, [line.id]: option }))
                            }
                          }}
                          placeholder={`Search ${line.partyType}...`}
                          selectedOption={partyOptions[line.id] || null}
                        />
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-gray-500 px-1">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={line.costCenterId}
                        onChange={(e) => updateLine(line.id, 'costCenterId', e.target.value)}
                        className={selectClass}
                      >
                        <option value="">None</option>
                        {costCenters.map((cc) => (
                          <option key={cc.id} value={cc.id}>
                            {cc.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={line.remarks}
                        onChange={(e) => updateLine(line.id, 'remarks', e.target.value)}
                        className={inputClass}
                        placeholder="Line remarks..."
                      />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => removeRow(line.id)}
                        className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        aria-label="Remove row"
                      >
                        <X size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right">
                  Totals
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                  {formatCurrency(totalDebit, currency)}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                  {formatCurrency(totalCredit, currency)}
                </td>
                <td colSpan={5} className="px-4 py-3">
                  {Math.abs(difference) > 0.01 && (
                    <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                      Difference: {formatCurrency(Math.abs(difference), currency)}
                    </span>
                  )}
                  {Math.abs(difference) <= 0.01 && totalDebit > 0 && (
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                      Balanced
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3">
        <Link
          href={`/c/${tenantSlug}/accounting/recurring-entries`}
          className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </Link>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Template
        </button>
      </div>
    </div>
  )
}

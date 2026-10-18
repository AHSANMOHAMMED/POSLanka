'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  ChevronRight,
  Plus,
  X,
  Loader2,
  Save,
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'

interface Account {
  id: string
  accountNumber: string
  name: string
  rootType: string
  accountType: string
  isGroup: boolean
}

interface FiscalYear {
  id: string
  name: string
  startDate: string
  endDate: string
  isClosed: boolean
}

interface CostCenter {
  id: string
  name: string
  isGroup: boolean
  isActive: boolean
}

interface BudgetItemForm {
  accountId: string
  monthlyAmount: string
  annualAmount: string
  controlAction: 'warn' | 'stop' | 'ignore'
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

const emptyItem: BudgetItemForm = {
  accountId: '',
  monthlyAmount: '',
  annualAmount: '',
  controlAction: 'warn',
}

export default function NewBudgetPage() {
  const params = useParams()
  const slug = params.slug as string
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])

  const [form, setForm] = useState({
    name: '',
    fiscalYearId: '',
    costCenterId: '',
    status: 'draft' as 'draft' | 'active',
  })
  const [items, setItems] = useState<BudgetItemForm[]>([{ ...emptyItem }])

  useEffect(() => {
    async function fetchData() {
      try {
        const [fyRes, ccRes, accRes] = await Promise.all([
          fetch('/api/accounting/fiscal-years?all=true'),
          fetch('/api/accounting/cost-centers?all=true'),
          fetch('/api/accounting/accounts?all=true'),
        ])

        if (fyRes.ok) {
          const data = await fyRes.json()
          setFiscalYears(Array.isArray(data) ? data : data.data || [])
        }
        if (ccRes.ok) {
          const data = await ccRes.json()
          const flat = Array.isArray(data) ? data : data.data || []
          setCostCenters(flat.filter((cc: CostCenter) => !cc.isGroup && cc.isActive))
        }
        if (accRes.ok) {
          const data = await accRes.json()
          const allAccounts = Array.isArray(data) ? data : data.data || []
          // Filter to non-group expense and income accounts
          setAccounts(
            allAccounts.filter(
              (a: Account) =>
                !a.isGroup &&
                (a.rootType === 'expense' || a.rootType === 'income')
            )
          )
        }
      } catch {
        toast.error('Failed to load form data')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  function addItem() {
    setItems([...items, { ...emptyItem }])
  }

  function removeItem(index: number) {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  function updateItem(index: number, field: keyof BudgetItemForm, value: string) {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }

    // Auto-calculate annual amount when monthly changes
    if (field === 'monthlyAmount' && value) {
      const monthly = parseFloat(value)
      if (!isNaN(monthly)) {
        newItems[index].annualAmount = (monthly * 12).toFixed(2)
      }
    }

    // Auto-calculate monthly amount when annual changes
    if (field === 'annualAmount' && value) {
      const annual = parseFloat(value)
      if (!isNaN(annual)) {
        newItems[index].monthlyAmount = (annual / 12).toFixed(2)
      }
    }

    setItems(newItems)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Budget name is required')
      return
    }

    const validItems = items.filter((item) => item.accountId && (item.monthlyAmount || item.annualAmount))
    if (validItems.length === 0) {
      toast.error('At least one budget item with an account and amount is required')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        fiscalYearId: form.fiscalYearId || null,
        costCenterId: form.costCenterId || null,
        status: form.status,
        items: validItems.map((item) => ({
          accountId: item.accountId,
          monthlyAmount: parseFloat(item.monthlyAmount) || 0,
          annualAmount: parseFloat(item.annualAmount) || 0,
          controlAction: item.controlAction,
        })),
      }

      const res = await fetch('/api/accounting/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success('Budget created successfully')
        router.push(`/c/${slug}/accounting/budgets`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create budget')
      }
    } catch {
      toast.error('Error creating budget')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <PageLoading text="Loading..." />
  }

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Breadcrumb */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={`/c/${slug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
            <Home size={14} />
          </Link>
          <ChevronRight size={14} />
          <Link href={`/c/${slug}/accounting`} className="hover:text-blue-600 dark:hover:text-blue-400">
            Accounting
          </Link>
          <ChevronRight size={14} />
          <Link href={`/c/${slug}/accounting/budgets`} className="hover:text-blue-600 dark:hover:text-blue-400">
            Budgets
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">New Budget</span>
        </div>
      </div>

      {/* Title Bar */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New Budget</h1>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4">
        <form onSubmit={handleSave} className="max-w-5xl mx-auto space-y-6">
          {/* Budget Details */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Budget Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Budget Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. FY 2025-2026 Operating Budget"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as 'draft' | 'active' })}
                  className={selectClass}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Fiscal Year
                </label>
                <select
                  value={form.fiscalYearId}
                  onChange={(e) => setForm({ ...form, fiscalYearId: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Select fiscal year</option>
                  {fiscalYears.map((fy) => (
                    <option key={fy.id} value={fy.id}>
                      {fy.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Cost Center
                </label>
                <select
                  value={form.costCenterId}
                  onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Select cost center</option>
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Budget Items */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Budget Items</h2>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              >
                <Plus size={14} />
                Add Row
              </button>
            </div>

            <div className="border border-gray-200 dark:border-gray-700 rounded overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Account *
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-36">
                      Monthly Amount
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-36">
                      Annual Amount
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-32">
                      Control Action
                    </th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item, index) => (
                    <tr key={index} className="bg-white dark:bg-gray-800">
                      <td className="px-3 py-2">
                        <select
                          value={item.accountId}
                          onChange={(e) => updateItem(index, 'accountId', e.target.value)}
                          className={selectClass}
                        >
                          <option value="">Select account</option>
                          {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.accountNumber} - {acc.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.monthlyAmount}
                          onChange={(e) => updateItem(index, 'monthlyAmount', e.target.value)}
                          className={inputClass}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.annualAmount}
                          onChange={(e) => updateItem(index, 'annualAmount', e.target.value)}
                          className={inputClass}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.controlAction}
                          onChange={(e) => updateItem(index, 'controlAction', e.target.value)}
                          className={selectClass}
                        >
                          <option value="warn">Warn</option>
                          <option value="stop">Stop</option>
                          <option value="ignore">Ignore</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            aria-label="Remove row"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => router.push(`/c/${slug}/accounting/budgets`)}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Budget
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

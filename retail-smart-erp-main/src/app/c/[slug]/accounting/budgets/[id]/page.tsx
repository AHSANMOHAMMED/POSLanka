'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  ChevronRight,
  Plus,
  X,
  Loader2,
  Save,
  Trash2,
  Ban,
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StatusBadge } from '@/components/ui'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

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

interface BudgetItem {
  id?: string
  accountId: string
  monthlyAmount: string
  annualAmount: string
  controlAction: 'warn' | 'stop' | 'ignore'
  account?: Account
}

interface Budget {
  id: string
  name: string
  fiscalYearId: string | null
  costCenterId: string | null
  status: 'draft' | 'active' | 'cancelled'
  items: BudgetItem[]
  createdAt: string
  updatedAt: string
  fiscalYear?: FiscalYear | null
  costCenter?: CostCenter | null
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

const emptyItem: BudgetItem = {
  accountId: '',
  monthlyAmount: '',
  annualAmount: '',
  controlAction: 'warn',
}

export default function BudgetDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const id = params.id as string
  const router = useRouter()

  const [budget, setBudget] = useState<Budget | null>(null)
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
  const [items, setItems] = useState<BudgetItem[]>([{ ...emptyItem }])

  const fetchBudget = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounting/budgets/${id}`)
      if (res.ok) {
        const data = await res.json()
        const b = data.data || data
        setBudget(b)
        setForm({
          name: b.name,
          fiscalYearId: b.fiscalYearId || '',
          costCenterId: b.costCenterId || '',
          status: b.status === 'cancelled' ? 'draft' : b.status,
        })
        setItems(
          b.items && b.items.length > 0
            ? b.items.map((item: BudgetItem) => ({
                id: item.id,
                accountId: item.accountId,
                monthlyAmount: String(item.monthlyAmount || ''),
                annualAmount: String(item.annualAmount || ''),
                controlAction: item.controlAction || 'warn',
              }))
            : [{ ...emptyItem }]
        )
      } else {
        toast.error('Budget not found')
        router.push(`/c/${slug}/accounting/budgets`)
      }
    } catch {
      toast.error('Failed to load budget')
    } finally {
      setLoading(false)
    }
  }, [id, slug, router])

  useRealtimeData(fetchBudget, { entityType: 'budget', filterIds: [id] })

  useEffect(() => {
    async function fetchReferenceData() {
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
          setAccounts(
            allAccounts.filter(
              (a: Account) =>
                !a.isGroup &&
                (a.rootType === 'expense' || a.rootType === 'income')
            )
          )
        }
      } catch {
        // Silent fail - dropdowns will be empty
      }
    }
    fetchReferenceData()
  }, [])

  function addItem() {
    setItems([...items, { ...emptyItem }])
  }

  function removeItem(index: number) {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  function updateItem(index: number, field: keyof BudgetItem, value: string) {
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
        expectedUpdatedAt: budget?.updatedAt,
        items: validItems.map((item) => ({
          id: item.id,
          accountId: item.accountId,
          monthlyAmount: parseFloat(item.monthlyAmount as string) || 0,
          annualAmount: parseFloat(item.annualAmount as string) || 0,
          controlAction: item.controlAction,
        })),
      }

      const res = await fetch(`/api/accounting/budgets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success('Budget updated successfully')
        fetchBudget()
      } else if (res.status === 409) {
        toast.error('This record was modified by another user. Please refresh and try again.')
        fetchBudget()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update budget')
      }
    } catch {
      toast.error('Error updating budget')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/accounting/budgets/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Budget deleted')
      router.push(`/c/${slug}/accounting/budgets`)
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to delete budget')
    }
  }

  async function handleCancel() {
    const res = await fetch(`/api/accounting/budgets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', expectedUpdatedAt: budget?.updatedAt }),
    })
    if (res.ok) {
      toast.success('Budget cancelled')
      fetchBudget()
    } else if (res.status === 409) {
      toast.error('This record was modified by another user. Please refresh and try again.')
      fetchBudget()
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to cancel budget')
    }
  }

  if (loading) {
    return <PageLoading text="Loading budget..." />
  }

  if (!budget) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500 dark:text-gray-400">Budget not found</p>
      </div>
    )
  }

  const isDraft = budget.status === 'draft'
  const isActive = budget.status === 'active'
  const isCancelled = budget.status === 'cancelled'
  const isEditable = isDraft

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
          <span className="text-gray-900 dark:text-white font-medium">{budget.name}</span>
        </div>
      </div>

      {/* Title Bar */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{budget.name}</h1>
            <StatusBadge status={budget.status} />
          </div>
          <div className="flex items-center gap-2" />

        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4">
        <form onSubmit={handleSave} className="max-w-5xl mx-auto space-y-6">
          {isCancelled && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 text-sm text-red-700 dark:text-red-300">
              This budget has been cancelled and cannot be edited.
            </div>
          )}

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
                  disabled={!isEditable}
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
                  disabled={!isEditable}
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
                  disabled={!isEditable}
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
                  disabled={!isEditable}
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
              {isEditable && (
                <button
                  type="button"
                  onClick={addItem}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                >
                  <Plus size={14} />
                  Add Row
                </button>
              )}
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
                    {isEditable && <th className="px-3 py-2 w-10" />}
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
                          disabled={!isEditable}
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
                          disabled={!isEditable}
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
                          disabled={!isEditable}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.controlAction}
                          onChange={(e) => updateItem(index, 'controlAction', e.target.value)}
                          className={selectClass}
                          disabled={!isEditable}
                        >
                          <option value="warn">Warn</option>
                          <option value="stop">Stop</option>
                          <option value="ignore">Ignore</option>
                        </select>
                      </td>
                      {isEditable && (
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
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Save button for editable form */}
          {isEditable && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Comments & Activity */}
      <DocumentCommentsAndActivity
        documentType="budget"
        documentId={id}
        entityType="budget"
      />

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        if (isDraft) {
          a.push({
            key: 'delete',
            label: 'Delete',
            icon: <Trash2 size={14} />,
            variant: 'danger',
            position: 'left',
            onClick: handleDelete,
            confirmation: {
              title: 'Delete Budget',
              message: `Are you sure you want to delete "${budget.name}"? This will also remove all budget items. This action cannot be undone.`,
              variant: 'danger',
              confirmText: 'Delete',
            },
          })
        }
        if (isActive) {
          a.push({
            key: 'cancel',
            label: 'Cancel Budget',
            icon: <Ban size={14} />,
            variant: 'danger',
            position: 'left',
            onClick: handleCancel,
            confirmation: {
              title: 'Cancel Budget',
              message: `Are you sure you want to cancel "${budget.name}"? A cancelled budget cannot be edited.`,
              variant: 'warning',
              confirmText: 'Cancel Budget',
            },
          })
        }
        return a
      })()} />
    </div>
  )
}

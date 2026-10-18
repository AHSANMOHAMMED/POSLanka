'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  ChevronRight,
  Edit2,
  Trash2,
  ArrowLeft,
  Play,
  Power,
  Save,
  X,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeDocument, useDateFormat, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StatusBadge } from '@/components/ui'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { formatCurrency } from '@/lib/utils/currency'
import { AsyncCreatableSelect, AsyncSelectOption } from '@/components/ui/async-creatable-select'

interface TemplateItem {
  accountId: string
  debit: number
  credit: number
  partyType: string | null
  partyId: string | null
  costCenterId: string | null
  remarks: string | null
}

interface RecurringTemplate {
  id: string
  name: string
  isActive: boolean
  entryType: string
  remarks: string | null
  recurrencePattern: string
  startDate: string
  endDate: string | null
  nextRunDate: string | null
  items: TemplateItem[]
  lastGeneratedAt: string | null
  createdAt: string
  updatedAt: string
}

interface Account {
  id: string
  accountNumber: string
  name: string
  accountType: string
  isGroup: boolean
}

interface CostCenter {
  id: string
  name: string
  isGroup: boolean
}

interface EditLineItem {
  id: string
  accountId: string
  debit: string
  credit: string
  partyType: string
  partyId: string
  costCenterId: string
  remarks: string
}

const patternLabels: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
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

let editLineCounter = 0
function newEditLine(): EditLineItem {
  editLineCounter++
  return {
    id: `edit-line-${editLineCounter}-${Date.now()}`,
    accountId: '',
    debit: '',
    credit: '',
    partyType: '',
    partyId: '',
    costCenterId: '',
    remarks: '',
  }
}

export default function RecurringEntryDetailPage() {
  const { tenantSlug } = useCompany()
  const { fDate, fDateTime } = useDateFormat()
  const { currency } = useCurrency()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [template, setTemplate] = useState<RecurringTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [toggling, setToggling] = useState(false)



  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEntryType, setEditEntryType] = useState('journal')
  const [editRecurrencePattern, setEditRecurrencePattern] = useState('monthly')
  const [editStartDate, setEditStartDate] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const [editLines, setEditLines] = useState<EditLineItem[]>([])

  // Accounts and cost centers for edit mode
  const [accounts, setAccounts] = useState<Account[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
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

  const fetchTemplate = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounting/recurring-entries/${id}`)
      if (res.ok) {
        const data = await res.json()
        setTemplate(data)
      } else {
        toast.error('Failed to load recurring entry template')
      }
    } catch {
      toast.error('Error loading recurring entry template')
    } finally {
      setLoading(false)
    }
  }, [id])

  const { otherUsers } = useRealtimeDocument('recurring-entry', id, fetchTemplate)

  // Load accounts when entering edit mode
  useEffect(() => {
    if (editing && !accountsLoaded) {
      async function loadAccountData() {
        try {
          const [accountsRes, costCentersRes] = await Promise.all([
            fetch('/api/accounting/accounts?all=true').then((r) => r.json()),
            fetch('/api/accounting/cost-centers?all=true').then((r) => r.json()),
          ])

          const accountList = Array.isArray(accountsRes) ? accountsRes : accountsRes.data || []
          setAccounts(accountList.filter((a: Account) => !a.isGroup))

          const costCenterList = Array.isArray(costCentersRes) ? costCentersRes : costCentersRes.data || []
          setCostCenters(costCenterList.filter((c: CostCenter) => !c.isGroup))
          setAccountsLoaded(true)
        } catch {
          toast.error('Failed to load accounts')
        }
      }
      loadAccountData()
    }
  }, [editing, accountsLoaded])

  function enterEditMode() {
    if (!template) return
    setEditName(template.name)
    setEditEntryType(template.entryType)
    setEditRecurrencePattern(template.recurrencePattern)
    setEditStartDate(template.startDate)
    setEditEndDate(template.endDate || '')
    setEditRemarks(template.remarks || '')
    setEditLines(
      (template.items || []).map((item, idx) => ({
        id: `edit-line-${idx}-${Date.now()}`,
        accountId: item.accountId,
        debit: item.debit ? String(item.debit) : '',
        credit: item.credit ? String(item.credit) : '',
        partyType: item.partyType || '',
        partyId: item.partyId || '',
        costCenterId: item.costCenterId || '',
        remarks: item.remarks || '',
      }))
    )
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
  }

  function addEditRow() {
    setEditLines([...editLines, newEditLine()])
  }

  function removeEditRow(lineId: string) {
    if (editLines.length <= 2) {
      toast.error('A template must have at least 2 lines')
      return
    }
    setEditLines(editLines.filter((l) => l.id !== lineId))
  }

  function updateEditLine(lineId: string, field: keyof EditLineItem, value: string) {
    setEditLines(editLines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)))
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

  function handleEditAccountChange(lineId: string, accountId: string) {
    const account = accounts.find((a) => a.id === accountId)
    const updates: Partial<EditLineItem> = { accountId }

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

    setEditLines(editLines.map((l) => (l.id === lineId ? { ...l, ...updates } : l)))
  }

  function getPartySearchFn(partyType: string) {
    if (partyType === 'customer') return searchCustomers
    if (partyType === 'supplier') return searchSuppliers
    return null
  }

  async function handleSave() {
    if (!template) return

    if (!editName.trim()) {
      toast.error('Name is required')
      return
    }

    const validLines = editLines.filter((l) => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
    if (validLines.length < 2) {
      toast.error('At least 2 line items with accounts and amounts are required')
      return
    }

    const totalDebit = validLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0)
    const totalCredit = validLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0)
    if (Math.round((totalDebit - totalCredit) * 100) / 100 !== 0) {
      toast.error('Total debits must equal total credits')
      return
    }

    for (const line of validLines) {
      if (parseFloat(line.debit) && parseFloat(line.credit)) {
        toast.error('A line item cannot have both debit and credit amounts')
        return
      }
    }

    // Validate party required for receivable/payable accounts
    for (const line of validLines) {
      const accountType = getAccountType(line.accountId)
      if ((accountType === 'receivable' || accountType === 'payable') && !line.partyId) {
        const account = accounts.find((a) => a.id === line.accountId)
        toast.error(`Party is required for account "${account?.name || 'Unknown'}" (${accountType})`)
        return
      }
    }

    // Validate cost center required for income/expense accounts
    if (costCenters.length > 0) {
      for (const line of validLines) {
        if (isIncomeOrExpenseAccount(line.accountId) && !line.costCenterId) {
          const account = accounts.find((a) => a.id === line.accountId)
          toast.error(`Cost Center is required for account "${account?.name || 'Unknown'}" (${getAccountType(line.accountId)})`)
          return
        }
      }
    }

    if (editEndDate && editEndDate < editStartDate) {
      toast.error('End date must be after start date')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/accounting/recurring-entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedUpdatedAt: template.updatedAt,
          name: editName.trim(),
          entryType: editEntryType,
          recurrencePattern: editRecurrencePattern,
          startDate: editStartDate,
          endDate: editEndDate || null,
          remarks: editRemarks || null,
          items: validLines.map((l) => ({
            accountId: l.accountId,
            debit: parseFloat(l.debit) || 0,
            credit: parseFloat(l.credit) || 0,
            partyType: l.partyType || null,
            partyId: l.partyId || null,
            costCenterId: l.costCenterId || null,
            remarks: l.remarks || null,
          })),
        }),
      })

      if (res.status === 409) {
        toast.error('This record was modified by another user. Please refresh and try again.')
        fetchTemplate()
        setEditing(false)
        return
      }

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to update template')
        return
      }

      toast.success('Template updated')
      setEditing(false)
      fetchTemplate()
    } catch {
      toast.error('Error updating template')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/accounting/recurring-entries/${id}/generate`, {
        method: 'POST',
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(data.message || 'Journal entry generated successfully')
        fetchTemplate()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to generate journal entry')
      }
    } catch {
      toast.error('Error generating journal entry')
    } finally {
      setGenerating(false)
    }
  }

  async function handleToggleActive() {
    if (!template) return
    setToggling(true)
    try {
      const res = await fetch(`/api/accounting/recurring-entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedUpdatedAt: template.updatedAt,
          isActive: !template.isActive,
        }),
      })

      if (res.status === 409) {
        toast.error('This record was modified by another user. Please refresh and try again.')
        fetchTemplate()
        return
      }

      if (res.ok) {
        toast.success(template.isActive ? 'Template deactivated' : 'Template activated')
        fetchTemplate()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update template')
      }
    } catch {
      toast.error('Error updating template')
    } finally {
      setToggling(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/accounting/recurring-entries/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Recurring entry template deleted')
      router.push(`/c/${tenantSlug}/accounting/recurring-entries`)
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to delete template')
    }
  }

  function getAccountDisplay(accountId: string): string {
    if (accountsLoaded) {
      const account = accounts.find((a) => a.id === accountId)
      if (account) return `${account.accountNumber} - ${account.name}`
    }
    return accountId
  }

  if (loading) {
    return <PageLoading text="Loading recurring entry template..." />
  }

  if (!template) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500 dark:text-gray-400">Recurring entry template not found.</p>
        <Link
          href={`/c/${tenantSlug}/accounting/recurring-entries`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Recurring Entries
        </Link>
      </div>
    )
  }

  const items = template.items || []
  const totalDebit = items.reduce((sum, item) => sum + Number(item.debit || 0), 0)
  const totalCredit = items.reduce((sum, item) => sum + Number(item.credit || 0), 0)

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
        <span className="text-gray-900 dark:text-white font-medium">{template.name}</span>
      </div>

      {/* Other users viewing */}
      {otherUsers && otherUsers.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-800 dark:text-yellow-300">
          <RefreshCw size={14} />
          <span>
            Also viewing: {otherUsers.map((u) => u.userName || 'Unknown').join(', ')}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {editing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Template Name *
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Entry Type
                  </label>
                  <select
                    value={editEntryType}
                    onChange={(e) => setEditEntryType(e.target.value)}
                    className={selectClass}
                  >
                    {entryTypes.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Recurrence Pattern
                  </label>
                  <select
                    value={editRecurrencePattern}
                    onChange={(e) => setEditRecurrencePattern(e.target.value)}
                    className={selectClass}
                  >
                    {recurrencePatterns.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Remarks
                  </label>
                  <input
                    type="text"
                    value={editRemarks}
                    onChange={(e) => setEditRemarks(e.target.value)}
                    className={inputClass}
                    placeholder="Optional remarks..."
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {template.name}
                  </h1>
                  <StatusBadge status={template.isActive ? 'active' : 'inactive'} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Entry Type</span>
                    <p className="font-medium text-gray-900 dark:text-white capitalize">
                      {template.entryType}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Recurrence</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {patternLabels[template.recurrencePattern] || template.recurrencePattern}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Start Date</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {fDate(template.startDate + 'T00:00:00')}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">End Date</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {template.endDate
                        ? fDate(template.endDate + 'T00:00:00')
                        : 'No end date'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Next Run Date</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {template.nextRunDate
                        ? fDate(template.nextRunDate + 'T00:00:00')
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Last Generated</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {template.lastGeneratedAt
                        ? fDateTime(template.lastGeneratedAt)
                        : 'Never'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Total Debit</span>
                    <p className="font-medium text-gray-900 dark:text-white font-mono">
                      {formatCurrency(totalDebit, currency)}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Total Credit</span>
                    <p className="font-medium text-gray-900 dark:text-white font-mono">
                      {formatCurrency(totalCredit, currency)}
                    </p>
                  </div>
                </div>
                {template.remarks && (
                  <div className="mt-3 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Remarks: </span>
                    <span className="text-gray-900 dark:text-white">{template.remarks}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Action Buttons (view mode only) */}
          {!editing && (
            <div className="flex items-center gap-2 ml-4 flex-shrink-0" />
          )}

          {editing && (
            <div className="flex items-center gap-2 ml-4 flex-shrink-0" />
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Line Items</h2>
          {editing && (
            <button
              onClick={addEditRow}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
            >
              <Plus size={14} />
              Add Row
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          {editing ? (
            <table className="w-full">
              <caption className="sr-only">Edit recurring entry template line items</caption>
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
                {editLines.map((line) => {
                  const showParty = isPartyAccount(line.accountId) || line.partyType
                  const partySearchFn = getPartySearchFn(line.partyType)

                  return (
                    <tr key={line.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2">
                        <select
                          value={line.accountId}
                          onChange={(e) => handleEditAccountChange(line.id, e.target.value)}
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
                          onChange={(e) => updateEditLine(line.id, 'debit', e.target.value)}
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
                          onChange={(e) => updateEditLine(line.id, 'credit', e.target.value)}
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
                              setEditLines(editLines.map((l) =>
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
                              updateEditLine(line.id, 'partyId', val)
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
                          onChange={(e) => updateEditLine(line.id, 'costCenterId', e.target.value)}
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
                          onChange={(e) => updateEditLine(line.id, 'remarks', e.target.value)}
                          className={inputClass}
                          placeholder="Line remarks..."
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => removeEditRow(line.id)}
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
                    {formatCurrency(editLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0), currency)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(editLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0), currency)}
                  </td>
                  <td colSpan={5} className="px-4 py-3">
                    {(() => {
                      const editDebit = editLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0)
                      const editCredit = editLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0)
                      const diff = editDebit - editCredit
                      if (Math.abs(diff) > 0.01) {
                        return (
                          <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                            Difference: {formatCurrency(Math.abs(diff), currency)}
                          </span>
                        )
                      }
                      if (editDebit > 0) {
                        return (
                          <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                            Balanced
                          </span>
                        )
                      }
                      return null
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="w-full">
              <caption className="sr-only">Recurring entry template line items</caption>
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                    Debit
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                    Credit
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                    Party Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                    Party
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                    Remarks
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const debit = Number(item.debit || 0)
                  const credit = Number(item.credit || 0)
                  return (
                    <tr
                      key={idx}
                      className="border-t border-gray-100 dark:border-gray-700"
                    >
                      <td className="px-4 py-2.5">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {getAccountDisplay(item.accountId)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                        {debit > 0 ? (
                          <span className="text-gray-900 dark:text-white">{formatCurrency(debit, currency)}</span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                        {credit > 0 ? (
                          <span className="text-gray-900 dark:text-white">{formatCurrency(credit, currency)}</span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 capitalize">
                        {item.partyType || '-'}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                        {item.partyId || '-'}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                        {item.remarks || '-'}
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
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* Comments & Activity */}
      <DocumentCommentsAndActivity
        documentType="recurring_entry"
        documentId={id}
        entityType="recurring-entry"
      />

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        if (editing) {
          a.push({
            key: 'cancel-edit',
            label: 'Cancel',
            icon: <X size={14} />,
            variant: 'outline',
            position: 'left',
            onClick: cancelEdit,
          })
          a.push({
            key: 'save',
            label: 'Save Changes',
            icon: <Save size={14} />,
            variant: 'primary',
            loading: saving,
            onClick: handleSave,
          })
          return a
        }
        a.push({
          key: 'delete',
          label: 'Delete',
          icon: <Trash2 size={14} />,
          variant: 'danger',
          position: 'left',
          onClick: handleDelete,
          confirmation: {
            title: 'Delete Recurring Entry Template',
            message: `Are you sure you want to delete "${template.name}"? This action cannot be undone.`,
            variant: 'danger',
            confirmText: 'Delete',
          },
        })
        a.push({
          key: 'edit',
          label: 'Edit',
          icon: <Edit2 size={14} />,
          variant: 'outline',
          onClick: enterEditMode,
        })
        a.push({
          key: 'toggle',
          label: template.isActive ? 'Deactivate' : 'Activate',
          icon: <Power size={14} />,
          variant: template.isActive ? 'warning' : 'success',
          loading: toggling,
          onClick: handleToggleActive,
        })
        if (template.isActive && template.nextRunDate) {
          a.push({
            key: 'generate',
            label: 'Generate Next Entry',
            icon: <Play size={14} />,
            variant: 'success',
            loading: generating,
            onClick: handleGenerate,
            confirmation: {
              title: 'Generate Journal Entry',
              message: `Generate the next journal entry from "${template.name}"?`,
              variant: 'success',
              confirmText: 'Generate',
            },
          })
        }
        return a
      })()} />
    </div>
  )
}

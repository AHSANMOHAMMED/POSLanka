'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  Folder,
  FileText,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { formatCurrency } from '@/lib/utils/currency'
interface Account {
  id: string
  accountNumber: string
  name: string
  rootType: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  accountType: string
  parentId: string | null
  isGroup: boolean
  isSystemAccount: boolean
  balance: string
  description: string | null
  children?: Account[]
}

const rootTypeColors: Record<string, string> = {
  asset: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  liability: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  equity: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  income: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  expense: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
}

const rootTypes = ['asset', 'liability', 'equity', 'income', 'expense'] as const

const accountTypeLabels: Record<string, string> = {
  bank: 'Bank',
  cash: 'Cash',
  fixed_asset: 'Fixed Asset',
  receivable: 'Receivable',
  stock: 'Stock',
  current_asset: 'Current Asset',
  accumulated_depreciation: 'Accumulated Depreciation',
  depreciation: 'Depreciation',
  capital_work_in_progress: 'Capital Work In Progress',
  payable: 'Payable',
  current_liability: 'Current Liability',
  tax: 'Tax',
  equity: 'Equity',
  income_account: 'Income',
  expense_account: 'Expense',
  cost_of_goods_sold: 'Cost of Goods Sold',
  round_off: 'Round Off',
  temporary: 'Temporary',
}

const accountTypes: Record<string, string[]> = {
  asset: ['current_asset', 'bank', 'cash', 'receivable', 'stock', 'fixed_asset', 'accumulated_depreciation', 'depreciation', 'capital_work_in_progress'],
  liability: ['current_liability', 'payable', 'tax'],
  equity: ['equity'],
  income: ['income_account'],
  expense: ['expense_account', 'cost_of_goods_sold', 'round_off', 'temporary'],
}

const emptyForm = {
  name: '',
  accountNumber: '',
  rootType: 'asset' as Account['rootType'],
  accountType: '',
  parentId: '',
  isGroup: false,
  description: '',
}

function AccountTreeNode({
  account,
  depth,
  expandedIds,
  toggleExpand,
  onEdit,
  onDelete,
  search,
  currency,
  tenantSlug,
}: {
  account: Account
  depth: number
  expandedIds: Set<string>
  toggleExpand: (id: string) => void
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
  search: string
  currency: string
  tenantSlug: string
}) {
  const isExpanded = expandedIds.has(account.id)
  const hasChildren = account.children && account.children.length > 0
  const balance = parseFloat(account.balance || '0')
  const searchLower = search.toLowerCase()

  // Check if this node or any descendant matches the search
  const matchesSelf =
    !search ||
    account.name.toLowerCase().includes(searchLower) ||
    account.accountNumber.toLowerCase().includes(searchLower) ||
    account.accountType.toLowerCase().includes(searchLower)

  const hasMatchingDescendant = (acc: Account): boolean => {
    if (!acc.children) return false
    return acc.children.some(
      (child) =>
        child.name.toLowerCase().includes(searchLower) ||
        child.accountNumber.toLowerCase().includes(searchLower) ||
        child.accountType.toLowerCase().includes(searchLower) ||
        hasMatchingDescendant(child)
    )
  }

  const shouldShow = matchesSelf || hasMatchingDescendant(account)
  if (!shouldShow) return null

  return (
    <>
      <tr className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
        <td className="px-4 py-2.5">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => toggleExpand(account.id)}
                className="p-0.5 mr-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <span className="w-[22px] mr-1.5 inline-block" />
            )}
            {account.isGroup ? (
              <Folder size={16} className="mr-2 text-amber-500 dark:text-amber-400 flex-shrink-0" />
            ) : (
              <FileText size={16} className="mr-2 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            )}
            {account.isGroup ? (
              <span className="font-medium text-gray-900 dark:text-white text-sm">
                {account.name}
              </span>
            ) : (
              <Link
                href={`/c/${tenantSlug}/accounting/general-ledger?accountId=${account.id}`}
                className="font-medium text-blue-600 dark:text-blue-400 hover:underline text-sm"
                title="View General Ledger"
              >
                {account.name}
              </Link>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 font-mono">
          {account.accountNumber}
        </td>
        <td className="px-4 py-2.5">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              rootTypeColors[account.rootType] || 'bg-gray-100 text-gray-700'
            }`}
          >
            {accountTypeLabels[account.accountType] || account.accountType}
          </span>
        </td>
        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
          <span className={balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}>
            {formatCurrency(balance, currency)}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onEdit(account)}
              aria-label={`Edit ${account.name}`}
              className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
            >
              <Pencil size={16} />
            </button>
            {!account.isSystemAccount && (
              <button
                onClick={() => onDelete(account)}
                aria-label={`Delete ${account.name}`}
                className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded &&
        hasChildren &&
        account.children!.map((child) => (
          <AccountTreeNode
            key={child.id}
            account={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            toggleExpand={toggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
            search={search}
            currency={currency}
            tenantSlug={tenantSlug}
          />
        ))}
    </>
  )
}

export default function ChartOfAccountsPage() {
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [flatAccounts, setFlatAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteAccount, setDeleteAccount] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [settingUp, setSettingUp] = useState(false)

  const fetchAccounts = useCallback(async () => {
    try {
      const [treeRes, flatRes] = await Promise.all([
        fetch('/api/accounting/accounts?tree=true'),
        fetch('/api/accounting/accounts?all=true'),
      ])
      if (treeRes.ok) {
        const data = await treeRes.json()
        setAccounts(Array.isArray(data) ? data : data.data || [])
        // Auto-expand root level
        const rootIds = (Array.isArray(data) ? data : data.data || []).map((a: Account) => a.id)
        setExpandedIds((prev) => {
          const next = new Set(prev)
          rootIds.forEach((id: string) => next.add(id))
          return next
        })
      }
      if (flatRes.ok) {
        const data = await flatRes.json()
        setFlatAccounts(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      toast.error('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  const { refresh } = useRealtimeData(fetchAccounts, { entityType: 'account' })

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleAdd() {
    setEditingAccount(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function handleEdit(account: Account) {
    setEditingAccount(account)
    setForm({
      name: account.name,
      accountNumber: account.accountNumber,
      rootType: account.rootType,
      accountType: account.accountType,
      parentId: account.parentId || '',
      isGroup: account.isGroup,
      description: account.description || '',
    })
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingAccount(null)
    setForm(emptyForm)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.accountNumber.trim() || !form.accountType) {
      toast.error('Name, account number, and account type are required')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        accountNumber: form.accountNumber.trim(),
        rootType: form.rootType,
        accountType: form.accountType,
        parentId: form.parentId || null,
        isGroup: form.isGroup,
        description: form.description.trim() || null,
      }

      const url = editingAccount
        ? `/api/accounting/accounts/${editingAccount.id}`
        : '/api/accounting/accounts'
      const method = editingAccount ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(editingAccount ? 'Account updated' : 'Account created')
        handleCloseModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save account')
      }
    } catch {
      toast.error('Error saving account')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteAccount) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/accounting/accounts/${deleteAccount.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Account deleted')
        setDeleteAccount(null)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete account')
      }
    } catch {
      toast.error('Error deleting account')
    } finally {
      setDeleting(false)
    }
  }

  // Filter parent account options based on selected rootType (only groups)
  const parentOptions = flatAccounts.filter(
    (a) => a.isGroup && a.rootType === form.rootType && a.id !== editingAccount?.id
  )

  if (loading && accounts.length === 0) {
    return <PageLoading text="Loading chart of accounts..." />
  }

  const selectClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Chart of Accounts"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search accounts..."
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Account
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Chart of Accounts</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Account Name
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Number
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Type
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Balance
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Sparkles size={32} className="text-blue-500 dark:text-blue-400" />
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                      No accounts found. Set up your default Chart of Accounts to get started.
                    </p>
                    <button
                      onClick={async () => {
                        setSettingUp(true)
                        try {
                          const res = await fetch('/api/accounting/setup', { method: 'POST' })
                          if (res.ok) {
                            const data = await res.json()
                            if (data.alreadySetup) {
                              toast.success('Accounting already set up. Refreshing...')
                            } else {
                              toast.success(`Default Chart of Accounts created (${data.accountsCreated} accounts)`)
                            }
                            refresh()
                          } else {
                            const data = await res.json()
                            toast.error(data.error || 'Failed to set up accounting')
                          }
                        } catch {
                          toast.error('Error setting up accounting')
                        } finally {
                          setSettingUp(false)
                        }
                      }}
                      disabled={settingUp}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {settingUp ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Setting up...
                        </>
                      ) : (
                        <>
                          <Sparkles size={16} />
                          Setup Default Accounts
                        </>
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <AccountTreeNode
                  key={account.id}
                  account={account}
                  depth={0}
                  expandedIds={expandedIds}
                  toggleExpand={toggleExpand}
                  onEdit={handleEdit}
                  onDelete={setDeleteAccount}
                  search={search}
                  currency={currency}
                  tenantSlug={tenantSlug}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingAccount ? 'Edit Account' : 'Add Account'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Cash in Hand"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Number *
                </label>
                <input
                  type="text"
                  value={form.accountNumber}
                  onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. 1100"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Root Type *
                </label>
                <select
                  value={form.rootType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rootType: e.target.value as Account['rootType'],
                      accountType: '',
                      parentId: '',
                    })
                  }
                  className={selectClass}
                >
                  {rootTypes.map((rt) => (
                    <option key={rt} value={rt}>
                      {rt.charAt(0).toUpperCase() + rt.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Type *
                </label>
                <select
                  value={form.accountType}
                  onChange={(e) => setForm({ ...form, accountType: e.target.value })}
                  className={selectClass}
                  required
                >
                  <option value="">Select account type</option>
                  {(accountTypes[form.rootType] || []).map((at) => (
                    <option key={at} value={at}>
                      {accountTypeLabels[at] || at}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Parent Account
                </label>
                <select
                  value={form.parentId}
                  onChange={(e) => {
                    const parentId = e.target.value
                    const parent = flatAccounts.find(a => a.id === parentId)
                    setForm({
                      ...form,
                      parentId,
                      ...(parent ? { accountType: parent.accountType } : {}),
                    })
                  }}
                  className={selectClass}
                >
                  <option value="">None (Root Level)</option>
                  {parentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isGroup"
                  checked={form.isGroup}
                  onChange={(e) => setForm({ ...form, isGroup: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isGroup" className="text-sm text-gray-700 dark:text-gray-300">
                  Is Group (container for child accounts)
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputClass}
                  rows={2}
                  placeholder="Optional description"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {editingAccount ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={!!deleteAccount}
        onClose={() => setDeleteAccount(null)}
        onConfirm={handleDelete}
        title="Delete Account"
        message={`Are you sure you want to delete "${deleteAccount?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}

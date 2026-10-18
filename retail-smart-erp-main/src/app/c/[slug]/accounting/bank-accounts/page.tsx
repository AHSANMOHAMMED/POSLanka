'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, Landmark, CheckCircle } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatCurrency } from '@/lib/utils/currency'

interface CoAAccount {
  id: string
  name: string
  accountNumber: string
}

interface BankAccount {
  id: string
  accountName: string
  bankName: string | null
  accountNumber: string | null
  branchCode: string | null
  iban: string | null
  swiftCode: string | null
  accountId: string | null
  coaAccount: CoAAccount | null
  balance: string
  isDefault: boolean
  isActive: boolean
  createdAt: string
}

const emptyForm = {
  accountName: '',
  bankName: '',
  accountNumber: '',
  branchCode: '',
  iban: '',
  swiftCode: '',
  isDefault: false,
}

export default function BankAccountsPage() {
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const router = useRouter()

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const {
    data: bankAccounts,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<BankAccount>({
    endpoint: '/api/accounting/bank-accounts',
    entityType: 'bank-account',
    storageKey: 'bank-accounts-page-size',
  })

  function handleAdd() {
    setForm(emptyForm)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setForm(emptyForm)
  }

  function handleRowClick(account: BankAccount) {
    router.push(`/c/${tenantSlug}/accounting/bank-accounts/${account.id}`)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.accountName.trim()) {
      toast.error('Account name is required')
      return
    }

    setSaving(true)
    try {
      const body = {
        accountName: form.accountName.trim(),
        bankName: form.bankName.trim() || null,
        accountNumber: form.accountNumber.trim() || null,
        branchCode: form.branchCode.trim() || null,
        iban: form.iban.trim() || null,
        swiftCode: form.swiftCode.trim() || null,
        isDefault: form.isDefault,
      }

      const res = await fetch('/api/accounting/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success('Bank account created')
        handleCloseModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create bank account')
      }
    } catch {
      toast.error('Error creating bank account')
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  if (loading && bankAccounts.length === 0) {
    return <PageLoading text="Loading bank accounts..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Bank Accounts"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search bank accounts..."
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Bank Account
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Bank Accounts</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Account Name
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Bank Name
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Account Number
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Linked CoA Account
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Balance
              </th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                Default
              </th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {bankAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <Landmark size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                  <p className="font-medium">No bank accounts found</p>
                  <p className="text-sm mt-1">Add your first bank account to get started.</p>
                </td>
              </tr>
            ) : (
              bankAccounts.map((account) => {
                const balance = parseFloat(account.balance || '0')
                return (
                  <tr
                    key={account.id}
                    onClick={() => handleRowClick(account)}
                    className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Landmark size={16} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
                        <span className="font-medium text-gray-900 dark:text-white text-sm">
                          {account.accountName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                      {account.bankName || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 font-mono">
                      {account.accountNumber || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                      {account.coaAccount ? (
                        <span>
                          <span className="font-mono text-xs text-gray-400 dark:text-gray-500 mr-1">
                            {account.coaAccount.accountNumber}
                          </span>
                          {account.coaAccount.name}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                      <span className={balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}>
                        {formatCurrency(balance, currency)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {account.isDefault && (
                        <CheckCircle size={16} className="inline-block text-green-500 dark:text-green-400" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge status={account.isActive ? 'active' : 'inactive'} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>

        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      {/* Add Bank Account Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Add Bank Account
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Name *
                </label>
                <input
                  type="text"
                  value={form.accountName}
                  onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Business Current Account"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Bank Name
                </label>
                <input
                  type="text"
                  value={form.bankName}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Commercial Bank"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Number
                </label>
                <input
                  type="text"
                  value={form.accountNumber}
                  onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. 1234567890"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Branch Code
                  </label>
                  <input
                    type="text"
                    value={form.branchCode}
                    onChange={(e) => setForm({ ...form, branchCode: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. 001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    SWIFT Code
                  </label>
                  <input
                    type="text"
                    value={form.swiftCode}
                    onChange={(e) => setForm({ ...form, swiftCode: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. CABORKLX"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  IBAN
                </label>
                <input
                  type="text"
                  value={form.iban}
                  onChange={(e) => setForm({ ...form, iban: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. LK12COMB0000001234567890"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-gray-300">
                  Set as default bank account
                </label>
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
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ListPageLayout>
  )
}

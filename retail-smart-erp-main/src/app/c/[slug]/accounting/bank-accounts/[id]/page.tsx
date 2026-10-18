'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  ChevronRight,
  ArrowLeft,
  Pencil,
  Loader2,
  Landmark,
  Upload,
  CheckCircle2,
  ListChecks,
  FileText,
  RefreshCw,
  X,
  Download,
  FileSpreadsheet,
  Link2,
  Unlink,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StatusBadge } from '@/components/ui'
import { formatCurrency } from '@/lib/utils/currency'
import { MatchBankTransactionModal } from '@/components/modals'

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
  updatedAt: string
}

interface BankTransaction {
  id: string
  transactionDate: string
  description: string
  referenceNumber: string | null
  debit: string
  credit: string
  runningBalance: string | null
  status: 'unmatched' | 'matched' | 'reconciled'
  matchedVoucherType: string | null
  matchedVoucherId: string | null
  createdAt: string
}

interface ReconciliationSummary {
  bookBalance: string
  statementBalance: string
  unmatchedCount: number
  matchedCount: number
  reconciledCount: number
  unmatchedDebitTotal: string
  unmatchedCreditTotal: string
}

const transactionStatusColors: Record<string, string> = {
  unmatched: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  matched: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  reconciled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}

export default function BankAccountDetailPage() {
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const params = useParams()
  const id = params.id as string

  // Bank account state
  const [account, setAccount] = useState<BankAccount | null>(null)
  const [loading, setLoading] = useState(true)

  // Tab state
  const [activeTab, setActiveTab] = useState<'transactions' | 'reconciliation'>('transactions')

  // Transactions state
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Reconciliation state
  const [reconciliation, setReconciliation] = useState<ReconciliationSummary | null>(null)
  const [loadingReconciliation, setLoadingReconciliation] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({
    accountName: '',
    bankName: '',
    accountNumber: '',
    branchCode: '',
    iban: '',
    swiftCode: '',
    isDefault: false,
  })
  const [savingEdit, setSavingEdit] = useState(false)

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<Record<string, string>[]>([])
  const [importTotalRows, setImportTotalRows] = useState(0)
  const [parsedRows, setParsedRows] = useState<{ transactionDate: string; description: string; referenceNumber: string; debit: number; credit: number }[]>([])

  // Match modal state
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [selectedTxnForMatch, setSelectedTxnForMatch] = useState<BankTransaction | null>(null)
  const [unmatchingId, setUnmatchingId] = useState<string | null>(null)

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  // Fetch bank account
  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounting/bank-accounts/${id}`)
      if (res.ok) {
        const data = await res.json()
        setAccount(data)
      } else {
        toast.error('Failed to load bank account')
      }
    } catch {
      toast.error('Error loading bank account')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeData(fetchAccount, { entityType: 'bank-account' })

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    setLoadingTransactions(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)

      const res = await fetch(`/api/accounting/bank-accounts/${id}/transactions?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTransactions(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      toast.error('Error loading transactions')
    } finally {
      setLoadingTransactions(false)
    }
  }, [id, statusFilter, dateFrom, dateTo])

  useRealtimeData(fetchTransactions, {
    entityType: 'bank-account',
    enabled: activeTab === 'transactions',
    refreshOnMount: true,
  })

  // Fetch reconciliation summary
  const fetchReconciliation = useCallback(async () => {
    setLoadingReconciliation(true)
    try {
      const res = await fetch(`/api/accounting/bank-accounts/${id}/reconciliation`)
      if (res.ok) {
        const data = await res.json()
        setReconciliation(data)
      }
    } catch {
      toast.error('Error loading reconciliation data')
    } finally {
      setLoadingReconciliation(false)
    }
  }, [id])

  useRealtimeData(fetchReconciliation, {
    entityType: 'bank-account',
    enabled: activeTab === 'reconciliation',
    refreshOnMount: false,
  })

  // Fetch reconciliation when switching to that tab
  function handleTabChange(tab: 'transactions' | 'reconciliation') {
    setActiveTab(tab)
    if (tab === 'reconciliation' && !reconciliation) {
      fetchReconciliation()
    }
  }

  // Edit handlers
  function handleEdit() {
    if (!account) return
    setEditForm({
      accountName: account.accountName,
      bankName: account.bankName || '',
      accountNumber: account.accountNumber || '',
      branchCode: account.branchCode || '',
      iban: account.iban || '',
      swiftCode: account.swiftCode || '',
      isDefault: account.isDefault,
    })
    setShowEditModal(true)
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editForm.accountName.trim()) {
      toast.error('Account name is required')
      return
    }

    setSavingEdit(true)
    try {
      const body = {
        accountName: editForm.accountName.trim(),
        bankName: editForm.bankName.trim() || null,
        accountNumber: editForm.accountNumber.trim() || null,
        branchCode: editForm.branchCode.trim() || null,
        iban: editForm.iban.trim() || null,
        swiftCode: editForm.swiftCode.trim() || null,
        isDefault: editForm.isDefault,
        expectedUpdatedAt: account?.updatedAt,
      }

      const res = await fetch(`/api/accounting/bank-accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success('Bank account updated')
        setShowEditModal(false)
        fetchAccount()
      } else if (res.status === 409) {
        toast.error('This record was modified by another user. Please refresh and try again.')
        fetchAccount()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update bank account')
      }
    } catch {
      toast.error('Error updating bank account')
    } finally {
      setSavingEdit(false)
    }
  }

  // Column name mapping for bank statement files
  const COLUMN_ALIASES: Record<string, string[]> = {
    transactionDate: ['transaction date', 'date', 'txn date', 'value date', 'posting date'],
    description: ['description', 'narrative', 'details', 'particulars', 'memo', 'transaction description'],
    referenceNumber: ['reference number', 'reference', 'ref', 'ref no', 'check no', 'cheque no'],
    debit: ['debit', 'withdrawal', 'withdrawals', 'debit amount', 'dr'],
    credit: ['credit', 'deposit', 'deposits', 'credit amount', 'cr'],
  }

  function mapColumnName(header: string): string | null {
    const normalized = header.trim().toLowerCase().replace(/[_\-]/g, ' ')
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(normalized) || field.toLowerCase() === normalized) return field
    }
    return null
  }

  function mapRows(rawRows: Record<string, string>[]): { transactionDate: string; description: string; referenceNumber: string; debit: number; credit: number }[] {
    if (rawRows.length === 0) return []
    const headers = Object.keys(rawRows[0])
    const mapping: Record<string, string> = {}
    for (const h of headers) {
      const mapped = mapColumnName(h)
      if (mapped) mapping[h] = mapped
    }
    return rawRows.map((row) => {
      const mapped: Record<string, string> = {}
      for (const [h, v] of Object.entries(row)) {
        const field = mapping[h]
        if (field) mapped[field] = v
      }
      return {
        transactionDate: mapped.transactionDate || '',
        description: mapped.description || '',
        referenceNumber: mapped.referenceNumber || '',
        debit: parseFloat(mapped.debit || '0') || 0,
        credit: parseFloat(mapped.credit || '0') || 0,
      }
    }).filter((r) => r.transactionDate)
  }

  async function handleFileSelect(file: File) {
    setImportFile(file)
    setImportPreview([])
    setParsedRows([])
    setImportTotalRows(0)

    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      let rawRows: Record<string, string>[]

      if (ext === 'csv') {
        const text = await file.text()
        const { parseCsv } = await import('@/lib/import-export/import-utils')
        rawRows = parseCsv(text)
      } else {
        const buffer = await file.arrayBuffer()
        const { parseXlsx } = await import('@/lib/import-export/import-utils')
        rawRows = await parseXlsx(buffer)
      }

      if (rawRows.length === 0) {
        toast.error('No data found in file')
        setImportFile(null)
        return
      }

      const mapped = mapRows(rawRows)
      if (mapped.length === 0) {
        toast.error('Could not map columns. Ensure the file has Transaction Date, Description, Debit, and Credit columns.')
        setImportFile(null)
        return
      }

      setParsedRows(mapped)
      setImportTotalRows(mapped.length)
      setImportPreview(rawRows.slice(0, 5))
    } catch {
      toast.error('Error parsing file')
      setImportFile(null)
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0) {
      toast.error('No data to import')
      return
    }

    setImporting(true)
    try {
      const res = await fetch(`/api/accounting/bank-accounts/${id}/import-statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(`Imported ${data.importedCount || parsedRows.length} transactions`)
        setShowImportModal(false)
        setImportFile(null)
        setImportPreview([])
        setParsedRows([])
        setImportTotalRows(0)
        fetchTransactions()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to import transactions')
      }
    } catch {
      toast.error('Error importing transactions')
    } finally {
      setImporting(false)
    }
  }

  // Reconcile matched transactions
  async function handleReconcileMatched() {
    setReconciling(true)
    try {
      const res = await fetch(`/api/accounting/bank-accounts/${id}/reconciliation/reconcile`, {
        method: 'POST',
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(`Reconciled ${data.reconciledCount || 0} transactions`)
        fetchReconciliation()
        fetchTransactions()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to reconcile transactions')
      }
    } catch {
      toast.error('Error reconciling transactions')
    } finally {
      setReconciling(false)
    }
  }

  // Match / Unmatch handlers
  function handleMatchClick(txn: BankTransaction) {
    setSelectedTxnForMatch(txn)
    setShowMatchModal(true)
  }

  async function handleUnmatch(txnId: string) {
    setUnmatchingId(txnId)
    try {
      const res = await fetch(
        `/api/accounting/bank-accounts/${id}/transactions/${txnId}/unmatch`,
        { method: 'POST' }
      )

      if (res.ok) {
        toast.success('Transaction unmatched')
        fetchTransactions()
        if (activeTab === 'reconciliation') fetchReconciliation()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to unmatch transaction')
      }
    } catch {
      toast.error('Error unmatching transaction')
    } finally {
      setUnmatchingId(null)
    }
  }

  if (loading) {
    return <PageLoading text="Loading bank account..." />
  }

  if (!account) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500 dark:text-gray-400">Bank account not found.</p>
        <Link
          href={`/c/${tenantSlug}/accounting/bank-accounts`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Bank Accounts
        </Link>
      </div>
    )
  }

  const balance = parseFloat(account.balance || '0')

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
        <Link href={`/c/${tenantSlug}/accounting/bank-accounts`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Bank Accounts
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">{account.accountName}</span>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <Landmark size={24} className="text-blue-500 dark:text-blue-400" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                {account.accountName}
              </h1>
              <StatusBadge status={account.isActive ? 'active' : 'inactive'} />
              {account.isDefault && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded-full">
                  <CheckCircle2 size={12} />
                  Default
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Bank Name</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {account.bankName || '-'}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Account Number</span>
                <p className="font-medium text-gray-900 dark:text-white font-mono">
                  {account.accountNumber || '-'}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Balance</span>
                <p className={`font-semibold font-mono text-lg ${balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                  {formatCurrency(balance, currency)}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Linked CoA Account</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {account.coaAccount ? (
                    <>
                      <span className="font-mono text-xs text-gray-400 dark:text-gray-500 mr-1">
                        {account.coaAccount.accountNumber}
                      </span>
                      {account.coaAccount.name}
                    </>
                  ) : (
                    '-'
                  )}
                </p>
              </div>
            </div>
            {(account.branchCode || account.swiftCode || account.iban) && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mt-3 pt-3 border-t dark:border-gray-700">
                {account.branchCode && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Branch Code</span>
                    <p className="font-medium text-gray-900 dark:text-white font-mono">{account.branchCode}</p>
                  </div>
                )}
                {account.swiftCode && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">SWIFT Code</span>
                    <p className="font-medium text-gray-900 dark:text-white font-mono">{account.swiftCode}</p>
                  </div>
                )}
                {account.iban && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">IBAN</span>
                    <p className="font-medium text-gray-900 dark:text-white font-mono text-xs">{account.iban}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Pencil size={14} />
            Edit
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b dark:border-gray-700">
        <nav className="flex gap-6" aria-label="Bank account sections">
          <button
            onClick={() => handleTabChange('transactions')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'transactions'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <FileText size={16} />
              Transactions
            </span>
          </button>
          <button
            onClick={() => handleTabChange('reconciliation')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'reconciliation'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <ListChecks size={16} />
              Reconciliation
            </span>
          </button>
        </nav>
      </div>

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Filters toolbar */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">All</option>
                  <option value="unmatched">Unmatched</option>
                  <option value="matched">Matched</option>
                  <option value="reconciled">Reconciled</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-end gap-2 ml-auto">
                <button
                  onClick={fetchTransactions}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  <Upload size={14} />
                  Import Statement
                </button>
              </div>
            </div>
          </div>

          {/* Transactions table */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">Bank Transactions</caption>
              <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                    Description
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                    Reference
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                    Debit
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                    Credit
                  </th>
                  <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadingTransactions ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <Loader2 size={24} className="animate-spin text-blue-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">Loading transactions...</p>
                    </td>
                  </tr>
                ) : transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                      <FileText size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                      <p className="font-medium">No transactions found</p>
                      <p className="text-sm mt-1">Import a bank statement to see transactions.</p>
                    </td>
                  </tr>
                ) : (
                  transactions.map((txn) => {
                    const debit = parseFloat(txn.debit || '0')
                    const credit = parseFloat(txn.credit || '0')
                    return (
                      <tr
                        key={txn.id}
                        className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                          {new Date(txn.transactionDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white max-w-xs truncate">
                          {txn.description}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 font-mono">
                          {txn.referenceNumber || '-'}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                          {debit > 0 ? (
                            <span className="text-red-600 dark:text-red-400">{formatCurrency(debit, currency)}</span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                          {credit > 0 ? (
                            <span className="text-green-600 dark:text-green-400">{formatCurrency(credit, currency)}</span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              transactionStatusColors[txn.status] || 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {txn.status.charAt(0).toUpperCase() + txn.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {txn.status === 'unmatched' && (
                            <button
                              onClick={() => handleMatchClick(txn)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                              title="Match to GL entry"
                            >
                              <Link2 size={12} />
                              Match
                            </button>
                          )}
                          {txn.status === 'matched' && (
                            <button
                              onClick={() => handleUnmatch(txn.id)}
                              disabled={unmatchingId === txn.id}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded transition-colors disabled:opacity-50"
                              title="Remove match"
                            >
                              {unmatchingId === txn.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Unlink size={12} />
                              )}
                              Unmatch
                            </button>
                          )}
                          {txn.status === 'reconciled' && (
                            <span className="text-gray-300 dark:text-gray-600">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reconciliation Tab */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-4">
          {loadingReconciliation ? (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
              <Loader2 size={24} className="animate-spin text-blue-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading reconciliation data...</p>
            </div>
          ) : reconciliation ? (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Book Balance</div>
                  <div className={`text-xl font-bold font-mono ${parseFloat(reconciliation.bookBalance) < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                    {formatCurrency(parseFloat(reconciliation.bookBalance), currency)}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Statement Balance</div>
                  <div className={`text-xl font-bold font-mono ${parseFloat(reconciliation.statementBalance) < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                    {formatCurrency(parseFloat(reconciliation.statementBalance), currency)}
                  </div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800 p-4">
                  <div className="text-sm text-yellow-600 dark:text-yellow-400 mb-1">Unmatched</div>
                  <div className="text-xl font-bold text-yellow-700 dark:text-yellow-300">
                    {reconciliation.unmatchedCount}
                  </div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800 p-4">
                  <div className="text-sm text-blue-600 dark:text-blue-400 mb-1">Matched</div>
                  <div className="text-xl font-bold text-blue-700 dark:text-blue-300">
                    {reconciliation.matchedCount}
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800 p-4">
                  <div className="text-sm text-green-600 dark:text-green-400 mb-1">Reconciled</div>
                  <div className="text-xl font-bold text-green-700 dark:text-green-300">
                    {reconciliation.reconciledCount}
                  </div>
                </div>
              </div>

              {/* Unmatched totals */}
              <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Unmatched Totals</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-red-50 dark:bg-red-900/20 rounded p-3">
                    <div className="text-xs text-red-600 dark:text-red-400 mb-1">Total Unmatched Debits</div>
                    <div className="text-lg font-bold font-mono text-red-700 dark:text-red-300">
                      {formatCurrency(parseFloat(reconciliation.unmatchedDebitTotal || '0'), currency)}
                    </div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 rounded p-3">
                    <div className="text-xs text-green-600 dark:text-green-400 mb-1">Total Unmatched Credits</div>
                    <div className="text-lg font-bold font-mono text-green-700 dark:text-green-300">
                      {formatCurrency(parseFloat(reconciliation.unmatchedCreditTotal || '0'), currency)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Reconcile button */}
              {reconciliation.matchedCount > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        Reconcile Matched Transactions
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {reconciliation.matchedCount} matched transaction{reconciliation.matchedCount !== 1 ? 's' : ''} ready to be reconciled.
                      </p>
                    </div>
                    <button
                      onClick={handleReconcileMatched}
                      disabled={reconciling}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {reconciling ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      Reconcile Matched
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
              <ListChecks size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">No reconciliation data available</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                Import bank transactions to start reconciling.
              </p>
              <button
                onClick={fetchReconciliation}
                className="mt-4 flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors mx-auto"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Edit Bank Account
              </h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Name *
                </label>
                <input
                  type="text"
                  value={editForm.accountName}
                  onChange={(e) => setEditForm({ ...editForm, accountName: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Bank Name
                </label>
                <input
                  type="text"
                  value={editForm.bankName}
                  onChange={(e) => setEditForm({ ...editForm, bankName: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Number
                </label>
                <input
                  type="text"
                  value={editForm.accountNumber}
                  onChange={(e) => setEditForm({ ...editForm, accountNumber: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Branch Code
                  </label>
                  <input
                    type="text"
                    value={editForm.branchCode}
                    onChange={(e) => setEditForm({ ...editForm, branchCode: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    SWIFT Code
                  </label>
                  <input
                    type="text"
                    value={editForm.swiftCode}
                    onChange={(e) => setEditForm({ ...editForm, swiftCode: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  IBAN
                </label>
                <input
                  type="text"
                  value={editForm.iban}
                  onChange={(e) => setEditForm({ ...editForm, iban: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="editIsDefault"
                  checked={editForm.isDefault}
                  onChange={(e) => setEditForm({ ...editForm, isDefault: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="editIsDefault" className="text-sm text-gray-700 dark:text-gray-300">
                  Set as default bank account
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {savingEdit && <Loader2 size={14} className="animate-spin" />}
                  Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Statement Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Import Bank Statement
              </h2>
              <button
                onClick={() => {
                  setShowImportModal(false)
                  setImportFile(null)
                  setImportPreview([])
                  setParsedRows([])
                  setImportTotalRows(0)
                }}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Download sample template */}
              <a
                href="/api/accounting/bank-accounts/sample-template"
                download
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                <Download size={14} />
                Download Sample Template
              </a>

              {/* File drop zone */}
              <div
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                onClick={() => document.getElementById('bank-import-file')?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const file = e.dataTransfer.files?.[0]
                  if (file) handleFileSelect(file)
                }}
              >
                <input
                  id="bank-import-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileSelect(file)
                  }}
                />
                {importFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <FileSpreadsheet size={20} className="text-green-600 dark:text-green-400" />
                    <span className="font-medium text-gray-900 dark:text-white">{importFile.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setImportFile(null)
                        setImportPreview([])
                        setParsedRows([])
                        setImportTotalRows(0)
                      }}
                      className="ml-2 text-gray-400 hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="mx-auto mb-2 text-gray-400 dark:text-gray-500" />
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Drop file here or click to browse
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Supports .xlsx, .xls, .csv
                    </p>
                  </>
                )}
              </div>

              {/* Preview table */}
              {importPreview.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Preview (first 5 rows)
                    </h3>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {importTotalRows} row{importTotalRows !== 1 ? 's' : ''} found
                    </span>
                  </div>
                  <div className="overflow-x-auto border rounded dark:border-gray-700">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          {Object.keys(importPreview[0]).map((col) => (
                            <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((row, i) => (
                          <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                            {Object.values(row).map((val, j) => (
                              <td key={j} className="px-3 py-1.5 text-gray-900 dark:text-white whitespace-nowrap max-w-[200px] truncate">
                                {val || '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowImportModal(false)
                    setImportFile(null)
                    setImportPreview([])
                    setParsedRows([])
                    setImportTotalRows(0)
                  }}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing || parsedRows.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {importing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  Import {parsedRows.length > 0 ? parsedRows.length : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Match Bank Transaction Modal */}
      <MatchBankTransactionModal
        isOpen={showMatchModal}
        onClose={() => {
          setShowMatchModal(false)
          setSelectedTxnForMatch(null)
        }}
        onMatched={() => {
          fetchTransactions()
          if (activeTab === 'reconciliation') fetchReconciliation()
        }}
        bankAccountId={id}
        transaction={selectedTxnForMatch}
        hasLinkedAccount={!!account.accountId}
      />
    </div>
  )
}

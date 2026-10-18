'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, Search, Link2, CheckCircle2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'
import { useDebouncedValue, useCurrency } from '@/hooks'

interface BankTransaction {
  id: string
  transactionDate: string
  description: string
  referenceNumber: string | null
  debit: string
  credit: string
  status: string
}

interface MatchCandidate {
  voucherType: string
  voucherId: string
  voucherNumber: string
  postingDate: string
  amount: number
  direction: string
  remarks: string
  partyName: string | null
  referenceNo: string | null
}

interface MatchBankTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  onMatched: () => void
  bankAccountId: string
  transaction: BankTransaction | null
  hasLinkedAccount: boolean
}

const voucherTypeLabels: Record<string, string> = {
  payment_entry: 'Payment',
  journal_entry: 'Journal',
  sale: 'Sale',
  purchase: 'Purchase',
  refund: 'Refund',
  stock_adjustment: 'Stock Adj.',
}

export function MatchBankTransactionModal({
  isOpen,
  onClose,
  onMatched,
  bankAccountId,
  transaction,
  hasLinkedAccount,
}: MatchBankTransactionModalProps) {
  const { currency } = useCurrency()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [candidates, setCandidates] = useState<MatchCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<MatchCandidate | null>(null)
  const [matching, setMatching] = useState(false)

  const txnAmount = transaction
    ? Math.abs(parseFloat(transaction.debit || '0') - parseFloat(transaction.credit || '0'))
    : 0
  const txnDebit = parseFloat(transaction?.debit || '0')
  const txnCredit = parseFloat(transaction?.credit || '0')

  const fetchCandidates = useCallback(async () => {
    if (!isOpen || !transaction || !hasLinkedAccount) return

    setLoading(true)
    try {
      const params = new URLSearchParams({ pageSize: '50' })
      if (debouncedSearch) params.set('search', debouncedSearch)

      const res = await fetch(
        `/api/accounting/bank-accounts/${bankAccountId}/match-candidates?${params}`
      )
      if (res.ok) {
        const data = await res.json()
        setCandidates(data.data || [])
      } else {
        toast.error('Failed to load match candidates')
      }
    } catch {
      toast.error('Error loading match candidates')
    } finally {
      setLoading(false)
    }
  }, [isOpen, transaction, hasLinkedAccount, bankAccountId, debouncedSearch])

  useEffect(() => {
    if (isOpen) {
      fetchCandidates()
    }
  }, [fetchCandidates, isOpen])

  useEffect(() => {
    if (!isOpen) {
      setSearch('')
      setCandidates([])
      setSelectedCandidate(null)
    }
  }, [isOpen])

  async function handleConfirmMatch() {
    if (!selectedCandidate || !transaction) return

    setMatching(true)
    try {
      const res = await fetch(
        `/api/accounting/bank-accounts/${bankAccountId}/transactions/${transaction.id}/match`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voucherType: selectedCandidate.voucherType,
            voucherId: selectedCandidate.voucherId,
          }),
        }
      )

      if (res.ok) {
        toast.success('Transaction matched successfully')
        onMatched()
        onClose()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to match transaction')
      }
    } catch {
      toast.error('Error matching transaction')
    } finally {
      setMatching(false)
    }
  }

  function isExactMatch(candidate: MatchCandidate): boolean {
    return Math.abs(candidate.amount - txnAmount) < 0.01
  }

  if (!isOpen || !transaction) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Match Bank Transaction
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Transaction details */}
        <div className="p-4 bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400 text-xs">Date</span>
              <p className="font-medium text-gray-900 dark:text-white">
                {new Date(transaction.transactionDate).toLocaleDateString()}
              </p>
            </div>
            <div className="col-span-2 md:col-span-1">
              <span className="text-gray-500 dark:text-gray-400 text-xs">Description</span>
              <p className="font-medium text-gray-900 dark:text-white truncate" title={transaction.description}>
                {transaction.description}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400 text-xs">Amount</span>
              <p className={`font-semibold font-mono ${txnDebit > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {txnDebit > 0 ? '-' : '+'}{formatCurrency(txnAmount, currency)}
              </p>
            </div>
            {transaction.referenceNumber && (
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs">Reference</span>
                <p className="font-medium text-gray-900 dark:text-white font-mono text-xs">
                  {transaction.referenceNumber}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Search and candidates */}
        <div className="flex-1 overflow-hidden flex flex-col p-4">
          {!hasLinkedAccount ? (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <Link2 size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">
                  No linked Chart of Accounts entry
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  Link a COA account to this bank account to see match candidates.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Search input */}
              <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by voucher number or remarks..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Candidates list */}
              <div className="flex-1 overflow-y-auto border rounded dark:border-gray-700 list-container-lg">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-blue-600" />
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-center">
                    <div>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">
                        {debouncedSearch ? 'No matching GL entries found' : 'No unmatched GL entries available'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y dark:divide-gray-700">
                    {candidates.map((c) => {
                      const exact = isExactMatch(c)
                      const isSelected = selectedCandidate?.voucherId === c.voucherId
                      return (
                        <button
                          key={`${c.voucherType}:${c.voucherId}`}
                          type="button"
                          onClick={() => setSelectedCandidate(isSelected ? null : c)}
                          className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-inset ring-blue-300 dark:ring-blue-700'
                              : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-medium text-sm text-gray-900 dark:text-white">
                                  {c.voucherNumber || c.voucherId.slice(0, 8)}
                                </span>
                                <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                                  {voucherTypeLabels[c.voucherType] || c.voucherType}
                                </span>
                                {exact && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium">
                                    <CheckCircle2 size={10} />
                                    Exact match
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                <span>{new Date(c.postingDate).toLocaleDateString()}</span>
                                {c.partyName && <span>{c.partyName}</span>}
                                {c.referenceNo && <span className="font-mono">Ref: {c.referenceNo}</span>}
                              </div>
                              {c.remarks && (
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">
                                  {c.remarks}
                                </p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`font-mono font-semibold text-sm ${
                                c.direction === 'debit'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-green-600 dark:text-green-400'
                              }`}>
                                {c.direction === 'debit' ? '-' : '+'}{formatCurrency(c.amount, currency)}
                              </span>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmMatch}
            disabled={!selectedCandidate || matching}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {matching ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Link2 size={14} />
            )}
            Confirm Match
          </button>
        </div>
      </div>
    </div>
  )
}

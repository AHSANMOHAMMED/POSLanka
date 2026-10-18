'use client'

import { useState, useCallback, useEffect } from 'react'
import { CreditCard, Eye, Play, Ban, Trash2, RefreshCw, X, Loader2, DollarSign } from 'lucide-react'
import { usePaginatedData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Pagination, StatusBadge, EmptyState } from '@/components/ui'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface Customer {
  id: string
  name: string
  email: string | null
  phone: string | null
}

interface User {
  id: string
  fullName: string
}

interface Sale {
  id: string
  invoiceNo: string
}

interface GiftCardTransaction {
  id: string
  type: string
  amount: string
  balanceAfter: string
  saleId: string | null
  createdAt: string
  sale?: Sale | null
  createdByUser?: User | null
}

interface GiftCard {
  id: string
  cardNumber: string
  pin: string | null
  initialBalance: string
  currentBalance: string
  status: 'inactive' | 'active' | 'used' | 'expired' | 'blocked'
  expiryDate: string | null
  issuedTo: string | null
  createdBy: string | null
  createdAt: string
  issuedToCustomer?: Customer | null
  createdByUser?: User | null
  transactions?: GiftCardTransaction[]
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'active', label: 'Active' },
  { value: 'used', label: 'Used' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'expired', label: 'Expired' },
]

function generateCardNumber(): string {
  const segments = []
  for (let i = 0; i < 4; i++) {
    segments.push(Math.floor(1000 + Math.random() * 9000).toString())
  }
  return segments.join('-')
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function GiftCardsPage() {
  const { currency } = useCurrency()
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showReloadModal, setShowReloadModal] = useState(false)
  const [selectedCard, setSelectedCard] = useState<GiftCard | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; cardNumber: string }>({ open: false, id: null, cardNumber: '' })
  const [blockConfirm, setBlockConfirm] = useState<{ open: boolean; id: string | null; cardNumber: string }>({ open: false, id: null, cardNumber: '' })
  const [activating, setActivating] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)

  // Form state for create modal
  const [formData, setFormData] = useState({
    cardNumber: '',
    initialBalance: '',
    pin: '',
    expiryDate: '',
    issuedTo: '',
  })
  const [submitting, setSubmitting] = useState(false)

  // Reload modal state
  const [reloadAmount, setReloadAmount] = useState('')
  const [reloading, setReloading] = useState(false)

  const {
    data: giftCards,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    setAdditionalParams,
    refresh,
  } = usePaginatedData<GiftCard>({
    endpoint: '/api/gift-cards',
    entityType: 'gift-card',
    storageKey: 'gift-cards-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : {},
  })

  // Update filters when status changes
  useEffect(() => {
    setAdditionalParams(statusFilter ? { status: statusFilter } : {})
  }, [statusFilter, setAdditionalParams])

  // Fetch customers for the create modal
  const fetchCustomers = useCallback(async () => {
    setLoadingCustomers(true)
    try {
      const res = await fetch('/api/customers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCustomers(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
    } finally {
      setLoadingCustomers(false)
    }
  }, [])

  // Fetch card details with transactions
  const fetchCardDetail = useCallback(async (cardId: string) => {
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/gift-cards/${cardId}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedCard(data)
      } else {
        toast.error('Failed to load gift card details')
      }
    } catch (error) {
      console.error('Error fetching gift card:', error)
      toast.error('Failed to load gift card details')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  function openCreateModal() {
    setFormData({
      cardNumber: generateCardNumber(),
      initialBalance: '',
      pin: '',
      expiryDate: '',
      issuedTo: '',
    })
    fetchCustomers()
    setShowCreateModal(true)
  }

  function closeCreateModal() {
    setShowCreateModal(false)
    setFormData({
      cardNumber: '',
      initialBalance: '',
      pin: '',
      expiryDate: '',
      issuedTo: '',
    })
  }

  function openDetailModal(card: GiftCard) {
    setSelectedCard(card)
    setShowDetailModal(true)
    fetchCardDetail(card.id)
  }

  function closeDetailModal() {
    setShowDetailModal(false)
    setSelectedCard(null)
  }

  function openReloadModal(card: GiftCard) {
    setSelectedCard(card)
    setReloadAmount('')
    setShowReloadModal(true)
  }

  function closeReloadModal() {
    setShowReloadModal(false)
    setReloadAmount('')
    setSelectedCard(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.cardNumber.trim()) {
      toast.error('Card number is required')
      return
    }

    const balance = parseFloat(formData.initialBalance)
    if (isNaN(balance) || balance <= 0) {
      toast.error('Initial balance must be greater than zero')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/gift-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardNumber: formData.cardNumber.trim(),
          initialBalance: balance,
          pin: formData.pin || null,
          expiryDate: formData.expiryDate || null,
          issuedTo: formData.issuedTo || null,
        }),
      })

      if (res.ok) {
        toast.success('Gift card created')
        closeCreateModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create gift card')
      }
    } catch (error) {
      console.error('Error creating gift card:', error)
      toast.error('Failed to create gift card')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleActivate(cardId: string) {
    setActivating(cardId)
    try {
      const res = await fetch(`/api/gift-cards/${cardId}/activate`, {
        method: 'POST',
      })

      if (res.ok) {
        toast.success('Gift card activated')
        refresh()
        if (selectedCard?.id === cardId) {
          fetchCardDetail(cardId)
        }
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to activate gift card')
      }
    } catch (error) {
      console.error('Error activating gift card:', error)
      toast.error('Failed to activate gift card')
    } finally {
      setActivating(null)
    }
  }

  async function handleBlock() {
    if (!blockConfirm.id) return

    try {
      const res = await fetch(`/api/gift-cards/${blockConfirm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'blocked' }),
      })

      if (res.ok) {
        toast.success('Gift card blocked')
        refresh()
        if (selectedCard?.id === blockConfirm.id) {
          fetchCardDetail(blockConfirm.id)
        }
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to block gift card')
      }
    } catch (error) {
      console.error('Error blocking gift card:', error)
      toast.error('Failed to block gift card')
    } finally {
      setBlockConfirm({ open: false, id: null, cardNumber: '' })
    }
  }

  async function handleDelete() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/gift-cards/${deleteConfirm.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        toast.success('Gift card deleted')
        refresh()
        if (selectedCard?.id === deleteConfirm.id) {
          closeDetailModal()
        }
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete gift card')
      }
    } catch (error) {
      console.error('Error deleting gift card:', error)
      toast.error('Failed to delete gift card')
    } finally {
      setDeleteConfirm({ open: false, id: null, cardNumber: '' })
    }
  }

  async function handleReload(e: React.FormEvent) {
    e.preventDefault()

    const amount = parseFloat(reloadAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error('Amount must be greater than zero')
      return
    }

    if (!selectedCard) return

    setReloading(true)
    try {
      const res = await fetch(`/api/gift-cards/${selectedCard.id}/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })

      if (res.ok) {
        toast.success(`${formatCurrency(amount, currency)} added to gift card`)
        closeReloadModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to reload gift card')
      }
    } catch (error) {
      console.error('Error reloading gift card:', error)
      toast.error('Failed to reload gift card')
    } finally {
      setReloading(false)
    }
  }

  if (loading && giftCards.length === 0) {
    return <PageLoading text="Loading gift cards..." />
  }

  return (
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Gift Cards"
      actionButton={{ label: 'Create Gift Card', onClick: openCreateModal }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by card number..."
      filterContent={
        <>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {statusFilter && (
            <button onClick={() => setStatusFilter('')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="p-4 flex-1 flex flex-col">
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 flex-1 overflow-hidden flex flex-col">
          <div className="overflow-x-auto flex-1">
            <table className="w-full">
              <caption className="sr-only">List of gift cards</caption>
              <thead className="bg-gray-50 dark:bg-gray-700 table-sticky-header">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Card Number</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Expiry Date</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Issued To</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {giftCards.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        title={search ? 'No gift cards match your search' : 'No gift cards yet'}
                        description={search ? 'Try adjusting your search terms' : 'Create your first gift card using the button above'}
                      />
                    </td>
                  </tr>
                ) : (
                  giftCards.map((card) => (
                    <tr key={card.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CreditCard size={16} className="text-gray-400" />
                          <span className="font-mono font-medium text-gray-900 dark:text-white">{card.cardNumber}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {formatCurrency(parseFloat(card.currentBalance), currency)}
                          </span>
                          {card.currentBalance !== card.initialBalance && (
                            <span className="text-xs text-gray-500">
                              of {formatCurrency(parseFloat(card.initialBalance), currency)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={card.status} size="sm" />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {formatDate(card.expiryDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {card.issuedToCustomer?.name || '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openDetailModal(card)}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>
                          {card.status === 'inactive' && (
                            <button
                              onClick={() => handleActivate(card.id)}
                              disabled={activating === card.id}
                              className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/50 rounded transition-colors disabled:opacity-50"
                              title="Activate"
                            >
                              {activating === card.id ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Play size={16} />
                              )}
                            </button>
                          )}
                          {(card.status === 'active' || card.status === 'used') && (
                            <button
                              onClick={() => openReloadModal(card)}
                              className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/50 rounded transition-colors"
                              title="Reload Balance"
                            >
                              <DollarSign size={16} />
                            </button>
                          )}
                          {card.status !== 'blocked' && card.status !== 'expired' && (
                            <button
                              onClick={() => setBlockConfirm({ open: true, id: card.id, cardNumber: card.cardNumber })}
                              className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/50 rounded transition-colors"
                              title="Block"
                            >
                              <Ban size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteConfirm({ open: true, id: card.id, cardNumber: card.cardNumber })}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-md w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold dark:text-white">Create Gift Card</h2>
              <button
                onClick={closeCreateModal}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X size={20} className="dark:text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Card Number *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.cardNumber}
                    onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
                    className="flex-1 px-3 py-2 border dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, cardNumber: generateCardNumber() })}
                    className="px-3 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    title="Generate new number"
                  >
                    <RefreshCw size={18} className="dark:text-gray-400" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Initial Balance *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formData.initialBalance}
                  onChange={(e) => setFormData({ ...formData, initialBalance: e.target.value })}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="0.00"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  PIN (Optional)
                </label>
                <input
                  type="text"
                  value={formData.pin}
                  onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                  maxLength={10}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter PIN"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Expiry Date (Optional)
                </label>
                <input
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Issue to Customer (Optional)
                </label>
                <select
                  value={formData.issuedTo}
                  onChange={(e) => setFormData({ ...formData, issuedTo: e.target.value })}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  disabled={loadingCustomers}
                >
                  <option value="">Select a customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-md w-full max-w-2xl mx-4 shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-md flex items-center justify-center">
                  <CreditCard className="text-purple-600 dark:text-purple-400" size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold dark:text-white font-mono">{selectedCard.cardNumber}</h2>
                  <StatusBadge status={selectedCard.status} size="sm" />
                </div>
              </div>
              <button
                onClick={closeDetailModal}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X size={20} className="dark:text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Card Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 dark:bg-gray-900 rounded p-4">
                      <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Current Balance</div>
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">
                        {formatCurrency(parseFloat(selectedCard.currentBalance), currency)}
                      </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded p-4">
                      <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Initial Balance</div>
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">
                        {formatCurrency(parseFloat(selectedCard.initialBalance), currency)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Expiry Date:</span>
                      <span className="ml-2 text-gray-900 dark:text-white">{formatDate(selectedCard.expiryDate)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">PIN:</span>
                      <span className="ml-2 text-gray-900 dark:text-white font-mono">{selectedCard.pin || '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Issued To:</span>
                      <span className="ml-2 text-gray-900 dark:text-white">
                        {selectedCard.issuedToCustomer?.name || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Created By:</span>
                      <span className="ml-2 text-gray-900 dark:text-white">
                        {selectedCard.createdByUser?.fullName || '-'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-500 dark:text-gray-400">Created At:</span>
                      <span className="ml-2 text-gray-900 dark:text-white">{formatDateTime(selectedCard.createdAt)}</span>
                    </div>
                  </div>

                  {/* Transaction History */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-3">
                      Transaction History
                    </h3>
                    {selectedCard.transactions && selectedCard.transactions.length > 0 ? (
                      <div className="border dark:border-gray-700 rounded overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:bg-gray-900">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Balance</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reference</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {selectedCard.transactions.map((tx) => (
                              <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="px-3 py-2 capitalize text-gray-900 dark:text-white">
                                  {tx.type}
                                </td>
                                <td className={`px-3 py-2 text-right font-medium ${
                                  tx.type === 'reload' || tx.type === 'refund'
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}>
                                  {tx.type === 'reload' || tx.type === 'refund' ? '+' : '-'}
                                  {formatCurrency(parseFloat(tx.amount), currency)}
                                </td>
                                <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                                  {formatCurrency(parseFloat(tx.balanceAfter), currency)}
                                </td>
                                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                  {tx.sale?.invoiceNo || '-'}
                                </td>
                                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                  {formatDateTime(tx.createdAt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded">
                        <CreditCard size={32} className="mx-auto mb-2 opacity-50" />
                        <p>No transactions yet</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t dark:border-gray-700 flex justify-between">
              <div className="flex gap-2">
                {selectedCard.status === 'inactive' && (
                  <button
                    onClick={() => handleActivate(selectedCard.id)}
                    disabled={activating === selectedCard.id}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    {activating === selectedCard.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} />
                    )}
                    Activate
                  </button>
                )}
                {(selectedCard.status === 'active' || selectedCard.status === 'used') && (
                  <button
                    onClick={() => {
                      closeDetailModal()
                      openReloadModal(selectedCard)
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                  >
                    <DollarSign size={16} />
                    Reload
                  </button>
                )}
              </div>
              <button
                onClick={closeDetailModal}
                className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reload Modal */}
      {showReloadModal && selectedCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-md w-full max-w-sm mx-4 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold dark:text-white">Reload Gift Card</h2>
              <button
                onClick={closeReloadModal}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X size={20} className="dark:text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleReload} className="p-4 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-4">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Card Number</div>
                <div className="font-mono font-medium text-gray-900 dark:text-white">{selectedCard.cardNumber}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Current Balance</div>
                <div className="font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(parseFloat(selectedCard.currentBalance), currency)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Amount to Add *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={reloadAmount}
                  onChange={(e) => setReloadAmount(e.target.value)}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="0.00"
                  required
                  autoFocus
                />
              </div>

              {reloadAmount && parseFloat(reloadAmount) > 0 && (
                <div className="bg-green-50 dark:bg-green-900/30 rounded p-3 text-sm">
                  <span className="text-green-700 dark:text-green-400">New Balance: </span>
                  <span className="font-semibold text-green-800 dark:text-green-300">
                    {formatCurrency(parseFloat(selectedCard.currentBalance) + parseFloat(reloadAmount), currency)}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeReloadModal}
                  className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reloading}
                  className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {reloading && <Loader2 size={16} className="animate-spin" />}
                  Add Balance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Block Confirmation */}
      <ConfirmModal
        isOpen={blockConfirm.open}
        onClose={() => setBlockConfirm({ open: false, id: null, cardNumber: '' })}
        onConfirm={handleBlock}
        title="Block Gift Card"
        message={`Are you sure you want to block gift card "${blockConfirm.cardNumber}"? The card will no longer be usable.`}
        confirmText="Block"
        variant="danger"
      />

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, cardNumber: '' })}
        onConfirm={handleDelete}
        title="Delete Gift Card"
        message={`Are you sure you want to delete gift card "${deleteConfirm.cardNumber}"? This action cannot be undone. Note: Cards with transaction history cannot be deleted.`}
        confirmText="Delete"
        variant="danger"
      />
    </ListPageLayout>
  )
}

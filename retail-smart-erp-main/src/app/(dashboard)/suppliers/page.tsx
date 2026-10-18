'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Phone, Mail, Building2, X, History, ArrowRight, ExternalLink, Download, Upload } from 'lucide-react'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { SupplierFormModal } from '@/components/modals'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useExport } from '@/hooks/useExport'
import { useImport } from '@/hooks/useImport'
import {
  Pagination,
  ListPageHeader,
  SearchInput,
  SectionCard,
  Field,
  FieldGrid,
  StatusBadge,
  LabelBadge,
  EmptyState,
  Button,
  ConfirmModal,
} from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'

interface Supplier {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  taxId: string | null
  balance: string
  taxInclusive: boolean
  isActive: boolean
  createdAt: string
}

interface BalanceHistoryRecord {
  id: string
  type: 'purchase' | 'payment' | 'cancel' | 'adjustment' | 'return'
  amount: string
  previousBalance: string
  newBalance: string
  referenceType: string | null
  referenceId: string | null
  notes: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  referenceDetails: {
    purchaseNo?: string
    paymentMethod?: string
  }
}

interface BalanceHistoryResponse {
  supplier: {
    id: string
    name: string
    currentBalance: string
  }
  records: BalanceHistoryRecord[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// Type badge colors for balance history
const balanceTypeColors: Record<string, 'green' | 'red' | 'yellow' | 'blue' | 'gray'> = {
  purchase: 'blue',
  payment: 'green',
  cancel: 'red',
  adjustment: 'yellow',
  return: 'gray',
}

export default function SuppliersPage() {
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

  // Balance history state
  const [balanceHistory, setBalanceHistory] = useState<BalanceHistoryResponse | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize] = useState(10)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const {
    data: suppliers,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: fetchSuppliers,
  } = usePaginatedData<Supplier>({
    endpoint: '/api/suppliers',
    entityType: 'supplier',
    storageKey: 'suppliers-page-size',
  })

  // Fetch balance history for selected supplier
  const fetchBalanceHistory = useCallback(async () => {
    if (!selectedSupplier) return

    setLoadingHistory(true)
    try {
      const res = await fetch(
        `/api/suppliers/${selectedSupplier.id}/balance-history?page=${historyPage}&pageSize=${historyPageSize}`
      )
      if (res.ok) {
        const data = await res.json()
        setBalanceHistory(data)
      } else {
        console.error('Failed to fetch balance history')
      }
    } catch (error) {
      console.error('Error fetching balance history:', error)
    } finally {
      setLoadingHistory(false)
    }
  }, [selectedSupplier, historyPage, historyPageSize])

  // Subscribe to realtime updates for supplier and purchase changes
  useRealtimeData(fetchBalanceHistory, {
    entityType: ['supplier', 'purchase'],
    enabled: !!selectedSupplier,
    refreshOnMount: false,
  })

  // Fetch balance history when supplier is selected or pagination changes
  useEffect(() => {
    if (selectedSupplier) {
      fetchBalanceHistory()
    }
  }, [selectedSupplier, fetchBalanceHistory])

  // Reset history pagination when supplier changes
  useEffect(() => {
    setHistoryPage(1)
  }, [selectedSupplier?.id])

  async function handleDelete() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/suppliers/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchSuppliers()
        if (selectedSupplier?.id === deleteConfirm.id) {
          setSelectedSupplier(null)
          setBalanceHistory(null)
        }
        toast.success('Supplier deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete supplier')
      }
    } catch (error) {
      console.error('Error deleting supplier:', error)
      toast.error('Failed to delete supplier')
    } finally {
      setDeleteConfirm({ open: false, id: null, name: '' })
    }
  }

  function handleSelectSupplier(supplier: Supplier) {
    setSelectedSupplier(supplier)
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function handleEdit(supplier: Supplier) {
    setEditingSupplier(supplier)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingSupplier(null)
  }

  if (loading && suppliers.length === 0) {
    return <PageLoading text="Loading suppliers..." />
  }

  return (
    <div>
      <ListPageHeader
        title="Suppliers"
        count={pagination.total}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={openImport}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Upload size={16} />
              Import
            </button>
            <button
              onClick={openExport}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Download size={16} />
              Export
            </button>
            <Button onClick={() => setShowModal(true)}>
              <Plus size={18} className="mr-1" />
              Add Supplier
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search suppliers..."
          className="max-w-md"
        />
      </div>

      <div className="flex gap-6">
        {/* Left Column - Supplier List */}
        <div className={`${selectedSupplier ? 'w-1/2' : 'w-full'} flex flex-col transition-all duration-300`}>
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 flex-1 overflow-hidden flex flex-col">
            <div className="overflow-x-auto flex-1">
              <table className="w-full">
                <caption className="sr-only">List of suppliers</caption>
                <thead className="bg-gray-50 dark:bg-gray-700 table-sticky-header">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Supplier</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Contact</th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance</th>
                    <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {suppliers.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState
                          icon={<Building2 size={24} />}
                          title={search ? 'No suppliers found' : 'No suppliers yet'}
                          description={search ? 'Try adjusting your search terms' : 'Add your first supplier to get started'}
                          action={
                            !search && (
                              <Button onClick={() => setShowModal(true)} size="sm">
                                <Plus size={16} className="mr-1" />
                                Add Supplier
                              </Button>
                            )
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    suppliers.map((supplier) => (
                      <tr
                        key={supplier.id}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${selectedSupplier?.id === supplier.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        onClick={() => handleSelectSupplier(supplier)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                              <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 dark:text-white">{supplier.name}</div>
                              {supplier.taxId && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">Tax ID: {supplier.taxId}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {supplier.email && (
                              <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                                <Mail size={14} className="text-gray-400" />
                                <span>{supplier.email}</span>
                              </div>
                            )}
                            {supplier.phone && (
                              <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                                <Phone size={14} className="text-gray-400" />
                                <span>{supplier.phone}</span>
                              </div>
                            )}
                            {!supplier.email && !supplier.phone && (
                              <span className="text-sm text-gray-400 dark:text-gray-500">No contact info</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-medium ${parseFloat(supplier.balance) < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                            {formatCurrency(parseFloat(supplier.balance))}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={supplier.isActive ? 'active' : 'inactive'} size="sm" />
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleEdit(supplier)}
                            aria-label={`Edit ${supplier.name}`}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ open: true, id: supplier.id, name: supplier.name })}
                            aria-label={`Delete ${supplier.name}`}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded ml-1 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
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

        {/* Right Column - Supplier Details */}
        {selectedSupplier && (
          <div className="w-1/2 flex flex-col bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{selectedSupplier.name}</h2>
                  <StatusBadge status={selectedSupplier.isActive ? 'active' : 'inactive'} size="sm" />
                </div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {selectedSupplier.email && <span className="mr-4">{selectedSupplier.email}</span>}
                  {selectedSupplier.phone && <span>{selectedSupplier.phone}</span>}
                </div>
              </div>
              <button
                onClick={() => setSelectedSupplier(null)}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-500"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Supplier Info */}
              <SectionCard title="Supplier Information" icon={<Building2 size={16} />} collapsible defaultCollapsed>
                <FieldGrid columns={2}>
                  <Field label="Email" value={selectedSupplier.email} copyable />
                  <Field label="Phone" value={selectedSupplier.phone} copyable />
                  <Field label="Tax ID" value={selectedSupplier.taxId} />
                  <Field label="Tax Inclusive" value={selectedSupplier.taxInclusive ? 'Yes' : 'No'} />
                  <Field label="Address" value={selectedSupplier.address} />
                </FieldGrid>
              </SectionCard>

              {/* Current Balance */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded p-4 border border-blue-100 dark:border-blue-800">
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Current Balance</div>
                <div className={`text-3xl font-bold ${parseFloat(balanceHistory?.supplier?.currentBalance || selectedSupplier.balance) < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                  {formatCurrency(parseFloat(balanceHistory?.supplier?.currentBalance || selectedSupplier.balance))}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {parseFloat(selectedSupplier.balance) > 0 ? 'Amount owed to supplier' : parseFloat(selectedSupplier.balance) < 0 ? 'Credit with supplier' : 'No outstanding balance'}
                </div>
              </div>

              {/* Balance History */}
              <SectionCard
                title="Balance History"
                icon={<History size={16} />}
                actions={
                  balanceHistory && (
                    <span className="text-sm text-gray-500">
                      {balanceHistory.pagination.total} records
                    </span>
                  )
                }
              >
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : !balanceHistory || balanceHistory.records.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                    No balance history yet
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Balance Change</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {balanceHistory.records.map((record) => {
                            const amount = parseFloat(record.amount)
                            const isIncrease = amount > 0
                            return (
                              <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                  <div>{formatDate(record.createdAt)}</div>
                                  {record.createdByName && (
                                    <div className="text-xs text-gray-400">{record.createdByName}</div>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <LabelBadge color={balanceTypeColors[record.type] || 'gray'}>
                                    {record.type}
                                  </LabelBadge>
                                </td>
                                <td className={`px-3 py-2 text-right font-medium ${isIncrease ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                  {isIncrease ? '+' : ''}{formatCurrency(amount)}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-center gap-1 text-xs text-gray-500">
                                    <span>{formatCurrency(parseFloat(record.previousBalance))}</span>
                                    <ArrowRight size={12} />
                                    <span className="font-medium text-gray-700 dark:text-gray-300">
                                      {formatCurrency(parseFloat(record.newBalance))}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  {record.referenceDetails?.purchaseNo ? (
                                    <a
                                      href={`/purchases?search=${record.referenceDetails.purchaseNo}`}
                                      className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline flex items-center gap-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {record.referenceDetails.purchaseNo}
                                      <ExternalLink size={12} />
                                    </a>
                                  ) : record.notes ? (
                                    <span className="text-gray-500 dark:text-gray-400 text-xs">{record.notes}</span>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                  {record.referenceDetails?.paymentMethod && (
                                    <div className="text-xs text-gray-400 capitalize">
                                      {record.referenceDetails.paymentMethod.replace('_', ' ')}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* History Pagination */}
                    {balanceHistory.pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-3 border-t dark:border-gray-700 mt-3">
                        <span className="text-sm text-gray-500">
                          Page {balanceHistory.pagination.page} of {balanceHistory.pagination.totalPages}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                            disabled={historyPage === 1}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setHistoryPage((p) => Math.min(balanceHistory.pagination.totalPages, p + 1))}
                            disabled={historyPage === balanceHistory.pagination.totalPages}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </SectionCard>
            </div>
          </div>
        )}
      </div>

      <SupplierFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          fetchSuppliers()
          handleCloseModal()
        }}
        editSupplier={editingSupplier}
      />

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDelete}
        title="Delete Supplier"
        message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="suppliers"
        currentFilters={{ search }}
      />

      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="suppliers"
        onComplete={() => fetchSuppliers()}
      />
    </div>
  )
}

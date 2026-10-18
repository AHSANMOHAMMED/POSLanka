'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Search, Eye, RefreshCw, Download, Upload, Check, X, Banknote, DollarSign } from 'lucide-react'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useExport } from '@/hooks/useExport'
import { useImport } from '@/hooks/useImport'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Pagination } from '@/components/ui/pagination'
import { Badge } from '@/components/ui/badge'

interface EmployeeAdvance {
  id: string
  tenantId: string
  advanceNo: string
  employeeProfileId: string
  userId: string
  employeeName: string
  requestedAmount: string
  balanceAmount: string
  recoveredAmount: string
  recoveryMethod: 'salary_deduction' | 'cash' | 'bank_transfer'
  recoveryInstallments: number
  recoveryAmountPerInstallment: string
  purpose: string | null
  reason: string | null
  status: 'draft' | 'pending_approval' | 'approved' | 'disbursed' | 'partially_recovered' | 'fully_recovered' | 'cancelled'
  requestedAt: string
  approvedAt: string | null
  disbursedAt: string | null
  fullyRecoveredAt: string | null
  cancelledAt: string | null
  notes: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface EmployeeProfile {
  id: string
  fullName: string
  employeeCode: string | null
}

export default function EmployeeAdvancesPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [selectedAdvance, setSelectedAdvance] = useState<EmployeeAdvance | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [disbursing, setDisbursing] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Create modal form state
  const [createForm, setCreateForm] = useState({
    employeeProfileId: '',
    requestedAmount: '',
    recoveryMethod: 'salary_deduction' as 'salary_deduction' | 'cash' | 'bank_transfer',
    recoveryInstallments: 1,
    purpose: '',
    reason: '',
    notes: '',
  })
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(false)

  // Paginated data
  const {
    data: paginatedAdvances,
    pagination,
    loading: paginatedLoading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshPaginated,
  } = usePaginatedData<EmployeeAdvance>({
    endpoint: '/api/employee-advances',
    entityType: 'employee-advance',
    storageKey: 'employee-advances-page-size',
    realtimeEnabled: true,
  })

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [employeeFilter, setEmployeeFilter] = useState<string>('')
  const [recoveryMethodFilter, setRecoveryMethodFilter] = useState<string>('')

  // Fetch employees for dropdown
  const fetchEmployees = useCallback(async () => {
    setLoadingEmployees(true)
    try {
      const res = await fetch('/api/employee-profiles?all=true')
      if (res.ok) {
        const data = await res.json()
        setEmployees(data)
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
    } finally {
      setLoadingEmployees(false)
    }
  }, [])

  // Initial fetch of employees
  useEffect(() => {
    fetchEmployees()
  }, [fetchEmployees])

  // Apply filters to paginated data
  const filteredAdvances = useMemo(() => {
    return paginatedAdvances.filter(advance => {
      // Status filter
      if (statusFilter && advance.status !== statusFilter) return false
      
      // Employee filter
      if (employeeFilter && advance.employeeProfileId !== employeeFilter) return false
      
      // Recovery method filter
      if (recoveryMethodFilter && advance.recoveryMethod !== recoveryMethodFilter) return false
      
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase()
        return (
          advance.employeeName.toLowerCase().includes(searchLower) ||
          advance.advanceNo.toLowerCase().includes(searchLower) ||
          advance.purpose?.toLowerCase().includes(searchLower) ||
          false
        )
      }
      return true
    })
  }, [paginatedAdvances, statusFilter, employeeFilter, recoveryMethodFilter, search])

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)

    try {
      const res = await fetch(`/api/employee-advances/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Employee advance deleted successfully')
      } else {
        toast.error('Failed to delete employee advance')
      }
    } catch (error) {
      console.error('Error deleting employee advance:', error)
      toast.error('Error deleting employee advance')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleApprove(advanceId: string) {
    setApproving(true)
    try {
      const res = await fetch(`/api/employee-advances/${advanceId}/approve`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Employee advance approved')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to approve employee advance')
      }
    } catch (error) {
      console.error('Error approving employee advance:', error)
      toast.error('Error approving employee advance')
    } finally {
      setApproving(false)
    }
  }

  async function handleDisburse(advanceId: string) {
    setDisbursing(true)
    try {
      const res = await fetch(`/api/employee-advances/${advanceId}/disburse`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Employee advance disbursed')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to disburse employee advance')
      }
    } catch (error) {
      console.error('Error disbursing employee advance:', error)
      toast.error('Error disbursing employee advance')
    } finally {
      setDisbursing(false)
    }
  }

  async function handleCancel(advanceId: string) {
    setCancelling(true)
    try {
      const res = await fetch(`/api/employee-advances/${advanceId}/cancel`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Employee advance cancelled')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel employee advance')
      }
    } catch (error) {
      console.error('Error cancelling employee advance:', error)
      toast.error('Error cancelling employee advance')
    } finally {
      setCancelling(false)
    }
  }

  async function handleCreateEmployeeAdvance() {
    if (!createForm.employeeProfileId) {
      toast.error('Please select an employee')
      return
    }
    if (!createForm.requestedAmount || parseFloat(createForm.requestedAmount) <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    setApproving(true)
    try {
      const res = await fetch('/api/employee-advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeProfileId: createForm.employeeProfileId,
          requestedAmount: parseFloat(createForm.requestedAmount),
          recoveryMethod: createForm.recoveryMethod,
          recoveryInstallments: createForm.recoveryInstallments,
          purpose: createForm.purpose || null,
          reason: createForm.reason || null,
          notes: createForm.notes || null,
        }),
      })

      if (res.ok) {
        const newAdvance = await res.json()
        refreshPaginated()
        toast.success('Employee advance created successfully')
        setShowCreateModal(false)
        // Reset form
        setCreateForm({
          employeeProfileId: '',
          requestedAmount: '',
          recoveryMethod: 'salary_deduction',
          recoveryInstallments: 1,
          purpose: '',
          reason: '',
          notes: '',
        })
        // View the newly created advance
        setSelectedAdvance(newAdvance)
        setShowDetails(true)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create employee advance')
      }
    } catch (error) {
      console.error('Error creating employee advance:', error)
      toast.error('Error creating employee advance')
    } finally {
      setApproving(false)
    }
  }

  function handleViewDetails(advance: EmployeeAdvance) {
    setSelectedAdvance(advance)
    setShowDetails(true)
  }

  function handleEdit(advance: EmployeeAdvance) {
    // Navigate to edit page or open edit modal
    router.push(`/c/${tenantSlug}/hr/employee-advances/${advance.id}`)
  }

  const loading = paginatedLoading || loadingEmployees

  if (loading && paginatedAdvances.length === 0) {
    return <PageLoading text="Loading employee advances..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Employee Advances</h1>
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
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={20} />
            Create Advance
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search employee advances..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-48">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="disbursed">Disbursed</option>
            <option value="partially_recovered">Partially Recovered</option>
            <option value="fully_recovered">Fully Recovered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="w-48">
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Employees</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} {emp.employeeCode ? `(${emp.employeeCode})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="w-48">
          <select
            value={recoveryMethodFilter}
            onChange={(e) => setRecoveryMethodFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Recovery Methods</option>
            <option value="salary_deduction">Salary Deduction</option>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded border list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of employee advances</caption>
          <thead className="bg-gray-50 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Advance No</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Employee</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden lg:table-cell">Purpose</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Amount</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 hidden md:table-cell">Balance</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Requested</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAdvances.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No employee advances match your search' : 'No employee advances yet. Create your first advance!'}
                </td>
              </tr>
            ) : (
              filteredAdvances.map((advance) => (
                <tr key={advance.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{advance.advanceNo}</div>
                    <div className="text-xs text-gray-500 capitalize">
                      {advance.recoveryMethod.replace('_', ' ')} ({advance.recoveryInstallments} installments)
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{advance.employeeName}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {advance.purpose || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge 
                      variant={
                        advance.status === 'fully_recovered' ? 'success' :
                        advance.status === 'disbursed' || advance.status === 'partially_recovered' ? 'warning' :
                        advance.status === 'approved' ? 'info' :
                        advance.status === 'pending_approval' ? 'secondary' :
                        advance.status === 'cancelled' ? 'danger' :
                        'secondary'
                      }
                    >
                      {advance.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {parseFloat(advance.requestedAmount).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 hidden md:table-cell">
                    {parseFloat(advance.balanceAmount).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 text-sm">
                    {new Date(advance.requestedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleViewDetails(advance)}
                      aria-label={`View ${advance.advanceNo}`}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Eye size={18} />
                    </button>
                    {advance.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleEdit(advance)}
                          aria-label={`Edit ${advance.advanceNo}`}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded ml-1"
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          onClick={() => handleApprove(advance.id)}
                          aria-label={`Approve ${advance.advanceNo}`}
                          className="p-2 text-green-600 hover:bg-green-50 rounded ml-1"
                          disabled={approving}
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={() => setDeleteId(advance.id)}
                          aria-label={`Delete ${advance.advanceNo}`}
                          className="p-2 text-red-600 hover:bg-red-50 rounded ml-1"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                    {advance.status === 'approved' && (
                      <button
                        onClick={() => handleDisburse(advance.id)}
                        aria-label={`Disburse ${advance.advanceNo}`}
                        className="p-2 text-green-600 hover:bg-green-50 rounded ml-1"
                        disabled={disbursing}
                      >
                        <Banknote size={18} />
                      </button>
                    )}
                    {(advance.status === 'draft' || advance.status === 'pending_approval' || advance.status === 'approved') && (
                      <button
                        onClick={() => handleCancel(advance.id)}
                        aria-label={`Cancel ${advance.advanceNo}`}
                        className="p-2 text-red-600 hover:bg-red-50 rounded ml-1"
                        disabled={cancelling}
                      >
                        <X size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
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
          className="border-t px-4 pagination-sticky"
        />
      </div>

      {/* Create Employee Advance Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Employee Advance"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Employee *</label>
            <select
              value={createForm.employeeProfileId}
              onChange={(e) => setCreateForm({ ...createForm, employeeProfileId: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Employee</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} {emp.employeeCode ? `(${emp.employeeCode})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Requested Amount *</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={createForm.requestedAmount}
                onChange={(e) => setCreateForm({ ...createForm, requestedAmount: e.target.value })}
                className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Recovery Method</label>
              <select
                value={createForm.recoveryMethod}
                onChange={(e) => setCreateForm({ ...createForm, recoveryMethod: e.target.value as typeof createForm.recoveryMethod })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="salary_deduction">Salary Deduction</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Recovery Installments</label>
              <input
                type="number"
                min="1"
                max="24"
                value={createForm.recoveryInstallments}
                onChange={(e) => setCreateForm({ ...createForm, recoveryInstallments: parseInt(e.target.value) || 1 })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Monthly installments</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Purpose</label>
            <input
              type="text"
              value={createForm.purpose}
              onChange={(e) => setCreateForm({ ...createForm, purpose: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Medical emergency, Education loan, etc."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <textarea
              value={createForm.reason}
              onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Detailed reason for the advance..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes (Optional)</label>
            <textarea
              value={createForm.notes}
              onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Additional notes..."
            />
          </div>

          {createForm.requestedAmount && createForm.recoveryInstallments > 0 && (
            <div className="pt-4 border-t">
              <div className="bg-gray-50 p-3 rounded">
                <h4 className="font-medium mb-2">Payment Plan</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-500">Monthly Installment</div>
                    <div className="text-lg font-medium">
                      {((parseFloat(createForm.requestedAmount) || 0) / createForm.recoveryInstallments).toLocaleString(undefined, { 
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2 
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Total Amount</div>
                    <div className="text-lg font-medium">
                      {(parseFloat(createForm.requestedAmount) || 0).toLocaleString(undefined, { 
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2 
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateEmployeeAdvance}
              disabled={approving || !createForm.employeeProfileId || !createForm.requestedAmount}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {approving && <RefreshCw size={16} className="animate-spin" />}
              Create Advance
            </button>
          </div>
        </div>
      </Modal>

      {/* Employee Advance Details Modal */}
      <Modal
        isOpen={showDetails}
        onClose={() => {
          setShowDetails(false)
          setSelectedAdvance(null)
        }}
        title={`Employee Advance Details - ${selectedAdvance?.advanceNo || ''}`}
        size="lg"
      >
        {selectedAdvance && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Employee</label>
                <p className="mt-1 font-medium">{selectedAdvance.employeeName}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Status</label>
                <Badge 
                  variant={
                    selectedAdvance.status === 'fully_recovered' ? 'success' :
                    selectedAdvance.status === 'disbursed' || selectedAdvance.status === 'partially_recovered' ? 'warning' :
                    selectedAdvance.status === 'approved' ? 'info' :
                    selectedAdvance.status === 'pending_approval' ? 'secondary' :
                    selectedAdvance.status === 'cancelled' ? 'danger' :
                    'secondary'
                  }
                  className="mt-1"
                >
                  {selectedAdvance.status.replace('_', ' ')}
                </Badge>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Requested Amount</label>
                <p className="mt-1 font-medium">
                  {parseFloat(selectedAdvance.requestedAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Balance Amount</label>
                <p className="mt-1 font-medium">
                  {parseFloat(selectedAdvance.balanceAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Recovery Method</label>
                  <p className="mt-1 capitalize">{selectedAdvance.recoveryMethod.replace('_', ' ')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Installments</label>
                  <p className="mt-1">{selectedAdvance.recoveryInstallments}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Per Installment</label>
                  <p className="mt-1">
                    {parseFloat(selectedAdvance.recoveryAmountPerInstallment).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Recovered Amount</label>
                  <p className="mt-1 font-medium">
                    {parseFloat(selectedAdvance.recoveredAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>

            {selectedAdvance.purpose && (
              <div className="pt-4 border-t">
                <label className="block text-sm font-medium text-gray-500">Purpose</label>
                <p className="mt-1">{selectedAdvance.purpose}</p>
              </div>
            )}

            {selectedAdvance.reason && (
              <div className="pt-4 border-t">
                <label className="block text-sm font-medium text-gray-500">Reason</label>
                <p className="mt-1 whitespace-pre-wrap">{selectedAdvance.reason}</p>
              </div>
            )}

            <div className="pt-4 border-t">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Requested</label>
                  <p className="mt-1">
                    {new Date(selectedAdvance.requestedAt).toLocaleDateString()} {new Date(selectedAdvance.requestedAt).toLocaleTimeString()}
                  </p>
                </div>
                {selectedAdvance.approvedAt && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Approved</label>
                    <p className="mt-1">
                      {new Date(selectedAdvance.approvedAt).toLocaleDateString()} {new Date(selectedAdvance.approvedAt).toLocaleTimeString()}
                    </p>
                  </div>
                )}
                {selectedAdvance.disbursedAt && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Disbursed</label>
                    <p className="mt-1">
                      {new Date(selectedAdvance.disbursedAt).toLocaleDateString()} {new Date(selectedAdvance.disbursedAt).toLocaleTimeString()}
                    </p>
                  </div>
                )}
                {selectedAdvance.fullyRecoveredAt && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Fully Recovered</label>
                    <p className="mt-1">
                      {new Date(selectedAdvance.fullyRecoveredAt).toLocaleDateString()} {new Date(selectedAdvance.fullyRecoveredAt).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {selectedAdvance.notes && (
              <div className="pt-4 border-t">
                <label className="block text-sm font-medium text-gray-500">Notes</label>
                <p className="mt-1 whitespace-pre-wrap">{selectedAdvance.notes}</p>
              </div>
            )}
          </div>
        )}

        <div className="pt-4 mt-4 border-t">
          <button
            onClick={() => {
              setShowDetails(false)
              setSelectedAdvance(null)
            }}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Employee Advance"
        message="Are you sure you want to delete this employee advance? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="employee-advances"
        currentFilters={{ 
          search, 
          status: statusFilter,
          employeeProfileId: employeeFilter,
          recoveryMethod: recoveryMethodFilter
        }}
      />

      {/* Import Wizard */}
      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="employee-advances"
        onComplete={refreshPaginated}
      />
    </div>
  )
}
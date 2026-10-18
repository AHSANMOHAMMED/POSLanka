'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Search, Eye, RefreshCw, Download, Upload, Check, X } from 'lucide-react'
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

interface SalarySlip {
  id: string
  tenantId: string
  slipNo: string
  employeeProfileId: string
  userId: string
  employeeName: string
  payrollMonth: number
  payrollYear: number
  startDate: string
  endDate: string
  totalWorkingDays: string
  paymentDays: string
  baseSalary: string
  grossPay: string
  totalDeductions: string
  totalEmployerContributions: string
  netPay: string
  commissionAmount: string
  advanceDeduction: string
  salaryStructureId: string | null
  salaryStructureName: string | null
  status: 'draft' | 'submitted' | 'cancelled'
  paymentMethod: string | null
  paymentReference: string | null
  paidAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  // Additional fields for display
  components?: SalarySlipComponent[]
}

interface SalarySlipComponent {
  id: string
  tenantId: string
  salarySlipId: string
  componentId: string
  componentName: string
  componentType: 'earning' | 'deduction'
  abbreviation: string
  formulaUsed: string | null
  amount: string
  isStatutory: boolean
  doNotIncludeInTotal: boolean
  isPayableByEmployer: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface EmployeeProfile {
  id: string
  fullName: string
  employeeCode: string | null
}

export default function SalarySlipsPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [selectedSlip, setSelectedSlip] = useState<SalarySlip | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Create modal form state
  const [createForm, setCreateForm] = useState({
    employeeProfileId: '',
    payrollMonth: new Date().getMonth() + 1, // 1-12
    payrollYear: new Date().getFullYear(),
    totalWorkingDays: 30,
    paymentDays: 30,
    commissionAmount: 0,
  })
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [_loadingEmployees, setLoadingEmployees] = useState(false)

  // Paginated data
  const {
    data: paginatedSlips,
    pagination,
    loading: paginatedLoading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshPaginated,
  } = usePaginatedData<SalarySlip>({
    endpoint: '/api/salary-slips',
    entityType: 'salary-slip',
    storageKey: 'salary-slips-page-size',
    realtimeEnabled: true,
  })

  // Filters
  const [monthFilter, setMonthFilter] = useState<string>('')
  const [yearFilter, setYearFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [employeeFilter, setEmployeeFilter] = useState<string>('')

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
  const filteredSlips = useMemo(() => {
    return paginatedSlips.filter(slip => {
      // Month filter
      if (monthFilter && slip.payrollMonth !== parseInt(monthFilter)) return false
      
      // Year filter
      if (yearFilter && slip.payrollYear !== parseInt(yearFilter)) return false
      
      // Status filter
      if (statusFilter && slip.status !== statusFilter) return false
      
      // Employee filter
      if (employeeFilter && slip.employeeProfileId !== employeeFilter) return false
      
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase()
        return (
          slip.employeeName.toLowerCase().includes(searchLower) ||
          slip.slipNo.toLowerCase().includes(searchLower) ||
          slip.salaryStructureName?.toLowerCase().includes(searchLower) ||
          false
        )
      }
      return true
    })
  }, [paginatedSlips, monthFilter, yearFilter, statusFilter, employeeFilter, search])

  // Generate month options (1-12)
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: (i + 1).toString(),
    label: new Date(2000, i).toLocaleDateString('en-US', { month: 'long' })
  }))

  // Generate year options (current year -5 to +1)
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 7 }, (_, i) => ({
    value: (currentYear - 5 + i).toString(),
    label: (currentYear - 5 + i).toString()
  }))

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)

    try {
      const res = await fetch(`/api/salary-slips/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Salary slip deleted successfully')
      } else {
        toast.error('Failed to delete salary slip')
      }
    } catch (error) {
      console.error('Error deleting salary slip:', error)
      toast.error('Error deleting salary slip')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleSubmitSlip(slipId: string) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/salary-slips/${slipId}/submit`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Salary slip submitted successfully')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to submit salary slip')
      }
    } catch (error) {
      console.error('Error submitting salary slip:', error)
      toast.error('Error submitting salary slip')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancelSlip(slipId: string) {
    setCancelling(true)
    try {
      const res = await fetch(`/api/salary-slips/${slipId}/cancel`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Salary slip cancelled successfully')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel salary slip')
      }
    } catch (error) {
      console.error('Error cancelling salary slip:', error)
      toast.error('Error cancelling salary slip')
    } finally {
      setCancelling(false)
    }
  }

  async function handleCreateSalarySlip() {
    if (!createForm.employeeProfileId) {
      toast.error('Please select an employee')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/salary-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })

      if (res.ok) {
        const newSlip = await res.json()
        refreshPaginated()
        toast.success('Salary slip created successfully')
        setShowCreateModal(false)
        // Reset form
        setCreateForm({
          employeeProfileId: '',
          payrollMonth: new Date().getMonth() + 1,
          payrollYear: new Date().getFullYear(),
          totalWorkingDays: 30,
          paymentDays: 30,
          commissionAmount: 0,
        })
        // View the newly created slip
        setSelectedSlip(newSlip)
        setShowDetails(true)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create salary slip')
      }
    } catch (error) {
      console.error('Error creating salary slip:', error)
      toast.error('Error creating salary slip')
    } finally {
      setSubmitting(false)
    }
  }

  function handleViewDetails(slip: SalarySlip) {
    setSelectedSlip(slip)
    setShowDetails(true)
  }

  function handleEdit(slip: SalarySlip) {
    // Navigate to edit page or open edit modal
    router.push(`/c/${tenantSlug}/hr/salary-slips/${slip.id}`)
  }

  const loading = paginatedLoading

  if (loading && paginatedSlips.length === 0) {
    return <PageLoading text="Loading salary slips..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Salary Slips</h1>
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
            Create Salary Slip
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search salary slips..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-36">
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Months</option>
            {monthOptions.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Years</option>
            {yearOptions.map(y => (
              <option key={y.value} value={y.value}>{y.label}</option>
            ))}
          </select>
        </div>
        <div className="w-36">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
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
      </div>

      <div className="bg-white rounded border list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of salary slips</caption>
          <thead className="bg-gray-50 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Slip No</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Employee</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden lg:table-cell">Period</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Gross Pay</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 hidden md:table-cell">Deductions</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Net Pay</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSlips.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No salary slips match your search' : 'No salary slips yet. Create your first salary slip!'}
                </td>
              </tr>
            ) : (
              filteredSlips.map((slip) => (
                <tr key={slip.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{slip.slipNo}</div>
                    <div className="text-xs text-gray-500">{slip.salaryStructureName || 'No structure'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{slip.employeeName}</div>
                    <div className="text-sm text-gray-500">
                      {slip.payrollMonth}/{slip.payrollYear}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {new Date(slip.startDate).toLocaleDateString()} - {new Date(slip.endDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge 
                    variant={
                      slip.status === 'submitted' ? 'success' :
                      slip.status === 'draft' ? 'secondary' :
                      'danger'
                    }
                    >
                      {slip.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {parseFloat(slip.grossPay).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 hidden md:table-cell">
                    {parseFloat(slip.totalDeductions).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-green-600">
                    {parseFloat(slip.netPay).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleViewDetails(slip)}
                      aria-label={`View ${slip.slipNo}`}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Eye size={18} />
                    </button>
                    {slip.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleEdit(slip)}
                          aria-label={`Edit ${slip.slipNo}`}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded ml-1"
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          onClick={() => handleSubmitSlip(slip.id)}
                          aria-label={`Submit ${slip.slipNo}`}
                          className="p-2 text-green-600 hover:bg-green-50 rounded ml-1"
                          disabled={submitting}
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={() => setDeleteId(slip.id)}
                          aria-label={`Delete ${slip.slipNo}`}
                          className="p-2 text-red-600 hover:bg-red-50 rounded ml-1"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                    {slip.status === 'submitted' && (
                      <button
                        onClick={() => handleCancelSlip(slip.id)}
                        aria-label={`Cancel ${slip.slipNo}`}
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

      {/* Create Salary Slip Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Salary Slip"
        size="md"
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Month *</label>
              <select
                value={createForm.payrollMonth}
                onChange={(e) => setCreateForm({ ...createForm, payrollMonth: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {monthOptions.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Year *</label>
              <select
                value={createForm.payrollYear}
                onChange={(e) => setCreateForm({ ...createForm, payrollYear: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {yearOptions.map(y => (
                  <option key={y.value} value={y.value}>{y.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Total Working Days</label>
              <input
                type="number"
                min="1"
                max="31"
                value={createForm.totalWorkingDays}
                onChange={(e) => setCreateForm({ ...createForm, totalWorkingDays: parseInt(e.target.value) || 30 })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Payment Days</label>
              <input
                type="number"
                min="1"
                max="31"
                value={createForm.paymentDays}
                onChange={(e) => setCreateForm({ ...createForm, paymentDays: parseInt(e.target.value) || 30 })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Commission Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={createForm.commissionAmount}
              onChange={(e) => setCreateForm({ ...createForm, commissionAmount: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateSalarySlip}
              disabled={submitting || !createForm.employeeProfileId}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <RefreshCw size={16} className="animate-spin" />}
              Create Salary Slip
            </button>
          </div>
        </div>
      </Modal>

      {/* Salary Slip Details Modal */}
      <Modal
        isOpen={showDetails}
        onClose={() => {
          setShowDetails(false)
          setSelectedSlip(null)
        }}
        title={`Salary Slip Details - ${selectedSlip?.slipNo || ''}`}
        size="lg"
      >
        {selectedSlip && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Employee</label>
                <p className="mt-1 font-medium">{selectedSlip.employeeName}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Period</label>
                <p className="mt-1">
                  {new Date(selectedSlip.startDate).toLocaleDateString()} - {new Date(selectedSlip.endDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Status</label>
                <Badge 
                  variant={
                    selectedSlip.status === 'submitted' ? 'success' :
                    selectedSlip.status === 'draft' ? 'secondary' :
                    'danger'
                  }
                  className="mt-1"
                >
                  {selectedSlip.status}
                </Badge>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Salary Structure</label>
                <p className="mt-1">{selectedSlip.salaryStructureName || 'None'}</p>
              </div>
            </div>

            <div className="pt-4 border-t">
              <h4 className="font-medium mb-2">Earnings & Deductions</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Base Salary</span>
                  <span className="font-medium">{parseFloat(selectedSlip.baseSalary).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {parseFloat(selectedSlip.commissionAmount) > 0 && (
                  <div className="flex justify-between">
                    <span>Commission</span>
                    <span className="text-green-600">+{parseFloat(selectedSlip.commissionAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {parseFloat(selectedSlip.advanceDeduction) > 0 && (
                  <div className="flex justify-between">
                    <span>Advance Deduction</span>
                    <span className="text-red-600">-{parseFloat(selectedSlip.advanceDeduction).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2">
                  <span>Gross Pay</span>
                  <span className="font-medium">{parseFloat(selectedSlip.grossPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Deductions</span>
                  <span className="text-red-600">-{parseFloat(selectedSlip.totalDeductions).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between border-t pt-2 font-bold text-lg">
                  <span>Net Pay</span>
                  <span className="text-green-600">{parseFloat(selectedSlip.netPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {selectedSlip.components && selectedSlip.components.length > 0 && (
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Breakdown</h4>
                <div className="space-y-1">
                  {selectedSlip.components.map(comp => (
                    <div key={comp.id} className="flex justify-between text-sm">
                      <span>
                        {comp.componentName} ({comp.abbreviation})
                        {comp.isStatutory && <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1 rounded">Statutory</span>}
                      </span>
                      <span className={comp.componentType === 'earning' ? 'text-green-600' : 'text-red-600'}>
                        {comp.componentType === 'earning' ? '+' : '-'}
                        {parseFloat(comp.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 border-t">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Working Days</label>
                  <p className="mt-1">{selectedSlip.totalWorkingDays} / {selectedSlip.paymentDays}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Employer Contributions</label>
                  <p className="mt-1">{parseFloat(selectedSlip.totalEmployerContributions).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="pt-4 mt-4 border-t">
          <button
            onClick={() => {
              setShowDetails(false)
              setSelectedSlip(null)
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
        title="Delete Salary Slip"
        message="Are you sure you want to delete this salary slip? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="salary-slips"
        currentFilters={{ 
          search, 
          month: monthFilter, 
          year: yearFilter, 
          status: statusFilter,
          employeeProfileId: employeeFilter
        }}
      />

      {/* Import Wizard */}
      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="salary-slips"
        onComplete={refreshPaginated}
      />
    </div>
  )
}
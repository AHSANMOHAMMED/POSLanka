'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Trash2, Search, Eye, RefreshCw, Download, Upload, Play, Check, X, Users } from 'lucide-react'
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

interface PayrollRun {
  id: string
  tenantId: string
  runNo: string
  payrollMonth: number
  payrollYear: number
  employmentTypes: string[] | null
  departments: string[] | null
  totalEmployees: number
  totalGrossPay: string
  totalDeductions: string
  totalEmployerContributions: string
  totalNetPay: string
  totalCommissions: string
  status: 'draft' | 'processing' | 'completed' | 'failed' | 'cancelled'
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  errorMessage: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface EmployeeProfile {
  id: string
  fullName: string
  employeeCode: string | null
  department: string | null
  employmentType: string
}

interface PayrollRunSummary {
  run: PayrollRun
  salarySlips: Array<{
    id: string
    slipNo: string
    employeeName: string
    grossPay: string
    netPay: string
    status: string
  }>
}

export default function PayrollRunsPage() {
  const { tenantSlug } = useCompany()
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null)
  const [runSummary, setRunSummary] = useState<PayrollRunSummary | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Create modal form state
  const [createForm, setCreateForm] = useState({
    payrollMonth: new Date().getMonth() + 1, // 1-12
    payrollYear: new Date().getFullYear(),
    totalWorkingDays: 30,
    employmentTypes: [] as string[],
    departments: [] as string[],
  })
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(false)

  // Paginated data
  const {
    data: paginatedRuns,
    pagination,
    loading: paginatedLoading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshPaginated,
  } = usePaginatedData<PayrollRun>({
    endpoint: '/api/payroll-runs',
    entityType: 'payroll-run',
    storageKey: 'payroll-runs-page-size',
    realtimeEnabled: true,
  })

  // Filters
  const [monthFilter, setMonthFilter] = useState<string>('')
  const [yearFilter, setYearFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  // Fetch employees for filters and counts
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

  // Get unique departments and employment types
  const departments = useMemo(() => {
    const depts = new Set<string>()
    employees.forEach(emp => {
      if (emp.department) depts.add(emp.department)
    })
    return Array.from(depts).sort()
  }, [employees])

  const employmentTypes = useMemo(() => {
    const types = new Set<string>()
    employees.forEach(emp => {
      types.add(emp.employmentType)
    })
    return Array.from(types).sort()
  }, [employees])

  // Initial fetch of employees
  useEffect(() => {
    fetchEmployees()
  }, [fetchEmployees])

  // Apply filters to paginated data
  const filteredRuns = useMemo(() => {
    return paginatedRuns.filter(run => {
      // Month filter
      if (monthFilter && run.payrollMonth !== parseInt(monthFilter)) return false
      
      // Year filter
      if (yearFilter && run.payrollYear !== parseInt(yearFilter)) return false
      
      // Status filter
      if (statusFilter && run.status !== statusFilter) return false
      
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase()
        return (
          run.runNo.toLowerCase().includes(searchLower) ||
          run.status.toLowerCase().includes(searchLower)
        )
      }
      return true
    })
  }, [paginatedRuns, monthFilter, yearFilter, statusFilter, search])

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
      const res = await fetch(`/api/payroll-runs/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Payroll run deleted successfully')
      } else {
        toast.error('Failed to delete payroll run')
      }
    } catch (error) {
      console.error('Error deleting payroll run:', error)
      toast.error('Error deleting payroll run')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleProcessRun(runId: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/payroll-runs/${runId}/process`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Payroll run processing started')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to process payroll run')
      }
    } catch (error) {
      console.error('Error processing payroll run:', error)
      toast.error('Error processing payroll run')
    } finally {
      setProcessing(false)
    }
  }

  async function handleCompleteRun(runId: string) {
    setCompleting(true)
    try {
      const res = await fetch(`/api/payroll-runs/${runId}/complete`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Payroll run completed')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to complete payroll run')
      }
    } catch (error) {
      console.error('Error completing payroll run:', error)
      toast.error('Error completing payroll run')
    } finally {
      setCompleting(false)
    }
  }

  async function handleCancelRun(runId: string) {
    setCancelling(true)
    try {
      const res = await fetch(`/api/payroll-runs/${runId}/cancel`, { method: 'POST' })
      if (res.ok) {
        refreshPaginated()
        toast.success('Payroll run cancelled')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel payroll run')
      }
    } catch (error) {
      console.error('Error cancelling payroll run:', error)
      toast.error('Error cancelling payroll run')
    } finally {
      setCancelling(false)
    }
  }

  async function handleCreatePayrollRun() {
    setProcessing(true)
    try {
      const res = await fetch('/api/payroll-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payrollMonth: createForm.payrollMonth,
          payrollYear: createForm.payrollYear,
          totalWorkingDays: createForm.totalWorkingDays,
          employmentTypes: createForm.employmentTypes.length > 0 ? createForm.employmentTypes : undefined,
          departments: createForm.departments.length > 0 ? createForm.departments : undefined,
        }),
      })

      if (res.ok) {
        const newRun = await res.json()
        refreshPaginated()
        toast.success('Payroll run created successfully')
        setShowCreateModal(false)
        // Reset form
        setCreateForm({
          payrollMonth: new Date().getMonth() + 1,
          payrollYear: new Date().getFullYear(),
          totalWorkingDays: 30,
          employmentTypes: [],
          departments: [],
        })
        // View the newly created run
        setSelectedRun(newRun)
        fetchRunSummary(newRun.id)
        setShowDetails(true)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create payroll run')
      }
    } catch (error) {
      console.error('Error creating payroll run:', error)
      toast.error('Error creating payroll run')
    } finally {
      setProcessing(false)
    }
  }

  async function fetchRunSummary(runId: string) {
    try {
      const [runRes, slipsRes] = await Promise.all([
        fetch(`/api/payroll-runs/${runId}`),
        fetch(`/api/salary-slips?payrollRunId=${runId}&all=true`),
      ])

      if (runRes.ok && slipsRes.ok) {
        const runData = await runRes.json()
        const slipsData = await slipsRes.json()
        setRunSummary({
          run: runData,
          salarySlips: Array.isArray(slipsData) ? slipsData : slipsData.data || [],
        })
      }
    } catch (error) {
      console.error('Error fetching run summary:', error)
    }
  }

  function handleViewDetails(run: PayrollRun) {
    setSelectedRun(run)
    setShowDetails(true)
    fetchRunSummary(run.id)
  }

  const loading = paginatedLoading || loadingEmployees

  if (loading && paginatedRuns.length === 0) {
    return <PageLoading text="Loading payroll runs..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Payroll Runs</h1>
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
            Create Payroll Run
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search payroll runs..."
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
        <div className="w-48">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded border list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of payroll runs</caption>
          <thead className="bg-gray-50 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Run No</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Period</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden lg:table-cell">Employees</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Gross Pay</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 hidden md:table-cell">Net Pay</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Created</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No payroll runs match your search' : 'No payroll runs yet. Create your first payroll run!'}
                </td>
              </tr>
            ) : (
              filteredRuns.map((run) => (
                <tr key={run.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{run.runNo}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {run.payrollMonth}/{run.payrollYear}
                    </div>
                    {run.departments && run.departments.length > 0 && (
                      <div className="text-xs text-gray-500">
                        {run.departments.length} dept{run.departments.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1">
                      <Users size={14} className="text-gray-400" />
                      <span>{run.totalEmployees}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge 
                      variant={
                        run.status === 'completed' ? 'success' :
                        run.status === 'processing' ? 'warning' :
                        run.status === 'draft' ? 'secondary' :
                        run.status === 'failed' ? 'danger' :
                        'danger'
                      }
                    >
                      {run.status}
                    </Badge>
                    {run.errorMessage && (
                      <div className="text-xs text-red-600 mt-1 truncate max-w-[200px]" title={run.errorMessage}>
                        {run.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {parseFloat(run.totalGrossPay).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-green-600 hidden md:table-cell">
                    {parseFloat(run.totalNetPay).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 text-sm">
                    {new Date(run.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleViewDetails(run)}
                      aria-label={`View ${run.runNo}`}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Eye size={18} />
                    </button>
                    {run.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleProcessRun(run.id)}
                          aria-label={`Process ${run.runNo}`}
                          className="p-2 text-green-600 hover:bg-green-50 rounded ml-1"
                          disabled={processing}
                        >
                          <Play size={18} />
                        </button>
                        <button
                          onClick={() => setDeleteId(run.id)}
                          aria-label={`Delete ${run.runNo}`}
                          className="p-2 text-red-600 hover:bg-red-50 rounded ml-1"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                    {run.status === 'processing' && (
                      <button
                        onClick={() => handleCompleteRun(run.id)}
                        aria-label={`Complete ${run.runNo}`}
                        className="p-2 text-green-600 hover:bg-green-50 rounded ml-1"
                        disabled={completing}
                      >
                        <Check size={18} />
                      </button>
                    )}
                    {(run.status === 'draft' || run.status === 'processing') && (
                      <button
                        onClick={() => handleCancelRun(run.id)}
                        aria-label={`Cancel ${run.runNo}`}
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

      {/* Create Payroll Run Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Payroll Run"
        size="lg"
      >
        <div className="space-y-4">
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
            <label className="block text-sm font-medium mb-1">Employment Types (Optional)</label>
            <div className="space-y-2">
              {employmentTypes.map(type => (
                <label key={type} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.employmentTypes.includes(type)}
                    onChange={(e) => {
                      const updated = e.target.checked
                        ? [...createForm.employmentTypes, type]
                        : createForm.employmentTypes.filter(t => t !== type)
                      setCreateForm({ ...createForm, employmentTypes: updated })
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="capitalize">{type.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">Leave empty to include all employment types</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Departments (Optional)</label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {departments.map(dept => (
                <label key={dept} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.departments.includes(dept)}
                    onChange={(e) => {
                      const updated = e.target.checked
                        ? [...createForm.departments, dept]
                        : createForm.departments.filter(d => d !== dept)
                      setCreateForm({ ...createForm, departments: updated })
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{dept}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">Leave empty to include all departments</p>
          </div>

          <div className="pt-4 border-t">
            <div className="bg-gray-50 p-3 rounded">
              <h4 className="font-medium mb-2">Summary</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500">Eligible Employees</div>
                  <div className="text-lg font-medium">
                    {employees.filter(emp => {
                      if (createForm.employmentTypes.length > 0 && !createForm.employmentTypes.includes(emp.employmentType)) return false
                      if (createForm.departments.length > 0 && (!emp.department || !createForm.departments.includes(emp.department))) return false
                      return true
                    }).length}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Period</div>
                  <div className="text-lg font-medium">
                    {monthOptions[createForm.payrollMonth - 1]?.label} {createForm.payrollYear}
                  </div>
                </div>
              </div>
            </div>
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
              onClick={handleCreatePayrollRun}
              disabled={processing}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {processing && <RefreshCw size={16} className="animate-spin" />}
              Create Payroll Run
            </button>
          </div>
        </div>
      </Modal>

      {/* Payroll Run Details Modal */}
      <Modal
        isOpen={showDetails}
        onClose={() => {
          setShowDetails(false)
          setSelectedRun(null)
          setRunSummary(null)
        }}
        title={`Payroll Run Details - ${selectedRun?.runNo || ''}`}
        size="xl"
      >
        {selectedRun && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-3 rounded">
                <div className="text-sm text-gray-500">Employees</div>
                <div className="text-2xl font-bold text-blue-600">{selectedRun.totalEmployees}</div>
              </div>
              <div className="bg-green-50 p-3 rounded">
                <div className="text-sm text-gray-500">Gross Pay</div>
                <div className="text-2xl font-bold text-green-600">
                  {parseFloat(selectedRun.totalGrossPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-red-50 p-3 rounded">
                <div className="text-sm text-gray-500">Deductions</div>
                <div className="text-2xl font-bold text-red-600">
                  {parseFloat(selectedRun.totalDeductions).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-purple-50 p-3 rounded">
                <div className="text-sm text-gray-500">Net Pay</div>
                <div className="text-2xl font-bold text-purple-600">
                  {parseFloat(selectedRun.totalNetPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Period</label>
                <p className="mt-1 font-medium">
                  {monthOptions[selectedRun.payrollMonth - 1]?.label} {selectedRun.payrollYear}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Status</label>
                <Badge 
                  variant={
                    selectedRun.status === 'completed' ? 'success' :
                    selectedRun.status === 'processing' ? 'warning' :
                    selectedRun.status === 'draft' ? 'secondary' :
                    selectedRun.status === 'failed' ? 'danger' :
                    'danger'
                  }
                  className="mt-1"
                >
                  {selectedRun.status}
                </Badge>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Created</label>
                <p className="mt-1">{new Date(selectedRun.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Created By</label>
                <p className="mt-1">{selectedRun.createdBy}</p>
              </div>
            </div>

            {selectedRun.employmentTypes && selectedRun.employmentTypes.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-500">Employment Types</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedRun.employmentTypes.map(type => (
                    <span key={type} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded capitalize">
                      {type.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedRun.departments && selectedRun.departments.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-500">Departments</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedRun.departments.map(dept => (
                    <span key={dept} className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                      {dept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {runSummary && runSummary.salarySlips.length > 0 && (
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Salary Slips ({runSummary.salarySlips.length})</h4>
                <div className="overflow-y-auto max-h-60">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-sm font-medium text-gray-600">Slip No</th>
                        <th className="px-3 py-2 text-left text-sm font-medium text-gray-600">Employee</th>
                        <th className="px-3 py-2 text-right text-sm font-medium text-gray-600">Gross Pay</th>
                        <th className="px-3 py-2 text-right text-sm font-medium text-gray-600">Net Pay</th>
                        <th className="px-3 py-2 text-left text-sm font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runSummary.salarySlips.map(slip => (
                        <tr key={slip.id} className="border-t">
                          <td className="px-3 py-2">
                            <Link
                              href={`/c/${tenantSlug}/hr/salary-slips/${slip.id}`}
                              className="text-blue-600 hover:underline"
                              onClick={() => setShowDetails(false)}
                            >
                              {slip.slipNo}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{slip.employeeName}</td>
                          <td className="px-3 py-2 text-right">
                            {parseFloat(slip.grossPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {parseFloat(slip.netPay).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              slip.status === 'submitted' ? 'bg-green-100 text-green-700' :
                              slip.status === 'draft' ? 'bg-gray-100 text-gray-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {slip.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedRun.errorMessage && (
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2 text-red-600">Error Details</h4>
                <div className="bg-red-50 p-3 rounded">
                  <p className="text-sm text-red-700 whitespace-pre-wrap">{selectedRun.errorMessage}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pt-4 mt-4 border-t">
          <button
            onClick={() => {
              setShowDetails(false)
              setSelectedRun(null)
              setRunSummary(null)
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
        title="Delete Payroll Run"
        message="Are you sure you want to delete this payroll run? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="payroll-runs"
        currentFilters={{ 
          search, 
          month: monthFilter, 
          year: yearFilter, 
          status: statusFilter
        }}
      />

      {/* Import Wizard */}
      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="payroll-runs"
        onComplete={refreshPaginated}
      />
    </div>
  )
}
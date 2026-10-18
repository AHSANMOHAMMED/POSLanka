'use client'

import { useState, useCallback } from 'react'
import { usePaginatedData } from '@/hooks'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { toast } from '@/components/ui/toast'
import { Pagination } from '@/components/ui/pagination'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormTextarea, FormSection } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { Users, Plus, Edit2, Loader2, Search, Filter } from 'lucide-react'

// ============================================
// TYPES
// ============================================

interface EmployeeProfile {
  id: string
  tenantId: string
  userId: string
  employeeCode: string | null
  employmentType: string
  employmentStatus: string
  department: string | null
  designation: string | null
  hireDate: string | null
  baseSalary: string
  salaryFrequency: string
  fullName: string | null
  email: string | null
  role: string | null
  createdAt: string
  updatedAt: string | null
}

interface UserOption {
  id: string
  fullName: string
  email: string
  role: string
}

interface EmployeeFormData {
  userId: string
  employeeCode: string
  employmentType: string
  employmentStatus: string
  department: string
  designation: string
  hireDate: string
  baseSalary: string
  salaryFrequency: string
  bankName: string
  bankBranch: string
  bankAccountNumber: string
  bankAccountName: string
  taxId: string
  taxIdType: string
  socialSecurityId: string
  socialSecurityIdType: string
  employerContributionId: string
  employerContributionIdType: string
  dateOfBirth: string
  gender: string
  emergencyContactName: string
  emergencyContactPhone: string
  address: string
  notes: string
}

// ============================================
// CONSTANTS
// ============================================

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  on_leave: 'bg-yellow-100 text-yellow-800',
  suspended: 'bg-red-100 text-red-800',
  terminated: 'bg-gray-100 text-gray-800',
  resigned: 'bg-orange-100 text-orange-800',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  on_leave: 'On Leave',
  suspended: 'Suspended',
  terminated: 'Terminated',
  resigned: 'Resigned',
}

const emptyFormData: EmployeeFormData = {
  userId: '',
  employeeCode: '',
  employmentType: 'full_time',
  employmentStatus: 'active',
  department: '',
  designation: '',
  hireDate: '',
  baseSalary: '',
  salaryFrequency: 'monthly',
  bankName: '',
  bankBranch: '',
  bankAccountNumber: '',
  bankAccountName: '',
  taxId: '',
  taxIdType: '',
  socialSecurityId: '',
  socialSecurityIdType: '',
  employerContributionId: '',
  employerContributionIdType: '',
  dateOfBirth: '',
  gender: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  address: '',
  notes: '',
}

function formatCurrency(value: string | number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(value))
}

// ============================================
// PAGE COMPONENT
// ============================================

export default function EmployeesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<EmployeeProfile | null>(null)
  const [formData, setFormData] = useState<EmployeeFormData>(emptyFormData)
  const [submitting, setSubmitting] = useState(false)
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)

  // ============================================
  // DATA FETCHING
  // ============================================

  const {
    data: employees,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<EmployeeProfile>({
    endpoint: '/api/employee-profiles',
    entityType: 'employee-profile',
    storageKey: 'employees-page-size',
    additionalParams: statusFilter !== 'all' ? { status: statusFilter } : undefined,
  })

  // Fetch users list for the user dropdown
  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch('/api/users?all=true')
      if (res.ok) {
        const data = await res.json()
        setUserOptions(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  // Fetch full employee profile when editing (to get bank/statutory details)
  const fetchEmployeeDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/employee-profiles/${id}`)
      if (res.ok) {
        const data = await res.json()
        return data
      }
    } catch (error) {
      console.error('Error fetching employee detail:', error)
    }
    return null
  }, [])

  // Refresh on realtime for balance history etc.
  useRealtimeData(refresh, {
    entityType: 'employee-profile',
    refreshOnMount: false,
  })

  // ============================================
  // MODAL HANDLERS
  // ============================================

  function openCreateModal() {
    setEditingEmployee(null)
    setFormData(emptyFormData)
    setShowModal(true)
    fetchUsers()
  }

  async function openEditModal(employee: EmployeeProfile) {
    setEditingEmployee(employee)
    fetchUsers()

    // Fetch full detail (includes bank/statutory fields)
    const detail = await fetchEmployeeDetail(employee.id)

    setFormData({
      userId: employee.userId,
      employeeCode: employee.employeeCode || '',
      employmentType: employee.employmentType || 'full_time',
      employmentStatus: employee.employmentStatus || 'active',
      department: employee.department || '',
      designation: employee.designation || '',
      hireDate: employee.hireDate || '',
      baseSalary: employee.baseSalary || '',
      salaryFrequency: employee.salaryFrequency || 'monthly',
      bankName: detail?.bankName || '',
      bankBranch: detail?.bankBranch || '',
      bankAccountNumber: detail?.bankAccountNumber || '',
      bankAccountName: detail?.bankAccountName || '',
      taxId: detail?.taxId || '',
      taxIdType: detail?.taxIdType || '',
      socialSecurityId: detail?.socialSecurityId || '',
      socialSecurityIdType: detail?.socialSecurityIdType || '',
      employerContributionId: detail?.employerContributionId || '',
      employerContributionIdType: detail?.employerContributionIdType || '',
      dateOfBirth: detail?.dateOfBirth || '',
      gender: detail?.gender || '',
      emergencyContactName: detail?.emergencyContactName || '',
      emergencyContactPhone: detail?.emergencyContactPhone || '',
      address: detail?.address || '',
      notes: detail?.notes || '',
    })

    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingEmployee(null)
    setFormData(emptyFormData)
  }

  // ============================================
  // FORM SUBMIT
  // ============================================

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!editingEmployee && !formData.userId) {
      toast.error('Please select a user')
      return
    }

    setSubmitting(true)

    try {
      const payload: Record<string, unknown> = {
        userId: formData.userId,
        employeeCode: formData.employeeCode || null,
        employmentType: formData.employmentType,
        employmentStatus: formData.employmentStatus,
        department: formData.department || null,
        designation: formData.designation || null,
        hireDate: formData.hireDate || null,
        baseSalary: formData.baseSalary || '0',
        salaryFrequency: formData.salaryFrequency,
        bankName: formData.bankName || null,
        bankBranch: formData.bankBranch || null,
        bankAccountNumber: formData.bankAccountNumber || null,
        bankAccountName: formData.bankAccountName || null,
        taxId: formData.taxId || null,
        taxIdType: formData.taxIdType || null,
        socialSecurityId: formData.socialSecurityId || null,
        socialSecurityIdType: formData.socialSecurityIdType || null,
        employerContributionId: formData.employerContributionId || null,
        employerContributionIdType: formData.employerContributionIdType || null,
        dateOfBirth: formData.dateOfBirth || null,
        gender: formData.gender || null,
        emergencyContactName: formData.emergencyContactName || null,
        emergencyContactPhone: formData.emergencyContactPhone || null,
        address: formData.address || null,
        notes: formData.notes || null,
      }

      if (editingEmployee) {
        payload.expectedUpdatedAt = editingEmployee.updatedAt
        const res = await fetch(`/api/employee-profiles/${editingEmployee.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (res.status === 409) {
          toast.error('This record was modified by another user. Please refresh and try again.')
          return
        }

        if (res.ok) {
          toast.success('Employee updated successfully')
          closeModal()
          refresh()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Failed to update employee')
        }
      } else {
        const res = await fetch('/api/employee-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (res.ok) {
          toast.success('Employee created successfully')
          closeModal()
          refresh()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Failed to create employee')
        }
      }
    } catch {
      toast.error('Error saving employee')
    } finally {
      setSubmitting(false)
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  function updateForm(field: keyof EmployeeFormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  // ============================================
  // RENDER
  // ============================================

  return (
    <PermissionGuard permission="manageEmployees">
      <div className="p-4 lg:p-6 space-y-4">
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: 'HR', href: '/hr' },
            { label: 'Employees' },
          ]}
        />

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded flex items-center justify-center">
              <Users size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Employees</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage employee profiles and HR records
              </p>
            </div>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Employee
          </button>
        </div>

        {/* Toolbar: Search + Filter */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 w-full sm:max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or employee code..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="on_leave">On Leave</option>
              <option value="suspended">Suspended</option>
              <option value="terminated">Terminated</option>
              <option value="resigned">Resigned</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          {loading && employees.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <Loader2 size={24} className="animate-spin mx-auto mb-2" />
              Loading employees...
            </div>
          ) : employees.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              {search || statusFilter !== 'all'
                ? 'No employees match the current filters.'
                : 'No employees yet. Click "Add Employee" to get started.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Employee Code
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Department
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Designation
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Base Salary
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {employees.map((emp) => (
                    <tr
                      key={emp.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-mono">
                        {emp.employeeCode || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {emp.fullName || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {emp.email || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {emp.department || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {emp.designation || '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            statusColors[emp.employmentStatus] || 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {statusLabels[emp.employmentStatus] || emp.employmentStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white font-medium">
                        {formatCurrency(emp.baseSalary || '0')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditModal(emp)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                          title="Edit employee"
                        >
                          <Edit2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingEmployee ? 'Edit Employee' : 'Add Employee'}
        size="xl"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit as unknown as () => void}
              disabled={submitting}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {editingEmployee ? 'Update Employee' : 'Create Employee'}
            </button>
          </ModalFooter>
        }
      >
        <form onSubmit={handleSubmit} id="employee-form" className="space-y-6">
          {/* Basic Information */}
          <FormSection title="Basic Information" columns={2}>
            <FormField label="User" required>
              <FormSelect
                value={formData.userId}
                onChange={(e) => updateForm('userId', e.target.value)}
                disabled={!!editingEmployee || loadingUsers}
              >
                <option value="">
                  {loadingUsers ? 'Loading users...' : 'Select a user'}
                </option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName} ({user.email})
                  </option>
                ))}
              </FormSelect>
            </FormField>

            <FormField label="Employee Code">
              <FormInput
                value={formData.employeeCode}
                onChange={(e) => updateForm('employeeCode', e.target.value)}
                placeholder="e.g. EMP-001"
              />
            </FormField>

            <FormField label="Employment Type">
              <FormSelect
                value={formData.employmentType}
                onChange={(e) => updateForm('employmentType', e.target.value)}
              >
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
                <option value="contract">Contract</option>
                <option value="intern">Intern</option>
                <option value="probation">Probation</option>
              </FormSelect>
            </FormField>

            <FormField label="Employment Status">
              <FormSelect
                value={formData.employmentStatus}
                onChange={(e) => updateForm('employmentStatus', e.target.value)}
              >
                <option value="active">Active</option>
                <option value="on_leave">On Leave</option>
                <option value="suspended">Suspended</option>
                <option value="terminated">Terminated</option>
                <option value="resigned">Resigned</option>
              </FormSelect>
            </FormField>

            <FormField label="Department">
              <FormInput
                value={formData.department}
                onChange={(e) => updateForm('department', e.target.value)}
                placeholder="e.g. Sales, Engineering"
              />
            </FormField>

            <FormField label="Designation">
              <FormInput
                value={formData.designation}
                onChange={(e) => updateForm('designation', e.target.value)}
                placeholder="e.g. Senior Developer"
              />
            </FormField>
          </FormSection>

          {/* Compensation */}
          <FormSection title="Compensation" columns={3}>
            <FormField label="Hire Date">
              <FormInput
                type="date"
                value={formData.hireDate}
                onChange={(e) => updateForm('hireDate', e.target.value)}
              />
            </FormField>

            <FormField label="Base Salary">
              <FormInput
                type="number"
                step="0.01"
                min="0"
                value={formData.baseSalary}
                onChange={(e) => updateForm('baseSalary', e.target.value)}
                placeholder="0.00"
              />
            </FormField>

            <FormField label="Salary Frequency">
              <FormSelect
                value={formData.salaryFrequency}
                onChange={(e) => updateForm('salaryFrequency', e.target.value)}
              >
                <option value="monthly">Monthly</option>
                <option value="bi_weekly">Bi-Weekly</option>
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
              </FormSelect>
            </FormField>
          </FormSection>

          {/* Bank Details */}
          <FormSection title="Bank Details" columns={2}>
            <FormField label="Bank Name">
              <FormInput
                value={formData.bankName}
                onChange={(e) => updateForm('bankName', e.target.value)}
                placeholder="e.g. Commercial Bank"
              />
            </FormField>

            <FormField label="Branch">
              <FormInput
                value={formData.bankBranch}
                onChange={(e) => updateForm('bankBranch', e.target.value)}
                placeholder="e.g. Main Branch"
              />
            </FormField>

            <FormField label="Account Number">
              <FormInput
                value={formData.bankAccountNumber}
                onChange={(e) => updateForm('bankAccountNumber', e.target.value)}
                placeholder="Account number"
              />
            </FormField>

            <FormField label="Account Name">
              <FormInput
                value={formData.bankAccountName}
                onChange={(e) => updateForm('bankAccountName', e.target.value)}
                placeholder="Name on account"
              />
            </FormField>
          </FormSection>

          {/* Statutory IDs */}
          <FormSection title="Statutory IDs" columns={2}>
            <FormField label="Tax ID">
              <FormInput
                value={formData.taxId}
                onChange={(e) => updateForm('taxId', e.target.value)}
                placeholder="Tax identification number"
              />
            </FormField>

            <FormField label="Tax ID Type">
              <FormInput
                value={formData.taxIdType}
                onChange={(e) => updateForm('taxIdType', e.target.value)}
                placeholder="e.g. TIN, PAN"
              />
            </FormField>

            <FormField label="Social Security ID">
              <FormInput
                value={formData.socialSecurityId}
                onChange={(e) => updateForm('socialSecurityId', e.target.value)}
                placeholder="Social security number"
              />
            </FormField>

            <FormField label="Social Security ID Type">
              <FormInput
                value={formData.socialSecurityIdType}
                onChange={(e) => updateForm('socialSecurityIdType', e.target.value)}
                placeholder="e.g. SSN, EPF"
              />
            </FormField>

            <FormField label="Employer Contribution ID">
              <FormInput
                value={formData.employerContributionId}
                onChange={(e) => updateForm('employerContributionId', e.target.value)}
                placeholder="Employer contribution number"
              />
            </FormField>

            <FormField label="Contribution ID Type">
              <FormInput
                value={formData.employerContributionIdType}
                onChange={(e) => updateForm('employerContributionIdType', e.target.value)}
                placeholder="e.g. ETF, NIC"
              />
            </FormField>
          </FormSection>

          {/* Personal Information */}
          <FormSection title="Personal Information" columns={2}>
            <FormField label="Date of Birth">
              <FormInput
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => updateForm('dateOfBirth', e.target.value)}
              />
            </FormField>

            <FormField label="Gender">
              <FormSelect
                value={formData.gender}
                onChange={(e) => updateForm('gender', e.target.value)}
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </FormSelect>
            </FormField>

            <FormField label="Emergency Contact Name">
              <FormInput
                value={formData.emergencyContactName}
                onChange={(e) => updateForm('emergencyContactName', e.target.value)}
                placeholder="Emergency contact full name"
              />
            </FormField>

            <FormField label="Emergency Contact Phone">
              <FormInput
                value={formData.emergencyContactPhone}
                onChange={(e) => updateForm('emergencyContactPhone', e.target.value)}
                placeholder="Emergency contact phone number"
              />
            </FormField>

            <FormField label="Address" className="md:col-span-2">
              <FormTextarea
                value={formData.address}
                onChange={(e) => updateForm('address', e.target.value)}
                placeholder="Full address"
                rows={2}
              />
            </FormField>

            <FormField label="Notes" className="md:col-span-2">
              <FormTextarea
                value={formData.notes}
                onChange={(e) => updateForm('notes', e.target.value)}
                placeholder="Any additional notes about this employee"
                rows={2}
              />
            </FormField>
          </FormSection>
        </form>
      </Modal>
    </PermissionGuard>
  )
}

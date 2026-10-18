'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Search, Eye, Download, Upload } from 'lucide-react'
import { StaffFormModal } from '@/components/modals'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useExport } from '@/hooks/useExport'
import { useImport } from '@/hooks/useImport'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { Badge } from '@/components/ui/badge'

interface EmployeeProfile {
  id: string
  tenantId: string
  userId: string
  employeeCode: string | null
  employmentType: 'full_time' | 'part_time' | 'contract' | 'intern' | 'casual'
  employmentStatus: 'active' | 'suspended' | 'on_leave' | 'terminated' | 'resigned'
  department: string | null
  designation: string | null
  hireDate: string | null
  confirmationDate: string | null
  baseSalary: string
  salaryFrequency: 'monthly' | 'weekly' | 'biweekly' | 'daily'
  bankName: string | null
  bankBranch: string | null
  bankAccountNumber: string | null
  bankAccountName: string | null
  bankRoutingNumber: string | null
  taxId: string | null
  taxIdType: string | null
  socialSecurityId: string | null
  socialSecurityIdType: string | null
  employerContributionId: string | null
  employerContributionIdType: string | null
  dateOfBirth: string | null
  gender: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  address: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  // User info from join
  fullName: string
  email: string
  role: string
}

export default function EmployeeProfilesPage() {
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingProfile, setEditingProfile] = useState<EmployeeProfile | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // View details modal state
  const [showDetails, setShowDetails] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<EmployeeProfile | null>(null)

  // Paginated data
  const {
    data: paginatedProfiles,
    pagination,
    loading: paginatedLoading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshPaginated,
  } = usePaginatedData<EmployeeProfile>({
    endpoint: '/api/employee-profiles',
    entityType: 'employee-profile',
    storageKey: 'employee-profiles-page-size',
    realtimeEnabled: true,
  })

  // All profiles for filters
  const [allProfiles, setAllProfiles] = useState<EmployeeProfile[]>([])
  const [allProfilesLoading, setAllProfilesLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [departmentFilter, setDepartmentFilter] = useState<string>('')

  // Fetch all profiles for filters
  const fetchAllProfiles = useCallback(async () => {
    setAllProfilesLoading(true)
    try {
      const params = new URLSearchParams({ all: 'true' })
      const res = await fetch(`/api/employee-profiles?${params}`)
      if (res.ok) {
        const data = await res.json()
        setAllProfiles(data)
      }
    } catch (error) {
      console.error('Error fetching all employee profiles:', error)
    } finally {
      setAllProfilesLoading(false)
    }
  }, [])

  // Get unique departments for filter
  const departments = useMemo(() => {
    const depts = new Set<string>()
    allProfiles.forEach(p => {
      if (p.department) depts.add(p.department)
    })
    return Array.from(depts).sort()
  }, [allProfiles])

  // Real-time updates for all profiles
  useRealtimeData(fetchAllProfiles, { entityType: 'employee-profile', enabled: true, refreshOnMount: false })

  // Initial fetch of all profiles
  useEffect(() => {
    fetchAllProfiles()
  }, [fetchAllProfiles])

  // Filter profiles
  const filteredProfiles = useMemo(() => {
    return paginatedProfiles.filter(profile => {
      // Status filter
      if (statusFilter && profile.employmentStatus !== statusFilter) return false
      
      // Department filter
      if (departmentFilter && profile.department !== departmentFilter) return false
      
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase()
        return (
          profile.fullName.toLowerCase().includes(searchLower) ||
          profile.employeeCode?.toLowerCase().includes(searchLower) ||
          profile.email.toLowerCase().includes(searchLower) ||
          profile.department?.toLowerCase().includes(searchLower) ||
          profile.designation?.toLowerCase().includes(searchLower)
        )
      }
      return true
    })
  }, [paginatedProfiles, statusFilter, departmentFilter, search])

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)

    try {
      const res = await fetch(`/api/employee-profiles/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refreshPaginated()
        fetchAllProfiles()
        toast.success('Employee profile deleted successfully')
      } else {
        toast.error('Failed to delete employee profile')
      }
    } catch (error) {
      console.error('Error deleting employee profile:', error)
      toast.error('Error deleting employee profile')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  function handleEdit(profile: EmployeeProfile) {
    setEditingProfile(profile)
    setShowFormModal(true)
  }

  function handleAdd() {
    setEditingProfile(null)
    setShowFormModal(true)
  }

  function handleViewDetails(profile: EmployeeProfile) {
    setSelectedProfile(profile)
    setShowDetails(true)
  }

  function handleModalSaved() {
    refreshPaginated()
    fetchAllProfiles()
  }

  const loading = paginatedLoading || allProfilesLoading

  if (loading && paginatedProfiles.length === 0) {
    return <PageLoading text="Loading employee profiles..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Employee Profiles</h1>
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
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={20} />
            Add Employee
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search employees..."
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
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="on_leave">On Leave</option>
            <option value="terminated">Terminated</option>
            <option value="resigned">Resigned</option>
          </select>
        </div>
        <div className="w-48">
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Departments</option>
            {departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded border list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of employee profiles</caption>
          <thead className="bg-gray-50 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Employee</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden sm:table-cell">Employee Code</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden lg:table-cell">Department</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden xl:table-cell">Designation</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Base Salary</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProfiles.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No employees match your search' : 'No employee profiles yet. Add your first employee!'}
                </td>
              </tr>
            ) : (
              filteredProfiles.map((profile) => (
                <tr key={profile.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{profile.fullName}</div>
                    <div className="text-sm text-gray-500">{profile.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{profile.employeeCode || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{profile.department || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden xl:table-cell">{profile.designation || '-'}</td>
                  <td className="px-4 py-3">
                    <Badge 
                      variant={
                        profile.employmentStatus === 'active' ? 'success' :
                        profile.employmentStatus === 'on_leave' ? 'warning' :
                        profile.employmentStatus === 'suspended' ? 'secondary' :
                        'danger'
                      }
                    >
                      {profile.employmentStatus.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {parseFloat(profile.baseSalary).toLocaleString(undefined, { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                    <div className="text-xs text-gray-500">{profile.salaryFrequency}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleViewDetails(profile)}
                      aria-label={`View ${profile.fullName}`}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      onClick={() => handleEdit(profile)}
                      aria-label={`Edit ${profile.fullName}`}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded ml-1"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() => setDeleteId(profile.id)}
                      aria-label={`Delete ${profile.fullName}`}
                      className="p-2 text-red-600 hover:bg-red-50 rounded ml-1"
                    >
                      <Trash2 size={18} />
                    </button>
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

      {/* Employee Form Modal */}
      <StaffFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false)
          setEditingProfile(null)
        }}
        onSaved={handleModalSaved}
        editUser={editingProfile ? {
          id: editingProfile.userId || editingProfile.id,
          email: editingProfile.email,
          fullName: editingProfile.fullName,
          role: editingProfile.role as 'owner' | 'manager' | 'cashier' | 'technician' | 'chef' | 'waiter',
          isActive: true,
          lastLoginAt: null,
          createdAt: editingProfile.createdAt,
          updatedAt: editingProfile.updatedAt,
        } : null}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Employee Profile"
        message="Are you sure you want to delete this employee profile? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />

      {/* Employee Details Modal */}
      <Modal
        isOpen={showDetails}
        onClose={() => {
          setShowDetails(false)
          setSelectedProfile(null)
        }}
        title="Employee Details"
        size="lg"
      >
        {selectedProfile && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Full Name</label>
                <p className="mt-1 font-medium">{selectedProfile.fullName}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Email</label>
                <p className="mt-1">{selectedProfile.email}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Employee Code</label>
                <p className="mt-1">{selectedProfile.employeeCode || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Role</label>
                <p className="mt-1">{selectedProfile.role}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Department</label>
                <p className="mt-1">{selectedProfile.department || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Designation</label>
                <p className="mt-1">{selectedProfile.designation || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Employment Type</label>
                <p className="mt-1 capitalize">{selectedProfile.employmentType.replace('_', ' ')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Employment Status</label>
                <p className="mt-1 capitalize">{selectedProfile.employmentStatus.replace('_', ' ')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Hire Date</label>
                <p className="mt-1">{selectedProfile.hireDate ? new Date(selectedProfile.hireDate).toLocaleDateString() : '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Base Salary</label>
                <p className="mt-1 font-medium">
                  {parseFloat(selectedProfile.baseSalary).toLocaleString(undefined, { 
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2 
                  })} ({selectedProfile.salaryFrequency})
                </p>
              </div>
            </div>

            {selectedProfile.bankAccountNumber && (
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Bank Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Bank Name</label>
                    <p className="mt-1">{selectedProfile.bankName || '-'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Account Number</label>
                    <p className="mt-1">{selectedProfile.bankAccountNumber}</p>
                  </div>
                </div>
              </div>
            )}

            {(selectedProfile.emergencyContactName || selectedProfile.emergencyContactPhone) && (
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Emergency Contact</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Name</label>
                    <p className="mt-1">{selectedProfile.emergencyContactName || '-'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Phone</label>
                    <p className="mt-1">{selectedProfile.emergencyContactPhone || '-'}</p>
                  </div>
                </div>
              </div>
            )}

            {selectedProfile.notes && (
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Notes</h4>
                <p className="text-gray-700 whitespace-pre-wrap">{selectedProfile.notes}</p>
              </div>
            )}
          </div>
        )}

        <div className="pt-4 mt-4 border-t">
          <button
            onClick={() => {
              setShowDetails(false)
              setSelectedProfile(null)
            }}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </Modal>

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="employee-profiles"
        currentFilters={{ search, status: statusFilter, department: departmentFilter }}
      />

      {/* Import Wizard */}
      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="employee-profiles"
        onComplete={() => {
          refreshPaginated()
          fetchAllProfiles()
        }}
      />
    </div>
  )
}
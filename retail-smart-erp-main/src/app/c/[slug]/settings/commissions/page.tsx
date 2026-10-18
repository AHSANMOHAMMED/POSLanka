'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { toast } from '@/components/ui/toast'
import { hasPermission } from '@/lib/auth/roles'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PageTabs, Breadcrumb } from '@/components/ui/page-header'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { Pagination } from '@/components/ui/pagination'
import { CancellationReasonModal } from '@/components/modals'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import {
  DollarSign, Plus, Edit2, Trash2, Loader2, Check, X,
  Eye, Ban,
} from 'lucide-react'

// ==================== TYPES ====================

interface CommissionRate {
  id: string
  tenantId: string
  userId: string | null
  serviceTypeId: string | null
  categoryId: string | null
  rate: string
  rateType: 'percentage' | 'fixed'
  isActive: boolean
  userName: string | null
  serviceTypeName: string | null
  categoryName: string | null
}

interface Commission {
  id: string
  tenantId: string
  userId: string
  saleId: string | null
  workOrderId: string | null
  itemName: string | null
  amount: string
  rate: string
  rateType: string
  commissionAmount: string
  status: 'pending' | 'approved' | 'paid' | 'cancelled'
  payoutId: string | null
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  userName: string | null
  saleInvoiceNo: string | null
  workOrderNo: string | null
}

interface CommissionPayout {
  id: string
  tenantId: string
  payoutNo: string
  userId: string
  periodStart: string | null
  periodEnd: string | null
  totalAmount: string
  commissionsCount: number
  status: 'draft' | 'approved' | 'paid' | 'cancelled'
  paymentMethod: string | null
  paymentReference: string | null
  paidAt: string | null
  paidBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  notes: string | null
  createdBy: string | null
  createdAt: string
  userName: string | null
  commissions?: Commission[]
}

interface UserOption {
  id: string
  fullName: string
}

interface ServiceTypeOption {
  id: string
  name: string
}

interface CategoryOption {
  id: string
  name: string
}

interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// ==================== STATUS COLORS ====================

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

// ==================== MAIN PAGE COMPONENT ====================

export default function CommissionsPage() {
  const { data: session } = useSession()
  const { tenantSlug } = useCompany()
  const [activeTab, setActiveTab] = useState('rates')

  // Check permission
  if (session && !hasPermission(session.user.role, 'manageCommissions')) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">You do not have permission to access this page.</p>
      </div>
    )
  }

  const tabs = [
    { id: 'rates', label: 'Commission Rates' },
    { id: 'matrix', label: 'Rate Matrix' },
    { id: 'commissions', label: 'Commissions' },
    { id: 'payouts', label: 'Payouts' },
  ]

  return (
    <PermissionGuard permission="manageCommissions">
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Settings', href: `/c/${tenantSlug}/settings` },
          { label: 'Commissions' },
        ]}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
          <DollarSign size={24} />
          Commissions
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage commission rates, track earned commissions, and process payouts
        </p>
      </div>

      {/* Tabs */}
      <PageTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'rates' && <CommissionRatesTab />}
        {activeTab === 'matrix' && <RateMatrixTab />}
        {activeTab === 'commissions' && <CommissionsTab />}
        {activeTab === 'payouts' && <PayoutsTab />}
      </div>
    </div>
    </PermissionGuard>
  )
}

// ==================== COMMISSION RATES TAB ====================

function CommissionRatesTab() {
  const [rates, setRates] = useState<CommissionRate[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingRate, setEditingRate] = useState<CommissionRate | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Options for dropdowns
  const [users, setUsers] = useState<UserOption[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])

  // Form state
  const [formData, setFormData] = useState({
    userId: '',
    serviceTypeId: '',
    categoryId: '',
    rate: '',
    rateType: 'percentage' as 'percentage' | 'fixed',
  })

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })

  const fetchRates = useCallback(async () => {
    try {
      const res = await fetch(`/api/commission-rates?page=${page}&pageSize=${pageSize}`)
      if (res.ok) {
        const result = await res.json()
        if (result.data) {
          setRates(result.data)
          setPagination(result.pagination)
        } else {
          setRates(result)
        }
      } else {
        toast.error('Failed to load commission rates')
      }
    } catch (err) {
      console.error('Error fetching rates:', err)
      toast.error('Failed to load commission rates')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  const fetchOptions = useCallback(async () => {
    try {
      const [usersRes, serviceTypesRes, categoriesRes] = await Promise.all([
        fetch('/api/users?all=true'),
        fetch('/api/service-types?all=true'),
        fetch('/api/categories?all=true'),
      ])

      if (usersRes.ok) {
        const data = await usersRes.json()
        setUsers(Array.isArray(data) ? data : data.data || [])
      }
      if (serviceTypesRes.ok) {
        const data = await serviceTypesRes.json()
        setServiceTypes(Array.isArray(data) ? data : data.data || [])
      }
      if (categoriesRes.ok) {
        const data = await categoriesRes.json()
        setCategories(Array.isArray(data) ? data : data.data || [])
      }
    } catch (err) {
      console.error('Error fetching options:', err)
    }
  }, [])

  useRealtimeData(fetchRates, { entityType: 'commission-rate', refreshOnMount: false })

  useEffect(() => {
    fetchRates()
    fetchOptions()
  }, [fetchRates, fetchOptions])

  function openCreateModal() {
    setEditingRate(null)
    setFormData({ userId: '', serviceTypeId: '', categoryId: '', rate: '', rateType: 'percentage' })
    setShowModal(true)
  }

  function openEditModal(rate: CommissionRate) {
    setEditingRate(rate)
    setFormData({
      userId: rate.userId || '',
      serviceTypeId: rate.serviceTypeId || '',
      categoryId: rate.categoryId || '',
      rate: rate.rate,
      rateType: rate.rateType,
    })
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingRate(null)
    setFormData({ userId: '', serviceTypeId: '', categoryId: '', rate: '', rateType: 'percentage' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.rate || parseFloat(formData.rate) < 0) {
      toast.error('Please enter a valid rate')
      return
    }

    setSubmitting(true)

    try {
      const payload = {
        userId: formData.userId || null,
        serviceTypeId: formData.serviceTypeId || null,
        categoryId: formData.categoryId || null,
        rate: parseFloat(formData.rate),
        rateType: formData.rateType,
      }

      if (editingRate) {
        const res = await fetch(`/api/commission-rates/${editingRate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (res.ok) {
          toast.success('Commission rate updated')
          closeModal()
          fetchRates()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Failed to update')
        }
      } else {
        const res = await fetch('/api/commission-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (res.ok) {
          toast.success('Commission rate created')
          closeModal()
          fetchRates()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Failed to create')
        }
      }
    } catch {
      toast.error('Error saving commission rate')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this commission rate?')) return

    setDeleting(id)
    try {
      const res = await fetch(`/api/commission-rates/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Commission rate deleted')
        fetchRates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
      }
    } catch {
      toast.error('Error deleting commission rate')
    } finally {
      setDeleting(null)
    }
  }

  async function toggleStatus(rate: CommissionRate) {
    try {
      const res = await fetch(`/api/commission-rates/${rate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rate.isActive }),
      })

      if (res.ok) {
        toast.success(rate.isActive ? 'Rate deactivated' : 'Rate activated')
        fetchRates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update')
      }
    } catch {
      toast.error('Error updating rate status')
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Define commission rates for staff members by service type or category
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          <Plus size={18} />
          Add Rate
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-md border dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
        ) : rates.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No commission rates found. Click &quot;Add Rate&quot; to create one.
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">User</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Service Type / Category</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Rate</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {rates.map((rate) => (
                  <tr key={rate.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium dark:text-white">
                        {rate.userName || 'Default (All Users)'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {rate.serviceTypeName || rate.categoryName || 'All'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium dark:text-white">
                        {rate.rateType === 'percentage' ? `${rate.rate}%` : `LKR ${rate.rate}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleStatus(rate)}
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          rate.isActive
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {rate.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(rate)}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(rate.id)}
                          disabled={deleting === rate.id}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          title="Delete"
                        >
                          {deleting === rate.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingRate ? 'Edit Commission Rate' : 'Add Commission Rate'}
        size="md"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="rate-form"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {editingRate ? 'Update' : 'Create'}
            </button>
          </ModalFooter>
        }
      >
        <form id="rate-form" onSubmit={handleSubmit} className="space-y-4">
          <FormField label="User" hint="Leave empty to apply to all users (default rate)">
            <FormSelect
              value={formData.userId}
              onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
            >
              <option value="">All Users (Default)</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.fullName}</option>
              ))}
            </FormSelect>
          </FormField>

          <FormField label="Service Type" hint="Leave empty to apply to all service types">
            <FormSelect
              value={formData.serviceTypeId}
              onChange={(e) => setFormData({ ...formData, serviceTypeId: e.target.value, categoryId: '' })}
              disabled={!!formData.categoryId}
            >
              <option value="">All Service Types</option>
              {serviceTypes.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </FormSelect>
          </FormField>

          <FormField label="Category" hint="Leave empty to apply to all categories">
            <FormSelect
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value, serviceTypeId: '' })}
              disabled={!!formData.serviceTypeId}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </FormSelect>
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Rate Type" required>
              <FormSelect
                value={formData.rateType}
                onChange={(e) => setFormData({ ...formData, rateType: e.target.value as 'percentage' | 'fixed' })}
              >
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount (LKR)</option>
              </FormSelect>
            </FormField>

            <FormField label="Rate Value" required>
              <FormInput
                type="number"
                step={formData.rateType === 'percentage' ? '0.01' : '1'}
                min="0"
                max={formData.rateType === 'percentage' ? '100' : undefined}
                value={formData.rate}
                onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                placeholder={formData.rateType === 'percentage' ? '10' : '500'}
              />
            </FormField>
          </div>
        </form>
      </Modal>
    </>
  )
}

// ==================== COMMISSIONS TAB ====================

function CommissionsTab() {
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  // Filters
  const [filterUserId, setFilterUserId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Users for filter
  const [users, setUsers] = useState<UserOption[]>([])

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })

  // Cancellation modal
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const fetchCommissions = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (filterUserId) params.set('userId', filterUserId)
      if (filterStatus) params.set('status', filterStatus)
      if (filterDateFrom) params.set('dateFrom', filterDateFrom)
      if (filterDateTo) params.set('dateTo', filterDateTo)

      const res = await fetch(`/api/commissions?${params}`)
      if (res.ok) {
        const result = await res.json()
        if (result.data) {
          setCommissions(result.data)
          setPagination(result.pagination)
        } else {
          setCommissions(result)
        }
      } else {
        toast.error('Failed to load commissions')
      }
    } catch (err) {
      console.error('Error fetching commissions:', err)
      toast.error('Failed to load commissions')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filterUserId, filterStatus, filterDateFrom, filterDateTo])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users?all=true')
      if (res.ok) {
        const data = await res.json()
        setUsers(Array.isArray(data) ? data : data.data || [])
      }
    } catch (err) {
      console.error('Error fetching users:', err)
    }
  }, [])

  useRealtimeData(fetchCommissions, { entityType: ['commission', 'commission-payout'], refreshOnMount: false })

  useEffect(() => {
    fetchCommissions()
    fetchUsers()
  }, [fetchCommissions, fetchUsers])

  async function handleApprove(id: string) {
    setProcessing(id)
    try {
      const res = await fetch(`/api/commissions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })

      if (res.ok) {
        toast.success('Commission approved')
        fetchCommissions()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to approve')
      }
    } catch {
      toast.error('Error approving commission')
    } finally {
      setProcessing(null)
    }
  }

  function handleCancelClick(id: string) {
    setCancellingId(id)
    setShowCancelModal(true)
  }

  async function handleCancel(reason: string) {
    if (!cancellingId) return

    setProcessing(cancellingId)
    setShowCancelModal(false)

    try {
      const res = await fetch(`/api/commissions/${cancellingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      })

      if (res.ok) {
        toast.success('Commission cancelled')
        fetchCommissions()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel')
      }
    } catch {
      toast.error('Error cancelling commission')
    } finally {
      setProcessing(null)
      setCancellingId(null)
    }
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function formatCurrency(amount: string | number) {
    return new Intl.NumberFormat('en-LK', {
      style: 'currency',
      currency: 'LKR',
      minimumFractionDigits: 2,
    }).format(Number(amount))
  }

  return (
    <>
      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <FormLabel>User</FormLabel>
            <FormSelect
              value={filterUserId}
              onChange={(e) => { setFilterUserId(e.target.value); setPage(1) }}
            >
              <option value="">All Users</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.fullName}</option>
              ))}
            </FormSelect>
          </div>
          <div>
            <FormLabel>Status</FormLabel>
            <FormSelect
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </FormSelect>
          </div>
          <div>
            <FormLabel>From Date</FormLabel>
            <FormInput
              type="date"
              value={filterDateFrom}
              onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1) }}
            />
          </div>
          <div>
            <FormLabel>To Date</FormLabel>
            <FormInput
              type="date"
              value={filterDateTo}
              onChange={(e) => { setFilterDateTo(e.target.value); setPage(1) }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-md border dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
        ) : commissions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No commissions found matching the filters.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Reference</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Item</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Amount</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Commission</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {commissions.map((commission) => (
                    <tr key={commission.id}>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {formatDate(commission.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium dark:text-white">{commission.userName || '-'}</span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {commission.saleInvoiceNo ? (
                          <span className="text-blue-600 dark:text-blue-400">Sale #{commission.saleInvoiceNo}</span>
                        ) : commission.workOrderNo ? (
                          <span className="text-purple-600 dark:text-purple-400">WO #{commission.workOrderNo}</span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {commission.itemName || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(commission.amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-medium dark:text-white">
                          {formatCurrency(commission.commissionAmount)}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                          ({commission.rateType === 'percentage' ? `${commission.rate}%` : 'fixed'})
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${statusColors[commission.status]}`}>
                          {commission.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {commission.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleApprove(commission.id)}
                              disabled={processing === commission.id}
                              className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                              title="Approve"
                            >
                              {processing === commission.id ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Check size={16} />
                              )}
                            </button>
                            <button
                              onClick={() => handleCancelClick(commission.id)}
                              disabled={processing === commission.id}
                              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                              title="Cancel"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
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
          </>
        )}
      </div>

      {/* Cancellation Modal */}
      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => {
          setShowCancelModal(false)
          setCancellingId(null)
        }}
        onConfirm={handleCancel}
        title="Cancel Commission"
        itemName="this commission"
        processing={processing === cancellingId}
        documentType="sales_invoice"
      />
    </>
  )
}

// ==================== PAYOUTS TAB ====================

function PayoutsTab() {
  const [payouts, setPayouts] = useState<CommissionPayout[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  // Create payout modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createFormData, setCreateFormData] = useState({
    userId: '',
    periodStart: '',
    periodEnd: '',
    notes: '',
  })
  const [creatingPayout, setCreatingPayout] = useState(false)
  const [eligibleAmount, setEligibleAmount] = useState<number | null>(null)
  const [loadingEligible, setLoadingEligible] = useState(false)

  // View detail modal
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedPayout, setSelectedPayout] = useState<CommissionPayout | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Mark as paid modal
  const [showPayModal, setShowPayModal] = useState(false)
  const [payingPayoutId, setPayingPayoutId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentReference, setPaymentReference] = useState('')

  // Users for dropdown
  const [users, setUsers] = useState<UserOption[]>([])

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })

  const fetchPayouts = useCallback(async () => {
    try {
      const res = await fetch(`/api/commission-payouts?page=${page}&pageSize=${pageSize}`)
      if (res.ok) {
        const result = await res.json()
        if (result.data) {
          setPayouts(result.data)
          setPagination(result.pagination)
        } else {
          setPayouts(result)
        }
      } else {
        toast.error('Failed to load payouts')
      }
    } catch (err) {
      console.error('Error fetching payouts:', err)
      toast.error('Failed to load payouts')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users?all=true')
      if (res.ok) {
        const data = await res.json()
        setUsers(Array.isArray(data) ? data : data.data || [])
      }
    } catch (err) {
      console.error('Error fetching users:', err)
    }
  }, [])

  useRealtimeData(fetchPayouts, { entityType: 'commission-payout', refreshOnMount: false })

  useEffect(() => {
    fetchPayouts()
    fetchUsers()
  }, [fetchPayouts, fetchUsers])

  // Check eligible amount when user/dates change
  useEffect(() => {
    async function checkEligible() {
      if (!createFormData.userId || !createFormData.periodStart || !createFormData.periodEnd) {
        setEligibleAmount(null)
        return
      }

      setLoadingEligible(true)
      try {
        const params = new URLSearchParams({
          userId: createFormData.userId,
          dateFrom: createFormData.periodStart,
          dateTo: createFormData.periodEnd,
          unpaidOnly: 'true',
        })
        const res = await fetch(`/api/commissions?${params}`)
        if (res.ok) {
          const result = await res.json()
          const total = (result.data || result).reduce((sum: number, c: Commission) => sum + parseFloat(c.commissionAmount), 0)
          setEligibleAmount(total)
        }
      } catch (err) {
        console.error('Error checking eligible amount:', err)
      } finally {
        setLoadingEligible(false)
      }
    }

    checkEligible()
  }, [createFormData.userId, createFormData.periodStart, createFormData.periodEnd])

  function openCreateModal() {
    setCreateFormData({ userId: '', periodStart: '', periodEnd: '', notes: '' })
    setEligibleAmount(null)
    setShowCreateModal(true)
  }

  function closeCreateModal() {
    setShowCreateModal(false)
    setCreateFormData({ userId: '', periodStart: '', periodEnd: '', notes: '' })
    setEligibleAmount(null)
  }

  async function handleCreatePayout(e: React.FormEvent) {
    e.preventDefault()

    if (!createFormData.userId || !createFormData.periodStart || !createFormData.periodEnd) {
      toast.error('Please fill in all required fields')
      return
    }

    if (eligibleAmount === null || eligibleAmount <= 0) {
      toast.error('No eligible commissions found for the selected period')
      return
    }

    setCreatingPayout(true)
    try {
      const res = await fetch('/api/commission-payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createFormData),
      })

      if (res.ok) {
        toast.success('Payout created successfully')
        closeCreateModal()
        fetchPayouts()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create payout')
      }
    } catch {
      toast.error('Error creating payout')
    } finally {
      setCreatingPayout(false)
    }
  }

  async function handleViewDetail(id: string) {
    setLoadingDetail(true)
    setShowDetailModal(true)

    try {
      const res = await fetch(`/api/commission-payouts/${id}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedPayout(data)
      } else {
        toast.error('Failed to load payout details')
        setShowDetailModal(false)
      }
    } catch {
      toast.error('Error loading payout details')
      setShowDetailModal(false)
    } finally {
      setLoadingDetail(false)
    }
  }

  function closeDetailModal() {
    setShowDetailModal(false)
    setSelectedPayout(null)
  }

  async function handleApprove(id: string) {
    setProcessing(id)
    try {
      const res = await fetch(`/api/commission-payouts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })

      if (res.ok) {
        toast.success('Payout approved')
        fetchPayouts()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to approve')
      }
    } catch {
      toast.error('Error approving payout')
    } finally {
      setProcessing(null)
    }
  }

  function openPayModal(id: string) {
    setPayingPayoutId(id)
    setPaymentMethod('')
    setPaymentReference('')
    setShowPayModal(true)
  }

  function closePayModal() {
    setShowPayModal(false)
    setPayingPayoutId(null)
    setPaymentMethod('')
    setPaymentReference('')
  }

  async function handleMarkAsPaid(e: React.FormEvent) {
    e.preventDefault()

    if (!payingPayoutId || !paymentMethod) {
      toast.error('Payment method is required')
      return
    }

    setProcessing(payingPayoutId)
    try {
      const res = await fetch(`/api/commission-payouts/${payingPayoutId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'paid',
          paymentMethod,
          paymentReference,
        }),
      })

      if (res.ok) {
        toast.success('Payout marked as paid')
        closePayModal()
        fetchPayouts()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update payout')
      }
    } catch {
      toast.error('Error updating payout')
    } finally {
      setProcessing(null)
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Are you sure you want to cancel this payout? The linked commissions will be unlinked.')) return

    setProcessing(id)
    try {
      const res = await fetch(`/api/commission-payouts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })

      if (res.ok) {
        toast.success('Payout cancelled')
        fetchPayouts()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel')
      }
    } catch {
      toast.error('Error cancelling payout')
    } finally {
      setProcessing(null)
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function formatCurrency(amount: string | number) {
    return new Intl.NumberFormat('en-LK', {
      style: 'currency',
      currency: 'LKR',
      minimumFractionDigits: 2,
    }).format(Number(amount))
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Create and manage commission payouts for staff members
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          <Plus size={18} />
          Create Payout
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-md border dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
        ) : payouts.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No payouts found. Click &quot;Create Payout&quot; to create one.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Payout #</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Period</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Amount</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-300">Items</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Payment</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {payouts.map((payout) => (
                    <tr key={payout.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium dark:text-white">{payout.payoutNo}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {payout.userName || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {formatDate(payout.periodStart)} - {formatDate(payout.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-medium dark:text-white">{formatCurrency(payout.totalAmount)}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-400">
                        {payout.commissionsCount}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${statusColors[payout.status]}`}>
                          {payout.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {payout.paymentMethod ? (
                          <div>
                            <div className="capitalize">{payout.paymentMethod}</div>
                            {payout.paidAt && (
                              <div className="text-xs text-gray-400">{formatDate(payout.paidAt)}</div>
                            )}
                          </div>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleViewDetail(payout.id)}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>

                          {payout.status === 'draft' && (
                            <>
                              <button
                                onClick={() => handleApprove(payout.id)}
                                disabled={processing === payout.id}
                                className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                title="Approve"
                              >
                                {processing === payout.id ? (
                                  <Loader2 size={16} className="animate-spin" />
                                ) : (
                                  <Check size={16} />
                                )}
                              </button>
                              <button
                                onClick={() => handleCancel(payout.id)}
                                disabled={processing === payout.id}
                                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                title="Cancel"
                              >
                                <Ban size={16} />
                              </button>
                            </>
                          )}

                          {payout.status === 'approved' && (
                            <>
                              <button
                                onClick={() => openPayModal(payout.id)}
                                disabled={processing === payout.id}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                title="Mark as Paid"
                              >
                                <DollarSign size={16} />
                              </button>
                              <button
                                onClick={() => handleCancel(payout.id)}
                                disabled={processing === payout.id}
                                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                title="Cancel"
                              >
                                <Ban size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
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
          </>
        )}
      </div>

      {/* Create Payout Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={closeCreateModal}
        title="Create Payout"
        size="md"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={closeCreateModal}
              className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-payout-form"
              disabled={creatingPayout || eligibleAmount === null || eligibleAmount <= 0}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {creatingPayout && <Loader2 size={16} className="animate-spin" />}
              Create Payout
            </button>
          </ModalFooter>
        }
      >
        <form id="create-payout-form" onSubmit={handleCreatePayout} className="space-y-4">
          <FormField label="User" required>
            <FormSelect
              value={createFormData.userId}
              onChange={(e) => setCreateFormData({ ...createFormData, userId: e.target.value })}
              required
            >
              <option value="">Select User</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.fullName}</option>
              ))}
            </FormSelect>
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Period Start" required>
              <FormInput
                type="date"
                value={createFormData.periodStart}
                onChange={(e) => setCreateFormData({ ...createFormData, periodStart: e.target.value })}
                required
              />
            </FormField>

            <FormField label="Period End" required>
              <FormInput
                type="date"
                value={createFormData.periodEnd}
                onChange={(e) => setCreateFormData({ ...createFormData, periodEnd: e.target.value })}
                required
              />
            </FormField>
          </div>

          {/* Eligible Amount Display */}
          {createFormData.userId && createFormData.periodStart && createFormData.periodEnd && (
            <div className={`p-4 rounded ${eligibleAmount && eligibleAmount > 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-700'}`}>
              <div className="text-sm text-gray-600 dark:text-gray-400">Eligible Commission Amount</div>
              {loadingEligible ? (
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mt-1">
                  <Loader2 size={16} className="animate-spin" />
                  Calculating...
                </div>
              ) : (
                <div className={`text-2xl font-bold ${eligibleAmount && eligibleAmount > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {formatCurrency(eligibleAmount || 0)}
                </div>
              )}
              {eligibleAmount === 0 && (
                <div className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                  No approved commissions found for this period
                </div>
              )}
            </div>
          )}

          <FormField label="Notes" hint="Optional notes for this payout">
            <textarea
              value={createFormData.notes}
              onChange={(e) => setCreateFormData({ ...createFormData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Add any notes about this payout..."
            />
          </FormField>
        </form>
      </Modal>

      {/* View Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={closeDetailModal}
        title={`Payout ${selectedPayout?.payoutNo || ''}`}
        size="lg"
      >
        {loadingDetail ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : selectedPayout ? (
          <div className="space-y-4">
            {/* Payout Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">User:</span>
                <span className="ml-2 font-medium dark:text-white">{selectedPayout.userName}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Status:</span>
                <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium capitalize ${statusColors[selectedPayout.status]}`}>
                  {selectedPayout.status}
                </span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Period:</span>
                <span className="ml-2 dark:text-white">{formatDate(selectedPayout.periodStart)} - {formatDate(selectedPayout.periodEnd)}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Total:</span>
                <span className="ml-2 font-bold dark:text-white">{formatCurrency(selectedPayout.totalAmount)}</span>
              </div>
              {selectedPayout.paymentMethod && (
                <>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Payment Method:</span>
                    <span className="ml-2 capitalize dark:text-white">{selectedPayout.paymentMethod}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Reference:</span>
                    <span className="ml-2 dark:text-white">{selectedPayout.paymentReference || '-'}</span>
                  </div>
                </>
              )}
            </div>

            {/* Linked Commissions */}
            <div className="border-t dark:border-gray-700 pt-4">
              <h4 className="font-medium mb-3 dark:text-white">Included Commissions ({selectedPayout.commissionsCount})</h4>
              <div className="max-h-64 overflow-y-auto border dark:border-gray-700 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Date</th>
                      <th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Reference</th>
                      <th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Item</th>
                      <th className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {selectedPayout.commissions?.map((commission) => (
                      <tr key={commission.id}>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{formatDate(commission.createdAt)}</td>
                        <td className="px-3 py-2">
                          {commission.saleInvoiceNo ? (
                            <span className="text-blue-600 dark:text-blue-400">Sale #{commission.saleInvoiceNo}</span>
                          ) : commission.workOrderNo ? (
                            <span className="text-purple-600 dark:text-purple-400">WO #{commission.workOrderNo}</span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{commission.itemName || '-'}</td>
                        <td className="px-3 py-2 text-right font-medium dark:text-white">{formatCurrency(commission.commissionAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Notes */}
            {selectedPayout.notes && (
              <div className="border-t dark:border-gray-700 pt-4">
                <h4 className="font-medium mb-2 dark:text-white">Notes</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">{selectedPayout.notes}</p>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Mark as Paid Modal */}
      <Modal
        isOpen={showPayModal}
        onClose={closePayModal}
        title="Mark Payout as Paid"
        size="sm"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={closePayModal}
              className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="pay-form"
              disabled={processing === payingPayoutId}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {processing === payingPayoutId && <Loader2 size={16} className="animate-spin" />}
              Confirm Payment
            </button>
          </ModalFooter>
        }
      >
        <form id="pay-form" onSubmit={handleMarkAsPaid} className="space-y-4">
          <FormField label="Payment Method" required>
            <FormSelect
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              required
            >
              <option value="">Select Method</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </FormSelect>
          </FormField>

          <FormField label="Reference Number" hint="Optional transaction reference">
            <FormInput
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="e.g., Transaction ID, Cheque #"
            />
          </FormField>
        </form>
      </Modal>
    </>
  )
}

// ==================== APPLY ALL CONTROL ====================

function ApplyAllControl({ onApply }: { onApply: (rate: string, rateType: 'percentage' | 'fixed') => void }) {
  const [rate, setRate] = useState('')
  const [rateType, setRateType] = useState<'percentage' | 'fixed'>('percentage')

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">Apply to all:</span>
      <input
        type="number"
        step="0.01"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        className="w-20 px-2 py-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        placeholder="0"
      />
      <select
        value={rateType}
        onChange={(e) => setRateType(e.target.value as 'percentage' | 'fixed')}
        className="px-2 py-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
      >
        <option value="percentage">%</option>
        <option value="fixed">Fixed</option>
      </select>
      <button
        type="button"
        onClick={() => {
          if (!rate) return
          onApply(rate, rateType)
        }}
        disabled={!rate}
        className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        Apply
      </button>
    </div>
  )
}

// ==================== RATE MATRIX TAB ====================

interface MatrixCell {
  rate: string
  rateType: 'percentage' | 'fixed'
}

function RateMatrixTab() {
  const [users, setUsers] = useState<UserOption[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Matrix data: key is `cat-${categoryId}` or `svc-${serviceTypeId}`, value is cell
  const [matrixData, setMatrixData] = useState<Record<string, MatrixCell>>({})

  // Load users, categories, service types
  useEffect(() => {
    async function loadOptions() {
      try {
        const [usersRes, catsRes, svcsRes] = await Promise.all([
          fetch('/api/users?all=true'),
          fetch('/api/categories?all=true'),
          fetch('/api/service-types?all=true'),
        ])
        if (usersRes.ok) {
          const data = await usersRes.json()
          setUsers(Array.isArray(data) ? data : data.data || [])
        }
        if (catsRes.ok) {
          const data = await catsRes.json()
          setCategories(Array.isArray(data) ? data : data.data || [])
        }
        if (svcsRes.ok) {
          const data = await svcsRes.json()
          setServiceTypes(Array.isArray(data) ? data : data.data || [])
        }
      } catch {
        toast.error('Failed to load options')
      } finally {
        setLoading(false)
      }
    }
    loadOptions()
  }, [])

  // Load matrix data for selected user
  useEffect(() => {
    if (!selectedUserId) {
      setMatrixData({})
      return
    }
    async function loadMatrix() {
      setLoading(true)
      try {
        const res = await fetch(`/api/commission-rates/matrix?userId=${selectedUserId}`)
        if (res.ok) {
          const data = await res.json()
          const mapped: Record<string, MatrixCell> = {}
          if (data.categoryRates) {
            for (const r of data.categoryRates) {
              mapped[`cat-${r.categoryId}`] = { rate: r.rate, rateType: r.rateType }
            }
          }
          if (data.serviceTypeRates) {
            for (const r of data.serviceTypeRates) {
              mapped[`svc-${r.serviceTypeId}`] = { rate: r.rate, rateType: r.rateType }
            }
          }
          setMatrixData(mapped)
          setDirty(false)
        }
      } catch {
        toast.error('Failed to load rates')
      } finally {
        setLoading(false)
      }
    }
    loadMatrix()
  }, [selectedUserId])

  function updateCell(key: string, rate: string) {
    setDirty(true)
    setMatrixData((prev) => ({
      ...prev,
      [key]: { rate, rateType: prev[key]?.rateType || 'percentage' },
    }))
  }

  function updateCellType(key: string, rateType: 'percentage' | 'fixed') {
    setDirty(true)
    setMatrixData((prev) => ({
      ...prev,
      [key]: { rate: prev[key]?.rate || '', rateType },
    }))
  }

  async function handleSave() {
    if (!selectedUserId) return
    setSaving(true)
    try {
      const entries: Array<{
        userId: string
        categoryId?: string
        serviceTypeId?: string
        rate: number
        rateType: string
      }> = []

      for (const [key, cell] of Object.entries(matrixData)) {
        if (!cell.rate || Number(cell.rate) === 0) continue
        if (key.startsWith('cat-')) {
          entries.push({
            userId: selectedUserId,
            categoryId: key.replace('cat-', ''),
            rate: Number(cell.rate),
            rateType: cell.rateType,
          })
        } else if (key.startsWith('svc-')) {
          entries.push({
            userId: selectedUserId,
            serviceTypeId: key.replace('svc-', ''),
            rate: Number(cell.rate),
            rateType: cell.rateType,
          })
        }
      }

      const res = await fetch('/api/commission-rates/matrix', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, entries }),
      })
      if (res.ok) {
        toast.success('Rates saved')
        setDirty(false)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save rates')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Employee:</label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="px-3 py-2 border rounded text-sm min-w-[200px]"
          >
            <option value="">Select employee...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        </div>
        {selectedUserId && (
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save All
          </button>
        )}
      </div>

      {!selectedUserId ? (
        <div className="text-center py-12 text-gray-500">
          <DollarSign className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Select an employee to view and edit their commission rates</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Category Rates Grid */}
          {categories.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between gap-4 flex-wrap">
                <h3 className="text-sm font-semibold dark:text-white">Category Commission Rates</h3>
                <ApplyAllControl
                  onApply={(rate, rateType) => {
                    setDirty(true)
                    setMatrixData((prev) => {
                      const next = { ...prev }
                      for (const cat of categories) {
                        next[`cat-${cat.id}`] = { rate, rateType }
                      }
                      return next
                    })
                  }}
                />
              </div>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2 w-32">Rate</th>
                    <th className="px-4 py-2 w-32">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {categories.map((cat) => {
                    const key = `cat-${cat.id}`
                    const cell = matrixData[key]
                    return (
                      <tr key={cat.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium">{cat.name}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={cell?.rate || ''}
                            onChange={(e) => updateCell(key, e.target.value)}
                            className="w-full px-2 py-1 border rounded text-sm"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={cell?.rateType || 'percentage'}
                            onChange={(e) => updateCellType(key, e.target.value as 'percentage' | 'fixed')}
                            className="w-full px-2 py-1 border rounded text-sm"
                          >
                            <option value="percentage">%</option>
                            <option value="fixed">Fixed</option>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Service Type Rates Grid */}
          {serviceTypes.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between gap-4 flex-wrap">
                <h3 className="text-sm font-semibold dark:text-white">Service Type Commission Rates</h3>
                <ApplyAllControl
                  onApply={(rate, rateType) => {
                    setDirty(true)
                    setMatrixData((prev) => {
                      const next = { ...prev }
                      for (const svc of serviceTypes) {
                        next[`svc-${svc.id}`] = { rate, rateType }
                      }
                      return next
                    })
                  }}
                />
              </div>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-4 py-2">Service Type</th>
                    <th className="px-4 py-2 w-32">Rate</th>
                    <th className="px-4 py-2 w-32">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {serviceTypes.map((svc) => {
                    const key = `svc-${svc.id}`
                    const cell = matrixData[key]
                    return (
                      <tr key={svc.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium">{svc.name}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={cell?.rate || ''}
                            onChange={(e) => updateCell(key, e.target.value)}
                            className="w-full px-2 py-1 border rounded text-sm"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={cell?.rateType || 'percentage'}
                            onChange={(e) => updateCellType(key, e.target.value as 'percentage' | 'fixed')}
                            className="w-full px-2 py-1 border rounded text-sm"
                          >
                            <option value="percentage">%</option>
                            <option value="fixed">Fixed</option>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

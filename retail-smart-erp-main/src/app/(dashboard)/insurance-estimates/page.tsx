'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Car, FileText, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination } from '@/components/ui/pagination'

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  customerId: string | null
}

interface InsuranceCompany {
  id: string
  name: string
  shortName: string | null
}

interface EstimateItem {
  id: string
  status: string
}

interface InsuranceEstimate {
  id: string
  estimateNo: string
  estimateType: 'insurance' | 'direct'
  status: string
  revisionNumber: number
  policyNumber: string | null
  claimNumber: string | null
  incidentDate: string | null
  originalTotal: string
  approvedTotal: string
  createdAt: string
  cancellationReason: string | null
  customer: Customer | null
  vehicle: Vehicle | null
  insuranceCompany: InsuranceCompany | null
  items: EstimateItem[]
}

interface StatusConfig {
  color: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}

const statusConfig: Record<string, StatusConfig> = {
  draft: { color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200', icon: FileText, label: 'Draft' },
  submitted: { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', icon: Clock, label: 'Submitted' },
  under_review: { color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', icon: AlertCircle, label: 'Under Review' },
  approved: { color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', icon: CheckCircle, label: 'Approved' },
  partially_approved: { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200', icon: AlertCircle, label: 'Partially Approved' },
  rejected: { color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', icon: XCircle, label: 'Rejected' },
  work_order_created: { color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200', icon: CheckCircle, label: 'Work Order Created' },
  cancelled: { color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', icon: XCircle, label: 'Cancelled' },
}

export default function InsuranceEstimatesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { tenantSlug } = useCompany()
  const urlStatus = searchParams.get('status')

  const [statusFilter, setStatusFilter] = useState(urlStatus || '')
  const [insuranceFilter, setInsuranceFilter] = useState('')
  const [insuranceCompanies, setInsuranceCompanies] = useState<InsuranceCompany[]>([])

  // Fetch insurance companies for filter dropdown
  useEffect(() => {
    async function fetchInsuranceCompanies() {
      try {
        const res = await fetch('/api/insurance-companies?all=true')
        if (res.ok) {
          const data = await res.json()
          setInsuranceCompanies(data)
        }
      } catch (error) {
        console.error('Error fetching insurance companies:', error)
      }
    }
    fetchInsuranceCompanies()
  }, [])

  // Navigate to detail page
  function handleRowClick(estimateId: string) {
    router.push(tenantSlug ? `/c/${tenantSlug}/insurance-estimates/${estimateId}` : `/insurance-estimates/${estimateId}`)
  }

  // Build additional params for server-side filtering
  const additionalParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (statusFilter && statusFilter !== 'awaiting_review') params.status = statusFilter
    if (insuranceFilter) params.insuranceCompanyId = insuranceFilter
    return params
  }, [statusFilter, insuranceFilter])

  // Paginated estimates data
  const {
    data: estimates,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
  } = usePaginatedData<InsuranceEstimate>({
    endpoint: '/api/insurance-estimates',
    entityType: 'estimate',
    storageKey: 'insurance-estimates-page-size',
    additionalParams,
  })

  // Filter estimates client-side for special 'awaiting_review' filter
  const filteredEstimates = useMemo(() => {
    if (statusFilter === 'awaiting_review') {
      return estimates.filter(est => est.status === 'submitted' || est.status === 'under_review')
    }
    return estimates
  }, [estimates, statusFilter])

  // Stats
  const stats = useMemo(() => {
    const counts: Record<string, number> = {}
    estimates.forEach(est => {
      counts[est.status] = (counts[est.status] || 0) + 1
    })
    return counts
  }, [estimates])

  if (loading && estimates.length === 0) {
    return <PageLoading text="Loading estimates..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold dark:text-white">Estimates</h1>
        <button
          onClick={() => router.push(tenantSlug ? `/c/${tenantSlug}/insurance-estimates/new` : '/insurance-estimates/new')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          aria-label="Create new estimate"
        >
          <Plus size={20} aria-hidden="true" />
          New Estimate
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 p-4 rounded border dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">Drafts</div>
          <div className="text-2xl font-bold text-gray-800 dark:text-white">{stats.draft || 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded border dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">Pending Review</div>
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {(stats.submitted || 0) + (stats.under_review || 0)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded border dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">Approved</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {(stats.approved || 0) + (stats.partially_approved || 0)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded border dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">Converted</div>
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.work_order_created || 0}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by estimate no, claim, policy..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Statuses</option>
          <option value="awaiting_review">Awaiting Review</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="partially_approved">Partially Approved</option>
          <option value="rejected">Rejected</option>
          <option value="work_order_created">Work Order Created</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={insuranceFilter}
          onChange={(e) => setInsuranceFilter(e.target.value)}
          className="px-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Insurance Companies</option>
          {insuranceCompanies.map(ic => (
            <option key={ic.id} value={ic.id}>{ic.shortName || ic.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of insurance estimates</caption>
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Estimate No</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Customer</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Insurance</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Original</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Approved</th>
            </tr>
          </thead>
          <tbody>
            {filteredEstimates.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search || statusFilter || insuranceFilter
                    ? 'No estimates match your filters'
                    : 'No estimates yet. Create your first estimate!'}
                </td>
              </tr>
            ) : (
              filteredEstimates.map((est) => {
                const config = statusConfig[est.status] || statusConfig.draft
                const StatusIcon = config.icon
                return (
                  <tr
                    key={est.id}
                    onClick={() => handleRowClick(est.id)}
                    className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          {est.estimateNo}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${est.estimateType === 'insurance' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                          {est.estimateType === 'insurance' ? 'INS' : 'DIR'}
                        </span>
                        {est.revisionNumber > 1 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">Rev {est.revisionNumber}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.color}`}>
                        <StatusIcon size={12} />
                        {config.label}
                      </span>
                      {est.status === 'cancelled' && est.cancellationReason && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1" title={est.cancellationReason}>
                          {est.cancellationReason.length > 30 ? `${est.cancellationReason.slice(0, 30)}...` : est.cancellationReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {est.customer?.name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {est.vehicle ? (
                        <div className="flex items-center gap-2">
                          <Car size={16} className="text-gray-400" />
                          <span className="text-gray-600 dark:text-gray-300">
                            {est.vehicle.licensePlate && <span className="font-medium">[{est.vehicle.licensePlate}]</span>}{' '}
                            {est.vehicle.year ? `${est.vehicle.year} ` : ''}{est.vehicle.make} {est.vehicle.model}
                          </span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {est.insuranceCompany?.shortName || est.insuranceCompany?.name || '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium dark:text-white">
                      LKR {parseFloat(est.originalTotal).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {parseFloat(est.approvedTotal) > 0 ? (
                        <span className="text-green-600 dark:text-green-400">
                          LKR {parseFloat(est.approvedTotal).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                )
              })
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
          className="border-t dark:border-gray-700 px-4"
        />
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Ship, ExternalLink } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface VehicleImport {
  id: string
  importNo: string
  vehicleInventoryId: string | null
  supplierId: string | null
  supplierName: string | null
  vehicleDescription: string | null
  stockNo: string | null
  cifValueLkr: string | null
  totalTaxes: string | null
  totalLandedCost: string | null
  billOfLadingNo: string | null
  customsDeclarationNo: string | null
  portOfEntry: string | null
  arrivalDate: string | null
  clearanceDate: string | null
  status: string
  createdAt: string
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  in_transit: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  at_port: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  customs_clearing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  cleared: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  registered: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_transit: 'In Transit',
  at_port: 'At Port',
  customs_clearing: 'Customs Clearing',
  cleared: 'Cleared',
  registered: 'Registered',
}

export default function VehicleImportsPage() {
  const { tenantSlug } = useCompany()
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const {
    data: imports,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<VehicleImport>({
    endpoint: '/api/vehicle-imports',
    entityType: 'vehicle-import',
    storageKey: 'vehicle-imports-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'at_port', label: 'At Port' },
    { key: 'customs_clearing', label: 'Customs Clearing' },
    { key: 'cleared', label: 'Cleared' },
    { key: 'registered', label: 'Registered' },
  ]

  function formatCurrency(value: string | null): string {
    if (!value) return '-'
    return parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function formatDate(value: string | null): string {
    if (!value) return '-'
    return new Date(value).toLocaleDateString()
  }

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Vehicle Imports"
      actionContent={
        <div className="flex items-center gap-2">
          <Link
            href={`/c/${tenantSlug}/dealership/imports/new`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Ship size={16} />
            New Import
          </Link>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Import #, BOL, Customs Declaration..."
    >
      {/* Filter Tabs */}
      <div className="px-4 pb-2">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key)
                setPage(1)
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                statusFilter === tab.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 list-container-xl overflow-x-auto mx-4">
        <table className="w-full">
          <caption className="sr-only">Vehicle imports list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Import No</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Supplier</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">CIF Value (LKR)</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Taxes</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Landed Cost</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
            </tr>
          </thead>
          <tbody>
            {imports.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {loading ? 'Loading...' : search ? 'No imports match your search' : 'No vehicle imports yet. Create your first import!'}
                </td>
              </tr>
            ) : (
              imports.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">
                    <Link href={`/c/${tenantSlug}/dealership/imports/${item.id}`}>
                      {item.importNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {item.vehicleInventoryId ? (
                      <Link
                        href={`/c/${tenantSlug}/dealership/inventory/${item.vehicleInventoryId}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        {item.vehicleDescription || item.stockNo || 'View Vehicle'}
                        <ExternalLink size={12} />
                      </Link>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">Not linked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {item.supplierName || '-'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-gray-900 dark:text-white">
                    {formatCurrency(item.cifValueLkr)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                    {formatCurrency(item.totalTaxes)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(item.totalLandedCost)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[item.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {statusLabels[item.status] || item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(item.createdAt)}
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
          className="border-t border-gray-200 dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>
    </ListPageLayout>
  )
}

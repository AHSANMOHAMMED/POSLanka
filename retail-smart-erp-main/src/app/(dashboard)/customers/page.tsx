'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Plus, Pencil, Trash2, Car, ShoppingCart, Wrench, FileText, X, ExternalLink, ArrowLeft, Download, Upload } from 'lucide-react'
import { usePaginatedData, useTerminology } from '@/hooks'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { CustomerFormModal } from '@/components/modals'
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
} from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'

interface Customer {
  id: string
  name: string
  firstName: string | null
  lastName: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  mobilePhone: string | null
  alternatePhone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  useSameBillingAddress: boolean
  billingAddressLine1: string | null
  billingAddressLine2: string | null
  billingCity: string | null
  billingState: string | null
  billingPostalCode: string | null
  billingCountry: string | null
  taxId: string | null
  taxExempt: boolean
  businessType: 'individual' | 'company'
  creditLimit: string | null
  paymentTerms: string | null
  defaultPaymentMethod: string | null
  customerType: 'retail' | 'wholesale' | 'vip'
  referralSource: string | null
  marketingOptIn: boolean
  birthday: string | null
  notes: string | null
  specialInstructions: string | null
  driverLicenseNumber: string | null
  paymentTermsTemplateId: string | null
  createdAt: string
}

interface Vehicle {
  id: string
  make: string | null
  model: string | null
  year: number | null
  licensePlate: string | null
  vin: string | null
  color: string | null
}

interface Sale {
  id: string
  invoiceNo: string
  total: string
  status: string
  createdAt: string
}

interface WorkOrder {
  id: string
  orderNo: string
  status: string
  grandTotal: string
  createdAt: string
  vehiclePlate: string | null
}

interface Estimate {
  id: string
  estimateNo: string
  status: string
  grandTotal: string
  createdAt: string
}

// Customer type badge colors
const customerTypeColors: Record<string, 'gray' | 'blue' | 'purple'> = {
  retail: 'gray',
  wholesale: 'blue',
  vip: 'purple',
}

export default function CustomersPage() {
  const { data: session } = useSession()
  const tenantSlug = session?.user?.tenantSlug || ''
  const t = useTerminology()
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()
  const [showModal, setShowModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  // Related data for selected customer
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loadingRelated, setLoadingRelated] = useState(false)

  const {
    data: customers,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Customer>({
    endpoint: '/api/customers',
    entityType: 'customer',
    storageKey: 'customers-page-size',
  })

  // Fetch related data when customer is selected
  const fetchRelatedData = useCallback(async (customerId: string) => {
    setLoadingRelated(true)
    try {
      const [vehiclesRes, salesRes, workOrdersRes, estimatesRes] = await Promise.all([
        fetch(`/api/vehicles?customerId=${customerId}&all=true`),
        fetch(`/api/sales?customerId=${customerId}&all=true`),
        fetch(`/api/work-orders?customerId=${customerId}&all=true`),
        fetch(`/api/insurance-estimates?customerId=${customerId}&all=true`),
      ])

      if (vehiclesRes.ok) {
        const data = await vehiclesRes.json()
        setVehicles(Array.isArray(data) ? data : data.data || [])
      }
      if (salesRes.ok) {
        const data = await salesRes.json()
        setSales(Array.isArray(data) ? data : data.data || [])
      }
      if (workOrdersRes.ok) {
        const data = await workOrdersRes.json()
        setWorkOrders(Array.isArray(data) ? data : data.data || [])
      }
      if (estimatesRes.ok) {
        const data = await estimatesRes.json()
        setEstimates(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error('Error fetching related data:', error)
    } finally {
      setLoadingRelated(false)
    }
  }, [])

  useEffect(() => {
    if (selectedCustomer) {
      fetchRelatedData(selectedCustomer.id)
    }
  }, [selectedCustomer, fetchRelatedData])

  async function handleDelete() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/customers/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        if (selectedCustomer?.id === deleteConfirm.id) {
          setSelectedCustomer(null)
        }
        toast.success('Customer deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete customer')
      }
    } catch (error) {
      console.error('Error deleting customer:', error)
      toast.error('Failed to delete customer')
    } finally {
      setDeleteConfirm({ open: false, id: null, name: '' })
    }
  }

  function handleEdit(customer: Customer) {
    setEditingCustomer(customer)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingCustomer(null)
  }

  function handleSelectCustomer(customer: Customer) {
    setSelectedCustomer(customer)
  }

  if (loading && customers.length === 0) {
    return <PageLoading text="Loading customers..." />
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-auto lg:h-[calc(100vh-7rem)]">
      {/* Left Column - Customer List */}
      <div className={`${selectedCustomer ? 'lg:w-1/2' : 'w-full'} flex flex-col transition-all duration-300 ${selectedCustomer ? 'hidden lg:flex' : ''}`}>
        <ListPageHeader
          title={t.customers}
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
                {t.newCustomer}
              </Button>
            </div>
          }
        />

        {/* Search */}
        <div className="mb-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by name, email, or phone..."
            className="max-w-md"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 flex-1 overflow-hidden flex flex-col">
          <div className="overflow-x-auto flex-1">
            <table className="w-full">
              <caption className="sr-only">List of customers</caption>
              <thead className="bg-gray-50 dark:bg-gray-700 table-sticky-header">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Type</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Phone</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">City</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center">
                      <EmptyState
                        title={search ? `No ${t.customers.toLowerCase()} match your search` : `No ${t.customers.toLowerCase()} yet`}
                        description={search ? 'Try adjusting your search terms' : 'Add your first customer to get started'}
                        action={
                          !search && (
                            <Button onClick={() => setShowModal(true)} size="sm">
                              <Plus size={16} className="mr-1" />
                              {t.newCustomer}
                            </Button>
                          )
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  customers.map((customer) => (
                    <tr
                      key={customer.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${selectedCustomer?.id === customer.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      onClick={() => handleSelectCustomer(customer)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900 dark:text-white">{customer.name}</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <LabelBadge color={customerTypeColors[customer.customerType || 'retail']}>
                          {customer.customerType || 'retail'}
                        </LabelBadge>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{customer.phone || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hidden md:table-cell">{customer.city || '-'}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleEdit(customer)}
                          aria-label={`Edit ${customer.name}`}
                          className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ open: true, id: customer.id, name: customer.name })}
                          aria-label={`Delete ${customer.name}`}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded ml-1 transition-colors"
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

      {/* Right Column - Customer Details */}
      {selectedCustomer && (
        <div className="w-full lg:w-1/2 flex flex-col bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-start">
            <div className="flex items-center gap-3">
              {/* Back button on mobile */}
              <button
                onClick={() => setSelectedCustomer(null)}
                className="lg:hidden p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-500"
                aria-label="Back to list"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{selectedCustomer.name}</h2>
                  <LabelBadge color={customerTypeColors[selectedCustomer.customerType || 'retail']}>
                    {selectedCustomer.customerType || 'retail'}
                  </LabelBadge>
                </div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {selectedCustomer.email && <span className="mr-4">{selectedCustomer.email}</span>}
                  {selectedCustomer.phone && <span>{selectedCustomer.phone}</span>}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedCustomer(null)}
              className="hidden lg:block p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-500"
              aria-label="Close details"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingRelated ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                {/* Customer Info */}
                <SectionCard title="Contact Information" icon={<Car size={16} />} collapsible defaultCollapsed>
                  <FieldGrid columns={2}>
                    <Field label="Email" value={selectedCustomer.email} copyable />
                    <Field label="Phone" value={selectedCustomer.phone} copyable />
                    <Field label="Mobile" value={selectedCustomer.mobilePhone} />
                    <Field label="City" value={selectedCustomer.city} />
                    <Field label="Tax ID" value={selectedCustomer.taxId} />
                    <Field label="Credit Limit" value={selectedCustomer.creditLimit ? formatCurrency(parseFloat(selectedCustomer.creditLimit)) : null} />
                  </FieldGrid>
                </SectionCard>

                {/* Vehicles */}
                <SectionCard
                  title="Vehicles"
                  icon={<Car size={16} />}
                  actions={<span className="text-sm text-gray-500">{vehicles.length}</span>}
                >
                  {vehicles.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-2">No vehicles registered</p>
                  ) : (
                    <div className="space-y-2">
                      {vehicles.map((vehicle) => (
                        <a
                          key={vehicle.id}
                          href={`/c/${tenantSlug}/vehicles?search=${vehicle.licensePlate || vehicle.vin || ''}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded hover:bg-gray-100 dark:hover:bg-gray-700 group transition-colors"
                        >
                          <div>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown Vehicle'}
                            </span>
                            {vehicle.licensePlate && (
                              <span className="ml-2 text-sm text-gray-500">{vehicle.licensePlate}</span>
                            )}
                            {vehicle.color && (
                              <span className="ml-2 text-sm text-gray-500">({vehicle.color})</span>
                            )}
                          </div>
                          <ExternalLink size={14} className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {/* POS Sales */}
                <SectionCard
                  title="POS Sales"
                  icon={<ShoppingCart size={16} />}
                  actions={<span className="text-sm text-gray-500">{sales.length}</span>}
                >
                  {sales.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-2">No sales recorded</p>
                  ) : (
                    <div className="space-y-2">
                      {sales.slice(0, 10).map((sale) => (
                        <a
                          key={sale.id}
                          href={`/c/${tenantSlug}/sales?search=${sale.invoiceNo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded hover:bg-gray-100 dark:hover:bg-gray-700 group transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900 dark:text-white">{sale.invoiceNo}</span>
                            <StatusBadge status={sale.status} size="sm" />
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(parseFloat(sale.total))}</span>
                            <span className="text-xs text-gray-500">
                              {new Date(sale.createdAt).toLocaleDateString()}
                            </span>
                            <ExternalLink size={14} className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </a>
                      ))}
                      {sales.length > 10 && (
                        <p className="text-sm text-gray-500 text-center py-2">
                          +{sales.length - 10} more sales
                        </p>
                      )}
                    </div>
                  )}
                </SectionCard>

                {/* Work Orders */}
                <SectionCard
                  title="Work Orders"
                  icon={<Wrench size={16} />}
                  actions={<span className="text-sm text-gray-500">{workOrders.length}</span>}
                >
                  {workOrders.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-2">No work orders</p>
                  ) : (
                    <div className="space-y-2">
                      {workOrders.slice(0, 10).map((wo) => (
                        <a
                          key={wo.id}
                          href={`/c/${tenantSlug}/work-orders/${wo.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded hover:bg-gray-100 dark:hover:bg-gray-700 group transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900 dark:text-white">{wo.orderNo}</span>
                            {wo.vehiclePlate && (
                              <span className="text-sm text-gray-500">{wo.vehiclePlate}</span>
                            )}
                            <StatusBadge status={wo.status} size="sm" />
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(parseFloat(wo.grandTotal || '0'))}</span>
                            <span className="text-xs text-gray-500">
                              {new Date(wo.createdAt).toLocaleDateString()}
                            </span>
                            <ExternalLink size={14} className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </a>
                      ))}
                      {workOrders.length > 10 && (
                        <p className="text-sm text-gray-500 text-center py-2">
                          +{workOrders.length - 10} more work orders
                        </p>
                      )}
                    </div>
                  )}
                </SectionCard>

                {/* Insurance Estimates */}
                <SectionCard
                  title="Insurance Estimates"
                  icon={<FileText size={16} />}
                  actions={<span className="text-sm text-gray-500">{estimates.length}</span>}
                >
                  {estimates.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-2">No insurance estimates</p>
                  ) : (
                    <div className="space-y-2">
                      {estimates.slice(0, 10).map((est) => (
                        <a
                          key={est.id}
                          href={`/c/${tenantSlug}/insurance-estimates/${est.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded hover:bg-gray-100 dark:hover:bg-gray-700 group transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900 dark:text-white">{est.estimateNo}</span>
                            <StatusBadge status={est.status} size="sm" />
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(parseFloat(est.grandTotal || '0'))}</span>
                            <span className="text-xs text-gray-500">
                              {new Date(est.createdAt).toLocaleDateString()}
                            </span>
                            <ExternalLink size={14} className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </a>
                      ))}
                      {estimates.length > 10 && (
                        <p className="text-sm text-gray-500 text-center py-2">
                          +{estimates.length - 10} more estimates
                        </p>
                      )}
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </div>
        </div>
      )}

      {/* Customer Form Modal */}
      <CustomerFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          refresh()
          handleCloseModal()
        }}
        editCustomer={editingCustomer}
      />

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDelete}
        title={`Delete ${t.customer}`}
        message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="customers"
        currentFilters={{ search }}
      />

      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="customers"
        onComplete={() => refresh()}
      />
    </div>
  )
}

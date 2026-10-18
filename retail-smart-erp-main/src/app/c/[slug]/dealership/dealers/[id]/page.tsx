'use client'

import { useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home, ChevronRight, ArrowLeft, Pencil, Building2,
  CreditCard, FileText, DollarSign, Clock, Users,
  Phone, Mail, MapPin, Calendar, Shield, Upload
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { toast } from '@/components/ui/toast'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

interface Dealer {
  id: string
  name: string
  code: string
  type: string | null
  contactPerson: string | null
  email: string | null
  phone: string | null
  address: string | null
  warehouseId: string | null
  territory: string | null
  commissionRate: string | null
  creditLimit: string | null
  currentBalance: string | null
  paymentTermDays: number | null
  status: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface DealerAllocation {
  id: string
  dealerId: string
  vehicleInventoryId: string
  status: string
  askingPrice: string | null
  minimumPrice: string | null
  allocatedDate: string | null
  notes: string | null
  createdAt: string
  vehicleInventory?: {
    id: string
    stockNo: string
    make: string
    model: string
    year: number | null
    vin: string | null
    status: string
  }
}

interface DealerPayment {
  id: string
  paymentNo: string
  type: string
  direction: string
  amount: string
  paymentMethod: string | null
  referenceNo: string | null
  status: string
  paymentDate: string | null
  balanceBefore: string | null
  balanceAfter: string | null
  notes: string | null
  createdAt: string
}

interface StatementEntry extends DealerPayment {
  runningBalance: string
}

interface Statement {
  dealer: {
    id: string
    name: string
    code: string
    currentBalance: string | null
    creditLimit: string | null
  }
  openingBalance: string
  closingBalance: string
  entries: StatementEntry[]
  meta: {
    totalEntries: number
    startDate: string | null
    endDate: string | null
  }
}

interface VehicleDocument {
  id: string
  documentType: string
  name: string
  description: string | null
  fileUrl: string | null
  documentNo: string | null
  status: string
  isExpired: boolean
  issueDate: string | null
  expiryDate: string | null
  createdAt: string
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  suspended: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  inactive: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

const typeLabels: Record<string, string> = {
  authorized: 'Authorized Dealer',
  sub_dealer: 'Sub Dealer',
  agent: 'Agent',
  franchise: 'Franchise',
}

const paymentStatusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export default function DealerDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenantSlug } = useCompany()

  const [dealer, setDealer] = useState<Dealer | null>(null)
  const [allocations, setAllocations] = useState<DealerAllocation[]>([])
  const [payments, setPayments] = useState<DealerPayment[]>([])
  const [statement, setStatement] = useState<Statement | null>(null)
  const [documents, setDocuments] = useState<VehicleDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'payments', label: 'Payments' },
    { id: 'statement', label: 'Statement' },
    { id: 'documents', label: 'Documents' },
  ]

  const isNew = id === 'new'

  const fetchDealer = useCallback(async () => {
    if (isNew) return
    try {
      const res = await fetch(`/api/dealers/${id}`)
      if (res.ok) {
        const d = await res.json()
        setDealer(d)
      } else {
        toast.error('Dealer not found')
        router.push(`/c/${tenantSlug}/dealership/dealers`)
      }
    } catch (error) {
      console.error('Failed to fetch dealer:', error)
      toast.error('Error loading dealer')
    } finally {
      setLoading(false)
    }
  }, [id, isNew, router, tenantSlug])

  const fetchAllocations = useCallback(async () => {
    if (isNew) return
    try {
      const res = await fetch(`/api/dealer-allocations?dealerId=${id}&all=true`)
      if (res.ok) {
        const d = await res.json()
        setAllocations(Array.isArray(d) ? d : d.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch allocations:', error)
    }
  }, [id, isNew])

  const fetchPayments = useCallback(async () => {
    if (isNew) return
    try {
      const res = await fetch(`/api/dealer-payments?dealerId=${id}&all=true`)
      if (res.ok) {
        const d = await res.json()
        setPayments(Array.isArray(d) ? d : d.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch payments:', error)
    }
  }, [id, isNew])

  const fetchStatement = useCallback(async () => {
    if (isNew) return
    try {
      const res = await fetch(`/api/dealers/${id}/statement`)
      if (res.ok) {
        const d = await res.json()
        setStatement(d)
      }
    } catch (error) {
      console.error('Failed to fetch statement:', error)
    }
  }, [id, isNew])

  const fetchDocuments = useCallback(async () => {
    if (isNew) return
    try {
      const res = await fetch(`/api/vehicle-documents?dealerId=${id}&all=true`)
      if (res.ok) {
        const d = await res.json()
        setDocuments(Array.isArray(d) ? d : d.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error)
    }
  }, [id, isNew])

  useRealtimeData(fetchDealer, { entityType: 'dealer', enabled: !isNew })
  useRealtimeData(fetchAllocations, { entityType: 'dealer-allocation', enabled: !isNew })
  useRealtimeData(fetchPayments, { entityType: 'dealer-payment', enabled: !isNew })
  useRealtimeData(fetchStatement, { entityType: 'dealer-payment', enabled: !isNew })
  useRealtimeData(fetchDocuments, { entityType: 'vehicle-document', enabled: !isNew })

  if (loading) {
    return <PageLoading text="Loading dealer details..." />
  }

  if (!dealer) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500 dark:text-gray-400">Dealer not found</p>
      </div>
    )
  }

  const balance = parseFloat(dealer.currentBalance || '0')
  const creditLimit = parseFloat(dealer.creditLimit || '0')

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/dealership/dealers`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Dealers
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">{dealer.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/c/${tenantSlug}/dealership/dealers`)}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{dealer.name}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[dealer.status || 'active'] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                {dealer.status ? dealer.status.charAt(0).toUpperCase() + dealer.status.slice(1) : 'Active'}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {dealer.code}
              {dealer.type ? ` | ${typeLabels[dealer.type] || dealer.type}` : ''}
              {dealer.territory ? ` | ${dealer.territory}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/c/${tenantSlug}/dealership/dealers`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Pencil size={16} />
            Edit
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-4 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab dealer={dealer} balance={balance} creditLimit={creditLimit} />}
      {activeTab === 'inventory' && <InventoryTab allocations={allocations} tenantSlug={tenantSlug} />}
      {activeTab === 'payments' && <PaymentsTab payments={payments} />}
      {activeTab === 'statement' && <StatementTab statement={statement} />}
      {activeTab === 'documents' && <DocumentsTab documents={documents} dealerId={id} />}

      <DocumentCommentsAndActivity
        documentType="dealer"
        documentId={id}
        entityType="dealer"
      />
    </div>
  )
}

// --- Overview Tab ---
function OverviewTab({ dealer, balance, creditLimit }: { dealer: Dealer; balance: number; creditLimit: number }) {
  const commissionRate = parseFloat(dealer.commissionRate || '0')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left Column */}
      <div className="space-y-6">
        {/* Dealer Info */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Building2 size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Dealer Information</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Name" value={dealer.name} />
              <InfoField label="Code" value={dealer.code} mono />
              <InfoField label="Type" value={dealer.type ? typeLabels[dealer.type] || dealer.type : null} />
              <InfoField label="Territory" value={dealer.territory} icon={<MapPin size={14} />} />
              <InfoField label="Payment Terms" value={dealer.paymentTermDays ? `${dealer.paymentTermDays} days` : null} />
              <InfoField label="Active" value={dealer.isActive ? 'Yes' : 'No'} />
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Users size={18} className="text-purple-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Contact Details</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Contact Person" value={dealer.contactPerson} />
              <InfoField label="Email" value={dealer.email} icon={<Mail size={14} />} />
              <InfoField label="Phone" value={dealer.phone} icon={<Phone size={14} />} />
            </div>
            {dealer.address && (
              <>
                <hr className="border-gray-200 dark:border-gray-700 my-3" />
                <div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <MapPin size={14} />
                    Address
                  </span>
                  <p className="mt-0.5 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{dealer.address}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Contract */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Shield size={18} className="text-orange-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Contract</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Contract Start" value={dealer.contractStartDate} icon={<Calendar size={14} />} />
              <InfoField label="Contract End" value={dealer.contractEndDate} icon={<Calendar size={14} />} />
            </div>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="space-y-6">
        {/* Financial Summary */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <DollarSign size={18} className="text-green-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Financial Summary</h2>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-3">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Commission Rate</div>
                <div className="text-lg font-bold text-blue-600 dark:text-blue-400 mt-1">
                  {commissionRate > 0 ? `${commissionRate}%` : '-'}
                </div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded p-3">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Credit Limit</div>
                <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mt-1">
                  {creditLimit > 0 ? creditLimit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                </div>
              </div>
            </div>
            <div className={`rounded p-4 border ${
              balance > 0
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : balance < 0
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            }`}>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Current Balance</div>
              <div className={`text-2xl font-bold mt-1 ${
                balance > 0
                  ? 'text-red-600 dark:text-red-400'
                  : balance < 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-900 dark:text-white'
              }`}>
                {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              {balance > 0 && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1">Outstanding amount owed</p>
              )}
              {balance < 0 && (
                <p className="text-xs text-green-500 dark:text-green-400 mt-1">Credit / overpayment</p>
              )}
            </div>
            {creditLimit > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>Credit Used</span>
                  <span>{balance > 0 ? ((balance / creditLimit) * 100).toFixed(1) : '0'}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      balance / creditLimit > 0.9 ? 'bg-red-500' : balance / creditLimit > 0.7 ? 'bg-yellow-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min((balance > 0 ? balance : 0) / creditLimit * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {dealer.notes && (
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Notes</h2>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{dealer.notes}</p>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Clock size={18} className="text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Record Info</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Created" value={new Date(dealer.createdAt).toLocaleString()} />
              <InfoField label="Last Updated" value={new Date(dealer.updatedAt).toLocaleString()} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Inventory Tab ---
function InventoryTab({ allocations, tenantSlug }: { allocations: DealerAllocation[]; tenantSlug: string }) {
  const allocationStatusColors: Record<string, string> = {
    allocated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    sold: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    returned: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  }

  if (allocations.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
        <CreditCard size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No vehicles allocated to this dealer</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
      <table className="w-full">
        <thead className="table-sticky-header">
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Vehicle</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Stock No</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Asking Price</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {allocations.map((alloc) => {
            const vehicle = alloc.vehicleInventory
            const askingPrice = parseFloat(alloc.askingPrice || '0')

            return (
              <tr key={alloc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3">
                  {vehicle ? (
                    <Link
                      href={`/c/${tenantSlug}/dealership/inventory/${vehicle.id}`}
                      className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-500 dark:text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 font-mono">
                  {vehicle?.stockNo || '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${allocationStatusColors[alloc.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                    {alloc.status.charAt(0).toUpperCase() + alloc.status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white font-medium">
                  {askingPrice > 0 ? askingPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {new Date(alloc.createdAt).toLocaleDateString()}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- Payments Tab ---
function PaymentsTab({ payments }: { payments: DealerPayment[] }) {
  if (payments.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
        <CreditCard size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No payment history for this dealer</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
      <table className="w-full">
        <thead className="table-sticky-header">
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Payment No</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Direction</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Method</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {payments.map((payment) => {
            const amount = parseFloat(payment.amount || '0')

            return (
              <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">{payment.paymentNo}</td>
                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 capitalize">{payment.type.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    payment.direction === 'inbound'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {payment.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                  {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 capitalize">
                  {payment.paymentMethod?.replace(/_/g, ' ') || '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusColors[payment.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                    {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {payment.paymentDate || new Date(payment.createdAt).toLocaleDateString()}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- Statement Tab ---
function StatementTab({ statement }: { statement: Statement | null }) {
  if (!statement) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
        <FileText size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading statement...</p>
      </div>
    )
  }

  const openingBalance = parseFloat(statement.openingBalance || '0')
  const closingBalance = parseFloat(statement.closingBalance || '0')

  return (
    <div className="space-y-4">
      {/* Balance Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Opening Balance</div>
          <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">
            {openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className={`rounded border p-4 ${
          closingBalance > 0
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
        }`}>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Closing Balance</div>
          <div className={`text-xl font-bold mt-1 ${
            closingBalance > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
          }`}>
            {closingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Statement entries */}
      {statement.entries.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">No transactions found</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <table className="w-full">
            <thead className="table-sticky-header">
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Payment No</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Debit</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Credit</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {statement.entries.map((entry) => {
                const amount = parseFloat(entry.amount || '0')
                const runBal = parseFloat(entry.runningBalance || '0')
                const isDebit = entry.direction === 'outbound'

                return (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {entry.paymentDate || new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">{entry.paymentNo}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 capitalize">
                      {entry.type.replace(/_/g, ' ')} ({entry.direction})
                      {entry.notes && <span className="text-gray-400 dark:text-gray-500"> - {entry.notes}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-red-600 dark:text-red-400">
                      {isDebit ? amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-green-600 dark:text-green-400">
                      {!isDebit ? amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-bold ${
                      runBal > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                    }`}>
                      {runBal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// --- Documents Tab ---
function DocumentsTab({ documents, dealerId }: { documents: VehicleDocument[]; dealerId: string }) {
  const [uploading, setUploading] = useState(false)

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const uploadFiles = e.target.files
    if (!uploadFiles?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(uploadFiles)) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('attachedToType', 'dealer')
        formData.append('attachedToId', dealerId)
        const res = await fetch('/api/files', {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error || `Failed to upload ${file.name}`)
        }
      }
      toast.success('Document uploaded successfully')
    } catch (error) {
      console.error('Error uploading document:', error)
      toast.error('Failed to upload document')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {documents.length} document{documents.length !== 1 ? 's' : ''} attached
        </h3>
        <label
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input type="file" multiple className="hidden" onChange={handleDocumentUpload} disabled={uploading} />
          <Upload size={16} />
          {uploading ? 'Uploading...' : 'Upload Document'}
        </label>
      </div>

      {documents.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
          <FileText size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No documents linked to this dealer</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Upload contracts, licenses, and other dealer-related documents
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <table className="w-full">
            <thead className="table-sticky-header">
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Document</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Doc No</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{doc.name}</p>
                        {doc.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{doc.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 capitalize">
                    {doc.documentType.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 font-mono">
                    {doc.documentNo || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      doc.isExpired
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : doc.status === 'valid'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      {doc.isExpired ? 'Expired' : doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {doc.expiryDate || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// --- Shared Components ---
function InfoField({
  label,
  value,
  mono,
  icon,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
        {icon}
        {label}
      </span>
      <p className={`mt-0.5 text-sm text-gray-900 dark:text-white ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-gray-400 dark:text-gray-500">-</span>}
      </p>
    </div>
  )
}

'use client'

import { useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home, ChevronRight, ArrowLeft, Trash2, Ship,
  FileText, DollarSign, Clock, Upload, Calendar,
  MapPin, Hash, FileCheck, AlertCircle
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { PageLoading } from '@/components/ui/loading-spinner'
import { toast } from '@/components/ui/toast'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

interface VehicleImport {
  id: string
  importNo: string
  vehicleInventoryId: string | null
  supplierId: string | null
  purchaseOrderId: string | null
  fobValue: string | null
  freightCost: string | null
  insuranceCost: string | null
  cifValue: string | null
  cifCurrency: string | null
  exchangeRate: string | null
  cifValueLkr: string | null
  customsImportDuty: string | null
  customsImportDutyRate: string | null
  surcharge: string | null
  surchargeRate: string | null
  exciseDuty: string | null
  exciseDutyRate: string | null
  luxuryTax: string | null
  luxuryTaxRate: string | null
  vatAmount: string | null
  vatRate: string | null
  palCharge: string | null
  cessFee: string | null
  totalTaxes: string | null
  totalLandedCost: string | null
  hsCode: string | null
  engineCapacityCc: number | null
  enginePowerKw: string | null
  importCountry: string | null
  yearOfManufacture: number | null
  billOfLadingNo: string | null
  lcNo: string | null
  customsDeclarationNo: string | null
  portOfEntry: string | null
  arrivalDate: string | null
  clearanceDate: string | null
  registrationNo: string | null
  status: string
  notes: string | null
  additionalCosts: string | null
  additionalCostsBreakdown: unknown[]
  documents: unknown[]
  createdAt: string
  updatedAt: string | null
}

interface VehicleDocument {
  id: string
  documentType: string
  name: string
  description: string | null
  fileUrl: string | null
  fileType: string | null
  fileSize: number | null
  issueDate: string | null
  expiryDate: string | null
  isExpired: boolean
  documentNo: string | null
  status: string
  createdAt: string
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  in_transit: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  at_port: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  customs_clearing: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  cleared: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  registered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_transit: 'In Transit',
  at_port: 'At Port',
  customs_clearing: 'Customs Clearing',
  cleared: 'Cleared',
  registered: 'Registered',
}

export default function ImportDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenantSlug } = useCompany()

  const [data, setData] = useState<VehicleImport | null>(null)
  const [documents, setDocuments] = useState<VehicleDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'documents', label: 'Documents' },
    { id: 'timeline', label: 'Timeline' },
  ]

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/vehicle-imports/${id}`)
      if (res.ok) {
        const d = await res.json()
        setData(d)
      } else {
        toast.error('Import record not found')
        router.push(`/c/${tenantSlug}/dealership/imports`)
      }
    } catch (error) {
      console.error('Failed to fetch import:', error)
      toast.error('Error loading import record')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/vehicle-documents?vehicleImportId=${id}&all=true`)
      if (res.ok) {
        const d = await res.json()
        setDocuments(Array.isArray(d) ? d : d.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error)
    }
  }, [id])

  useRealtimeData(fetchData, { entityType: 'vehicle-import' })
  useRealtimeData(fetchDocuments, { entityType: 'vehicle-document' })

  async function handleDelete() {
    const res = await fetch(`/api/vehicle-imports/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Import record deleted')
      router.push(`/c/${tenantSlug}/dealership/imports`)
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to delete import')
    }
  }

  if (loading) {
    return <PageLoading text="Loading import details..." />
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500 dark:text-gray-400">Import record not found</p>
      </div>
    )
  }

  const fob = parseFloat(data.fobValue || '0')
  const freight = parseFloat(data.freightCost || '0')
  const insurance = parseFloat(data.insuranceCost || '0')
  const cif = parseFloat(data.cifValue || '0')
  const cifLkr = parseFloat(data.cifValueLkr || '0')
  const totalTaxes = parseFloat(data.totalTaxes || '0')
  const totalLandedCost = parseFloat(data.totalLandedCost || '0')
  const canDelete = data.status !== 'cleared' && data.status !== 'registered'

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/dealership/imports`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Vehicle Imports
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">{data.importNo}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/c/${tenantSlug}/dealership/imports`)}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{data.importNo}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[data.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                {statusLabels[data.status] || data.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {data.importCountry ? `From ${data.importCountry}` : 'Vehicle Import Record'}
              {data.portOfEntry ? ` via ${data.portOfEntry}` : ''}
            </p>
          </div>
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
      {activeTab === 'overview' && <OverviewTab data={data} fob={fob} freight={freight} insurance={insurance} cif={cif} cifLkr={cifLkr} totalTaxes={totalTaxes} totalLandedCost={totalLandedCost} />}
      {activeTab === 'documents' && <DocumentsTab documents={documents} importId={id} tenantSlug={tenantSlug} />}
      {activeTab === 'timeline' && <TimelineTab data={data} />}

      <DocumentCommentsAndActivity
        documentType="vehicle_import"
        documentId={id}
        entityType="vehicle-import"
      />

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        if (canDelete) {
          a.push({
            key: 'delete',
            label: 'Delete',
            icon: <Trash2 size={14} />,
            variant: 'danger',
            position: 'left',
            onClick: handleDelete,
            confirmation: {
              title: 'Delete Import Record',
              message: `Are you sure you want to delete import ${data.importNo}? This action cannot be undone.`,
              variant: 'danger',
              confirmText: 'Delete',
            },
          })
        }
        return a
      })()} />
    </div>
  )
}

// --- Overview Tab ---
function OverviewTab({
  data,
  fob,
  freight,
  insurance,
  cif,
  cifLkr,
  totalTaxes,
  totalLandedCost,
}: {
  data: VehicleImport
  fob: number
  freight: number
  insurance: number
  cif: number
  cifLkr: number
  totalTaxes: number
  totalLandedCost: number
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left Column */}
      <div className="space-y-6">
        {/* CIF Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <DollarSign size={18} className="text-green-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">CIF Breakdown</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <ValueCard label="FOB Value" value={fob} currency={data.cifCurrency || 'USD'} />
              <ValueCard label="Freight" value={freight} currency={data.cifCurrency || 'USD'} />
              <ValueCard label="Insurance" value={insurance} currency={data.cifCurrency || 'USD'} />
            </div>
            <hr className="border-gray-200 dark:border-gray-700" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-400">CIF Value ({data.cifCurrency || 'USD'})</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {cif.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Exchange Rate
              </span>
              <span className="text-sm text-gray-700 dark:text-gray-300">
                1 {data.cifCurrency || 'USD'} = LKR {parseFloat(data.exchangeRate || '0').toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">CIF Value (LKR)</span>
                <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                  LKR {cifLkr.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tracking Info */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Ship size={18} className="text-purple-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Tracking Information</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Bill of Lading No" value={data.billOfLadingNo} icon={<Hash size={14} />} mono />
              <InfoField label="LC No" value={data.lcNo} icon={<FileCheck size={14} />} mono />
              <InfoField label="Customs Declaration No" value={data.customsDeclarationNo} icon={<FileText size={14} />} mono />
              <InfoField label="Port of Entry" value={data.portOfEntry} icon={<MapPin size={14} />} />
              <InfoField label="Import Country" value={data.importCountry} />
              <InfoField label="Registration No" value={data.registrationNo} mono />
              <InfoField label="Arrival Date" value={data.arrivalDate} icon={<Calendar size={14} />} />
              <InfoField label="Clearance Date" value={data.clearanceDate} icon={<Calendar size={14} />} />
            </div>
          </div>
        </div>

        {/* Vehicle Specs */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <FileText size={18} className="text-gray-600 dark:text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Vehicle Specifications</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Year of Manufacture" value={data.yearOfManufacture?.toString()} />
              <InfoField label="Engine Capacity" value={data.engineCapacityCc ? `${data.engineCapacityCc} cc` : null} />
              <InfoField label="Engine Power" value={data.enginePowerKw ? `${data.enginePowerKw} kW` : null} />
              <InfoField label="HS Code" value={data.hsCode} mono />
            </div>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="space-y-6">
        {/* Tax Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <FileText size={18} className="text-orange-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Tax Breakdown</h2>
          </div>
          <div className="p-4">
            {totalTaxes > 0 ? (
              <div className="space-y-3">
                <TaxRow
                  label="Customs Import Duty (CID)"
                  rate={data.customsImportDutyRate}
                  amount={data.customsImportDuty}
                />
                <TaxRow
                  label="Surcharge"
                  rate={data.surchargeRate}
                  amount={data.surcharge}
                  rateNote="of CID"
                />
                <TaxRow
                  label="Excise Duty"
                  rate={data.exciseDutyRate}
                  amount={data.exciseDuty}
                />
                <TaxRow
                  label="Luxury Tax"
                  rate={data.luxuryTaxRate}
                  amount={data.luxuryTax}
                />
                <TaxRow
                  label="PAL (Port Authority Levy)"
                  rate={null}
                  amount={data.palCharge}
                />
                <TaxRow
                  label="CESS"
                  rate={null}
                  amount={data.cessFee}
                />
                <TaxRow
                  label="VAT"
                  rate={data.vatRate}
                  amount={data.vatAmount}
                />

                <hr className="border-gray-200 dark:border-gray-700" />
                <div className="flex justify-between items-center font-semibold text-sm">
                  <span className="text-gray-700 dark:text-gray-300">Total Taxes</span>
                  <span className="text-red-600 dark:text-red-400">
                    LKR {totalTaxes.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <AlertCircle size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Taxes have not been calculated yet
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Total Landed Cost */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded border border-green-200 dark:border-green-800 p-6">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Total Landed Cost</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-2">
              LKR {totalLandedCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            {cifLkr > 0 && totalTaxes > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                CIF LKR {cifLkr.toLocaleString()} + Taxes LKR {totalTaxes.toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {/* Notes */}
        {data.notes && (
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Notes</h2>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{data.notes}</p>
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
              <InfoField label="Created" value={data.createdAt ? new Date(data.createdAt).toLocaleString() : null} />
              <InfoField label="Last Updated" value={data.updatedAt ? new Date(data.updatedAt).toLocaleString() : null} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Documents Tab ---
function DocumentsTab({ documents, importId, tenantSlug: _tenantSlug }: { documents: VehicleDocument[]; importId: string; tenantSlug: string }) {
  const [uploading, setUploading] = useState(false)

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const uploadFiles = e.target.files
    if (!uploadFiles?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(uploadFiles)) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('attachedToType', 'vehicle_import')
        formData.append('attachedToId', importId)
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
          <p className="text-sm text-gray-500 dark:text-gray-400">No documents attached to this import record</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Upload bills of lading, customs declarations, invoices, and other related documents
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
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
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                      {doc.documentType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                      {doc.documentNo || '-'}
                    </span>
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
                    {doc.issueDate || new Date(doc.createdAt).toLocaleDateString()}
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

// --- Timeline Tab ---
function TimelineTab({ data }: { data: VehicleImport }) {
  const steps = [
    { status: 'pending', label: 'Pending', description: 'Import record created' },
    { status: 'in_transit', label: 'In Transit', description: 'Vehicle is being shipped' },
    { status: 'at_port', label: 'At Port', description: 'Vehicle arrived at port' },
    { status: 'customs_clearing', label: 'Customs Clearing', description: 'Undergoing customs clearance' },
    { status: 'cleared', label: 'Cleared', description: 'Customs clearance completed' },
    { status: 'registered', label: 'Registered', description: 'Vehicle registration completed' },
  ]

  const currentIndex = steps.findIndex(s => s.status === data.status)

  return (
    <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-6">
      <div className="space-y-0">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex
          const isCurrent = index === currentIndex
          const isFuture = index > currentIndex

          return (
            <div key={step.status} className="flex gap-4">
              {/* Timeline line & dot */}
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  isCompleted
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : isCurrent
                      ? 'bg-blue-100 dark:bg-blue-900/30 ring-2 ring-blue-500'
                      : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  {isCompleted ? (
                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      isCurrent ? 'bg-blue-600 dark:bg-blue-400' : 'bg-gray-300 dark:bg-gray-500'
                    }`} />
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-0.5 h-12 ${
                    isCompleted ? 'bg-green-300 dark:bg-green-700' : 'bg-gray-200 dark:bg-gray-600'
                  }`} />
                )}
              </div>
              {/* Content */}
              <div className="pb-8">
                <p className={`text-sm font-medium ${
                  isFuture ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'
                }`}>
                  {step.label}
                </p>
                <p className={`text-xs mt-0.5 ${
                  isFuture ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {step.description}
                </p>
                {isCurrent && (
                  <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    Current Status
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
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

function ValueCard({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded p-3">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold text-gray-900 dark:text-white mt-1">
        {value > 0
          ? `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
          : '-'
        }
      </div>
    </div>
  )
}

function TaxRow({ label, rate, amount, rateNote }: { label: string; rate: string | null; amount: string | null; rateNote?: string }) {
  const amountNum = parseFloat(amount || '0')
  const rateNum = rate ? parseFloat(rate) : null

  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-600 dark:text-gray-400">
        {label}
        {rateNum !== null && (
          <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
            ({rateNum}%{rateNote ? ` ${rateNote}` : ''})
          </span>
        )}
      </span>
      <span className="text-gray-900 dark:text-white font-medium">
        LKR {amountNum.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </span>
    </div>
  )
}

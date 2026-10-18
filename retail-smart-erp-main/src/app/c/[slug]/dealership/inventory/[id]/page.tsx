'use client'

import { useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home, ChevronRight, Pencil, Trash2, Car, DollarSign,
  Fuel, Settings2, ArrowLeft, Image as ImageIcon
} from 'lucide-react'
import { VehicleInventoryFormModal } from '@/components/modals/VehicleInventoryFormModal'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

interface VehicleDetail {
  id: string
  stockNo: string
  vin: string | null
  make: string
  model: string
  year: number | null
  trim: string | null
  exteriorColor: string | null
  interiorColor: string | null
  mileage: number | null
  condition: string
  bodyType: string | null
  engine: string | null
  transmission: string | null
  fuelType: string | null
  drivetrain: string | null
  purchasePrice: string | null
  askingPrice: string | null
  minimumPrice: string | null
  status: string
  location: string | null
  description: string | null
  features: string[] | null
  photos: string[] | null
  createdAt: string
  updatedAt: string | null
}

const statusColors: Record<string, string> = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  reserved: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  sold: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  in_transit: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  in_preparation: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
}

const statusLabels: Record<string, string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  in_transit: 'In Transit',
  in_preparation: 'In Preparation',
}

export default function VehicleDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenantSlug } = useCompany()

  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)

  const fetchVehicle = useCallback(async () => {
    try {
      const res = await fetch(`/api/vehicle-inventory/${id}`)
      if (res.ok) {
        const data = await res.json()
        setVehicle(data)
      } else {
        toast.error('Vehicle not found')
        router.push(`/c/${tenantSlug}/dealership/inventory`)
      }
    } catch (error) {
      console.error('Error fetching vehicle:', error)
      toast.error('Error loading vehicle')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  useRealtimeData(fetchVehicle, { entityType: 'vehicle-inventory' })

  async function handleDelete() {
    const res = await fetch(`/api/vehicle-inventory/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Vehicle deleted successfully')
      router.push(`/c/${tenantSlug}/dealership/inventory`)
    } else {
      toast.error('Failed to delete vehicle')
    }
  }

  if (loading) {
    return <PageLoading text="Loading vehicle details..." />
  }

  if (!vehicle) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500 dark:text-gray-400">Vehicle not found</p>
      </div>
    )
  }

  const purchasePrice = vehicle.purchasePrice ? parseFloat(vehicle.purchasePrice) : 0
  const askingPrice = vehicle.askingPrice ? parseFloat(vehicle.askingPrice) : 0
  const minimumPrice = vehicle.minimumPrice ? parseFloat(vehicle.minimumPrice) : 0
  const margin = askingPrice > 0 && purchasePrice > 0 ? ((askingPrice - purchasePrice) / purchasePrice * 100).toFixed(1) : null

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/dealership/inventory`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Vehicle Inventory
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">{vehicle.stockNo}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/c/${tenantSlug}/dealership/inventory`)}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[vehicle.status] || 'bg-gray-100 text-gray-700'}`}>
                {statusLabels[vehicle.status] || vehicle.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Stock # {vehicle.stockNo}
              {vehicle.trim ? ` | ${vehicle.trim}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left - Vehicle Info */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Car size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Vehicle Information</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Make" value={vehicle.make} />
              <InfoField label="Model" value={vehicle.model} />
              <InfoField label="Year" value={vehicle.year?.toString()} />
              <InfoField label="Trim" value={vehicle.trim} />
              <InfoField label="VIN" value={vehicle.vin} mono />
              <InfoField label="Condition" value={vehicle.condition} capitalize />
              <InfoField label="Exterior Color" value={vehicle.exteriorColor} />
              <InfoField label="Interior Color" value={vehicle.interiorColor} />
              <InfoField label="Body Type" value={vehicle.bodyType} capitalize />
              <InfoField label="Mileage" value={vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : null} />
            </div>
            <hr className="border-gray-200 dark:border-gray-700" />
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Engine" value={vehicle.engine} icon={<Settings2 size={14} />} />
              <InfoField label="Transmission" value={vehicle.transmission} />
              <InfoField label="Fuel Type" value={vehicle.fuelType} icon={<Fuel size={14} />} capitalize />
              <InfoField label="Drivetrain" value={vehicle.drivetrain} capitalize />
            </div>
            {vehicle.location && (
              <>
                <hr className="border-gray-200 dark:border-gray-700" />
                <InfoField label="Location" value={vehicle.location} />
              </>
            )}
            {vehicle.description && (
              <>
                <hr className="border-gray-200 dark:border-gray-700" />
                <div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</span>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{vehicle.description}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right - Pricing */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <DollarSign size={18} className="text-green-600" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Pricing</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 dark:bg-gray-900 rounded p-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Purchase Price</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                    {purchasePrice > 0 ? purchasePrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded p-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Asking Price</div>
                  <div className="text-lg font-bold text-green-600 dark:text-green-400 mt-1">
                    {askingPrice > 0 ? askingPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Minimum Price</div>
                  <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400 mt-1">
                    {minimumPrice > 0 ? minimumPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Margin</div>
                  <div className={`text-lg font-bold mt-1 ${
                    margin && parseFloat(margin) > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {margin ? `${margin}%` : '-'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Features */}
          {vehicle.features && vehicle.features.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Features</h2>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {vehicle.features.map((feature, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Activity & Comments */}
          <DocumentCommentsAndActivity
            documentType="vehicle_inventory"
            documentId={id}
            entityType="vehicle-inventory"
          />
        </div>
      </div>

      {/* Photos Section */}
      {vehicle.photos && vehicle.photos.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <ImageIcon size={18} className="text-purple-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Photos</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {vehicle.photos.map((photo, idx) => (
                <div key={idx} className="relative aspect-video bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo}
                    alt={`${vehicle.make} ${vehicle.model} photo ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <VehicleInventoryFormModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSuccess={() => {
          fetchVehicle()
          setShowEditModal(false)
        }}
        editItem={vehicle}
      />

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        a.push({
          key: 'edit',
          label: 'Edit',
          icon: <Pencil size={14} />,
          variant: 'outline',
          onClick: () => setShowEditModal(true),
        })
        a.push({
          key: 'delete',
          label: 'Delete',
          icon: <Trash2 size={14} />,
          variant: 'danger',
          position: 'left',
          onClick: handleDelete,
          confirmation: {
            title: 'Delete Vehicle',
            message: `Are you sure you want to delete ${vehicle.year} ${vehicle.make} ${vehicle.model} (Stock # ${vehicle.stockNo})? This action cannot be undone.`,
            variant: 'danger',
            confirmText: 'Delete',
          },
        })
        return a
      })()} />
    </div>
  )
}

function InfoField({
  label,
  value,
  mono,
  capitalize,
  icon,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  capitalize?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
        {icon}
        {label}
      </span>
      <p className={`mt-0.5 text-sm text-gray-900 dark:text-white ${mono ? 'font-mono' : ''} ${capitalize ? 'capitalize' : ''}`}>
        {value || <span className="text-gray-400 dark:text-gray-500">-</span>}
      </p>
    </div>
  )
}

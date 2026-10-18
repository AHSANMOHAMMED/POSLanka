'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { VehicleTypeFormModal } from '@/components/modals'
import { toast } from '@/components/ui/toast'
import { Car, Plus, ChevronLeft, Edit2, Eye, EyeOff, Loader2, Image as ImageIcon, Upload, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { bodyTypeDisplayNames } from '@/lib/data/default-vehicle-types'

interface VehicleType {
  id: string
  name: string
  bodyType: string
  description: string | null
  wheelCount: number
  isSystemDefault: boolean
  isActive: boolean
  diagramViews: Array<{
    id: string
    viewName: string
    imageUrl: string | null
    imageWidth: number | null
    imageHeight: number | null
  }>
}

export default function VehicleTypesPage() {
  const { data: session } = useSession()
  const tenantSlug = session?.user?.tenantSlug || ''
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingType, setEditingType] = useState<VehicleType | null>(null)

  // Diagram management state
  const [diagramModalType, setDiagramModalType] = useState<VehicleType | null>(null)
  const [uploadingDiagram, setUploadingDiagram] = useState(false)
  const [deletingDiagram, setDeletingDiagram] = useState(false)

  // Confirm modal states
  const [showSeedConfirm, setShowSeedConfirm] = useState(false)
  const [showDeleteDiagramConfirm, setShowDeleteDiagramConfirm] = useState(false)

  const fetchVehicleTypes = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (showInactive) params.set('includeInactive', 'true')
      const res = await fetch(`/api/vehicle-types?${params}`)
      if (res.ok) {
        const data = await res.json()
        setVehicleTypes(data)
      } else {
        toast.error('Failed to load vehicle types')
      }
    } catch (err) {
      console.error('Error fetching vehicle types:', err)
      toast.error('Failed to load vehicle types')
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  // Real-time updates via WebSocket
  useRealtimeData(fetchVehicleTypes, { entityType: 'vehicle-type', refreshOnMount: false })

  useEffect(() => {
    fetchVehicleTypes()
  }, [fetchVehicleTypes])

  function handleSeedDefaults() {
    setShowSeedConfirm(true)
  }

  async function performSeedDefaults() {
    setShowSeedConfirm(false)
    setSeeding(true)
    try {
      const res = await fetch('/api/vehicle-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed-defaults' }),
      })

      if (res.ok) {
        toast.success('Default vehicle types created successfully')
        fetchVehicleTypes()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to seed defaults')
      }
    } catch {
      toast.error('Error seeding defaults')
    } finally {
      setSeeding(false)
    }
  }

  async function handleToggleActive(type: VehicleType) {
    try {
      const res = await fetch(`/api/vehicle-types/${type.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !type.isActive }),
      })

      if (res.ok) {
        toast.success(type.isActive ? 'Vehicle type deactivated' : 'Vehicle type activated')
        fetchVehicleTypes()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update')
      }
    } catch {
      toast.error('Error updating vehicle type')
    }
  }

  function handleEdit(type: VehicleType) {
    setEditingType(type)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingType(null)
  }

  async function handleDiagramUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!diagramModalType || !e.target.files?.length) return

    const file = e.target.files[0]

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Only PNG, JPG, and WebP images are allowed')
      e.target.value = ''
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be under 5MB')
      e.target.value = ''
      return
    }

    setUploadingDiagram(true)

    try {
      // Get image dimensions
      const img = document.createElement('img')
      const imageUrl = URL.createObjectURL(file)

      await new Promise<void>((resolve) => {
        img.onload = () => resolve()
        img.src = imageUrl
      })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('width', img.naturalWidth.toString())
      formData.append('height', img.naturalHeight.toString())

      URL.revokeObjectURL(imageUrl)

      const res = await fetch(`/api/vehicle-types/${diagramModalType.id}/diagram`, {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        toast.success('Diagram uploaded successfully')
        fetchVehicleTypes()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to upload diagram')
      }
    } catch {
      toast.error('Error uploading diagram')
    } finally {
      setUploadingDiagram(false)
      e.target.value = ''
    }
  }

  function handleDeleteDiagram() {
    if (!diagramModalType) return
    setShowDeleteDiagramConfirm(true)
  }

  async function performDeleteDiagram() {
    if (!diagramModalType) return

    setShowDeleteDiagramConfirm(false)
    setDeletingDiagram(true)

    try {
      const res = await fetch(`/api/vehicle-types/${diagramModalType.id}/diagram`, {
        method: 'DELETE',
      })

      if (res.ok) {
        toast.success('Diagram deleted')
        fetchVehicleTypes()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete diagram')
      }
    } catch {
      toast.error('Error deleting diagram')
    } finally {
      setDeletingDiagram(false)
    }
  }

  // Check if a vehicle type has a diagram
  function hasDiagram(type: VehicleType): boolean {
    return type.diagramViews.some(v => v.imageUrl != null)
  }

  // Get the diagram image URL for a vehicle type
  function getDiagramUrl(type: VehicleType): string | null {
    const view = type.diagramViews.find(v => v.imageUrl != null)
    return view?.imageUrl || null
  }

  const systemTypes = vehicleTypes.filter(t => t.isSystemDefault)
  const customTypes = vehicleTypes.filter(t => !t.isSystemDefault)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/c/${tenantSlug}/settings`} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
          <ChevronLeft size={20} className="dark:text-gray-300" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold dark:text-white">Vehicle Types</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage vehicle types for inspections</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded dark:border-gray-600"
            />
            Show inactive
          </label>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={16} />
            Add Custom Type
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {systemTypes.length === 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-6 mb-6">
              <h3 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">No system defaults found</h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-4">
                Seed the default vehicle types to get started with pre-configured inspection checklists.
                You can upload custom diagrams for each vehicle type after seeding.
              </p>
              <button
                onClick={handleSeedDefaults}
                disabled={seeding}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
              >
                {seeding ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Seeding...
                  </span>
                ) : (
                  'Seed Default Vehicle Types'
                )}
              </button>
            </div>
          )}

          {/* System Default Types */}
          {systemTypes.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4 dark:text-white">System Default Types</h2>
              <div className="grid gap-3">
                {systemTypes.map((type) => (
                  <div
                    key={type.id}
                    className={`bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md p-4 flex items-center gap-4 ${
                      !type.isActive ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center">
                      <Car size={24} className="text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium dark:text-white">{type.name}</span>
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded dark:text-gray-300">
                          {bodyTypeDisplayNames[type.bodyType] || type.bodyType}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{type.wheelCount} wheels</span>
                        {type.wheelCount >= 3 && (
                          hasDiagram(type) ? (
                            <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                              Diagram
                            </span>
                          ) : (
                            <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded">
                              No Diagram
                            </span>
                          )
                        )}
                        {type.wheelCount < 3 && (
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded">
                            Checklist Only
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {type.description || `Default ${type.name.toLowerCase()} type`}
                      </p>
                    </div>
                    {/* Diagram button - only for 3+ wheel vehicles */}
                    {type.wheelCount >= 3 && (
                      <button
                        onClick={() => setDiagramModalType(type)}
                        className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
                        title="Manage Diagram"
                      >
                        <ImageIcon size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggleActive(type)}
                      className={`p-2 rounded ${
                        type.isActive
                          ? 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                          : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/50'
                      }`}
                      title={type.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {type.isActive ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom Types */}
          <div>
            <h2 className="text-lg font-semibold mb-4 dark:text-white">Custom Types</h2>
            {customTypes.length === 0 ? (
              <div className="bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 border-dashed rounded-md p-8 text-center">
                <Car size={32} className="mx-auto mb-3 text-gray-400" />
                <p className="text-gray-500 dark:text-gray-400">No custom vehicle types yet</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  Create custom types for specialized vehicles
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {customTypes.map((type) => (
                  <div
                    key={type.id}
                    className={`bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md p-4 flex items-center gap-4 ${
                      !type.isActive ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900 rounded flex items-center justify-center">
                      <Car size={24} className="text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium dark:text-white">{type.name}</span>
                        <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                          Custom
                        </span>
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded dark:text-gray-300">
                          {bodyTypeDisplayNames[type.bodyType] || type.bodyType}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{type.wheelCount} wheels</span>
                        {type.wheelCount >= 3 && (
                          hasDiagram(type) ? (
                            <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                              Diagram
                            </span>
                          ) : (
                            <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded">
                              No Diagram
                            </span>
                          )
                        )}
                        {type.wheelCount < 3 && (
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded">
                            Checklist Only
                          </span>
                        )}
                      </div>
                      {type.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{type.description}</p>
                      )}
                    </div>
                    {/* Diagram button - only for 3+ wheel vehicles */}
                    {type.wheelCount >= 3 && (
                      <button
                        onClick={() => setDiagramModalType(type)}
                        className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
                        title="Manage Diagram"
                      >
                        <ImageIcon size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(type)}
                      className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      title="Edit"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleToggleActive(type)}
                      className={`p-2 rounded ${
                        type.isActive
                          ? 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                          : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/50'
                      }`}
                      title={type.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {type.isActive ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Vehicle Type Form Modal */}
      <VehicleTypeFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          fetchVehicleTypes()
          handleCloseModal()
        }}
        editType={editingType}
      />

      {/* Diagram Management Modal */}
      <Modal
        isOpen={!!diagramModalType}
        onClose={() => setDiagramModalType(null)}
        title={`Manage Diagram - ${diagramModalType?.name || ''}`}
        size="lg"
      >
        {diagramModalType && (
          <>
            {hasDiagram(diagramModalType) ? (
              <div className="space-y-4">
                <div className="border dark:border-gray-700 rounded p-4 bg-gray-50 dark:bg-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getDiagramUrl(diagramModalType) || ''}
                    alt={`${diagramModalType.name} diagram`}
                    className="max-w-full max-h-[300px] mx-auto object-contain"
                  />
                </div>
                <div className="flex gap-3">
                  <label className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-blue-600 text-blue-600 rounded cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/50">
                    <Upload size={18} />
                    Replace Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={handleDiagramUpload}
                      disabled={uploadingDiagram}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={handleDeleteDiagram}
                    disabled={deletingDiagram}
                    className="flex items-center gap-2 px-4 py-2 text-red-600 border border-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/50 disabled:opacity-50"
                  >
                    {deletingDiagram ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 size={18} />
                    )}
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border-2 border-dashed dark:border-gray-600 rounded p-8 text-center bg-gray-50 dark:bg-gray-800">
                  <ImageIcon size={48} className="mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-600 dark:text-gray-300 mb-2">
                    No diagram uploaded yet
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Upload a top-view diagram image for damage marking during inspections.
                    <br />
                    Recommended: PNG or JPG, max 5MB
                  </p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700">
                    {uploadingDiagram ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload size={18} />
                    )}
                    Upload Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={handleDiagramUpload}
                      disabled={uploadingDiagram}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="flex justify-end mt-6 pt-4 border-t dark:border-gray-700">
              <button
                onClick={() => setDiagramModalType(null)}
                className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300"
              >
                Close
              </button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmModal
        isOpen={showSeedConfirm}
        onClose={() => setShowSeedConfirm(false)}
        onConfirm={performSeedDefaults}
        title="Seed Default Vehicle Types"
        message="This will create all default vehicle types with their diagrams and inspection checklists. Continue?"
        confirmText="Create Defaults"
        variant="warning"
      />

      <ConfirmModal
        isOpen={showDeleteDiagramConfirm}
        onClose={() => setShowDeleteDiagramConfirm(false)}
        onConfirm={performDeleteDiagram}
        title="Delete Diagram"
        message="Are you sure you want to delete the diagram for this vehicle type?"
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { Car, Plus, Edit2, Eye, EyeOff, Loader2, Image as ImageIcon, Upload, Trash2 } from 'lucide-react'
import { bodyTypeDisplayNames } from '@/lib/data/default-vehicle-types'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

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
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingType, setEditingType] = useState<VehicleType | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    bodyType: 'sedan',
    description: '',
    wheelCount: 4,
  })
  const [submitting, setSubmitting] = useState(false)

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

  async function handleCreate() {
    if (!formData.name.trim()) {
      toast.error('Name is required')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/vehicle-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        toast.success('Vehicle type created')
        setShowCreateModal(false)
        setFormData({ name: '', bodyType: 'sedan', description: '', wheelCount: 4 })
        fetchVehicleTypes()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create')
      }
    } catch {
      toast.error('Error creating vehicle type')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdate() {
    if (!editingType) return
    if (!formData.name.trim()) {
      toast.error('Name is required')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/vehicle-types/${editingType.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        toast.success('Vehicle type updated')
        setEditingType(null)
        fetchVehicleTypes()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update')
      }
    } catch {
      toast.error('Error updating vehicle type')
    } finally {
      setSubmitting(false)
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

  function openEditModal(type: VehicleType) {
    setFormData({
      name: type.name,
      bodyType: type.bodyType,
      description: type.description || '',
      wheelCount: type.wheelCount,
    })
    setEditingType(type)
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
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Vehicle Type"
      actionContent={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
          <button
            onClick={() => {
              setFormData({ name: '', bodyType: 'sedan', description: '', wheelCount: 4 })
              setShowCreateModal(true)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Custom Type
          </button>
        </div>
      }
      onRefresh={fetchVehicleTypes}
    >
      <div className="p-4 overflow-y-auto flex-1">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {systemTypes.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-6 mb-6">
              <h3 className="font-medium text-yellow-800 mb-2">No system defaults found</h3>
              <p className="text-sm text-yellow-700 mb-4">
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
              <h2 className="text-lg font-semibold mb-4">System Default Types</h2>
              <div className="grid gap-3">
                {systemTypes.map((type) => (
                  <div
                    key={type.id}
                    className={`bg-white border rounded-md p-4 flex items-center gap-4 ${
                      !type.isActive ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center">
                      <Car size={24} className="text-gray-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{type.name}</span>
                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                          {bodyTypeDisplayNames[type.bodyType] || type.bodyType}
                        </span>
                        <span className="text-xs text-gray-500">{type.wheelCount} wheels</span>
                        {type.wheelCount >= 3 && (
                          hasDiagram(type) ? (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                              Diagram
                            </span>
                          ) : (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">
                              No Diagram
                            </span>
                          )
                        )}
                        {type.wheelCount < 3 && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                            Checklist Only
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {type.description || `Default ${type.name.toLowerCase()} type`}
                      </p>
                    </div>
                    {/* Diagram button - only for 3+ wheel vehicles */}
                    {type.wheelCount >= 3 && (
                      <button
                        onClick={() => setDiagramModalType(type)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                        title="Manage Diagram"
                      >
                        <ImageIcon size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggleActive(type)}
                      className={`p-2 rounded ${
                        type.isActive
                          ? 'text-gray-500 hover:bg-gray-100'
                          : 'text-green-600 hover:bg-green-50'
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
            <h2 className="text-lg font-semibold mb-4">Custom Types</h2>
            {customTypes.length === 0 ? (
              <div className="bg-gray-50 border border-dashed rounded-md p-8 text-center">
                <Car size={32} className="mx-auto mb-3 text-gray-400" />
                <p className="text-gray-500">No custom vehicle types yet</p>
                <p className="text-sm text-gray-400 mt-1">
                  Create custom types for specialized vehicles
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {customTypes.map((type) => (
                  <div
                    key={type.id}
                    className={`bg-white border rounded-md p-4 flex items-center gap-4 ${
                      !type.isActive ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="w-12 h-12 bg-blue-50 rounded flex items-center justify-center">
                      <Car size={24} className="text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{type.name}</span>
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          Custom
                        </span>
                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                          {bodyTypeDisplayNames[type.bodyType] || type.bodyType}
                        </span>
                        <span className="text-xs text-gray-500">{type.wheelCount} wheels</span>
                        {type.wheelCount >= 3 && (
                          hasDiagram(type) ? (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                              Diagram
                            </span>
                          ) : (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">
                              No Diagram
                            </span>
                          )
                        )}
                        {type.wheelCount < 3 && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                            Checklist Only
                          </span>
                        )}
                      </div>
                      {type.description && (
                        <p className="text-sm text-gray-500">{type.description}</p>
                      )}
                    </div>
                    {/* Diagram button - only for 3+ wheel vehicles */}
                    {type.wheelCount >= 3 && (
                      <button
                        onClick={() => setDiagramModalType(type)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                        title="Manage Diagram"
                      >
                        <ImageIcon size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => openEditModal(type)}
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleToggleActive(type)}
                      className={`p-2 rounded ${
                        type.isActive
                          ? 'text-gray-500 hover:bg-gray-100'
                          : 'text-green-600 hover:bg-green-50'
                      }`}
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

      {/* Create/Edit Modal */}
      {(showCreateModal || editingType) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-md shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-xl font-bold mb-4">
              {editingType ? 'Edit Vehicle Type' : 'Create Vehicle Type'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Electric Scooter"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Body Type</label>
                <select
                  value={formData.bodyType}
                  onChange={(e) => setFormData({ ...formData, bodyType: e.target.value })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  disabled={!!editingType}
                >
                  {Object.entries(bodyTypeDisplayNames).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Wheel Count</label>
                <input
                  type="number"
                  value={formData.wheelCount}
                  onChange={(e) => setFormData({ ...formData, wheelCount: parseInt(e.target.value) || 4 })}
                  className="w-24 px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  min={1}
                  max={20}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Optional description"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setEditingType(null)
                }}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={editingType ? handleUpdate : handleCreate}
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {editingType ? 'Updating...' : 'Creating...'}
                  </span>
                ) : (
                  editingType ? 'Update' : 'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagram Management Modal */}
      {diagramModalType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-md shadow-xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-xl font-bold mb-4">
              Manage Diagram - {diagramModalType.name}
            </h2>

            {hasDiagram(diagramModalType) ? (
              // Show existing diagram
              <div className="space-y-4">
                <div className="border rounded p-4 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getDiagramUrl(diagramModalType) || ''}
                    alt={`${diagramModalType.name} diagram`}
                    className="max-w-full max-h-[300px] mx-auto object-contain"
                  />
                </div>
                <div className="flex gap-3">
                  <label className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-blue-600 text-blue-600 rounded cursor-pointer hover:bg-blue-50">
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
                    className="flex items-center gap-2 px-4 py-2 text-red-600 border border-red-600 rounded hover:bg-red-50 disabled:opacity-50"
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
              // Upload prompt
              <div className="space-y-4">
                <div className="border-2 border-dashed rounded p-8 text-center bg-gray-50">
                  <ImageIcon size={48} className="mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-600 mb-2">
                    No diagram uploaded yet
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
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

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setDiagramModalType(null)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
    </ListPageLayout>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, ClipboardList, Car, Camera, FileText,
  Loader2, Trash2, Check
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import {
  ChecklistForm,
  ImageDiagramViewer,
  DamageMarkModal,
  SignaturePad,
  FuelGauge
} from '@/components/inspection'

interface WorkOrder {
  id: string
  orderNo: string
  vehicleId: string | null
  vehicle: {
    id: string
    make: string
    model: string
    year: number | null
    licensePlate: string | null
    vehicleTypeId: string | null
    vehicleType: {
      id: string
      name: string
      bodyType: string
      wheelCount: number
    } | null
  } | null
}

interface DiagramView {
  id: string
  viewName: string
  imageUrl: string | null
  imageWidth: number | null
  imageHeight: number | null
}

interface ChecklistItem {
  id: string
  itemName: string
  itemType: 'checkbox' | 'select' | 'text' | 'number'
  options: string | null
  isRequired: boolean
}

interface Category {
  id: string
  name: string
  items: ChecklistItem[]
}

interface Template {
  id: string
  name: string
  categories: Category[]
}

interface DamageMark {
  id: string
  diagramViewId: string | null
  positionX: string
  positionY: string
  damageType: string
  severity: string
  description: string | null
  isPreExisting: boolean
}

interface Photo {
  id: string
  photoUrl: string
  caption: string | null
  damageMarkId: string | null
  responseId: string | null
  createdAt: string
}

interface Response {
  checklistItemId: string
  response: 'ok' | 'concern' | 'fail' | 'na' | null
  value: string | null
  notes: string | null
}

interface Inspection {
  id: string
  inspectionType: 'check_in' | 'check_out'
  status: 'draft' | 'completed'
  fuelLevel: number | null
  odometerReading: string | null
  customerSignature: string | null
  notes: string | null
  template: Template | null
  diagramViews: DiagramView[]
}

type TabType = 'checklist' | 'diagram' | 'photos' | 'summary'

export default function InspectionPage() {
  const params = useParams()
  const router = useRouter()
  const workOrderId = params.id as string
  const inspectionType = params.type as 'check_in' | 'check_out'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [responses, setResponses] = useState<Response[]>([])
  const [damageMarks, setDamageMarks] = useState<DamageMark[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])

  const [activeTab, setActiveTab] = useState<TabType>('checklist')
  const [activeView, setActiveView] = useState<string>('')

  // Damage mark modal state
  const [showDamageModal, setShowDamageModal] = useState(false)
  const [pendingMarkPosition, setPendingMarkPosition] = useState<{ x: number; y: number } | null>(null)
  const [editingMark, setEditingMark] = useState<DamageMark | null>(null)
  const [markProcessing, setMarkProcessing] = useState(false)

  // Photo delete confirmation
  const [deletePhotoConfirm, setDeletePhotoConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })

  // Summary form state
  const [fuelLevel, setFuelLevel] = useState(50)
  const [odometerReading, setOdometerReading] = useState('')
  const [notes, setNotes] = useState('')
  const [completing, setCompleting] = useState(false)

  const fetchWorkOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}`)
      if (res.ok) {
        const data = await res.json()
        setWorkOrder(data)
        return data
      }
    } catch (error) {
      console.error('Error fetching work order:', error)
    }
    return null
  }, [workOrderId])

  const fetchOrCreateInspection = useCallback(async () => {
    try {
      // First try to get existing inspection
      const listRes = await fetch(`/api/work-orders/${workOrderId}/inspections`)
      if (listRes.ok) {
        const inspections = await listRes.json()
        const existing = inspections.find((i: Inspection) => i.inspectionType === inspectionType)

        if (existing) {
          // Fetch full inspection details
          const detailRes = await fetch(`/api/work-orders/${workOrderId}/inspections/${existing.id}`)
          if (detailRes.ok) {
            const data = await detailRes.json()
            setInspection(data)
            setFuelLevel(data.fuelLevel ?? 50)
            setOdometerReading(data.odometerReading || '')
            setNotes(data.notes || '')
            if (data.diagramViews?.length > 0) {
              setActiveView(data.diagramViews[0].id)
            }
            return data
          }
        } else {
          // Create new inspection
          const createRes = await fetch(`/api/work-orders/${workOrderId}/inspections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inspectionType }),
          })

          if (createRes.ok) {
            const newInspection = await createRes.json()
            // Fetch full details
            const detailRes = await fetch(`/api/work-orders/${workOrderId}/inspections/${newInspection.id}`)
            if (detailRes.ok) {
              const data = await detailRes.json()
              setInspection(data)
              if (data.diagramViews?.length > 0) {
                setActiveView(data.diagramViews[0].id)
              }
              return data
            }
          }
        }
      }
    } catch (error) {
      console.error('Error with inspection:', error)
      toast.error('Failed to load inspection')
    }
    return null
  }, [workOrderId, inspectionType])

  const fetchResponses = useCallback(async (inspectionId: string) => {
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionId}/responses`)
      if (res.ok) {
        const data = await res.json()
        setResponses(data)
      }
    } catch (error) {
      console.error('Error fetching responses:', error)
    }
  }, [workOrderId])

  const fetchDamageMarks = useCallback(async (inspectionId: string) => {
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionId}/damage-marks`)
      if (res.ok) {
        const data = await res.json()
        setDamageMarks(data)
      }
    } catch (error) {
      console.error('Error fetching damage marks:', error)
    }
  }, [workOrderId])

  const fetchPhotos = useCallback(async (inspectionId: string) => {
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionId}/photos`)
      if (res.ok) {
        const data = await res.json()
        setPhotos(data)
      }
    } catch (error) {
      console.error('Error fetching photos:', error)
    }
  }, [workOrderId])

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      await fetchWorkOrder()
      const insp = await fetchOrCreateInspection()
      if (insp) {
        await Promise.all([
          fetchResponses(insp.id),
          fetchDamageMarks(insp.id),
          fetchPhotos(insp.id),
        ])
      }
      setLoading(false)
    }
    loadData()
  }, [fetchWorkOrder, fetchOrCreateInspection, fetchResponses, fetchDamageMarks, fetchPhotos])

  // Handle response change
  async function handleResponseChange(itemId: string, data: { response?: 'ok' | 'concern' | 'fail' | 'na'; value?: string; notes?: string }) {
    if (!inspection) return

    // Optimistic update
    setResponses(prev => {
      const existing = prev.find(r => r.checklistItemId === itemId)
      if (existing) {
        return prev.map(r => r.checklistItemId === itemId ? { ...r, ...data } : r)
      }
      return [...prev, { checklistItemId: itemId, response: data.response || null, value: data.value || null, notes: data.notes || null }]
    })

    try {
      await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklistItemId: itemId, ...data }),
      })
    } catch (error) {
      console.error('Error saving response:', error)
      toast.error('Failed to save response')
    }
  }

  // Handle adding damage mark
  function handleAddMark(position: { x: number; y: number }) {
    if (inspection?.status === 'completed') return
    setPendingMarkPosition(position)
    setEditingMark(null)
    setShowDamageModal(true)
  }

  function handleSelectMark(mark: DamageMark) {
    setEditingMark(mark)
    setPendingMarkPosition({ x: parseFloat(mark.positionX), y: parseFloat(mark.positionY) })
    setShowDamageModal(true)
  }

  async function handleSaveDamageMark(data: { damageType: string; severity: string; description: string; isPreExisting: boolean }) {
    if (!inspection || !pendingMarkPosition) return

    setMarkProcessing(true)
    try {
      if (editingMark) {
        // Update existing
        const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}/damage-marks`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markId: editingMark.id, ...data }),
        })
        if (res.ok) {
          await fetchDamageMarks(inspection.id)
          toast.success('Damage mark updated')
        }
      } else {
        // Create new
        const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}/damage-marks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            diagramViewId: activeView || null,
            positionX: pendingMarkPosition.x,
            positionY: pendingMarkPosition.y,
            ...data,
          }),
        })
        if (res.ok) {
          await fetchDamageMarks(inspection.id)
          toast.success('Damage mark added')
        }
      }
      setShowDamageModal(false)
    } catch (error) {
      console.error('Error saving damage mark:', error)
      toast.error('Failed to save damage mark')
    } finally {
      setMarkProcessing(false)
    }
  }

  async function handleDeleteDamageMark() {
    if (!inspection || !editingMark) return

    setMarkProcessing(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}/damage-marks?markId=${editingMark.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await fetchDamageMarks(inspection.id)
        toast.success('Damage mark deleted')
        setShowDamageModal(false)
      }
    } catch (error) {
      console.error('Error deleting damage mark:', error)
      toast.error('Failed to delete damage mark')
    } finally {
      setMarkProcessing(false)
    }
  }

  // Handle photo upload
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!inspection || !e.target.files?.length) return

    const file = e.target.files[0]
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}/photos`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        await fetchPhotos(inspection.id)
        toast.success('Photo uploaded')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to upload photo')
      }
    } catch (error) {
      console.error('Error uploading photo:', error)
      toast.error('Failed to upload photo')
    }
    e.target.value = ''
  }

  async function performDeletePhoto() {
    if (!inspection || !deletePhotoConfirm.id) return

    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}/photos?photoId=${deletePhotoConfirm.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await fetchPhotos(inspection.id)
        toast.success('Photo deleted')
      }
    } catch (error) {
      console.error('Error deleting photo:', error)
      toast.error('Failed to delete photo')
    } finally {
      setDeletePhotoConfirm({ open: false, id: null })
    }
  }

  // Handle signature save
  async function handleSignatureSave(base64Image: string) {
    if (!inspection) return

    setSaving(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerSignature: base64Image }),
      })
      if (res.ok) {
        setInspection(prev => prev ? { ...prev, customerSignature: base64Image } : null)
        toast.success('Signature saved')
      }
    } catch (error) {
      console.error('Error saving signature:', error)
      toast.error('Failed to save signature')
    } finally {
      setSaving(false)
    }
  }

  // Handle complete inspection
  async function handleComplete() {
    if (!inspection) return

    setCompleting(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          fuelLevel,
          odometerReading: odometerReading || null,
          notes: notes || null,
        }),
      })
      if (res.ok) {
        toast.success('Inspection completed!')
        router.push(`/work-orders/${workOrderId}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to complete inspection')
      }
    } catch (error) {
      console.error('Error completing inspection:', error)
      toast.error('Failed to complete inspection')
    } finally {
      setCompleting(false)
    }
  }

  // Save draft (fuel, odometer, notes)
  async function handleSaveDraft() {
    if (!inspection) return

    setSaving(true)
    try {
      await fetch(`/api/work-orders/${workOrderId}/inspections/${inspection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fuelLevel,
          odometerReading: odometerReading || null,
          notes: notes || null,
        }),
      })
      toast.success('Draft saved')
    } catch (error) {
      console.error('Error saving draft:', error)
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <PageLoading text="Loading inspection..." />
  }

  if (!workOrder || !inspection) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Failed to load inspection</p>
        <Link href={`/work-orders/${workOrderId}`} className="text-blue-600 hover:underline mt-2 inline-block">
          Back to Work Order
        </Link>
      </div>
    )
  }

  const isCompleted = inspection.status === 'completed'
  const currentView = inspection.diagramViews?.find(v => v.id === activeView)
  const viewMarks = damageMarks.filter(m => m.diagramViewId === activeView || !m.diagramViewId)

  const totalItems = inspection.template?.categories.reduce((sum, cat) => sum + cat.items.length, 0) || 0
  const answeredItems = responses.filter(r => r.response || r.value).length

  // Hide diagram tab for 2-wheel vehicles
  const vehicleWheelCount = workOrder?.vehicle?.vehicleType?.wheelCount ?? 4
  const showDiagramTab = vehicleWheelCount >= 3

  // Check if diagram has an uploaded image
  const hasDiagramImage = currentView?.imageUrl != null

  const tabs: { id: TabType; label: string; icon: typeof ClipboardList }[] = [
    { id: 'checklist', label: 'Checklist', icon: ClipboardList },
    ...(showDiagramTab ? [{ id: 'diagram' as TabType, label: 'Damage', icon: Car }] : []),
    { id: 'photos', label: 'Photos', icon: Camera },
    { id: 'summary', label: 'Summary', icon: FileText },
  ]

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/work-orders/${workOrderId}`} className="p-2 hover:bg-gray-100 rounded">
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">
            {inspectionType === 'check_in' ? 'Check-in' : 'Check-out'} Inspection
          </h1>
          <p className="text-sm text-gray-500">
            {workOrder.orderNo} - {workOrder.vehicle?.licensePlate && `[${workOrder.vehicle.licensePlate}] `}
            {workOrder.vehicle?.year && `${workOrder.vehicle.year} `}
            {workOrder.vehicle?.make} {workOrder.vehicle?.model}
          </p>
        </div>
        {isCompleted ? (
          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
            Completed
          </span>
        ) : (
          <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
            In Progress
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon size={18} />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.id === 'checklist' && totalItems > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  answeredItems === totalItems ? 'bg-green-100 text-green-700' : 'bg-gray-200'
                }`}>
                  {answeredItems}/{totalItems}
                </span>
              )}
              {tab.id === 'diagram' && damageMarks.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                  {damageMarks.length}
                </span>
              )}
              {tab.id === 'photos' && photos.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  {photos.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="bg-white border rounded-md p-4">
        {/* Checklist Tab */}
        {activeTab === 'checklist' && (
          <div>
            {inspection.template?.categories && inspection.template.categories.length > 0 ? (
              <ChecklistForm
                categories={inspection.template.categories}
                responses={responses}
                onResponseChange={handleResponseChange}
                readonly={isCompleted}
              />
            ) : (
              <div className="text-center py-8 text-gray-500">
                <ClipboardList size={32} className="mx-auto mb-2 text-gray-400" />
                <p>No checklist template available</p>
                {!workOrder?.vehicle?.vehicleTypeId ? (
                  <p className="text-sm">Please assign a Vehicle Type to this vehicle first (edit in Vehicles page)</p>
                ) : (
                  <p className="text-sm">No inspection template found for this vehicle type (check Settings → Inspection Templates)</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Damage Diagram Tab */}
        {activeTab === 'diagram' && showDiagramTab && (
          <div>
            {hasDiagramImage && currentView?.imageUrl ? (
              <>
                {/* Diagram */}
                <ImageDiagramViewer
                  imageUrl={currentView.imageUrl}
                  imageWidth={currentView.imageWidth}
                  imageHeight={currentView.imageHeight}
                  damageMarks={viewMarks}
                  onAddMark={!isCompleted ? handleAddMark : undefined}
                  onSelectMark={handleSelectMark}
                  readonly={isCompleted}
                />

                {/* Damage marks list */}
                {damageMarks.length > 0 && (
                  <div className="mt-4">
                    <h3 className="font-medium mb-2">Damage Marks ({damageMarks.length})</h3>
                    <div className="space-y-2">
                      {damageMarks.map(mark => (
                        <div
                          key={mark.id}
                          className="flex items-center gap-3 p-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSelectMark(mark)}
                        >
                          <span className={`px-2 py-0.5 text-xs rounded ${
                            mark.severity === 'minor' ? 'bg-yellow-100 text-yellow-700' :
                            mark.severity === 'moderate' ? 'bg-orange-100 text-orange-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {mark.severity}
                          </span>
                          <span className="text-sm capitalize">{mark.damageType}</span>
                          {mark.isPreExisting && (
                            <span className="text-xs text-gray-500">(pre-existing)</span>
                          )}
                          {mark.description && (
                            <span className="text-sm text-gray-500 truncate flex-1">{mark.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Car size={32} className="mx-auto mb-2 text-gray-400" />
                <p className="font-medium">No diagram uploaded</p>
                {!workOrder?.vehicle?.vehicleTypeId ? (
                  <p className="text-sm mt-2">Please assign a Vehicle Type to this vehicle first (edit in Vehicles page)</p>
                ) : (
                  <>
                    <p className="text-sm mt-2">
                      Upload a master diagram for this vehicle type in Settings → Vehicle Types
                    </p>
                    <a
                      href="/settings/vehicle-types"
                      className="inline-block mt-3 text-sm text-blue-600 hover:underline"
                    >
                      Go to Vehicle Types Settings
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Photos Tab */}
        {activeTab === 'photos' && (
          <div>
            {!isCompleted && (
              <div className="mb-4">
                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded cursor-pointer hover:bg-gray-50">
                  <Camera size={20} className="text-gray-400" />
                  <span className="text-gray-600">Upload Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {photos.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {photos.map(photo => (
                  <div key={photo.id} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.photoUrl}
                      alt={photo.caption || 'Inspection photo'}
                      className="w-full h-32 object-cover rounded"
                    />
                    {!isCompleted && (
                      <button
                        onClick={() => setDeletePhotoConfirm({ open: true, id: photo.id })}
                        className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    {photo.caption && (
                      <p className="text-xs text-gray-500 mt-1 truncate">{photo.caption}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Camera size={32} className="mx-auto mb-2 text-gray-400" />
                <p>No photos yet</p>
              </div>
            )}
          </div>
        )}

        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <div className="space-y-6">
            {/* Progress summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-blue-600">{answeredItems}/{totalItems}</div>
                <div className="text-sm text-gray-500">Checklist Items</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-orange-600">{damageMarks.length}</div>
                <div className="text-sm text-gray-500">Damage Marks</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-green-600">{photos.length}</div>
                <div className="text-sm text-gray-500">Photos</div>
              </div>
            </div>

            {/* Fuel Level */}
            <div>
              <label className="block text-sm font-medium mb-2">Fuel Level</label>
              <FuelGauge
                value={fuelLevel}
                onChange={!isCompleted ? setFuelLevel : undefined}
                readonly={isCompleted}
              />
            </div>

            {/* Odometer */}
            <div>
              <label className="block text-sm font-medium mb-1">Odometer Reading (km)</label>
              <input
                type="number"
                value={odometerReading}
                onChange={(e) => setOdometerReading(e.target.value)}
                disabled={isCompleted}
                placeholder="Enter odometer reading"
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isCompleted}
                placeholder="Additional notes..."
                rows={3}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            {/* Customer Signature */}
            <div>
              <label className="block text-sm font-medium mb-2">Customer Signature</label>
              <SignaturePad
                onSave={handleSignatureSave}
                existingSignature={inspection.customerSignature}
                readonly={isCompleted}
              />
            </div>

            {/* Actions */}
            {!isCompleted && (
              <div className="flex gap-3 pt-4 border-t">
                <button
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  onClick={handleComplete}
                  disabled={completing}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {completing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check size={18} />
                  )}
                  Complete Inspection
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Damage Mark Modal */}
      <DamageMarkModal
        isOpen={showDamageModal}
        position={pendingMarkPosition || undefined}
        existingMark={editingMark || undefined}
        onConfirm={handleSaveDamageMark}
        onDelete={editingMark ? handleDeleteDamageMark : undefined}
        onClose={() => {
          setShowDamageModal(false)
          setPendingMarkPosition(null)
          setEditingMark(null)
        }}
        processing={markProcessing}
      />

      {/* Delete Photo Confirmation */}
      <ConfirmModal
        isOpen={deletePhotoConfirm.open}
        onClose={() => setDeletePhotoConfirm({ open: false, id: null })}
        onConfirm={performDeletePhoto}
        title="Delete Photo"
        message="Are you sure you want to delete this photo?"
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, ClipboardList, Car, Camera, FileText,
  Loader2, Trash2, Check, RefreshCw, AlertCircle
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
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
  status: string
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

interface Props {
  isOpen: boolean
  onClose: () => void
  workOrder: WorkOrder
  inspectionType: 'check_in' | 'check_out'
  existingInspectionId?: string | null
  onInspectionChange?: () => void
}

export function InspectionModal({
  isOpen,
  onClose,
  workOrder,
  inspectionType,
  existingInspectionId,
  onInspectionChange
}: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  // Summary form state
  const [fuelLevel, setFuelLevel] = useState(50)
  const [odometerReading, setOdometerReading] = useState('')
  const [notes, setNotes] = useState('')
  const [completing, setCompleting] = useState(false)

  // Refs for stable values to avoid re-fetch loops
  const workOrderIdRef = useRef(workOrder.id)
  const inspectionTypeRef = useRef(inspectionType)
  const existingInspectionIdRef = useRef(existingInspectionId)
  const canModifyRef = useRef(!['invoiced', 'cancelled'].includes(workOrder.status))

  // Update refs when props change
  useEffect(() => {
    workOrderIdRef.current = workOrder.id
    inspectionTypeRef.current = inspectionType
    existingInspectionIdRef.current = existingInspectionId
    canModifyRef.current = !['invoiced', 'cancelled'].includes(workOrder.status)
  }, [workOrder.id, workOrder.status, inspectionType, existingInspectionId])

  const canModify = !['invoiced', 'cancelled'].includes(workOrder.status)

  // Use ref to avoid stale closure and prevent infinite loops
  const onInspectionChangeRef = useRef(onInspectionChange)
  onInspectionChangeRef.current = onInspectionChange

  // Issue #1: Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Reset all state when modal closes
      setLoading(true)
      setError(null)
      setInspection(null)
      setResponses([])
      setDamageMarks([])
      setPhotos([])
      setActiveTab('checklist')
      setActiveView('')
      setFuelLevel(50)
      setOdometerReading('')
      setNotes('')
      setShowDamageModal(false)
      setPendingMarkPosition(null)
      setEditingMark(null)
    }
  }, [isOpen])

  // Main data loading effect with AbortController for race condition fix (Issue #4)
  useEffect(() => {
    if (!isOpen) return

    const abortController = new AbortController()
    let isCancelled = false

    async function loadData() {
      setLoading(true)
      setError(null)

      const workOrderId = workOrderIdRef.current
      const currentInspectionType = inspectionTypeRef.current
      const currentExistingId = existingInspectionIdRef.current
      const currentCanModify = canModifyRef.current

      // Issue #7: Check if work order has a vehicle
      if (!workOrder.vehicleId) {
        setError('This work order does not have a vehicle assigned. Please assign a vehicle first.')
        setLoading(false)
        return
      }

      try {
        let inspectionData: Inspection | null = null

        if (currentExistingId) {
          // Fetch existing inspection
          const detailRes = await fetch(
            `/api/work-orders/${workOrderId}/inspections/${currentExistingId}`,
            { signal: abortController.signal }
          )

          if (!detailRes.ok) {
            const errorData = await detailRes.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to load inspection')
          }

          inspectionData = await detailRes.json()
        } else {
          // Check if inspection of this type exists
          const listRes = await fetch(
            `/api/work-orders/${workOrderId}/inspections`,
            { signal: abortController.signal }
          )

          if (!listRes.ok) {
            const errorData = await listRes.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to load inspections')
          }

          const inspections = await listRes.json()
          const existing = inspections.find((i: Inspection) => i.inspectionType === currentInspectionType)

          if (existing) {
            // Fetch full details
            const detailRes = await fetch(
              `/api/work-orders/${workOrderId}/inspections/${existing.id}`,
              { signal: abortController.signal }
            )

            if (!detailRes.ok) {
              const errorData = await detailRes.json().catch(() => ({}))
              throw new Error(errorData.error || 'Failed to load inspection details')
            }

            inspectionData = await detailRes.json()
          } else if (currentCanModify) {
            // Create new inspection
            const createRes = await fetch(`/api/work-orders/${workOrderId}/inspections`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inspectionType: currentInspectionType }),
              signal: abortController.signal,
            })

            if (!createRes.ok) {
              const errorData = await createRes.json().catch(() => ({}))
              throw new Error(errorData.error || 'Failed to create inspection')
            }

            const newInspection = await createRes.json()

            // Fetch full details
            const detailRes = await fetch(
              `/api/work-orders/${workOrderId}/inspections/${newInspection.id}`,
              { signal: abortController.signal }
            )

            if (!detailRes.ok) {
              const errorData = await detailRes.json().catch(() => ({}))
              throw new Error(errorData.error || 'Failed to load new inspection')
            }

            inspectionData = await detailRes.json()
            onInspectionChangeRef.current?.()
          } else {
            // Issue #3: Inform user why inspection can't be created
            throw new Error('Cannot create inspection for invoiced or cancelled work orders')
          }
        }

        if (isCancelled) return

        if (inspectionData) {
          setInspection(inspectionData)
          setFuelLevel(inspectionData.fuelLevel ?? 50)
          setOdometerReading(inspectionData.odometerReading || '')
          setNotes(inspectionData.notes || '')

          // Issue #9: Only set activeView if not already set
          if (inspectionData.diagramViews?.length > 0 && !activeView) {
            setActiveView(inspectionData.diagramViews[0].id)
          }

          // Fetch related data in parallel
          const [responsesRes, damageMarksRes, photosRes] = await Promise.all([
            fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionData.id}/responses`, {
              signal: abortController.signal
            }),
            fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionData.id}/damage-marks`, {
              signal: abortController.signal
            }),
            fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionData.id}/photos`, {
              signal: abortController.signal
            }),
          ])

          if (isCancelled) return

          if (responsesRes.ok) {
            setResponses(await responsesRes.json())
          }
          if (damageMarksRes.ok) {
            setDamageMarks(await damageMarksRes.json())
          }
          if (photosRes.ok) {
            setPhotos(await photosRes.json())
          }
        }

        setLoading(false)
      } catch (err) {
        if (isCancelled) return

        // Don't show error for aborted requests
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }

        console.error('Error loading inspection:', err)
        setError(err instanceof Error ? err.message : 'Failed to load inspection')
        setLoading(false)
      }
    }

    loadData()

    return () => {
      isCancelled = true
      abortController.abort()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workOrder.vehicleId]) // Issue #5: Minimal dependencies - only isOpen and vehicleId

  // Retry function for Issue #8
  const handleRetry = useCallback(() => {
    setError(null)
    setLoading(true)
    // Trigger re-fetch by closing and reopening the effect
    // We'll use a key trick - but since we can't change keys, we'll just refetch
    const abortController = new AbortController()

    async function retryLoad() {
      const workOrderId = workOrderIdRef.current
      const currentInspectionType = inspectionTypeRef.current
      const currentExistingId = existingInspectionIdRef.current
      const currentCanModify = canModifyRef.current

      if (!workOrder.vehicleId) {
        setError('This work order does not have a vehicle assigned.')
        setLoading(false)
        return
      }

      try {
        let inspectionData: Inspection | null = null

        if (currentExistingId) {
          const detailRes = await fetch(
            `/api/work-orders/${workOrderId}/inspections/${currentExistingId}`,
            { signal: abortController.signal }
          )
          if (!detailRes.ok) {
            const errorData = await detailRes.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to load inspection')
          }
          inspectionData = await detailRes.json()
        } else {
          const listRes = await fetch(
            `/api/work-orders/${workOrderId}/inspections`,
            { signal: abortController.signal }
          )
          if (!listRes.ok) {
            const errorData = await listRes.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to load inspections')
          }

          const inspections = await listRes.json()
          const existing = inspections.find((i: Inspection) => i.inspectionType === currentInspectionType)

          if (existing) {
            const detailRes = await fetch(
              `/api/work-orders/${workOrderId}/inspections/${existing.id}`,
              { signal: abortController.signal }
            )
            if (!detailRes.ok) {
              const errorData = await detailRes.json().catch(() => ({}))
              throw new Error(errorData.error || 'Failed to load inspection details')
            }
            inspectionData = await detailRes.json()
          } else if (currentCanModify) {
            const createRes = await fetch(`/api/work-orders/${workOrderId}/inspections`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inspectionType: currentInspectionType }),
              signal: abortController.signal,
            })
            if (!createRes.ok) {
              const errorData = await createRes.json().catch(() => ({}))
              throw new Error(errorData.error || 'Failed to create inspection')
            }
            const newInspection = await createRes.json()
            const detailRes = await fetch(
              `/api/work-orders/${workOrderId}/inspections/${newInspection.id}`,
              { signal: abortController.signal }
            )
            if (!detailRes.ok) {
              const errorData = await detailRes.json().catch(() => ({}))
              throw new Error(errorData.error || 'Failed to load new inspection')
            }
            inspectionData = await detailRes.json()
            onInspectionChangeRef.current?.()
          } else {
            throw new Error('Cannot create inspection for invoiced or cancelled work orders')
          }
        }

        if (inspectionData) {
          setInspection(inspectionData)
          setFuelLevel(inspectionData.fuelLevel ?? 50)
          setOdometerReading(inspectionData.odometerReading || '')
          setNotes(inspectionData.notes || '')

          if (inspectionData.diagramViews?.length > 0 && !activeView) {
            setActiveView(inspectionData.diagramViews[0].id)
          }

          const [responsesRes, damageMarksRes, photosRes] = await Promise.all([
            fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionData.id}/responses`, {
              signal: abortController.signal
            }),
            fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionData.id}/damage-marks`, {
              signal: abortController.signal
            }),
            fetch(`/api/work-orders/${workOrderId}/inspections/${inspectionData.id}/photos`, {
              signal: abortController.signal
            }),
          ])

          if (responsesRes.ok) setResponses(await responsesRes.json())
          if (damageMarksRes.ok) setDamageMarks(await damageMarksRes.json())
          if (photosRes.ok) setPhotos(await photosRes.json())
        }

        setLoading(false)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error('Error loading inspection:', err)
        setError(err instanceof Error ? err.message : 'Failed to load inspection')
        setLoading(false)
      }
    }

    retryLoad()
  }, [workOrder.vehicleId, activeView])

  // Handle response change - Issue #10: Better error handling
  async function handleResponseChange(itemId: string, data: { response?: 'ok' | 'concern' | 'fail' | 'na'; value?: string; notes?: string }) {
    if (!inspection || !canModify) return

    // Optimistic update
    setResponses(prev => {
      const existing = prev.find(r => r.checklistItemId === itemId)
      if (existing) {
        return prev.map(r => r.checklistItemId === itemId ? { ...r, ...data } : r)
      }
      return [...prev, { checklistItemId: itemId, response: data.response || null, value: data.value || null, notes: data.notes || null }]
    })

    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklistItemId: itemId, ...data }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to save response')
      }
    } catch (err) {
      console.error('Error saving response:', err)
      toast.error('Failed to save response')
    }
  }

  // Handle adding damage mark
  function handleAddMark(position: { x: number; y: number }) {
    if (inspection?.status === 'completed' || !canModify) return
    setPendingMarkPosition(position)
    setEditingMark(null)
    setShowDamageModal(true)
  }

  function handleSelectMark(mark: DamageMark) {
    setEditingMark(mark)
    setPendingMarkPosition({ x: parseFloat(mark.positionX), y: parseFloat(mark.positionY) })
    setShowDamageModal(true)
  }

  // Issue #10: Better error handling for damage marks
  async function handleSaveDamageMark(data: { damageType: string; severity: string; description: string; isPreExisting: boolean }) {
    if (!inspection || !pendingMarkPosition || !canModify) return

    setMarkProcessing(true)
    try {
      if (editingMark) {
        const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/damage-marks`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markId: editingMark.id, ...data }),
        })
        if (res.ok) {
          const marksRes = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/damage-marks`)
          if (marksRes.ok) setDamageMarks(await marksRes.json())
          toast.success('Damage mark updated')
        } else {
          const errorData = await res.json().catch(() => ({}))
          toast.error(errorData.error || 'Failed to update damage mark')
        }
      } else {
        const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/damage-marks`, {
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
          const marksRes = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/damage-marks`)
          if (marksRes.ok) setDamageMarks(await marksRes.json())
          toast.success('Damage mark added')
        } else {
          const errorData = await res.json().catch(() => ({}))
          toast.error(errorData.error || 'Failed to add damage mark')
        }
      }
      setShowDamageModal(false)
    } catch (err) {
      console.error('Error saving damage mark:', err)
      toast.error('Failed to save damage mark')
    } finally {
      setMarkProcessing(false)
    }
  }

  async function handleDeleteDamageMark() {
    if (!inspection || !editingMark || !canModify) return

    setMarkProcessing(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/damage-marks?markId=${editingMark.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        const marksRes = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/damage-marks`)
        if (marksRes.ok) setDamageMarks(await marksRes.json())
        toast.success('Damage mark deleted')
        setShowDamageModal(false)
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to delete damage mark')
      }
    } catch (err) {
      console.error('Error deleting damage mark:', err)
      toast.error('Failed to delete damage mark')
    } finally {
      setMarkProcessing(false)
    }
  }

  // Handle photo upload - Issue #10: Better error handling
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!inspection || !e.target.files?.length || !canModify) return

    const file = e.target.files[0]

    // Client-side validation before uploading
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Only JPEG, PNG, and WebP images are allowed')
      e.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB')
      e.target.value = ''
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/photos`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const photosRes = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/photos`)
        if (photosRes.ok) setPhotos(await photosRes.json())
        toast.success('Photo uploaded')
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to upload photo')
      }
    } catch (err) {
      console.error('Error uploading photo:', err)
      toast.error('Failed to upload photo')
    }
    e.target.value = ''
  }

  async function handleDeletePhoto(photoId: string) {
    if (!inspection || !canModify) return

    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/photos?photoId=${photoId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        const photosRes = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}/photos`)
        if (photosRes.ok) setPhotos(await photosRes.json())
        toast.success('Photo deleted')
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to delete photo')
      }
    } catch (err) {
      console.error('Error deleting photo:', err)
      toast.error('Failed to delete photo')
    }
  }

  // Handle signature save
  async function handleSignatureSave(base64Image: string) {
    if (!inspection || !canModify) return

    setSaving(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerSignature: base64Image }),
      })
      if (res.ok) {
        setInspection(prev => prev ? { ...prev, customerSignature: base64Image } : null)
        toast.success('Signature saved')
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to save signature')
      }
    } catch (err) {
      console.error('Error saving signature:', err)
      toast.error('Failed to save signature')
    } finally {
      setSaving(false)
    }
  }

  // Handle complete inspection
  async function handleComplete() {
    if (!inspection || !canModify) return

    setCompleting(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}`, {
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
        onInspectionChangeRef.current?.()
        onClose()
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to complete inspection')
      }
    } catch (err) {
      console.error('Error completing inspection:', err)
      toast.error('Failed to complete inspection')
    } finally {
      setCompleting(false)
    }
  }

  // Save draft (fuel, odometer, notes)
  async function handleSaveDraft() {
    if (!inspection || !canModify) return

    setSaving(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/inspections/${inspection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fuelLevel,
          odometerReading: odometerReading || null,
          notes: notes || null,
        }),
      })
      if (res.ok) {
        toast.success('Draft saved')
        onInspectionChangeRef.current?.()
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to save draft')
      }
    } catch (err) {
      console.error('Error saving draft:', err)
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const isCompleted = inspection?.status === 'completed'
  const isReadOnly = isCompleted || !canModify
  const currentView = inspection?.diagramViews?.find(v => v.id === activeView)
  const viewMarks = damageMarks.filter(m => m.diagramViewId === activeView || !m.diagramViewId)

  const totalItems = inspection?.template?.categories.reduce((sum, cat) => sum + cat.items.length, 0) || 0
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-semibold">
              {inspectionType === 'check_in' ? 'Check-in' : 'Check-out'} Inspection
            </h2>
            <p className="text-sm text-gray-500">
              {workOrder.orderNo} - {workOrder.vehicle?.licensePlate && `[${workOrder.vehicle.licensePlate}] `}
              {workOrder.vehicle?.year && `${workOrder.vehicle.year} `}
              {workOrder.vehicle?.make} {workOrder.vehicle?.model}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {inspection && (
              isCompleted ? (
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                  Completed
                </span>
              ) : (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
                  In Progress
                </span>
              )
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            <span className="ml-2 text-gray-500">Loading inspection...</span>
          </div>
        ) : error ? (
          // Issue #8: Error state with retry button
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
            <p className="text-gray-700 font-medium mb-2">Failed to load inspection</p>
            <p className="text-gray-500 text-sm mb-4 text-center max-w-md">{error}</p>
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <RefreshCw size={16} />
              Retry
            </button>
          </div>
        ) : !inspection ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-gray-500">No inspection data available</p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 p-2 bg-gray-100 shrink-0">
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
            <div className="flex-1 overflow-y-auto p-4">
              {/* Checklist Tab */}
              {activeTab === 'checklist' && (
                <div>
                  {inspection.template?.categories && inspection.template.categories.length > 0 ? (
                    <ChecklistForm
                      categories={inspection.template.categories}
                      responses={responses}
                      onResponseChange={handleResponseChange}
                      readonly={isReadOnly}
                    />
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <ClipboardList size={32} className="mx-auto mb-2 text-gray-400" />
                      <p>No checklist template available</p>
                      {!workOrder?.vehicle?.vehicleTypeId ? (
                        <p className="text-sm">Please assign a Vehicle Type to this vehicle first</p>
                      ) : (
                        <p className="text-sm">No inspection template found for this vehicle type</p>
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
                      <ImageDiagramViewer
                        imageUrl={currentView.imageUrl}
                        imageWidth={currentView.imageWidth}
                        imageHeight={currentView.imageHeight}
                        damageMarks={viewMarks}
                        onAddMark={!isReadOnly ? handleAddMark : undefined}
                        onSelectMark={handleSelectMark}
                        readonly={isReadOnly}
                      />

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
                        <p className="text-sm mt-2">Please assign a Vehicle Type to this vehicle first</p>
                      ) : (
                        <p className="text-sm mt-2">
                          Upload a master diagram for this vehicle type in Settings
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Photos Tab */}
              {activeTab === 'photos' && (
                <div>
                  {!isReadOnly && (
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
                          {!isReadOnly && (
                            <button
                              onClick={() => handleDeletePhoto(photo.id)}
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
                      onChange={!isReadOnly ? setFuelLevel : undefined}
                      readonly={isReadOnly}
                    />
                  </div>

                  {/* Odometer */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Odometer Reading (km)</label>
                    <input
                      type="number"
                      value={odometerReading}
                      onChange={(e) => setOdometerReading(e.target.value)}
                      disabled={isReadOnly}
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
                      disabled={isReadOnly}
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
                      readonly={isReadOnly}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            {!isReadOnly && (
              <div className="flex gap-3 p-4 border-t bg-gray-50 shrink-0">
                <button
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="px-4 py-2 border rounded hover:bg-gray-100 disabled:opacity-50"
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
          </>
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
        readOnly={isReadOnly}
      />
    </div>
  )
}

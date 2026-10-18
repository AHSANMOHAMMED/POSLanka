'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Plus, Trash2, CheckCircle, XCircle, AlertCircle, Clock, FileText,
  Send, Wrench, Car, User, Building2, Phone, Mail, ChevronDown, ChevronUp,
  Printer, Image as ImageIcon, Upload, X, FolderSearch, Shield, AlertTriangle
} from 'lucide-react'
import { CancellationReasonModal, ServiceTypeModal, ItemModal, StockAdjustmentModal, CustomerFormModal, VehicleModal } from '@/components/modals'
import type { StockIssueItem, ItemAdjustment } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { useDocumentViewer } from '@/components/ui/document-viewer-context'
import { RevisionComparisonModal, AttachmentBrowserModal } from '@/components/estimates'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { LinkField } from '@/components/ui/link-field'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'
import { useRealtimeDataMultiple } from '@/hooks/useRealtimeData'
import { PageLoading } from '@/components/ui/loading-spinner'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { toast } from '@/components/ui/toast'
import { isValidPositiveNumber, isValidStrictlyPositiveNumber, isValidQuantity } from '@/lib/utils/validation'
import { PrintPreview, EstimateTemplate } from '@/components/print'
import { DEFAULT_PRINT_SETTINGS } from '@/lib/print/types'
import { useCompany } from '@/components/providers/CompanyContextProvider'

interface Category {
  id: string
  name: string
}

interface ServiceType {
  id: string
  name: string
  defaultHours: string | null
  defaultRate: string | null
}

interface Item {
  id: string
  name: string
  sellingPrice: string
  currentStock: string
  availableStock: string
  trackStock: boolean
}

interface EstimateItem {
  id: string
  itemType: 'service' | 'part'
  serviceTypeId: string | null
  description: string | null
  hours: string | null
  rate: string | null
  itemId: string | null
  partName: string | null
  quantity: string | null
  unitPrice: string | null
  originalAmount: string
  approvedAmount: string | null
  status: 'pending' | 'approved' | 'price_adjusted' | 'rejected' | 'requires_reinspection'
  rejectionReason: string | null
  assessorNotes: string | null
  convertedToWorkOrderId: string | null
  conversionSkippedReason: string | null
  serviceType?: { name: string } | null
  item?: { name: string } | null
}

interface InsuranceAssessor {
  id: string
  name: string
  phone: string | null
  email: string | null
  insuranceCompanyId: string | null
}

// Create mode interfaces
interface CreateCustomer {
  id: string
  name: string
  phone: string | null
}

interface CreateVehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  customerId: string | null
}

interface VehicleMake {
  id: string
  name: string
}

interface CreateInsuranceCompany {
  id: string
  name: string
  shortName: string | null
}

interface Revision {
  id: string
  revisionNumber: number
  changeReason: string | null
  createdAt: string
  changedByUser?: { fullName: string } | null
}

interface InsuranceEstimate {
  id: string
  estimateNo: string
  estimateType: 'insurance' | 'direct'
  status: string
  revisionNumber: number
  policyNumber: string | null
  claimNumber: string | null
  assessorName: string | null
  assessorPhone: string | null
  assessorEmail: string | null
  incidentDate: string | null
  incidentDescription: string | null
  odometerIn: number | null
  originalSubtotal: string
  originalTaxAmount: string
  originalTotal: string
  approvedSubtotal: string
  approvedTaxAmount: string
  approvedTotal: string
  insuranceRemarks: string | null
  reviewedAt: string | null
  workOrderId: string | null
  cancellationReason: string | null
  holdStock: boolean
  createdAt: string
  customer: { id: string; name: string; phone: string | null; balance: string } | null
  vehicle: { id: string; make: string; model: string; year: number | null; licensePlate: string | null } | null
  insuranceCompany: { id: string; name: string; shortName: string | null; phone: string | null; email: string | null } | null
  workOrder: { id: string; orderNo: string } | null
  assessorId: string | null
  assessor: InsuranceAssessor | null
  items: EstimateItem[]
  revisions: Revision[]
}

interface StatusConfigItem {
  color: string;
  bgColor: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}

const statusConfig: Record<string, StatusConfigItem> = {
  draft: { color: 'text-gray-800', bgColor: 'bg-gray-100', icon: FileText, label: 'Draft' },
  submitted: { color: 'text-blue-800', bgColor: 'bg-blue-100', icon: Clock, label: 'Submitted' },
  under_review: { color: 'text-yellow-800', bgColor: 'bg-yellow-100', icon: AlertCircle, label: 'Under Review' },
  approved: { color: 'text-green-800', bgColor: 'bg-green-100', icon: CheckCircle, label: 'Approved' },
  partially_approved: { color: 'text-orange-800', bgColor: 'bg-orange-100', icon: AlertCircle, label: 'Partially Approved' },
  rejected: { color: 'text-red-800', bgColor: 'bg-red-100', icon: XCircle, label: 'Rejected' },
  work_order_created: { color: 'text-purple-800', bgColor: 'bg-purple-100', icon: CheckCircle, label: 'Work Order Created' },
  cancelled: { color: 'text-red-800', bgColor: 'bg-red-100', icon: XCircle, label: 'Cancelled' },
}

const itemStatusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  approved: 'bg-green-100 text-green-700',
  price_adjusted: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
  requires_reinspection: 'bg-purple-100 text-purple-700',
}

const itemStatusLabels: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  price_adjusted: 'Price Adjusted',
  rejected: 'Rejected',
  requires_reinspection: 'Re-inspection',
}

export default function InsuranceEstimateDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()
  const estimateId = params.id as string
  const isCreateMode = estimateId === 'new'

  const [estimate, setEstimate] = useState<InsuranceEstimate | null>(null)
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [assessors, setAssessors] = useState<InsuranceAssessor[]>([])
  const [loading, setLoading] = useState(!isCreateMode)
  const [processing, setProcessing] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [showRevisions, setShowRevisions] = useState(false)

  // ===== CREATE MODE STATE =====
  const [customers, setCustomers] = useState<CreateCustomer[]>([])
  const [vehicles, setVehicles] = useState<CreateVehicle[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [insuranceCompanies, setInsuranceCompanies] = useState<CreateInsuranceCompany[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Create form data
  const [createFormData, setCreateFormData] = useState({
    estimateType: 'insurance' as 'insurance' | 'direct',
    vehicleId: '',
    customerId: '',
    odometerIn: '',
    insuranceCompanyId: '',
    policyNumber: '',
    claimNumber: '',
    incidentDate: '',
    incidentDescription: '',
    assessorId: '',
    assessorName: '',
    assessorPhone: '',
    assessorEmail: '',
  })
  const [createWarehouseId, setCreateWarehouseId] = useState<string | null>(null)

  // Create modal states
  const [showCreateCustomerModal, setShowCreateCustomerModal] = useState(false)
  const [pendingNewCustomerName, setPendingNewCustomerName] = useState('')
  const [showCreateVehicleModal, setShowCreateVehicleModal] = useState(false)

  // Customer mismatch confirmation for create mode
  const [showCreateMismatchDialog, setShowCreateMismatchDialog] = useState(false)
  const [createMismatchInfo, setCreateMismatchInfo] = useState<{ vehicleOwnerName: string; vehicleOwnerId: string } | null>(null)

  // Trigger save animation
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function triggerSaveAnimation() {
    setJustSaved(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setJustSaved(false), 1500)
  }
  useEffect(() => { return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) } }, [])
  const [editingAssessor, setEditingAssessor] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionValue, setDescriptionValue] = useState('')
  const assessorNameInputRef = useRef<HTMLInputElement>(null)
  const [assessorForm, setAssessorForm] = useState({
    assessorId: '',
    assessorName: '',
    assessorPhone: '',
    assessorEmail: '',
  })

  // Service form state
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [serviceFormData, setServiceFormData] = useState({
    serviceTypeId: '',
    description: '',
    hours: '',
    rate: '',
  })

  // Part form state
  const [showPartForm, setShowPartForm] = useState(false)
  const [partFormData, setPartFormData] = useState({
    itemId: '',
    quantity: '1',
    unitPrice: '',
  })

  // Selected options for async dropdowns
  const [selectedServiceOption, setSelectedServiceOption] = useState<{ value: string; label: string; data?: Record<string, unknown> } | null>(null)
  const [selectedItemOption, setSelectedItemOption] = useState<{ value: string; label: string; data?: Record<string, unknown> } | null>(null)

  // Create modals
  const [showServiceTypeModal, setShowServiceTypeModal] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [pendingServiceTypeName, setPendingServiceTypeName] = useState('')
  const [pendingItemName, setPendingItemName] = useState('')

  // Confirm modals
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)
  const [showConfirmConvert, setShowConfirmConvert] = useState(false)
  const [removeItemConfirm, setRemoveItemConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const [deleteAttachmentConfirm, setDeleteAttachmentConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })
  const [completeReviewConfirm, setCompleteReviewConfirm] = useState<{ open: boolean; status: 'approved' | 'partially_approved' | 'rejected' | '' }>({ open: false, status: '' })

  // Stock adjustment modal
  const [showStockAdjustmentModal, setShowStockAdjustmentModal] = useState(false)
  const [stockIssueItems, setStockIssueItems] = useState<StockIssueItem[]>([])

  // Review mode state
  const [showCompleteReviewModal, setShowCompleteReviewModal] = useState(false)
  const [reviewRemarks, setReviewRemarks] = useState('')
  const [itemReviewUpdates, setItemReviewUpdates] = useState<Record<string, {
    status?: string
    approvedAmount?: string
    rejectionReason?: string
    assessorNotes?: string
  }>>({})

  // Print preview state
  const [showPrintPreview, setShowPrintPreview] = useState(false)

  // E24: Revision comparison state
  const [showRevisionComparison, setShowRevisionComparison] = useState(false)

  // E25: Estimate templates state
  const [templates, setTemplates] = useState<Array<{
    id: string
    name: string
    description: string | null
    itemsTemplate: unknown[]
  }>>([])
  const [applyingTemplate, setApplyingTemplate] = useState(false)

  // E23: Photo attachments state
  const [attachments, setAttachments] = useState<Array<{
    id: string
    fileName: string
    fileType: string
    fileSize: number
    filePath: string
    category: string | null
    description: string | null
    createdAt: string
    uploadedByUser?: { fullName: string } | null
  }>>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [showAttachmentBrowser, setShowAttachmentBrowser] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Global document viewer
  const { openViewer } = useDocumentViewer()

  const routerRef = useRef(router)
  routerRef.current = router

  const fetchEstimate = useCallback(async () => {
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}`)
      if (res.ok) {
        const data = await res.json()
        setEstimate(data)
      } else {
        const errorData = await res.json().catch(() => ({}))
        console.error('Failed to fetch estimate:', res.status, errorData)
        // Only redirect for 404 (not found), show error for other cases
        if (res.status === 404) {
          toast.error('Estimate not found')
          routerRef.current.push('/insurance-estimates')
        } else {
          toast.error(errorData.error || 'Failed to load estimate')
          setEstimate(null)
        }
      }
    } catch (error) {
      console.error('Error fetching estimate:', error)
    } finally {
      setLoading(false)
    }
  }, [estimateId])

  useEffect(() => {
    if (isCreateMode) {
      // Create mode - fetch dropdown data
      fetchCustomers()
      fetchVehicles()
      fetchMakes()
      fetchInsuranceCompanies()
      fetchAssessors()
    } else {
      // Edit mode - fetch estimate and related data
      fetchEstimate()
      fetchServiceTypes()
      fetchItems()
      fetchCategories()
      fetchAssessors()
      fetchAttachments() // E23
      fetchTemplates() // E25
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEstimate, isCreateMode])

  // ===== CREATE MODE DATA FETCHING =====
  async function fetchCustomers() {
    try {
      const res = await fetch('/api/customers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCustomers(data)
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
    }
  }

  async function fetchVehicles() {
    try {
      const res = await fetch('/api/vehicles?all=true')
      if (res.ok) {
        const data = await res.json()
        setVehicles(data)
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error)
    }
  }

  async function fetchMakes() {
    try {
      const res = await fetch('/api/vehicle-makes')
      if (res.ok) {
        const data = await res.json()
        setMakes(data)
      }
    } catch (error) {
      console.error('Error fetching makes:', error)
    }
  }

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

  // ===== CREATE MODE HANDLERS =====
  // Filter vehicles by selected customer
  const filteredCreateVehicles = useMemo(() => {
    if (!createFormData.customerId) return vehicles
    const customerVehicles = vehicles.filter(v => v.customerId === createFormData.customerId)
    const otherVehicles = vehicles.filter(v => v.customerId !== createFormData.customerId)
    return [...customerVehicles, ...otherVehicles]
  }, [vehicles, createFormData.customerId])

  // Filter customers by selected vehicle
  const filteredCreateCustomers = useMemo(() => {
    if (!createFormData.vehicleId) return customers
    const selectedVehicle = vehicles.find(v => v.id === createFormData.vehicleId)
    if (!selectedVehicle?.customerId) return customers
    const ownerCustomer = customers.filter(c => c.id === selectedVehicle.customerId)
    const otherCustomers = customers.filter(c => c.id !== selectedVehicle.customerId)
    return [...ownerCustomer, ...otherCustomers]
  }, [customers, vehicles, createFormData.vehicleId])

  // Filter assessors by insurance company
  const filteredCreateAssessors = useMemo(() => {
    if (!createFormData.insuranceCompanyId) return assessors
    return assessors.filter(a => !a.insuranceCompanyId || a.insuranceCompanyId === createFormData.insuranceCompanyId)
  }, [assessors, createFormData.insuranceCompanyId])

  // Check for customer-vehicle mismatch in create mode
  const hasCreateMismatch = useMemo(() => {
    if (!createFormData.vehicleId || !createFormData.customerId) return false
    const vehicle = vehicles.find(v => v.id === createFormData.vehicleId)
    return vehicle?.customerId && vehicle.customerId !== createFormData.customerId
  }, [vehicles, createFormData.vehicleId, createFormData.customerId])

  function handleCreateVehicleChange(vehicleId: string) {
    const vehicle = vehicles.find(v => v.id === vehicleId)
    setCreateFormData(prev => ({
      ...prev,
      vehicleId,
      customerId: (!prev.customerId && vehicle?.customerId) ? vehicle.customerId : prev.customerId
    }))
  }

  function handleCreateAssessorSelect(assessorId: string) {
    if (!assessorId) {
      setCreateFormData(prev => ({
        ...prev,
        assessorId: '',
        assessorName: '',
        assessorPhone: '',
        assessorEmail: '',
      }))
      return
    }
    const assessor = assessors.find(a => a.id === assessorId)
    if (assessor) {
      setCreateFormData(prev => ({
        ...prev,
        assessorId: assessor.id,
        assessorName: assessor.name,
        assessorPhone: assessor.phone || '',
        assessorEmail: assessor.email || '',
      }))
    }
  }

  function handleCreateCustomerCreated(customer: { id: string; name: string; phone: string | null }) {
    setCustomers(prev => [...prev, customer])
    setCreateFormData(prev => ({ ...prev, customerId: customer.id }))
  }

  function handleCreateVehicleCreated(vehicle: CreateVehicle) {
    fetchVehicles()
    setCreateFormData(prev => ({
      ...prev,
      vehicleId: vehicle.id,
      customerId: vehicle.customerId || prev.customerId
    }))
  }

  async function handleCreateEstimate(confirmMismatch = false) {
    // Validate required fields
    if (!createFormData.vehicleId) {
      setCreateError('Vehicle is required')
      return
    }
    if (!createFormData.customerId) {
      setCreateError('Customer is required')
      return
    }
    if (!createFormData.odometerIn || parseInt(createFormData.odometerIn) <= 0) {
      setCreateError('Valid odometer reading is required')
      return
    }
    if (!createWarehouseId) {
      setCreateError('Warehouse is required')
      return
    }
    if (createFormData.estimateType === 'insurance' && !createFormData.insuranceCompanyId) {
      setCreateError('Insurance company is required for insurance estimates')
      return
    }

    setCreating(true)
    setCreateError('')

    try {
      let assessorId = createFormData.assessorId

      // If no existing assessor selected but name provided, create a new one
      if (!assessorId && createFormData.assessorName && createFormData.estimateType === 'insurance') {
        const createRes = await fetch('/api/insurance-assessors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            insuranceCompanyId: createFormData.insuranceCompanyId || null,
            name: createFormData.assessorName,
            phone: createFormData.assessorPhone || null,
            email: createFormData.assessorEmail || null,
          }),
        })

        if (createRes.ok) {
          const newAssessor = await createRes.json()
          assessorId = newAssessor.id
          fetchAssessors()
        } else {
          const errData = await createRes.json()
          setCreateError(errData.error || 'Failed to create assessor')
          setCreating(false)
          return
        }
      }

      const res = await fetch('/api/insurance-estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estimateType: createFormData.estimateType,
          customerId: createFormData.customerId || null,
          vehicleId: createFormData.vehicleId || null,
          warehouseId: createWarehouseId || null,
          odometerIn: createFormData.odometerIn || null,
          insuranceCompanyId: createFormData.estimateType === 'insurance' ? (createFormData.insuranceCompanyId || null) : null,
          policyNumber: createFormData.estimateType === 'insurance' ? createFormData.policyNumber : null,
          claimNumber: createFormData.estimateType === 'insurance' ? createFormData.claimNumber : null,
          incidentDate: createFormData.estimateType === 'insurance' ? createFormData.incidentDate : null,
          incidentDescription: createFormData.incidentDescription || null,
          assessorId: createFormData.estimateType === 'insurance' ? (assessorId || null) : null,
          confirmCustomerMismatch: confirmMismatch,
        }),
      })

      if (res.ok) {
        const savedEstimate = await res.json()
        toast.success(`Estimate ${savedEstimate.estimateNo} created successfully!`)
        router.replace(`/insurance-estimates/${savedEstimate.id}`)
      } else if (res.status === 409) {
        const data = await res.json()
        if (data.error === 'CUSTOMER_VEHICLE_MISMATCH') {
          setCreateMismatchInfo({ vehicleOwnerName: data.vehicleOwnerName, vehicleOwnerId: data.vehicleOwnerId })
          setShowCreateMismatchDialog(true)
        } else {
          setCreateError(data.message || 'Failed to create estimate')
        }
      } else {
        const data = await res.json()
        setCreateError(data.error || 'Failed to create estimate')
      }
    } catch (err) {
      console.error('Error creating estimate:', err)
      setCreateError('Failed to create estimate')
    } finally {
      setCreating(false)
    }
  }

  function handleCreateMismatchConfirm() {
    setShowCreateMismatchDialog(false)
    handleCreateEstimate(true)
    setCreateMismatchInfo(null)
  }

  function handleCreateMismatchUseOwner() {
    if (createMismatchInfo) {
      setCreateFormData(prev => ({ ...prev, customerId: createMismatchInfo.vehicleOwnerId }))
    }
    setShowCreateMismatchDialog(false)
    setCreateMismatchInfo(null)
  }

  useEffect(() => {
    if (estimate) {
      setAssessorForm({
        assessorId: estimate.assessorId || '',
        assessorName: estimate.assessorName || '',
        assessorPhone: estimate.assessorPhone || '',
        assessorEmail: estimate.assessorEmail || '',
      })
    }
  }, [estimate])

  // Simple parts filter
  const parts = useMemo(() => estimate?.items.filter(i => i.itemType === 'part') || [], [estimate])

  // Real-time updates for estimate and related data via WebSocket (with polling fallback)
  // This ensures new items/services created by other users appear in dropdowns while searching
  useRealtimeDataMultiple([fetchEstimate, fetchItems, fetchServiceTypes], { entityType: ['estimate', 'item', 'service', 'estimate-template'], refreshOnMount: false })

  async function fetchServiceTypes() {
    try {
      const res = await fetch('/api/service-types?all=true')
      if (res.ok) {
        const data = await res.json()
        setServiceTypes(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching service types:', error)
    }
  }

  async function fetchItems() {
    try {
      const res = await fetch('/api/items?all=true')
      if (res.ok) {
        const data = await res.json()
        setItems(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching items:', error)
    }
  }

  async function fetchAssessors() {
    try {
      const res = await fetch('/api/insurance-assessors?all=true')
      if (res.ok) {
        const data = await res.json()
        setAssessors(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching assessors:', error)
    }
  }

  // E23: Fetch attachments
  async function fetchAttachments() {
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/attachments`)
      if (res.ok) {
        const data = await res.json()
        setAttachments(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching attachments:', error)
    }
  }

  // E25: Fetch templates
  async function fetchTemplates() {
    try {
      const res = await fetch('/api/estimate-templates?all=true')
      if (res.ok) {
        const data = await res.json()
        setTemplates(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching templates:', error)
    }
  }

  // E25: Apply template to estimate
  async function handleApplyTemplate(templateId: string) {
    if (!estimate || estimate.status !== 'draft') return

    setApplyingTemplate(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(`Applied template: ${data.templateName} (${data.itemsAdded} items added)`)
        await fetchEstimate()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to apply template')
      }
    } catch (error) {
      console.error('Error applying template:', error)
      toast.error('Failed to apply template')
    } finally {
      setApplyingTemplate(false)
    }
  }

  async function fetchCategories() {
    try {
      const res = await fetch('/api/categories?all=true')
      if (res.ok) {
        const data = await res.json()
        setCategories(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }

  function handleAssessorSelect(assessorId: string) {
    if (!assessorId) {
      setAssessorForm({
        assessorId: '',
        assessorName: '',
        assessorPhone: '',
        assessorEmail: '',
      })
      return
    }
    const assessor = assessors.find(a => a.id === assessorId)
    if (assessor) {
      setAssessorForm({
        assessorId: assessor.id,
        assessorName: assessor.name,
        assessorPhone: assessor.phone || '',
        assessorEmail: assessor.email || '',
      })
    }
  }

  async function handleSaveAssessor() {
    if (!estimate || !assessorForm.assessorName) {
      toast.error('Assessor name is required')
      return
    }

    setProcessing(true)
    try {
      let assessorId = assessorForm.assessorId

      // If no existing assessor selected, create a new one
      if (!assessorId && assessorForm.assessorName) {
        const createRes = await fetch('/api/insurance-assessors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            insuranceCompanyId: estimate.insuranceCompany?.id || null,
            name: assessorForm.assessorName,
            phone: assessorForm.assessorPhone || null,
            email: assessorForm.assessorEmail || null,
          }),
        })

        if (createRes.ok) {
          const newAssessor = await createRes.json()
          assessorId = newAssessor.id
          await fetchAssessors() // Refresh assessors list
        } else {
          const errData = await createRes.json()
          toast.error(errData.error || 'Failed to save assessor')
          setProcessing(false)
          return
        }
      }

      // Update the estimate with the assessor
      const updateRes = await fetch(`/api/insurance-estimates/${estimateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessorId: assessorId || null,
          assessorName: assessorForm.assessorName,
          assessorPhone: assessorForm.assessorPhone || null,
          assessorEmail: assessorForm.assessorEmail || null,
        }),
      })

      if (updateRes.ok) {
        await fetchEstimate()
        setEditingAssessor(false)
        toast.success('Assessor details saved')
      } else {
        const errData = await updateRes.json()
        toast.error(errData.error || 'Failed to update estimate')
      }
    } catch (error) {
      console.error('Error saving assessor:', error)
      toast.error('Failed to save assessor')
    } finally {
      setProcessing(false)
    }
  }

  // Update incident description
  async function handleSaveDescription() {
    if (!estimate) return
    setProcessing(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentDescription: descriptionValue || null,
        }),
      })
      if (res.ok) {
        await fetchEstimate()
        setEditingDescription(false)
        toast.success('Description saved')
      } else {
        const errData = await res.json()
        toast.error(errData.error || 'Failed to update description')
      }
    } catch (error) {
      console.error('Error saving description:', error)
      toast.error('Failed to save description')
    } finally {
      setProcessing(false)
    }
  }

  // Async search functions for server-side search
  async function searchServiceTypes(search: string) {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/service-types?${params}`)
    const result = await res.json()
    const data = result.data || result
    return data.map((st: ServiceType) => ({
      value: st.id,
      label: st.name,
      data: { defaultHours: st.defaultHours, defaultRate: st.defaultRate }
    }))
  }

  async function searchItems(search: string) {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data = result.data || result
    return data.map((item: Item) => ({
      value: item.id,
      label: item.name,
      data: { sellingPrice: item.sellingPrice }
    }))
  }

  function handleServiceTypeChange(serviceTypeId: string, option?: { value: string; label: string; data?: Record<string, unknown> }) {
    const data = option?.data
    const st = data ? null : serviceTypes.find(s => s.id === serviceTypeId)
    setServiceFormData({
      ...serviceFormData,
      serviceTypeId,
      description: option?.label || st?.name || '',
      hours: (data?.defaultHours as string) || st?.defaultHours || '',
      rate: (data?.defaultRate as string) || st?.defaultRate || '',
    })
    setSelectedServiceOption(option || null)
  }

  function handleItemChange(itemId: string, option?: { value: string; label: string; data?: Record<string, unknown> }) {
    const data = option?.data
    const item = data ? null : items.find(i => i.id === itemId)
    setPartFormData({
      ...partFormData,
      itemId,
      unitPrice: (data?.sellingPrice as string) || item?.sellingPrice || '',
    })
    setSelectedItemOption(option || null)
  }

  // E23: Handle attachment upload
  async function handleAttachmentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploadingAttachment(true)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('category', 'damage')

        const res = await fetch(`/api/insurance-estimates/${estimateId}/attachments`, {
          method: 'POST',
          body: formData,
        })

        const data = await res.json()

        if (res.ok) {
          // Check if file was linked from another estimate
          if (data.linkedFrom) {
            toast.success(`${file.name} linked from ${data.linkedFrom}`)
          } else {
            toast.success(`Uploaded ${file.name}`)
          }
        } else if (res.status === 409 && data.duplicate) {
          // Duplicate file in same estimate
          toast.error(`${file.name} has already been uploaded to this estimate`)
        } else {
          toast.error(data.error || `Failed to upload ${file.name}`)
        }
      }
      await fetchAttachments()
    } catch (error) {
      console.error('Error uploading attachments:', error)
      toast.error('Failed to upload files')
    } finally {
      setUploadingAttachment(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // E23: Handle attachment deletion (with confirmation)
  async function performDeleteAttachment() {
    if (!deleteAttachmentConfirm.id) return
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/attachments?attachmentId=${deleteAttachmentConfirm.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setAttachments(attachments.filter(a => a.id !== deleteAttachmentConfirm.id))
        toast.success('Attachment deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete attachment')
      }
    } catch (error) {
      console.error('Error deleting attachment:', error)
      toast.error('Failed to delete attachment')
    } finally {
      setDeleteAttachmentConfirm({ open: false, id: null, name: '' })
    }
  }

  // Handle linking existing attachments from other estimates
  async function handleLinkAttachments(attachmentIds: string[]) {
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/attachments/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentIds }),
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || `Linked ${data.linked} attachment${data.linked !== 1 ? 's' : ''}`)
        // Refresh attachments list
        fetchAttachments()
      } else {
        toast.error(data.error || 'Failed to link attachments')
      }
    } catch (error) {
      console.error('Error linking attachments:', error)
      toast.error('Failed to link attachments')
    }
  }

  async function handleAddService(e: React.FormEvent) {
    e.preventDefault()
    if (!estimate) return

    if (!isValidStrictlyPositiveNumber(serviceFormData.hours)) {
      toast.error('Hours must be greater than zero')
      return
    }
    if (!isValidPositiveNumber(serviceFormData.rate)) {
      toast.error('Please enter a valid rate')
      return
    }

    setUpdating(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: 'service',
          serviceTypeId: serviceFormData.serviceTypeId || null,
          description: serviceFormData.description || null,
          hours: parseFloat(serviceFormData.hours),
          rate: parseFloat(serviceFormData.rate),
        }),
      })

      if (res.ok) {
        await fetchEstimate()
        setShowServiceForm(false)
        setServiceFormData({ serviceTypeId: '', description: '', hours: '', rate: '' })
        setSelectedServiceOption(null)
        triggerSaveAnimation()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to add service')
      }
    } catch (error) {
      console.error('Error adding service:', error)
      toast.error('Failed to add service')
    } finally {
      setUpdating(false)
    }
  }

  async function handleAddPart(e: React.FormEvent) {
    e.preventDefault()
    if (!estimate) return

    if (!isValidQuantity(partFormData.quantity)) {
      toast.error('Please enter a valid quantity')
      return
    }
    if (!isValidPositiveNumber(partFormData.unitPrice)) {
      toast.error('Please enter a valid unit price')
      return
    }

    const item = items.find(i => i.id === partFormData.itemId)

    setUpdating(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: 'part',
          itemId: partFormData.itemId || null,
          partName: item?.name || null,
          quantity: parseFloat(partFormData.quantity),
          unitPrice: parseFloat(partFormData.unitPrice),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        await fetchEstimate()
        setShowPartForm(false)
        setPartFormData({ itemId: '', quantity: '1', unitPrice: '' })
        setSelectedItemOption(null)
        triggerSaveAnimation()

        // Show stock warning if applicable
        if (data.stockWarning) {
          toast.error(`Stock warning: ${data.stockWarning}`)
        } else if (data.stockWarnings && data.stockWarnings.length > 0) {
          // Multiple stock warnings
          toast.error(`Stock warnings: ${data.stockWarnings.join(', ')}`)
        }
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to add part')
      }
    } catch (error) {
      console.error('Error adding part:', error)
      toast.error('Failed to add part')
    } finally {
      setUpdating(false)
    }
  }

  async function handleRemoveItem() {
    if (!removeItemConfirm.id) return
    setUpdating(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/items?itemId=${removeItemConfirm.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        await fetchEstimate()
        triggerSaveAnimation()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to remove item')
      }
    } catch (error) {
      console.error('Error removing item:', error)
      toast.error('Failed to remove item')
    } finally {
      setUpdating(false)
      setRemoveItemConfirm({ open: false, id: null })
    }
  }

  async function handleUpdateItem(itemId: string, updates: { hours?: number; rate?: number; quantity?: number; unitPrice?: number }) {
    setUpdating(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, ...updates }),
      })

      if (res.ok) {
        await fetchEstimate()
        triggerSaveAnimation()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update item')
      }
    } catch (error) {
      console.error('Error updating item:', error)
    } finally {
      setUpdating(false)
    }
  }

  async function handleSubmit() {
    setProcessing(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/submit`, {
        method: 'POST',
      })

      if (res.ok) {
        await fetchEstimate()
        toast.success('Estimate submitted to insurance')
        setShowConfirmSubmit(false)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to submit estimate')
      }
    } catch (error) {
      console.error('Error submitting estimate:', error)
      toast.error('Failed to submit estimate')
    } finally {
      setProcessing(false)
    }
  }

  async function handleCancel(reason: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      })

      if (res.ok) {
        await fetchEstimate()
        toast.success('Estimate cancelled')
        setShowCancellationModal(false)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel estimate')
      }
    } catch (error) {
      console.error('Error cancelling estimate:', error)
      toast.error('Failed to cancel estimate')
    } finally {
      setProcessing(false)
    }
  }

  async function handleConvert() {
    setProcessing(true)
    try {
      // First, check for stock issues
      const checkRes = await fetch(`/api/insurance-estimates/${estimateId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkOnly: true }),
      })

      const checkData = await checkRes.json()

      if (!checkRes.ok) {
        toast.error(checkData.error || 'Failed to check stock availability')
        setShowConfirmConvert(false)
        return
      }

      // If there are stock issues, show the adjustment modal
      if (checkData.hasStockIssues && checkData.itemsWithStockIssues.length > 0) {
        setStockIssueItems(checkData.itemsWithStockIssues)
        setShowConfirmConvert(false)
        setShowStockAdjustmentModal(true)
        setProcessing(false)
        return
      }

      // No stock issues, proceed with conversion
      await executeConversion([])
    } catch (error) {
      console.error('Error converting estimate:', error)
      toast.error('Failed to convert estimate')
      setProcessing(false)
    }
  }

  async function executeConversion(itemAdjustments: ItemAdjustment[]) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemAdjustments }),
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || 'Work order created')
        // Show warnings about skipped items
        if (data.warnings && data.warnings.length > 0) {
          data.warnings.forEach((warning: string) => toast.warning(warning))
        }
        // Show conversion summary
        if (data.converted) {
          const { services, parts, partialParts } = data.converted
          const { noStock, noInventoryLink, byUser } = data.skipped || { noStock: 0, noInventoryLink: 0, byUser: 0 }
          const skippedTotal = noStock + noInventoryLink + byUser
          if (skippedTotal > 0 || partialParts > 0) {
            let msg = `Converted: ${services} services, ${parts} parts`
            if (partialParts > 0) msg += ` (${partialParts} partial)`
            if (skippedTotal > 0) msg += `. Skipped: ${skippedTotal} items`
            toast.info(msg)
          }
        }
        setShowConfirmConvert(false)
        setShowStockAdjustmentModal(false)
        // Navigate to the newly created work order
        if (data.workOrder?.id) {
          router.push(tenantSlug ? `/c/${tenantSlug}/work-orders/${data.workOrder.id}` : `/work-orders/${data.workOrder.id}`)
        }
      } else {
        toast.error(data.error || 'Failed to convert estimate')
      }
    } catch (error) {
      console.error('Error converting estimate:', error)
      toast.error('Failed to convert estimate')
    } finally {
      setProcessing(false)
    }
  }

  function handleStockAdjustmentConfirm(adjustments: ItemAdjustment[]) {
    executeConversion(adjustments)
  }

  async function handleAssessorVisit() {
    // Check if assessor info is entered
    if (!estimate?.assessorName) {
      setEditingAssessor(true)
      // Focus on assessor name input after state update
      setTimeout(() => {
        assessorNameInputRef.current?.focus()
      }, 100)
      toast.error('Please enter assessor information first')
      return
    }

    setProcessing(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'under_review' }),
      })

      if (res.ok) {
        await fetchEstimate()
        toast.success('Assessor visit recorded')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update status')
      }
    } catch (error) {
      console.error('Error updating status:', error)
      toast.error('Failed to update status')
    } finally {
      setProcessing(false)
    }
  }

  function handleItemReviewChange(itemId: string, field: string, value: string) {
    setItemReviewUpdates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value,
      },
    }))
  }

  async function handleSaveItemReview(itemId: string, directUpdates?: { status?: string; approvedAmount?: string; assessorNotes?: string }) {
    // Use direct updates if provided (for immediate saves like status change), otherwise use state
    const updates = directUpdates || itemReviewUpdates[itemId]
    if (!updates || Object.keys(updates).length === 0) return

    // Find the item to check for unchanged values
    const item = estimate?.items.find(i => i.id === itemId)
    if (!item) return

    // Don't save if only approvedAmount changed but equals original
    if (updates.approvedAmount && !updates.status && !updates.assessorNotes) {
      const newAmount = parseFloat(updates.approvedAmount)
      const originalAmount = parseFloat(item.originalAmount)
      if (newAmount === originalAmount) return
    }

    setUpdating(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'under_review',
          items: [{
            id: itemId,
            status: updates.status,
            approvedAmount: updates.approvedAmount ? parseFloat(updates.approvedAmount) : undefined,
            assessorNotes: updates.assessorNotes,
          }],
        }),
      })

      if (res.ok) {
        await fetchEstimate()
        // Clear this item's pending updates
        setItemReviewUpdates(prev => {
          return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== itemId))
        })
        triggerSaveAnimation()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save item review')
      }
    } catch (error) {
      console.error('Error saving item review:', error)
      toast.error('Failed to save item review')
    } finally {
      setUpdating(false)
    }
  }

  async function handleCompleteReview(finalStatus: 'approved' | 'partially_approved' | 'rejected') {
    setProcessing(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: finalStatus,
          insuranceRemarks: reviewRemarks || null,
        }),
      })

      if (res.ok) {
        await fetchEstimate()
        setShowCompleteReviewModal(false)
        setReviewRemarks('')
        toast.success(`Estimate marked as ${finalStatus.replace('_', ' ')}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to complete review')
      }
    } catch (error) {
      console.error('Error completing review:', error)
      toast.error('Failed to complete review')
    } finally {
      setProcessing(false)
    }
  }

  // E27: Bulk approve/reject all pending items
  async function handleBulkItemAction(action: 'approve' | 'reject') {
    if (!estimate) return
    const pendingItems = estimate.items.filter(i => i.status === 'pending')
    if (pendingItems.length === 0) {
      toast.info('No pending items to update')
      return
    }

    setProcessing(true)
    let successCount = 0
    let errorCount = 0

    for (const item of pendingItems) {
      try {
        const res = await fetch(`/api/insurance-estimates/${estimateId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: item.id,
            status: action === 'approve' ? 'approved' : 'rejected',
            approvedAmount: action === 'approve' ? item.originalAmount : null,
          }),
        })
        if (res.ok) {
          successCount++
        } else {
          errorCount++
        }
      } catch {
        errorCount++
      }
    }

    await fetchEstimate()
    setProcessing(false)

    if (errorCount === 0) {
      toast.success(`${successCount} items ${action === 'approve' ? 'approved' : 'rejected'}`)
    } else {
      toast.warning(`${successCount} succeeded, ${errorCount} failed`)
    }
  }

  if (loading) {
    return <PageLoading text="Loading estimate..." />
  }

  // ===== CREATE MODE UI =====
  if (isCreateMode) {
    const selectedVehicle = vehicles.find(v => v.id === createFormData.vehicleId)
    const selectedCustomer = customers.find(c => c.id === createFormData.customerId)

    return (
      <div>
        {/* Header */}
        <div className="mb-6">
          <Link href={tenantSlug ? `/c/${tenantSlug}/insurance-estimates` : '/insurance-estimates'} className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-4">
            <ArrowLeft size={20} />
            Back to Estimates
          </Link>
          <h1 className="text-2xl font-bold dark:text-white">New Estimate</h1>
        </div>

        {createError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            {createError}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-6 space-y-6">
          {/* Estimate Type */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Estimate Type</h3>
            <div className="flex gap-4">
              <label
                className={`flex items-center gap-3 px-4 py-3 border rounded cursor-pointer transition-colors flex-1 ${
                  createFormData.estimateType === 'insurance'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <input
                  type="radio"
                  name="estimateType"
                  value="insurance"
                  checked={createFormData.estimateType === 'insurance'}
                  onChange={(e) => setCreateFormData(prev => ({ ...prev, estimateType: e.target.value as 'insurance' | 'direct' }))}
                  className="text-blue-600"
                />
                <div className="flex items-center gap-2">
                  <Shield size={18} className="text-blue-600" />
                  <div>
                    <span className="font-medium dark:text-white">Insurance Claim</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">With insurance company, assessor review</p>
                  </div>
                </div>
              </label>
              <label
                className={`flex items-center gap-3 px-4 py-3 border rounded cursor-pointer transition-colors flex-1 ${
                  createFormData.estimateType === 'direct'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <input
                  type="radio"
                  name="estimateType"
                  value="direct"
                  checked={createFormData.estimateType === 'direct'}
                  onChange={(e) => setCreateFormData(prev => ({ ...prev, estimateType: e.target.value as 'insurance' | 'direct' }))}
                  className="text-blue-600"
                />
                <div className="flex items-center gap-2">
                  <FileText size={18} className="text-gray-600 dark:text-gray-400" />
                  <div>
                    <span className="font-medium dark:text-white">Direct Estimate</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Simple quote for walk-in customers</p>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Vehicle & Customer */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Vehicle & Customer</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                  Vehicle <span className="text-red-500">*</span>
                </label>
                <CreatableSelect
                  options={filteredCreateVehicles.map(v => ({
                    value: v.id,
                    label: `${v.licensePlate ? `[${v.licensePlate}] ` : ''}${v.year ? `${v.year} ` : ''}${v.make} ${v.model}${createFormData.customerId && v.customerId !== createFormData.customerId ? ' (Other Owner)' : ''}`
                  }))}
                  value={createFormData.vehicleId}
                  onChange={handleCreateVehicleChange}
                  onCreateNew={() => setShowCreateVehicleModal(true)}
                  placeholder="Search or select vehicle..."
                  createLabel="Add new vehicle"
                />
                {selectedVehicle && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
                    {selectedVehicle.licensePlate && ` • ${selectedVehicle.licensePlate}`}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                  Customer <span className="text-red-500">*</span>
                </label>
                <CreatableSelect
                  options={filteredCreateCustomers.map(c => {
                    const vehicle = vehicles.find(v => v.id === createFormData.vehicleId)
                    const isNotOwner = createFormData.vehicleId && vehicle?.customerId && vehicle.customerId !== c.id
                    return { value: c.id, label: `${c.name}${isNotOwner ? ' (Not Owner)' : ''}` }
                  })}
                  value={createFormData.customerId}
                  onChange={(customerId) => setCreateFormData(prev => ({ ...prev, customerId }))}
                  onCreateNew={(name) => {
                    setPendingNewCustomerName(name)
                    setShowCreateCustomerModal(true)
                  }}
                  placeholder="Search or select customer..."
                  createLabel="Add new customer"
                />
                {selectedCustomer && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {selectedCustomer.phone || 'No phone'}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                  Odometer In (km) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={createFormData.odometerIn}
                  onChange={(e) => setCreateFormData(prev => ({ ...prev, odometerIn: e.target.value }))}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="Current odometer reading"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                  Warehouse <span className="text-red-500">*</span>
                </label>
                <WarehouseSelector
                  value={createWarehouseId}
                  onChange={setCreateWarehouseId}
                  userOnly={true}
                  placeholder="Select warehouse"
                  required={true}
                />
              </div>
            </div>

            {hasCreateMismatch && (
              <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-sm text-orange-700 dark:text-orange-300 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <span>
                  The selected vehicle belongs to a different customer. You can still proceed, but this will be flagged.
                </span>
              </div>
            )}
          </div>

          {/* Insurance Details - only for insurance estimates */}
          {createFormData.estimateType === 'insurance' && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Insurance Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                    Insurance Company <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={createFormData.insuranceCompanyId}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, insuranceCompanyId: e.target.value }))}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="">Select Insurance Company</option>
                    {insuranceCompanies.map(ic => (
                      <option key={ic.id} value={ic.id}>
                        {ic.shortName ? `${ic.shortName} - ${ic.name}` : ic.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Incident Date</label>
                  <input
                    type="date"
                    value={createFormData.incidentDate}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, incidentDate: e.target.value }))}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Policy Number</label>
                  <input
                    type="text"
                    value={createFormData.policyNumber}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, policyNumber: e.target.value }))}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="Insurance policy number"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Claim Number</label>
                  <input
                    type="text"
                    value={createFormData.claimNumber}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, claimNumber: e.target.value }))}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="Insurance claim number"
                  />
                </div>
              </div>

              {/* Assessor Section */}
              <div className="mt-4 border-t dark:border-gray-700 pt-4">
                <h4 className="text-sm font-medium mb-3 dark:text-gray-300">Assessor Details (Optional)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Select Assessor</label>
                    <select
                      value={createFormData.assessorId}
                      onChange={(e) => handleCreateAssessorSelect(e.target.value)}
                      className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    >
                      <option value="">-- New Assessor --</option>
                      {filteredCreateAssessors.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Name</label>
                    <input
                      type="text"
                      value={createFormData.assessorName}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, assessorName: e.target.value, assessorId: '' }))}
                      className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      placeholder="Assessor name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Phone</label>
                    <input
                      type="tel"
                      value={createFormData.assessorPhone}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, assessorPhone: e.target.value }))}
                      className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      placeholder="Phone number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Email</label>
                    <input
                      type="email"
                      value={createFormData.assessorEmail}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, assessorEmail: e.target.value }))}
                      className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      placeholder="Email address"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notes / Incident Description */}
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">
              {createFormData.estimateType === 'insurance' ? 'Incident Description' : 'Notes'}
            </label>
            <textarea
              value={createFormData.incidentDescription}
              onChange={(e) => setCreateFormData(prev => ({ ...prev, incidentDescription: e.target.value }))}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              rows={4}
              placeholder={createFormData.estimateType === 'insurance' ? 'Describe the accident or incident...' : 'Add any notes...'}
            />
          </div>

          {/* Info box */}
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded p-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Estimate items (parts, labor, paint) can be added after creating the estimate.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
            <Link
              href={tenantSlug ? `/c/${tenantSlug}/insurance-estimates` : '/insurance-estimates'}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 dark:border-gray-600"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => handleCreateEstimate()}
              disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Estimate'}
            </button>
          </div>
        </div>

        {/* Customer-Vehicle Mismatch Dialog */}
        {showCreateMismatchDialog && createMismatchInfo && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
            <div className="bg-white dark:bg-gray-800 rounded p-6 max-w-md w-full mx-4 shadow-xl">
              <h3 className="text-lg font-semibold mb-4 text-orange-600 dark:text-orange-400 flex items-center gap-2">
                <AlertTriangle size={20} />
                Vehicle Ownership Mismatch
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                This vehicle belongs to <strong>&quot;{createMismatchInfo.vehicleOwnerName}&quot;</strong>, not the selected customer.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Do you want to proceed with the selected customer, or use the vehicle owner as the customer?
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleCreateMismatchConfirm}
                  className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
                >
                  Proceed with Selected Customer
                </button>
                <button
                  onClick={handleCreateMismatchUseOwner}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Use Vehicle Owner ({createMismatchInfo.vehicleOwnerName})
                </button>
                <button
                  onClick={() => {
                    setShowCreateMismatchDialog(false)
                    setCreateMismatchInfo(null)
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Inline creation modals */}
        <CustomerFormModal
          isOpen={showCreateCustomerModal}
          onClose={() => {
            setShowCreateCustomerModal(false)
            setPendingNewCustomerName('')
          }}
          onSaved={handleCreateCustomerCreated}
          initialName={pendingNewCustomerName}
        />

        <VehicleModal
          isOpen={showCreateVehicleModal}
          onClose={() => setShowCreateVehicleModal(false)}
          onCreated={handleCreateVehicleCreated}
          customers={customers}
          makes={makes}
          onMakesUpdated={fetchMakes}
          onCustomersUpdated={fetchCustomers}
          selectedCustomerId={createFormData.customerId}
        />
      </div>
    )
  }

  if (!estimate) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">Estimate not found</div>
  }

  const config = statusConfig[estimate.status] || statusConfig.draft
  const StatusIcon = config.icon
  const isInsuranceEstimate = estimate.estimateType === 'insurance'
  const hasUnreviewedItems = estimate.items.some(i => i.status === 'requires_reinspection' || i.status === 'pending')
  const canEdit = ['draft'].includes(estimate.status)

  const canEditAssessor = isInsuranceEstimate && estimate.status !== 'work_order_created'
  const canEditDescription = estimate.status !== 'work_order_created' && estimate.status !== 'cancelled'
  // Insurance: submit to insurance company; Direct: not applicable
  const canSubmit = isInsuranceEstimate && estimate.status === 'draft' && estimate.items.length > 0 && estimate.insuranceCompany
  // Check for remaining items that can be converted (approved/price_adjusted but not yet converted)
  const remainingItemsToConvert = estimate.items.filter(i =>
    ['approved', 'price_adjusted'].includes(i.status) && !i.convertedToWorkOrderId
  ).length
  // Insurance: convert after approval; Direct: convert directly from draft
  // Also allow converting remaining items when status is work_order_created or reverted to approved
  const canConvert = isInsuranceEstimate
    ? ((['approved', 'partially_approved', 'work_order_created'].includes(estimate.status) && remainingItemsToConvert > 0 && !hasUnreviewedItems))
    : ((estimate.status === 'draft' && estimate.items.length > 0) ||
       (['work_order_created', 'approved', 'partially_approved'].includes(estimate.status) && remainingItemsToConvert > 0))
  const canCancel = !estimate.workOrder && estimate.status !== 'work_order_created' && estimate.status !== 'cancelled'
  const canMarkUnderReview = isInsuranceEstimate && estimate.status === 'submitted'
  const canReviewItems = isInsuranceEstimate && estimate.status === 'under_review'
  const canCompleteReview = isInsuranceEstimate && estimate.status === 'under_review'
  // After review is complete, allow editing only re-inspection/pending items
  const canReviewUnreviewedOnly = isInsuranceEstimate && ['approved', 'partially_approved', 'rejected'].includes(estimate.status) && hasUnreviewedItems
  // Show approved column for completed estimates (insurance only)
  const isCompletedEstimate = isInsuranceEstimate && ['approved', 'partially_approved', 'rejected', 'work_order_created'].includes(estimate.status) && !hasUnreviewedItems
  const showApprovedColumn = canReviewItems || canReviewUnreviewedOnly || isCompletedEstimate

  const originalTotal = parseFloat(estimate.originalTotal)
  const approvedTotal = parseFloat(estimate.approvedTotal)
  const variance = approvedTotal > 0 ? ((approvedTotal - originalTotal) / originalTotal * 100).toFixed(1) : null

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href={tenantSlug ? `/c/${tenantSlug}/insurance-estimates` : '/insurance-estimates'} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4">
          <ArrowLeft size={20} />
          Back to Estimates
        </Link>

        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{estimate.estimateNo}</h1>
              <span className={`text-xs px-2 py-0.5 rounded ${isInsuranceEstimate ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                {isInsuranceEstimate ? 'Insurance' : 'Direct'}
              </span>
              {estimate.revisionNumber > 1 && (
                <span className="text-sm bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                  <FileText size={12} />
                  Revision {estimate.revisionNumber}
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Created {new Date(estimate.createdAt).toLocaleString()}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-full ${config.bgColor} ${config.color}`}>
            <StatusIcon size={14} />
            {config.label}
          </span>
        </div>
        {estimate.status === 'cancelled' && estimate.cancellationReason && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-sm text-red-700">
              <span className="font-medium">Cancellation Reason:</span> {estimate.cancellationReason}
            </p>
          </div>
        )}
      </div>

      {/* Work Order Link Banner */}
      {estimate.workOrder && (
        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded">
          <div className="flex items-center gap-3">
            <Wrench className="text-purple-600" size={20} />
            <span className="text-purple-800">
              This estimate was converted to work order{' '}
              <Link href={tenantSlug ? `/c/${tenantSlug}/work-orders/${estimate.workOrder.id}` : `/work-orders/${estimate.workOrder.id}`} className="font-medium underline hover:text-purple-900">
                {estimate.workOrder.orderNo}
              </Link>
            </span>
          </div>
        </div>
      )}

      {/* Unreviewed Items Warning Banner */}
      {canReviewUnreviewedOnly && (
        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-purple-600" size={20} />
            <div>
              <span className="text-purple-800 font-medium">
                {estimate.items.filter(i => i.status === 'requires_reinspection' || i.status === 'pending').length} item(s) still need review
              </span>
              <p className="text-purple-700 text-sm mt-1">
                Update pending/re-inspection items. Work order can be created once all items are reviewed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions Section */}
      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h3 className="text-sm font-medium text-gray-600 mb-2">Actions</h3>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Save Indicator */}
            {(canEdit || canReviewItems || canReviewUnreviewedOnly) && (
              <div
                className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all duration-300 ${
                  updating
                    ? 'bg-blue-100 text-blue-700'
                    : justSaved
                    ? 'bg-green-500 text-white scale-105 shadow-lg'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {updating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-blue-700 border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} className={justSaved ? 'animate-bounce' : ''} />
                    {justSaved ? 'Saved!' : canReviewItems || canReviewUnreviewedOnly ? 'Review Saved' : 'Draft Saved'}
                  </>
                )}
              </div>
            )}
            {canMarkUnderReview && (
              <button
                onClick={handleAssessorVisit}
                disabled={processing}
                className="px-4 py-2 bg-yellow-600 text-white rounded text-sm font-medium hover:bg-yellow-700 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <User size={16} />
                  Assessor Visit
                </span>
              </button>
            )}
            {canCompleteReview && (
              <button
                onClick={() => setShowCompleteReviewModal(true)}
                disabled={processing}
                className="px-4 py-2 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <CheckCircle size={16} />
                  Complete Review
                </span>
              </button>
            )}
            {/* E27: Bulk approve/reject buttons */}
            {(canReviewItems || canReviewUnreviewedOnly) && estimate.items.filter(i => i.status === 'pending').length > 0 && (
              <>
                <button
                  onClick={() => handleBulkItemAction('approve')}
                  disabled={processing}
                  className="px-3 py-2 bg-green-100 text-green-700 rounded text-sm font-medium hover:bg-green-200 disabled:opacity-50"
                >
                  <span className="flex items-center gap-1">
                    <CheckCircle size={14} />
                    Approve All ({estimate.items.filter(i => i.status === 'pending').length})
                  </span>
                </button>
                <button
                  onClick={() => handleBulkItemAction('reject')}
                  disabled={processing}
                  className="px-3 py-2 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200 disabled:opacity-50"
                >
                  <span className="flex items-center gap-1">
                    <XCircle size={14} />
                    Reject All ({estimate.items.filter(i => i.status === 'pending').length})
                  </span>
                </button>
              </>
            )}
            {canSubmit && (
              <button
                onClick={() => setShowConfirmSubmit(true)}
                disabled={processing}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <Send size={16} />
                  Submit to Insurance
                </span>
              </button>
            )}
            {canConvert && (
              <button
                onClick={() => setShowConfirmConvert(true)}
                disabled={processing}
                className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <Wrench size={16} />
                  {estimate.status === 'work_order_created' ? `Convert Remaining (${remainingItemsToConvert})` : 'Create Work Order'}
                </span>
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setShowCancellationModal(true)}
                disabled={processing}
                className="px-4 py-2 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200 disabled:opacity-50"
              >
                Cancel Estimate
              </button>
            )}
            {/* Print Button - always available */}
            <button
              onClick={() => setShowPrintPreview(true)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
            >
              <Printer size={16} />
              Print
            </button>
          </div>
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Vehicle Info */}
          <div className="bg-white rounded border p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                  <User size={16} />
                  Customer
                </h3>
                {estimate.customer ? (
                  <div>
                    <p className="font-medium">{estimate.customer.name}</p>
                    {estimate.customer.phone && <p className="text-sm text-gray-600">{estimate.customer.phone}</p>}
                    {/* X5: Show customer credit balance */}
                    {parseFloat(estimate.customer.balance || '0') !== 0 && (
                      <p className={`text-sm font-medium ${parseFloat(estimate.customer.balance || '0') > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        Credit: LKR {parseFloat(estimate.customer.balance || '0').toLocaleString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-400">No customer assigned</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                  <Car size={16} />
                  Vehicle
                </h3>
                {estimate.vehicle ? (
                  <div>
                    <p className="font-medium">
                      {estimate.vehicle.licensePlate && <span className="text-blue-600">[{estimate.vehicle.licensePlate}]</span>}{' '}
                      {estimate.vehicle.year ? `${estimate.vehicle.year} ` : ''}
                      {estimate.vehicle.make} {estimate.vehicle.model}
                    </p>
                    {estimate.odometerIn && (
                      <p className="text-sm text-gray-600">Odometer: {estimate.odometerIn.toLocaleString()} km</p>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-400">No vehicle assigned</p>
                )}
              </div>
            </div>
            {(estimate.incidentDescription || canEditDescription) && (
              <div className="mt-4 pt-4 border-t">
                <h3 className="text-sm font-medium text-gray-500 mb-1 flex items-center justify-between">
                  {estimate.estimateType === 'direct' ? 'Notes' : 'Incident Description'}
                  {canEditDescription && !editingDescription && (
                    <button
                      onClick={() => {
                        setDescriptionValue(estimate.incidentDescription || '')
                        setEditingDescription(true)
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      {estimate.incidentDescription ? 'Edit' : 'Add'}
                    </button>
                  )}
                </h3>
                {editingDescription ? (
                  <div className="space-y-2">
                    <textarea
                      value={descriptionValue}
                      onChange={(e) => setDescriptionValue(e.target.value)}
                      className="w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      placeholder={estimate.estimateType === 'direct' ? 'Enter notes...' : 'Describe the accident or incident...'}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveDescription}
                        disabled={processing}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingDescription(false)}
                        className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-700">{estimate.incidentDescription || <span className="text-gray-400">No description added</span>}</p>
                )}
              </div>
            )}
          </div>

          {/* E25: Apply Template - only for draft estimates */}
          {estimate.status === 'draft' && templates.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-blue-800">Quick Start with Template</h3>
                  <p className="text-sm text-blue-600">Apply a pre-defined template to add common items</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleApplyTemplate(e.target.value)
                        e.target.value = ''
                      }
                    }}
                    disabled={applyingTemplate}
                    className="px-3 py-2 border border-blue-300 rounded bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a template...</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({(t.itemsTemplate as unknown[]).length} items)
                      </option>
                    ))}
                  </select>
                  {applyingTemplate && (
                    <span className="text-sm text-blue-600">Applying...</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Services Section */}
          <div className="bg-white rounded border max-h-[400px] overflow-y-auto">
            <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white z-10">
              <h3 className="font-medium flex items-center gap-2">
                <Wrench size={18} />
                Services
              </h3>
              {canEdit && (
                <button
                  onClick={() => setShowServiceForm(!showServiceForm)}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <Plus size={16} />
                  Add Service
                </button>
              )}
            </div>

            {showServiceForm && (
              <div className="p-4 bg-gray-50 border-b">
                <form onSubmit={handleAddService} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2">
                    <LinkField
                      value={serviceFormData.serviceTypeId}
                      onChange={(value, option) => handleServiceTypeChange(value, option)}
                      fetchOptions={searchServiceTypes}
                      onCreateNew={(name) => {
                        setPendingServiceTypeName(name)
                        setShowServiceTypeModal(true)
                      }}
                      placeholder="Search service types..."
                      createLabel="Add service type"
                      displayValue={selectedServiceOption?.label || serviceFormData.description || ''}
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      placeholder="Hours"
                      value={serviceFormData.hours}
                      onChange={(e) => setServiceFormData({ ...serviceFormData, hours: e.target.value })}
                      className="w-full px-3 py-2 border rounded text-sm"
                      required
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Rate"
                      value={serviceFormData.rate}
                      onChange={(e) => setServiceFormData({ ...serviceFormData, rate: e.target.value })}
                      className="w-full px-3 py-2 border rounded text-sm"
                      required
                    />
                  </div>
                  <div className="md:col-span-4 flex gap-2">
                    <button
                      type="submit"
                      disabled={processing}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowServiceForm(false)
                        setSelectedServiceOption(null)
                      }}
                      className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            <table className="w-full">
              <caption className="sr-only">Services for estimate</caption>
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600">Service</th>
                  <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Hours</th>
                  <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Rate</th>
                  <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Amount</th>
                  <th scope="col" className="px-4 py-2 text-center text-sm font-medium text-gray-600">Status</th>
                  {showApprovedColumn && <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Approved</th>}
                  {(canEdit || canReviewItems || canReviewUnreviewedOnly) && <th scope="col" className="px-4 py-2 w-10"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {estimate.items.filter(i => i.itemType === 'service').length === 0 ? (
                  <tr>
                    <td colSpan={showApprovedColumn ? 7 : canEdit ? 6 : 5} className="px-4 py-4 text-center text-gray-500">
                      No services added
                    </td>
                  </tr>
                ) : (
                  estimate.items.filter(i => i.itemType === 'service').map((item) => {
                    const pendingUpdate = itemReviewUpdates[item.id]
                    const currentStatus = pendingUpdate?.status || item.status
                    const isUnreviewedItem = item.status === 'requires_reinspection' || item.status === 'pending' || item.status === 'price_adjusted'
                    const canReviewThisItem = canReviewItems || (canReviewUnreviewedOnly && isUnreviewedItem)
                    return (
                    <tr key={item.id} className={`border-t ${canReviewUnreviewedOnly && isUnreviewedItem ? 'bg-purple-50' : ''} ${item.convertedToWorkOrderId ? 'bg-green-50' : ''}`}>
                      <td className="px-4 py-2">
                        <div>
                          <div className="flex items-center gap-2">
                            {item.serviceType?.name || item.description || 'Service'}
                            {item.convertedToWorkOrderId && (
                              <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded">Converted</span>
                            )}
                            {item.conversionSkippedReason && !item.convertedToWorkOrderId && (
                              <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded" title={item.conversionSkippedReason}>Pending</span>
                            )}
                          </div>
                          {item.conversionSkippedReason && !item.convertedToWorkOrderId && (
                            <p className="text-xs text-orange-600 mt-1">{item.conversionSkippedReason}</p>
                          )}
                          {canReviewThisItem && (
                            <div className="mt-1">
                              <input
                                type="text"
                                placeholder={currentStatus === 'rejected' ? "Rejection reason..." : "Assessor notes..."}
                                defaultValue={item.assessorNotes || ''}
                                onChange={(e) => handleItemReviewChange(item.id, 'assessorNotes', e.target.value)}
                                onBlur={() => handleSaveItemReview(item.id)}
                                className={`w-full px-2 py-1 border rounded text-xs ${currentStatus === 'rejected' ? 'border-red-200 bg-red-50' : ''}`}
                              />
                            </div>
                          )}
                          {!canReviewThisItem && item.assessorNotes && (
                            <p className={`text-xs mt-1 ${item.status === 'rejected' ? 'text-red-600' : 'text-blue-600'}`}>
                              {item.status === 'rejected' ? 'Reason' : 'Note'}: {item.assessorNotes}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {canEdit ? (
                          <input
                            key={`hours-${item.id}-${item.hours}`}
                            type="number"
                            step="0.25"
                            min="0"
                            defaultValue={parseFloat(item.hours || '0').toFixed(2)}
                            onBlur={(e) => {
                              if (!isValidPositiveNumber(e.target.value)) {
                                e.target.value = parseFloat(item.hours || '0').toFixed(2)
                                return
                              }
                              const newHours = parseFloat(e.target.value)
                              if (newHours !== parseFloat(item.hours || '0')) {
                                handleUpdateItem(item.id, { hours: newHours, rate: parseFloat(item.rate || '0') })
                              }
                            }}
                            className="w-20 px-2 py-1 border rounded text-right text-sm"
                          />
                        ) : (
                          parseFloat(item.hours || '0').toFixed(2)
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {canEdit ? (
                          <input
                            key={`rate-${item.id}-${item.rate}`}
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={parseFloat(item.rate || '0').toFixed(2)}
                            onBlur={(e) => {
                              if (!isValidPositiveNumber(e.target.value)) {
                                e.target.value = parseFloat(item.rate || '0').toFixed(2)
                                return
                              }
                              const newRate = parseFloat(e.target.value)
                              if (newRate !== parseFloat(item.rate || '0')) {
                                handleUpdateItem(item.id, { hours: parseFloat(item.hours || '0'), rate: newRate })
                              }
                            }}
                            className="w-24 px-2 py-1 border rounded text-right text-sm"
                          />
                        ) : (
                          parseFloat(item.rate || '0').toFixed(2)
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {parseFloat(item.originalAmount).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {canReviewThisItem ? (
                          <select
                            value={currentStatus}
                            onChange={(e) => {
                              const newStatus = e.target.value
                              // Clear approvedAmount when switching to price_adjusted, set to original when approved
                              const approvedAmount = newStatus === 'approved' ? item.originalAmount :
                                                    newStatus === 'price_adjusted' ? '' : undefined
                              handleSaveItemReview(item.id, { status: newStatus, approvedAmount })
                            }}
                            className={`px-2 py-1 text-xs font-medium rounded border ${itemStatusColors[currentStatus]}`}
                          >
                            {canReviewUnreviewedOnly ? (
                              <>
                                <option value="requires_reinspection">Re-inspection</option>
                                <option value="approved">Approved</option>
                                <option value="price_adjusted">Price Adjusted</option>
                                <option value="rejected">Rejected</option>
                              </>
                            ) : (
                              <>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="price_adjusted">Price Adjusted</option>
                                <option value="rejected">Rejected</option>
                                <option value="requires_reinspection">Re-inspection</option>
                              </>
                            )}
                          </select>
                        ) : (
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${itemStatusColors[item.status]}`}>
                            {itemStatusLabels[item.status] || item.status}
                          </span>
                        )}
                      </td>
                      {showApprovedColumn && (
                        <td className="px-4 py-2 text-right min-w-[140px]">
                          {canReviewThisItem && currentStatus === 'price_adjusted' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  key={`markdown-${item.id}-${item.approvedAmount}`}
                                  type="number"
                                  step="1"
                                  min="0"
                                  max="100"
                                  placeholder="0"
                                  autoFocus={!item.approvedAmount}
                                  defaultValue={item.approvedAmount
                                    ? Math.round((1 - parseFloat(item.approvedAmount) / parseFloat(item.originalAmount)) * 100)
                                    : ''
                                  }
                                  onBlur={(e) => {
                                    const markdown = parseFloat(e.target.value) || 0
                                    if (markdown >= 0 && markdown <= 100) {
                                      const newTotal = String(Math.round(parseFloat(item.originalAmount) * (1 - markdown / 100) * 100) / 100)
                                      if (newTotal !== item.originalAmount) {
                                        handleSaveItemReview(item.id, { approvedAmount: newTotal })
                                      }
                                    }
                                  }}
                                  className={`w-12 px-1 py-1 border rounded text-right text-xs ${!item.approvedAmount ? 'border-red-500 bg-red-50' : ''}`}
                                />
                                <span className="text-xs text-gray-500 w-10">% off</span>
                              </div>
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  key={`amount-adj-${item.id}-${item.approvedAmount}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0"
                                  defaultValue={item.approvedAmount || ''}
                                  onBlur={(e) => {
                                    const newTotal = parseFloat(e.target.value) || 0
                                    if (newTotal > 0 && newTotal.toFixed(2) !== item.originalAmount) {
                                      handleSaveItemReview(item.id, { approvedAmount: newTotal.toFixed(2) })
                                    }
                                  }}
                                  className={`w-24 px-1 py-1 border rounded text-right text-xs ${!item.approvedAmount ? 'border-red-500 bg-red-50' : ''}`}
                                />
                                <span className="text-xs text-gray-500">Total</span>
                              </div>
                            </div>
                          )}
                          {(canReviewThisItem && currentStatus === 'approved') || (!canReviewThisItem && ['approved', 'price_adjusted'].includes(item.status)) ? (
                            <div className="text-right">
                              {item.status === 'price_adjusted' && item.approvedAmount && (
                                <span className="text-xs text-orange-600 block">
                                  {Math.round((1 - parseFloat(item.approvedAmount) / parseFloat(item.originalAmount)) * 100)}% off
                                </span>
                              )}
                              <span className="text-green-600 text-sm">{parseFloat(item.approvedAmount || item.originalAmount).toLocaleString()}</span>
                            </div>
                          ) : null}
                        </td>
                      )}
                      {canEdit && (
                        <td className="px-4 py-2">
                          <button
                            onClick={() => setRemoveItemConfirm({ open: true, id: item.id })}
                            aria-label={`Remove ${item.serviceType?.name || 'service'}`}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                      {(canReviewItems || canReviewUnreviewedOnly) && !canEdit && <td className="px-4 py-2"></td>}
                    </tr>
                  )})
                )}
              </tbody>
            </table>
          </div>

          {/* Parts Section */}
          <div className="bg-white rounded border max-h-[400px] overflow-y-auto">
            <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white z-10">
              <div className="flex items-center gap-4">
                <h3 className="font-medium flex items-center gap-2">
                  <FileText size={18} />
                  Parts
                </h3>
                {/* Hold Stock checkbox - only show when editable */}
                {!['work_order_created', 'cancelled'].includes(estimate.status) && (
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={estimate.holdStock}
                      onChange={async (e) => {
                        const newHoldStock = e.target.checked
                        try {
                          const res = await fetch(`/api/insurance-estimates/${estimate.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ holdStock: newHoldStock }),
                          })
                          const data = await res.json()
                          if (!res.ok) {
                            // Show error message from API (e.g., insufficient stock)
                            toast.error(data.error || 'Failed to update stock hold setting')
                            return
                          }
                          setEstimate({ ...estimate, holdStock: newHoldStock })
                          toast.success(newHoldStock ? 'Stock reserved for this estimate' : 'Stock reservation released')
                        } catch {
                          toast.error('Failed to update stock hold setting')
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Reserve Stock</span>
                    <span className="text-gray-400 text-xs" title="When enabled, parts in this estimate will be reserved from available stock">(i)</span>
                  </label>
                )}
              </div>
              {canEdit && (
                <button
                  onClick={() => setShowPartForm(!showPartForm)}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <Plus size={16} />
                  Add Part
                </button>
              )}
            </div>

            {showPartForm && (
              <div className="p-4 bg-gray-50 border-b">
                <form onSubmit={handleAddPart} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2">
                    <LinkField
                      value={partFormData.itemId}
                      onChange={(value, option) => handleItemChange(value, option)}
                      fetchOptions={searchItems}
                      onCreateNew={(name) => {
                        setPendingItemName(name)
                        setShowItemModal(true)
                      }}
                      placeholder="Search parts..."
                      createLabel="Add part/item"
                      displayValue={selectedItemOption?.label || ''}
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      placeholder="Qty"
                      value={partFormData.quantity}
                      onChange={(e) => setPartFormData({ ...partFormData, quantity: e.target.value })}
                      className="w-full px-3 py-2 border rounded text-sm"
                      required
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Unit Price"
                      value={partFormData.unitPrice}
                      onChange={(e) => setPartFormData({ ...partFormData, unitPrice: e.target.value })}
                      className="w-full px-3 py-2 border rounded text-sm"
                      required
                    />
                  </div>
                  <div className="md:col-span-4 flex gap-2">
                    <button
                      type="submit"
                      disabled={processing}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPartForm(false)
                        setSelectedItemOption(null)
                      }}
                      className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            <table className="w-full">
              <caption className="sr-only">Parts for estimate</caption>
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600">Part</th>
                  <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Qty</th>
                  <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Price</th>
                  <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total</th>
                  <th scope="col" className="px-4 py-2 text-center text-sm font-medium text-gray-600">Status</th>
                  {showApprovedColumn && <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Approved</th>}
                  {(canEdit || canReviewItems || canReviewUnreviewedOnly) && <th scope="col" className="px-4 py-2 w-10"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {parts.length === 0 ? (
                  <tr>
                    <td colSpan={showApprovedColumn ? 7 : canEdit ? 6 : 5} className="px-4 py-4 text-center text-gray-500">
                      No parts added
                    </td>
                  </tr>
                ) : (
                  parts.map((item) => {
                    const pendingUpdate = itemReviewUpdates[item.id]
                    const currentStatus = pendingUpdate?.status || item.status
                    const isUnreviewedItem = item.status === 'requires_reinspection' || item.status === 'pending' || item.status === 'price_adjusted'
                    const canReviewThisItem = canReviewItems || (canReviewUnreviewedOnly && isUnreviewedItem)
                    return (
                      <tr key={item.id} className={`border-t ${canReviewUnreviewedOnly && isUnreviewedItem ? 'bg-purple-50' : ''} ${item.convertedToWorkOrderId ? 'bg-green-50' : ''}`}>
                        <td className="px-4 py-2">
                          <div>
                            <div className="flex items-center gap-2">
                              {item.item?.name || item.partName || 'Part'}
                              {item.convertedToWorkOrderId && (
                                <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded">Converted</span>
                              )}
                              {item.conversionSkippedReason && !item.convertedToWorkOrderId && (
                                <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded" title={item.conversionSkippedReason}>Pending</span>
                              )}
                            </div>
                            {item.conversionSkippedReason && !item.convertedToWorkOrderId && (
                              <p className="text-xs text-orange-600 mt-1">{item.conversionSkippedReason}</p>
                            )}
                            {canReviewThisItem && (
                              <div className="mt-1">
                                <input
                                  type="text"
                                  placeholder={currentStatus === 'rejected' ? "Rejection reason..." : "Assessor notes..."}
                                  defaultValue={item.assessorNotes || ''}
                                  onChange={(e) => handleItemReviewChange(item.id, 'assessorNotes', e.target.value)}
                                  onBlur={() => handleSaveItemReview(item.id)}
                                  className={`w-full px-2 py-1 border rounded text-xs ${currentStatus === 'rejected' ? 'border-red-200 bg-red-50' : ''}`}
                                />
                              </div>
                            )}
                            {!canReviewThisItem && item.assessorNotes && (
                              <p className={`text-xs mt-1 ${item.status === 'rejected' ? 'text-red-600' : 'text-blue-600'}`}>
                                {item.status === 'rejected' ? 'Reason' : 'Note'}: {item.assessorNotes}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canEdit ? (
                            <input
                              key={`qty-${item.id}-${item.quantity}`}
                              type="number"
                              step="1"
                              min="1"
                              defaultValue={parseFloat(item.quantity || '0').toFixed(0)}
                              onBlur={(e) => {
                                if (!isValidQuantity(e.target.value)) {
                                  e.target.value = parseFloat(item.quantity || '0').toFixed(0)
                                  return
                                }
                                const newQty = parseFloat(e.target.value)
                                if (newQty !== parseFloat(item.quantity || '0')) {
                                  handleUpdateItem(item.id, { quantity: newQty, unitPrice: parseFloat(item.unitPrice || '0') })
                                }
                              }}
                              className="w-16 px-2 py-1 border rounded text-right text-sm"
                            />
                          ) : (
                            parseFloat(item.quantity || '0').toFixed(0)
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canEdit ? (
                            <input
                              key={`price-${item.id}-${item.unitPrice}`}
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={parseFloat(item.unitPrice || '0').toFixed(2)}
                              onBlur={(e) => {
                                if (!isValidPositiveNumber(e.target.value)) {
                                  e.target.value = parseFloat(item.unitPrice || '0').toFixed(2)
                                  return
                                }
                                const newPrice = parseFloat(e.target.value)
                                if (newPrice !== parseFloat(item.unitPrice || '0')) {
                                  handleUpdateItem(item.id, { quantity: parseFloat(item.quantity || '0'), unitPrice: newPrice })
                                }
                              }}
                              className="w-24 px-2 py-1 border rounded text-right text-sm"
                            />
                          ) : (
                            parseFloat(item.unitPrice || '0').toFixed(2)
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {parseFloat(item.originalAmount).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {canReviewThisItem ? (
                            <select
                              value={currentStatus}
                              onChange={(e) => {
                                const newStatus = e.target.value
                                const approvedAmount = newStatus === 'approved' ? item.originalAmount :
                                                      newStatus === 'price_adjusted' ? '' : undefined
                                handleSaveItemReview(item.id, { status: newStatus, approvedAmount })
                              }}
                              className={`px-2 py-1 text-xs font-medium rounded border ${itemStatusColors[currentStatus]}`}
                            >
                              {canReviewUnreviewedOnly ? (
                                <>
                                  <option value="requires_reinspection">Re-inspection</option>
                                  <option value="approved">Approved</option>
                                  <option value="price_adjusted">Price Adjusted</option>
                                  <option value="rejected">Rejected</option>
                                </>
                              ) : (
                                <>
                                  <option value="pending">Pending</option>
                                  <option value="approved">Approved</option>
                                  <option value="price_adjusted">Price Adjusted</option>
                                  <option value="rejected">Rejected</option>
                                  <option value="requires_reinspection">Re-inspection</option>
                                </>
                              )}
                            </select>
                          ) : (
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${itemStatusColors[item.status]}`}>
                              {itemStatusLabels[item.status] || item.status}
                            </span>
                          )}
                        </td>
                        {showApprovedColumn && (
                          <td className="px-4 py-2 text-right min-w-[140px]">
                            {canReviewThisItem && currentStatus === 'price_adjusted' && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    key={`markdown-part-${item.id}-${item.approvedAmount}`}
                                    type="number"
                                    step="1"
                                    min="0"
                                    max="100"
                                    placeholder="0"
                                    autoFocus={!item.approvedAmount}
                                    defaultValue={item.approvedAmount
                                      ? Math.round((1 - parseFloat(item.approvedAmount) / parseFloat(item.originalAmount)) * 100)
                                      : ''
                                    }
                                    onBlur={(e) => {
                                      const markdown = parseFloat(e.target.value) || 0
                                      if (markdown >= 0 && markdown <= 100) {
                                        const newTotal = String(Math.round(parseFloat(item.originalAmount) * (1 - markdown / 100) * 100) / 100)
                                        if (newTotal !== item.originalAmount) {
                                          handleSaveItemReview(item.id, { approvedAmount: newTotal })
                                        }
                                      }
                                    }}
                                    className={`w-12 px-1 py-1 border rounded text-right text-xs ${!item.approvedAmount ? 'border-red-500 bg-red-50' : ''}`}
                                  />
                                  <span className="text-xs text-gray-500 w-10">% off</span>
                                </div>
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    key={`price-adj-${item.id}-${item.approvedAmount}`}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0"
                                    defaultValue={item.approvedAmount
                                      ? (parseFloat(item.approvedAmount) / parseFloat(item.quantity || '1')).toFixed(2)
                                      : ''
                                    }
                                    onBlur={(e) => {
                                      const newPrice = parseFloat(e.target.value)
                                      const qty = parseFloat(item.quantity || '1')
                                      const newTotal = (newPrice * qty).toFixed(2)
                                      if (newTotal !== item.originalAmount) {
                                        handleSaveItemReview(item.id, { approvedAmount: newTotal })
                                      }
                                    }}
                                    className={`w-20 px-1 py-1 border rounded text-right text-xs ${!item.approvedAmount ? 'border-red-500 bg-red-50' : ''}`}
                                  />
                                  <span className="text-xs text-gray-500 w-6">/ea</span>
                                </div>
                              </div>
                            )}
                            {(canReviewThisItem && currentStatus === 'approved') || (!canReviewThisItem && ['approved', 'price_adjusted'].includes(item.status)) ? (
                              <div className="text-right">
                                {item.status === 'price_adjusted' && item.approvedAmount && (
                                  <span className="text-xs text-orange-600 block">
                                    {Math.round((1 - parseFloat(item.approvedAmount) / parseFloat(item.originalAmount)) * 100)}% off
                                  </span>
                                )}
                                <span className="text-green-600 text-sm">{parseFloat(item.approvedAmount || item.originalAmount).toLocaleString()}</span>
                              </div>
                            ) : null}
                          </td>
                        )}
                        {canEdit && (
                          <td className="px-4 py-2">
                            <button
                              onClick={() => setRemoveItemConfirm({ open: true, id: item.id })}
                              aria-label={`Remove ${item.item?.name || 'part'}`}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                        {(canReviewItems || canReviewUnreviewedOnly) && !canEdit && <td className="px-4 py-2"></td>}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Insurance Remarks - Insurance Only */}
          {isInsuranceEstimate && estimate.insuranceRemarks && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
              <h3 className="font-medium text-yellow-800 mb-2">Insurance Remarks</h3>
              <p className="text-yellow-700 whitespace-pre-wrap">{estimate.insuranceRemarks}</p>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Assessor Details Card - Insurance Only */}
          {isInsuranceEstimate && (
            <div className="bg-white rounded border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium flex items-center gap-2">
                  <User size={16} />
                  Assessor
                </h3>
                {canEditAssessor && !editingAssessor && (
                  <button
                    onClick={() => setEditingAssessor(true)}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    {estimate.assessorName ? 'Edit' : 'Add'}
                  </button>
                )}
              </div>

              {editingAssessor ? (
                <div className="space-y-2">
                  <select
                    value={assessorForm.assessorId}
                    onChange={(e) => handleAssessorSelect(e.target.value)}
                    className="w-full px-2 py-1.5 border rounded text-sm"
                  >
                    <option value="">-- New Assessor --</option>
                    {assessors
                      .filter(a => !estimate.insuranceCompany?.id || a.insuranceCompanyId === estimate.insuranceCompany.id || !a.insuranceCompanyId)
                      .map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))
                    }
                  </select>
                  <input
                    ref={assessorNameInputRef}
                    type="text"
                    value={assessorForm.assessorName}
                    onChange={(e) => setAssessorForm({ ...assessorForm, assessorName: e.target.value })}
                    placeholder="Name *"
                    className="w-full px-2 py-1.5 border rounded text-sm"
                  />
                  <input
                    type="tel"
                    value={assessorForm.assessorPhone}
                    onChange={(e) => setAssessorForm({ ...assessorForm, assessorPhone: e.target.value })}
                    placeholder="Phone"
                    className="w-full px-2 py-1.5 border rounded text-sm"
                  />
                  <input
                    type="email"
                    value={assessorForm.assessorEmail}
                    onChange={(e) => setAssessorForm({ ...assessorForm, assessorEmail: e.target.value })}
                    placeholder="Email"
                    className="w-full px-2 py-1.5 border rounded text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveAssessor}
                      disabled={processing || !assessorForm.assessorName}
                      className="flex-1 px-2 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {assessorForm.assessorId ? 'Save' : 'Save & Create'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingAssessor(false)
                        setAssessorForm({
                          assessorId: estimate.assessorId || '',
                          assessorName: estimate.assessorName || '',
                          assessorPhone: estimate.assessorPhone || '',
                          assessorEmail: estimate.assessorEmail || '',
                        })
                      }}
                      className="px-2 py-1.5 border text-xs rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                estimate.assessorName ? (
                  <div className="text-sm space-y-1">
                    <p className="font-medium flex items-center gap-1">
                      <User size={12} />
                      {estimate.assessorName}
                    </p>
                    {estimate.assessorPhone && (
                      <p className="text-gray-600 flex items-center gap-1">
                        <Phone size={12} />
                        {estimate.assessorPhone}
                      </p>
                    )}
                    {estimate.assessorEmail && (
                      <p className="text-gray-600 flex items-center gap-1">
                        <Mail size={12} />
                        {estimate.assessorEmail}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No assessor assigned</p>
                )
              )}
            </div>
          )}

          {/* Insurance Details Card - Insurance Only */}
          {isInsuranceEstimate && (
            <div className="bg-white rounded border p-4">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <Building2 size={16} />
                Insurance Details
              </h3>
              <div className="space-y-2 text-sm">
                <div>
                  <label className="text-gray-500">Company</label>
                  <p className="font-medium">
                    {estimate.insuranceCompany?.name || <span className="text-gray-400">Not selected</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-gray-500">Policy #</label>
                    <p className="font-medium">{estimate.policyNumber || '-'}</p>
                  </div>
                  <div>
                    <label className="text-gray-500">Claim #</label>
                    <p className="font-medium">{estimate.claimNumber || '-'}</p>
                  </div>
                </div>
                <div>
                  <label className="text-gray-500">Incident Date</label>
                  <p className="font-medium">
                    {estimate.incidentDate ? new Date(estimate.incidentDate).toLocaleDateString() : '-'}
                  </p>
                </div>
                <div>
                  <label className="text-gray-500">Odometer In</label>
                  <p className="font-medium">
                    {estimate.odometerIn ? `${estimate.odometerIn.toLocaleString()} km` : '-'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Estimate Summary */}
          <div className="bg-white rounded border p-4">
            <h3 className="font-medium mb-4">Estimate Summary</h3>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Services ({estimate.items.filter(i => i.itemType === 'service').length})</span>
                <span>LKR {estimate.items.filter(i => i.itemType === 'service').reduce((sum, i) => sum + parseFloat(i.originalAmount), 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Parts ({estimate.items.filter(i => i.itemType === 'part').length})</span>
                <span>LKR {estimate.items.filter(i => i.itemType === 'part').reduce((sum, i) => sum + parseFloat(i.originalAmount), 0).toLocaleString()}</span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between font-medium">
                  <span>Original Total</span>
                  <span>LKR {originalTotal.toLocaleString()}</span>
                </div>
              </div>

              {approvedTotal > 0 && (
                <>
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between text-green-600 font-medium">
                      <span>Approved Total</span>
                      <span>LKR {approvedTotal.toLocaleString()}</span>
                    </div>
                    {variance && (
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-gray-500">Variance</span>
                        <span className={parseFloat(variance) < 0 ? 'text-red-600' : 'text-green-600'}>
                          {parseFloat(variance) > 0 ? '+' : ''}{variance}%
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Item Status Breakdown */}
          {estimate.items.length > 0 && (
            <div className="bg-white rounded border p-4">
              <h3 className="font-medium mb-3">Item Status</h3>
              <div className="space-y-2 text-sm">
                {['pending', 'approved', 'price_adjusted', 'rejected', 'requires_reinspection'].map(status => {
                  const count = estimate.items.filter(i => i.status === status).length
                  if (count === 0) return null
                  return (
                    <div key={status} className="flex justify-between items-center">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${itemStatusColors[status]}`}>
                        {itemStatusLabels[status]}
                      </span>
                      <span className="text-gray-600">{count} item{count !== 1 ? 's' : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* E23: Photo Attachments */}
          <div className="bg-white rounded border">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon size={20} className="text-gray-400" />
                <h3 className="font-medium">Photos & Attachments</h3>
                {attachments.length > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    {attachments.length}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAttachmentBrowser(true)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded cursor-pointer hover:bg-gray-50"
                >
                  <FolderSearch size={16} />
                  Browse Existing
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={handleAttachmentUpload}
                  className="hidden"
                  id="attachment-upload"
                />
                <label
                  htmlFor="attachment-upload"
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm border rounded cursor-pointer hover:bg-gray-50 ${
                    uploadingAttachment ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <Upload size={16} />
                  {uploadingAttachment ? 'Uploading...' : 'Upload'}
                </label>
              </div>
            </div>
            <div className="p-4">
              {attachments.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No attachments yet. Upload photos of damage, documents, or other relevant files.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {attachments.map((attachment, index) => (
                    <div key={attachment.id} className="relative group">
                      <button
                        onClick={() => openViewer(attachments, index)}
                        className="w-full text-left"
                      >
                        {attachment.fileType.startsWith('image/') ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={attachment.filePath}
                            alt={attachment.fileName}
                            className="w-full h-32 object-cover rounded border hover:opacity-90 cursor-pointer"
                          />
                        ) : (
                          <div className="flex items-center justify-center w-full h-32 bg-gray-100 rounded border hover:bg-gray-50 cursor-pointer">
                            <FileText size={32} className="text-gray-400" />
                          </div>
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteAttachmentConfirm({ open: true, id: attachment.id, name: attachment.fileName })}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        title="Delete attachment"
                      >
                        <X size={14} />
                      </button>
                      <p className="mt-1 text-xs text-gray-500 truncate" title={attachment.fileName}>
                        {attachment.fileName}
                      </p>
                      {attachment.category && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                          {attachment.category}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Revision History */}
          {estimate.revisions.length > 0 && (
            <div className="bg-white rounded border">
              <div className="p-4 flex items-center justify-between">
                <button
                  onClick={() => setShowRevisions(!showRevisions)}
                  className="flex items-center gap-2"
                >
                  <h3 className="font-medium">Revision History</h3>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                    {estimate.revisions.length}
                  </span>
                  {showRevisions ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                {/* E24: Compare button */}
                {estimate.revisions.length >= 2 && (
                  <button
                    onClick={() => setShowRevisionComparison(true)}
                    className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded"
                  >
                    Compare Revisions
                  </button>
                )}
              </div>

              {showRevisions && (
                <div className="border-t p-4">
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gray-200" />
                    <div className="space-y-4">
                      {estimate.revisions.map((rev, index) => (
                        <div key={rev.id} className="relative pl-8">
                          {/* Timeline dot */}
                          <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 ${
                            index === 0 ? 'bg-purple-500 border-purple-500' : 'bg-white border-gray-300'
                          }`} />
                          <div className="text-sm">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold ${index === 0 ? 'text-purple-700' : 'text-gray-700'}`}>
                                Rev {rev.revisionNumber}
                              </span>
                              <span className="text-gray-400">•</span>
                              <span className="text-gray-500">
                                {new Date(rev.createdAt).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {rev.changedByUser && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className="text-gray-500 text-xs">by {rev.changedByUser.fullName}</span>
                                </>
                              )}
                            </div>
                            {rev.changeReason && (
                              <p className="text-gray-600 mt-1 bg-gray-50 px-2 py-1 rounded text-xs">
                                {rev.changeReason}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comments & Activity */}
          <DocumentCommentsAndActivity
            documentType="insurance_estimate"
            documentId={estimateId}
            entityType="estimate"
          />
        </div>
      </div>

      {/* Modals */}
      <CancellationReasonModal
        isOpen={showCancellationModal}
        onClose={() => setShowCancellationModal(false)}
        onConfirm={handleCancel}
        title="Cancel Estimate"
        itemName={`Estimate ${estimate.estimateNo}`}
        processing={processing}
        documentType="estimate"
      />

      <ConfirmModal
        isOpen={showConfirmSubmit}
        onClose={() => setShowConfirmSubmit(false)}
        onConfirm={handleSubmit}
        title="Submit Estimate"
        message={`Are you sure you want to submit ${estimate.estimateNo} to ${estimate.insuranceCompany?.name}? This will create a revision snapshot.`}
        confirmText="Submit"
        variant="info"
      />

      <ConfirmModal
        isOpen={showConfirmConvert}
        onClose={() => setShowConfirmConvert(false)}
        onConfirm={handleConvert}
        title={estimate.status === 'work_order_created' ? 'Convert Remaining Items' : 'Convert to Work Order'}
        message={
          estimate.status === 'work_order_created'
            ? `This will create a new work order with remaining unconverted items. If items have insufficient stock, you'll be able to choose partial quantities or skip them.`
            : `This will create a work order with approved items (${estimate.items.filter(i => ['approved', 'price_adjusted'].includes(i.status) && !i.convertedToWorkOrderId).length} items). If items have insufficient stock, you'll be able to choose partial quantities or skip them.`
        }
        confirmText={estimate.status === 'work_order_created' ? 'Convert Remaining' : 'Create Work Order'}
        variant="info"
      />

      <StockAdjustmentModal
        isOpen={showStockAdjustmentModal}
        onClose={() => setShowStockAdjustmentModal(false)}
        onConfirm={handleStockAdjustmentConfirm}
        items={stockIssueItems}
        processing={processing}
      />

      <ConfirmModal
        isOpen={removeItemConfirm.open}
        onClose={() => setRemoveItemConfirm({ open: false, id: null })}
        onConfirm={handleRemoveItem}
        title="Remove Item"
        message="Are you sure you want to remove this item from the estimate?"
        confirmText="Remove"
        variant="danger"
      />

      <ConfirmModal
        isOpen={deleteAttachmentConfirm.open}
        onClose={() => setDeleteAttachmentConfirm({ open: false, id: null, name: '' })}
        onConfirm={performDeleteAttachment}
        title="Delete Attachment"
        message={`Are you sure you want to delete "${deleteAttachmentConfirm.name}"?`}
        confirmText="Delete"
        variant="danger"
      />

      {completeReviewConfirm.status && (
        <ConfirmModal
          isOpen={completeReviewConfirm.open}
          onClose={() => setCompleteReviewConfirm({ open: false, status: '' })}
          onConfirm={() => {
            handleCompleteReview(completeReviewConfirm.status as 'approved' | 'partially_approved' | 'rejected')
            setCompleteReviewConfirm({ open: false, status: '' })
          }}
          title="Complete Review"
          message={`Are you sure you want to complete this review as "${completeReviewConfirm.status.replace('_', ' ')}"?`}
          confirmText="Complete Review"
          variant="warning"
        />
      )}

      <ServiceTypeModal
        isOpen={showServiceTypeModal}
        onClose={() => {
          setShowServiceTypeModal(false)
          setPendingServiceTypeName('')
        }}
        onCreated={(serviceType) => {
          // LinkField auto-refreshes
          setServiceTypes([...serviceTypes, serviceType])
          const option = {
            value: serviceType.id,
            label: serviceType.name,
            data: { defaultHours: serviceType.defaultHours, defaultRate: serviceType.defaultRate }
          }
          handleServiceTypeChange(serviceType.id, option)
        }}
        initialName={pendingServiceTypeName}
      />

      <ItemModal
        isOpen={showItemModal}
        onClose={() => {
          setShowItemModal(false)
          setPendingItemName('')
        }}
        onCreated={(item) => {
          // LinkField auto-refreshes
          fetchItems()
          const option = {
            value: item.id,
            label: item.name,
            data: { sellingPrice: item.sellingPrice }
          }
          handleItemChange(item.id, option)
        }}
        categories={categories}
        onCategoriesUpdated={fetchCategories}
        initialName={pendingItemName}
      />

      {/* Complete Review Modal */}
      <Modal
        isOpen={showCompleteReviewModal}
        onClose={() => {
          setShowCompleteReviewModal(false)
          setReviewRemarks('')
        }}
        title="Complete Insurance Review"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Review the item statuses and select the final outcome for this estimate.
          </p>

          {/* Item Status Summary */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-3">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Item Status Summary</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-green-600 dark:text-green-400">Approved:</span>
                <span className="dark:text-gray-300">{estimate.items.filter(i => i.status === 'approved').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-yellow-600 dark:text-yellow-400">Adjusted:</span>
                <span className="dark:text-gray-300">{estimate.items.filter(i => i.status === 'price_adjusted').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-600 dark:text-red-400">Rejected:</span>
                <span className="dark:text-gray-300">{estimate.items.filter(i => i.status === 'rejected').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-purple-600 dark:text-purple-400">Re-inspection:</span>
                <span className="dark:text-gray-300">{estimate.items.filter(i => i.status === 'requires_reinspection').length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Pending:</span>
                <span className="dark:text-gray-300">{estimate.items.filter(i => i.status === 'pending').length}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Insurance Remarks (Optional)
            </label>
            <textarea
              value={reviewRemarks}
              onChange={(e) => setReviewRemarks(e.target.value)}
              placeholder="Add any remarks from the insurance company..."
              rows={3}
              className="w-full px-3 py-2 border dark:border-gray-700 rounded text-sm dark:bg-gray-800 dark:text-white"
            />
          </div>

          {(() => {
            const hasReinspection = estimate.items.some(i => i.status === 'requires_reinspection')
            const hasPending = estimate.items.some(i => i.status === 'pending')
            const cannotComplete = hasReinspection || hasPending

            if (cannotComplete) {
              return (
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded p-4 text-center">
                  <AlertCircle className="mx-auto text-purple-600 dark:text-purple-400 mb-2" size={24} />
                  <p className="text-purple-800 dark:text-purple-200 font-medium">Cannot Complete Review</p>
                  <p className="text-purple-600 dark:text-purple-400 text-sm mt-1">
                    {hasReinspection && `${estimate.items.filter(i => i.status === 'requires_reinspection').length} item(s) marked for re-inspection. `}
                    {hasPending && `${estimate.items.filter(i => i.status === 'pending').length} item(s) still pending. `}
                    Please review all items before completing.
                  </p>
                </div>
              )
            }
            return null
          })()}
        </div>
        <div className="pt-4 mt-4 border-t dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={() => {
              setShowCompleteReviewModal(false)
              setReviewRemarks('')
            }}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 border dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          {(() => {
            const hasReinspection = estimate.items.some(i => i.status === 'requires_reinspection')
            const hasPending = estimate.items.some(i => i.status === 'pending')
            const cannotComplete = hasReinspection || hasPending
            const allApprovedOrAdjusted = estimate.items.every(i => ['approved', 'price_adjusted'].includes(i.status))
            const hasRejected = estimate.items.some(i => i.status === 'rejected')

            // Determine final status automatically
            const finalStatus = allApprovedOrAdjusted ? 'approved' :
                               hasRejected ? 'partially_approved' : 'rejected'

            if (cannotComplete) return null

            // E2: Show appropriate button text and color based on actual final status
            const buttonConfig = {
              approved: { text: 'Approve All', color: 'bg-green-600 hover:bg-green-700' },
              partially_approved: { text: 'Mark as Partially Approved', color: 'bg-orange-600 hover:bg-orange-700' },
              rejected: { text: 'Reject All', color: 'bg-red-600 hover:bg-red-700' },
            }
            const config = buttonConfig[finalStatus as keyof typeof buttonConfig] || buttonConfig.approved

            return (
              <button
                onClick={() => setCompleteReviewConfirm({ open: true, status: finalStatus })}
                disabled={processing}
                className={`px-4 py-2 text-white rounded disabled:opacity-50 flex items-center gap-2 ${config.color}`}
              >
                <CheckCircle size={18} />
                {processing ? 'Processing...' : config.text}
              </button>
            )
          })()}
        </div>
      </Modal>

      {/* Print Preview */}
      <PrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        documentType="estimate"
        title={`Estimate ${estimate.estimateNo}`}
      >
        <EstimateTemplate
          estimate={{
            estimateNo: estimate.estimateNo,
            estimateType: estimate.estimateType,
            status: estimate.status,
            createdAt: estimate.createdAt,
            incidentDate: estimate.incidentDate,
            incidentDescription: estimate.incidentDescription,
            policyNumber: estimate.policyNumber,
            claimNumber: estimate.claimNumber,
            assessorName: estimate.assessorName,
            insuranceRemarks: estimate.insuranceRemarks,
            originalSubtotal: estimate.originalSubtotal,
            originalTaxAmount: estimate.originalTaxAmount,
            originalTotal: estimate.originalTotal,
            approvedSubtotal: estimate.approvedSubtotal,
            approvedTaxAmount: estimate.approvedTaxAmount,
            approvedTotal: estimate.approvedTotal,
            customer: estimate.customer ? {
              name: estimate.customer.name,
              phone: estimate.customer.phone,
              email: null,
              address: null,
            } : null,
            vehicle: estimate.vehicle ? {
              make: estimate.vehicle.make,
              model: estimate.vehicle.model,
              year: estimate.vehicle.year,
              plateNumber: estimate.vehicle.licensePlate || '',
              color: null,
              vin: null,
            } : null,
            insuranceCompany: estimate.insuranceCompany,
            items: estimate.items.map(item => ({
              id: item.id,
              itemType: item.itemType,
              description: item.description,
              hours: item.hours ? parseFloat(item.hours) : null,
              rate: item.rate,
              partName: item.partName || item.item?.name || null,
              quantity: item.quantity ? parseFloat(item.quantity) : null,
              unitPrice: item.unitPrice,
              originalAmount: item.originalAmount,
              approvedAmount: item.approvedAmount,
              status: item.status,
            })),
          }}
          settings={DEFAULT_PRINT_SETTINGS.estimate}
          businessName="Smart POS"
          currencyCode={currency}
        />
      </PrintPreview>

      {/* E24: Revision Comparison Modal */}
      <RevisionComparisonModal
        isOpen={showRevisionComparison}
        onClose={() => setShowRevisionComparison(false)}
        revisions={estimate.revisions}
        estimateId={estimateId}
      />

      <AttachmentBrowserModal
        isOpen={showAttachmentBrowser}
        onClose={() => setShowAttachmentBrowser(false)}
        estimateId={estimateId}
        onLink={handleLinkAttachments}
      />
    </div>
  )
}

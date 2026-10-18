'use client'

import React, { useState, useEffect, use, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, FileText, Wrench, Package, Car,
  CheckCircle, CreditCard, Banknote, Calendar, Clock, AlertCircle,
  Printer, ClipboardCheck, Save, RotateCcw
} from 'lucide-react'
import { ServiceTypeModal, ItemModal, CancellationReasonModal, CustomerFormModal, VehicleModal } from '@/components/modals'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'
import { InspectionSummaryCard, InspectionModal } from '@/components/inspection'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { LinkFieldOption } from '@/components/ui/link-field'
import { EditableGrid, ColumnDef } from '@/components/ui/editable-grid'
import { FormInput, FormSelect, FormTextarea, FormLabel } from '@/components/ui/form-elements'
import { useRealtimeDataMultiple } from '@/hooks/useRealtimeData'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { AlertModal } from '@/components/ui/alert-modal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { isValidPositiveNumber } from '@/lib/utils/validation'
import { PrintPreview, WorkOrderTemplate } from '@/components/print'
import { DEFAULT_PRINT_SETTINGS } from '@/lib/print/types'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { buildItemSearchOption, formatItemLabel } from '@/lib/utils/item-display'

// ============================================
// TYPES
// ============================================

interface Category {
  id: string
  name: string
}

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
}

interface VehicleType {
  id: string
  name: string
  bodyType: string
  wheelCount: number
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  currentMileage: number | null
  customerId: string | null
  vehicleTypeId: string | null
  vehicleType: VehicleType | null
}

interface VehicleMake {
  id: string
  name: string
}

interface UserInfo {
  id: string
  fullName: string
}

interface Technician {
  id: string
  fullName: string
  role: string
}

interface ServiceType {
  id: string
  name: string
  defaultHours: string | null
  defaultRate: string | null
}

interface WorkOrderService {
  id: string
  serviceTypeId: string | null
  description: string | null
  hours: string
  rate: string
  amount: string
  serviceType: ServiceType | null
  technician: UserInfo | null
}

interface Item {
  id: string
  name: string
  barcode?: string | null
  sku?: string | null
  oemPartNumber?: string | null
  pluCode?: string | null
  sellingPrice: string
  currentStock: string
  reservedStock: string
  availableStock: string
  trackStock?: boolean
}

interface WorkOrderPart {
  id: string
  itemId: string
  quantity: string
  unitPrice: string
  total: string
  coreCharge: string | null
  item: Item | null
}

interface PendingAppointment {
  id: string
  scheduledDate: string
  scheduledTime: string
  durationMinutes: number
  status: string
  notes: string | null
  customer: { id: string; name: string } | null
  serviceType: { id: string; name: string } | null
}

interface Inspection {
  id: string
  inspectionType: 'check_in' | 'check_out'
  status: 'draft' | 'completed'
  fuelLevel: number | null
  odometerReading: string | null
  startedAt: string
  completedAt: string | null
  _count?: {
    responses: number
    damageMarks: number
    photos: number
  }
}

interface ServiceHistoryEntry {
  id: string
  orderNo: string
  status: string
  odometerIn: number | null
  createdAt: string
  completedAt: string | null
  total: string
  services: { id: string; name: string; hours: string; amount: string }[]
  partsCount: number
}

interface WarehouseInfo {
  id: string
  name: string
  code: string
}

interface WorkOrder {
  id: string
  orderNo: string
  status: 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled'
  priority: string
  odometerIn: number | null
  customerComplaint: string | null
  diagnosis: string | null
  subtotal: string
  taxAmount: string
  total: string
  saleId: string | null
  customerId: string | null
  vehicleId: string | null
  warehouseId: string | null
  createdAt: string
  updatedAt: string | null
  customer: Customer | null
  vehicle: Vehicle | null
  warehouse: WarehouseInfo | null
  assignedUser: UserInfo | null
  createdByUser: UserInfo | null
  services: WorkOrderService[]
  parts: WorkOrderPart[]
  cancellationReason: string | null
}

// Grid row types for EditableGrid
interface ServiceGridRow {
  [key: string]: unknown
  id: string
  serviceTypeId: string
  serviceName: string
  technicianId: string
  hours: number
  rate: number
  amount: number
  isNew?: boolean
  isDeleted?: boolean
  isDirty?: boolean
}

interface PartGridRow {
  [key: string]: unknown
  id: string
  itemId: string
  itemName: string
  quantity: number
  unitPrice: number
  total: number
  availableStock: number
  isNew?: boolean
  isDeleted?: boolean
  isDirty?: boolean
}

// ============================================
// CONSTANTS
// ============================================

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-purple-100 text-purple-800',
  completed: 'bg-teal-100 text-teal-800',
  invoiced: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
}

const statusTransitions: Record<string, string[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['cancelled'],
  invoiced: ['cancelled'],
  cancelled: [],
}

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenantSlug, businessType, currency } = useCompany()
  const isCreateMode = id === 'new'

  // ============================================
  // STATE
  // ============================================

  // Core data
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null)
  const [loading, setLoading] = useState(!isCreateMode)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  // Reference data
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [technicians, setTechnicians] = useState<Technician[]>([])

  // Form state for header fields (used in both create and edit)
  const [formData, setFormData] = useState({
    customerId: '',
    vehicleId: '',
    warehouseId: null as string | null,
    priority: 'normal',
    odometerIn: '',
    customerComplaint: '',
    diagnosis: '',
  })

  // Grid data for services and parts
  const [services, setServices] = useState<ServiceGridRow[]>([])
  const [parts, setParts] = useState<PartGridRow[]>([])

  // Original data for dirty tracking (edit mode)
  const [originalFormData, setOriginalFormData] = useState<typeof formData | null>(null)
  const [workOrderUpdatedAt, setWorkOrderUpdatedAt] = useState<string | null>(null)

  // Related data for existing work orders
  const [pendingAppointments, setPendingAppointments] = useState<PendingAppointment[]>([])
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [totalChecklistItems, setTotalChecklistItems] = useState(0)
  const [serviceHistory, setServiceHistory] = useState<ServiceHistoryEntry[]>([])
  const [showServiceHistory, setShowServiceHistory] = useState(false)
  const [linkedEstimate, setLinkedEstimate] = useState<{ id: string; estimateNo: string; status: string } | null>(null)
  const [linkedAppointment, setLinkedAppointment] = useState<{ id: string; scheduledDate: string; scheduledTime: string; status: string } | null>(null)
  const [customerCredit, setCustomerCredit] = useState<number>(0)

  // Modal states
  const [showServiceTypeModal, setShowServiceTypeModal] = useState(false)
  const [pendingServiceTypeName, setPendingServiceTypeName] = useState('')
  const [showItemModal, setShowItemModal] = useState(false)
  const [pendingItemName, setPendingItemName] = useState('')
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [pendingCustomerName, setPendingCustomerName] = useState('')
  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [showStatusConfirm, setShowStatusConfirm] = useState<string | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [estimateAction, setEstimateAction] = useState<'cancel' | 'revert' | ''>('')
  const [appointmentAction, setAppointmentAction] = useState<'cancel' | 'revert' | ''>('')

  // Inspection modal state
  const [inspectionModal, setInspectionModal] = useState<{
    isOpen: boolean
    type: 'check_in' | 'check_out'
    existingId: string | null
  }>({ isOpen: false, type: 'check_in', existingId: null })

  // Confirmation modals
  const [deleteInspectionConfirm, setDeleteInspectionConfirm] = useState<{ open: boolean; id: string | null; type: string }>({ open: false, id: null, type: '' })
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string; variant: 'error' | 'success' | 'warning' | 'info' }>({ open: false, title: '', message: '', variant: 'error' })

  // Payment form state
  const [paymentData, setPaymentData] = useState({
    method: 'cash' as 'cash' | 'card' | 'bank_transfer',
    paidAmount: '',
    creditAmount: '',
    reference: '',
    overpaymentAction: 'return' as 'return' | 'credit',
  })

  // Bulk technician assignment
  const [bulkTechnicianId, setBulkTechnicianId] = useState('')
  const [assigningToAll, setAssigningToAll] = useState(false)

  // ============================================
  // COMPUTED VALUES
  // ============================================

  const canModify = isCreateMode || (workOrder && !['invoiced', 'cancelled'].includes(workOrder.status))
  const allowedTransitions = workOrder ? (statusTransitions[workOrder.status] || []) : []

  // Dirty tracking
  const isHeaderDirty = useMemo(() => {
    if (isCreateMode || !originalFormData) return false
    return (
      formData.customerId !== originalFormData.customerId ||
      formData.vehicleId !== originalFormData.vehicleId ||
      formData.warehouseId !== originalFormData.warehouseId ||
      formData.priority !== originalFormData.priority ||
      formData.odometerIn !== originalFormData.odometerIn ||
      formData.customerComplaint !== originalFormData.customerComplaint ||
      formData.diagnosis !== originalFormData.diagnosis
    )
  }, [isCreateMode, formData, originalFormData])

  const isServicesDirty = useMemo(() => {
    if (isCreateMode) return false
    return services.some(s => s.isDirty || s.isNew || s.isDeleted)
  }, [isCreateMode, services])

  const isPartsDirty = useMemo(() => {
    if (isCreateMode) return false
    return parts.some(p => p.isDirty || p.isNew || p.isDeleted)
  }, [isCreateMode, parts])

  const hasDirtyChanges = isHeaderDirty || isServicesDirty || isPartsDirty

  // Totals calculation
  const totals = useMemo(() => {
    const activeServices = services.filter(s => !s.isDeleted)
    const activeParts = parts.filter(p => !p.isDeleted)
    const servicesTotal = activeServices.reduce((sum, s) => sum + (s.hours * s.rate), 0)
    const partsTotal = activeParts.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0)
    return { servicesTotal, partsTotal, total: servicesTotal + partsTotal }
  }, [services, parts])

  // Filter vehicles by selected customer
  const filteredVehicles = useMemo(() => {
    if (!formData.customerId) return vehicles
    const customerVehicles = vehicles.filter(v => v.customerId === formData.customerId)
    const otherVehicles = vehicles.filter(v => v.customerId !== formData.customerId)
    return [...customerVehicles, ...otherVehicles]
  }, [vehicles, formData.customerId])

  // Filter customers by selected vehicle
  const filteredCustomers = useMemo(() => {
    if (!formData.vehicleId) return customers
    const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId)
    if (!selectedVehicle?.customerId) return customers
    const ownerCustomer = customers.filter(c => c.id === selectedVehicle.customerId)
    const otherCustomers = customers.filter(c => c.id !== selectedVehicle.customerId)
    return [...ownerCustomer, ...otherCustomers]
  }, [customers, vehicles, formData.vehicleId])

  const selectedCustomer = useMemo(() => customers.find(c => c.id === formData.customerId), [customers, formData.customerId])

  // Customer-vehicle mismatch check
  const hasMismatch = useMemo(() => {
    if (!formData.vehicleId || !formData.customerId) return false
    const vehicle = vehicles.find(v => v.id === formData.vehicleId)
    return vehicle?.customerId && vehicle.customerId !== formData.customerId
  }, [vehicles, formData.vehicleId, formData.customerId])

  // Technician options for select
  const technicianOptions = useMemo(() =>
    technicians.map(t => ({ value: t.id, label: t.fullName })),
  [technicians])

  // ============================================
  // GRID COLUMN DEFINITIONS
  // ============================================

  // Search functions for link fields
  const searchServiceTypes = useCallback(async (search: string): Promise<LinkFieldOption[]> => {
    const params = new URLSearchParams({ pageSize: '20' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/service-types?${params}`)
    const result = await res.json()
    const data = result.data || result
    return data.map((s: ServiceType) => ({
      value: s.id,
      label: s.name,
      data: { defaultRate: s.defaultRate, defaultHours: s.defaultHours }
    }))
  }, [])

  const searchItems = useCallback(async (search: string): Promise<LinkFieldOption[]> => {
    const params = new URLSearchParams({ pageSize: '20' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data: Item[] = result.data || result
    return data.map((i) => buildItemSearchOption(i, businessType, { showStock: true }))
  }, [businessType])

  const serviceColumns = useMemo((): ColumnDef<ServiceGridRow>[] => [
    {
      key: 'serviceName',
      label: 'Service Type',
      type: 'link',
      width: '30%',
      fetchOptions: searchServiceTypes,
      placeholder: 'Search services...',
      createLabel: 'Add service type',
      onCreateNew: (name) => {
        setPendingServiceTypeName(name)
        setShowServiceTypeModal(true)
      },
      onChange: (value, _row, _index, option) => {
        // Use option data to populate serviceName and rate
        return {
          serviceTypeId: value as string,
          serviceName: option?.label || '',
          rate: parseFloat(option?.data?.defaultRate as string || '0'),
          hours: parseFloat(option?.data?.defaultHours as string || '1'),
        }
      },
    },
    {
      key: 'technicianId',
      label: 'Technician',
      type: 'select',
      width: '20%',
      options: technicianOptions,
      placeholder: 'Select...',
    },
    {
      key: 'hours',
      label: 'Hours',
      type: 'number',
      width: '12%',
      align: 'right',
      min: 0.25,
      step: 0.25,
      precision: 2,
    },
    {
      key: 'rate',
      label: 'Rate',
      type: 'currency',
      width: '15%',
      align: 'right',
      min: 0,
      step: 0.01,
      precision: 2,
    },
    {
      key: 'amount',
      label: 'Amount',
      type: 'readonly',
      width: '15%',
      align: 'right',
      calculate: (row) => row.hours * row.rate,
    },
  ], [searchServiceTypes, technicianOptions])

  const partColumns = useMemo((): ColumnDef<PartGridRow>[] => [
    {
      key: 'itemName',
      label: 'Item',
      type: 'link',
      width: '30%',
      fetchOptions: searchItems,
      placeholder: 'Search parts...',
      createLabel: 'Add item',
      onCreateNew: (name) => {
        setPendingItemName(name)
        setShowItemModal(true)
      },
      onChange: (value, _row, _index, option) => {
        // Use option data to populate itemName (formatted label) and unitPrice
        const name = option?.data?.name as string || ''
        const barcode = option?.data?.barcode as string || null
        const sku = option?.data?.sku as string || null
        const oemPartNumber = option?.data?.oemPartNumber as string || null
        return {
          itemId: value as string,
          itemName: formatItemLabel({ name, barcode, sku, oemPartNumber }, businessType),
          unitPrice: parseFloat(option?.data?.sellingPrice as string || '0'),
          availableStock: parseFloat(option?.data?.availableStock as string || '0'),
        }
      },
    },
    {
      key: 'quantity',
      label: 'Qty',
      type: 'number',
      width: '10%',
      align: 'right',
      min: 1,
      step: 1,
      precision: 0,
    },
    {
      key: 'unitPrice',
      label: 'Unit Price',
      type: 'currency',
      width: '15%',
      align: 'right',
      min: 0,
      step: 0.01,
      precision: 2,
    },
    {
      key: 'total',
      label: 'Total',
      type: 'readonly',
      width: '15%',
      align: 'right',
      calculate: (row) => row.quantity * row.unitPrice,
    },
    {
      key: 'availableStock',
      label: 'Stock',
      type: 'readonly',
      width: '12%',
      align: 'right',
      render: (value, row) => {
        const stock = typeof value === 'number' ? value : 0
        const lowStock = stock < row.quantity
        return (
          <span className={lowStock ? 'text-red-600 font-medium' : 'text-gray-500'}>
            {stock.toFixed(0)}
          </span>
        )
      },
    },
  ], [searchItems, businessType])

  // ============================================
  // DATA FETCHING
  // ============================================

  const fetchWorkOrder = useCallback(async () => {
    if (isCreateMode) return
    try {
      const res = await fetch(`/api/work-orders/${id}`)
      if (res.ok) {
        const data = await res.json()
        setWorkOrder(data)

        // Populate form data from work order
        const newFormData = {
          customerId: data.customerId || '',
          vehicleId: data.vehicleId || '',
          warehouseId: data.warehouseId || null,
          priority: data.priority || 'normal',
          odometerIn: data.odometerIn?.toString() || '',
          customerComplaint: data.customerComplaint || '',
          diagnosis: data.diagnosis || '',
        }
        setFormData(newFormData)
        setOriginalFormData(newFormData)
        setWorkOrderUpdatedAt(data.updatedAt || null)

        // Convert services to grid rows
        setServices(data.services.map((s: WorkOrderService) => ({
          id: s.id,
          serviceTypeId: s.serviceTypeId || '',
          serviceName: s.serviceType?.name || s.description || 'Custom Service',
          technicianId: s.technician?.id || '',
          hours: parseFloat(s.hours) || 0,
          rate: parseFloat(s.rate) || 0,
          amount: parseFloat(s.amount) || 0,
        })))

        // Convert parts to grid rows
        setParts(data.parts.map((p: WorkOrderPart) => ({
          id: p.id,
          itemId: p.itemId,
          itemName: p.item ? formatItemLabel(p.item, businessType) : 'Unknown Item',
          quantity: parseFloat(p.quantity) || 0,
          unitPrice: parseFloat(p.unitPrice) || 0,
          total: parseFloat(p.total) || 0,
          availableStock: parseFloat(p.item?.availableStock || '0') || 0,
        })))

        // Fetch related data
        if (data.vehicleId) {
          fetchPendingAppointments(data.vehicleId)
        }
        fetchLinkedEstimate()
        fetchLinkedAppointment()
      } else if (res.status === 404) {
        router.push(tenantSlug ? `/c/${tenantSlug}/work-orders` : '/work-orders')
      }
    } catch (error) {
      console.error('Error fetching work order:', error)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPendingAppointments, fetchLinkedEstimate, fetchLinkedAppointment are stable
  }, [id, isCreateMode, router])

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCustomers(data)
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
    }
  }, [])

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicles?all=true')
      if (res.ok) {
        const data = await res.json()
        setVehicles(data)
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error)
    }
  }, [])

  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes')
      if (res.ok) {
        const data = await res.json()
        setMakes(data)
      }
    } catch (error) {
      console.error('Error fetching makes:', error)
    }
  }, [])

  const fetchServiceTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/service-types?all=true')
      if (res.ok) {
        const data = await res.json()
        setServiceTypes(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching service types:', error)
    }
  }, [])

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/items?all=true')
      if (res.ok) {
        const data = await res.json()
        setItems(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching items:', error)
    }
  }, [])

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories?all=true')
      if (res.ok) {
        const data = await res.json()
        setCategories(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }, [])

  const fetchTechnicians = useCallback(async () => {
    try {
      const res = await fetch('/api/users?role=technician&activeOnly=true')
      if (res.ok) {
        const data = await res.json()
        setTechnicians(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching technicians:', error)
    }
  }, [])

  const fetchInspections = useCallback(async () => {
    if (isCreateMode) return
    try {
      const res = await fetch(`/api/work-orders/${id}/inspections`)
      if (res.ok) {
        const data = await res.json()
        setInspections(data)
        if (data.length > 0 && data[0].template?.categories) {
          const total = data[0].template.categories.reduce(
            (sum: number, cat: { items: unknown[] }) => sum + cat.items.length,
            0
          )
          setTotalChecklistItems(total)
        }
      }
    } catch (error) {
      console.error('Error fetching inspections:', error)
    }
  }, [id, isCreateMode])

  const fetchPendingAppointments = useCallback(async (vehicleId: string) => {
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/appointments`)
      if (res.ok) {
        const data = await res.json()
        setPendingAppointments(data)
      }
    } catch (error) {
      console.error('Error fetching pending appointments:', error)
    }
  }, [])

  const fetchLinkedEstimate = useCallback(async () => {
    if (isCreateMode) return
    try {
      const res = await fetch(`/api/insurance-estimates?workOrderId=${id}&all=true`)
      if (res.ok) {
        const data = await res.json()
        if (data.length > 0) {
          setLinkedEstimate({
            id: data[0].id,
            estimateNo: data[0].estimateNo,
            status: data[0].status,
          })
        } else {
          setLinkedEstimate(null)
        }
      }
    } catch (error) {
      console.error('Error fetching linked estimate:', error)
    }
  }, [id, isCreateMode])

  const fetchLinkedAppointment = useCallback(async () => {
    if (isCreateMode) return
    try {
      const res = await fetch(`/api/appointments?workOrderId=${id}&all=true`)
      if (res.ok) {
        const data = await res.json()
        if (data.length > 0) {
          setLinkedAppointment({
            id: data[0].id,
            scheduledDate: data[0].scheduledDate,
            scheduledTime: data[0].scheduledTime,
            status: data[0].status,
          })
        } else {
          setLinkedAppointment(null)
        }
      }
    } catch (error) {
      console.error('Error fetching linked appointment:', error)
    }
  }, [id, isCreateMode])

  const fetchServiceHistory = useCallback(async (vehicleId: string) => {
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/service-history?excludeWorkOrderId=${id}`)
      if (res.ok) {
        const data = await res.json()
        setServiceHistory(data)
      }
    } catch (error) {
      console.error('Error fetching service history:', error)
    }
  }, [id])

  // ============================================
  // EFFECTS
  // ============================================

  useEffect(() => {
    if (isCreateMode) {
      // Create mode: fetch reference data only
      Promise.all([fetchCustomers(), fetchVehicles(), fetchMakes(), fetchServiceTypes(), fetchItems(), fetchCategories(), fetchTechnicians()])
      setLoading(false)
    } else {
      // Edit mode: fetch work order and reference data
      Promise.all([fetchWorkOrder(), fetchServiceTypes(), fetchItems(), fetchCategories(), fetchTechnicians(), fetchInspections(), fetchCustomers(), fetchVehicles(), fetchMakes()])
    }
  }, [isCreateMode, fetchWorkOrder, fetchServiceTypes, fetchItems, fetchCategories, fetchTechnicians, fetchInspections, fetchCustomers, fetchVehicles, fetchMakes])

  // Real-time updates for edit mode
  useRealtimeDataMultiple(
    isCreateMode ? [] : [fetchWorkOrder, fetchItems, fetchServiceTypes, fetchCategories, fetchTechnicians, fetchInspections],
    { entityType: ['work-order', 'item', 'service', 'category'], refreshOnMount: false }
  )

  // ============================================
  // HANDLERS
  // ============================================

  function triggerSaveAnimation() {
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }

  // Form field handlers
  function handleVehicleChange(vehicleId: string) {
    const vehicle = vehicles.find(v => v.id === vehicleId)
    setFormData(prev => ({
      ...prev,
      vehicleId,
      customerId: (!prev.customerId && vehicle?.customerId) ? vehicle.customerId : prev.customerId
    }))
  }

  function handleCustomerChange(customerId: string) {
    setFormData(prev => ({ ...prev, customerId }))
  }

  // Grid row handlers
  function handleServiceAdd(): ServiceGridRow {
    return {
      id: generateTempId(),
      serviceTypeId: '',
      serviceName: '',
      technicianId: '',
      hours: 1,
      rate: 0,
      amount: 0,
      isNew: true,
    }
  }

  function handlePartAdd(): PartGridRow {
    return {
      id: generateTempId(),
      itemId: '',
      itemName: '',
      quantity: 1,
      unitPrice: 0,
      total: 0,
      availableStock: 0,
      isNew: true,
    }
  }

  function handleServiceDelete(row: ServiceGridRow) {
    if (row.id.startsWith('temp-')) {
      setServices(prev => prev.filter(s => s.id !== row.id))
    } else {
      setServices(prev => prev.map(s => s.id === row.id ? { ...s, isDeleted: true } : s))
    }
  }

  function handlePartDelete(row: PartGridRow) {
    if (row.id.startsWith('temp-')) {
      setParts(prev => prev.filter(p => p.id !== row.id))
    } else {
      setParts(prev => prev.map(p => p.id === row.id ? { ...p, isDeleted: true } : p))
    }
  }

  function handleServiceRowChange(row: ServiceGridRow, _rowIndex: number, _field: string, _value: unknown) {
    setServices(prev => prev.map(s => {
      if (s.id !== row.id) return s
      const updated = { ...s, ...row, isDirty: !s.isNew }
      updated.amount = updated.hours * updated.rate
      return updated
    }))
  }

  function handlePartRowChange(row: PartGridRow, _rowIndex: number, _field: string, _value: unknown) {
    setParts(prev => prev.map(p => {
      if (p.id !== row.id) return p
      const updated = { ...p, ...row, isDirty: !p.isNew }
      updated.total = updated.quantity * updated.unitPrice
      return updated
    }))
  }

  // Wrapper onChange handlers that preserve soft-deleted items
  function handleServicesGridChange(newGridData: ServiceGridRow[]) {
    setServices(prev => {
      const deletedItems = prev.filter(s => s.isDeleted)
      return [...newGridData, ...deletedItems]
    })
  }

  function handlePartsGridChange(newGridData: PartGridRow[]) {
    setParts(prev => {
      const deletedItems = prev.filter(p => p.isDeleted)
      return [...newGridData, ...deletedItems]
    })
  }

  // Save handler
  async function handleSave() {
    // Validate required fields
    if (!formData.vehicleId) {
      setAlertModal({ open: true, title: 'Validation Error', message: 'Vehicle is required', variant: 'error' })
      return
    }
    if (!formData.customerId) {
      setAlertModal({ open: true, title: 'Validation Error', message: 'Customer is required', variant: 'error' })
      return
    }
    if (!formData.odometerIn || !isValidPositiveNumber(formData.odometerIn) || parseInt(formData.odometerIn) <= 0) {
      setAlertModal({ open: true, title: 'Validation Error', message: 'Valid odometer reading is required', variant: 'error' })
      return
    }
    if (!formData.warehouseId) {
      setAlertModal({ open: true, title: 'Validation Error', message: 'Warehouse is required', variant: 'error' })
      return
    }

    // Validate stock for parts
    const activeParts = parts.filter(p => !p.isDeleted && p.itemId && p.quantity > 0)
    for (const part of activeParts) {
      if (part.quantity > part.availableStock) {
        setAlertModal({
          open: true,
          title: 'Insufficient Stock',
          message: `Not enough stock for "${part.itemName}". Available: ${part.availableStock.toFixed(0)}`,
          variant: 'warning'
        })
        return
      }
    }

    setSaving(true)

    try {
      if (isCreateMode) {
        // Create new work order
        const servicesPayload = services
          .filter(s => s.serviceTypeId && s.hours > 0)
          .map(s => ({
            serviceTypeId: s.serviceTypeId,
            hours: s.hours,
            rate: s.rate,
            technicianId: s.technicianId || null,
          }))

        const partsPayload = activeParts.map(p => ({
          itemId: p.itemId,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
        }))

        const res = await fetch('/api/work-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: formData.customerId || null,
            vehicleId: formData.vehicleId || null,
            warehouseId: formData.warehouseId || null,
            priority: formData.priority,
            odometerIn: parseInt(formData.odometerIn),
            customerComplaint: formData.customerComplaint || null,
            services: servicesPayload,
            parts: partsPayload,
          }),
        })

        if (res.ok) {
          const newWorkOrder = await res.json()
          router.push(tenantSlug ? `/c/${tenantSlug}/work-orders/${newWorkOrder.id}` : `/work-orders/${newWorkOrder.id}`)
        } else {
          const data = await res.json()
          setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to create work order', variant: 'error' })
        }
      } else {
        // Update existing work order
        // Track latest updatedAt locally to avoid stale closure issues with React state.
        let latestUpdatedAt = workOrderUpdatedAt
        let hasErrors = false

        const extractUpdatedAt = (data: Record<string, unknown>) => {
          if (data?.workOrderUpdatedAt) latestUpdatedAt = data.workOrderUpdatedAt as string
        }

        // 1. Update header if dirty
        if (isHeaderDirty) {
          const res = await fetch(`/api/work-orders/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: formData.customerId || null,
              vehicleId: formData.vehicleId || null,
              warehouseId: formData.warehouseId || null,
              priority: formData.priority,
              odometerIn: parseInt(formData.odometerIn),
              customerComplaint: formData.customerComplaint || null,
              diagnosis: formData.diagnosis || null,
              expectedUpdatedAt: latestUpdatedAt,
            }),
          })

          if (res.status === 409) {
            setAlertModal({ open: true, title: 'Conflict', message: 'Work order was modified by another user. Please refresh.', variant: 'warning' })
            hasErrors = true
          } else if (!res.ok) {
            const data = await res.json()
            setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to update work order', variant: 'error' })
            hasErrors = true
          } else {
            const updated = await res.json()
            latestUpdatedAt = updated.updatedAt
            setWorkOrderUpdatedAt(updated.updatedAt)
            setOriginalFormData({ ...formData })
          }
        }

        if (hasErrors) { setSaving(false); return }

        // 2. Delete services marked for deletion
        const servicesToDelete = services.filter(s => s.isDeleted && !s.id.startsWith('temp-'))
        for (const service of servicesToDelete) {
          const res = await fetch(`/api/work-orders/${id}/services?serviceId=${service.id}`, { method: 'DELETE' })
          if (!res.ok) { hasErrors = true; break }
          const data = await res.json()
          extractUpdatedAt(data)
        }

        if (hasErrors) { setSaving(false); return }

        // 3. Add new services
        const newServices = services.filter(s => s.isNew && s.serviceTypeId && s.hours > 0 && !s.isDeleted)
        for (const service of newServices) {
          const res = await fetch(`/api/work-orders/${id}/services`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serviceTypeId: service.serviceTypeId,
              hours: service.hours,
              rate: service.rate,
              technicianId: service.technicianId || null,
            }),
          })
          if (!res.ok) { hasErrors = true; break }
          const data = await res.json()
          extractUpdatedAt(data)
        }

        if (hasErrors) { setSaving(false); return }

        // 4. Update dirty services
        const dirtyServices = services.filter(s => s.isDirty && !s.isNew && !s.isDeleted)
        for (const service of dirtyServices) {
          const res = await fetch(`/api/work-orders/${id}/services`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serviceId: service.id,
              hours: service.hours,
              rate: service.rate,
              technicianId: service.technicianId || null,
              expectedUpdatedAt: latestUpdatedAt,
            }),
          })
          if (!res.ok) { hasErrors = true; break }
          const data = await res.json()
          extractUpdatedAt(data)
        }

        if (hasErrors) { setSaving(false); return }

        // 5. Delete parts marked for deletion
        const partsToDelete = parts.filter(p => p.isDeleted && !p.id.startsWith('temp-'))
        for (const part of partsToDelete) {
          const res = await fetch(`/api/work-orders/${id}/parts?partId=${part.id}`, { method: 'DELETE' })
          if (!res.ok) { hasErrors = true; break }
          const data = await res.json()
          extractUpdatedAt(data)
        }

        if (hasErrors) { setSaving(false); return }

        // 6. Add new parts
        const newParts = parts.filter(p => p.isNew && p.itemId && p.quantity > 0 && !p.isDeleted)
        for (const part of newParts) {
          const res = await fetch(`/api/work-orders/${id}/parts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              itemId: part.itemId,
              quantity: part.quantity,
              unitPrice: part.unitPrice,
            }),
          })
          if (!res.ok) { hasErrors = true; break }
          const data = await res.json()
          extractUpdatedAt(data)
        }

        if (hasErrors) { setSaving(false); return }

        // 7. Update dirty parts
        const dirtyParts = parts.filter(p => p.isDirty && !p.isNew && !p.isDeleted)
        for (const part of dirtyParts) {
          const res = await fetch(`/api/work-orders/${id}/parts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              partId: part.id,
              quantity: part.quantity,
              unitPrice: part.unitPrice,
              expectedUpdatedAt: latestUpdatedAt,
            }),
          })
          if (!res.ok) { hasErrors = true; break }
          const data = await res.json()
          extractUpdatedAt(data)
        }

        if (!hasErrors) {
          setWorkOrderUpdatedAt(latestUpdatedAt)
          // Clear dirty flags
          setServices(prev => prev.filter(s => !s.isDeleted).map(s => ({ ...s, isDirty: false, isNew: false })))
          setParts(prev => prev.filter(p => !p.isDeleted).map(p => ({ ...p, isDirty: false, isNew: false })))
          fetchWorkOrder()
          fetchItems()
          triggerSaveAnimation()
        }
      }
    } catch (error) {
      console.error('Error saving work order:', error)
      setAlertModal({ open: true, title: 'Error', message: 'Failed to save work order', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  function handleDiscardChanges() {
    if (!workOrder || isCreateMode) return
    // Reset to original values
    if (originalFormData) setFormData(originalFormData)
    setServices(workOrder.services.map(s => ({
      id: s.id,
      serviceTypeId: s.serviceTypeId || '',
      serviceName: s.serviceType?.name || s.description || 'Custom Service',
      technicianId: s.technician?.id || '',
      hours: parseFloat(s.hours) || 0,
      rate: parseFloat(s.rate) || 0,
      amount: parseFloat(s.amount) || 0,
    })))
    setParts(workOrder.parts.map(p => ({
      id: p.id,
      itemId: p.itemId,
      itemName: p.item?.name || 'Unknown Item',
      quantity: parseFloat(p.quantity) || 0,
      unitPrice: parseFloat(p.unitPrice) || 0,
      total: parseFloat(p.total) || 0,
      availableStock: parseFloat(p.item?.availableStock || '0') || 0,
    })))
  }

  // Status update handler
  async function updateStatus(newStatus: string, cancellationReason?: string) {
    if (!workOrder) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'cancelled' && cancellationReason) body.cancellationReason = cancellationReason
      if (newStatus === 'cancelled' && linkedEstimate) body.estimateAction = estimateAction
      if (newStatus === 'cancelled' && linkedAppointment) body.appointmentAction = appointmentAction

      const res = await fetch(`/api/work-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        fetchWorkOrder()
        setShowCancellationModal(false)
        setEstimateAction('')
        setAppointmentAction('')
      }
    } catch (error) {
      console.error('Error updating status:', error)
    } finally {
      setSaving(false)
    }
  }

  // Invoice creation
  async function openPaymentModal() {
    if (!workOrder) return
    let creditBalance = 0
    if (workOrder.customer?.id) {
      try {
        const res = await fetch(`/api/customers/${workOrder.customer.id}/credit`)
        if (res.ok) {
          const data = await res.json()
          creditBalance = parseFloat(data.balance) || 0
        }
      } catch (error) {
        console.error('Error fetching customer credit:', error)
      }
    }
    setCustomerCredit(creditBalance)
    setPaymentData({
      method: 'cash',
      paidAmount: totals.total.toFixed(2),
      creditAmount: '',
      reference: '',
      overpaymentAction: 'return',
    })
    setShowPaymentModal(true)
  }

  async function handleCreateInvoice() {
    if (!workOrder) return
    const paidAmountNum = parseFloat(paymentData.paidAmount) || 0
    const creditAmountNum = parseFloat(paymentData.creditAmount) || 0

    if (paidAmountNum < 0 || creditAmountNum < 0) {
      setAlertModal({ open: true, title: 'Validation Error', message: 'Amounts cannot be negative', variant: 'error' })
      return
    }

    setSaving(true)
    const total = parseFloat(workOrder.total)
    const remainingAfterCredit = Math.max(0, total - creditAmountNum)
    const effectiveCashCardPaid = paymentData.method === 'cash' ? paidAmountNum : Math.min(paidAmountNum, remainingAfterCredit)

    try {
      const res = await fetch(`/api/work-orders/${id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: paymentData.method,
          paidAmount: effectiveCashCardPaid,
          creditAmount: creditAmountNum,
          reference: paymentData.reference || null,
          addOverpaymentToCredit: paymentData.method === 'cash' && paymentData.overpaymentAction === 'credit',
        }),
      })
      if (res.ok) {
        setShowPaymentModal(false)
        fetchWorkOrder()
      } else {
        const error = await res.json()
        setAlertModal({ open: true, title: 'Invoice Error', message: error.error || 'Failed to create invoice', variant: 'error' })
      }
    } catch (error) {
      console.error('Error creating invoice:', error)
      setAlertModal({ open: true, title: 'Invoice Error', message: 'Failed to create invoice', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Inspection handlers
  function openInspectionModal(type: 'check_in' | 'check_out', existingId: string | null = null) {
    setInspectionModal({ isOpen: true, type, existingId })
  }

  function closeInspectionModal() {
    setInspectionModal({ isOpen: false, type: 'check_in', existingId: null })
  }

  async function handleDeleteInspection() {
    if (!deleteInspectionConfirm.id) return
    setSaving(true)
    try {
      const res = await fetch(`/api/work-orders/${id}/inspections/${deleteInspectionConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchInspections()
        triggerSaveAnimation()
      } else {
        const data = await res.json()
        setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to delete inspection', variant: 'error' })
      }
    } catch (error) {
      console.error('Error deleting inspection:', error)
    } finally {
      setSaving(false)
      setDeleteInspectionConfirm({ open: false, id: null, type: '' })
    }
  }

  // Appointment linking
  async function linkAppointmentToWorkOrder(appointmentId: string) {
    if (!workOrder) return
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderId: workOrder.id }),
      })
      if (res.ok) {
        setPendingAppointments(prev => prev.filter(a => a.id !== appointmentId))
      }
    } catch (error) {
      console.error('Error linking appointment:', error)
    }
  }

  // Bulk technician assignment
  async function handleAssignTechnicianToAll() {
    if (!workOrder || !bulkTechnicianId) return
    setAssigningToAll(true)
    try {
      for (const service of workOrder.services) {
        await fetch(`/api/work-orders/${id}/services`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: service.id,
            hours: parseFloat(service.hours),
            rate: parseFloat(service.rate),
            technicianId: bulkTechnicianId,
          }),
        })
      }
      fetchWorkOrder()
      setBulkTechnicianId('')
      triggerSaveAnimation()
    } catch (error) {
      console.error('Error assigning technician:', error)
    } finally {
      setAssigningToAll(false)
    }
  }

  // Customer/Vehicle creation callbacks
  function handleCustomerCreated(customer: { id: string; name: string; phone: string | null }) {
    setCustomers(prev => [...prev, customer as Customer])
    setFormData(prev => ({ ...prev, customerId: customer.id }))
    setShowCustomerModal(false)
    setPendingCustomerName('')
  }

  function handleVehicleCreated(vehicle: { id: string; make: string; model: string; year: number | null; licensePlate: string | null; customerId: string | null }) {
    fetchVehicles()
    setFormData(prev => ({
      ...prev,
      vehicleId: vehicle.id,
      customerId: vehicle.customerId || prev.customerId
    }))
    setShowVehicleModal(false)
  }

  // ============================================
  // RENDER
  // ============================================

  if (loading) {
    return <PageLoading text={isCreateMode ? 'Preparing form...' : 'Loading work order...'} />
  }

  if (!isCreateMode && !workOrder) {
    return <div className="flex items-center justify-center h-64">Work order not found</div>
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Breadcrumb
          items={[
            { label: 'Work Orders', href: '/work-orders' },
            { label: isCreateMode ? 'New Work Order' : (workOrder?.orderNo || 'Loading...') }
          ]}
          className="mb-4"
        />

        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold">
              {isCreateMode ? 'New Work Order' : workOrder?.orderNo}
            </h1>
            {!isCreateMode && workOrder && (
              <p className="text-gray-500 text-sm mt-1">
                Created {new Date(workOrder.createdAt).toLocaleString()}
                {workOrder.createdByUser && ` by ${workOrder.createdByUser.fullName}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!isCreateMode && workOrder && (
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[workOrder.status]}`}>
                {statusLabels[workOrder.status]}
              </span>
            )}
          </div>
        </div>

        {!isCreateMode && workOrder?.status === 'cancelled' && workOrder.cancellationReason && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-sm text-red-700">
              <span className="font-medium">Cancellation Reason:</span> {workOrder.cancellationReason}
            </p>
          </div>
        )}
      </div>

      {/* Pending Appointments Banner */}
      {!isCreateMode && pendingAppointments.length > 0 && workOrder?.status === 'draft' && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-800">
                This vehicle has {pendingAppointments.length} scheduled appointment{pendingAppointments.length !== 1 ? 's' : ''}
              </h3>
              <div className="mt-3 space-y-2">
                {pendingAppointments.map(apt => (
                  <div key={apt.id} className="flex items-center justify-between bg-white p-3 rounded border border-amber-200">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 text-amber-700">
                        <Calendar size={14} />
                        <span className="text-sm font-medium">{new Date(apt.scheduledDate).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1 text-amber-700">
                        <Clock size={14} />
                        <span className="text-sm">{apt.scheduledTime.slice(0, 5)}</span>
                      </div>
                      {apt.serviceType && <span className="text-sm text-gray-600">{apt.serviceType.name}</span>}
                    </div>
                    <button
                      onClick={() => linkAppointmentToWorkOrder(apt.id)}
                      className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700"
                    >
                      Link to This Order
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions Bar */}
      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h3 className="text-sm font-medium text-gray-600 mb-2">Actions</h3>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Save button */}
          {canModify && (
            <button
              onClick={handleSave}
              disabled={saving || (!isCreateMode && !hasDirtyChanges)}
              className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all duration-300 ${
                saving ? 'bg-blue-100 text-blue-700' :
                justSaved ? 'bg-green-500 text-white scale-105 shadow-lg' :
                isCreateMode ? 'bg-blue-600 text-white hover:bg-blue-700' :
                hasDirtyChanges ? 'bg-amber-600 text-white hover:bg-amber-700' :
                'bg-green-100 text-green-700'
              } disabled:opacity-50`}
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  {isCreateMode ? 'Creating...' : 'Saving...'}
                </>
              ) : justSaved ? (
                <>
                  <CheckCircle size={16} className="animate-bounce" />
                  Saved!
                </>
              ) : isCreateMode ? (
                <>
                  <Save size={16} />
                  Create Work Order
                </>
              ) : hasDirtyChanges ? (
                <>
                  <Save size={16} />
                  Save Changes
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  All Saved
                </>
              )}
            </button>
          )}

          {/* Discard button (edit mode with changes) */}
          {!isCreateMode && hasDirtyChanges && (
            <button
              onClick={handleDiscardChanges}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
            >
              <RotateCcw size={14} />
              Discard
            </button>
          )}

          {/* Create Invoice button */}
          {!isCreateMode && workOrder && ['draft', 'confirmed', 'in_progress', 'completed'].includes(workOrder.status) && (
            <button
              onClick={openPaymentModal}
              disabled={saving || (workOrder.services.length === 0 && workOrder.parts.length === 0)}
              className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Create Invoice
            </button>
          )}

          {/* Status transitions */}
          {!isCreateMode && allowedTransitions.map((status) => (
            <button
              key={status}
              onClick={() => status === 'cancelled' ? setShowCancellationModal(true) : setShowStatusConfirm(status)}
              disabled={saving}
              className={`px-4 py-2 rounded text-sm font-medium disabled:opacity-50 ${
                status === 'cancelled' ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {status === 'cancelled' ? 'Cancel' : statusLabels[status] || status}
            </button>
          ))}

          {/* Print button */}
          {!isCreateMode && (
            <button
              onClick={() => setShowPrintPreview(true)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
            >
              <Printer size={16} />
              Print
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Vehicle Info - Primary */}
          <div className="bg-white rounded border p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-blue-100 rounded">
                <Car size={20} className="text-blue-600" />
              </div>
              <h3 className="font-semibold text-lg">Vehicle</h3>
            </div>
            {canModify ? (
              <CreatableSelect
                options={filteredVehicles.map(v => ({
                  value: v.id,
                  label: `${v.licensePlate ? `[${v.licensePlate}] ` : ''}${v.year ? `${v.year} ` : ''}${v.make} ${v.model}`
                }))}
                value={formData.vehicleId}
                onChange={handleVehicleChange}
                onCreateNew={() => setShowVehicleModal(true)}
                placeholder="Search or select vehicle..."
                createLabel="Add new vehicle"
              />
            ) : (
              <p className="text-lg font-medium">
                {workOrder?.vehicle ? (
                  <>
                    {workOrder.vehicle.licensePlate && <span className="text-blue-600 font-bold">[{workOrder.vehicle.licensePlate}]</span>}{' '}
                    {workOrder.vehicle.year ? `${workOrder.vehicle.year} ` : ''}
                    {workOrder.vehicle.make} {workOrder.vehicle.model}
                  </>
                ) : 'No vehicle'}
              </p>
            )}
          </div>

          {/* Customer & Other Details */}
          <div className="bg-white rounded border p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <FormLabel required>Customer</FormLabel>
                {canModify ? (
                  <CreatableSelect
                    options={filteredCustomers.map(c => ({ value: c.id, label: c.name }))}
                    value={formData.customerId}
                    onChange={handleCustomerChange}
                    onCreateNew={(name) => { setPendingCustomerName(name); setShowCustomerModal(true) }}
                    placeholder="Search or select customer..."
                    createLabel="Add new customer"
                  />
                ) : (
                  <p className="font-medium">{workOrder?.customer?.name || 'No customer'}</p>
                )}
                {selectedCustomer && (
                  <p className="text-xs text-gray-500 mt-1">{selectedCustomer.phone || 'No phone'}</p>
                )}
              </div>

              <div>
                <FormLabel required>Odometer In (km)</FormLabel>
                {canModify ? (
                  <FormInput
                    type="number"
                    min="1"
                    value={formData.odometerIn}
                    onChange={(e) => setFormData(prev => ({ ...prev, odometerIn: e.target.value }))}
                    placeholder="Enter odometer reading"
                  />
                ) : (
                  <p className="font-medium">{workOrder?.odometerIn?.toLocaleString() || '-'}</p>
                )}
              </div>

              <div>
                <FormLabel>Priority</FormLabel>
                {canModify ? (
                  <FormSelect
                    value={formData.priority}
                    onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
                  >
                    {priorityOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </FormSelect>
                ) : (
                  <p className="font-medium capitalize">{workOrder?.priority || 'normal'}</p>
                )}
              </div>

              {/* Warehouse only shown in create mode */}
              {isCreateMode && (
                <div>
                  <FormLabel required>Warehouse</FormLabel>
                  <WarehouseSelector
                    value={formData.warehouseId}
                    onChange={(newId) => setFormData(prev => ({ ...prev, warehouseId: newId }))}
                    userOnly={false}
                    placeholder="Select warehouse"
                    className="w-full"
                    required={true}
                  />
                </div>
              )}
            </div>

            {hasMismatch && (
              <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700 flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>The selected vehicle belongs to a different customer.</span>
              </div>
            )}

            {/* Notes Section */}
            <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FormLabel>Customer Complaint</FormLabel>
                {canModify ? (
                  <FormTextarea
                    value={formData.customerComplaint}
                    onChange={(e) => setFormData(prev => ({ ...prev, customerComplaint: e.target.value }))}
                    rows={3}
                    placeholder="Describe the customer's complaint..."
                  />
                ) : (
                  <p className="text-gray-700">{workOrder?.customerComplaint || <span className="text-gray-400">No complaint recorded</span>}</p>
                )}
              </div>
              <div>
                <FormLabel>Diagnosis</FormLabel>
                {canModify ? (
                  <FormTextarea
                    value={formData.diagnosis}
                    onChange={(e) => setFormData(prev => ({ ...prev, diagnosis: e.target.value }))}
                    rows={3}
                    placeholder="Enter diagnosis..."
                  />
                ) : (
                  <p className="text-gray-700">{workOrder?.diagnosis || <span className="text-gray-400">No diagnosis added</span>}</p>
                )}
              </div>
            </div>

            {/* Linked Documents */}
            {!isCreateMode && (linkedEstimate || linkedAppointment) && (
              <div className="mt-4 pt-4 border-t">
                <h3 className="text-sm font-medium text-gray-500 mb-3">Linked Documents</h3>
                <div className="space-y-2">
                  {linkedEstimate && (
                    <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-purple-600" />
                        <span className="text-sm font-medium text-purple-800">Insurance Estimate</span>
                        <span className="text-purple-600">{linkedEstimate.estimateNo}</span>
                      </div>
                      <Link href={tenantSlug ? `/c/${tenantSlug}/insurance-estimates/${linkedEstimate.id}` : `/insurance-estimates/${linkedEstimate.id}`} className="text-xs text-purple-600 hover:underline">
                        View Estimate
                      </Link>
                    </div>
                  )}
                  {linkedAppointment && (
                    <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-200 rounded">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-indigo-600" />
                        <span className="text-sm font-medium text-indigo-800">Appointment</span>
                        <span className="text-indigo-600">{linkedAppointment.scheduledDate} at {linkedAppointment.scheduledTime}</span>
                      </div>
                      <Link href={tenantSlug ? `/c/${tenantSlug}/appointments?date=${linkedAppointment.scheduledDate}` : `/appointments?date=${linkedAppointment.scheduledDate}`} className="text-xs text-indigo-600 hover:underline">
                        View Appointments
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Inspections Section (edit mode only) */}
          {!isCreateMode && formData.vehicleId && (
            <div className="bg-white rounded border p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-medium flex items-center gap-2">
                  <ClipboardCheck size={18} />
                  Vehicle Inspections
                </h3>
              </div>
              {inspections.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">No inspections yet.</p>
                  {canModify && (
                    <button
                      onClick={() => openInspectionModal('check_in')}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      <Plus size={16} />
                      Start Check-in Inspection
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {inspections.map((inspection) => (
                      <InspectionSummaryCard
                        key={inspection.id}
                        inspection={inspection}
                        workOrderId={workOrder!.id}
                        totalChecklistItems={totalChecklistItems}
                        canModify={canModify || false}
                        onView={() => openInspectionModal(inspection.inspectionType, inspection.id)}
                        onEdit={() => openInspectionModal(inspection.inspectionType, inspection.id)}
                        onDelete={() => setDeleteInspectionConfirm({ open: true, id: inspection.id, type: inspection.inspectionType === 'check_in' ? 'Check-in' : 'Check-out' })}
                      />
                    ))}
                  </div>
                  {canModify && inspections.some(i => i.inspectionType === 'check_in' && i.status === 'completed') && !inspections.some(i => i.inspectionType === 'check_out') && (
                    <button
                      onClick={() => openInspectionModal('check_out')}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      <Plus size={16} />
                      Start Check-out Inspection
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Service History (edit mode only) */}
          {!isCreateMode && formData.vehicleId && (
            <div className="bg-white rounded border">
              <button
                onClick={() => {
                  if (!showServiceHistory && serviceHistory.length === 0) {
                    fetchServiceHistory(formData.vehicleId)
                  }
                  setShowServiceHistory(!showServiceHistory)
                }}
                className="w-full p-4 flex justify-between items-center hover:bg-gray-50"
              >
                <h3 className="font-medium flex items-center gap-2">
                  <Clock size={18} />
                  Vehicle Service History
                </h3>
                <span className="text-sm text-gray-500">{showServiceHistory ? 'Hide' : 'Show'}</span>
              </button>
              {showServiceHistory && (
                <div className="border-t p-4">
                  {serviceHistory.length === 0 ? (
                    <p className="text-sm text-gray-500">No previous service records.</p>
                  ) : (
                    <div className="space-y-3">
                      {serviceHistory.map((entry) => (
                        <Link key={entry.id} href={tenantSlug ? `/c/${tenantSlug}/work-orders/${entry.id}` : `/work-orders/${entry.id}`} className="block p-3 border rounded hover:bg-gray-50">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-medium text-blue-600">{entry.orderNo}</span>
                            <span className={`text-xs px-2 py-1 rounded ${
                              entry.status === 'invoiced' ? 'bg-green-100 text-green-700' :
                              entry.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>{entry.status}</span>
                          </div>
                          <div className="text-sm text-gray-600">
                            {new Date(entry.createdAt).toLocaleDateString()}
                            {entry.odometerIn && ` - ${entry.odometerIn.toLocaleString()} km`}
                            {` - LKR ${parseFloat(entry.total).toLocaleString()}`}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Services Grid */}
          <div className="bg-white rounded border">
            <div className="p-4 border-b flex flex-wrap justify-between items-center gap-3">
              <h3 className="font-medium flex items-center gap-2">
                <Wrench size={18} />
                Services
              </h3>
              {!isCreateMode && canModify && services.filter(s => !s.isDeleted).length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={bulkTechnicianId}
                    onChange={(e) => setBulkTechnicianId(e.target.value)}
                    className="px-2 py-1 text-sm border rounded"
                    disabled={assigningToAll}
                  >
                    <option value="">Select Technician</option>
                    {technicians.map(tech => (
                      <option key={tech.id} value={tech.id}>{tech.fullName}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAssignTechnicianToAll}
                    disabled={!bulkTechnicianId || assigningToAll}
                    className="px-2 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
                  >
                    {assigningToAll ? 'Assigning...' : 'Assign to All'}
                  </button>
                </div>
              )}
            </div>
            <EditableGrid
              columns={serviceColumns}
              data={services.filter(s => !s.isDeleted)}
              onChange={handleServicesGridChange}
              onRowAdd={handleServiceAdd}
              onRowDelete={handleServiceDelete}
              onRowChange={handleServiceRowChange}
              showRowNumbers
              showDeleteButton={canModify || false}
              showAddButton={canModify || false}
              addButtonLabel="Add Service"
              emptyMessage="No services added"
              maxHeight="350px"
              footerTotals={[{ key: 'serviceName', label: 'Total:' }, { key: 'amount' }]}
              highlightNewRows
              disabled={!canModify}
            />
          </div>

          {/* Parts Grid */}
          <div className="bg-white rounded border">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-medium flex items-center gap-2">
                <Package size={18} />
                Parts
              </h3>
            </div>
            <EditableGrid
              columns={partColumns}
              data={parts.filter(p => !p.isDeleted)}
              onChange={handlePartsGridChange}
              onRowAdd={handlePartAdd}
              onRowDelete={handlePartDelete}
              onRowChange={handlePartRowChange}
              showRowNumbers
              showDeleteButton={canModify || false}
              showAddButton={canModify || false}
              addButtonLabel="Add Part"
              emptyMessage="No parts added"
              maxHeight="350px"
              footerTotals={[{ key: 'itemName', label: 'Total:' }, { key: 'total' }]}
              highlightNewRows
              disabled={!canModify}
              businessType={businessType}
            />
          </div>
        </div>

        {/* Right Column - Summary */}
        <div className="space-y-6">
          <div className="bg-white rounded border p-4">
            <h3 className="font-medium mb-4 flex items-center gap-2">
              <FileText size={18} />
              Order Summary
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Services</span>
                <span>{totals.servicesTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Parts</span>
                <span>{totals.partsTotal.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>{totals.total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {!isCreateMode && workOrder && (
            <div className="bg-white rounded border p-4">
              <h3 className="font-medium mb-3">Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Priority</span>
                  <span className="capitalize">{workOrder.priority}</span>
                </div>
                {workOrder.assignedUser && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Assigned To</span>
                    <span>{workOrder.assignedUser.fullName}</span>
                  </div>
                )}
                {workOrder.saleId && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Invoice</span>
                    <Link href={tenantSlug ? `/c/${tenantSlug}/sales` : '/sales'} className="text-blue-600 hover:underline">View Invoice</Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isCreateMode && (
            <DocumentCommentsAndActivity
              documentType="work_order"
              documentId={id}
              entityType="work-order"
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <ServiceTypeModal
        isOpen={showServiceTypeModal}
        onClose={() => { setShowServiceTypeModal(false); setPendingServiceTypeName('') }}
        onCreated={(serviceType) => {
          setServiceTypes([...serviceTypes, serviceType])
        }}
        initialName={pendingServiceTypeName}
      />

      <ItemModal
        isOpen={showItemModal}
        onClose={() => { setShowItemModal(false); setPendingItemName('') }}
        onCreated={() => { fetchItems() }}
        categories={categories}
        onCategoriesUpdated={fetchCategories}
        initialName={pendingItemName}
      />

      <CustomerFormModal
        isOpen={showCustomerModal}
        onClose={() => { setShowCustomerModal(false); setPendingCustomerName('') }}
        onSaved={handleCustomerCreated}
        initialName={pendingCustomerName}
      />

      <VehicleModal
        isOpen={showVehicleModal}
        onClose={() => setShowVehicleModal(false)}
        onCreated={handleVehicleCreated}
        customers={customers}
        makes={makes}
        onMakesUpdated={fetchMakes}
        onCustomersUpdated={fetchCustomers}
        selectedCustomerId={formData.customerId}
      />

      <ConfirmModal
        isOpen={!!showStatusConfirm}
        onClose={() => setShowStatusConfirm(null)}
        onConfirm={() => { const s = showStatusConfirm; setShowStatusConfirm(null); if (s) updateStatus(s) }}
        title={`${statusLabels[showStatusConfirm || ''] || 'Update'} Work Order`}
        message={`Are you sure you want to change the status of Work Order ${workOrder?.orderNo || ''} to "${statusLabels[showStatusConfirm || ''] || showStatusConfirm}"?`}
        confirmText={statusLabels[showStatusConfirm || ''] || 'Confirm'}
        variant="info"
        processing={saving}
      />

      <CancellationReasonModal
        isOpen={showCancellationModal}
        onClose={() => { setShowCancellationModal(false); setEstimateAction(''); setAppointmentAction('') }}
        onConfirm={(reason) => updateStatus('cancelled', reason)}
        title="Cancel Work Order"
        itemName={workOrder ? `Work Order ${workOrder.orderNo}` : undefined}
        processing={saving}
        documentType="work_order"
        warningMessage={workOrder?.status === 'invoiced' ? 'This work order has been invoiced. Cancelling will void the invoice.' : undefined}
        confirmDisabled={Boolean((linkedEstimate && !estimateAction) || (linkedAppointment && !appointmentAction))}
      >
        {linkedEstimate && (
          <div className="p-3 bg-purple-50 border border-purple-200 rounded">
            <p className="text-purple-800 text-sm font-medium mb-3">
              Linked to estimate <span className="font-bold">{linkedEstimate.estimateNo}</span>. What should happen to it? <span className="text-red-600">*</span>
            </p>
            <div className="space-y-2">
              <label className="flex items-start gap-2 p-2 rounded border cursor-pointer hover:bg-purple-100">
                <input type="radio" name="estimateAction" value="revert" checked={estimateAction === 'revert'} onChange={() => setEstimateAction('revert')} className="mt-1" />
                <div>
                  <span className="font-medium text-purple-800">Revert to Approved</span>
                  <p className="text-xs text-purple-600">Estimate can be converted to a new work order</p>
                </div>
              </label>
              <label className="flex items-start gap-2 p-2 rounded border cursor-pointer hover:bg-purple-100">
                <input type="radio" name="estimateAction" value="cancel" checked={estimateAction === 'cancel'} onChange={() => setEstimateAction('cancel')} className="mt-1" />
                <div>
                  <span className="font-medium text-purple-800">Also Cancel Estimate</span>
                  <p className="text-xs text-purple-600">Both will be cancelled</p>
                </div>
              </label>
            </div>
          </div>
        )}
        {linkedAppointment && (
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded">
            <p className="text-indigo-800 text-sm font-medium mb-3">
              Linked to appointment on <span className="font-bold">{linkedAppointment.scheduledDate}</span>. What should happen to it? <span className="text-red-600">*</span>
            </p>
            <div className="space-y-2">
              <label className="flex items-start gap-2 p-2 rounded border cursor-pointer hover:bg-indigo-100">
                <input type="radio" name="appointmentAction" value="revert" checked={appointmentAction === 'revert'} onChange={() => setAppointmentAction('revert')} className="mt-1" />
                <div>
                  <span className="font-medium text-indigo-800">Revert to Scheduled</span>
                  <p className="text-xs text-indigo-600">Appointment can be converted to a new work order</p>
                </div>
              </label>
              <label className="flex items-start gap-2 p-2 rounded border cursor-pointer hover:bg-indigo-100">
                <input type="radio" name="appointmentAction" value="cancel" checked={appointmentAction === 'cancel'} onChange={() => setAppointmentAction('cancel')} className="mt-1" />
                <div>
                  <span className="font-medium text-indigo-800">Also Cancel Appointment</span>
                  <p className="text-xs text-indigo-600">Both will be cancelled</p>
                </div>
              </label>
            </div>
          </div>
        )}
      </CancellationReasonModal>

      {/* Payment Modal */}
      {showPaymentModal && workOrder && (() => {
        const total = parseFloat(workOrder.total)
        const creditUsed = parseFloat(paymentData.creditAmount || '0')
        const remainingAfterCredit = Math.max(0, total - creditUsed)
        const maxCardAmount = remainingAfterCredit
        const cashCardPaid = parseFloat(paymentData.paidAmount || '0')
        const effectiveCashCardPaid = paymentData.method === 'cash' ? cashCardPaid : Math.min(cashCardPaid, maxCardAmount)
        const totalPaid = effectiveCashCardPaid + creditUsed
        const overpayment = paymentData.method === 'cash' ? Math.max(0, totalPaid - total) : 0
        const balanceDue = Math.max(0, total - totalPaid)

        return (
          <Modal isOpen={true} onClose={() => setShowPaymentModal(false)} title="Create Invoice & Payment" size="md">
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="bg-gray-50 rounded p-3">
                <div className="flex justify-between text-sm">
                  <span>Order No:</span>
                  <span className="font-medium">{workOrder.orderNo}</span>
                </div>
                {workOrder.customer && (
                  <div className="flex justify-between text-sm">
                    <span>Customer:</span>
                    <span className="font-medium">{workOrder.customer.name}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold mt-2">
                  <span>Total:</span>
                  <span>LKR {total.toFixed(2)}</span>
                </div>
              </div>

              {workOrder.customer && customerCredit > 0 && (
                <div className="bg-green-50 border border-green-200 rounded p-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-sm font-medium text-green-800">Customer Credit Available</div>
                      <div className="text-lg font-bold text-green-700">LKR {customerCredit.toFixed(2)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const useAmount = Math.min(customerCredit, total)
                        const remaining = total - useAmount
                        setPaymentData({
                          ...paymentData,
                          creditAmount: useAmount.toFixed(2),
                          paidAmount: remaining > 0 ? remaining.toFixed(2) : '0',
                        })
                      }}
                      className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Use Credit
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {['cash', 'card', 'bank_transfer'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentData({ ...paymentData, method: method as 'cash' | 'card' | 'bank_transfer' })}
                      className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                        paymentData.method === method
                          ? method === 'cash' ? 'border-green-500 bg-green-50 text-green-700' :
                            method === 'card' ? 'border-blue-500 bg-blue-50 text-blue-700' :
                            'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {method === 'cash' ? <Banknote size={24} /> : method === 'card' ? <CreditCard size={24} /> : <FileText size={24} />}
                      <span className="text-sm font-medium capitalize">{method.replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentData.paidAmount}
                  onChange={(e) => setPaymentData({ ...paymentData, paidAmount: e.target.value })}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                />
              </div>

              <div className="bg-gray-50 rounded p-3 space-y-1">
                <div className="text-sm font-medium text-gray-600 mb-2">Payment Summary</div>
                {creditUsed > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Credit Used:</span>
                    <span className="text-green-600">LKR {creditUsed.toFixed(2)}</span>
                  </div>
                )}
                {effectiveCashCardPaid > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>{paymentData.method === 'cash' ? 'Cash' : paymentData.method === 'card' ? 'Card' : 'Transfer'}:</span>
                    <span>LKR {effectiveCashCardPaid.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium border-t pt-1 mt-1">
                  <span>Total Paid:</span>
                  <span>LKR {totalPaid.toFixed(2)}</span>
                </div>
              </div>

              {balanceDue > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
                  <span className="text-yellow-800">Balance due: <strong>LKR {balanceDue.toFixed(2)}</strong></span>
                </div>
              )}

              {overpayment > 0 && paymentData.method === 'cash' && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <div className="text-sm text-blue-800 mb-2">Overpayment: <strong>LKR {overpayment.toFixed(2)}</strong></div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentData({ ...paymentData, overpaymentAction: 'return' })}
                      className={`flex-1 py-2 px-3 rounded text-sm font-medium ${
                        paymentData.overpaymentAction === 'return' ? 'bg-blue-600 text-white' : 'bg-white border border-blue-300 text-blue-700'
                      }`}
                    >
                      Return as Change
                    </button>
                    {workOrder.customer && (
                      <button
                        type="button"
                        onClick={() => setPaymentData({ ...paymentData, overpaymentAction: 'credit' })}
                        className={`flex-1 py-2 px-3 rounded text-sm font-medium ${
                          paymentData.overpaymentAction === 'credit' ? 'bg-green-600 text-white' : 'bg-white border border-green-300 text-green-700'
                        }`}
                      >
                        Add to Credit
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4 mt-4 border-t">
              <button
                onClick={() => setShowPaymentModal(false)}
                disabled={saving}
                className="flex-1 px-4 py-2 border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateInvoice}
                disabled={saving}
                className={`flex-1 px-4 py-3 text-white rounded font-medium disabled:opacity-50 ${
                  balanceDue > 0 ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {saving ? 'Creating...' : balanceDue > 0 ? `Create Invoice (Balance: LKR ${balanceDue.toFixed(2)})` : 'Create Invoice'}
              </button>
            </div>
          </Modal>
        )
      })()}

      <ConfirmModal
        isOpen={deleteInspectionConfirm.open}
        onClose={() => setDeleteInspectionConfirm({ open: false, id: null, type: '' })}
        onConfirm={handleDeleteInspection}
        title="Delete Inspection"
        message={`Are you sure you want to delete this ${deleteInspectionConfirm.type} Inspection? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      <AlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal({ ...alertModal, open: false })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />

      {/* Inspection Modal */}
      {!isCreateMode && workOrder && (
        <InspectionModal
          isOpen={inspectionModal.isOpen}
          onClose={closeInspectionModal}
          workOrder={{
            id: workOrder.id,
            orderNo: workOrder.orderNo,
            status: workOrder.status,
            vehicleId: workOrder.vehicleId,
            vehicle: workOrder.vehicle ? {
              id: workOrder.vehicle.id,
              make: workOrder.vehicle.make,
              model: workOrder.vehicle.model,
              year: workOrder.vehicle.year,
              licensePlate: workOrder.vehicle.licensePlate,
              vehicleTypeId: workOrder.vehicle.vehicleTypeId,
              vehicleType: workOrder.vehicle.vehicleType
            } : null
          }}
          inspectionType={inspectionModal.type}
          existingInspectionId={inspectionModal.existingId}
          onInspectionChange={fetchInspections}
        />
      )}

      {/* Print Preview */}
      {!isCreateMode && workOrder && (
        <PrintPreview
          isOpen={showPrintPreview}
          onClose={() => setShowPrintPreview(false)}
          documentType="work_order"
          title={`Work Order ${workOrder.orderNo}`}
        >
          <WorkOrderTemplate
            workOrder={{
              workOrderNo: workOrder.orderNo,
              status: workOrder.status,
              priority: workOrder.priority,
              createdAt: workOrder.createdAt,
              scheduledDate: null,
              completedAt: null,
              notes: workOrder.customerComplaint,
              internalNotes: workOrder.diagnosis,
              subtotal: workOrder.subtotal,
              taxAmount: workOrder.taxAmount,
              total: workOrder.total,
              customer: workOrder.customer ? {
                name: workOrder.customer.name,
                phone: workOrder.customer.phone,
                email: workOrder.customer.email,
                address: null,
              } : null,
              vehicle: workOrder.vehicle ? {
                make: workOrder.vehicle.make,
                model: workOrder.vehicle.model,
                year: workOrder.vehicle.year,
                plateNumber: workOrder.vehicle.licensePlate || '',
                color: null,
                vin: null,
                currentMileage: workOrder.vehicle.currentMileage,
              } : null,
              services: workOrder.services.map(s => ({
                id: s.id,
                description: s.description,
                hours: s.hours ? parseFloat(s.hours) : null,
                rate: s.rate,
                amount: s.amount,
                status: 'completed',
                serviceType: s.serviceType ? { name: s.serviceType.name } : null,
                technician: s.technician ? { name: s.technician.fullName } : null,
              })),
              parts: workOrder.parts.map(p => ({
                id: p.id,
                quantity: parseInt(p.quantity),
                unitPrice: p.unitPrice,
                totalPrice: p.total,
                partName: null,
                item: p.item ? { name: p.item.name, sku: null } : null,
              })),
            }}
            settings={DEFAULT_PRINT_SETTINGS.work_order}
            businessName="Smart POS"
            currencyCode={currency}
          />
        </PrintPreview>
      )}
    </div>
  )
}

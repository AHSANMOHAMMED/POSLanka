'use client'

import React, { useState, useEffect, use, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home, ChevronRight, Plus, FileText, Wrench, Package, Car,
  CheckCircle, CreditCard, Calendar, Clock, AlertCircle,
  Printer, ClipboardCheck, History, Save, RotateCcw
} from 'lucide-react'
import { ServiceTypeModal, ItemModal, CancellationReasonModal, CustomerFormModal, VehicleModal } from '@/components/modals'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'
import { InspectionSummaryCard, InspectionModal } from '@/components/inspection'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { LinkFieldOption } from '@/components/ui/link-field'
import { EditableGrid, ColumnDef } from '@/components/ui/editable-grid'
import { FormInput, FormSelect, FormTextarea, FormLabel } from '@/components/ui/form-elements'
import { useRealtimeDataMultiple } from '@/hooks/useRealtimeData'
import { useDateFormat } from '@/hooks'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { AlertModal } from '@/components/ui/alert-modal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { isValidPositiveNumber } from '@/lib/utils/validation'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'
import { PrintPreview, WorkOrderTemplate } from '@/components/print'
import { DEFAULT_PRINT_SETTINGS } from '@/lib/print/types'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
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
  barcode?: string
  sku?: string
  oemPartNumber?: string
  pluCode?: string
  sellingPrice: string
  costPrice?: string
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

interface CostCenter {
  id: string
  name: string
  isGroup: boolean
  isActive: boolean
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
  costCenterId: string | null
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
  invoiced: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
}

const statusTransitions: Record<string, string[]> = {
  draft: ['cancelled'],
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

export default function WorkOrderDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const router = useRouter()
  const { businessType, tenantSlug, currency } = useCompany()
  const { fDate } = useDateFormat()
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
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])

  // Form state for header fields (used in both create and edit)
  const [formData, setFormData] = useState({
    customerId: '',
    vehicleId: '',
    warehouseId: null as string | null,
    costCenterId: '' as string,
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

  // Track deleted items for activity log change summaries
  const [deletedPartNames, setDeletedPartNames] = useState<string[]>([])
  const [deletedServiceNames, setDeletedServiceNames] = useState<string[]>([])

  // Related data for existing work orders
  const [pendingAppointments, setPendingAppointments] = useState<PendingAppointment[]>([])
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [totalChecklistItems, setTotalChecklistItems] = useState(0)
  const [serviceHistory, setServiceHistory] = useState<ServiceHistoryEntry[]>([])
  const [showServiceHistory, setShowServiceHistory] = useState(false)
  const [linkedEstimate, setLinkedEstimate] = useState<{ id: string; estimateNo: string; status: string } | null>(null)
  const [linkedAppointment, setLinkedAppointment] = useState<{ id: string; scheduledDate: string; scheduledTime: string; status: string } | null>(null)

  // Modal states
  const [showServiceTypeModal, setShowServiceTypeModal] = useState(false)
  const [pendingServiceTypeName, setPendingServiceTypeName] = useState('')
  const [showItemModal, setShowItemModal] = useState(false)
  const [pendingItemName, setPendingItemName] = useState('')
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [pendingCustomerName, setPendingCustomerName] = useState('')
  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [showCancellationModal, setShowCancellationModal] = useState(false)
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

  // Payment display state
  const [salePaidAmount, setSalePaidAmount] = useState(0)
  const [salePayments, setSalePayments] = useState<{ id: string; amount: string; method: string; reference: string | null; receivedBy: string | null; createdAt: string }[]>([])
  const [paymentEntriesData, setPaymentEntriesData] = useState<{ id: string; paymentEntryId: string; entryNumber: string; postingDate: string; allocatedAmount: string; status: string }[]>([])
  const [showPaymentHistory, setShowPaymentHistory] = useState(true)

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
      formData.costCenterId !== originalFormData.costCenterId ||
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
    if (formData.warehouseId) params.set('warehouseId', formData.warehouseId)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data: Item[] = result.data || result
    return data.map((i) => buildItemSearchOption(i, businessType, { showStock: true }))
  }, [businessType, formData.warehouseId])

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
  ], [searchItems])

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
          costCenterId: data.costCenterId || '',
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
        if (data.saleId) {
          fetchPaymentData(data.saleId)
        }
        fetchLinkedEstimate()
        fetchLinkedAppointment()
      } else if (res.status === 404) {
        router.push(`/c/${slug}/work-orders`)
      }
    } catch (error) {
      console.error('Error fetching work order:', error)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPendingAppointments, fetchLinkedEstimate, fetchLinkedAppointment are stable
  }, [id, isCreateMode, router, slug])

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

  const fetchCostCenters = useCallback(async () => {
    try {
      const res = await fetch('/api/accounting/cost-centers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCostCenters(Array.isArray(data) ? data.filter((cc: CostCenter) => !cc.isGroup && cc.isActive) : [])
      }
    } catch (error) {
      console.error('Error fetching cost centers:', error)
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

  const fetchPaymentData = useCallback(async (saleId: string) => {
    try {
      const res = await fetch(`/api/sales/${saleId}/payments`)
      if (res.ok) {
        const data = await res.json()
        setSalePayments(data.payments || [])
        setPaymentEntriesData(data.paymentEntries || [])
        // Calculate total paid from legacy payments + payment entry allocations
        const legacyPaid = (data.payments || []).reduce((sum: number, p: { amount: string }) => sum + parseFloat(p.amount), 0)
        const entryPaid = (data.paymentEntries || []).reduce((sum: number, pe: { allocatedAmount: string }) => sum + parseFloat(pe.allocatedAmount), 0)
        setSalePaidAmount(legacyPaid + entryPaid)
      }
    } catch {
      // ignore
    }
  }, [])

  // ============================================
  // EFFECTS
  // ============================================

  useEffect(() => {
    if (isCreateMode) {
      // Create mode: fetch reference data only
      Promise.all([fetchCustomers(), fetchVehicles(), fetchMakes(), fetchServiceTypes(), fetchItems(), fetchCategories(), fetchTechnicians(), fetchCostCenters()])
      setLoading(false)
    } else {
      // Edit mode: fetch work order and reference data
      Promise.all([fetchWorkOrder(), fetchServiceTypes(), fetchItems(), fetchCategories(), fetchTechnicians(), fetchInspections(), fetchCustomers(), fetchVehicles(), fetchMakes(), fetchCostCenters()])
    }
  }, [isCreateMode, fetchWorkOrder, fetchServiceTypes, fetchItems, fetchCategories, fetchTechnicians, fetchInspections, fetchCustomers, fetchVehicles, fetchMakes, fetchCostCenters])

  // Real-time updates for edit mode
  useRealtimeDataMultiple(
    isCreateMode ? [] : [fetchWorkOrder, fetchItems, fetchServiceTypes, fetchCategories, fetchTechnicians, fetchInspections],
    { entityType: ['work-order', 'item', 'service', 'category', 'sale'], refreshOnMount: false }
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
      if (row.serviceName) setDeletedServiceNames(prev => [...prev, row.serviceName])
      setServices(prev => prev.map(s => s.id === row.id ? { ...s, isDeleted: true } : s))
    }
  }

  function handlePartDelete(row: PartGridRow) {
    if (row.id.startsWith('temp-')) {
      setParts(prev => prev.filter(p => p.id !== row.id))
    } else {
      if (row.itemName) setDeletedPartNames(prev => [...prev, row.itemName])
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
    if (costCenters.length > 0 && !formData.costCenterId) {
      setAlertModal({ open: true, title: 'Validation Error', message: 'Cost Center is required', variant: 'error' })
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
            costCenterId: formData.costCenterId || null,
            priority: formData.priority,
            odometerIn: parseInt(formData.odometerIn),
            customerComplaint: formData.customerComplaint || null,
            services: servicesPayload,
            parts: partsPayload,
          }),
        })

        if (res.ok) {
          const newWorkOrder = await res.json()
          router.push(`/c/${slug}/work-orders/${newWorkOrder.id}`)
        } else {
          const data = await res.json()
          setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to create work order', variant: 'error' })
        }
      } else {
        // Update existing work order
        // Track latest updatedAt locally to avoid stale closure issues with React state.
        // Each API call that modifies the work order bumps updatedAt on the server;
        // we must send the latest value to avoid false 409 Conflict errors.
        let latestUpdatedAt = workOrderUpdatedAt
        let hasErrors = false

        // Helper to extract workOrderUpdatedAt from API responses
        const extractUpdatedAt = (data: Record<string, unknown>) => {
          if (data?.workOrderUpdatedAt) latestUpdatedAt = data.workOrderUpdatedAt as string
        }

        // Build item changes summary for activity log
        const itemChanges: string[] = []
        if (deletedServiceNames.length > 0) {
          itemChanges.push(`removed service ${deletedServiceNames.join(', ')}`)
        }
        if (deletedPartNames.length > 0) {
          itemChanges.push(`removed ${deletedPartNames.join(', ')}`)
        }
        const newServicesList = services.filter(s => s.isNew && s.serviceTypeId && s.hours > 0 && !s.isDeleted)
        if (newServicesList.length > 0) {
          itemChanges.push(`added service ${newServicesList.map(s => s.serviceName).join(', ')}`)
        }
        const newPartsList = parts.filter(p => p.isNew && p.itemId && p.quantity > 0 && !p.isDeleted)
        if (newPartsList.length > 0) {
          itemChanges.push(`added ${newPartsList.map(p => p.itemName).join(', ')}`)
        }
        // Detect modified services/parts (dirty, not new, not deleted)
        const dirtyServicesList = services.filter(s => s.isDirty && !s.isNew && !s.isDeleted)
        for (const s of dirtyServicesList) {
          itemChanges.push(`${s.serviceName} modified`)
        }
        const dirtyPartsList = parts.filter(p => p.isDirty && !p.isNew && !p.isDeleted)
        for (const p of dirtyPartsList) {
          itemChanges.push(`${p.itemName} modified`)
        }
        const changesSummary = itemChanges.length > 0 ? itemChanges.join('; ') : undefined

        // 1. Update header (always send if there are any changes, to capture changesSummary in activity log)
        const shouldUpdateHeader = isHeaderDirty || changesSummary
        if (shouldUpdateHeader) {
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
              changesSummary,
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
          // Sync the final updatedAt to React state
          setWorkOrderUpdatedAt(latestUpdatedAt)
          // Clear dirty flags
          setServices(prev => prev.filter(s => !s.isDeleted).map(s => ({ ...s, isDirty: false, isNew: false })))
          setParts(prev => prev.filter(p => !p.isDeleted).map(p => ({ ...p, isDirty: false, isNew: false })))
          setDeletedPartNames([])
          setDeletedServiceNames([])
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
      itemName: p.item ? formatItemLabel(p.item, businessType) : 'Unknown Item',
      quantity: parseFloat(p.quantity) || 0,
      unitPrice: parseFloat(p.unitPrice) || 0,
      total: parseFloat(p.total) || 0,
      availableStock: parseFloat(p.item?.availableStock || '0') || 0,
    })))
    setDeletedPartNames([])
    setDeletedServiceNames([])
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

  // Submit (create invoice without payment)
  async function handleSubmit() {
    if (!workOrder) return
    if (workOrder.services.length === 0 && workOrder.parts.length === 0) {
      setAlertModal({ open: true, title: 'Validation Error', message: 'Add at least one service or part before submitting', variant: 'error' })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/work-orders/${id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedUpdatedAt: workOrderUpdatedAt,
        }),
      })
      if (res.ok) {
        fetchWorkOrder()
        triggerSaveAnimation()
      } else {
        const data = await res.json()
        if (data.code === 'CONFLICT') {
          setAlertModal({ open: true, title: 'Conflict', message: 'Work order was modified by another user. Please refresh.', variant: 'warning' })
        } else {
          setAlertModal({ open: true, title: 'Submit Error', message: data.error || 'Failed to create invoice', variant: 'error' })
        }
      }
    } catch (error) {
      console.error('Error submitting work order:', error)
      setAlertModal({ open: true, title: 'Submit Error', message: 'Failed to create invoice', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Navigate to payment entries page for recording payment
  function navigateToPaymentEntry() {
    if (!workOrder?.saleId || !workOrder.customer?.id) return
    const balanceDue = Math.max(0, parseFloat(workOrder.total) - salePaidAmount)
    const params = new URLSearchParams({
      paymentType: 'receive',
      partyType: 'customer',
      partyId: workOrder.customer.id,
      partyName: workOrder.customer.name,
      referenceType: 'sale',
      referenceId: workOrder.saleId,
      amount: String(balanceDue),
      returnUrl: `/c/${tenantSlug}/work-orders/${workOrder.id}`,
    })
    router.push(`/c/${tenantSlug}/accounting/payment-entries/new?${params}`)
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
    <div className="-m-5 flex flex-col h-[calc(100vh-3rem)]">
      {/* ===================== STICKY PAGE HEAD ===================== */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b px-6 py-3 flex-shrink-0">
        {/* Row 1: Breadcrumb */}
        <nav className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <Link href={`/c/${slug}/dashboard`} className="hover:text-gray-700 dark:hover:text-gray-200">
            <Home size={14} />
          </Link>
          <ChevronRight size={12} />
          <Link href={`/c/${slug}/work-orders`} className="hover:text-gray-700 dark:hover:text-gray-200">
            Auto Service
          </Link>
          <ChevronRight size={12} />
          <Link href={`/c/${slug}/work-orders`} className="hover:text-gray-700 dark:hover:text-gray-200">
            Work Orders
          </Link>
          <ChevronRight size={12} />
          <span className="text-gray-800 dark:text-gray-100 font-medium">
            {isCreateMode ? 'New' : workOrder?.orderNo}
          </span>
        </nav>

        {/* Row 2: Title + Status Badge + Saved indicator */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {isCreateMode ? 'New Work Order' : workOrder?.orderNo}
            </h1>
            {justSaved && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 animate-pulse">
                <CheckCircle size={14} /> Saved
              </span>
            )}
          </div>
          {!isCreateMode && workOrder && (
            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${statusColors[workOrder.status]}`}>
              {statusLabels[workOrder.status]}
            </span>
          )}
        </div>
      </div>

      {/* ===================== CONNECTIONS BAR ===================== */}
      {!isCreateMode && (linkedEstimate || linkedAppointment || workOrder?.saleId) && (
        <div className="flex items-center gap-2 px-6 py-2 bg-gray-50 dark:bg-gray-800/50 border-b flex-shrink-0 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Connections:</span>
          {workOrder?.saleId && (
            <Link href={`/c/${slug}/sales/${workOrder.saleId}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400">
              <CreditCard size={12} />
              Invoice
            </Link>
          )}
          {paymentEntriesData.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
              <CreditCard size={12} />
              {paymentEntriesData.length} Payment{paymentEntriesData.length !== 1 ? 's' : ''}
            </span>
          )}
          {linkedEstimate && (
            <Link href={`/c/${slug}/insurance-estimates/${linkedEstimate.id}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400">
              <FileText size={12} />
              Estimate {linkedEstimate.estimateNo}
            </Link>
          )}
          {linkedAppointment && (
            <Link href={`/c/${slug}/appointments?date=${linkedAppointment.scheduledDate}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400">
              <Calendar size={12} />
              Appointment {linkedAppointment.scheduledDate}
            </Link>
          )}
        </div>
      )}

      {/* ===================== WARNING BANNERS ===================== */}
      {!isCreateMode && workOrder?.status === 'cancelled' && workOrder.cancellationReason && (
        <div className="px-6 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex-shrink-0">
          <p className="text-sm text-red-700 dark:text-red-400">
            <span className="font-medium">Cancellation Reason:</span> {workOrder.cancellationReason}
          </p>
        </div>
      )}

      {!isCreateMode && pendingAppointments.length > 0 && workOrder?.status === 'draft' && (
        <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex-shrink-0">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-800 dark:text-amber-300 text-sm">
                This vehicle has {pendingAppointments.length} scheduled appointment{pendingAppointments.length !== 1 ? 's' : ''}
              </h3>
              <div className="mt-2 space-y-2">
                {pendingAppointments.map(apt => (
                  <div key={apt.id} className="flex items-center justify-between bg-white dark:bg-gray-800 p-2.5 rounded border border-amber-200 dark:border-amber-700">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <Calendar size={13} />
                        <span className="text-xs font-medium">{fDate(apt.scheduledDate)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <Clock size={13} />
                        <span className="text-xs">{apt.scheduledTime.slice(0, 5)}</span>
                      </div>
                      {apt.serviceType && <span className="text-xs text-gray-600 dark:text-gray-400">{apt.serviceType.name}</span>}
                    </div>
                    <button
                      onClick={() => linkAppointmentToWorkOrder(apt.id)}
                      className="px-2.5 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700"
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

      {/* ===================== FORM BODY + SIDEBAR ===================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Form Sections */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Section: Vehicle & Customer */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Car size={14} />
                Vehicle & Customer
              </h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Vehicle */}
                <div>
                  <FormLabel required>Vehicle</FormLabel>
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
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">
                      {workOrder?.vehicle ? (
                        <>
                          {workOrder.vehicle.licensePlate && <span className="text-blue-600 dark:text-blue-400 font-bold">[{workOrder.vehicle.licensePlate}]</span>}{' '}
                          {workOrder.vehicle.year ? `${workOrder.vehicle.year} ` : ''}
                          {workOrder.vehicle.make} {workOrder.vehicle.model}
                        </>
                      ) : 'No vehicle'}
                    </p>
                  )}
                </div>

                {/* Customer */}
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
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">{workOrder?.customer?.name || 'No customer'}</p>
                  )}
                  {selectedCustomer && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{selectedCustomer.phone || 'No phone'}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Odometer */}
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
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">{workOrder?.odometerIn?.toLocaleString() || '-'}</p>
                  )}
                </div>

                {/* Priority */}
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
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1 capitalize">{workOrder?.priority || 'normal'}</p>
                  )}
                </div>

                {/* Warehouse */}
                <div>
                  <FormLabel required={isCreateMode}>Warehouse</FormLabel>
                  {isCreateMode ? (
                    <WarehouseSelector
                      value={formData.warehouseId}
                      onChange={(newId) => setFormData(prev => ({ ...prev, warehouseId: newId }))}
                      userOnly={false}
                      placeholder="Select warehouse"
                      className="w-full"
                      required={true}
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">
                      {workOrder?.warehouse ? `${workOrder.warehouse.name} (${workOrder.warehouse.code})` : 'Not assigned'}
                    </p>
                  )}
                </div>

                {/* Cost Center */}
                {costCenters.length > 0 && (
                  <div>
                    <FormLabel required>Cost Center</FormLabel>
                    {canModify ? (
                      <FormSelect
                        value={formData.costCenterId}
                        onChange={(e) => setFormData(prev => ({ ...prev, costCenterId: e.target.value }))}
                      >
                        <option value="">Select Cost Center</option>
                        {costCenters.map(cc => (
                          <option key={cc.id} value={cc.id}>{cc.name}</option>
                        ))}
                      </FormSelect>
                    ) : (
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">
                        {costCenters.find(cc => cc.id === workOrder?.costCenterId)?.name || 'None'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Mismatch warning */}
              {hasMismatch && (
                <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded text-sm text-orange-700 dark:text-orange-400 flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>The selected vehicle belongs to a different customer.</span>
                </div>
              )}
            </div>
          </div>

          {/* Section: Notes */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Notes
              </h2>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{workOrder?.customerComplaint || <span className="text-gray-400">No complaint recorded</span>}</p>
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
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{workOrder?.diagnosis || <span className="text-gray-400">No diagnosis added</span>}</p>
                )}
              </div>
            </div>
          </div>

          {/* Section: Services */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex flex-wrap justify-between items-center gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Wrench size={14} />
                Services
              </h2>
              {!isCreateMode && canModify && services.filter(s => !s.isDeleted).length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={bulkTechnicianId}
                    onChange={(e) => setBulkTechnicianId(e.target.value)}
                    className="px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
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
                    className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
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

          {/* Section: Parts */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Package size={14} />
                Parts
              </h2>
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

          {/* Payment History */}
          {!isCreateMode && workOrder?.status === 'invoiced' && (salePayments.length > 0 || paymentEntriesData.length > 0) && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <button
                onClick={() => setShowPaymentHistory(!showPaymentHistory)}
                className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded"
              >
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <CreditCard size={14} />
                  Payment History
                </h2>
                <span className="text-xs text-gray-400">{showPaymentHistory ? 'Hide' : 'Show'}</span>
              </button>
              {showPaymentHistory && (
                <div className="border-t dark:border-gray-700">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {salePayments.map((payment) => (
                          <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-sm">{fDate(payment.createdAt)}</td>
                            <td className="px-3 py-2 text-sm capitalize">{payment.method}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">{payment.reference || '-'}</td>
                            <td className="px-3 py-2 text-right text-sm font-medium text-green-600">{formatCurrencyWithSymbol(parseFloat(payment.amount), currency)}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">{payment.receivedBy || '-'}</td>
                          </tr>
                        ))}
                        {paymentEntriesData.map((pe) => (
                          <tr key={pe.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-sm">{fDate(pe.postingDate)}</td>
                            <td className="px-3 py-2 text-sm">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                                Payment Entry
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm">
                              <Link
                                href={`/c/${slug}/accounting/payment-entries/${pe.paymentEntryId}`}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {pe.entryNumber}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-right text-sm font-medium text-green-600">{formatCurrencyWithSymbol(parseFloat(pe.allocatedAmount), currency)}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">-</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* RIGHT: Sidebar */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-l dark:border-gray-700 hidden lg:block bg-gray-50/50 dark:bg-gray-900/30">
          <div className="p-4 space-y-4">

            {/* Order Summary */}
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Order Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Services</span>
                  <span className="dark:text-gray-200">{totals.servicesTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Parts</span>
                  <span className="dark:text-gray-200">{totals.partsTotal.toFixed(2)}</span>
                </div>
                <div className="border-t dark:border-gray-700 pt-2 mt-2">
                  <div className="flex justify-between text-base font-bold">
                    <span className="dark:text-gray-100">Total</span>
                    <span className="dark:text-gray-100">{totals.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Details */}
            {!isCreateMode && workOrder && (
              <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Details</h3>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Status</span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[workOrder.status]}`}>
                      {statusLabels[workOrder.status]}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Priority</span>
                    <span className="capitalize dark:text-gray-200">{workOrder.priority}</span>
                  </div>
                  {workOrder.assignedUser && (
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Assigned</span>
                      <span className="dark:text-gray-200">{workOrder.assignedUser.fullName}</span>
                    </div>
                  )}
                  {workOrder.warehouse && (
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Warehouse</span>
                      <span className="dark:text-gray-200">{workOrder.warehouse.name}</span>
                    </div>
                  )}
                  {workOrder.saleId && (
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Invoice</span>
                      <Link href={`/c/${slug}/sales/${workOrder.saleId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs">View Invoice</Link>
                    </div>
                  )}
                  <div className="border-t dark:border-gray-700 pt-2 mt-2 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Created</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {fDate(workOrder.createdAt)}
                        {workOrder.createdByUser && ` by ${workOrder.createdByUser.fullName}`}
                      </span>
                    </div>
                    {workOrder.updatedAt && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Modified</span>
                        <span className="text-gray-500 dark:text-gray-400">{fDate(workOrder.updatedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Inspections (sidebar - compact) */}
            {!isCreateMode && formData.vehicleId && (
              <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-2">
                  <ClipboardCheck size={14} />
                  Inspections
                </h3>
                {inspections.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">No inspections yet.</p>
                    {canModify && (
                      <button
                        onClick={() => openInspectionModal('check_in')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        <Plus size={14} />
                        Start Check-in
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
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
                    {canModify && inspections.some(i => i.inspectionType === 'check_in' && i.status === 'completed') && !inspections.some(i => i.inspectionType === 'check_out') && (
                      <button
                        onClick={() => openInspectionModal('check_out')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 w-full justify-center"
                      >
                        <Plus size={14} />
                        Start Check-out
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Service History (sidebar - collapsible) */}
            {!isCreateMode && formData.vehicleId && (
              <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
                <button
                  onClick={() => {
                    if (!showServiceHistory && serviceHistory.length === 0) {
                      fetchServiceHistory(formData.vehicleId)
                    }
                    setShowServiceHistory(!showServiceHistory)
                  }}
                  className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded"
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <Clock size={14} />
                    Service History
                  </h3>
                  <span className="text-xs text-gray-400">{showServiceHistory ? 'Hide' : 'Show'}</span>
                </button>
                {showServiceHistory && (
                  <div className="border-t dark:border-gray-700 p-3 max-h-64 overflow-y-auto">
                    {serviceHistory.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">No previous service records.</p>
                    ) : (
                      <div className="space-y-2">
                        {serviceHistory.map((entry) => (
                          <Link key={entry.id} href={`/c/${slug}/work-orders/${entry.id}`} className="block p-2.5 border dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <div className="flex justify-between items-start mb-1">
                              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{entry.orderNo}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                entry.status === 'invoiced' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                entry.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                              }`}>{entry.status}</span>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {fDate(entry.createdAt)}
                              {entry.odometerIn && ` - ${entry.odometerIn.toLocaleString()} km`}
                              {` - ${formatCurrencyWithSymbol(parseFloat(entry.total), currency)}`}
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===================== ACTIONS BAR ===================== */}
      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []

        // Left side actions
        if (!isCreateMode && hasDirtyChanges) {
          a.push({
            key: 'discard',
            label: 'Discard',
            icon: <RotateCcw size={14} />,
            variant: 'outline',
            position: 'left',
            disabled: saving,
            onClick: handleDiscardChanges,
          })
        }
        if (!isCreateMode && allowedTransitions.includes('cancelled')) {
          a.push({
            key: 'cancel',
            label: 'Cancel',
            variant: 'danger',
            position: 'left',
            disabled: saving,
            onClick: () => setShowCancellationModal(true),
          })
        }
        if (!isCreateMode) {
          a.push({
            key: 'print',
            label: 'Print',
            icon: <Printer size={14} />,
            variant: 'outline',
            position: 'left',
            onClick: () => setShowPrintPreview(true),
          })
        }

        // Right side actions
        if (isCreateMode) {
          a.push({
            key: 'create',
            label: 'Create Work Order',
            icon: <Save size={14} />,
            variant: 'primary',
            loading: saving,
            onClick: handleSave,
          })
        }
        if (!isCreateMode && workOrder?.status === 'draft' && hasDirtyChanges) {
          a.push({
            key: 'save',
            label: 'Save',
            icon: <Save size={14} />,
            variant: 'primary',
            loading: saving,
            onClick: handleSave,
          })
        }
        if (!isCreateMode && workOrder?.status === 'draft' && !hasDirtyChanges) {
          a.push({
            key: 'submit',
            label: 'Submit',
            icon: <CheckCircle size={14} />,
            variant: 'success',
            loading: saving,
            disabled: workOrder.services.length === 0 && workOrder.parts.length === 0,
            onClick: handleSubmit,
            confirmation: {
              title: 'Submit Work Order',
              message: 'This will create an invoice for this work order. Are you sure you want to proceed?',
              variant: 'default',
              confirmText: 'Submit & Create Invoice',
            },
          })
        }
        if (!isCreateMode && workOrder?.status === 'invoiced') {
          a.push({
            key: 'payment',
            label: 'Get Payment',
            icon: <CreditCard size={14} />,
            variant: 'success',
            loading: saving,
            onClick: navigateToPaymentEntry,
          })
        }

        return a
      })()} />

      {/* ===================== MODALS (unchanged) ===================== */}
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

      <CancellationReasonModal
        isOpen={showCancellationModal}
        onClose={() => { setShowCancellationModal(false); setEstimateAction(''); setAppointmentAction('') }}
        onConfirm={(reason) => updateStatus('cancelled', reason)}
        title="Cancel Work Order"
        itemName={workOrder ? `Work Order ${workOrder.orderNo}` : undefined}
        processing={saving}
        warningMessage={workOrder?.status === 'invoiced' ? 'This work order has been invoiced. Cancelling will void the invoice.' : undefined}
        confirmDisabled={Boolean((linkedEstimate && !estimateAction) || (linkedAppointment && !appointmentAction))}
        documentType="work_order"
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

      {/* Comments & Activity */}
      {!isCreateMode && workOrder && (
        <DocumentCommentsAndActivity
          documentType="work_order"
          documentId={id}
          entityType="work-order"
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

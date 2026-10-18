'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, Clock, Car, User, Wrench, FileText, Save, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { CancellationReasonModal, CustomerFormModal, VehicleModal, ServiceTypeModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { FormInput, FormSelect, FormTextarea, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useRealtimeData } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
}

interface VehicleMake {
  id: string
  name: string
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  customerId: string | null
}

interface ServiceType {
  id: string
  name: string
}

interface WorkOrder {
  id: string
  orderNo: string
}

interface Appointment {
  id: string
  scheduledDate: string
  scheduledTime: string
  durationMinutes: number
  status: 'scheduled' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show'
  notes: string | null
  customerId: string | null
  vehicleId: string | null
  serviceTypeId: string | null
  workOrderId: string | null
  cancellationReason: string | null
  recurrencePattern: string | null
  customer: Customer | null
  vehicle: Vehicle | null
  serviceType: ServiceType | null
  workOrder: WorkOrder | null
  createdAt: string
  updatedAt: string | null
}

interface Conflict {
  id: string
  customerName: string | null
  serviceName: string | null
  scheduledTime: string
  endTime: string
}

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  arrived: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  completed: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  no_show: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
}

const statusLabels: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

const initialFormData = {
  customerId: '',
  vehicleId: '',
  serviceTypeId: '',
  scheduledDate: '',
  scheduledTime: '',
  durationMinutes: '60',
  notes: '',
  recurrencePattern: 'none',
  recurrenceEndDate: '',
}

export default function AppointmentDetailPage() {
  const router = useRouter()
  const params = useParams()
  const appointmentId = params.id as string
  const isCreateMode = appointmentId === 'new'
  const { tenantSlug } = useCompany()

  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(!isCreateMode)
  const [saving, setSaving] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showStatusConfirm, setShowStatusConfirm] = useState<string | null>(null)
  const [showCreateWorkOrderModal, setShowCreateWorkOrderModal] = useState(false)
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')

  // Editable fields for existing appointments
  const [notes, setNotes] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  // Create mode state
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [formData, setFormData] = useState(initialFormData)

  // Dropdown data
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])

  // Sub-modal states
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [showServiceTypeModal, setShowServiceTypeModal] = useState(false)
  const [pendingNewName, setPendingNewName] = useState('')

  // Conflict detection
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [checkingConflicts, setCheckingConflicts] = useState(false)

  // Navigation helper
  const appointmentsPath = tenantSlug ? `/c/${tenantSlug}/appointments` : '/appointments'

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCustomers(data)
      } else {
        console.error(`Error fetching customers (${res.status})`)
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
      } else {
        console.error(`Error fetching vehicles (${res.status})`)
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error)
    }
  }, [])

  const fetchServiceTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/service-types?all=true')
      if (res.ok) {
        const data = await res.json()
        setServiceTypes(data)
      } else {
        console.error(`Error fetching service types (${res.status})`)
      }
    } catch (error) {
      console.error('Error fetching service types:', error)
    }
  }, [])

  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes')
      if (res.ok) {
        const data = await res.json()
        setMakes(data)
      } else {
        console.error(`Error fetching makes (${res.status})`)
      }
    } catch (error) {
      console.error('Error fetching makes:', error)
    }
  }, [])

  // Fetch dropdown data for create mode
  useEffect(() => {
    if (isCreateMode) {
      Promise.all([fetchCustomers(), fetchVehicles(), fetchServiceTypes(), fetchMakes()])
    }
  }, [isCreateMode, fetchCustomers, fetchVehicles, fetchServiceTypes, fetchMakes])

  const fetchAppointment = useCallback(async () => {
    if (isCreateMode) return
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`)
      if (!res.ok) throw new Error('Failed to fetch appointment')
      const data = await res.json()
      setAppointment(data)
      setNotes(data.notes || '')
      setIsDirty(false)
    } catch (error) {
      console.error('Error fetching appointment:', error)
      toast.error('Failed to load appointment')
    } finally {
      setLoading(false)
    }
  }, [appointmentId, isCreateMode])

  // Real-time updates (disabled for create mode)
  useRealtimeData(fetchAppointment, { entityType: 'appointment', enabled: !isCreateMode })

  useEffect(() => {
    if (!isCreateMode) {
      fetchAppointment()
    }
  }, [fetchAppointment, isCreateMode])

  // Check for time slot conflicts
  async function checkConflicts(date: string, time: string, duration: string) {
    if (!date || !time) {
      setConflicts([])
      return
    }

    setCheckingConflicts(true)
    try {
      const res = await fetch('/api/appointments/check-conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledDate: date,
          scheduledTime: time,
          durationMinutes: parseInt(duration) || 60,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setConflicts(data.conflicts || [])
      }
    } catch (error) {
      console.error('Error checking conflicts:', error)
    } finally {
      setCheckingConflicts(false)
    }
  }

  // Check conflicts when date/time/duration changes
  useEffect(() => {
    if (!isCreateMode) return
    const timer = setTimeout(() => {
      if (formData.scheduledDate && formData.scheduledTime) {
        checkConflicts(formData.scheduledDate, formData.scheduledTime, formData.durationMinutes)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [formData.scheduledDate, formData.scheduledTime, formData.durationMinutes, isCreateMode])

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

  const handleNotesChange = (value: string) => {
    setNotes(value)
    setIsDirty(value !== (appointment?.notes || ''))
  }

  const handleSave = async () => {
    if (!appointment) return
    setSaving(true)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, expectedUpdatedAt: appointment.updatedAt }),
      })
      if (res.status === 409) {
        toast.error('This appointment was modified by another user. Refreshing...')
        fetchAppointment()
        return
      }
      if (!res.ok) throw new Error('Failed to save')
      const updated = await res.json()
      setAppointment(updated)
      setIsDirty(false)
      toast.success('Appointment updated')
    } catch (error) {
      console.error('Error saving:', error)
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!appointment) return
    setSaving(true)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, expectedUpdatedAt: appointment.updatedAt }),
      })
      if (res.status === 409) {
        toast.error('This appointment was modified by another user. Refreshing...')
        fetchAppointment()
        return
      }
      if (!res.ok) throw new Error('Failed to update status')
      const updated = await res.json()
      setAppointment(updated)
      toast.success(`Status changed to ${statusLabels[newStatus]}`)
    } catch (error) {
      console.error('Error updating status:', error)
      toast.error('Failed to update status')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async (reason: string) => {
    if (!appointment) return
    setSaving(true)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason, expectedUpdatedAt: appointment.updatedAt }),
      })
      if (res.status === 409) {
        toast.error('This appointment was modified by another user. Refreshing...')
        fetchAppointment()
        return
      }
      if (!res.ok) throw new Error('Failed to cancel')
      const updated = await res.json()
      setAppointment(updated)
      setShowCancelModal(false)
      toast.success('Appointment cancelled')
    } catch (error) {
      console.error('Error cancelling:', error)
      toast.error('Failed to cancel appointment')
    } finally {
      setSaving(false)
    }
  }

  const openCreateWorkOrderModal = async () => {
    // Fetch warehouses for selection
    try {
      const res = await fetch('/api/warehouses?all=true')
      if (res.ok) {
        const data = await res.json()
        const active = (Array.isArray(data) ? data : data.data || []).filter((w: { isActive?: boolean }) => w.isActive !== false)
        setWarehouses(active)
        if (active.length === 1) {
          setSelectedWarehouseId(active[0].id)
        } else {
          setSelectedWarehouseId('')
        }
      }
    } catch {
      // ignore
    }
    setShowCreateWorkOrderModal(true)
  }

  const handleCreateWorkOrder = async () => {
    if (!appointment) return
    if (!selectedWarehouseId && warehouses.length > 0) {
      toast.error('Please select a warehouse')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createWorkOrder: true, warehouseId: selectedWarehouseId || undefined }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create work order')
      }
      const data = await res.json()
      setShowCreateWorkOrderModal(false)
      toast.success('Work order created')
      if (data.workOrder) {
        const workOrderPath = tenantSlug ? `/c/${tenantSlug}/work-orders/${data.workOrder.id}` : `/work-orders/${data.workOrder.id}`
        router.push(workOrderPath)
      } else {
        fetchAppointment()
      }
    } catch (error) {
      console.error('Error creating work order:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create work order')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.scheduledDate || !formData.scheduledTime) {
      setCreateError('Date and time are required')
      return
    }

    setCreating(true)
    setCreateError('')

    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          customerId: formData.customerId || null,
          vehicleId: formData.vehicleId || null,
          serviceTypeId: formData.serviceTypeId || null,
          recurrencePattern: formData.recurrencePattern,
          recurrenceEndDate: formData.recurrencePattern !== 'none' ? formData.recurrenceEndDate : undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.totalCreated && data.totalCreated > 1) {
          toast.success(`Created ${data.totalCreated} recurring appointments`)
        } else {
          toast.success('Appointment created')
        }
        const appointmentPath = tenantSlug ? `/c/${tenantSlug}/appointments/${data.id}` : `/appointments/${data.id}`
        router.replace(appointmentPath)
      } else {
        const data = await res.json()
        setCreateError(data.error || 'Failed to create appointment')
      }
    } catch {
      setCreateError('Failed to create appointment')
    } finally {
      setCreating(false)
    }
  }

  // Create Mode UI
  if (isCreateMode) {
    return (
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href={appointmentsPath}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <ArrowLeft size={20} className="dark:text-white" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold dark:text-white">New Appointment</h1>
            <p className="text-gray-500 dark:text-gray-400">Schedule a new appointment</p>
          </div>
        </div>

        {/* Create Form */}
        <form onSubmit={handleCreateAppointment} className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-6">
          {createError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded flex items-center gap-2">
              <AlertTriangle className="text-red-600 dark:text-red-400" size={18} />
              <span className="text-red-600 dark:text-red-400">{createError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FormLabel>Vehicle</FormLabel>
              <CreatableSelect
                options={filteredVehicles.map(v => ({
                  value: v.id,
                  label: `${v.licensePlate ? `[${v.licensePlate}] ` : ''}${v.year ? `${v.year} ` : ''}${v.make} ${v.model}${formData.customerId && v.customerId !== formData.customerId ? ' (Other Owner)' : ''}`
                }))}
                value={formData.vehicleId}
                onChange={(value) => {
                  const vehicle = vehicles.find(v => v.id === value)
                  setFormData({
                    ...formData,
                    vehicleId: value,
                    customerId: vehicle?.customerId || formData.customerId
                  })
                }}
                onCreateNew={() => setShowVehicleModal(true)}
                placeholder="Select Vehicle"
                createLabel="Add vehicle"
              />
            </div>
            <div>
              <FormLabel required>Customer</FormLabel>
              <CreatableSelect
                options={filteredCustomers.map(c => {
                  const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId)
                  const isNotOwner = formData.vehicleId && selectedVehicle?.customerId && selectedVehicle.customerId !== c.id
                  return { value: c.id, label: `${c.name}${isNotOwner ? ' (Not Owner)' : ''}` }
                })}
                value={formData.customerId}
                onChange={(value) => setFormData({ ...formData, customerId: value })}
                onCreateNew={(name) => {
                  setPendingNewName(name)
                  setShowCustomerModal(true)
                }}
                placeholder="Select Customer"
                createLabel="Add customer"
              />
            </div>
            <div>
              <FormLabel>Service Type</FormLabel>
              <CreatableSelect
                options={serviceTypes.map(st => ({ value: st.id, label: st.name }))}
                value={formData.serviceTypeId}
                onChange={(value) => setFormData({ ...formData, serviceTypeId: value })}
                onCreateNew={(name) => {
                  setPendingNewName(name)
                  setShowServiceTypeModal(true)
                }}
                placeholder="Select Service"
                createLabel="Add service type"
              />
            </div>
            <div>
              <FormLabel required>Date</FormLabel>
              <FormInput
                type="date"
                value={formData.scheduledDate}
                onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
                required
              />
            </div>
            <div>
              <FormLabel required>Time</FormLabel>
              <FormInput
                type="time"
                value={formData.scheduledTime}
                onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
                required
              />
            </div>
            <div>
              <FormLabel>Duration</FormLabel>
              <FormSelect
                value={formData.durationMinutes}
                onChange={(e) => setFormData({ ...formData, durationMinutes: e.target.value })}
              >
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="90">1.5 hours</option>
                <option value="120">2 hours</option>
                <option value="180">3 hours</option>
                <option value="240">4 hours</option>
              </FormSelect>
            </div>

            {/* Recurring appointment fields */}
            <div>
              <FormLabel>Repeat</FormLabel>
              <FormSelect
                value={formData.recurrencePattern}
                onChange={(e) => setFormData({ ...formData, recurrencePattern: e.target.value })}
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </FormSelect>
            </div>
            {formData.recurrencePattern !== 'none' && (
              <div>
                <FormLabel required>Repeat Until</FormLabel>
                <FormInput
                  type="date"
                  value={formData.recurrenceEndDate}
                  onChange={(e) => setFormData({ ...formData, recurrenceEndDate: e.target.value })}
                  min={formData.scheduledDate || undefined}
                  required={formData.recurrencePattern !== 'none'}
                />
              </div>
            )}

            <div className="md:col-span-3">
              <FormLabel>Notes</FormLabel>
              <FormTextarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
              />
            </div>

            {/* Conflict Warning */}
            {conflicts.length > 0 && (
              <div className="md:col-span-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                  Time Slot Conflict Detected
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-2">
                  The selected time overlaps with {conflicts.length} existing appointment{conflicts.length > 1 ? 's' : ''}:
                </p>
                <ul className="text-sm text-yellow-700 dark:text-yellow-400 space-y-1">
                  {conflicts.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="font-medium">{c.scheduledTime.slice(0, 5)} - {c.endTime.slice(0, 5)}</span>
                      {c.customerName && <span>• {c.customerName}</span>}
                      {c.serviceName && <span>• {c.serviceName}</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-2">
                  You can still create this appointment, but consider adjusting the time.
                </p>
              </div>
            )}
            {checkingConflicts && (
              <div className="md:col-span-3 text-sm text-gray-500 dark:text-gray-400">
                Checking for conflicts...
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 mt-4 border-t dark:border-gray-700">
            <Link
              href={appointmentsPath}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {creating && <Loader2 className="animate-spin" size={16} />}
              Create Appointment
            </button>
          </div>
        </form>

        {/* Sub-modals */}
        <CustomerFormModal
          isOpen={showCustomerModal}
          onClose={() => {
            setShowCustomerModal(false)
            setPendingNewName('')
          }}
          onSaved={(customer) => {
            setCustomers([...customers, customer])
            setFormData({ ...formData, customerId: customer.id })
          }}
          initialName={pendingNewName}
        />

        <VehicleModal
          isOpen={showVehicleModal}
          onClose={() => setShowVehicleModal(false)}
          onCreated={(vehicle) => {
            fetchVehicles()
            setFormData({ ...formData, vehicleId: vehicle.id })
          }}
          customers={customers}
          makes={makes}
          onMakesUpdated={fetchMakes}
          onCustomersUpdated={fetchCustomers}
          selectedCustomerId={formData.customerId}
        />

        <ServiceTypeModal
          isOpen={showServiceTypeModal}
          onClose={() => {
            setShowServiceTypeModal(false)
            setPendingNewName('')
          }}
          onCreated={(serviceType) => {
            setServiceTypes([...serviceTypes, serviceType])
            setFormData({ ...formData, serviceTypeId: serviceType.id })
          }}
          initialName={pendingNewName}
        />
      </div>
    )
  }

  // Loading state for existing appointment
  if (loading) {
    return <PageLoading text="Loading appointment..." />
  }

  if (!appointment) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Appointment not found</p>
        <Link href={appointmentsPath} className="text-blue-600 hover:underline mt-2 inline-block">
          Back to Appointments
        </Link>
      </div>
    )
  }

  const canModify = !['completed', 'cancelled', 'no_show'].includes(appointment.status)
  const canCreateWorkOrder = ['scheduled', 'confirmed', 'arrived'].includes(appointment.status) && !appointment.workOrderId

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            href={appointmentsPath}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <ArrowLeft size={20} className="dark:text-white" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold dark:text-white">Appointment Details</h1>
            <p className="text-gray-500 dark:text-gray-400">
              {new Date(appointment.scheduledDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[appointment.status]}`}>
          {statusLabels[appointment.status]}
        </span>
      </div>

      {/* Main Content */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-6 space-y-6">
        {/* Date & Time */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded">
              <Calendar className="text-blue-600 dark:text-blue-400" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Date</p>
              <p className="font-medium dark:text-white">
                {new Date(appointment.scheduledDate).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded">
              <Clock className="text-green-600 dark:text-green-400" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Time</p>
              <p className="font-medium dark:text-white">{appointment.scheduledTime}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded">
              <Clock className="text-purple-600 dark:text-purple-400" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Duration</p>
              <p className="font-medium dark:text-white">{appointment.durationMinutes} minutes</p>
            </div>
          </div>
        </div>

        {/* Customer & Vehicle */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t dark:border-gray-700">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded">
              <User className="text-gray-600 dark:text-gray-400" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Customer</p>
              {appointment.customer ? (
                <>
                  <p className="font-medium dark:text-white">{appointment.customer.name}</p>
                  {appointment.customer.phone && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{appointment.customer.phone}</p>
                  )}
                </>
              ) : (
                <p className="text-gray-400">-</p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded">
              <Car className="text-gray-600 dark:text-gray-400" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Vehicle</p>
              {appointment.vehicle ? (
                <>
                  <p className="font-medium dark:text-white">
                    {appointment.vehicle.year} {appointment.vehicle.make} {appointment.vehicle.model}
                  </p>
                  {appointment.vehicle.licensePlate && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{appointment.vehicle.licensePlate}</p>
                  )}
                </>
              ) : (
                <p className="text-gray-400">-</p>
              )}
            </div>
          </div>
        </div>

        {/* Service & Work Order */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t dark:border-gray-700">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded">
              <Wrench className="text-gray-600 dark:text-gray-400" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Service Type</p>
              <p className="font-medium dark:text-white">
                {appointment.serviceType?.name || '-'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded">
              <FileText className="text-gray-600 dark:text-gray-400" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Work Order</p>
              {appointment.workOrder ? (
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/work-orders/${appointment.workOrder.id}` : `/work-orders/${appointment.workOrder.id}`}
                  className="font-medium text-blue-600 hover:underline"
                >
                  {appointment.workOrder.orderNo}
                </Link>
              ) : (
                <p className="text-gray-400">-</p>
              )}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="pt-4 border-t dark:border-gray-700">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            disabled={!canModify}
            rows={3}
            className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Add notes..."
          />
        </div>

        {/* Cancellation Reason */}
        {appointment.status === 'cancelled' && appointment.cancellationReason && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Cancellation Reason:</p>
            <p className="text-red-700 dark:text-red-300">{appointment.cancellationReason}</p>
          </div>
        )}

        {/* Actions */}
        {canModify && (
          <div className="pt-4 border-t dark:border-gray-700 flex flex-wrap gap-3">
            {isDirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Save Changes
              </button>
            )}

            {appointment.status === 'scheduled' && (
              <button
                onClick={() => setShowStatusConfirm('confirmed')}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle size={16} />
                Confirm
              </button>
            )}

            {appointment.status === 'confirmed' && (
              <button
                onClick={() => setShowStatusConfirm('arrived')}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
              >
                <CheckCircle size={16} />
                Mark Arrived
              </button>
            )}

            {canCreateWorkOrder && (
              <button
                onClick={openCreateWorkOrderModal}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              >
                <FileText size={16} />
                Create Work Order
              </button>
            )}

            <button
              onClick={() => setShowCancelModal(true)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              <XCircle size={16} />
              Cancel Appointment
            </button>
          </div>
        )}
      </div>

      {/* Comments & Activity */}
      <DocumentCommentsAndActivity
        documentType="appointment"
        documentId={appointmentId}
        entityType="appointment"
      />

      {/* Cancel Modal */}
      <ConfirmModal
        isOpen={!!showStatusConfirm}
        onClose={() => setShowStatusConfirm(null)}
        onConfirm={() => { const s = showStatusConfirm; setShowStatusConfirm(null); if (s) handleStatusChange(s) }}
        title={`${showStatusConfirm === 'confirmed' ? 'Confirm' : showStatusConfirm === 'arrived' ? 'Mark Arrived' : statusLabels[showStatusConfirm || ''] || 'Update'} Appointment`}
        message={`Are you sure you want to ${showStatusConfirm === 'confirmed' ? 'confirm' : showStatusConfirm === 'arrived' ? 'mark as arrived' : `change the status to "${statusLabels[showStatusConfirm || ''] || showStatusConfirm}"`} this appointment?`}
        confirmText={showStatusConfirm === 'confirmed' ? 'Confirm' : showStatusConfirm === 'arrived' ? 'Mark Arrived' : 'Confirm'}
        variant="info"
        processing={saving}
      />

      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        title="Cancel Appointment"
        itemName={`Appointment on ${new Date(appointment.scheduledDate).toLocaleDateString()}`}
        processing={saving}
        documentType="work_order"
      />

      {/* Create Work Order Modal */}
      {showCreateWorkOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Create Work Order</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This will create a new work order for this appointment and link them together.
            </p>
            {warehouses.length > 1 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Warehouse</label>
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm"
                >
                  <option value="">Select warehouse...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreateWorkOrderModal(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkOrder}
                disabled={saving || (warehouses.length > 1 && !selectedWarehouseId)}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Work Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

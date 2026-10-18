'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { CustomerFormModal, VehicleMakeModal, VehicleModelModal } from '@/components/modals'
import { Timeline, TimelineItemData } from '@/components/ui/timeline'
import { toast } from '@/components/ui/toast'
import { isValidPositiveInteger } from '@/lib/utils/validation'
import { bodyTypeDisplayNames } from '@/lib/data/default-vehicle-types'
import { Car, CreditCard, User, History, Loader2 } from 'lucide-react'

type TabType = 'basic' | 'identification' | 'owner' | 'history'

interface OwnershipHistoryEntry {
  id: string
  customerName: string | null
  previousCustomerName: string | null
  changedAt: string
  changedByName: string | null
  notes: string | null
}

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface VehicleMake {
  id: string
  name: string
}

interface VehicleModel {
  id: string
  name: string
  makeId: string
}

interface VehicleType {
  id: string
  name: string
  bodyType: string
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  vin: string | null
  licensePlate: string | null
  color: string | null
  currentMileage: number | null
  notes: string | null
  customerId: string | null
  vehicleTypeId: string | null
  customer: Customer | null
  vehicleType: VehicleType | null
}

interface VehicleFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  editVehicle?: Vehicle | null
}

const initialFormData = {
  customerId: '',
  vehicleTypeId: '',
  makeId: '',
  make: '',
  modelId: '',
  model: '',
  year: '',
  vin: '',
  licensePlate: '',
  color: '',
  notes: '',
}

export function VehicleFormModal({ isOpen, onClose, onSaved, editVehicle }: VehicleFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('basic')
  const [formData, setFormData] = useState(initialFormData)

  // Dropdown data
  const [customers, setCustomers] = useState<Customer[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([])

  // Ownership history
  const [ownershipHistory, setOwnershipHistory] = useState<OwnershipHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Sub-modal states
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showMakeModal, setShowMakeModal] = useState(false)
  const [showModelModal, setShowModelModal] = useState(false)
  const [pendingNewName, setPendingNewName] = useState('')

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCustomers(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
    }
  }, [])

  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes?all=true')
      if (res.ok) {
        const data = await res.json()
        setMakes(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching vehicle makes:', error)
    }
  }, [])

  const fetchVehicleTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-types?all=true')
      if (res.ok) {
        const data = await res.json()
        setVehicleTypes(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching vehicle types:', error)
    }
  }, [])

  const fetchOwnershipHistory = useCallback(async (vehicleId: string) => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/ownership-history`)
      if (res.ok) {
        const data = await res.json()
        setOwnershipHistory(data)
      }
    } catch (error) {
      console.error('Error fetching ownership history:', error)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  async function fetchModels(makeId: string, existingModelName?: string) {
    try {
      const res = await fetch(`/api/vehicle-models?makeId=${makeId}`)
      if (res.ok) {
        const data = await res.json()
        const modelsArray = Array.isArray(data) ? data : []
        setModels(modelsArray)
        // If editing and we have an existing model name, find and set the modelId
        if (existingModelName) {
          const matchingModel = modelsArray.find((m: VehicleModel) => m.name === existingModelName)
          if (matchingModel) {
            setFormData(prev => ({ ...prev, modelId: matchingModel.id }))
          }
        }
      }
    } catch (error) {
      console.error('Error fetching vehicle models:', error)
    }
  }

  useEffect(() => {
    if (isOpen) {
      Promise.all([fetchCustomers(), fetchMakes(), fetchVehicleTypes()])

      if (editVehicle) {
        // Find the make to get makeId
        fetchMakes().then(() => {
          const vehicleMake = makes.find(m => m.name === editVehicle.make)
          setFormData({
            customerId: editVehicle.customerId || '',
            vehicleTypeId: editVehicle.vehicleTypeId || '',
            makeId: vehicleMake?.id || '',
            make: editVehicle.make,
            modelId: '',
            model: editVehicle.model,
            year: editVehicle.year?.toString() || '',
            vin: editVehicle.vin || '',
            licensePlate: editVehicle.licensePlate || '',
            color: editVehicle.color || '',
            notes: editVehicle.notes || '',
          })
          if (vehicleMake) {
            fetchModels(vehicleMake.id, editVehicle.model)
          }
        })
      } else {
        setFormData(initialFormData)
        setModels([])
      }
      setError('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editVehicle, fetchCustomers, fetchMakes, fetchVehicleTypes])

  // Sync makeId when makes load and we're editing
  useEffect(() => {
    if (editVehicle && makes.length > 0 && !formData.makeId) {
      const vehicleMake = makes.find(m => m.name === editVehicle.make)
      if (vehicleMake) {
        setFormData(prev => ({ ...prev, makeId: vehicleMake.id }))
        fetchModels(vehicleMake.id, editVehicle.model)
      }
    }
  }, [editVehicle, makes, formData.makeId])

  function handleClose() {
    setFormData(initialFormData)
    setModels([])
    setActiveTab('basic')
    setError('')
    setOwnershipHistory([])
    onClose()
  }

  const tabs: { key: TabType; label: string; icon: React.ReactNode; editOnly?: boolean }[] = [
    { key: 'basic', label: 'Basic Info', icon: <Car size={16} /> },
    { key: 'identification', label: 'Identification', icon: <CreditCard size={16} /> },
    { key: 'owner', label: 'Owner', icon: <User size={16} /> },
    { key: 'history', label: 'History', icon: <History size={16} />, editOnly: true },
  ]

  function handleMakeChange(makeId: string) {
    const selectedMake = makes.find(m => m.id === makeId)
    setFormData({
      ...formData,
      makeId,
      make: selectedMake?.name || '',
      modelId: '',
      model: '',
    })
    if (makeId) {
      fetchModels(makeId)
    } else {
      setModels([])
    }
  }

  function handleModelChange(modelId: string) {
    const selectedModel = models.find(m => m.id === modelId)
    setFormData({
      ...formData,
      modelId,
      model: selectedModel?.name || '',
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate year if provided
    if (formData.year && !isValidPositiveInteger(formData.year)) {
      setError('Please enter a valid year')
      return
    }

    const yearNum = formData.year ? parseInt(formData.year) : null
    if (yearNum !== null && (yearNum < 1900 || yearNum > 2100)) {
      setError('Year must be between 1900 and 2100')
      return
    }

    if (!formData.make || !formData.model) {
      setError('Make and Model are required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editVehicle ? `/api/vehicles/${editVehicle.id}` : '/api/vehicles'
      const method = editVehicle ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: formData.customerId || null,
          vehicleTypeId: formData.vehicleTypeId || null,
          make: formData.make,
          model: formData.model,
          year: yearNum,
          vin: formData.vin || null,
          licensePlate: formData.licensePlate || null,
          color: formData.color || null,
          notes: formData.notes || null,
        }),
      })

      if (res.ok) {
        toast.success(editVehicle ? 'Vehicle updated' : 'Vehicle created')
        onSaved()
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save vehicle')
      }
    } catch {
      setError('Failed to save vehicle')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title={editVehicle ? 'Edit Vehicle' : 'New Vehicle'} size="lg">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {error && (
            <div className="p-3 mb-4 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b dark:border-gray-700">
            {tabs.filter(tab => !tab.editOnly || editVehicle).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key)
                  if (tab.key === 'history' && editVehicle && ownershipHistory.length === 0 && !historyLoading) {
                    fetchOwnershipHistory(editVehicle.id)
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto min-h-[200px] space-y-4">
            {/* Basic Info Tab */}
            {activeTab === 'basic' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Make *</label>
                  <CreatableSelect
                    options={makes.map(m => ({ value: m.id, label: m.name }))}
                    value={formData.makeId}
                    onChange={handleMakeChange}
                    onCreateNew={(name) => {
                      setPendingNewName(name)
                      setShowMakeModal(true)
                    }}
                    placeholder="Select Make"
                    createLabel="Add make"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Model *</label>
                  <CreatableSelect
                    options={models.map(m => ({ value: m.id, label: m.name }))}
                    value={formData.modelId}
                    onChange={handleModelChange}
                    onCreateNew={(name) => {
                      setPendingNewName(name)
                      setShowModelModal(true)
                    }}
                    placeholder="Select Model"
                    createLabel="Add model"
                    disabled={!formData.makeId}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Year</label>
                  <input
                    type="number"
                    min="1900"
                    max="2100"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Vehicle Type</label>
                  <select
                    value={formData.vehicleTypeId}
                    onChange={(e) => setFormData({ ...formData, vehicleTypeId: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    <option value="">Select Vehicle Type</option>
                    {vehicleTypes.map(vt => (
                      <option key={vt.id} value={vt.id}>
                        {vt.name} ({bodyTypeDisplayNames[vt.bodyType] || vt.bodyType})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Color</label>
                  <input
                    type="text"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* Identification Tab */}
            {activeTab === 'identification' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">License Plate</label>
                  <input
                    type="text"
                    value={formData.licensePlate}
                    onChange={(e) => setFormData({ ...formData, licensePlate: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    placeholder="e.g., ABC-1234"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">VIN / Chassis No</label>
                  <input
                    type="text"
                    value={formData.vin}
                    onChange={(e) => setFormData({ ...formData, vin: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    placeholder="17-character VIN"
                  />
                </div>
              </div>
            )}

            {/* Owner Tab */}
            {activeTab === 'owner' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Customer</label>
                  <CreatableSelect
                    options={customers.map(c => ({ value: c.id, label: c.name }))}
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
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    placeholder="Any additional notes about this vehicle..."
                  />
                </div>
              </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && editVehicle && (
              <div>
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-gray-400 mr-2" />
                    <span className="text-sm text-gray-500">Loading history...</span>
                  </div>
                ) : (
                  <Timeline
                    items={ownershipHistory.map((entry): TimelineItemData => ({
                      id: entry.id,
                      type: 'status_change',
                      title: entry.customerName
                        ? `Owner changed to ${entry.customerName}`
                        : 'Owner removed',
                      description: entry.notes || undefined,
                      timestamp: entry.changedAt,
                      user: entry.changedByName ? { name: entry.changedByName } : undefined,
                      metadata: {
                        fromStatus: entry.previousCustomerName || 'Unassigned',
                        toStatus: entry.customerName || 'Unassigned',
                      },
                    }))}
                    emptyMessage="No ownership changes recorded"
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !formData.make || !formData.model}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editVehicle ? 'Update Vehicle' : 'Create Vehicle'}
            </button>
          </div>
        </form>
      </Modal>

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

      <VehicleMakeModal
        isOpen={showMakeModal}
        onClose={() => {
          setShowMakeModal(false)
          setPendingNewName('')
        }}
        onCreated={(make) => {
          setMakes([...makes, make])
          setFormData({
            ...formData,
            makeId: make.id,
            make: make.name,
            modelId: '',
            model: '',
          })
          fetchModels(make.id)
        }}
        initialName={pendingNewName}
      />

      <VehicleModelModal
        isOpen={showModelModal}
        onClose={() => {
          setShowModelModal(false)
          setPendingNewName('')
        }}
        onCreated={(model) => {
          setModels([...models, model])
          setFormData({
            ...formData,
            modelId: model.id,
            model: model.name,
          })
        }}
        makes={makes}
        selectedMakeId={formData.makeId}
        initialName={pendingNewName}
      />
    </>
  )
}

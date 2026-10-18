'use client'

import { useState, useEffect } from 'react'
import { toast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { VehicleMakeModal } from './VehicleMakeModal'
import { VehicleModelModal } from './VehicleModelModal'
import { CustomerFormModal } from './CustomerFormModal'

interface Customer {
  id: string
  name: string
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

interface VehicleModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (vehicle: {
    id: string
    make: string
    model: string
    year: number | null
    licensePlate: string | null
    customerId: string | null
  }) => void
  customers: Customer[]
  makes: VehicleMake[]
  onMakesUpdated: () => void
  onCustomersUpdated?: () => void
  selectedCustomerId?: string
}

export function VehicleModal({
  isOpen,
  onClose,
  onCreated,
  customers,
  makes,
  onMakesUpdated,
  onCustomersUpdated,
  selectedCustomerId = ''
}: VehicleModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [models, setModels] = useState<VehicleModel[]>([])
  const [formData, setFormData] = useState({
    customerId: selectedCustomerId,
    makeId: '',
    make: '',
    modelId: '',
    model: '',
    year: '',
    vin: '',
    licensePlate: '',
    color: '',
    notes: '',
  })

  // Modal states for inline creation
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [pendingCustomerName, setPendingCustomerName] = useState('')
  const [showMakeModal, setShowMakeModal] = useState(false)
  const [pendingMakeName, setPendingMakeName] = useState('')
  const [showModelModal, setShowModelModal] = useState(false)
  const [pendingModelName, setPendingModelName] = useState('')

  useEffect(() => {
    if (isOpen) {
      setFormData(prev => ({ ...prev, customerId: selectedCustomerId }))
      setError('')
    }
  }, [isOpen, selectedCustomerId])

  async function fetchModels(makeId: string) {
    try {
      const res = await fetch(`/api/vehicle-models?makeId=${makeId}`)
      if (res.ok) {
        const data = await res.json()
        setModels(Array.isArray(data) ? data : [])
      } else {
        toast.error('Failed to load vehicle models')
      }
    } catch (error) {
      console.error('Error fetching models:', error)
      toast.error('Failed to load vehicle models')
    }
  }

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
    setSaving(true)
    setError('')

    if (!formData.make || !formData.model) {
      setError('Make and model are required')
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: formData.customerId || null,
          make: formData.make,
          model: formData.model,
          year: formData.year ? parseInt(formData.year) : null,
          vin: formData.vin || null,
          licensePlate: formData.licensePlate || null,
          color: formData.color || null,
          notes: formData.notes || null,
        }),
      })

      if (res.ok) {
        const vehicle = await res.json()
        onCreated(vehicle)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create vehicle')
      }
    } catch {
      setError('Failed to create vehicle')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({
      customerId: '',
      makeId: '',
      make: '',
      modelId: '',
      model: '',
      year: '',
      vin: '',
      licensePlate: '',
      color: '',
      notes: '',
    })
    setModels([])
    setError('')
    onClose()
  }

  function handleCustomerCreated(customer: { id: string; name: string }) {
    onCustomersUpdated?.()
    setFormData({ ...formData, customerId: customer.id })
  }

  function handleMakeCreated(make: { id: string; name: string }) {
    onMakesUpdated()
    setFormData({
      ...formData,
      makeId: make.id,
      make: make.name,
      modelId: '',
      model: '',
    })
    fetchModels(make.id)
  }

  function handleModelCreated(model: { id: string; name: string; makeId: string }) {
    fetchModels(model.makeId)
    setFormData({
      ...formData,
      modelId: model.id,
      model: model.name,
    })
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title="New Vehicle" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Customer</label>
              <CreatableSelect
                options={customers.map(c => ({ value: c.id, label: c.name }))}
                value={formData.customerId}
                onChange={(value) => setFormData({ ...formData, customerId: value })}
                onCreateNew={(name) => {
                  setPendingCustomerName(name)
                  setShowCustomerModal(true)
                }}
                placeholder="Select or add customer"
                createLabel="Add customer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Make *</label>
              <CreatableSelect
                options={makes.map(m => ({ value: m.id, label: m.name }))}
                value={formData.makeId}
                onChange={handleMakeChange}
                onCreateNew={(name) => {
                  setPendingMakeName(name)
                  setShowMakeModal(true)
                }}
                placeholder="Select or add make"
                createLabel="Add make"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model *</label>
              <CreatableSelect
                options={models.map(m => ({ value: m.id, label: m.name }))}
                value={formData.modelId}
                onChange={handleModelChange}
                onCreateNew={(name) => {
                  setPendingModelName(name)
                  setShowModelModal(true)
                }}
                placeholder={formData.makeId ? "Select or add model" : "Select make first"}
                createLabel="Add model"
                disabled={!formData.makeId}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Year</label>
              <input
                type="number"
                min="1900"
                max="2100"
                value={formData.year}
                onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">License Plate</label>
              <input
                type="text"
                value={formData.licensePlate}
                onChange={(e) => setFormData({ ...formData, licensePlate: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., ABC-1234"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">VIN / Chassis Number</label>
              <input
                type="text"
                value={formData.vin}
                onChange={(e) => setFormData({ ...formData, vin: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>


            <div>
              <label className="block text-sm font-medium mb-1">Color</label>
              <input
                type="text"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Vehicle'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Inline creation modals */}
      <CustomerFormModal
        isOpen={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false)
          setPendingCustomerName('')
        }}
        onSaved={handleCustomerCreated}
        initialName={pendingCustomerName}
      />

      <VehicleMakeModal
        isOpen={showMakeModal}
        onClose={() => {
          setShowMakeModal(false)
          setPendingMakeName('')
        }}
        onCreated={handleMakeCreated}
        initialName={pendingMakeName}
      />

      <VehicleModelModal
        isOpen={showModelModal}
        onClose={() => {
          setShowModelModal(false)
          setPendingModelName('')
        }}
        onCreated={handleModelCreated}
        initialName={pendingModelName}
        makes={makes}
        selectedMakeId={formData.makeId}
      />
    </>
  )
}

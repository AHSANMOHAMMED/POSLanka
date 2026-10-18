'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { Car, DollarSign, Settings2, Info } from 'lucide-react'

type TabType = 'basic' | 'details' | 'pricing'

interface VehicleMake {
  id: string
  name: string
}

interface VehicleModel {
  id: string
  name: string
  makeId: string
}

interface EditableVehicleItem {
  id: string
  stockNo?: string
  makeId?: string
  make?: string
  modelId?: string
  model?: string
  year?: number | null
  trim?: string | null
  exteriorColor?: string | null
  interiorColor?: string | null
  vin?: string | null
  mileage?: number | null
  condition?: string
  bodyType?: string | null
  engine?: string | null
  transmission?: string | null
  fuelType?: string | null
  drivetrain?: string | null
  purchasePrice?: string | null
  askingPrice?: string | null
  minimumPrice?: string | null
  location?: string | null
  description?: string | null
  status?: string
}

interface VehicleInventoryFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editItem?: EditableVehicleItem | null
}

const initialFormData = {
  stockNo: '',
  makeId: '',
  make: '',
  modelId: '',
  model: '',
  year: '',
  trim: '',
  exteriorColor: '',
  interiorColor: '',
  vin: '',
  mileage: '',
  condition: 'used' as string,
  bodyType: '',
  engine: '',
  transmission: '',
  fuelType: '',
  drivetrain: '',
  purchasePrice: '',
  askingPrice: '',
  minimumPrice: '',
  location: '',
  description: '',
  status: 'available',
}

export function VehicleInventoryFormModal({ isOpen, onClose, onSuccess, editItem }: VehicleInventoryFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('basic')
  const [formData, setFormData] = useState(initialFormData)

  // Dropdown data
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])

  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes?all=true')
      if (res.ok) {
        const data = await res.json()
        setMakes(data)
      }
    } catch (error) {
      console.error('Error fetching makes:', error)
    }
  }, [])

  const fetchModels = useCallback(async (makeId: string) => {
    if (!makeId) {
      setModels([])
      return
    }
    try {
      const res = await fetch(`/api/vehicle-models?all=true&makeId=${makeId}`)
      if (res.ok) {
        const data = await res.json()
        setModels(data)
      }
    } catch (error) {
      console.error('Error fetching models:', error)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchMakes()
      if (editItem) {
        const makeId = editItem.makeId || ''
        setFormData({
          stockNo: editItem.stockNo || '',
          makeId,
          make: editItem.make || '',
          modelId: editItem.modelId || '',
          model: editItem.model || '',
          year: editItem.year != null ? String(editItem.year) : '',
          trim: editItem.trim || '',
          exteriorColor: editItem.exteriorColor || '',
          interiorColor: editItem.interiorColor || '',
          vin: editItem.vin || '',
          mileage: editItem.mileage != null ? String(editItem.mileage) : '',
          condition: editItem.condition || 'used',
          bodyType: editItem.bodyType || '',
          engine: editItem.engine || '',
          transmission: editItem.transmission || '',
          fuelType: editItem.fuelType || '',
          drivetrain: editItem.drivetrain || '',
          purchasePrice: editItem.purchasePrice || '',
          askingPrice: editItem.askingPrice || '',
          minimumPrice: editItem.minimumPrice || '',
          location: editItem.location || '',
          description: editItem.description || '',
          status: editItem.status || 'available',
        })
        if (makeId) fetchModels(makeId)
      } else {
        resetForm()
      }
    }
  }, [isOpen, editItem, fetchMakes, fetchModels])

  function resetForm() {
    setFormData(initialFormData)
    setActiveTab('basic')
    setError('')
    setModels([])
  }

  function handleMakeChange(makeId: string) {
    const selectedMake = makes.find(m => m.id === makeId)
    setFormData(prev => ({
      ...prev,
      makeId,
      make: selectedMake?.name || '',
      modelId: '',
      model: '',
    }))
    fetchModels(makeId)
  }

  function handleModelChange(modelId: string) {
    const selectedModel = models.find(m => m.id === modelId)
    setFormData(prev => ({
      ...prev,
      modelId,
      model: selectedModel?.name || '',
    }))
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.make && !formData.makeId) {
      setError('Make is required')
      return
    }
    if (!formData.model && !formData.modelId) {
      setError('Model is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const isEdit = editItem?.id
      const url = isEdit ? `/api/vehicle-inventory/${editItem.id}` : '/api/vehicle-inventory'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stockNo: formData.stockNo || null,
          make: formData.make || (makes.find(m => m.id === formData.makeId)?.name || ''),
          model: formData.model || (models.find(m => m.id === formData.modelId)?.name || ''),
          year: formData.year ? parseInt(formData.year) : null,
          trim: formData.trim || null,
          exteriorColor: formData.exteriorColor || null,
          interiorColor: formData.interiorColor || null,
          vin: formData.vin || null,
          mileage: formData.mileage ? parseInt(formData.mileage) : null,
          condition: formData.condition,
          bodyType: formData.bodyType || null,
          engine: formData.engine || null,
          transmission: formData.transmission || null,
          fuelType: formData.fuelType || null,
          drivetrain: formData.drivetrain || null,
          purchasePrice: formData.purchasePrice ? parseFloat(formData.purchasePrice) : null,
          askingPrice: formData.askingPrice ? parseFloat(formData.askingPrice) : null,
          minimumPrice: formData.minimumPrice ? parseFloat(formData.minimumPrice) : null,
          location: formData.location || null,
          description: formData.description || null,
          status: formData.status,
        }),
      })

      if (res.ok) {
        toast.success(isEdit ? 'Vehicle updated successfully' : 'Vehicle added to inventory')
        onSuccess()
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

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'basic', label: 'Basic', icon: <Car size={16} /> },
    { key: 'details', label: 'Details', icon: <Settings2 size={16} /> },
    { key: 'pricing', label: 'Pricing', icon: <DollarSign size={16} /> },
  ]

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={editItem ? 'Edit Vehicle' : 'Add Vehicle'} size="2xl">
      <form id="vehicle-inventory-form" onSubmit={handleSubmit} className="flex flex-col h-full">
        {error && (
          <div className="p-3 mb-4 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b dark:border-gray-700 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
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
        <div className="flex-1 overflow-y-auto space-y-4">
          {activeTab === 'basic' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FormLabel htmlFor="stockNo">Stock No</FormLabel>
                  <FormInput
                    id="stockNo"
                    value={formData.stockNo}
                    onChange={(e) => setFormData(prev => ({ ...prev, stockNo: e.target.value }))}
                    placeholder="Auto-generated if empty"
                  />
                </div>
                <div>
                  <FormLabel htmlFor="status">Status</FormLabel>
                  <FormSelect
                    id="status"
                    value={formData.status}
                    onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                  >
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="in_preparation">In Preparation</option>
                    <option value="in_transit">In Transit</option>
                    <option value="sold">Sold</option>
                  </FormSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FormLabel htmlFor="makeId">Make *</FormLabel>
                  <FormSelect
                    id="makeId"
                    value={formData.makeId}
                    onChange={(e) => handleMakeChange(e.target.value)}
                    required
                  >
                    <option value="">Select make</option>
                    {makes.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </FormSelect>
                </div>
                <div>
                  <FormLabel htmlFor="modelId">Model *</FormLabel>
                  <FormSelect
                    id="modelId"
                    value={formData.modelId}
                    onChange={(e) => handleModelChange(e.target.value)}
                    required
                  >
                    <option value="">Select model</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </FormSelect>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <FormLabel htmlFor="year">Year</FormLabel>
                  <FormInput
                    id="year"
                    type="number"
                    value={formData.year}
                    onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
                    placeholder="e.g., 2024"
                    min="1900"
                    max="2100"
                  />
                </div>
                <div>
                  <FormLabel htmlFor="trim">Trim</FormLabel>
                  <FormInput
                    id="trim"
                    value={formData.trim}
                    onChange={(e) => setFormData(prev => ({ ...prev, trim: e.target.value }))}
                    placeholder="e.g., Sport, Limited"
                  />
                </div>
                <div>
                  <FormLabel htmlFor="condition">Condition</FormLabel>
                  <FormSelect
                    id="condition"
                    value={formData.condition}
                    onChange={(e) => setFormData(prev => ({ ...prev, condition: e.target.value }))}
                  >
                    <option value="new">New</option>
                    <option value="used">Used</option>
                    <option value="certified_preowned">Certified Pre-Owned</option>
                  </FormSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FormLabel htmlFor="exteriorColor">Exterior Color</FormLabel>
                  <FormInput
                    id="exteriorColor"
                    value={formData.exteriorColor}
                    onChange={(e) => setFormData(prev => ({ ...prev, exteriorColor: e.target.value }))}
                    placeholder="e.g., White Pearl"
                  />
                </div>
                <div>
                  <FormLabel htmlFor="interiorColor">Interior Color</FormLabel>
                  <FormInput
                    id="interiorColor"
                    value={formData.interiorColor}
                    onChange={(e) => setFormData(prev => ({ ...prev, interiorColor: e.target.value }))}
                    placeholder="e.g., Black Leather"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FormLabel htmlFor="vin">VIN</FormLabel>
                  <FormInput
                    id="vin"
                    value={formData.vin}
                    onChange={(e) => setFormData(prev => ({ ...prev, vin: e.target.value.toUpperCase() }))}
                    placeholder="17-character VIN"
                    maxLength={17}
                  />
                </div>
                <div>
                  <FormLabel htmlFor="mileage">Mileage</FormLabel>
                  <FormInput
                    id="mileage"
                    type="number"
                    value={formData.mileage}
                    onChange={(e) => setFormData(prev => ({ ...prev, mileage: e.target.value }))}
                    placeholder="e.g., 35000"
                    min="0"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'details' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FormLabel htmlFor="bodyType">Body Type</FormLabel>
                  <FormSelect
                    id="bodyType"
                    value={formData.bodyType}
                    onChange={(e) => setFormData(prev => ({ ...prev, bodyType: e.target.value }))}
                  >
                    <option value="">Select body type</option>
                    <option value="sedan">Sedan</option>
                    <option value="suv">SUV</option>
                    <option value="truck">Truck</option>
                    <option value="coupe">Coupe</option>
                    <option value="convertible">Convertible</option>
                    <option value="hatchback">Hatchback</option>
                    <option value="wagon">Wagon</option>
                    <option value="van">Van</option>
                    <option value="minivan">Minivan</option>
                    <option value="crossover">Crossover</option>
                  </FormSelect>
                </div>
                <div>
                  <FormLabel htmlFor="engine">Engine</FormLabel>
                  <FormInput
                    id="engine"
                    value={formData.engine}
                    onChange={(e) => setFormData(prev => ({ ...prev, engine: e.target.value }))}
                    placeholder="e.g., 2.0L Turbo I4"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FormLabel htmlFor="transmission">Transmission</FormLabel>
                  <FormSelect
                    id="transmission"
                    value={formData.transmission}
                    onChange={(e) => setFormData(prev => ({ ...prev, transmission: e.target.value }))}
                  >
                    <option value="">Select transmission</option>
                    <option value="automatic">Automatic</option>
                    <option value="manual">Manual</option>
                    <option value="cvt">CVT</option>
                    <option value="dct">DCT (Dual Clutch)</option>
                    <option value="other">Other</option>
                  </FormSelect>
                </div>
                <div>
                  <FormLabel htmlFor="fuelType">Fuel Type</FormLabel>
                  <FormSelect
                    id="fuelType"
                    value={formData.fuelType}
                    onChange={(e) => setFormData(prev => ({ ...prev, fuelType: e.target.value }))}
                  >
                    <option value="">Select fuel type</option>
                    <option value="gasoline">Gasoline</option>
                    <option value="diesel">Diesel</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="electric">Electric</option>
                    <option value="plug_in_hybrid">Plug-in Hybrid</option>
                    <option value="flex_fuel">Flex Fuel</option>
                  </FormSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FormLabel htmlFor="drivetrain">Drivetrain</FormLabel>
                  <FormSelect
                    id="drivetrain"
                    value={formData.drivetrain}
                    onChange={(e) => setFormData(prev => ({ ...prev, drivetrain: e.target.value }))}
                  >
                    <option value="">Select drivetrain</option>
                    <option value="fwd">FWD (Front-Wheel Drive)</option>
                    <option value="rwd">RWD (Rear-Wheel Drive)</option>
                    <option value="awd">AWD (All-Wheel Drive)</option>
                    <option value="4wd">4WD (Four-Wheel Drive)</option>
                  </FormSelect>
                </div>
                <div>
                  <FormLabel htmlFor="location">Location</FormLabel>
                  <FormInput
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="e.g., Lot A, Bay 5"
                  />
                </div>
              </div>

              <div>
                <FormLabel htmlFor="description">Description</FormLabel>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Vehicle description and notes..."
                  rows={4}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </>
          )}

          {activeTab === 'pricing' && (
            <>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 flex items-start gap-2 mb-4">
                <Info size={16} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Set competitive pricing for this vehicle. The margin is calculated automatically based on purchase and asking prices.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <FormLabel htmlFor="purchasePrice">Purchase Price</FormLabel>
                  <FormInput
                    id="purchasePrice"
                    type="number"
                    value={formData.purchasePrice}
                    onChange={(e) => setFormData(prev => ({ ...prev, purchasePrice: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <FormLabel htmlFor="askingPrice">Asking Price</FormLabel>
                  <FormInput
                    id="askingPrice"
                    type="number"
                    value={formData.askingPrice}
                    onChange={(e) => setFormData(prev => ({ ...prev, askingPrice: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <FormLabel htmlFor="minimumPrice">Minimum Price</FormLabel>
                  <FormInput
                    id="minimumPrice"
                    type="number"
                    value={formData.minimumPrice}
                    onChange={(e) => setFormData(prev => ({ ...prev, minimumPrice: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              {/* Margin Preview */}
              {formData.purchasePrice && formData.askingPrice && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cost</div>
                      <div className="text-lg font-bold text-gray-900 dark:text-white">
                        {parseFloat(formData.purchasePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Profit</div>
                      <div className={`text-lg font-bold ${
                        parseFloat(formData.askingPrice) - parseFloat(formData.purchasePrice) >= 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {(parseFloat(formData.askingPrice) - parseFloat(formData.purchasePrice)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Margin</div>
                      <div className={`text-lg font-bold ${
                        parseFloat(formData.askingPrice) >= parseFloat(formData.purchasePrice)
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {((parseFloat(formData.askingPrice) - parseFloat(formData.purchasePrice)) / parseFloat(formData.purchasePrice) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 mt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : editItem ? 'Update Vehicle' : 'Add Vehicle'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

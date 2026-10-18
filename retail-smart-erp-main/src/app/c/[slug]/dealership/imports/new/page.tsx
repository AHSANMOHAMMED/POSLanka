'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Home, ChevronRight, Save, Calculator, Ship,
  FileText, DollarSign, Car, Loader2
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { SRI_LANKA_PORTS, IMPORT_CURRENCIES } from '@/lib/dealership/tax-rates'

interface VehicleMake {
  id: string
  name: string
}

interface VehicleModel {
  id: string
  name: string
  makeId: string
}

interface Supplier {
  id: string
  name: string
}

interface TaxBreakdown {
  cifValueLkr: number
  customsImportDuty: number
  customsImportDutyRate: number
  surcharge: number
  surchargeRate: number
  exciseDuty: number
  exciseDutyRate: number
  luxuryTax: number
  luxuryTaxRate: number
  palCharge: number
  palRate: number
  cessFee: number
  cessRate: number
  vatAmount: number
  vatRate: number
  totalTaxes: number
  totalLandedCost: number
}

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric'] as const
const VEHICLE_TYPES = ['car', 'suv', 'van', 'truck', 'bus', 'motorcycle'] as const
const CONDITIONS = ['new', 'used'] as const

export default function NewImportPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()

  // Reference data
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Form state - Vehicle Info
  const [makeId, setMakeId] = useState('')
  const [modelId, setModelId] = useState('')
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [vin, setVin] = useState('')
  const [engineCc, setEngineCc] = useState<number>(0)
  const [enginePowerKw, setEnginePowerKw] = useState<number>(0)
  const [fuelType, setFuelType] = useState<string>('petrol')
  const [vehicleType, setVehicleType] = useState<string>('car')
  const [condition, setCondition] = useState<string>('new')

  // Form state - Supplier & References
  const [supplierId, setSupplierId] = useState('')
  const [billOfLadingNo, setBillOfLadingNo] = useState('')
  const [lcNo, setLcNo] = useState('')
  const [customsDeclarationNo, setCustomsDeclarationNo] = useState('')
  const [portOfEntry, setPortOfEntry] = useState('')
  const [importCountry, setImportCountry] = useState('')

  // Form state - CIF Components
  const [fobValue, setFobValue] = useState<number>(0)
  const [freightCost, setFreightCost] = useState<number>(0)
  const [insuranceCost, setInsuranceCost] = useState<number>(0)
  const [cifCurrency, setCifCurrency] = useState('USD')
  const [exchangeRate, setExchangeRate] = useState<number>(0)

  // Tax calculation
  const [taxBreakdown, setTaxBreakdown] = useState<TaxBreakdown | null>(null)
  const [calculating, setCalculating] = useState(false)

  // UI state
  const [saving, setSaving] = useState(false)
  const [createdImportId, setCreatedImportId] = useState<string | null>(null)

  // Auto-calculate CIF value
  const cifValue = useMemo(() => fobValue + freightCost + insuranceCost, [fobValue, freightCost, insuranceCost])
  const cifValueLkr = useMemo(() => cifValue * exchangeRate, [cifValue, exchangeRate])

  // Fetch reference data
  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes')
      if (res.ok) {
        const data = await res.json()
        setMakes(data)
      }
    } catch (error) {
      console.error('Failed to fetch makes:', error)
    }
  }, [])

  const fetchModels = useCallback(async (selectedMakeId: string) => {
    if (!selectedMakeId) {
      setModels([])
      return
    }
    try {
      const res = await fetch(`/api/vehicle-models?makeId=${selectedMakeId}`)
      if (res.ok) {
        const data = await res.json()
        setModels(data)
      }
    } catch (error) {
      console.error('Failed to fetch models:', error)
    }
  }, [])

  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await fetch('/api/suppliers?all=true')
      if (res.ok) {
        const data = await res.json()
        setSuppliers(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch suppliers:', error)
    }
  }, [])

  useEffect(() => {
    fetchMakes()
    fetchSuppliers()
  }, [fetchMakes, fetchSuppliers])

  useEffect(() => {
    if (makeId) {
      fetchModels(makeId)
      setModelId('')
    }
  }, [makeId, fetchModels])

  // Save import record
  async function handleSave() {
    if (!fobValue || !exchangeRate) {
      toast.error('FOB Value and Exchange Rate are required')
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        fobValue,
        freightCost,
        insuranceCost,
        cifValue,
        cifCurrency,
        exchangeRate,
        cifValueLkr,
        engineCapacityCc: engineCc || null,
        enginePowerKw: enginePowerKw || null,
        yearOfManufacture: year || null,
        importCountry: importCountry || null,
        billOfLadingNo: billOfLadingNo || null,
        lcNo: lcNo || null,
        customsDeclarationNo: customsDeclarationNo || null,
        portOfEntry: portOfEntry || null,
        supplierId: supplierId || null,
        status: 'pending',
      }

      // Include tax data if calculated
      if (taxBreakdown) {
        payload.customsImportDuty = taxBreakdown.customsImportDuty
        payload.customsImportDutyRate = taxBreakdown.customsImportDutyRate
        payload.surcharge = taxBreakdown.surcharge
        payload.surchargeRate = taxBreakdown.surchargeRate
        payload.exciseDuty = taxBreakdown.exciseDuty
        payload.exciseDutyRate = taxBreakdown.exciseDutyRate
        payload.luxuryTax = taxBreakdown.luxuryTax
        payload.luxuryTaxRate = taxBreakdown.luxuryTaxRate
        payload.vatAmount = taxBreakdown.vatAmount
        payload.vatRate = taxBreakdown.vatRate
        payload.palCharge = taxBreakdown.palCharge
        payload.cessFee = taxBreakdown.cessFee
        payload.totalTaxes = taxBreakdown.totalTaxes
        payload.totalLandedCost = taxBreakdown.totalLandedCost
      }

      const res = await fetch('/api/vehicle-imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to create import')
        return
      }

      const newImport = await res.json()
      setCreatedImportId(newImport.id)
      toast.success(`Import ${newImport.importNo} created successfully`)
      router.push(`/c/${tenantSlug}/dealership/imports/${newImport.id}`)
    } catch (error) {
      console.error('Failed to create import:', error)
      toast.error('Failed to create import')
    } finally {
      setSaving(false)
    }
  }

  // Calculate taxes (requires saved record)
  async function handleCalculateTaxes() {
    if (!fobValue || !exchangeRate) {
      toast.error('FOB Value and Exchange Rate are required to calculate taxes')
      return
    }

    setCalculating(true)
    try {
      // If we already have a created import, use the calculate-tax endpoint
      if (createdImportId) {
        const res = await fetch(`/api/vehicle-imports/${createdImportId}/calculate-tax`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fobValue,
            freightCost,
            insuranceCost,
            exchangeRate,
            engineCapacityCc: engineCc,
            enginePowerKw: enginePowerKw || undefined,
            fuelType,
            vehicleType,
            condition,
            yearOfManufacture: year,
          }),
        })

        if (!res.ok) {
          const err = await res.json()
          toast.error(err.error || 'Failed to calculate taxes')
          return
        }

        const result = await res.json()
        setTaxBreakdown(result.breakdown)
        toast.success('Taxes calculated successfully')
      } else {
        // First create the import, then calculate taxes
        const createPayload = {
          fobValue,
          freightCost,
          insuranceCost,
          cifValue,
          cifCurrency,
          exchangeRate,
          cifValueLkr,
          engineCapacityCc: engineCc || null,
          enginePowerKw: enginePowerKw || null,
          yearOfManufacture: year || null,
          importCountry: importCountry || null,
          billOfLadingNo: billOfLadingNo || null,
          lcNo: lcNo || null,
          customsDeclarationNo: customsDeclarationNo || null,
          portOfEntry: portOfEntry || null,
          supplierId: supplierId || null,
          status: 'pending',
        }

        const createRes = await fetch('/api/vehicle-imports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload),
        })

        if (!createRes.ok) {
          const err = await createRes.json()
          toast.error(err.error || 'Failed to create import')
          return
        }

        const newImport = await createRes.json()
        setCreatedImportId(newImport.id)

        // Now calculate taxes
        const taxRes = await fetch(`/api/vehicle-imports/${newImport.id}/calculate-tax`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fobValue,
            freightCost,
            insuranceCost,
            exchangeRate,
            engineCapacityCc: engineCc,
            enginePowerKw: enginePowerKw || undefined,
            fuelType,
            vehicleType,
            condition,
            yearOfManufacture: year,
          }),
        })

        if (!taxRes.ok) {
          const err = await taxRes.json()
          toast.error(err.error || 'Failed to calculate taxes')
          return
        }

        const result = await taxRes.json()
        setTaxBreakdown(result.breakdown)
        toast.success(`Import ${newImport.importNo} created and taxes calculated`)
      }
    } catch (error) {
      console.error('Failed to calculate taxes:', error)
      toast.error('Failed to calculate taxes')
    } finally {
      setCalculating(false)
    }
  }

  const _selectedMakeName = makes.find(m => m.id === makeId)?.name || ''
  const _selectedModelName = models.find(m => m.id === modelId)?.name || ''

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/dealership/imports`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Vehicle Imports
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">New Import</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/c/${tenantSlug}/dealership/imports`)}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New Vehicle Import</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Create a new import record with CIF and tax calculations
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCalculateTaxes}
            disabled={calculating || !fobValue || !exchangeRate}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {calculating ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />}
            Calculate Taxes
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !fobValue || !exchangeRate}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Import
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Vehicle Info */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Car size={18} className="text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Vehicle Information</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Make</label>
                  <select
                    value={makeId}
                    onChange={(e) => setMakeId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select make...</option>
                    {makes.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Model</label>
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    disabled={!makeId}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                  >
                    <option value="">Select model...</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Year</label>
                  <input
                    type="number"
                    value={year || ''}
                    onChange={(e) => setYear(parseInt(e.target.value) || 0)}
                    placeholder="e.g. 2024"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">VIN</label>
                  <input
                    type="text"
                    value={vin}
                    onChange={(e) => setVin(e.target.value)}
                    placeholder="Vehicle Identification Number"
                    className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Engine CC</label>
                  <input
                    type="number"
                    value={engineCc || ''}
                    onChange={(e) => setEngineCc(parseInt(e.target.value) || 0)}
                    placeholder="e.g. 1500"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Engine Power (kW)</label>
                  <input
                    type="number"
                    value={enginePowerKw || ''}
                    onChange={(e) => setEnginePowerKw(parseFloat(e.target.value) || 0)}
                    placeholder="For electric vehicles"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Fuel Type</label>
                  <select
                    value={fuelType}
                    onChange={(e) => setFuelType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {FUEL_TYPES.map((ft) => (
                      <option key={ft} value={ft}>{ft.charAt(0).toUpperCase() + ft.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Vehicle Type</label>
                  <select
                    value={vehicleType}
                    onChange={(e) => setVehicleType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {VEHICLE_TYPES.map((vt) => (
                      <option key={vt} value={vt}>{vt.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Condition</label>
                  <div className="flex gap-4">
                    {CONDITIONS.map((c) => (
                      <label key={c} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="condition"
                          value={c}
                          checked={condition === c}
                          onChange={(e) => setCondition(e.target.value)}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{c}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Supplier & References */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Ship size={18} className="text-purple-600" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Supplier & References</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Supplier</label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Bill of Lading No</label>
                  <input
                    type="text"
                    value={billOfLadingNo}
                    onChange={(e) => setBillOfLadingNo(e.target.value)}
                    placeholder="e.g. MSKU1234567"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">LC No</label>
                  <input
                    type="text"
                    value={lcNo}
                    onChange={(e) => setLcNo(e.target.value)}
                    placeholder="Letter of Credit No"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Customs Declaration No</label>
                  <input
                    type="text"
                    value={customsDeclarationNo}
                    onChange={(e) => setCustomsDeclarationNo(e.target.value)}
                    placeholder="CUSDEC number"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Port of Entry</label>
                  <select
                    value={portOfEntry}
                    onChange={(e) => setPortOfEntry(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select port...</option>
                    {SRI_LANKA_PORTS.map((port) => (
                      <option key={port} value={port}>{port}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Import Country</label>
                  <input
                    type="text"
                    value={importCountry}
                    onChange={(e) => setImportCountry(e.target.value)}
                    placeholder="e.g. Japan, United Kingdom"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* CIF Components */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <DollarSign size={18} className="text-green-600" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">CIF Components</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">FOB Value *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={fobValue || ''}
                    onChange={(e) => setFobValue(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Freight Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={freightCost || ''}
                    onChange={(e) => setFreightCost(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Insurance Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={insuranceCost || ''}
                    onChange={(e) => setInsuranceCost(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">CIF Currency</label>
                  <select
                    value={cifCurrency}
                    onChange={(e) => setCifCurrency(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {IMPORT_CURRENCIES.map((cur) => (
                      <option key={cur.code} value={cur.code}>{cur.code} - {cur.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Exchange Rate (to LKR) *</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={exchangeRate || ''}
                    onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                    placeholder="0.000000"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* CIF Summary */}
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600 dark:text-gray-400">CIF Value ({cifCurrency})</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {cifValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {exchangeRate > 0 && (
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-gray-600 dark:text-gray-400">CIF Value (LKR)</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">
                      LKR {cifValueLkr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  FOB ({fobValue.toLocaleString()}) + Freight ({freightCost.toLocaleString()}) + Insurance ({insuranceCost.toLocaleString()}) = CIF ({cifValue.toLocaleString()})
                </div>
              </div>
            </div>
          </div>

          {/* Tax Breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <FileText size={18} className="text-orange-600" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Tax Calculation</h2>
            </div>
            <div className="p-4">
              {!taxBreakdown ? (
                <div className="text-center py-8">
                  <Calculator size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Fill in the CIF components and vehicle details, then click &quot;Calculate Taxes&quot; to see the full breakdown.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <TaxRow label="Customs Import Duty (CID)" rate={taxBreakdown.customsImportDutyRate} amount={taxBreakdown.customsImportDuty} />
                  <TaxRow label="Surcharge" rate={taxBreakdown.surchargeRate} amount={taxBreakdown.surcharge} rateNote="of CID" />
                  <TaxRow label="Excise Duty" rate={taxBreakdown.exciseDutyRate} amount={taxBreakdown.exciseDuty} />
                  <TaxRow label="Luxury Tax" rate={taxBreakdown.luxuryTaxRate} amount={taxBreakdown.luxuryTax} />
                  <TaxRow label="PAL (Port Authority Levy)" rate={taxBreakdown.palRate} amount={taxBreakdown.palCharge} />
                  <TaxRow label="CESS" rate={taxBreakdown.cessRate} amount={taxBreakdown.cessFee} rateNote="of CID+Sur" />
                  <TaxRow label="VAT" rate={taxBreakdown.vatRate} amount={taxBreakdown.vatAmount} />

                  <hr className="border-gray-200 dark:border-gray-700" />
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span className="text-gray-700 dark:text-gray-300">Total Taxes</span>
                    <span className="text-red-600 dark:text-red-400">
                      LKR {taxBreakdown.totalTaxes.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">Total Landed Cost</span>
                      <span className="text-lg font-bold text-green-600 dark:text-green-400">
                        LKR {taxBreakdown.totalLandedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      CIF (LKR {taxBreakdown.cifValueLkr?.toLocaleString()}) + Taxes (LKR {taxBreakdown.totalTaxes.toLocaleString()})
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaxRow({ label, rate, amount, rateNote }: { label: string; rate: number; amount: number; rateNote?: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-600 dark:text-gray-400">
        {label}
        <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
          ({rate}%{rateNote ? ` ${rateNote}` : ''})
        </span>
      </span>
      <span className="text-gray-900 dark:text-white font-medium">
        LKR {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  )
}

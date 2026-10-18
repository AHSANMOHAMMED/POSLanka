'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { CategoryModal } from './CategoryModal'
import { SupplierModal } from './SupplierModal'
import { toast } from '@/components/ui/toast'
import { isValidPositiveNumber } from '@/lib/utils/validation'
import { Package, Tag, DollarSign, Boxes, Truck, Ruler, Leaf, Snowflake, Car, Plus, X, Loader2, Upload, Image as ImageIcon, History, ArrowRight } from 'lucide-react'
import { Pagination } from '@/components/ui/pagination'
import { useTerminology, useSmartWarnings } from '@/hooks'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { SmartWarningBanner } from '@/components/ai/SmartWarningBanner'
import { VehicleMakeModal } from './VehicleMakeModal'
import { VehicleModelModal } from './VehicleModelModal'

type TabType = 'basic' | 'pricing' | 'inventory' | 'supplier' | 'physical' | 'dietary' | 'freshness' | 'fits' | 'cost_tracking'

interface VehicleMake {
  id: string
  name: string
}

interface VehicleModel {
  id: string
  name: string
  makeId: string
}

interface CompatibilityEntry {
  id: string
  itemId: string
  makeId: string | null
  modelId: string | null
  yearFrom: number | null
  yearTo: number | null
  makeName: string | null
  modelName: string | null
}

interface Category {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
}

interface Item {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  categoryId: string | null
  costPrice: string
  sellingPrice: string
  currentStock: string
  minStock: string
  unit: string
  isActive: boolean
  trackStock: boolean
  trackBatches: boolean
  trackSerialNumbers: boolean
  // Auto parts fields
  oemPartNumber: string | null
  alternatePartNumbers: string[] | null
  brand: string | null
  condition: 'new' | 'refurbished' | 'used' | null
  supplierId: string | null
  supplierPartNumber: string | null
  leadTimeDays: number | null
  weight: string | null
  dimensions: string | null
  warrantyMonths: number | null
  imageUrl: string | null
  supersededBy: string | null
  // Restaurant fields
  preparationTime: number | null
  allergens: string[] | null
  calories: number | null
  isVegetarian: boolean
  isVegan: boolean
  isGlutenFree: boolean
  spiceLevel: string | null
  availableFrom: string | null
  availableTo: string | null
  // Supermarket fields
  pluCode: string | null
  shelfLifeDays: number | null
  storageTemp: string | null
  expiryDate: string | null
  // Gift card
  isGiftCard: boolean
  // Tax template
  taxTemplateId: string | null
}

interface ItemFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (item: { id: string }) => void
  editItem?: Item | null
}

export function ItemFormModal({ isOpen, onClose, onSaved, editItem }: ItemFormModalProps) {
  const t = useTerminology()
  const company = useCompanyOptional()
  const businessType = company?.businessType
  const isAutoService = businessType === 'auto_service' || businessType === 'dealership'
  const isRestaurant = businessType === 'restaurant'
  const isSupermarket = businessType === 'supermarket'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const priceWarnings = useSmartWarnings('price_change')
  const [warningBypassed, setWarningBypassed] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('basic')
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [pendingCategoryName, setPendingCategoryName] = useState('')
  const [pendingSupplierName, setPendingSupplierName] = useState('')

  // Compatibility (Fits) state
  const [compatEntries, setCompatEntries] = useState<CompatibilityEntry[]>([])
  const [compatLoading, setCompatLoading] = useState(false)
  const [showAddCompat, setShowAddCompat] = useState(false)
  const [compatMakes, setCompatMakes] = useState<VehicleMake[]>([])
  const [compatModels, setCompatModels] = useState<VehicleModel[]>([])
  const [compatForm, setCompatForm] = useState({ makeId: '', modelId: '', yearFrom: '', yearTo: '' })
  const [compatSaving, setCompatSaving] = useState(false)
  const [showMakeModal, setShowMakeModal] = useState(false)
  const [showModelModal, setShowModelModal] = useState(false)
  const [pendingMakeName, setPendingMakeName] = useState('')
  const [pendingModelName, setPendingModelName] = useState('')

  // Supplier Pricing / Cost History state
  interface SupplierCostRow { id: string; supplierName: string; lastCostPrice: string; totalPurchasedQty: string; lastPurchaseDate: string | null; lastPurchaseNo: string | null }
  interface CostHistoryRow { id: string; supplierName: string | null; source: string; previousCostPrice: string; newCostPrice: string; purchasePrice: string | null; quantity: string | null; stockBefore: string | null; stockAfter: string | null; referenceNo: string | null; createdByName: string | null; createdAt: string }
  const [supplierCosts, setSupplierCosts] = useState<SupplierCostRow[]>([])
  const [supplierCostsLoading, setSupplierCostsLoading] = useState(false)
  const [costHistory, setCostHistory] = useState<CostHistoryRow[]>([])
  const [costHistoryLoading, setCostHistoryLoading] = useState(false)
  const [costHistoryPage, setCostHistoryPage] = useState(1)
  const [costHistoryTotal, setCostHistoryTotal] = useState(0)
  const costHistoryPageSize = 10

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    barcode: '',
    categoryId: '',
    costPrice: '',
    sellingPrice: '',
    unit: 'pcs',
    trackStock: true,
    trackBatches: false,
    trackSerialNumbers: false,
    // Auto parts fields
    oemPartNumber: '',
    alternatePartNumbers: '',
    brand: '',
    condition: 'new' as 'new' | 'refurbished' | 'used',
    supplierId: '',
    supplierPartNumber: '',
    leadTimeDays: '',
    weight: '',
    dimensions: '',
    warrantyMonths: '',
    imageUrl: '',
    supersededBy: '',
    // Restaurant fields
    preparationTime: '',
    allergens: '' as string, // comma-separated
    calories: '',
    isVegetarian: false,
    isVegan: false,
    isGlutenFree: false,
    spiceLevel: '',
    availableFrom: '',
    availableTo: '',
    // Supermarket fields
    pluCode: '',
    shelfLifeDays: '',
    storageTemp: '',
    expiryDate: '',
    // Gift card
    isGiftCard: false,
    // Tax template
    taxTemplateId: '',
  })

  const [taxTemplates, setTaxTemplates] = useState<{ id: string; name: string }[]>([])

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories?all=true')
      if (res.ok) {
        const data = await res.json()
        setCategories(data)
      }
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }, [])

  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await fetch('/api/suppliers?all=true')
      if (res.ok) {
        const data = await res.json()
        setSuppliers(data)
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error)
    }
  }, [])

  const fetchTaxTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/accounting/tax-templates?all=true')
      if (res.ok) {
        const data = await res.json()
        const list = Array.isArray(data) ? data : data.data || []
        setTaxTemplates(list.filter((t: { isActive: boolean }) => t.isActive))
      }
    } catch {
      // Tax templates are optional - fail silently
    }
  }, [])

  const fetchCompatibility = useCallback(async (itemId: string) => {
    try {
      setCompatLoading(true)
      const res = await fetch(`/api/items/${itemId}/compatibility`)
      if (res.ok) {
        const data = await res.json()
        setCompatEntries(data)
      }
    } catch (err) {
      console.error('Error fetching compatibility:', err)
    } finally {
      setCompatLoading(false)
    }
  }, [])

  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes?all=true')
      if (res.ok) {
        const data = await res.json()
        setCompatMakes(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Error fetching makes:', err)
    }
  }, [])

  const fetchModels = useCallback(async (makeId: string) => {
    try {
      const res = await fetch(`/api/vehicle-models?makeId=${makeId}`)
      if (res.ok) {
        const data = await res.json()
        setCompatModels(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Error fetching models:', err)
    }
  }, [])

  const fetchSupplierCosts = useCallback(async (itemId: string) => {
    setSupplierCostsLoading(true)
    try {
      const res = await fetch(`/api/items/${itemId}/supplier-costs`)
      if (res.ok) setSupplierCosts(await res.json())
    } catch { /* ignore */ }
    setSupplierCostsLoading(false)
  }, [])

  const fetchCostHistory = useCallback(async (itemId: string, page: number) => {
    setCostHistoryLoading(true)
    try {
      const res = await fetch(`/api/items/${itemId}/cost-history?page=${page}&pageSize=${costHistoryPageSize}`)
      if (res.ok) {
        const json = await res.json()
        setCostHistory(json.data)
        setCostHistoryTotal(json.pagination.total)
      }
    } catch { /* ignore */ }
    setCostHistoryLoading(false)
  }, [costHistoryPageSize])

  useEffect(() => {
    if (isOpen) {
      fetchCategories()
      fetchSuppliers()
      fetchTaxTemplates()
      if (editItem) {
        setFormData({
          name: editItem.name,
          sku: editItem.sku || '',
          barcode: editItem.barcode || '',
          categoryId: editItem.categoryId || '',
          costPrice: editItem.costPrice,
          sellingPrice: editItem.sellingPrice,
          unit: editItem.unit,
          trackStock: editItem.trackStock,
          trackBatches: editItem.trackBatches || false,
          trackSerialNumbers: editItem.trackSerialNumbers || false,
          oemPartNumber: editItem.oemPartNumber || '',
          alternatePartNumbers: editItem.alternatePartNumbers?.join(', ') || '',
          brand: editItem.brand || '',
          condition: editItem.condition || 'new',
          supplierId: editItem.supplierId || '',
          supplierPartNumber: editItem.supplierPartNumber || '',
          leadTimeDays: editItem.leadTimeDays?.toString() || '',
          weight: editItem.weight || '',
          dimensions: editItem.dimensions || '',
          warrantyMonths: editItem.warrantyMonths?.toString() || '',
          imageUrl: editItem.imageUrl || '',
          supersededBy: editItem.supersededBy || '',
          // Restaurant fields
          preparationTime: editItem.preparationTime?.toString() || '',
          allergens: editItem.allergens?.join(', ') || '',
          calories: editItem.calories?.toString() || '',
          isVegetarian: editItem.isVegetarian || false,
          isVegan: editItem.isVegan || false,
          isGlutenFree: editItem.isGlutenFree || false,
          spiceLevel: editItem.spiceLevel || '',
          availableFrom: editItem.availableFrom || '',
          availableTo: editItem.availableTo || '',
          // Supermarket fields
          pluCode: editItem.pluCode || '',
          shelfLifeDays: editItem.shelfLifeDays?.toString() || '',
          storageTemp: editItem.storageTemp || '',
          expiryDate: editItem.expiryDate || '',
          // Gift card
          isGiftCard: editItem.isGiftCard || false,
          // Tax template
          taxTemplateId: editItem.taxTemplateId || '',
        })
        // Set image preview from existing URL
        setImagePreview(editItem.imageUrl || null)
        setImageFile(null)
        // Fetch compatibility data and makes for auto_service/dealership
        if (isAutoService) {
          fetchCompatibility(editItem.id)
          fetchMakes()
        }
      } else {
        resetForm()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editItem, fetchCategories, fetchSuppliers, fetchTaxTemplates, isAutoService, fetchCompatibility, fetchMakes])

  // Fetch supplier costs & history when the cost_tracking tab is activated
  useEffect(() => {
    if (activeTab === 'cost_tracking' && editItem) {
      fetchSupplierCosts(editItem.id)
      fetchCostHistory(editItem.id, costHistoryPage)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, editItem, costHistoryPage])

  function resetForm() {
    // Revoke object URL to prevent memory leak
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setFormData({
      name: '',
      sku: '',
      barcode: '',
      categoryId: '',
      costPrice: '',
      sellingPrice: '',
      unit: 'pcs',
      trackStock: true,
      trackBatches: false,
      trackSerialNumbers: false,
      oemPartNumber: '',
      alternatePartNumbers: '',
      brand: '',
      condition: 'new',
      supplierId: '',
      supplierPartNumber: '',
      leadTimeDays: '',
      weight: '',
      dimensions: '',
      warrantyMonths: '',
      imageUrl: '',
      supersededBy: '',
      preparationTime: '',
      allergens: '',
      calories: '',
      isVegetarian: false,
      isVegan: false,
      isGlutenFree: false,
      spiceLevel: '',
      availableFrom: '',
      availableTo: '',
      pluCode: '',
      shelfLifeDays: '',
      storageTemp: '',
      expiryDate: '',
      isGiftCard: false,
      taxTemplateId: '',
    })
    setActiveTab('basic')
    setError('')
    setCompatEntries([])
    setShowAddCompat(false)
    setCompatForm({ makeId: '', modelId: '', yearFrom: '', yearTo: '' })
    setCompatModels([])
    setImageFile(null)
    setImagePreview(null)
  }

  // Image upload helpers
  function handleImageSelect(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const file = fileList[0]
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: PNG, JPEG, WebP')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum 5MB')
      return
    }
    setImageFile(file)
    // Revoke previous object URL to prevent memory leak
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    const url = URL.createObjectURL(file)
    setImagePreview(url)
  }

  function handleImageDrop(e: React.DragEvent) {
    e.preventDefault()
    handleImageSelect(e.dataTransfer.files)
  }

  async function uploadItemImage(itemId: string) {
    if (!imageFile) return
    setImageUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', imageFile)
      const res = await fetch(`/api/items/${itemId}/image`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to upload image')
      } else {
        const data = await res.json()
        setFormData(prev => ({ ...prev, imageUrl: data.imageUrl }))
        setImageFile(null)
      }
    } catch {
      toast.error('Failed to upload image')
    } finally {
      setImageUploading(false)
    }
  }

  async function removeItemImage(itemId: string) {
    setImageUploading(true)
    try {
      const res = await fetch(`/api/items/${itemId}/image`, { method: 'DELETE' })
      if (res.ok) {
        setFormData(prev => ({ ...prev, imageUrl: '' }))
        setImagePreview(null)
        toast.success('Image removed')
      }
    } catch {
      toast.error('Failed to remove image')
    } finally {
      setImageUploading(false)
    }
  }

  const tabs = useMemo(() => {
    const base: { key: TabType; label: string; icon: React.ReactNode }[] = [
      { key: 'basic', label: 'Basic', icon: <Tag size={16} /> },
      { key: 'pricing', label: 'Pricing', icon: <DollarSign size={16} /> },
      { key: 'inventory', label: 'Inventory', icon: <Boxes size={16} /> },
    ]
    if (isAutoService || !businessType) {
      base.push({ key: 'supplier', label: 'Supplier', icon: <Truck size={16} /> })
      base.push({ key: 'physical', label: 'Physical', icon: <Ruler size={16} /> })
      base.push({ key: 'fits', label: 'Fits', icon: <Car size={16} /> })
    }
    if (isRestaurant) {
      base.push({ key: 'dietary', label: 'Dietary', icon: <Leaf size={16} /> })
    }
    if (isSupermarket) {
      base.push({ key: 'freshness', label: 'Freshness', icon: <Snowflake size={16} /> })
    }
    if (editItem) {
      base.push({ key: 'cost_tracking', label: 'Supplier Pricing', icon: <History size={16} /> })
    }
    return base
  }, [isAutoService, isRestaurant, isSupermarket, businessType, editItem])

  function handleClose() {
    resetForm()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate numeric fields
    if (formData.sellingPrice && !isValidPositiveNumber(formData.sellingPrice)) {
      setError('Selling price must be a valid positive number')
      return
    }
    if (formData.costPrice && !isValidPositiveNumber(formData.costPrice)) {
      setError('Cost price must be a valid positive number')
      return
    }

    // AI Smart Warnings for price changes on existing items
    if (editItem && !warningBypassed) {
      const oldCost = parseFloat(editItem.costPrice || '0')
      const oldSelling = parseFloat(editItem.sellingPrice || '0')
      const newCost = parseFloat(formData.costPrice) || 0
      const newSelling = parseFloat(formData.sellingPrice) || 0

      if (oldCost !== newCost || oldSelling !== newSelling) {
        const w = await priceWarnings.checkWarnings({
          itemId: editItem.id,
          itemName: formData.name,
          newSellingPrice: newSelling,
          newCostPrice: newCost,
        })
        if (w.length > 0) return
      }
    }
    setWarningBypassed(false)

    setSaving(true)
    setError('')

    try {
      const url = editItem ? `/api/items/${editItem.id}` : '/api/items'
      const method = editItem ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          categoryId: formData.categoryId || null,
          costPrice: parseFloat(formData.costPrice) || 0,
          sellingPrice: parseFloat(formData.sellingPrice) || 0,
          trackStock: formData.trackStock,
          trackBatches: formData.trackBatches,
          trackSerialNumbers: formData.trackSerialNumbers,
          oemPartNumber: formData.oemPartNumber || null,
          alternatePartNumbers: formData.alternatePartNumbers
            ? formData.alternatePartNumbers.split(',').map(s => s.trim()).filter(Boolean)
            : null,
          brand: formData.brand || null,
          condition: formData.condition || 'new',
          supplierId: formData.supplierId || null,
          supplierPartNumber: formData.supplierPartNumber || null,
          leadTimeDays: formData.leadTimeDays ? parseInt(formData.leadTimeDays) : null,
          weight: formData.weight ? parseFloat(formData.weight) : null,
          dimensions: formData.dimensions || null,
          warrantyMonths: formData.warrantyMonths ? parseInt(formData.warrantyMonths) : null,
          imageUrl: formData.imageUrl || null,
          supersededBy: formData.supersededBy || null,
          // Restaurant fields
          preparationTime: formData.preparationTime ? parseInt(formData.preparationTime) : null,
          allergens: formData.allergens
            ? formData.allergens.split(',').map(s => s.trim()).filter(Boolean)
            : null,
          calories: formData.calories ? parseInt(formData.calories) : null,
          isVegetarian: formData.isVegetarian,
          isVegan: formData.isVegan,
          isGlutenFree: formData.isGlutenFree,
          spiceLevel: formData.spiceLevel || null,
          availableFrom: formData.availableFrom || null,
          availableTo: formData.availableTo || null,
          // Supermarket fields
          pluCode: formData.pluCode || null,
          shelfLifeDays: formData.shelfLifeDays ? parseInt(formData.shelfLifeDays) : null,
          storageTemp: formData.storageTemp || null,
          expiryDate: formData.expiryDate || null,
          // Gift card
          isGiftCard: formData.isGiftCard,
          // Tax template
          taxTemplateId: formData.taxTemplateId || null,
        }),
      })

      if (res.ok) {
        const item = await res.json()
        // Upload image if a file was selected
        if (imageFile && item.id) {
          await uploadItemImage(item.id)
        }
        toast.success(editItem ? `${t.item} updated successfully` : `${t.item} created successfully`)
        onSaved(item)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || `Failed to save ${t.item.toLowerCase()}`)
      }
    } catch {
      setError(`Failed to save ${t.item.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title={editItem ? t.editItem : t.newItem} size="2xl">
        <form id="item-form" onSubmit={handleSubmit} className="flex flex-col h-full">
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
          <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[50vh] space-y-4">
            {/* Basic Tab */}
            {activeTab === 'basic' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <FormLabel required>Name</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      autoFocus
                    />
                  </div>
                  <div>
                    <FormLabel>SKU</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.sku}
                      onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>Barcode</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.barcode}
                      onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <FormLabel>{t.category}</FormLabel>
                    <CreatableSelect
                      options={categories.map(c => ({ value: c.id, label: c.name }))}
                      value={formData.categoryId}
                      onChange={(value) => setFormData({ ...formData, categoryId: value })}
                      onCreateNew={(name) => {
                        setPendingCategoryName(name)
                        setShowCategoryModal(true)
                      }}
                      placeholder={t.categoryPlaceholder}
                      createLabel={`Add ${t.category.toLowerCase()}`}
                    />
                  </div>
                  {(isAutoService || !businessType) && (
                    <div>
                      <FormLabel>Brand</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.brand}
                        onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      />
                    </div>
                  )}
                  {(isAutoService || !businessType) && (
                    <div>
                      <FormLabel>Condition</FormLabel>
                      <FormSelect
                        value={formData.condition}
                        onChange={(e) => setFormData({ ...formData, condition: e.target.value as 'new' | 'refurbished' | 'used' })}
                      >
                        <option value="new">New</option>
                        <option value="refurbished">Refurbished</option>
                        <option value="used">Used</option>
                      </FormSelect>
                    </div>
                  )}
                  {(isAutoService || !businessType) && (
                    <div>
                      <FormLabel>Warranty (Months)</FormLabel>
                      <FormInput
                        type="number"
                        value={formData.warrantyMonths}
                        onChange={(e) => setFormData({ ...formData, warrantyMonths: e.target.value })}
                      />
                    </div>
                  )}
                  {isSupermarket && (
                    <div>
                      <FormLabel>PLU Code</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.pluCode}
                        onChange={(e) => setFormData({ ...formData, pluCode: e.target.value })}
                        placeholder="Price Look-Up code"
                      />
                    </div>
                  )}
                </div>

                {/* Part Numbers - auto_service only */}
                {(isAutoService || !businessType) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <FormLabel>OEM Part Number</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.oemPartNumber}
                        onChange={(e) => setFormData({ ...formData, oemPartNumber: e.target.value })}
                        placeholder="Original manufacturer part #"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <FormLabel>Alternate Part Numbers</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.alternatePartNumbers}
                        onChange={(e) => setFormData({ ...formData, alternatePartNumbers: e.target.value })}
                        placeholder="Comma-separated (e.g., ABC123, XYZ456)"
                      />
                    </div>
                  </div>
                )}

                {/* Options */}
                <div className="flex flex-wrap gap-6 pt-4 border-t dark:border-gray-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!formData.trackStock}
                      onChange={(e) => setFormData({ ...formData, trackStock: !e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      disabled={editItem !== null}
                    />
                    <span className="text-sm font-medium dark:text-gray-300">
                      <Package size={16} className="inline mr-1" />
                      Non-Inventory Item
                    </span>
                  </label>
                  {formData.trackStock && (
                    <>
                      <label className={`flex items-center gap-2 ${editItem !== null ? 'opacity-60' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={formData.trackBatches}
                          onChange={(e) => setFormData({ ...formData, trackBatches: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          disabled={editItem !== null}
                        />
                        <span className="text-sm font-medium dark:text-gray-300">
                          Track Batches/Lots
                        </span>
                      </label>
                      <label className={`flex items-center gap-2 ${editItem !== null ? 'opacity-60' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={formData.trackSerialNumbers}
                          onChange={(e) => setFormData({ ...formData, trackSerialNumbers: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          disabled={editItem !== null}
                        />
                        <span className="text-sm font-medium dark:text-gray-300">
                          Track Serial Numbers
                        </span>
                      </label>
                    </>
                  )}
                  <label className={`flex items-center gap-2 ${editItem !== null ? 'opacity-60' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={formData.isGiftCard}
                      onChange={(e) => setFormData({ ...formData, isGiftCard: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      disabled={editItem !== null}
                    />
                    <span className="text-sm font-medium dark:text-gray-300">
                      Gift Card Item
                    </span>
                  </label>
                </div>

                {/* Image Upload */}
                <div className="pt-4 border-t dark:border-gray-700">
                  <FormLabel>Product Image</FormLabel>
                  <div className="flex items-start gap-4 mt-1">
                    {/* Preview */}
                    <div className="flex-shrink-0 w-24 h-24 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center bg-gray-50 dark:bg-gray-800 overflow-hidden">
                      {(imagePreview || formData.imageUrl) ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={imagePreview || formData.imageUrl}
                          alt="Product"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImageIcon size={28} className="text-gray-400" />
                      )}
                    </div>
                    {/* Controls */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3 text-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleImageDrop}
                        onClick={() => imageInputRef.current?.click()}
                      >
                        <Upload size={20} className="mx-auto mb-1 text-gray-400" />
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          Drop image or click to browse
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">PNG, JPEG, WebP &bull; Max 5MB</p>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp"
                          className="hidden"
                          onChange={(e) => handleImageSelect(e.target.files)}
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {imageFile && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 truncate">
                            {imageFile.name}
                          </span>
                        )}
                        {imageFile && (
                          <button
                            type="button"
                            onClick={() => { setImageFile(null); setImagePreview(null) }}
                            className="text-xs text-red-500 hover:text-red-600 flex items-center gap-0.5"
                          >
                            <X size={12} /> Clear
                          </button>
                        )}
                        {!imageFile && formData.imageUrl && editItem && (
                          <button
                            type="button"
                            onClick={() => removeItemImage(editItem.id)}
                            disabled={imageUploading}
                            className="text-xs text-red-500 hover:text-red-600 flex items-center gap-0.5 disabled:opacity-50"
                          >
                            {imageUploading ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                            Remove image
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pricing Tab */}
            {activeTab === 'pricing' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FormLabel>Cost Price</FormLabel>
                  <FormInput
                    type="number"
                    step="0.01"
                    value={formData.costPrice}
                    onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                    disabled={editItem !== null}
                  />
                </div>
                <div>
                  <FormLabel required>Selling Price</FormLabel>
                  <FormInput
                    type="number"
                    step="0.01"
                    value={formData.sellingPrice}
                    onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                    required
                  />
                </div>
                {formData.costPrice && formData.sellingPrice && (
                  <div className="md:col-span-2 p-3 bg-gray-50 dark:bg-gray-800 rounded">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Margin</span>
                      <span className="font-medium dark:text-white">
                        {parseFloat(formData.sellingPrice) > 0
                          ? ((parseFloat(formData.sellingPrice) - parseFloat(formData.costPrice)) / parseFloat(formData.sellingPrice) * 100).toFixed(1)
                          : '0.0'}%
                      </span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-500 dark:text-gray-400">Markup</span>
                      <span className="font-medium dark:text-white">
                        {parseFloat(formData.costPrice) > 0
                          ? ((parseFloat(formData.sellingPrice) - parseFloat(formData.costPrice)) / parseFloat(formData.costPrice) * 100).toFixed(1)
                          : 'N/A'}%
                      </span>
                    </div>
                  </div>
                )}
                <div className="md:col-span-2">
                  <FormLabel>Tax Template</FormLabel>
                  <FormSelect
                    value={formData.taxTemplateId}
                    onChange={(e) => setFormData({ ...formData, taxTemplateId: e.target.value })}
                  >
                    <option value="">(Default)</option>
                    {taxTemplates.map((tt) => (
                      <option key={tt.id} value={tt.id}>{tt.name}</option>
                    ))}
                  </FormSelect>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Leave as Default to use the system default tax template
                  </p>
                </div>
              </div>
            )}

            {/* Inventory Tab */}
            {activeTab === 'inventory' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FormLabel>Unit</FormLabel>
                    <FormSelect
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    >
                      <option value="pcs">Pieces (pcs)</option>
                      <option value="kg">Kilograms (kg)</option>
                      <option value="g">Grams (g)</option>
                      <option value="l">Liters (l)</option>
                      <option value="ml">Milliliters (ml)</option>
                      <option value="m">Meters (m)</option>
                      <option value="box">Box</option>
                      <option value="pack">Pack</option>
                    </FormSelect>
                  </div>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-blue-700 dark:text-blue-300">
                  Stock levels are managed per warehouse. Use Settings → Warehouses to manage stock.
                </div>
              </div>
            )}

            {/* Supplier Tab */}
            {activeTab === 'supplier' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FormLabel>Supplier</FormLabel>
                  <CreatableSelect
                    options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                    value={formData.supplierId}
                    onChange={(value) => setFormData({ ...formData, supplierId: value })}
                    onCreateNew={(name) => {
                      setPendingSupplierName(name)
                      setShowSupplierModal(true)
                    }}
                    placeholder="Select Supplier"
                    createLabel="Add supplier"
                  />
                </div>
                <div>
                  <FormLabel>Supplier Part #</FormLabel>
                  <FormInput
                    type="text"
                    value={formData.supplierPartNumber}
                    onChange={(e) => setFormData({ ...formData, supplierPartNumber: e.target.value })}
                  />
                </div>
                <div>
                  <FormLabel>Lead Time (Days)</FormLabel>
                  <FormInput
                    type="number"
                    value={formData.leadTimeDays}
                    onChange={(e) => setFormData({ ...formData, leadTimeDays: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* Physical Tab */}
            {activeTab === 'physical' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FormLabel>Weight (kg)</FormLabel>
                  <FormInput
                    type="number"
                    step="0.001"
                    value={formData.weight}
                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                  />
                </div>
                <div>
                  <FormLabel>Dimensions</FormLabel>
                  <FormInput
                    type="text"
                    value={formData.dimensions}
                    onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                    placeholder="L x W x H (cm)"
                  />
                </div>
              </div>
            )}

            {/* Dietary Tab (Restaurant) */}
            {activeTab === 'dietary' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <FormLabel>Preparation Time (min)</FormLabel>
                    <FormInput
                      type="number"
                      value={formData.preparationTime}
                      onChange={(e) => setFormData({ ...formData, preparationTime: e.target.value })}
                      placeholder="e.g. 15"
                    />
                  </div>
                  <div>
                    <FormLabel>Calories</FormLabel>
                    <FormInput
                      type="number"
                      value={formData.calories}
                      onChange={(e) => setFormData({ ...formData, calories: e.target.value })}
                      placeholder="kcal"
                    />
                  </div>
                  <div>
                    <FormLabel>Spice Level</FormLabel>
                    <FormSelect
                      value={formData.spiceLevel}
                      onChange={(e) => setFormData({ ...formData, spiceLevel: e.target.value })}
                    >
                      <option value="">None</option>
                      <option value="mild">Mild</option>
                      <option value="medium">Medium</option>
                      <option value="hot">Hot</option>
                      <option value="extra_hot">Extra Hot</option>
                    </FormSelect>
                  </div>
                </div>
                <div>
                  <FormLabel>Allergens</FormLabel>
                  <FormInput
                    type="text"
                    value={formData.allergens}
                    onChange={(e) => setFormData({ ...formData, allergens: e.target.value })}
                    placeholder="Comma-separated (e.g., gluten, dairy, nuts)"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FormLabel>Available From</FormLabel>
                    <FormInput
                      type="time"
                      value={formData.availableFrom}
                      onChange={(e) => setFormData({ ...formData, availableFrom: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>Available To</FormLabel>
                    <FormInput
                      type="time"
                      value={formData.availableTo}
                      onChange={(e) => setFormData({ ...formData, availableTo: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-6 pt-4 border-t dark:border-gray-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isVegetarian}
                      onChange={(e) => setFormData({ ...formData, isVegetarian: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm font-medium dark:text-gray-300">Vegetarian</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isVegan}
                      onChange={(e) => setFormData({ ...formData, isVegan: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm font-medium dark:text-gray-300">Vegan</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isGlutenFree}
                      onChange={(e) => setFormData({ ...formData, isGlutenFree: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm font-medium dark:text-gray-300">Gluten Free</span>
                  </label>
                </div>
              </div>
            )}

            {/* Freshness Tab (Supermarket) */}
            {activeTab === 'freshness' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FormLabel>PLU Code</FormLabel>
                  <FormInput
                    type="text"
                    value={formData.pluCode}
                    onChange={(e) => setFormData({ ...formData, pluCode: e.target.value })}
                    placeholder="Price Look-Up code"
                  />
                </div>
                <div>
                  <FormLabel>Shelf Life (Days)</FormLabel>
                  <FormInput
                    type="number"
                    value={formData.shelfLifeDays}
                    onChange={(e) => setFormData({ ...formData, shelfLifeDays: e.target.value })}
                  />
                </div>
                <div>
                  <FormLabel>Storage Temperature</FormLabel>
                  <FormSelect
                    value={formData.storageTemp}
                    onChange={(e) => setFormData({ ...formData, storageTemp: e.target.value })}
                  >
                    <option value="">Select...</option>
                    <option value="ambient">Ambient</option>
                    <option value="chilled">Chilled</option>
                    <option value="frozen">Frozen</option>
                  </FormSelect>
                </div>
                <div>
                  <FormLabel>Expiry Date</FormLabel>
                  <FormInput
                    type="date"
                    value={formData.expiryDate}
                    onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* Fits Tab (Auto Service / Dealership) */}
            {activeTab === 'fits' && (
              <div className="space-y-4">
                {!editItem ? (
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-blue-700 dark:text-blue-300">
                    Save the item first, then add compatible vehicle models.
                  </div>
                ) : (
                  <>
                    {/* Existing entries */}
                    {compatLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
                        <Loader2 size={16} className="animate-spin" /> Loading...
                      </div>
                    ) : compatEntries.length === 0 && !showAddCompat ? (
                      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        No compatible models added yet.
                      </div>
                    ) : (
                      <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:bg-gray-800">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400">Make</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400">Model</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400">Years</th>
                              <th className="px-3 py-2 w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {compatEntries.map(entry => (
                              <tr key={entry.id} className="border-t border-gray-100 dark:border-gray-700">
                                <td className="px-3 py-2 text-gray-900 dark:text-white">{entry.makeName || '—'}</td>
                                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{entry.modelName || 'All models'}</td>
                                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                                  {entry.yearFrom || entry.yearTo
                                    ? `${entry.yearFrom || '—'} – ${entry.yearTo || '—'}`
                                    : 'All years'}
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/items/${editItem.id}/compatibility?compatId=${entry.id}`, { method: 'DELETE' })
                                        if (res.ok) {
                                          setCompatEntries(prev => prev.filter(e => e.id !== entry.id))
                                        } else {
                                          toast.error('Failed to remove')
                                        }
                                      } catch {
                                        toast.error('Failed to remove')
                                      }
                                    }}
                                    className="text-red-500 hover:text-red-700 p-1"
                                    title="Remove"
                                  >
                                    <X size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Add form */}
                    {showAddCompat ? (
                      <div className="p-3 border border-blue-200 dark:border-blue-800 rounded bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <FormLabel>Make</FormLabel>
                            <CreatableSelect
                              options={compatMakes.map(m => ({ value: m.id, label: m.name }))}
                              value={compatForm.makeId}
                              onChange={(value) => {
                                setCompatForm(prev => ({ ...prev, makeId: value, modelId: '' }))
                                setCompatModels([])
                                if (value) fetchModels(value)
                              }}
                              onCreateNew={(name) => {
                                setPendingMakeName(name)
                                setShowMakeModal(true)
                              }}
                              placeholder="Select make..."
                              createLabel="Add make"
                            />
                          </div>
                          <div>
                            <FormLabel>Model</FormLabel>
                            <CreatableSelect
                              options={compatModels.map(m => ({ value: m.id, label: m.name }))}
                              value={compatForm.modelId}
                              onChange={(value) => setCompatForm(prev => ({ ...prev, modelId: value }))}
                              onCreateNew={(name) => {
                                setPendingModelName(name)
                                setShowModelModal(true)
                              }}
                              placeholder={compatForm.makeId ? 'Select model...' : 'Select make first'}
                              createLabel="Add model"
                              disabled={!compatForm.makeId}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <FormLabel>Year From</FormLabel>
                            <FormInput
                              type="number"
                              value={compatForm.yearFrom}
                              onChange={(e) => setCompatForm(prev => ({ ...prev, yearFrom: e.target.value }))}
                              placeholder="e.g. 2018"
                              min={1900}
                              max={2100}
                            />
                          </div>
                          <div>
                            <FormLabel>Year To</FormLabel>
                            <FormInput
                              type="number"
                              value={compatForm.yearTo}
                              onChange={(e) => setCompatForm(prev => ({ ...prev, yearTo: e.target.value }))}
                              placeholder="e.g. 2024"
                              min={1900}
                              max={2100}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!compatForm.makeId || compatSaving}
                            onClick={async () => {
                              setCompatSaving(true)
                              try {
                                const body: Record<string, unknown> = { makeId: compatForm.makeId }
                                if (compatForm.modelId) body.modelId = compatForm.modelId
                                if (compatForm.yearFrom) body.yearFrom = parseInt(compatForm.yearFrom)
                                if (compatForm.yearTo) body.yearTo = parseInt(compatForm.yearTo)

                                const res = await fetch(`/api/items/${editItem.id}/compatibility`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(body),
                                })
                                if (res.ok) {
                                  await fetchCompatibility(editItem.id)
                                  setCompatForm({ makeId: '', modelId: '', yearFrom: '', yearTo: '' })
                                  setCompatModels([])
                                  setShowAddCompat(false)
                                  toast.success('Compatible model added')
                                } else {
                                  const data = await res.json()
                                  toast.error(data.error || 'Failed to add')
                                }
                              } catch {
                                toast.error('Failed to add compatible model')
                              } finally {
                                setCompatSaving(false)
                              }
                            }}
                            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            {compatSaving ? 'Adding...' : 'Add'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddCompat(false)
                              setCompatForm({ makeId: '', modelId: '', yearFrom: '', yearTo: '' })
                              setCompatModels([])
                            }}
                            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : editItem && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCompat(true)
                          if (compatMakes.length === 0) fetchMakes()
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      >
                        <Plus size={14} /> Add Compatible Model
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Supplier Pricing / Cost History Tab */}
            {activeTab === 'cost_tracking' && editItem && (
              <div className="space-y-6">
                {/* Supplier Costs Table */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Supplier Costs</h4>
                  {supplierCostsLoading ? (
                    <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={20} className="animate-spin mr-2" /> Loading...</div>
                  ) : supplierCosts.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No purchase records from suppliers yet.</p>
                  ) : (
                    <div className="border rounded-lg dark:border-gray-700 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Supplier</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Last Cost</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Total Qty</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Last Purchase</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-gray-700">
                          {supplierCosts.map((sc) => (
                            <tr key={sc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                              <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{sc.supplierName}</td>
                              <td className="px-3 py-2 text-right font-mono text-gray-900 dark:text-gray-100">{parseFloat(sc.lastCostPrice).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{parseFloat(sc.totalPurchasedQty).toFixed(0)}</td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                {sc.lastPurchaseDate ? new Date(sc.lastPurchaseDate).toLocaleDateString() : '-'}
                                {sc.lastPurchaseNo && <span className="ml-1 text-xs text-gray-400">({sc.lastPurchaseNo})</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Cost History Timeline */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Cost History</h4>
                  {costHistoryLoading ? (
                    <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={20} className="animate-spin mr-2" /> Loading...</div>
                  ) : costHistory.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No cost changes recorded yet.</p>
                  ) : (
                    <div className="border rounded-lg dark:border-gray-700 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Date</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Source</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Supplier</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Price Change</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Qty</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-gray-700">
                          {costHistory.map((ch) => (
                            <tr key={ch.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{new Date(ch.createdAt).toLocaleDateString()}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                  ch.source === 'purchase' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                  ch.source === 'purchase_cancellation' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                  ch.source === 'manual_adjustment' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                }`}>
                                  {ch.source.replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{ch.supplierName || '-'}</td>
                              <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                                <span className="text-gray-400">{parseFloat(ch.previousCostPrice).toFixed(2)}</span>
                                <ArrowRight size={12} className="inline mx-1 text-gray-400" />
                                <span className="text-gray-900 dark:text-gray-100">{parseFloat(ch.newCostPrice).toFixed(2)}</span>
                              </td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{ch.quantity ? parseFloat(ch.quantity).toFixed(0) : '-'}</td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{ch.referenceNo || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {costHistoryTotal > costHistoryPageSize && (
                        <Pagination
                          page={costHistoryPage}
                          pageSize={costHistoryPageSize}
                          total={costHistoryTotal}
                          totalPages={Math.ceil(costHistoryTotal / costHistoryPageSize)}
                          onPageChange={setCostHistoryPage}
                          onPageSizeChange={() => {}}
                          className="border-t px-3"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* AI Smart Warnings */}
          {(priceWarnings.warnings.length > 0 || priceWarnings.loading) && (
            <div className="pt-4 mt-4 border-t dark:border-gray-700">
              <SmartWarningBanner
                warnings={priceWarnings.warnings}
                loading={priceWarnings.loading}
                onProceed={() => {
                  setWarningBypassed(true)
                  priceWarnings.clearWarnings()
                  // Re-trigger submit
                  const form = document.querySelector<HTMLFormElement>('#item-form')
                  form?.requestSubmit()
                }}
                onCancel={() => priceWarnings.clearWarnings()}
                processing={saving}
                proceedText="Save Anyway"
              />
            </div>
          )}

          {/* Footer */}
          {priceWarnings.warnings.length === 0 && (
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editItem ? `Update ${t.item}` : `Create ${t.item}`}
            </button>
          </div>
          )}
        </form>
      </Modal>

      <CategoryModal
        isOpen={showCategoryModal}
        onClose={() => {
          setShowCategoryModal(false)
          setPendingCategoryName('')
        }}
        onCreated={(category) => {
          setCategories([...categories, category])
          setFormData({ ...formData, categoryId: category.id })
        }}
        initialName={pendingCategoryName}
      />

      <SupplierModal
        isOpen={showSupplierModal}
        onClose={() => {
          setShowSupplierModal(false)
          setPendingSupplierName('')
        }}
        onCreated={(supplier) => {
          setSuppliers([...suppliers, supplier])
          setFormData({ ...formData, supplierId: supplier.id })
        }}
        initialName={pendingSupplierName}
      />

      <VehicleMakeModal
        isOpen={showMakeModal}
        onClose={() => {
          setShowMakeModal(false)
          setPendingMakeName('')
        }}
        onCreated={(make) => {
          setCompatMakes(prev => [...prev, make])
          setCompatForm(prev => ({ ...prev, makeId: make.id, modelId: '' }))
          setCompatModels([])
          fetchModels(make.id)
        }}
        initialName={pendingMakeName}
      />

      <VehicleModelModal
        isOpen={showModelModal}
        onClose={() => {
          setShowModelModal(false)
          setPendingModelName('')
        }}
        onCreated={(model) => {
          setCompatModels(prev => [...prev, model])
          setCompatForm(prev => ({ ...prev, modelId: model.id }))
        }}
        initialName={pendingModelName}
        makes={compatMakes}
        selectedMakeId={compatForm.makeId}
      />
    </>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Loader2, Plus, Trash2, GripVertical } from 'lucide-react'

interface PaymentMethodItem {
  id?: string
  paymentMethod: string
  isDefault: boolean
  allowInReturns: boolean
  sortOrder: number
}

interface UserAssignment {
  id?: string
  userId: string
  isDefault: boolean
  user?: {
    id: string
    fullName: string
    email: string
  }
}

interface Warehouse {
  id: string
  name: string
  code: string
}

interface CostCenter {
  id: string
  name: string
  code: string
}

interface User {
  id: string
  fullName: string
  email: string
  role: string
}

interface POSProfile {
  id: string
  name: string
  code: string | null
  isDefault: boolean
  warehouseId: string | null
  costCenterId: string | null
  defaultCustomerId: string | null
  applyDiscountOn: string
  allowRateChange: boolean
  allowDiscountChange: boolean
  maxDiscountPercent: string
  allowNegativeStock: boolean
  validateStockOnSave: boolean
  hideUnavailableItems: boolean
  autoAddItemToCart: boolean
  printReceiptOnComplete: boolean
  skipPrintPreview: boolean
  receiptPrintFormat: string
  showLogoOnReceipt: boolean
  receiptHeader: string | null
  receiptFooter: string | null
  defaultPaymentMethod: string
  allowCreditSale: boolean
  status: string
  paymentMethods?: PaymentMethodItem[]
  users?: UserAssignment[]
}

interface POSProfileFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  editProfile?: POSProfile | null
}

const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'credit', label: 'Store Credit' },
  { value: 'gift_card', label: 'Gift Card' },
  { value: 'mobile_payment', label: 'Mobile Payment' },
]

const RECEIPT_FORMATS = [
  { value: '58mm', label: '58mm (Thermal)' },
  { value: '80mm', label: '80mm (Thermal)' },
  { value: 'A4', label: 'A4 Paper' },
]

const initialFormData = {
  name: '',
  code: '',
  isDefault: false,
  warehouseId: '',
  costCenterId: '',
  applyDiscountOn: 'grand_total',
  allowRateChange: true,
  allowDiscountChange: true,
  maxDiscountPercent: '100',
  allowNegativeStock: false,
  validateStockOnSave: true,
  hideUnavailableItems: true,
  autoAddItemToCart: false,
  printReceiptOnComplete: false,
  skipPrintPreview: false,
  receiptPrintFormat: '80mm',
  showLogoOnReceipt: true,
  receiptHeader: '',
  receiptFooter: '',
  defaultPaymentMethod: 'cash',
  allowCreditSale: true,
}

export function POSProfileFormModal({ isOpen, onClose, onSaved, editProfile }: POSProfileFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(initialFormData)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([
    { paymentMethod: 'cash', isDefault: true, allowInReturns: true, sortOrder: 0 },
    { paymentMethod: 'card', isDefault: false, allowInReturns: true, sortOrder: 1 },
  ])
  const [userAssignments, setUserAssignments] = useState<UserAssignment[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [activeTab, setActiveTab] = useState<'general' | 'permissions' | 'display' | 'payments' | 'users'>('general')

  // Fetch warehouses and users
  useEffect(() => {
    if (isOpen) {
      setLoadingData(true)
      Promise.all([
        fetch('/api/warehouses?all=true&activeOnly=true').then(r => r.ok ? r.json() : []),
        fetch('/api/users?all=true&activeOnly=true').then(r => r.ok ? r.json() : []),
        fetch('/api/accounting/cost-centers?all=true').then(r => r.ok ? r.json() : []),
      ])
        .then(([warehouseData, userData, costCenterData]) => {
          setWarehouses(warehouseData || [])
          setUsers(userData || [])
          setCostCenters(costCenterData || [])
        })
        .catch(err => console.error('Failed to load data:', err))
        .finally(() => setLoadingData(false))
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      if (editProfile) {
        setFormData({
          name: editProfile.name,
          code: editProfile.code || '',
          isDefault: editProfile.isDefault,
          warehouseId: editProfile.warehouseId || '',
          costCenterId: editProfile.costCenterId || '',
          applyDiscountOn: editProfile.applyDiscountOn,
          allowRateChange: editProfile.allowRateChange,
          allowDiscountChange: editProfile.allowDiscountChange,
          maxDiscountPercent: editProfile.maxDiscountPercent,
          allowNegativeStock: editProfile.allowNegativeStock,
          validateStockOnSave: editProfile.validateStockOnSave,
          hideUnavailableItems: editProfile.hideUnavailableItems,
          autoAddItemToCart: editProfile.autoAddItemToCart,
          printReceiptOnComplete: editProfile.printReceiptOnComplete,
          skipPrintPreview: editProfile.skipPrintPreview,
          receiptPrintFormat: editProfile.receiptPrintFormat,
          showLogoOnReceipt: editProfile.showLogoOnReceipt,
          receiptHeader: editProfile.receiptHeader || '',
          receiptFooter: editProfile.receiptFooter || '',
          defaultPaymentMethod: editProfile.defaultPaymentMethod,
          allowCreditSale: editProfile.allowCreditSale,
        })
        setPaymentMethods(editProfile.paymentMethods || [])
        setUserAssignments(editProfile.users || [])
      } else {
        setFormData(initialFormData)
        setPaymentMethods([
          { paymentMethod: 'cash', isDefault: true, allowInReturns: true, sortOrder: 0 },
          { paymentMethod: 'card', isDefault: false, allowInReturns: true, sortOrder: 1 },
        ])
        setUserAssignments([])
      }
      setError('')
      setActiveTab('general')
    }
  }, [isOpen, editProfile])

  function handleClose() {
    setFormData(initialFormData)
    setPaymentMethods([])
    setUserAssignments([])
    setError('')
    onClose()
  }

  function addPaymentMethod() {
    const usedMethods = paymentMethods.map(p => p.paymentMethod)
    const availableMethod = PAYMENT_METHOD_OPTIONS.find(m => !usedMethods.includes(m.value))
    if (availableMethod) {
      setPaymentMethods([
        ...paymentMethods,
        {
          paymentMethod: availableMethod.value,
          isDefault: paymentMethods.length === 0,
          allowInReturns: true,
          sortOrder: paymentMethods.length,
        },
      ])
    }
  }

  function removePaymentMethod(index: number) {
    const newMethods = paymentMethods.filter((_, i) => i !== index)
    // Ensure at least one is default
    if (newMethods.length > 0 && !newMethods.some(m => m.isDefault)) {
      newMethods[0].isDefault = true
    }
    setPaymentMethods(newMethods)
  }

  function updatePaymentMethod(index: number, updates: Partial<PaymentMethodItem>) {
    const newMethods = [...paymentMethods]
    newMethods[index] = { ...newMethods[index], ...updates }
    // If setting as default, unset others
    if (updates.isDefault) {
      newMethods.forEach((m, i) => {
        if (i !== index) m.isDefault = false
      })
    }
    setPaymentMethods(newMethods)
  }

  function addUserAssignment() {
    const assignedUserIds = userAssignments.map(a => a.userId)
    const availableUser = users.find(u => !assignedUserIds.includes(u.id))
    if (availableUser) {
      setUserAssignments([
        ...userAssignments,
        {
          userId: availableUser.id,
          isDefault: userAssignments.length === 0,
          user: availableUser,
        },
      ])
    }
  }

  function removeUserAssignment(index: number) {
    setUserAssignments(userAssignments.filter((_, i) => i !== index))
  }

  function updateUserAssignment(index: number, updates: Partial<UserAssignment>) {
    const newAssignments = [...userAssignments]
    newAssignments[index] = { ...newAssignments[index], ...updates }
    // If changing userId, find the user object
    if (updates.userId) {
      const user = users.find(u => u.id === updates.userId)
      newAssignments[index].user = user
    }
    setUserAssignments(newAssignments)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }

    if (!formData.warehouseId) {
      setError('Warehouse is required')
      setActiveTab('general')
      return
    }

    if (!formData.costCenterId) {
      setError('Cost Center is required')
      setActiveTab('general')
      return
    }

    if (paymentMethods.length === 0) {
      setError('At least one payment method is required')
      setActiveTab('payments')
      return
    }

    if (userAssignments.length === 0) {
      setError('At least one user must be assigned')
      setActiveTab('users')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editProfile ? `/api/pos-profiles/${editProfile.id}` : '/api/pos-profiles'
      const method = editProfile ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          warehouseId: formData.warehouseId || null,
          costCenterId: formData.costCenterId || null,
          code: formData.code || null,
          maxDiscountPercent: parseFloat(formData.maxDiscountPercent) || 100,
          receiptHeader: formData.receiptHeader || null,
          receiptFooter: formData.receiptFooter || null,
          paymentMethods: paymentMethods.map((pm, i) => ({
            ...pm,
            sortOrder: i,
          })),
          userAssignments: userAssignments.map(ua => ({
            userId: ua.userId,
            isDefault: ua.isDefault,
          })),
        }),
      })

      if (res.ok) {
        toast.success(editProfile ? 'Profile updated' : 'Profile created')
        onSaved()
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save profile')
      }
    } catch {
      setError('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'display', label: 'Display' },
    { id: 'payments', label: 'Payment Methods' },
    { id: 'users', label: 'Users' },
  ] as const

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editProfile ? 'Edit POS Profile' : 'Create POS Profile'}
      size="xl"
    >
      {loadingData ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b dark:border-gray-700 mb-4 -mx-6 px-6">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Name *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                      placeholder="e.g., Main Counter"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Code</label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                      placeholder="e.g., POS1"
                      maxLength={20}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Warehouse *</label>
                  <select
                    value={formData.warehouseId}
                    onChange={(e) => setFormData({ ...formData, warehouseId: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    required
                  >
                    <option value="">Select warehouse...</option>
                    {warehouses.map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.name} ({wh.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Cost Center *</label>
                  <select
                    value={formData.costCenterId}
                    onChange={(e) => setFormData({ ...formData, costCenterId: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    required
                  >
                    <option value="">Select cost center...</option>
                    {costCenters.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.name} ({cc.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Apply Discount On</label>
                  <select
                    value={formData.applyDiscountOn}
                    onChange={(e) => setFormData({ ...formData, applyDiscountOn: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    <option value="grand_total">Grand Total</option>
                    <option value="net_total">Net Total</option>
                  </select>
                </div>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm dark:text-gray-300">Set as default profile</span>
                </label>
              </div>
            )}

            {/* Permissions Tab */}
            {activeTab === 'permissions' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Max Discount (%)</label>
                  <input
                    type="number"
                    value={formData.maxDiscountPercent}
                    onChange={(e) => setFormData({ ...formData, maxDiscountPercent: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    min="0"
                    max="100"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allowRateChange}
                      onChange={(e) => setFormData({ ...formData, allowRateChange: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Allow price changes</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allowDiscountChange}
                      onChange={(e) => setFormData({ ...formData, allowDiscountChange: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Allow discounts</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allowNegativeStock}
                      onChange={(e) => setFormData({ ...formData, allowNegativeStock: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Allow negative stock (sell without stock)</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.validateStockOnSave}
                      onChange={(e) => setFormData({ ...formData, validateStockOnSave: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Validate stock when completing sale</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allowCreditSale}
                      onChange={(e) => setFormData({ ...formData, allowCreditSale: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Allow credit sales</span>
                  </label>
                </div>
              </div>
            )}

            {/* Display Tab */}
            {activeTab === 'display' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.hideUnavailableItems}
                      onChange={(e) => setFormData({ ...formData, hideUnavailableItems: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Hide items with zero stock</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.autoAddItemToCart}
                      onChange={(e) => setFormData({ ...formData, autoAddItemToCart: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Auto-add item to cart on scan/search</span>
                  </label>
                </div>

                <hr className="dark:border-gray-700" />

                <h3 className="font-medium dark:text-white">Receipt Settings</h3>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Receipt Format</label>
                  <select
                    value={formData.receiptPrintFormat}
                    onChange={(e) => setFormData({ ...formData, receiptPrintFormat: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    {RECEIPT_FORMATS.map((format) => (
                      <option key={format.value} value={format.value}>
                        {format.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.printReceiptOnComplete}
                      onChange={(e) => setFormData({ ...formData, printReceiptOnComplete: e.target.checked, ...(!e.target.checked ? { skipPrintPreview: false } : {}) })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Print receipt automatically on sale completion</span>
                  </label>

                  {formData.printReceiptOnComplete && (
                    <div className="ml-6">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={formData.skipPrintPreview}
                          onChange={(e) => setFormData({ ...formData, skipPrintPreview: e.target.checked })}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                        <span className="text-sm dark:text-gray-300">Skip print preview (send directly to printer)</span>
                      </label>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 ml-6">
                        For fully silent printing without dialog, use Chrome with --kiosk-printing flag.
                      </p>
                    </div>
                  )}

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.showLogoOnReceipt}
                      onChange={(e) => setFormData({ ...formData, showLogoOnReceipt: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm dark:text-gray-300">Show logo on receipt</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Receipt Header</label>
                  <textarea
                    value={formData.receiptHeader}
                    onChange={(e) => setFormData({ ...formData, receiptHeader: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    rows={2}
                    placeholder="Custom header text..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Receipt Footer</label>
                  <textarea
                    value={formData.receiptFooter}
                    onChange={(e) => setFormData({ ...formData, receiptFooter: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    rows={2}
                    placeholder="e.g., Thank you for your purchase!"
                  />
                </div>
              </div>
            )}

            {/* Payment Methods Tab */}
            {activeTab === 'payments' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Default Payment Method</label>
                  <select
                    value={formData.defaultPaymentMethod}
                    onChange={(e) => setFormData({ ...formData, defaultPaymentMethod: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    {PAYMENT_METHOD_OPTIONS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="font-medium dark:text-white">Enabled Payment Methods</h3>
                  <button
                    type="button"
                    onClick={addPaymentMethod}
                    disabled={paymentMethods.length >= PAYMENT_METHOD_OPTIONS.length}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus size={16} />
                    Add
                  </button>
                </div>

                {paymentMethods.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4 border border-dashed rounded dark:border-gray-700">
                    No payment methods configured
                  </div>
                ) : (
                  <div className="space-y-2">
                    {paymentMethods.map((pm, index) => (
                      <div
                        key={index}
                        className="p-3 bg-gray-50 dark:bg-gray-800 rounded space-y-2"
                      >
                        <div className="flex items-center gap-3">
                          <GripVertical size={16} className="text-gray-400 cursor-move" />
                          <select
                            value={pm.paymentMethod}
                            onChange={(e) => updatePaymentMethod(index, { paymentMethod: e.target.value })}
                            className="flex-1 px-2 py-1 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                          >
                            {PAYMENT_METHOD_OPTIONS.map((opt) => (
                              <option
                                key={opt.value}
                                value={opt.value}
                                disabled={paymentMethods.some((p, i) => i !== index && p.paymentMethod === opt.value)}
                              >
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={pm.allowInReturns}
                              onChange={(e) => updatePaymentMethod(index, { allowInReturns: e.target.checked })}
                              className="rounded border-gray-300 dark:border-gray-600"
                            />
                            <span className="dark:text-gray-300">Returns</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => removePaymentMethod(index)}
                            disabled={paymentMethods.length === 1}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded disabled:opacity-50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium dark:text-white">Assigned Users *</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Only assigned users can open shifts with this profile
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addUserAssignment}
                    disabled={userAssignments.length >= users.length}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus size={16} />
                    Add User
                  </button>
                </div>

                {userAssignments.length === 0 ? (
                  <div className="text-sm text-amber-600 dark:text-amber-400 text-center py-4 border border-dashed border-amber-300 dark:border-amber-700 rounded bg-amber-50 dark:bg-amber-900/20">
                    At least one user must be assigned *
                  </div>
                ) : (
                  <div className="space-y-2">
                    {userAssignments.map((ua, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded"
                      >
                        <select
                          value={ua.userId}
                          onChange={(e) => updateUserAssignment(index, { userId: e.target.value })}
                          className="flex-1 px-2 py-1 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        >
                          {users.map((user) => (
                            <option
                              key={user.id}
                              value={user.id}
                              disabled={userAssignments.some((a, i) => i !== index && a.userId === user.id)}
                            >
                              {user.fullName} ({user.email})
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={ua.isDefault}
                            onChange={(e) => updateUserAssignment(index, { isDefault: e.target.checked })}
                            className="rounded border-gray-300 dark:border-gray-600"
                          />
                          <span className="dark:text-gray-300">Default</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeUserAssignment(index)}
                          className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

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
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {editProfile ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

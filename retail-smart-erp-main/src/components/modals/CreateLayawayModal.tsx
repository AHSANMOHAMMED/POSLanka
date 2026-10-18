'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormTextarea, FormLabel } from '@/components/ui/form-elements'
import { AlertModal } from '@/components/ui/alert-modal'
import { toast } from '@/components/ui/toast'
import { Trash2, Search, User, Package, Calendar } from 'lucide-react'
import { useDebouncedValue } from '@/hooks'
import { useCurrency } from '@/hooks/useCurrency'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { formatItemLabel } from '@/lib/utils/item-display'

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
}

interface Item {
  id: string
  name: string
  sku: string | null
  barcode?: string | null
  oemPartNumber?: string | null
  pluCode?: string | null
  sellingPrice: string
  currentStock: string
  availableStock: string
}

interface CartItem {
  itemId: string
  name: string
  sku: string | null
  barcode?: string | null
  oemPartNumber?: string | null
  pluCode?: string | null
  quantity: number
  unitPrice: number
  availableStock: number
}

interface CreateLayawayModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  initialCustomerId?: string
}

export function CreateLayawayModal({
  isOpen,
  onClose,
  onCreated,
  initialCustomerId,
}: CreateLayawayModalProps) {
  const company = useCompanyOptional()
  const { currency: currencyCode } = useCurrency()
  const businessType = company?.businessType || null

  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState<'customer' | 'items' | 'payment'>('customer')
  const [alertModal, setAlertModal] = useState<{
    open: boolean
    title: string
    message: string
    variant: 'error' | 'success' | 'warning' | 'info'
  }>({ open: false, title: '', message: '', variant: 'info' })

  // Customer selection
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 300)

  // Item selection
  const [itemSearch, setItemSearch] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const debouncedItemSearch = useDebouncedValue(itemSearch, 300)

  // Cart
  const [cart, setCart] = useState<CartItem[]>([])

  // Payment details
  const [depositAmount, setDepositAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)
  const total = subtotal
  const minDeposit = total * 0.1

  // Search customers
  const searchCustomers = useCallback(async (search: string) => {
    if (!search || search.length < 2) {
      setCustomers([])
      return
    }
    setLoadingCustomers(true)
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(search)}&pageSize=10`)
      if (res.ok) {
        const data = await res.json()
        setCustomers(data.data || data)
      }
    } catch (error) {
      console.error('Error searching customers:', error)
    } finally {
      setLoadingCustomers(false)
    }
  }, [])

  // Search items
  const searchItems = useCallback(async (search: string) => {
    if (!search || search.length < 2) {
      setItems([])
      return
    }
    setLoadingItems(true)
    try {
      const res = await fetch(`/api/items?search=${encodeURIComponent(search)}&pageSize=10`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.data || data)
      }
    } catch (error) {
      console.error('Error searching items:', error)
    } finally {
      setLoadingItems(false)
    }
  }, [])

  // Effect for customer search
  useEffect(() => {
    searchCustomers(debouncedCustomerSearch)
  }, [debouncedCustomerSearch, searchCustomers])

  // Effect for item search
  useEffect(() => {
    searchItems(debouncedItemSearch)
  }, [debouncedItemSearch, searchItems])

  // Load initial customer if provided
  useEffect(() => {
    if (isOpen && initialCustomerId) {
      fetch(`/api/customers/${initialCustomerId}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setSelectedCustomer(data)
            setStep('items')
          }
        })
        .catch(console.error)
    }
  }, [isOpen, initialCustomerId])

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('customer')
      setCustomerSearch('')
      setCustomers([])
      setSelectedCustomer(null)
      setItemSearch('')
      setItems([])
      setCart([])
      setDepositAmount('')
      setDueDate('')
      setNotes('')
    }
  }, [isOpen])

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setCustomerSearch('')
    setCustomers([])
    setStep('items')
  }

  function addToCart(item: Item) {
    const existingIndex = cart.findIndex(c => c.itemId === item.id)

    if (existingIndex >= 0) {
      // Update quantity if already in cart
      setCart(prev => prev.map((c, i) =>
        i === existingIndex
          ? { ...c, quantity: c.quantity + 1 }
          : c
      ))
    } else {
      // Add new item to cart
      setCart(prev => [...prev, {
        itemId: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        oemPartNumber: item.oemPartNumber,
        pluCode: item.pluCode,
        quantity: 1,
        unitPrice: parseFloat(item.sellingPrice),
        availableStock: parseFloat(item.availableStock || item.currentStock),
      }])
    }

    setItemSearch('')
    setItems([])
  }

  function updateCartQuantity(index: number, quantity: number) {
    if (quantity <= 0) {
      removeFromCart(index)
      return
    }
    setCart(prev => prev.map((item, i) =>
      i === index ? { ...item, quantity } : item
    ))
  }

  function updateCartPrice(index: number, price: number) {
    if (price < 0) return
    setCart(prev => prev.map((item, i) =>
      i === index ? { ...item, unitPrice: price } : item
    ))
  }

  function removeFromCart(index: number) {
    setCart(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit() {
    if (!selectedCustomer) {
      setAlertModal({
        open: true,
        title: 'Customer Required',
        message: 'Please select a customer for the layaway',
        variant: 'warning',
      })
      return
    }

    if (cart.length === 0) {
      setAlertModal({
        open: true,
        title: 'Items Required',
        message: 'Please add at least one item to the layaway',
        variant: 'warning',
      })
      return
    }

    const deposit = parseFloat(depositAmount)
    if (isNaN(deposit) || deposit < minDeposit) {
      setAlertModal({
        open: true,
        title: 'Invalid Deposit',
        message: `Minimum deposit is 10% of total (${currencyCode} ${minDeposit.toFixed(2)})`,
        variant: 'warning',
      })
      return
    }

    if (deposit > total) {
      setAlertModal({
        open: true,
        title: 'Invalid Deposit',
        message: 'Deposit cannot exceed total amount',
        variant: 'warning',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/layaways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          items: cart.map(item => ({
            itemId: item.itemId,
            itemName: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          depositAmount: deposit,
          dueDate: dueDate || null,
          notes: notes || null,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(`Layaway ${data.layawayNo} created successfully`)
        onCreated()
      } else {
        const error = await res.json()
        setAlertModal({
          open: true,
          title: 'Error',
          message: error.error || 'Failed to create layaway',
          variant: 'error',
        })
      }
    } catch (error) {
      console.error('Error creating layaway:', error)
      setAlertModal({
        open: true,
        title: 'Error',
        message: 'An error occurred while creating the layaway',
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  function renderStepIndicator() {
    const steps = [
      { key: 'customer', label: 'Customer', icon: User },
      { key: 'items', label: 'Items', icon: Package },
      { key: 'payment', label: 'Payment', icon: Calendar },
    ]

    return (
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((s, index) => {
          const Icon = s.icon
          const isActive = s.key === step
          const isPast = steps.findIndex(x => x.key === step) > index

          return (
            <div key={s.key} className="flex items-center">
              {index > 0 && (
                <div className={`w-8 h-0.5 ${isPast ? 'bg-blue-500' : 'bg-gray-300'}`} />
              )}
              <div
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${
                  isActive
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : isPast
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                }`}
              >
                <Icon size={16} />
                {s.label}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Create Layaway"
        size="lg"
      >
        {renderStepIndicator()}

        {/* Step 1: Customer Selection */}
        {step === 'customer' && (
          <div className="space-y-4">
            {selectedCustomer ? (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-800 rounded-full flex items-center justify-center">
                      <User size={20} className="text-blue-600 dark:text-blue-300" />
                    </div>
                    <div>
                      <p className="font-medium dark:text-white">{selectedCustomer.name}</p>
                      {selectedCustomer.phone && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{selectedCustomer.phone}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedCustomer(null)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Search customers by name or phone..."
                  />
                </div>

                {loadingCustomers && (
                  <div className="text-center py-4 text-gray-500">Searching...</div>
                )}

                {customers.length > 0 && (
                  <div className="border dark:border-gray-600 rounded divide-y dark:divide-gray-600 max-h-60 overflow-y-auto">
                    {customers.map((customer) => (
                      <button
                        key={customer.id}
                        onClick={() => selectCustomer(customer)}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <p className="font-medium dark:text-white">{customer.name}</p>
                        {customer.phone && (
                          <p className="text-sm text-gray-500 dark:text-gray-400">{customer.phone}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {customerSearch.length >= 2 && !loadingCustomers && customers.length === 0 && (
                  <div className="text-center py-4 text-gray-500">
                    No customers found. Try a different search.
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setStep('items')}
                disabled={!selectedCustomer}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next: Add Items
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Item Selection */}
        {step === 'items' && (
          <div className="space-y-4">
            {/* Item Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="Search items by name, SKU, or barcode..."
              />
            </div>

            {loadingItems && (
              <div className="text-center py-2 text-gray-500 text-sm">Searching...</div>
            )}

            {items.length > 0 && (
              <div className="border dark:border-gray-600 rounded divide-y dark:divide-gray-600 max-h-40 overflow-y-auto">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex justify-between items-center"
                  >
                    <div>
                      <p className="font-medium dark:text-white">{formatItemLabel(item, businessType)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium dark:text-white">
                        {currencyCode} {parseFloat(item.sellingPrice).toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500">
                        Stock: {parseFloat(item.availableStock || item.currentStock).toFixed(0)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Cart */}
            <div className="border dark:border-gray-600 rounded">
              <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <h3 className="font-medium dark:text-white">Cart ({cart.length} items)</h3>
              </div>
              {cart.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  Search and add items to the layaway
                </div>
              ) : (
                <div className="divide-y dark:divide-gray-600 max-h-48 overflow-y-auto">
                  {cart.map((item, index) => (
                    <div key={index} className="px-4 py-2 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium dark:text-white truncate">{formatItemLabel(item, businessType)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateCartQuantity(index, parseInt(e.target.value) || 1)}
                          className="w-16 px-2 py-1 text-center border dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        />
                        <span className="text-gray-500">x</span>
                        <input
                          type="number"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateCartPrice(index, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-1 text-right border dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="w-24 text-right font-medium dark:text-white">
                        {currencyCode} {(item.quantity * item.unitPrice).toFixed(2)}
                      </div>
                      <button
                        onClick={() => removeFromCart(index)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                        aria-label="Remove item"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {cart.length > 0 && (
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-t dark:border-gray-600">
                  <div className="flex justify-between font-medium text-lg">
                    <span className="dark:text-white">Total:</span>
                    <span className="dark:text-white">{currencyCode} {total.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <button
                onClick={() => setStep('customer')}
                className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-white"
              >
                Back
              </button>
              <button
                onClick={() => setStep('payment')}
                disabled={cart.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next: Payment Details
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Payment Details */}
        {step === 'payment' && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500 dark:text-gray-400">Customer:</span>
                <span className="font-medium dark:text-white">{selectedCustomer?.name}</span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500 dark:text-gray-400">Items:</span>
                <span className="font-medium dark:text-white">{cart.length}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t dark:border-gray-600 pt-2 mt-2">
                <span className="dark:text-white">Total:</span>
                <span className="dark:text-white">{currencyCode} {total.toFixed(2)}</span>
              </div>
            </div>

            {/* Deposit */}
            <div>
              <FormLabel required>Initial Deposit</FormLabel>
              <FormInput
                type="number"
                step="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder={`Minimum: ${currencyCode} ${minDeposit.toFixed(2)} (10%)`}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setDepositAmount(minDeposit.toFixed(2))}
                  className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200"
                >
                  10%
                </button>
                <button
                  type="button"
                  onClick={() => setDepositAmount((total * 0.25).toFixed(2))}
                  className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200"
                >
                  25%
                </button>
                <button
                  type="button"
                  onClick={() => setDepositAmount((total * 0.5).toFixed(2))}
                  className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200"
                >
                  50%
                </button>
              </div>
            </div>

            {/* Due Date */}
            <div>
              <FormLabel>Due Date (Optional)</FormLabel>
              <FormInput
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Notes */}
            <div>
              <FormLabel>Notes (Optional)</FormLabel>
              <FormTextarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special instructions or notes..."
                rows={3}
              />
            </div>

            {/* Balance Preview */}
            {depositAmount && parseFloat(depositAmount) >= minDeposit && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-300">Deposit:</span>
                  <span className="font-medium text-green-600">{currencyCode} {parseFloat(depositAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-300">Remaining Balance:</span>
                  <span className="font-medium text-orange-600">
                    {currencyCode} {(total - parseFloat(depositAmount)).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <button
                onClick={() => setStep('items')}
                className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-white"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !depositAmount || parseFloat(depositAmount) < minDeposit}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Creating...' : 'Create Layaway'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <AlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal(prev => ({ ...prev, open: false }))}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </>
  )
}

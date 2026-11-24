'use client'

import React, { useState, useMemo } from 'react'
import {
  Search, X, Package, Loader2, ArrowLeft,
  RefreshCw, RotateCcw, AlertTriangle, ChevronRight, Plus, Minus
} from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import type { SaleForReturn } from './types'
import { useEscapeKey } from '@/hooks/useEscapeKey'

export interface SelectedReturnLine {
  originalSaleItemId?: string
  itemId?: string
  name: string
  quantity: number
  unitPrice: number
  total: number
  serialNumberIds?: string[]
  maxReturnQuantity?: number
  sku?: string | null
}

interface ReturnLookupModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirmReturn: (
    sale: SaleForReturn | null,
    selectedLines: SelectedReturnLine[],
    reason?: string
  ) => void
  onConfirmExchange: (
    sale: SaleForReturn | null,
    selectedLines: SelectedReturnLine[],
    reason?: string
  ) => void
  returnSearchQuery: string
  setReturnSearchQuery: (query: string) => void
  returnSearchResults: SaleForReturn[]
  searchingReturns: boolean
  onSearchInvoiceExact?: (code: string) => Promise<SaleForReturn | null>
}

export function ReturnLookupModal({
  isOpen,
  onClose,
  onConfirmReturn,
  onConfirmExchange,
  returnSearchQuery,
  setReturnSearchQuery,
  returnSearchResults,
  searchingReturns,
  onSearchInvoiceExact,
}: ReturnLookupModalProps) {
  const { currency: currencyCode } = useCurrency()

  // State
  const [selectedSale, setSelectedSale] = useState<SaleForReturn | null>(null)
  const [loadingSaleDetails, setLoadingSaleDetails] = useState(false)
  const [manualMode, setManualMode] = useState(false)

  // Item selections: Map of saleItemId -> quantity to return
  const [selectedItemQuantities, setSelectedItemQuantities] = useState<Record<string, number>>({})
  const [selectedItemChecked, setSelectedItemChecked] = useState<Record<string, boolean>>({})
  const [returnReason, setReturnReason] = useState('Customer exchange / return')

  // Manual entry items
  const [manualItemSearch, setManualItemSearch] = useState('')
  const [manualSearchResults, setManualSearchResults] = useState<Array<{ id: string; name: string; sellingPrice: string; sku?: string }>>([])
  const [manualSearching, setManualSearching] = useState(false)
  const [manualSelectedItems, setManualSelectedItems] = useState<SelectedReturnLine[]>([])

  useEscapeKey(isOpen, () => {
    if (selectedSale) {
      setSelectedSale(null)
    } else if (manualMode) {
      setManualMode(false)
    } else {
      onClose()
    }
  })

  // Select an invoice from search results
  async function handleSelectSale(sale: SaleForReturn) {
    setLoadingSaleDetails(true)
    try {
      let detailedSale = sale
      // If sale items do not have remainingQuantity, fetch through /api/sales/lookup?code=
      if (onSearchInvoiceExact && (!sale.items || sale.items[0]?.remainingQuantity === undefined)) {
        const full = await onSearchInvoiceExact(sale.invoiceNo)
        if (full) detailedSale = full
      }
      setSelectedSale(detailedSale)

      // Initialize selection: pre-select returnable items with remaining quantity
      const initialChecked: Record<string, boolean> = {}
      const initialQty: Record<string, number> = {}

      for (const it of detailedSale.items || []) {
        const remaining = it.remainingQuantity ?? Math.abs(parseFloat(it.quantity))
        if (remaining > 0 && !it.isGiftCard) {
          initialChecked[it.id] = true
          initialQty[it.id] = remaining
        } else {
          initialChecked[it.id] = false
          initialQty[it.id] = 0
        }
      }

      setSelectedItemChecked(initialChecked)
      setSelectedItemQuantities(initialQty)
    } finally {
      setLoadingSaleDetails(false)
    }
  }

  // Calculate lines selected from invoice
  const returnLinesFromInvoice = useMemo<SelectedReturnLine[]>(() => {
    if (!selectedSale || !selectedSale.items) return []
    const lines: SelectedReturnLine[] = []

    for (const it of selectedSale.items) {
      if (selectedItemChecked[it.id]) {
        const qty = selectedItemQuantities[it.id] || 1
        const unitPrice = it.refundUnitAmount ?? (Math.abs(parseFloat(it.total)) / Math.max(1, Math.abs(parseFloat(it.quantity))))
        const remaining = it.remainingQuantity ?? Math.abs(parseFloat(it.quantity))
        const serials = (it.remainingSerialNumberIds || it.serialNumberIds || []) as string[]

        lines.push({
          originalSaleItemId: it.id,
          itemId: it.itemId ?? undefined,
          name: it.itemName,
          quantity: qty,
          unitPrice: Math.round(unitPrice * 100) / 100,
          total: Math.round(qty * unitPrice * 100) / 100,
          maxReturnQuantity: remaining,
          serialNumberIds: serials.slice(0, qty),
        })
      }
    }

    return lines
  }, [selectedSale, selectedItemChecked, selectedItemQuantities])

  // Total return value
  const totalReturnValue = useMemo(() => {
    if (manualMode) {
      return manualSelectedItems.reduce((sum, item) => sum + item.total, 0)
    }
    return returnLinesFromInvoice.reduce((sum, item) => sum + item.total, 0)
  }, [manualMode, manualSelectedItems, returnLinesFromInvoice])

  // Stepper helper for invoice items
  function handleQtyChange(itemId: string, maxQty: number, delta: number) {
    setSelectedItemQuantities((prev) => {
      const current = prev[itemId] || 1
      const updated = Math.min(maxQty, Math.max(1, current + delta))
      return { ...prev, [itemId]: updated }
    })
  }

  // Stepper helper for direct input
  function handleDirectQtyChange(itemId: string, maxQty: number, val: number) {
    const updated = Math.min(maxQty, Math.max(1, isNaN(val) ? 1 : val))
    setSelectedItemQuantities((prev) => ({ ...prev, [itemId]: updated }))
  }

  // Manual search catalog
  async function searchCatalog(query: string) {
    setManualItemSearch(query)
    if (!query.trim() || query.length < 2) {
      setManualSearchResults([])
      return
    }
    setManualSearching(true)
    try {
      const res = await fetch(`/api/items?search=${encodeURIComponent(query)}&limit=10`)
      if (res.ok) {
        const data = await res.json()
        setManualSearchResults(data.items || data || [])
      }
    } catch {
      // silent
    } finally {
      setManualSearching(false)
    }
  }

  function addManualItem(item: { id: string; name: string; sellingPrice: string; sku?: string }) {
    const price = parseFloat(item.sellingPrice) || 0
    setManualSelectedItems((prev) => {
      const existing = prev.find((p) => p.itemId === item.id)
      if (existing) {
        return prev.map((p) => (p.itemId === item.id ? { ...p, quantity: p.quantity + 1, total: (p.quantity + 1) * p.unitPrice } : p))
      }
      return [
        ...prev,
        {
          itemId: item.id,
          name: item.name,
          quantity: 1,
          unitPrice: price,
          total: price,
          sku: item.sku || null,
        },
      ]
    })
    setManualItemSearch('')
    setManualSearchResults([])
  }

  function handleAction(type: 'return' | 'exchange') {
    const lines = manualMode ? manualSelectedItems : returnLinesFromInvoice
    if (lines.length === 0) return

    if (type === 'return') {
      onConfirmReturn(manualMode ? null : selectedSale, lines, returnReason)
    } else {
      onConfirmExchange(manualMode ? null : selectedSale, lines, returnReason)
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] border border-gray-100 dark:border-gray-800">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/40">
          <div className="flex items-center gap-3">
            {(selectedSale || manualMode) && (
              <button
                onClick={() => {
                  if (selectedSale) setSelectedSale(null)
                  if (manualMode) setManualMode(false)
                }}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-500 transition-colors"
                title="Back to search"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <RefreshCw size={20} className="text-amber-500" />
                Return & Exchange Hub
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {selectedSale
                  ? `Selecting items from ${selectedSale.invoiceNo}`
                  : manualMode
                  ? 'Manual Return / Exchange without receipt'
                  : 'Search original invoice or enter items manually'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* VIEW 1: Initial Choice / Search */}
          {!selectedSale && !manualMode && (
            <div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <button
                  onClick={() => setManualMode(true)}
                  className="p-5 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-all text-center group"
                >
                  <Package size={36} className="mx-auto mb-2 text-gray-400 group-hover:text-amber-500 transition-colors" />
                  <div className="font-bold text-gray-900 dark:text-white">Manual Return / Exchange</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">When customer has no receipt</div>
                </button>
                <div className="p-5 border-2 border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl text-center">
                  <Search size={36} className="mx-auto mb-2 text-blue-600 dark:text-blue-400" />
                  <div className="font-bold text-blue-900 dark:text-blue-300">Lookup by Invoice</div>
                  <div className="text-xs text-blue-700/70 dark:text-blue-400/80 mt-1">Recommended — exact prices paid</div>
                </div>
              </div>

              <div className="mb-4">
                <FormInput
                  type="text"
                  placeholder="Scan receipt barcode / QR code or search invoice / customer..."
                  value={returnSearchQuery}
                  onChange={(e) => setReturnSearchQuery(e.target.value)}
                  leftIcon={<Search size={20} className="text-gray-400" />}
                  inputSize="lg"
                  autoFocus
                />
              </div>

              <div className="max-h-72 overflow-y-auto pr-1">
                {searchingReturns || loadingSaleDetails ? (
                  <div className="text-center py-12">
                    <Loader2 className="animate-spin mx-auto text-blue-600" size={32} />
                    <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm font-medium">Searching invoices...</p>
                  </div>
                ) : returnSearchResults.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                    <RotateCcw size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="font-medium text-sm">
                      {returnSearchQuery ? 'No matching completed sales found' : 'Scan receipt barcode or type invoice number'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {returnSearchResults.map((sale) => (
                      <button
                        key={sale.id}
                        onClick={() => handleSelectSale(sale)}
                        className="w-full p-4 border border-gray-200 dark:border-gray-700 rounded-2xl hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 text-left transition-all group flex items-center justify-between"
                      >
                        <div>
                          <div className="font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                            <span>{sale.invoiceNo}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-semibold">
                              Completed
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {sale.customer?.name || 'Walk-in Customer'} &bull; {new Date(sale.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-3">
                          <div>
                            <div className="font-extrabold text-base text-gray-900 dark:text-white">
                              {currencyCode} {parseFloat(sale.total).toFixed(2)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{sale.items?.length || 0} items</div>
                          </div>
                          <ChevronRight size={18} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW 2: Interactive Invoice Item Selection */}
          {selectedSale && !manualMode && (
            <div>
              {/* Invoice Banner */}
              <div className="p-3.5 bg-gray-50 dark:bg-gray-800/60 rounded-2xl border border-gray-200 dark:border-gray-700 flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Original Sale</div>
                  <div className="font-extrabold text-base text-gray-900 dark:text-white">{selectedSale.invoiceNo}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500 dark:text-gray-400">{selectedSale.customer?.name || 'Walk-in'}</div>
                  <div className="font-bold text-sm text-gray-700 dark:text-gray-300">
                    {currencyCode} {parseFloat(selectedSale.total).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Items List with checkboxes & quantity steppers */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Select Items Being Returned
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const checked: Record<string, boolean> = {}
                        for (const it of selectedSale.items || []) {
                          const rem = it.remainingQuantity ?? Math.abs(parseFloat(it.quantity))
                          if (rem > 0 && !it.isGiftCard) checked[it.id] = true
                        }
                        setSelectedItemChecked(checked)
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                    >
                      Select All
                    </button>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedItemChecked({})}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                  {(selectedSale.items || []).map((it) => {
                    const remaining = it.remainingQuantity ?? Math.abs(parseFloat(it.quantity))
                    const isChecked = !!selectedItemChecked[it.id]
                    const currentQty = selectedItemQuantities[it.id] || 1
                    const unitPrice = it.refundUnitAmount ?? (Math.abs(parseFloat(it.total)) / Math.max(1, Math.abs(parseFloat(it.quantity))))
                    const disabled = remaining <= 0 || it.isGiftCard

                    return (
                      <div
                        key={it.id}
                        className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                          disabled
                            ? 'bg-gray-100 dark:bg-gray-800/30 border-gray-200 dark:border-gray-800 opacity-60'
                            : isChecked
                            ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-700'
                            : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        {/* Checkbox & Item details */}
                        <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={disabled}
                            onChange={(e) => {
                              setSelectedItemChecked((prev) => ({ ...prev, [it.id]: e.target.checked }))
                              if (e.target.checked && !selectedItemQuantities[it.id]) {
                                setSelectedItemQuantities((prev) => ({ ...prev, [it.id]: remaining }))
                              }
                            }}
                            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm text-gray-900 dark:text-white truncate">{it.itemName}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-0.5">
                              <span>Price: {currencyCode} {unitPrice.toFixed(2)}</span>
                              <span>&bull;</span>
                              <span>Available: {remaining} of {Math.abs(parseFloat(it.quantity))}</span>
                              {it.isGiftCard && <span className="text-red-500 font-semibold">(Non-returnable)</span>}
                            </div>
                          </div>
                        </label>

                        {/* Stepper & Line Total */}
                        {isChecked && !disabled && (
                          <div className="flex items-center gap-3">
                            <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => handleQtyChange(it.id, remaining, -1)}
                                disabled={currentQty <= 1}
                                className="px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-300"
                              >
                                <Minus size={13} />
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={remaining}
                                value={currentQty}
                                onChange={(e) => handleDirectQtyChange(it.id, remaining, parseInt(e.target.value))}
                                className="w-10 text-center font-bold text-xs py-1 border-0 focus:ring-0 text-gray-900 dark:text-white bg-transparent"
                              />
                              <button
                                type="button"
                                onClick={() => handleQtyChange(it.id, remaining, 1)}
                                disabled={currentQty >= remaining}
                                className="px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-300"
                              >
                                <Plus size={13} />
                              </button>
                            </div>

                            <div className="text-right min-w-[70px]">
                              <div className="font-extrabold text-sm text-gray-900 dark:text-white">
                                {currencyCode} {(currentQty * unitPrice).toFixed(2)}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Reason selector */}
              <div className="mb-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Reason for Return / Exchange
                </label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 text-sm text-gray-900 dark:text-white font-medium"
                >
                  <option value="Customer exchange / return">Customer exchange / return</option>
                  <option value="Wrong size / color / fit">Wrong size / color / fit</option>
                  <option value="Defective or damaged">Defective or damaged item</option>
                  <option value="Customer changed mind">Customer changed mind</option>
                  <option value="Billing or item error">Billing or cashier error</option>
                </select>
              </div>
            </div>
          )}

          {/* VIEW 3: Manual Entry (No Receipt) */}
          {manualMode && (
            <div>
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-800 flex items-center gap-2.5 mb-4 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                <span>
                  Manual return uses current catalog prices and requires a return reason.
                </span>
              </div>

              <div className="mb-4">
                <FormInput
                  type="text"
                  placeholder="Search catalog item to return/exchange..."
                  value={manualItemSearch}
                  onChange={(e) => searchCatalog(e.target.value)}
                  leftIcon={<Search size={18} className="text-gray-400" />}
                  inputSize="md"
                  autoFocus
                />

                {manualSearching && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Loader2 size={14} className="animate-spin" />
                    Searching items...
                  </div>
                )}

                {manualSearchResults.length > 0 && (
                  <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-xl max-h-48 overflow-y-auto bg-white dark:bg-gray-900 shadow-lg divide-y divide-gray-100 dark:divide-gray-800">
                    {manualSearchResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addManualItem(item)}
                        className="w-full p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-left flex justify-between items-center text-sm"
                      >
                        <span className="font-semibold text-gray-900 dark:text-white">{item.name}</span>
                        <span className="font-bold text-gray-700 dark:text-gray-300">
                          {currencyCode} {parseFloat(item.sellingPrice).toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected Manual Items List */}
              <div className="mb-4">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  Items to Return ({manualSelectedItems.length})
                </div>
                {manualSelectedItems.length === 0 ? (
                  <div className="p-6 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl text-center text-gray-400 text-xs">
                    Search and pick items above to return.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {manualSelectedItems.map((item, idx) => (
                      <div
                        key={`${item.itemId}-${idx}`}
                        className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-sm text-gray-900 dark:text-white">{item.name}</div>
                          <div className="text-xs text-gray-500">{currencyCode} {item.unitPrice.toFixed(2)} each</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setManualSelectedItems((prev) =>
                                  prev
                                    .map((p, i) => (i === idx ? { ...p, quantity: p.quantity - 1, total: (p.quantity - 1) * p.unitPrice } : p))
                                    .filter((p) => p.quantity > 0)
                                )
                              }}
                              className="px-2 py-1 text-gray-600 hover:bg-gray-100"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="px-2 font-bold text-xs">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setManualSelectedItems((prev) =>
                                  prev.map((p, i) => (i === idx ? { ...p, quantity: p.quantity + 1, total: (p.quantity + 1) * p.unitPrice } : p))
                                )
                              }}
                              className="px-2 py-1 text-gray-600 hover:bg-gray-100"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          <div className="font-extrabold text-sm min-w-[70px] text-right">
                            {currencyCode} {item.total.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reason input */}
              <div className="mb-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Reason for Return (Required)
                </label>
                <input
                  type="text"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="e.g. Return without receipt / Customer changed mind"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 text-sm text-gray-900 dark:text-white font-medium"
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer: Action Bar */}
        {(selectedSale || manualMode) && (
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total Return Value:</div>
              <div className="text-xl font-black text-gray-900 dark:text-white">
                {currencyCode} {totalReturnValue.toFixed(2)}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Option 1: Return & Refund */}
              <button
                type="button"
                onClick={() => handleAction('return')}
                disabled={totalReturnValue <= 0}
                className="px-4 py-2.5 rounded-xl border-2 border-red-500 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 font-bold text-sm transition-all disabled:opacity-40 flex items-center gap-2"
                title="Return items and refund cash/card/credit to customer"
              >
                <RotateCcw size={16} />
                <span>Return & Refund</span>
              </button>

              {/* Option 2: Exchange for other items */}
              <button
                type="button"
                onClick={() => handleAction('exchange')}
                disabled={totalReturnValue <= 0}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-sm shadow-md transition-all active:scale-95 disabled:opacity-40 flex items-center gap-2"
                title="Apply credit and pick replacement items in POS"
              >
                <RefreshCw size={16} />
                <span>Exchange for New Items</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

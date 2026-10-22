'use client'

import { Plus, Minus, Trash2, ShoppingBag, Pause, Clock, ChevronRight, User, Car, Tag, Star, Heart } from 'lucide-react'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { FormInput } from '@/components/ui/form-elements'
import { OrderTypeSelector } from './OrderTypeSelector'
import { TableSelector } from './TableSelector'
import { useTerminology } from '@/hooks/useTerminology'
import { useCurrency } from '@/hooks/useCurrency'
import type { CartItem, Customer, Vehicle, HeldSale, SaleForReturn, LoyaltyProgram, POSBusinessConfig, RestaurantTable } from './types'

interface CartPanelProps {
  cart: CartItem[]
  isReturnMode: boolean
  returnAgainstSale: SaleForReturn | null

  config: POSBusinessConfig

  selectedCustomer: Customer | null
  selectedVehicle: Vehicle | null
  customers: Customer[]
  filteredVehicles: Vehicle[]
  onCustomerChange: (customer: Customer | null) => void
  onVehicleSelect: (vehicleId: string) => void
  onCreateCustomer: (name: string) => void
  onCreateVehicle: () => void

  onUpdateQuantity: (cartLineId: string, delta: number) => void
  onRemoveFromCart: (cartLineId: string) => void
  onUpdatePrice: (cartLineId: string, newPrice: number) => void
  onSetQuantityDirectly: (cartLineId: string, qty: number) => void
  /** D1: cashier picked another batch for a batch-tracked line */
  onChangeBatch?: (cartLineId: string, batchId: string) => void
  onClearCart: () => void
  onCancelReturnMode: () => void
  /** Return mode against an invoice: turn the selected return lines into an exchange (W8) */
  onStartExchange?: () => void

  subtotal: number
  itemCount: number
  discountAmount: number
  saleDiscount: { type: 'percentage' | 'fixed'; value: number; reason: string }
  tax: number
  isTaxExempt: boolean
  total: number
  loyaltyRedeemValue: number
  loyaltyRedeemPoints: number

  heldSales: HeldSale[]
  onShowHeldSales: () => void
  holdingInProgress: boolean
  onHoldSale: () => void

  onOpenPayment: () => void

  allowDiscount: boolean
  onShowDiscount: () => void

  loyaltyProgram: LoyaltyProgram | null

  // Restaurant
  orderType?: 'dine_in' | 'takeaway' | 'delivery'
  onOrderTypeChange?: (type: 'dine_in' | 'takeaway' | 'delivery') => void
  tables?: RestaurantTable[]
  selectedTableId?: string | null
  onTableSelect?: (tableId: string) => void
  tipAmount?: number
  onTipChange?: (amount: number) => void
  onSendToKitchen?: () => void
  restaurantOrderId?: string | null

  /** H5: cart-level promotions from /api/price-quote, and the coupon field */
  cartPromotions?: Array<{ promotionId: string; label: string; amount: number }>
  couponCode?: string
  onCouponChange?: (code: string) => void
}

export function CartPanel({
  cart,
  isReturnMode,
  returnAgainstSale,
  config,
  selectedCustomer,
  selectedVehicle,
  customers,
  filteredVehicles,
  onCustomerChange,
  onVehicleSelect,
  onCreateCustomer,
  onCreateVehicle,
  onUpdateQuantity,
  onRemoveFromCart,
  onUpdatePrice,
  onSetQuantityDirectly,
  onChangeBatch,
  onClearCart,
  onCancelReturnMode,
  onStartExchange,
  subtotal,
  itemCount,
  discountAmount,
  saleDiscount,
  tax,
  isTaxExempt,
  total,
  loyaltyRedeemValue,
  loyaltyRedeemPoints,
  heldSales,
  onShowHeldSales,
  holdingInProgress,
  onHoldSale,
  onOpenPayment,
  allowDiscount,
  onShowDiscount,
  loyaltyProgram,
  orderType,
  onOrderTypeChange,
  tables,
  selectedTableId,
  onTableSelect,
  tipAmount,
  onTipChange,
  onSendToKitchen,
  restaurantOrderId,
  cartPromotions,
  couponCode,
  onCouponChange,
}: CartPanelProps) {
  const terms = useTerminology()
  const { currency: currencyCode } = useCurrency()

  return (
    <div className="w-full lg:w-[40%] min-w-[360px] xl:min-w-[420px] flex-shrink-0 flex flex-col bg-white border-l border-slate-200 shadow-xl">
      {/* Cart Header */}
      <div className={`px-5 py-4 border-b ${isReturnMode ? 'bg-red-50' : 'bg-white'}`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className={`text-xl font-bold ${isReturnMode ? 'text-red-700' : 'text-gray-900'}`}>
              {isReturnMode ? 'Return' : terms.currentSale}
            </h2>
            {isReturnMode && returnAgainstSale && (
              <p className="text-sm text-red-600">Invoice: {returnAgainstSale.invoiceNo}</p>
            )}
          </div>
          {isReturnMode && (
            <div className="flex items-center gap-2">
              {onStartExchange && cart.length > 0 && (
                <button
                  onClick={onStartExchange}
                  className="px-3 py-1.5 bg-amber-500 text-white rounded text-sm font-medium hover:bg-amber-600"
                  title="Return the selected lines and sell replacement items, paying only the difference"
                >
                  Exchange
                </button>
              )}
              <button
                onClick={onCancelReturnMode}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-sm font-medium hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Customer & Vehicle Selection */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
              <User size={16} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <CreatableSelect
                options={customers.map(c => ({ value: c.id, label: c.name }))}
                value={selectedCustomer?.id || ''}
                onChange={(value) => onCustomerChange(customers.find(c => c.id === value) || null)}
                onCreateNew={(name) => onCreateCustomer(name)}
                placeholder={terms.walkInCustomer}
                createLabel="Add customer"
              />
            </div>
          </div>

          {config.showVehicleSelector && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-100 rounded flex items-center justify-center">
                <Car size={16} className="text-purple-600" />
              </div>
              <div className="flex-1">
                <CreatableSelect
                  options={filteredVehicles.map(v => ({
                    value: v.id,
                    label: `${v.year ? `${v.year} ` : ''}${v.make} ${v.model}${v.licensePlate ? ` (${v.licensePlate})` : ''}`
                  }))}
                  value={selectedVehicle?.id || ''}
                  onChange={(value) => onVehicleSelect(value)}
                  onCreateNew={() => onCreateVehicle()}
                  placeholder="Select Vehicle"
                  createLabel="Add vehicle"
                />
              </div>
            </div>
          )}
        </div>

        {/* Restaurant: Order Type + Table Selector */}
        {config.showOrderTypeSelector && onOrderTypeChange && !isReturnMode && (
          <div className="mt-2">
            <OrderTypeSelector
              value={orderType || 'dine_in'}
              onChange={onOrderTypeChange}
            />
          </div>
        )}
        {config.showTableSelector && tables && onTableSelect && orderType === 'dine_in' && !isReturnMode && (
          <div className="mt-2">
            <TableSelector
              tables={tables}
              selectedTableId={selectedTableId || null}
              onSelect={onTableSelect}
            />
          </div>
        )}

        {/* Loyalty Points Badge */}
        {selectedCustomer && loyaltyProgram && (selectedCustomer.loyaltyPoints || 0) > 0 && !isReturnMode && (
          <div className="flex items-center gap-2 mt-2 px-2 py-1.5 bg-purple-50 border border-purple-200 rounded">
            <Star size={14} className="text-purple-600" />
            <span className="text-sm font-medium text-purple-700">
              {selectedCustomer.loyaltyPoints} points
            </span>
            {selectedCustomer.loyaltyTier && (
              <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-600 rounded-full capitalize">
                {selectedCustomer.loyaltyTier}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <ShoppingBag className="w-10 h-10 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium">Cart is empty</p>
            <p className="text-gray-400 text-sm mt-1">Add items to get started</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {cart.map((item) => (
              <div
                key={item.cartLineId}
                className={`rounded-md border-2 p-4 ${
                  isReturnMode ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 truncate">{item.name}</h4>
                    {isReturnMode && (
                      <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded mt-1">
                        Return Item
                      </span>
                    )}
                    {isReturnMode && item.maxReturnQuantity !== undefined && (
                      <span className="inline-block ml-2 text-xs text-red-600 mt-1">
                        {item.maxReturnQuantity} returnable
                      </span>
                    )}
                    {/* H5: unit, price list and promotions of the line */}
                    {item.uom && (
                      <span className="inline-block mt-0.5 mr-1 px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-700">
                        {item.uom}{item.uomFactor && item.uomFactor !== 1 ? ` × ${item.uomFactor}` : ''}
                      </span>
                    )}
                    {item.priceListName && (
                      <span className="inline-block mt-0.5 mr-1 px-1.5 py-0.5 text-xs rounded bg-blue-50 text-blue-700">
                        {item.priceListName}
                        {item.catalogPrice !== undefined && item.catalogPrice !== item.unitPrice && (
                          <s className="ml-1 text-gray-400">{item.catalogPrice.toFixed(2)}</s>
                        )}
                      </span>
                    )}
                    {!!item.promotionDiscount && item.promotionDiscount > 0 && (
                      <p className="text-xs text-green-700 mt-0.5">
                        {(item.promotionLabels || []).join(', ')} −{currencyCode} {item.promotionDiscount.toFixed(2)}
                      </p>
                    )}
                    {item.weight && item.isWeighable && (
                      <p className="text-xs text-orange-600 mt-0.5">
                        {item.weight.toFixed(3)} kg @ {currencyCode} {item.unitPrice.toFixed(2)}/kg
                      </p>
                    )}
                    {item.batchNumber && (
                      <div className="text-xs text-teal-700 dark:text-teal-400 mt-0.5 flex items-center gap-1">
                        <span>Batch</span>
                        {onChangeBatch && item.batchOptions && item.batchOptions.length > 1 ? (
                          <select
                            aria-label="Batch"
                            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1 py-0 bg-white dark:bg-gray-800"
                            value={item.batchId || ''}
                            onChange={(e) => onChangeBatch(item.cartLineId, e.target.value)}
                          >
                            {item.batchOptions.map(b => (
                              <option key={b.id} value={b.id}>
                                {b.batchNumber}{b.expiryDate ? ` · exp ${b.expiryDate}` : ''} ({b.currentQuantity}){b.expired ? ' · EXPIRED' : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>
                            {item.batchNumber}{item.batchExpiry ? ` · exp ${item.batchExpiry}` : ''}
                            {item.batchOptions?.find(b => b.id === item.batchId)?.expired && (
                              <span className="ml-1 font-semibold text-red-600 dark:text-red-400">EXPIRED</span>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    {item.modifiers && item.modifiers.length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.modifiers.map(m => m.price > 0 ? `${m.name} (+${m.price.toFixed(0)})` : m.name).join(', ')}
                      </p>
                    )}
                    {item.coreCharge && item.coreCharge > 0 && (
                      <p className="text-xs text-purple-600 mt-0.5">
                        Core charge: {currencyCode} {(item.coreCharge * Math.abs(item.quantity)).toFixed(2)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onRemoveFromCart(item.cartLineId)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  {/* Quantity Controls */}
                  <div className="flex items-center gap-1 bg-white rounded border p-1">
                    <button
                      onClick={() => onUpdateQuantity(item.cartLineId, -1)}
                      className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors"
                    >
                      <Minus size={16} />
                    </button>
                    <FormInput
                      type="number"
                      inputSize="sm"
                      key={`qty-${item.cartLineId}-${item.quantity}`}
                      defaultValue={item.quantity}
                      onBlur={(e) => {
                        const newQty = parseInt(e.currentTarget.value) || 0
                        if (newQty !== item.quantity) onSetQuantityDirectly(item.cartLineId, newQty)
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      className="w-14 text-center font-bold !border-0 !ring-0 !shadow-none"
                    />
                    <button
                      onClick={() => onUpdateQuantity(item.cartLineId, 1)}
                      className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  {/* Price */}
                  <div className="text-right">
                    <div className={`text-lg font-bold ${item.total < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {currencyCode} {Math.abs(item.total - (item.promotionDiscount || 0)).toFixed(2)}
                    </div>
                    {!!item.promotionDiscount && item.promotionDiscount > 0 && (
                      <div className="text-xs text-gray-400 line-through">{currencyCode} {Math.abs(item.total).toFixed(2)}</div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-gray-500 justify-end">
                      <span>@</span>
                      <FormInput
                        type="number"
                        inputSize="sm"
                        step="0.01"
                        min={0.01}
                        key={`price-${item.cartLineId}-${item.unitPrice}`}
                        defaultValue={item.unitPrice}
                        onBlur={(e) => {
                          const newPrice = parseFloat(e.currentTarget.value) || 0
                          if (newPrice !== item.unitPrice) onUpdatePrice(item.cartLineId, newPrice)
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        className="w-20 text-right !px-1 !py-0.5 !h-6 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cart Footer */}
      <div className={`border-t ${isReturnMode ? 'bg-red-50' : 'bg-white'}`}>
        {/* Held Sales Indicator */}
        {!isReturnMode && heldSales.length > 0 && (
          <button
            onClick={onShowHeldSales}
            className="w-full px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between hover:bg-amber-100 transition-colors"
          >
            <div className="flex items-center gap-2 text-amber-700">
              <Clock size={18} />
              <span className="font-medium">{heldSales.length} Held Sale{heldSales.length !== 1 ? 's' : ''}</span>
            </div>
            <ChevronRight size={18} className="text-amber-600" />
          </button>
        )}

        {/* Totals */}
        <div className="px-5 py-4 space-y-2">
          <div className="flex justify-between text-gray-600">
            <span>Items ({itemCount})</span>
            <span>{currencyCode} {Math.abs(subtotal).toFixed(2)}</span>
          </div>
          {/* H5: cart promotions + coupon */}
          {!isReturnMode && cartPromotions && cartPromotions.map((p) => (
            <div key={p.promotionId} className="flex justify-between text-green-700 text-sm">
              <span className="flex items-center gap-1"><Tag size={14} />{p.label}</span>
              <span>-{currencyCode} {p.amount.toFixed(2)}</span>
            </div>
          ))}
          {!isReturnMode && onCouponChange && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Coupon</span>
              <input
                aria-label="Coupon code"
                key={`coupon-${couponCode || ''}`}
                defaultValue={couponCode || ''}
                placeholder="Code"
                onBlur={(e) => onCouponChange(e.currentTarget.value.trim().toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="flex-1 px-2 py-1 border rounded text-sm uppercase"
              />
            </div>
          )}
          {/* Discount Row */}
          {!isReturnMode && (
            <button
              onClick={() => allowDiscount && onShowDiscount()}
              className={`flex justify-between w-full text-left ${
                discountAmount > 0 ? 'text-green-600' : 'text-gray-400 hover:text-gray-600'
              } ${!allowDiscount ? 'cursor-default' : 'cursor-pointer'}`}
              disabled={!allowDiscount}
            >
              <span className="flex items-center gap-1">
                <Tag size={14} />
                Discount
                {saleDiscount.value > 0 && (
                  <span className="text-xs">
                    ({saleDiscount.type === 'percentage' ? `${saleDiscount.value}%` : 'Fixed'})
                  </span>
                )}
              </span>
              <span>
                {discountAmount > 0 ? `-${currencyCode} ${discountAmount.toFixed(2)}` : `${currencyCode} 0.00`}
              </span>
            </button>
          )}
          {/* Tax Row */}
          {(tax > 0 || !isTaxExempt) && (
            <div className="flex justify-between text-gray-600">
              <span>
                Tax
                {isTaxExempt && <span className="text-xs text-amber-600 ml-1">Exempt</span>}
              </span>
              <span>{currencyCode} {tax.toFixed(2)}</span>
            </div>
          )}
          {/* Tip Row (Restaurant) */}
          {config.enableTips && !isReturnMode && onTipChange && (
            <div className="flex justify-between items-center text-gray-600">
              <span className="flex items-center gap-1">
                <Heart size={14} />
                Tip
              </span>
              <FormInput
                type="number"
                inputSize="sm"
                step="0.01"
                min={0}
                key={`tip-${tipAmount}`}
                defaultValue={tipAmount || 0}
                onBlur={(e) => {
                  const val = parseFloat(e.currentTarget.value) || 0
                  onTipChange(Math.max(0, val))
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="w-24 text-right !px-2 !py-1 !h-7 text-sm"
              />
            </div>
          )}
          {/* Loyalty Redemption Row */}
          {loyaltyRedeemValue > 0 && !isReturnMode && (
            <div className="flex justify-between text-purple-600">
              <span className="flex items-center gap-1">
                <Star size={14} />
                Points ({loyaltyRedeemPoints} pts)
              </span>
              <span>-{currencyCode} {loyaltyRedeemValue.toFixed(2)}</span>
            </div>
          )}
          <div className={`flex justify-between items-baseline text-2xl font-black pt-3 border-t border-slate-200 ${isReturnMode ? 'text-red-700' : 'text-teal-950 font-mono'}`}>
            <span className="text-sm font-sans font-bold text-slate-500 uppercase tracking-wider">{isReturnMode ? 'Refund Due' : 'Total Payable'}</span>
            <span className="text-2xl font-mono font-black text-teal-800">
              {currencyCode} {Math.abs(isReturnMode ? total : Math.max(0, total - loyaltyRedeemValue + (config.enableTips ? (tipAmount || 0) : 0))).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Send to Kitchen (Restaurant) */}
        {config.enableKitchenSend && !isReturnMode && onSendToKitchen && (
          <div className="px-5 pb-2">
            <button
              onClick={onSendToKitchen}
              disabled={cart.length === 0 || !restaurantOrderId}
              className="w-full py-2.5 bg-orange-50 text-orange-700 rounded-xl font-bold hover:bg-orange-100 transition-colors flex items-center justify-center gap-2 border border-orange-200 disabled:opacity-50"
            >
              Send to Kitchen
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="px-5 pb-5 grid grid-cols-3 gap-3">
          <button
            onClick={onClearCart}
            disabled={cart.length === 0}
            className="py-3.5 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Clear
          </button>
          {!isReturnMode && (
            <button
              onClick={onHoldSale}
              disabled={cart.length === 0 || holdingInProgress}
              className="py-3.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl font-bold hover:bg-amber-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Pause size={17} />
              Hold
            </button>
          )}
          <button
            onClick={onOpenPayment}
            disabled={cart.length === 0}
            className={`py-3.5 text-white rounded-xl font-extrabold shadow-md hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 ${
              isReturnMode
                ? 'bg-gradient-to-r from-red-600 to-red-500 col-span-2'
                : 'bg-teal-700 hover:bg-teal-800 shadow-teal-900/20'
            }`}
          >
            {isReturnMode ? 'Process Refund' : `${terms.payNow} →`}
          </button>
        </div>
      </div>
    </div>
  )
}

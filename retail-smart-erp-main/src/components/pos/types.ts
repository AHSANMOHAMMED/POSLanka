export interface Item {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  sellingPrice: string
  currentStock: string
  reservedStock: string
  availableStock: string
  trackStock: boolean
  trackSerialNumbers?: boolean
  /** D1: batch-tracked item (sale lines carry a batch, FEFO by default) */
  trackBatches?: boolean
  oemPartNumber: string | null
  supplierPartNumber: string | null
  alternatePartNumbers: string[] | null
  categoryId: string | null
  categoryName?: string | null
  isWeighable?: boolean
  unit?: string | null
  pluCode?: string | null
  itemCode?: string | null
  /** Pharmacy: generic name / strength / schedule (search and tile) */
  genericName?: string | null
  strength?: string | null
  drugSchedule?: string | null
  coreCharge?: string | null
  taxTemplateId?: string | null
  parentItemId?: string | null
  variantAttributes?: Record<string, string> | null
  hasVariants?: boolean
  variants?: Item[]
}

export interface Category {
  id: string
  name: string
}

export interface SelectedModifier {
  id: string
  name: string
  price: number
  groupId: string
  groupName: string
}

export interface TaxBreakdownItem {
  taxName: string
  rate: number
  amount: number
  accountId: string | null
  includedInPrice: boolean
}

export interface CartItem {
  cartLineId: string
  itemId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
  modifiers?: SelectedModifier[]
  notes?: string
  weight?: number
  isWeighable?: boolean
  unit?: string | null
  unitQuantity?: number
  displayUnit?: string | null
  coreCharge?: number
  restaurantOrderItemId?: string
  taxTemplateId?: string | null
  taxRate?: number
  taxAmount?: number
  taxBreakdown?: TaxBreakdownItem[]
  serialNumberIds?: string[]
  /** Return mode (W8): the original invoice line this cart line returns */
  originalSaleItemId?: string
  /** Return mode (W8): quantity still returnable on that line */
  maxReturnQuantity?: number
  /** D1: batch for this line (FEFO suggestion or cashier's choice); server falls back to FEFO */
  batchId?: string
  batchNumber?: string
  batchExpiry?: string | null
  /** D1 (UI only): batches the cashier can pick from */
  batchOptions?: CartBatchOption[]
  /** Weighable base price per unit */
  baseUnitPrice?: number
  /** H5: unit sold (null / undefined = base unit); quantity is in this unit */
  uom?: string | null
  uomFactor?: number
  /** H5: price set by the cashier (or a label) — price lists do not change it */
  priceLocked?: boolean
  /** H5: additional barcode with a price override this line was scanned with (sale line `barcode`) */
  barcode?: string
  /** H5 (from /api/price-quote): promotion discount on this line, its labels, price list, catalog price */
  promotionDiscount?: number
  promotionLabels?: string[]
  priceListName?: string | null
  catalogPrice?: number
}

export interface CartBatchOption {
  id: string
  batchNumber: string
  expiryDate: string | null
  currentQuantity: number
  /** E1: past its expiry date (offered only when the tenant allows selling expired batches) */
  expired?: boolean
}

export interface Customer {
  id: string
  name: string
  phone: string | null
  taxExempt?: boolean
  loyaltyPoints?: number
  loyaltyTier?: string
}

export interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  customerId: string | null
}

export interface VehicleMake {
  id: string
  name: string
}

export interface HeldSale {
  id: string
  holdNumber: string
  customerId: string | null
  vehicleId: string | null
  cartItems: CartItem[]
  subtotal: string
  notes: string | null
  createdAt: string
  customer: Customer | null
  vehicle: Vehicle | null
}

export interface SaleForReturn {
  id: string
  /** From /api/sales/lookup: amount paid per payment method on the original sale */
  paidByMethod?: Record<string, number>
  invoiceNo: string
  customerId: string | null
  customer: Customer | null
  total: string
  paymentMethod: string | null
  createdAt: string
  items: Array<{
    id: string
    itemId: string | null
    itemName: string
    quantity: string
    unitPrice: string
    total: string
    serialNumberIds?: string[] | null
    item?: { isGiftCard?: boolean } | null
    /** From /api/sales/lookup (W8) */
    returnedQuantity?: string
    remainingQuantity?: number
    refundUnitAmount?: number
    isGiftCard?: boolean
    remainingSerialNumberIds?: string[]
  }>
  /** From /api/sales/lookup (W8) */
  returnStatus?: 'none' | 'partial' | 'full'
  refundableTotal?: number
}

/** K1: cheque taken at the POS (sent as `cheque` with the sale) */
export interface ChequeFormValue {
  chequeNo: string
  bankName: string
  branchName: string
  chequeDate: string
}

export interface PaymentMethodConfig {
  id?: string
  paymentMethod: string
  isDefault: boolean
  allowInReturns: boolean
  sortOrder: number
}

export interface ActiveShift {
  id: string
  entryNumber: string
  openingTime: string
  status: string
  posProfile?: {
    id: string
    name: string
    costCenterId: string | null
    applyDiscountOn: string
    allowDiscountChange: boolean
    maxDiscountPercent: string
    allowRateChange: boolean
    allowNegativeStock?: boolean
    allowQuickItemAdd?: boolean
    allowCartClear?: boolean
    allowNoSaleDrawerOpen?: boolean
    printReceiptOnComplete: boolean
    skipPrintPreview: boolean
    receiptPrintFormat: string
    receiptHeader: string | null
    receiptFooter: string | null
    showLogoOnReceipt: boolean
    /** Per-counter receipt overrides (partial ReceiptSettings). */
    receiptSettings?: Record<string, unknown> | null
    paymentMethods?: PaymentMethodConfig[]
  }
  warehouse?: {
    id: string
    name: string
  }
  balances?: {
    paymentMethod: string
    openingAmount: string
  }[]
  calculatedTotals?: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
  }
  notes?: string | null
}

export interface TenantInfo {
  name: string
  phone: string | null
  address: string | null
  email: string | null
  currency: string
  taxRate: number
  taxInclusive: boolean
}

export interface LoyaltyProgram {
  id: string
  name: string
  collectionFactor: string
  conversionFactor: string
  minRedemptionPoints: number
  status: string
  tiers: LoyaltyTier[]
}

export interface LoyaltyTier {
  id: string
  name: string
  tier: string
  minPoints: number
  earnRate: string
  redeemRate: string
  isActive: boolean
}

export interface RestaurantTable {
  id: string
  name: string
  area: string | null
  capacity: number
  status: string
}

export interface ModifierGroupForPOS {
  id: string
  name: string
  minSelections: number
  maxSelections: number | null
  isRequired: boolean
  modifiers: ModifierForPOS[]
}

export interface ModifierForPOS {
  id: string
  name: string
  price: string
  isDefault: boolean
}

export interface POSBusinessConfig {
  showVehicleSelector: boolean
  showTableSelector: boolean
  showOrderTypeSelector: boolean
  enableBarcodeAutoAdd: boolean
  enableWeighableItems: boolean
  enableModifiers: boolean
  enableTips: boolean
  enableKitchenSend: boolean
  enableCoreChargeDisplay: boolean
  redirectToDealPipeline: boolean
}

export interface GiftCardInfo {
  id: string
  cardNumber: string
  currentBalance: number
  status: string
  expiryDate: string | null
  customerName: string | null
}

export const POS_ITEMS_LIMIT = 200

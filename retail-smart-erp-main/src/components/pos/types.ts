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
  oemPartNumber: string | null
  supplierPartNumber: string | null
  alternatePartNumbers: string[] | null
  categoryId: string | null
  categoryName?: string | null
  isWeighable?: boolean
  pluCode?: string | null
  coreCharge?: string | null
  taxTemplateId?: string | null
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
  coreCharge?: number
  restaurantOrderItemId?: string
  taxTemplateId?: string | null
  taxRate?: number
  taxAmount?: number
  taxBreakdown?: TaxBreakdownItem[]
  serialNumberIds?: string[]
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
  }>
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
    printReceiptOnComplete: boolean
    skipPrintPreview: boolean
    receiptPrintFormat: string
    receiptHeader: string | null
    receiptFooter: string | null
    showLogoOnReceipt: boolean
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

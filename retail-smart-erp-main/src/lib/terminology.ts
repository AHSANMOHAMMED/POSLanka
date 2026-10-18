// Central terminology mapping for business-type-specific labels
// Each business type uses different terms for the same concepts

export interface TerminologyMap {
  // Items
  item: string
  items: string
  addItem: string
  newItem: string
  editItem: string

  // Categories
  category: string
  categories: string
  addCategory: string
  categoryPlaceholder: string

  // Sales
  sale: string
  sales: string
  newSale: string
  invoiceNo: string

  // Customers
  customer: string
  customers: string
  newCustomer: string

  // Module labels
  stockModule: string
  sellingModule: string

  // POS-specific
  currentSale: string
  walkInCustomer: string
  payNow: string
  saleCompleted: string
  searchPlaceholder: string
}

const TERMINOLOGY: Record<string, TerminologyMap> = {
  retail: {
    item: 'Product',
    items: 'Products',
    addItem: 'Add Product',
    newItem: 'New Product',
    editItem: 'Edit Product',
    category: 'Category',
    categories: 'Categories',
    addCategory: 'Add Category',
    categoryPlaceholder: 'Select Category',
    sale: 'Sale',
    sales: 'Sales',
    newSale: 'New Sale',
    invoiceNo: 'Invoice #',
    customer: 'Customer',
    customers: 'Customers',
    newCustomer: 'New Customer',
    stockModule: 'Stock',
    sellingModule: 'Selling',
    currentSale: 'Current Sale',
    walkInCustomer: 'Walk-in Customer',
    payNow: 'Pay Now',
    saleCompleted: 'Sale completed',
    searchPlaceholder: 'Search products...',
  },
  restaurant: {
    item: 'Menu Item',
    items: 'Menu Items',
    addItem: 'Add Menu Item',
    newItem: 'New Menu Item',
    editItem: 'Edit Menu Item',
    category: 'Menu Section',
    categories: 'Menu Sections',
    addCategory: 'Add Menu Section',
    categoryPlaceholder: 'Select Menu Section',
    sale: 'Bill',
    sales: 'Bills',
    newSale: 'New Bill',
    invoiceNo: 'Bill #',
    customer: 'Guest',
    customers: 'Guests',
    newCustomer: 'New Guest',
    stockModule: 'Pantry',
    sellingModule: 'Orders',
    currentSale: 'Current Order',
    walkInCustomer: 'Walk-in Guest',
    payNow: 'Pay Bill',
    saleCompleted: 'Order settled',
    searchPlaceholder: 'Search menu items...',
  },
  supermarket: {
    item: 'Product',
    items: 'Products',
    addItem: 'Add Product',
    newItem: 'New Product',
    editItem: 'Edit Product',
    category: 'Department',
    categories: 'Departments',
    addCategory: 'Add Department',
    categoryPlaceholder: 'Select Department',
    sale: 'Sale',
    sales: 'Sales',
    newSale: 'New Sale',
    invoiceNo: 'Receipt #',
    customer: 'Customer',
    customers: 'Customers',
    newCustomer: 'New Customer',
    stockModule: 'Inventory',
    sellingModule: 'Checkout',
    currentSale: 'Current Sale',
    walkInCustomer: 'Walk-in Customer',
    payNow: 'Pay Now',
    saleCompleted: 'Sale completed',
    searchPlaceholder: 'Scan barcode or search products...',
  },
  auto_service: {
    item: 'Part',
    items: 'Parts',
    addItem: 'Add Part',
    newItem: 'New Part',
    editItem: 'Edit Part',
    category: 'Part Category',
    categories: 'Part Categories',
    addCategory: 'Add Part Category',
    categoryPlaceholder: 'Select Part Category',
    sale: 'Invoice',
    sales: 'Invoices',
    newSale: 'New Invoice',
    invoiceNo: 'Invoice #',
    customer: 'Customer',
    customers: 'Customers',
    newCustomer: 'New Customer',
    stockModule: 'Parts',
    sellingModule: 'Billing',
    currentSale: 'Current Invoice',
    walkInCustomer: 'Walk-in Customer',
    payNow: 'Pay Now',
    saleCompleted: 'Invoice created',
    searchPlaceholder: 'Search parts...',
  },
  dealership: {
    item: 'Vehicle',
    items: 'Vehicles',
    addItem: 'Add Vehicle',
    newItem: 'New Vehicle',
    editItem: 'Edit Vehicle',
    category: 'Vehicle Category',
    categories: 'Vehicle Categories',
    addCategory: 'Add Vehicle Category',
    categoryPlaceholder: 'Select Vehicle Category',
    sale: 'Vehicle Sale',
    sales: 'Vehicle Sales',
    newSale: 'New Vehicle Sale',
    invoiceNo: 'Deal #',
    customer: 'Buyer',
    customers: 'Buyers',
    newCustomer: 'New Buyer',
    stockModule: 'Vehicle Inventory',
    sellingModule: 'Vehicle Sales',
    currentSale: 'Current Deal',
    walkInCustomer: 'Walk-in Buyer',
    payNow: 'Pay Now',
    saleCompleted: 'Deal completed',
    searchPlaceholder: 'Search vehicles...',
  },
}

// Default fallback uses retail terminology
const DEFAULT_TERMS = TERMINOLOGY.retail

/**
 * Get terminology map for a given business type.
 * Falls back to retail terminology if business type is unknown.
 */
export function getTerms(businessType?: string | null): TerminologyMap {
  if (!businessType) return DEFAULT_TERMS
  return TERMINOLOGY[businessType] || DEFAULT_TERMS
}

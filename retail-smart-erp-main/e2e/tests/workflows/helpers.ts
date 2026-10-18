import { APIRequestContext } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

export const BUSINESS_TYPES = ['retail', 'restaurant', 'supermarket', 'auto_service', 'dealership'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

const STATE_FILE = path.join(__dirname, '../../.test-state.json')
const RUN_ID = Date.now()

// ──────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────

export interface AccountIds {
  cash?: string
  bank?: string
  receivable?: string
  payable?: string
  revenue?: string
  cogs?: string
  inventory?: string
  tax?: string
  expense?: string
}

export interface ItemRef {
  id: string
  name: string
  sellingPrice: number
  costPrice: number
  trackStock: boolean
}

export interface CompanyState {
  accountId: string
  email: string
  password: string
  tenantId: string
  slug: string
  businessType: BusinessType
  warehouseA: string
  warehouseB: string
  costCenterOps: string
  costCenterSales: string
  bankAccountCash: string
  bankAccountBank: string
  posProfileId: string
  posOpeningEntryId?: string
  accounts: AccountIds
  categories: string[]
  items: ItemRef[]
  customers: Array<{ id: string; name: string }>
  suppliers: Array<{ id: string; name: string }>
  serviceTypes?: Array<{ id: string; name: string; rate: number }>
  vehicles?: Array<{ id: string; plate: string; customerId: string }>
  purchaseOrders: Array<{ id: string; orderNo: string }>
  purchases: Array<{ id: string; purchaseNo: string }>
  sales: Array<{ id: string; invoiceNo: string }>
  salesOrders: Array<{ id: string; orderNo: string }>
  workOrders?: Array<{ id: string; orderNo: string }>
  appointments?: Array<{ id: string }>
  estimates?: Array<{ id: string; estimateNo: string }>
  journalEntries?: Array<{ id: string; entryNumber: string }>
  paymentEntries?: Array<{ id: string; entryNumber: string }>
}

export interface TestState {
  companies: Partial<Record<BusinessType, CompanyState>>
}

// ──────────────────────────────────────────
// State Management
// ──────────────────────────────────────────

export function saveState(state: TestState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

export function loadState(): TestState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  }
  return { companies: {} }
}

export function updateCompanyState(type: BusinessType, update: Partial<CompanyState>): void {
  const state = loadState()
  state.companies[type] = { ...state.companies[type]!, ...update }
  saveState(state)
}

// ──────────────────────────────────────────
// Auth Helpers
// ──────────────────────────────────────────

export async function loginToAccount(request: APIRequestContext, email: string, password: string): Promise<void> {
  const csrfRes = await request.get('/api/account-auth/csrf')
  const { csrfToken } = await csrfRes.json()
  await request.post('/api/account-auth/callback/credentials', {
    form: { email, password, csrfToken, callbackUrl: '/account/companies' },
  })
}

export async function loginToCompany(
  request: APIRequestContext,
  email: string,
  password: string,
  slug: string
): Promise<void> {
  const csrfRes = await request.get('/api/auth/csrf')
  const { csrfToken } = await csrfRes.json()
  await request.post('/api/auth/callback/credentials', {
    form: { email, password, tenantSlug: slug, csrfToken, callbackUrl: `/c/${slug}/dashboard` },
  })
}

// ──────────────────────────────────────────
// GL Verification
// ──────────────────────────────────────────

export interface GLEntry {
  id: string
  accountId: string
  accountName: string
  debit: string
  credit: string
  voucherType: string
  voucherId: string
  voucherNumber?: string
  partyType?: string
  partyId?: string
  costCenterId?: string
}

export async function getGLEntries(
  request: APIRequestContext,
  filters: { voucherType?: string; voucherId?: string; accountId?: string; partyId?: string }
): Promise<GLEntry[]> {
  const params = new URLSearchParams({ pageSize: '100' })
  if (filters.voucherType) params.set('voucherType', filters.voucherType)
  if (filters.voucherId) params.set('voucherId', filters.voucherId)
  if (filters.accountId) params.set('accountId', filters.accountId)
  if (filters.partyId) params.set('partyId', filters.partyId)
  const res = await request.get(`/api/accounting/gl-entries?${params}`)
  if (!res.ok()) return []
  const json = await res.json()
  return Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : []
}

export function assertGLBalance(entries: Array<{ debit: string; credit: string }>): {
  totalDebit: number
  totalCredit: number
} {
  const totalDebit = entries.reduce((sum, e) => sum + parseFloat(e.debit || '0'), 0)
  const totalCredit = entries.reduce((sum, e) => sum + parseFloat(e.credit || '0'), 0)
  const diff = Math.abs(totalDebit - totalCredit)
  if (diff > 0.02) {
    throw new Error(
      `GL imbalance: debit=${totalDebit.toFixed(2)}, credit=${totalCredit.toFixed(2)}, diff=${diff.toFixed(2)}`
    )
  }
  return { totalDebit, totalCredit }
}

// ──────────────────────────────────────────
// Stock Movement Verification
// ──────────────────────────────────────────

export interface StockMovement {
  id: string
  type: string
  quantity: string
  referenceType: string
  referenceId: string
  itemId: string
  warehouseId: string
  itemName?: string
  warehouseName?: string
}

export async function getStockMovements(
  request: APIRequestContext,
  filters: { type?: string; referenceType?: string; warehouseId?: string }
): Promise<StockMovement[]> {
  const params = new URLSearchParams({ pageSize: '100' })
  if (filters.type) params.set('type', filters.type)
  if (filters.referenceType) params.set('referenceType', filters.referenceType)
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId)
  const res = await request.get(`/api/stock-movements?${params}`)
  if (!res.ok()) return []
  const json = await res.json()
  return Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : []
}

export async function getWarehouseStock(
  request: APIRequestContext,
  itemId: string
): Promise<Array<{ warehouseId: string; currentStock: number; warehouseName?: string }>> {
  const res = await request.get(`/api/items/${itemId}/warehouse-stock`)
  if (!res.ok()) return []
  const data = await res.json()
  const list = Array.isArray(data) ? data : Array.isArray(data.warehouses) ? data.warehouses : Array.isArray(data.data) ? data.data : []
  return list.map((s: Record<string, unknown>) => ({
    warehouseId: String(s.warehouseId || ''),
    currentStock: parseFloat(String(s.currentStock || '0')),
    warehouseName: s.warehouseName ? String(s.warehouseName) : undefined,
  }))
}

export function getStockForWarehouse(
  stocks: Array<{ warehouseId: string; currentStock: number }>,
  warehouseId: string
): number {
  const entry = stocks.find((s) => s.warehouseId === warehouseId)
  return entry ? Number(entry.currentStock) : 0
}

// ──────────────────────────────────────────
// Balance Helpers
// ──────────────────────────────────────────

export async function getSupplierBalance(request: APIRequestContext, supplierId: string): Promise<number> {
  const res = await request.get(`/api/suppliers/${supplierId}`)
  const supplier = await res.json()
  return parseFloat(supplier.balance || '0')
}

export async function getCustomerBalance(request: APIRequestContext, customerId: string): Promise<number> {
  const res = await request.get(`/api/customers/${customerId}`)
  const customer = await res.json()
  return parseFloat(customer.balance || '0')
}

// ──────────────────────────────────────────
// Test Data Configuration — Full Field Coverage
// ──────────────────────────────────────────

export interface ItemConfig {
  name: string
  sellingPrice: number
  costPrice: number
  trackStock: boolean
  sku?: string
  barcode?: string
  brand?: string
  unit?: string
  minStock?: number
  reorderQty?: number
  binLocation?: string
  weight?: number
  dimensions?: string
  warrantyMonths?: number
  condition?: 'new' | 'refurbished' | 'used'
  // Restaurant-specific
  preparationTime?: number
  allergens?: string[]
  calories?: number
  isVegetarian?: boolean
  isVegan?: boolean
  isGlutenFree?: boolean
  spiceLevel?: string
  availableFrom?: string
  availableTo?: string
  // Supermarket-specific
  pluCode?: string
  shelfLifeDays?: number
  storageTemp?: string
  // Auto service-specific
  oemPartNumber?: string
  supplierPartNumber?: string
}

export interface CustomerConfig {
  name: string
  firstName: string
  lastName: string
  email: string
  phone: string
  mobilePhone?: string
  alternatePhone?: string
  companyName?: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  postalCode: string
  country: string
  useSameBillingAddress?: boolean
  billingAddressLine1?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  billingCountry?: string
  taxId?: string
  taxExempt?: boolean
  businessType?: 'individual' | 'company'
  creditLimit?: number
  paymentTerms?: string
  defaultPaymentMethod?: string
  customerType?: 'retail' | 'wholesale' | 'vip'
  referralSource?: string
  marketingOptIn?: boolean
  birthday?: string
  notes?: string
  specialInstructions?: string
  driverLicenseNumber?: string
}

export interface SupplierConfig {
  name: string
  email: string
  phone: string
  address: string
  taxId?: string
  taxInclusive?: boolean
}

export interface ServiceTypeConfig {
  name: string
  description: string
  defaultHours: string
  defaultRate: string
}

export interface VehicleConfig {
  licensePlate: string
  make: string
  model: string
  year: number
  color: string
  vin: string
  currentMileage: number
  notes: string
}

export interface TestConfig {
  email: string
  password: string
  phone: string
  fullName: string
  companyName: string
  slug: string
  categories: string[]
  items: ItemConfig[]
  customers: CustomerConfig[]
  suppliers: SupplierConfig[]
  serviceTypes?: ServiceTypeConfig[]
  vehicles?: VehicleConfig[]
}

export function getTestConfig(type: BusinessType, index: number): TestConfig {
  const base = {
    email: `e2e-${type}-${RUN_ID}@test.local`,
    password: 'E2eTestPass1!',
    phone: `+9471${String(RUN_ID + index).slice(-7)}`,
    fullName: `E2E ${type.replace('_', ' ')} User`,
    companyName: `E2E ${type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}`,
    slug: `e2e-${({ retail: 'ret', restaurant: 'rst', supermarket: 'smk', auto_service: 'aut', dealership: 'dlr' } as Record<BusinessType, string>)[type]}-${RUN_ID}`,
  }

  const typeConfigs: Record<BusinessType, Omit<TestConfig, keyof typeof base>> = {
    retail: {
      categories: ['Electronics', 'Accessories', 'Office Supplies'],
      items: [
        {
          name: 'USB-C Charging Cable 1m',
          sellingPrice: 500,
          costPrice: 200,
          trackStock: true,
          barcode: '8901234567890',
          brand: 'TechLink',
          unit: 'piece',
          minStock: 10,
          reorderQty: 50,
          binLocation: 'A1-01',
          weight: 0.05,
          dimensions: '100x5x5',
          warrantyMonths: 6,
          condition: 'new',
        },
        {
          name: 'Premium Leather Phone Case',
          sellingPrice: 1200,
          costPrice: 400,
          trackStock: true,
          barcode: '8901234567891',
          brand: 'CasePro',
          unit: 'piece',
          minStock: 5,
          reorderQty: 25,
          binLocation: 'A2-03',
          weight: 0.08,
          dimensions: '160x80x12',
          warrantyMonths: 3,
          condition: 'new',
        },
        {
          name: 'Gift Wrap Roll - Gold',
          sellingPrice: 100,
          costPrice: 30,
          trackStock: false,
          brand: 'WrapIt',
          unit: 'roll',
          weight: 0.15,
          dimensions: '500x70',
          condition: 'new',
        },
      ],
      customers: [
        {
          name: 'Kamal Perera',
          firstName: 'Kamal',
          lastName: 'Perera',
          email: `cust-kamal-ret-${RUN_ID}@test.local`,
          phone: '+94770100001',
          mobilePhone: '+94770100002',
          addressLine1: '42 Galle Road',
          addressLine2: 'Colombo 03',
          city: 'Colombo',
          state: 'Western',
          postalCode: '00300',
          country: 'LK',
          businessType: 'individual',
          creditLimit: 50000,
          paymentTerms: 'Net 30',
          defaultPaymentMethod: 'cash',
          customerType: 'retail',
          referralSource: 'Walk-in',
          marketingOptIn: true,
          birthday: '1990-05-15',
          notes: 'Regular customer, prefers cash payments',
          specialInstructions: 'SMS notifications preferred',
        },
        {
          name: 'TechZone Lanka (Pvt) Ltd',
          firstName: 'Nimal',
          lastName: 'Silva',
          email: `cust-techzone-ret-${RUN_ID}@test.local`,
          phone: '+94112345678',
          mobilePhone: '+94770200003',
          alternatePhone: '+94112345679',
          companyName: 'TechZone Lanka (Pvt) Ltd',
          addressLine1: '150 Union Place',
          city: 'Colombo',
          state: 'Western',
          postalCode: '00200',
          country: 'LK',
          useSameBillingAddress: false,
          billingAddressLine1: '150 Union Place, Finance Dept',
          billingCity: 'Colombo',
          billingState: 'Western',
          billingPostalCode: '00200',
          billingCountry: 'LK',
          taxId: '123456789-V',
          taxExempt: false,
          businessType: 'company',
          creditLimit: 200000,
          paymentTerms: 'Net 60',
          defaultPaymentMethod: 'bank_transfer',
          customerType: 'wholesale',
          referralSource: 'Trade show',
          marketingOptIn: true,
          notes: 'Bulk buyer, requires tax invoices',
        },
      ],
      suppliers: [
        {
          name: 'Global Electronics Imports',
          email: `supp-global-ret-${RUN_ID}@test.local`,
          phone: '+94112223344',
          address: '78 Sea Street, Colombo 11, Western Province, Sri Lanka',
          taxId: 'SUP-001-V',
          taxInclusive: false,
        },
        {
          name: 'Lanka Accessories Wholesale',
          email: `supp-lanka-ret-${RUN_ID}@test.local`,
          phone: '+94112556677',
          address: '25 Main Street, Kandy, Central Province, Sri Lanka',
          taxId: 'SUP-002-V',
          taxInclusive: true,
        },
      ],
    },

    restaurant: {
      categories: ['Appetizers', 'Main Course', 'Beverages'],
      items: [
        {
          name: 'Caesar Salad with Grilled Chicken',
          sellingPrice: 850,
          costPrice: 200,
          trackStock: false,
          unit: 'plate',
          preparationTime: 15,
          allergens: ['dairy', 'gluten', 'eggs'],
          calories: 450,
          isVegetarian: false,
          isVegan: false,
          isGlutenFree: false,
          spiceLevel: 'mild',
          availableFrom: '11:00',
          availableTo: '22:00',
          condition: 'new',
        },
        {
          name: 'Grilled Tandoori Chicken Half',
          sellingPrice: 1500,
          costPrice: 500,
          trackStock: false,
          unit: 'portion',
          preparationTime: 25,
          allergens: ['dairy'],
          calories: 680,
          isVegetarian: false,
          isVegan: false,
          isGlutenFree: true,
          spiceLevel: 'hot',
          availableFrom: '11:30',
          availableTo: '22:30',
          condition: 'new',
        },
        {
          name: 'Coca-Cola 350ml Can',
          sellingPrice: 250,
          costPrice: 120,
          trackStock: true,
          barcode: '5449000000996',
          brand: 'Coca-Cola',
          unit: 'can',
          minStock: 24,
          reorderQty: 48,
          binLocation: 'BAR-01',
          weight: 0.37,
          shelfLifeDays: 365,
          storageTemp: '2-8°C',
          condition: 'new',
        },
      ],
      customers: [
        {
          name: 'Anjali Fernando',
          firstName: 'Anjali',
          lastName: 'Fernando',
          email: `cust-anjali-rst-${RUN_ID}@test.local`,
          phone: '+94770300001',
          addressLine1: '88 Gregory Road',
          city: 'Colombo',
          state: 'Western',
          postalCode: '00700',
          country: 'LK',
          businessType: 'individual',
          creditLimit: 25000,
          customerType: 'vip',
          referralSource: 'Social Media',
          marketingOptIn: true,
          birthday: '1985-11-20',
          notes: 'VIP diner, prefers window table',
          specialInstructions: 'Nut allergy - alert kitchen staff',
        },
        {
          name: 'Office Catering Corp',
          firstName: 'Dinesh',
          lastName: 'Wickramasinghe',
          email: `cust-catering-rst-${RUN_ID}@test.local`,
          phone: '+94112334455',
          mobilePhone: '+94770300002',
          companyName: 'Office Catering Corp',
          addressLine1: '200 Bauddhaloka Mawatha',
          city: 'Colombo',
          state: 'Western',
          postalCode: '00700',
          country: 'LK',
          taxId: 'CAT-789-V',
          businessType: 'company',
          creditLimit: 100000,
          paymentTerms: 'Net 15',
          defaultPaymentMethod: 'bank_transfer',
          customerType: 'wholesale',
          notes: 'Corporate catering orders, monthly billing',
        },
      ],
      suppliers: [
        {
          name: 'Fresh Farm Produce (Pvt) Ltd',
          email: `supp-farm-rst-${RUN_ID}@test.local`,
          phone: '+94812234455',
          address: '15 Kandy Road, Kadawatha, Gampaha District, Sri Lanka',
          taxId: 'FARM-001-V',
          taxInclusive: false,
        },
        {
          name: 'Beverage Distributors Lanka',
          email: `supp-bev-rst-${RUN_ID}@test.local`,
          phone: '+94112667788',
          address: '90 Industrial Zone, Ekala, Ja-Ela, Sri Lanka',
          taxId: 'BEV-002-V',
          taxInclusive: true,
        },
      ],
    },

    supermarket: {
      categories: ['Fresh Produce', 'Dairy & Chilled', 'Dry Goods'],
      items: [
        {
          name: 'Highland Full Cream Milk 1L',
          sellingPrice: 350,
          costPrice: 280,
          trackStock: true,
          barcode: '4796002500108',
          brand: 'Highland',
          unit: 'litre',
          minStock: 50,
          reorderQty: 200,
          binLocation: 'DAIRY-01',
          weight: 1.03,
          pluCode: '4011',
          shelfLifeDays: 7,
          storageTemp: '2-6°C',
          condition: 'new',
        },
        {
          name: 'Prima White Bread Sliced',
          sellingPrice: 200,
          costPrice: 130,
          trackStock: true,
          barcode: '4796005810057',
          brand: 'Prima',
          unit: 'loaf',
          minStock: 30,
          reorderQty: 100,
          binLocation: 'BAKERY-02',
          weight: 0.4,
          pluCode: '4012',
          shelfLifeDays: 3,
          storageTemp: 'Room temp',
          condition: 'new',
        },
        {
          name: 'Nipuna Red Nadu Rice 5kg',
          sellingPrice: 1800,
          costPrice: 1400,
          trackStock: true,
          barcode: '4796003600205',
          brand: 'Nipuna',
          unit: 'bag',
          minStock: 25,
          reorderQty: 100,
          binLocation: 'DRY-05',
          weight: 5.0,
          dimensions: '40x25x10',
          pluCode: '4013',
          shelfLifeDays: 180,
          storageTemp: 'Room temp, dry place',
          condition: 'new',
        },
      ],
      customers: [
        {
          name: 'Malini Rajapaksa',
          firstName: 'Malini',
          lastName: 'Rajapaksa',
          email: `cust-malini-smk-${RUN_ID}@test.local`,
          phone: '+94770400001',
          mobilePhone: '+94770400002',
          addressLine1: '12 Temple Road',
          city: 'Kandy',
          state: 'Central',
          postalCode: '20000',
          country: 'LK',
          businessType: 'individual',
          creditLimit: 15000,
          customerType: 'retail',
          referralSource: 'Neighbourhood',
          marketingOptIn: true,
          birthday: '1978-03-08',
          notes: 'Weekly grocery shopper',
        },
        {
          name: 'Hotel Hilltop (Pvt) Ltd',
          firstName: 'Sunil',
          lastName: 'Bandara',
          email: `cust-hilltop-smk-${RUN_ID}@test.local`,
          phone: '+94812445566',
          companyName: 'Hotel Hilltop (Pvt) Ltd',
          addressLine1: '300 Peradeniya Road',
          city: 'Kandy',
          state: 'Central',
          postalCode: '20000',
          country: 'LK',
          taxId: 'HTL-456-V',
          businessType: 'company',
          creditLimit: 500000,
          paymentTerms: 'Net 30',
          defaultPaymentMethod: 'bank_transfer',
          customerType: 'wholesale',
          notes: 'Hotel supplies - bulk produce and dairy',
        },
      ],
      suppliers: [
        {
          name: 'Central Province Dairy Co-op',
          email: `supp-dairy-smk-${RUN_ID}@test.local`,
          phone: '+94812112233',
          address: '5 Dairy Lane, Peradeniya, Kandy District, Sri Lanka',
          taxId: 'DAIRY-SUP-001',
          taxInclusive: false,
        },
        {
          name: 'Lanka Grain Merchants',
          email: `supp-grain-smk-${RUN_ID}@test.local`,
          phone: '+94112778899',
          address: '45 Pettah Market, Colombo 11, Sri Lanka',
          taxId: 'GRAIN-SUP-002',
          taxInclusive: false,
        },
      ],
    },

    auto_service: {
      categories: ['Engine Parts', 'Lubricants & Oils', 'Brake Components'],
      items: [
        {
          name: 'Toyota Oil Filter (04152-YZZA1)',
          sellingPrice: 800,
          costPrice: 350,
          trackStock: true,
          barcode: '0882680600907',
          brand: 'Toyota Genuine',
          unit: 'piece',
          minStock: 15,
          reorderQty: 50,
          binLocation: 'ENG-A1-02',
          weight: 0.25,
          dimensions: '80x80x100',
          warrantyMonths: 6,
          condition: 'new',
          oemPartNumber: '04152-YZZA1',
          supplierPartNumber: 'TOY-OF-001',
        },
        {
          name: 'Mobil 1 Synthetic Engine Oil 5W-30 4L',
          sellingPrice: 3500,
          costPrice: 2200,
          trackStock: true,
          barcode: '0071924154698',
          brand: 'Mobil 1',
          unit: 'bottle',
          minStock: 10,
          reorderQty: 30,
          binLocation: 'OIL-B2-01',
          weight: 3.8,
          dimensions: '250x150x100',
          warrantyMonths: 24,
          condition: 'new',
          oemPartNumber: 'MOB-5W30-4L',
          supplierPartNumber: 'MOB-SYN-001',
        },
        {
          name: 'Brembo Front Brake Pad Set P28035',
          sellingPrice: 4500,
          costPrice: 2000,
          trackStock: true,
          barcode: '8020584560358',
          brand: 'Brembo',
          unit: 'set',
          minStock: 8,
          reorderQty: 20,
          binLocation: 'BRK-C1-03',
          weight: 0.95,
          dimensions: '150x100x40',
          warrantyMonths: 12,
          condition: 'new',
          oemPartNumber: 'P28035',
          supplierPartNumber: 'BRM-BP-001',
        },
      ],
      customers: [
        {
          name: 'Ruwan de Silva',
          firstName: 'Ruwan',
          lastName: 'de Silva',
          email: `cust-ruwan-aut-${RUN_ID}@test.local`,
          phone: '+94770500001',
          mobilePhone: '+94770500002',
          addressLine1: '56 Havelock Road',
          city: 'Colombo',
          state: 'Western',
          postalCode: '00500',
          country: 'LK',
          businessType: 'individual',
          creditLimit: 75000,
          paymentTerms: 'Net 14',
          customerType: 'retail',
          referralSource: 'Google',
          marketingOptIn: true,
          birthday: '1982-08-22',
          notes: 'Owns Toyota Corolla, regular oil change every 5000km',
          driverLicenseNumber: 'B1234567',
        },
        {
          name: 'City Taxi Fleet Management',
          firstName: 'Asanka',
          lastName: 'Jayawardena',
          email: `cust-citytaxi-aut-${RUN_ID}@test.local`,
          phone: '+94112889900',
          mobilePhone: '+94770500003',
          companyName: 'City Taxi Fleet Management',
          addressLine1: '120 Baseline Road',
          city: 'Colombo',
          state: 'Western',
          postalCode: '00900',
          country: 'LK',
          useSameBillingAddress: false,
          billingAddressLine1: '120 Baseline Road, Accounts Dept',
          billingCity: 'Colombo',
          billingState: 'Western',
          billingPostalCode: '00900',
          billingCountry: 'LK',
          taxId: 'TAXI-FLT-001',
          businessType: 'company',
          creditLimit: 300000,
          paymentTerms: 'Net 30',
          defaultPaymentMethod: 'bank_transfer',
          customerType: 'wholesale',
          notes: 'Fleet of 25 vehicles, monthly maintenance schedule',
        },
      ],
      suppliers: [
        {
          name: 'Toyota Lanka Parts Division',
          email: `supp-toyota-aut-${RUN_ID}@test.local`,
          phone: '+94112334455',
          address: '100 Orion City, Colombo 09, Western Province, Sri Lanka',
          taxId: 'TOY-SUP-001',
          taxInclusive: false,
        },
        {
          name: 'AutoParts Warehouse Lanka',
          email: `supp-autoparts-aut-${RUN_ID}@test.local`,
          phone: '+94112556677',
          address: '55 Negombo Road, Wattala, Gampaha District, Sri Lanka',
          taxId: 'AP-SUP-002',
          taxInclusive: true,
        },
      ],
      serviceTypes: [
        {
          name: 'Full Synthetic Oil Change',
          description: 'Complete engine oil drain, filter replacement, and synthetic oil refill with 20-point inspection',
          defaultHours: '1',
          defaultRate: '2500',
        },
        {
          name: 'Front & Rear Brake Service',
          description: 'Inspect brake pads, rotors, calipers, and brake fluid. Replace pads if worn below 3mm threshold',
          defaultHours: '2',
          defaultRate: '5000',
        },
      ],
      vehicles: [
        {
          licensePlate: 'CAB-1234',
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
          color: 'Pearl White',
          vin: 'JTDBR32E160012345',
          currentMileage: 45000,
          notes: 'Regular maintenance customer, last service at 40,000km. Front tires due for replacement.',
        },
        {
          licensePlate: 'WP-KA-5678',
          make: 'Honda',
          model: 'Civic',
          year: 2021,
          color: 'Midnight Black',
          vin: '2HGFC2F59MH543210',
          currentMileage: 32000,
          notes: 'Fleet vehicle, taxi service. Check AC system next visit.',
        },
      ],
    },

    dealership: {
      categories: ['Brake Parts', 'Filters & Fluids', 'Body Accessories'],
      items: [
        {
          name: 'DOT 4 Brake Fluid 500ml',
          sellingPrice: 600,
          costPrice: 300,
          trackStock: true,
          barcode: '4008177349546',
          brand: 'Bosch',
          unit: 'bottle',
          minStock: 20,
          reorderQty: 60,
          binLocation: 'FLD-A1-01',
          weight: 0.52,
          warrantyMonths: 24,
          condition: 'new',
          oemPartNumber: 'DOT4-500',
          supplierPartNumber: 'BSH-BF-001',
        },
        {
          name: 'Mann Air Filter C2512/1',
          sellingPrice: 1200,
          costPrice: 500,
          trackStock: true,
          barcode: '4011558398200',
          brand: 'Mann-Filter',
          unit: 'piece',
          minStock: 12,
          reorderQty: 40,
          binLocation: 'FLT-B2-03',
          weight: 0.3,
          dimensions: '250x130x58',
          warrantyMonths: 12,
          condition: 'new',
          oemPartNumber: 'C2512/1',
          supplierPartNumber: 'MANN-AF-001',
        },
        {
          name: 'Bosch Icon Wiper Blade 22"',
          sellingPrice: 1500,
          costPrice: 700,
          trackStock: true,
          barcode: '0028894226222',
          brand: 'Bosch',
          unit: 'piece',
          minStock: 10,
          reorderQty: 30,
          binLocation: 'ACC-C3-02',
          weight: 0.2,
          dimensions: '560x30x20',
          warrantyMonths: 12,
          condition: 'new',
          oemPartNumber: '22OE',
          supplierPartNumber: 'BSH-WP-001',
        },
      ],
      customers: [
        {
          name: 'Pradeep Gunasekara',
          firstName: 'Pradeep',
          lastName: 'Gunasekara',
          email: `cust-pradeep-dlr-${RUN_ID}@test.local`,
          phone: '+94770600001',
          mobilePhone: '+94770600002',
          addressLine1: '33 Park Avenue',
          city: 'Nugegoda',
          state: 'Western',
          postalCode: '10250',
          country: 'LK',
          businessType: 'individual',
          creditLimit: 100000,
          customerType: 'vip',
          referralSource: 'Referral',
          marketingOptIn: true,
          birthday: '1975-12-01',
          notes: 'Loyal customer, owns 3 vehicles serviced here',
          driverLicenseNumber: 'C9876543',
        },
        {
          name: 'Express Courier Services (Pvt) Ltd',
          firstName: 'Chaminda',
          lastName: 'Ratnayake',
          email: `cust-express-dlr-${RUN_ID}@test.local`,
          phone: '+94112990011',
          companyName: 'Express Courier Services (Pvt) Ltd',
          addressLine1: '75 Flower Road',
          city: 'Colombo',
          state: 'Western',
          postalCode: '00700',
          country: 'LK',
          taxId: 'EXP-CUR-789',
          businessType: 'company',
          creditLimit: 500000,
          paymentTerms: 'Net 45',
          defaultPaymentMethod: 'bank_transfer',
          customerType: 'wholesale',
          notes: 'Fleet of 50 delivery vans, priority service agreement',
        },
      ],
      suppliers: [
        {
          name: 'German Auto Parts Importer',
          email: `supp-german-dlr-${RUN_ID}@test.local`,
          phone: '+94112001122',
          address: '22 Industrial Estate, Katunayake, Gampaha District, Sri Lanka',
          taxId: 'GAP-IMP-001',
          taxInclusive: false,
        },
        {
          name: 'Japan Parts Direct Lanka',
          email: `supp-japan-dlr-${RUN_ID}@test.local`,
          phone: '+94112334400',
          address: '10 Free Trade Zone, Biyagama, Gampaha District, Sri Lanka',
          taxId: 'JPD-IMP-002',
          taxInclusive: false,
        },
      ],
      serviceTypes: [
        {
          name: 'Pre-Delivery Inspection (PDI)',
          description: 'Comprehensive multi-point inspection for new vehicle delivery including fluid levels, tire pressure, electrical systems, and body inspection',
          defaultHours: '1.5',
          defaultRate: '3500',
        },
        {
          name: 'Major Service (40,000km)',
          description: 'Full service including oil change, all filters, spark plugs, brake inspection, transmission fluid check, coolant flush, and belt inspection',
          defaultHours: '4',
          defaultRate: '8500',
        },
      ],
      vehicles: [
        {
          licensePlate: 'WP-CAG-3001',
          make: 'BMW',
          model: '320i',
          year: 2022,
          color: 'Alpine White',
          vin: 'WBA8E9C50NCT12345',
          currentMileage: 18500,
          notes: 'Dealership certified pre-owned, warranty valid until 2027. Premium maintenance package.',
        },
        {
          licensePlate: 'WP-KG-4502',
          make: 'Mercedes-Benz',
          model: 'C200',
          year: 2023,
          color: 'Obsidian Black',
          vin: 'W1KZF8DB0PA654321',
          currentMileage: 8200,
          notes: 'New vehicle, first service due at 10,000km. Extended warranty purchased.',
        },
      ],
    },
  }

  return { ...base, ...typeConfigs[type] }
}

// ──────────────────────────────────────────
// Utility
// ──────────────────────────────────────────

/** Today in YYYY-MM-DD format */
export function today(): string {
  return new Date().toISOString().split('T')[0]
}

/** Tomorrow in YYYY-MM-DD format */
export function tomorrow(): string {
  const d = new Date(Date.now() + 86400000)
  return d.toISOString().split('T')[0]
}

/** Date N days from now in YYYY-MM-DD format */
export function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86400000)
  return d.toISOString().split('T')[0]
}

/** Safely parse numeric from API response string */
export function num(value: string | number | null | undefined): number {
  return parseFloat(String(value ?? '0')) || 0
}

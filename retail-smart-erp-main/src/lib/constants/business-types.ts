import {
  Store,
  UtensilsCrossed,
  ShoppingCart,
  Wrench,
  Car,
  Pill,
  Tv,
  Hammer,
  Printer,
  Briefcase,
  type LucideIcon,
} from 'lucide-react'

export interface BusinessType {
  value: string
  label: string
  icon: LucideIcon
  emoji: string
  description: string
  color: string
  features: string[]
}

export const BUSINESS_TYPES: BusinessType[] = [
  {
    value: 'retail',
    label: 'Retail Store',
    icon: Store,
    emoji: '🏪',
    description: 'Clothing, footwear & slippers, bags, stationery, fancy & gift items, cosmetics, electronics',
    color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    features: ['Size / colour variants', 'Barcode labels', 'Exchanges & returns', 'Loyalty'],
  },
  {
    value: 'restaurant',
    label: 'Restaurant',
    icon: UtensilsCrossed,
    emoji: '🍽️',
    description: 'Dine-in, takeaway, food service',
    color: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    features: ['Table Management', 'Kitchen Display', 'Recipes', 'Reservations'],
  },
  {
    value: 'supermarket',
    label: 'Supermarket',
    icon: ShoppingCart,
    emoji: '🛒',
    description: 'Grocery plus clothing, footwear, bags, stationery and fancy departments in one POS',
    color: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    features: ['Multi-department POS', 'Weighing scale & PLU', 'Size / colour variants', 'Expiry tracking'],
  },
  {
    value: 'pharmacy',
    label: 'Pharmacy',
    icon: Pill,
    emoji: '💊',
    description: 'Pharmacies and medical stores',
    color: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
    features: ['Generic-name search', 'Batch & expiry (FEFO)', 'Prescriptions at the POS', 'Prescription register'],
  },
  {
    value: 'electronics',
    label: 'Electronics & Appliances',
    icon: Tv,
    emoji: '📺',
    description: 'Fridges, TVs, washing machines, sewing machines, phones and other big-ticket items',
    color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    features: ['Hire purchase / installments', 'Serial & IMEI tracking', 'Delivery & installation', 'Warranty claims'],
  },
  {
    value: 'hardware',
    label: 'Hardware & Building Supplies',
    icon: Hammer,
    emoji: '🔨',
    description: 'Hardware stores, building materials, paints, plumbing and electrical supplies',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    features: ['Sell by kg, metre, bag, cube, sheet', 'Credit customers', 'Site deliveries', 'Size variants'],
  },
  {
    value: 'print_studio',
    label: 'Printing & Photo Studio',
    icon: Printer,
    emoji: '🖨️',
    description: 'Print shops, photo studios, communication centres, banner and sign makers',
    color: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
    features: ['Job orders by size', 'Advance & balance on pickup', 'Photo & print price lists', 'Counter POS'],
  },
  {
    value: 'office',
    label: 'Office & Services',
    icon: Briefcase,
    emoji: '🏢',
    description: 'Offices, agencies and service businesses that mostly need staff, attendance and billing',
    color: 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300',
    features: ['Fingerprint attendance', 'Leave & holidays', 'Payroll', 'Invoices & quotations'],
  },
  {
    value: 'auto_service',
    label: 'Auto Service',
    icon: Wrench,
    emoji: '🔧',
    description: 'Vehicle repair, maintenance, parts',
    color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    features: ['Work Orders', 'Inspections', 'Parts Inventory', 'Insurance Claims'],
  },
  {
    value: 'dealership',
    label: 'Vehicle Dealership',
    icon: Car,
    emoji: '🚗',
    description: 'New & used vehicle dealerships, motorbike & scooter shops',
    color: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
    features: ['Vehicle Inventory', 'Sales Orders', 'Trade-ins', 'Financing'],
  },
]

export function getBusinessTypeLabel(type: string): string {
  return BUSINESS_TYPES.find(t => t.value === type)?.label || type
}

export function getBusinessTypeEmoji(type: string): string {
  return BUSINESS_TYPES.find(t => t.value === type)?.emoji || '🏢'
}

export function getBusinessTypeIcon(type: string): LucideIcon | undefined {
  return BUSINESS_TYPES.find(t => t.value === type)?.icon
}

export function getBusinessType(type: string): BusinessType | undefined {
  return BUSINESS_TYPES.find(t => t.value === type)
}

export const BUSINESS_TYPE_VALUES = BUSINESS_TYPES.map(t => t.value)

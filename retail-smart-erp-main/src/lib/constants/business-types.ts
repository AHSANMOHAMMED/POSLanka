import {
  Store,
  UtensilsCrossed,
  ShoppingCart,
  Wrench,
  Car,
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
    description: 'General retail, electronics, clothing, etc.',
    color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    features: ['POS & Sales', 'Inventory', 'Loyalty', 'Purchase Orders'],
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
    description: 'Grocery, wholesale, general store',
    color: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    features: ['Multi-Dept POS', 'Barcode Scanning', 'Waste Tracking', 'Bulk Pricing'],
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

'use client'

import { UtensilsCrossed, ShoppingBag, Truck } from 'lucide-react'

type OrderType = 'dine_in' | 'takeaway' | 'delivery'

interface OrderTypeSelectorProps {
  value: OrderType
  onChange: (type: OrderType) => void
  disabled?: boolean
}

const ORDER_TYPES: { value: OrderType; label: string; icon: typeof UtensilsCrossed }[] = [
  { value: 'dine_in', label: 'Dine In', icon: UtensilsCrossed },
  { value: 'takeaway', label: 'Takeaway', icon: ShoppingBag },
  { value: 'delivery', label: 'Delivery', icon: Truck },
]

export function OrderTypeSelector({ value, onChange, disabled }: OrderTypeSelectorProps) {
  return (
    <div className="flex bg-gray-100 rounded p-1 gap-1">
      {ORDER_TYPES.map(({ value: type, label, icon: Icon }) => (
        <button
          key={type}
          onClick={() => onChange(type)}
          disabled={disabled}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            value === type
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  )
}

'use client'

import type { RestaurantTable } from './types'

interface TableSelectorProps {
  tables: RestaurantTable[]
  selectedTableId: string | null
  onSelect: (tableId: string) => void
  disabled?: boolean
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  available: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' },
  occupied: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700' },
  reserved: { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700' },
}

export function TableSelector({ tables, selectedTableId, onSelect, disabled }: TableSelectorProps) {
  if (tables.length === 0) {
    return (
      <p className="text-xs text-gray-400 text-center py-2">No tables configured</p>
    )
  }

  return (
    <div className="grid grid-cols-5 gap-1.5">
      {tables.map(table => {
        const isSelected = table.id === selectedTableId
        const isAvailable = table.status === 'available' || table.status === 'reserved'
        const colors = STATUS_COLORS[table.status] || STATUS_COLORS.available

        return (
          <button
            key={table.id}
            onClick={() => onSelect(table.id)}
            disabled={disabled || (!isAvailable && !isSelected)}
            className={`relative py-2 px-1 rounded border-2 text-center transition-all ${
              isSelected
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : `${colors.bg} ${colors.border} ${isAvailable ? 'hover:ring-2 hover:ring-blue-200' : 'opacity-60 cursor-not-allowed'}`
            }`}
          >
            <span className={`text-xs font-bold ${isSelected ? 'text-blue-700' : colors.text}`}>
              {table.name}
            </span>
            {table.capacity > 0 && (
              <span className="block text-[10px] text-gray-400">{table.capacity}p</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

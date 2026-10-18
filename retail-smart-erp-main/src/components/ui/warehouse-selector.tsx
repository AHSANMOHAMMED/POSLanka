'use client'

import { useState, useEffect, useCallback } from 'react'
import { Warehouse, ChevronDown, Check, Loader2 } from 'lucide-react'

interface WarehouseOption {
  id: string
  name: string
  code: string
  isDefault: boolean
  isActive: boolean
}

interface WarehouseSelectorProps {
  value: string | null
  onChange: (warehouseId: string | null) => void
  userOnly?: boolean // Only show warehouses assigned to current user
  className?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  showCode?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function WarehouseSelector({
  value,
  onChange,
  userOnly = false,
  className = '',
  placeholder = 'Select warehouse',
  disabled = false,
  required = false,
  showCode = true,
  size = 'md',
}: WarehouseSelectorProps) {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const fetchWarehouses = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('all', 'true')
      params.set('activeOnly', 'true')
      if (userOnly) params.set('userOnly', 'true')

      const res = await fetch(`/api/warehouses?${params}`)
      if (res.ok) {
        const data = await res.json()
        setWarehouses(data)

        // Auto-select if only one warehouse and required
        if (data.length === 1 && required && !value) {
          onChange(data[0].id)
        }
      } else {
        console.error(`Error fetching warehouses (${res.status})`)
      }
    } catch (err) {
      console.error('Error fetching warehouses:', err)
    } finally {
      setLoading(false)
    }
  }, [userOnly, required, value, onChange])

  useEffect(() => {
    fetchWarehouses()
  }, [fetchWarehouses])

  const selectedWarehouse = warehouses.find(w => w.id === value)

  const sizeClasses = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-3 py-2',
    lg: 'px-4 py-3 text-lg',
  }

  // If only one warehouse and not required, show simplified view
  // If required, always show the dropdown so user can see their selection
  if (warehouses.length === 1 && !loading && !required) {
    const warehouse = warehouses[0]
    return (
      <div className={`flex items-center gap-2 text-gray-600 ${className}`}>
        <Warehouse size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />
        <span className={size === 'sm' ? 'text-sm' : ''}>
          {warehouse.name}
          {showCode && <span className="text-gray-400 ml-1">({warehouse.code})</span>}
        </span>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled || loading}
        className={`
          w-full flex items-center justify-between gap-2 border rounded
          ${sizeClasses[size]}
          ${disabled ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed text-gray-500 dark:text-gray-400' : 'bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 dark:text-white'}
          ${open ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600'}
        `}
      >
        <div className="flex items-center gap-2 min-w-0">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-gray-400" />
          ) : (
            <Warehouse size={16} className="text-gray-400 flex-shrink-0" />
          )}
          {selectedWarehouse ? (
            <span className="truncate">
              {selectedWarehouse.name}
              {showCode && (
                <span className="text-gray-400 ml-1">({selectedWarehouse.code})</span>
              )}
            </span>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          size={16}
          className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && !loading && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded shadow-lg z-20 max-h-60 overflow-auto">
            {!required && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className={`
                  w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50
                  ${!value ? 'bg-blue-50' : ''}
                `}
              >
                <span className="w-4" />
                <span className="text-gray-400">None</span>
              </button>
            )}
            {warehouses.map((warehouse) => (
              <button
                key={warehouse.id}
                type="button"
                onClick={() => {
                  onChange(warehouse.id)
                  setOpen(false)
                }}
                className={`
                  w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50
                  ${value === warehouse.id ? 'bg-blue-50' : ''}
                `}
              >
                <span className="w-4">
                  {value === warehouse.id && <Check size={16} className="text-blue-600" />}
                </span>
                <Warehouse size={16} className="text-gray-400" />
                <span className="flex-1 truncate">
                  {warehouse.name}
                  {showCode && (
                    <span className="text-gray-400 ml-1">({warehouse.code})</span>
                  )}
                </span>
                {warehouse.isDefault && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                    Default
                  </span>
                )}
              </button>
            ))}
            {warehouses.length === 0 && (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                No warehouses available
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Hook to get user's default/POS warehouse
export function useUserWarehouse() {
  const [warehouse, setWarehouse] = useState<WarehouseOption | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [availableWarehouses, setAvailableWarehouses] = useState<WarehouseOption[]>([])

  const fetchPosProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/pos-profiles')
      if (res.ok) {
        const data = await res.json()
        if (data.profile?.warehouse) {
          setWarehouse(data.profile.warehouse)
          setNeedsSetup(false)
        } else {
          setNeedsSetup(data.needsSetup)
          setAvailableWarehouses(data.availableWarehouses || [])
        }
      } else {
        console.error(`Error fetching POS profile (${res.status})`)
      }
    } catch (err) {
      console.error('Error fetching POS profile:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const selectWarehouse = useCallback(async (warehouseId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/pos-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId }),
      })

      const data = await res.json()

      if (res.ok) {
        if (data.profile?.warehouse) {
          setWarehouse(data.profile.warehouse)
          setNeedsSetup(false)
        }
        return { success: true }
      }

      // Return the actual error message from API
      return { success: false, error: data.error || 'Failed to set warehouse' }
    } catch (err) {
      console.error('Error setting warehouse:', err)
      return { success: false, error: 'Network error. Please try again.' }
    }
  }, [])

  useEffect(() => {
    fetchPosProfile()
  }, [fetchPosProfile])

  return {
    warehouse,
    loading,
    needsSetup,
    availableWarehouses,
    selectWarehouse,
    refresh: fetchPosProfile,
  }
}

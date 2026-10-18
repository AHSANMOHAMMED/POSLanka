'use client'

import { Clock, Play, X, ChevronDown, ChevronUp, Store } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
import { useState } from 'react'

interface Shift {
  id: string
  entryNumber: string
  openingTime: string
  status: string
  posProfile?: {
    id: string
    name: string
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

interface ShiftStatusProps {
  shift: Shift | null
  hasOpenShift: boolean
  onOpenShift: () => void
  onCloseShift: () => void
  compact?: boolean
}

export function ShiftStatus({ shift, hasOpenShift, onOpenShift, onCloseShift, compact = false }: ShiftStatusProps) {
  const [expanded, setExpanded] = useState(false)

  // No shift required view
  if (!hasOpenShift && !shift) {
    return (
      <button
        onClick={onOpenShift}
        className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
      >
        <Play size={16} />
        <span className="text-sm font-medium">Open Shift</span>
      </button>
    )
  }

  // Compact view for header/navbar
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm font-medium">{shift?.entryNumber}</span>
        </div>
        <button
          onClick={onCloseShift}
          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
          title="Close Shift"
        >
          <X size={16} />
        </button>
      </div>
    )
  }

  // Full status view
  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Store size={20} className="text-green-600 dark:text-green-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-medium dark:text-white">Active Shift</span>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {shift?.entryNumber} • {shift?.posProfile?.name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {shift?.calculatedTotals && (
            <div className="text-right mr-2">
              <div className="text-sm font-medium text-green-600 dark:text-green-400">
                {formatCurrency(shift.calculatedTotals.netSales)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {shift.calculatedTotals.totalTransactions} sales
              </div>
            </div>
          )}
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {expanded && shift && (
        <div className="border-t dark:border-gray-700 p-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Opened at</p>
              <p className="text-sm font-medium dark:text-white">
                {new Date(shift.openingTime).toLocaleTimeString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Duration</p>
              <p className="text-sm font-medium dark:text-white flex items-center gap-1">
                <Clock size={14} />
                {getShiftDuration(shift.openingTime)}
              </p>
            </div>
            {shift.warehouse && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Warehouse</p>
                <p className="text-sm font-medium dark:text-white">{shift.warehouse.name}</p>
              </div>
            )}
          </div>

          {shift.calculatedTotals && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 mb-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Sales</p>
                  <p className="font-medium text-green-600 dark:text-green-400">
                    {formatCurrency(shift.calculatedTotals.totalSales)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Returns</p>
                  <p className="font-medium text-red-600 dark:text-red-400">
                    {formatCurrency(shift.calculatedTotals.totalReturns)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Net</p>
                  <p className="font-medium dark:text-white">
                    {formatCurrency(shift.calculatedTotals.netSales)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {shift.balances && shift.balances.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Opening Balances</p>
              <div className="space-y-1">
                {shift.balances.map((balance, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400 capitalize">
                      {balance.paymentMethod.replace('_', ' ')}
                    </span>
                    <span className="font-medium dark:text-white">
                      {formatCurrency(parseFloat(balance.openingAmount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onCloseShift}
            className="w-full py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm font-medium"
          >
            Close Shift
          </button>
        </div>
      )}
    </div>
  )
}

function getShiftDuration(openingTime: string): string {
  const start = new Date(openingTime)
  const now = new Date()
  const diffMs = now.getTime() - start.getTime()

  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

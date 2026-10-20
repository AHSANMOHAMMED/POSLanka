'use client'

import React, { useState } from 'react'
import { Wallet, X, Plus, Minus, CheckCircle2 } from 'lucide-react'

interface CashDrawerFloatModalProps {
  isOpen: boolean
  onClose: () => void
  currentBalance?: number
  onConfirm: (type: 'float_in' | 'float_out' | 'count', denominations: Record<string, number>, total: number, reason: string) => Promise<void> | void
}

const LKR_DENOMINATIONS = [
  { value: 5000, label: 'LKR 5,000' },
  { value: 1000, label: 'LKR 1,000' },
  { value: 500, label: 'LKR 500' },
  { value: 100, label: 'LKR 100' },
  { value: 50, label: 'LKR 50' },
  { value: 20, label: 'LKR 20' },
  { value: 10, label: 'LKR 10' },
]

export function CashDrawerFloatModal({
  isOpen,
  onClose,
  currentBalance = 15000,
  onConfirm,
}: CashDrawerFloatModalProps) {
  const [operationType, setOperationType] = useState<'float_in' | 'float_out' | 'count'>('float_in')
  const [counts, setCounts] = useState<Record<string, number>>({
    '5000': 1,
    '1000': 5,
    '500': 8,
    '100': 10,
    '50': 0,
    '20': 0,
    '10': 0,
  })
  const [reason, setReason] = useState('Opening Shift Float Allocation')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const handleCountChange = (denom: number, delta: number) => {
    setCounts(prev => ({
      ...prev,
      [denom]: Math.max(0, (prev[denom] || 0) + delta),
    }))
  }

  const calculatedTotal = Object.entries(counts).reduce((sum, [denom, count]) => {
    return sum + Number(denom) * count
  }, 0)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onConfirm(operationType, counts, calculatedTotal, reason)
      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col">
        {/* Header Strip */}
        <div className="bg-teal-700 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-teal-200" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-teal-200 font-bold block">
                Drawer Cash Management • Sunmi T2s
              </span>
              <h2 className="text-lg font-bold leading-tight">
                Cash Drawer Float & Denominations
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-teal-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex flex-col gap-6">
          {/* Operation Selector */}
          <div className="grid grid-cols-3 gap-2 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setOperationType('float_in')
                setReason('Shift Opening Cash Float')
              }}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                operationType === 'float_in'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              + Float In (Add)
            </button>
            <button
              type="button"
              onClick={() => {
                setOperationType('float_out')
                setReason('Mid-Shift Safe Drop / Transfer')
              }}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                operationType === 'float_out'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              - Float Out (Drop)
            </button>
            <button
              type="button"
              onClick={() => {
                setOperationType('count')
                setReason('Spot Audit / Midday Reconciliation')
              }}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                operationType === 'count'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Drawer Count Audit
            </button>
          </div>

          {/* Current Drawer Status */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-mono block">Registered Expected Balance</span>
              <span className="text-lg font-bold font-mono text-slate-800 dark:text-slate-200">
                LKR {currentBalance.toFixed(2)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-teal-600 font-mono font-bold block">Counted Total</span>
              <span className="text-2xl font-bold font-mono text-teal-700 dark:text-teal-400">
                LKR {calculatedTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Denominations Grid */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">
              Sri Lankan Currency Breakdown (LKR)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
              {LKR_DENOMINATIONS.map(item => {
                const count = counts[item.value] || 0
                return (
                  <div
                    key={item.value}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between"
                  >
                    <div>
                      <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                        {item.label}
                      </span>
                      <span className="text-xs font-mono text-slate-400 block">
                        = LKR {(item.value * count).toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCountChange(item.value, -1)}
                        className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-8 text-center font-mono font-bold text-slate-900 dark:text-white text-sm">
                        {count}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCountChange(item.value, 1)}
                        className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-950/60 hover:bg-teal-200 text-teal-800 dark:text-teal-300 flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Reason Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Audit Note / Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={calculatedTotal <= 0 || isSubmitting}
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center gap-2 shadow-md transition-all active:scale-95"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Confirm & Record Float</span>
          </button>
        </div>
      </div>
    </div>
  )
}

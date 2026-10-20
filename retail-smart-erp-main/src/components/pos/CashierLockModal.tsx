'use client'

import React, { useState } from 'react'
import { Lock, LogOut, ShieldAlert } from 'lucide-react'

interface CashierLockModalProps {
  isOpen: boolean
  cashierName?: string
  terminalName?: string
  shiftNumber?: string
  onUnlock: (pin: string) => boolean | Promise<boolean>
  onSwitchUser?: () => void
}

export function CashierLockModal({
  isOpen,
  cashierName = 'Dilshan Perera',
  terminalName = 'Counter 02 (Lane 04)',
  shiftNumber = '#014',
  onUnlock,
  onSwitchUser,
}: CashierLockModalProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)

  if (!isOpen) return null

  const handleKeyPress = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num)
      setError(null)
    }
  }

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1))
    setError(null)
  }

  const handleClear = () => {
    setPin('')
    setError(null)
  }

  const handleAttemptUnlock = async () => {
    if (!pin || pin.length < 4) {
      setError('Please enter your 4-digit cashier PIN')
      return
    }

    setIsUnlocking(true)
    setError(null)

    try {
      const ok = await onUnlock(pin)
      if (ok) {
        setPin('')
      } else {
        setError('Incorrect PIN. Please re-enter.')
      }
    } catch {
      setError('Error verifying PIN')
    } finally {
      setIsUnlocking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col items-center p-8 text-center">
        {/* Lock Icon Shield */}
        <div className="w-16 h-16 rounded-2xl bg-teal-600/10 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center mb-4 shadow-inner ring-8 ring-teal-50 dark:ring-teal-950/40">
          <Lock className="w-8 h-8" />
        </div>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
          Station Locked
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {terminalName} • Shift {shiftNumber}
        </p>

        {/* Cashier Badge */}
        <div className="mt-4 px-4 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Active Cashier: <strong>{cashierName}</strong></span>
        </div>

        {/* PIN Indicators */}
        <div className="flex gap-3 my-6">
          {[0, 1, 2, 3].map(idx => (
            <div
              key={idx}
              className={`w-12 h-14 rounded-2xl border-2 flex items-center justify-center font-mono text-2xl font-bold transition-all ${
                idx < pin.length
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-300 shadow-md scale-105'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-transparent'
              }`}
            >
              {idx < pin.length ? '●' : '—'}
            </div>
          ))}
        </div>

        {error && (
          <div className="text-xs text-red-500 font-semibold mb-4 flex items-center gap-1.5 animate-in shake">
            <ShieldAlert className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-xs mb-6">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
            <button
              key={num}
              type="button"
              onClick={() => handleKeyPress(num)}
              className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-2xl font-semibold text-slate-900 dark:text-white transition-all active:scale-95 shadow-sm"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="h-14 rounded-2xl bg-slate-200/50 dark:bg-slate-800/40 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-xs uppercase font-bold text-slate-500 dark:text-slate-400 transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-2xl font-semibold text-slate-900 dark:text-white transition-all active:scale-95 shadow-sm"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            className="h-14 rounded-2xl bg-slate-200/50 dark:bg-slate-800/40 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-base font-bold text-slate-600 dark:text-slate-400 transition-colors"
          >
            ⌫
          </button>
        </div>

        {/* Actions */}
        <div className="w-full flex flex-col gap-2.5">
          <button
            type="button"
            disabled={pin.length < 4 || isUnlocking}
            onClick={handleAttemptUnlock}
            className="w-full h-12 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-teal-600/20 transition-all active:scale-98"
          >
            {isUnlocking ? 'Unlocking...' : 'Unlock Register'}
          </button>

          {onSwitchUser && (
            <button
              type="button"
              onClick={onSwitchUser}
              className="w-full h-10 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Switch Cashier / Log Out
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

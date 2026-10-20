'use client'

import React, { useState } from 'react'
import { ShieldCheck, X, AlertTriangle, Lock, CheckCircle2 } from 'lucide-react'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface SupervisorAuthModalProps {
  isOpen: boolean
  onClose: () => void
  onAuthorize: (pin: string, reason: string) => Promise<boolean> | boolean
  title?: string
  actionType?: 'price_override' | 'void_item' | 'cart_void' | 'drawer_open' | 'custom_discount'
  contextDetails?: {
    itemName?: string
    originalPrice?: number
    requestedPrice?: number
    discountPercent?: number
    cashierName?: string
    ticketNumber?: string
  }
}

export function SupervisorAuthModal({
  isOpen,
  onClose,
  onAuthorize,
  title = 'Manager Security Override [A4]',
  actionType = 'price_override',
  contextDetails,
}: SupervisorAuthModalProps) {
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('Customer Goodwill / Manager Discretion')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeKey(isOpen, onClose)

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

  const handleApprove = async () => {
    if (!pin || pin.length < 4) {
      setError('Please enter a valid supervisor PIN (min 4 digits)')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const success = await onAuthorize(pin, reason)
      if (success) {
        setPin('')
        onClose()
      } else {
        setError('Authorization failed. Invalid PIN or insufficient permissions.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authorization check failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col">
        {/* Header Strip */}
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider font-bold bg-amber-500/20 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded">
                  Elevated Authorization Required
                </span>
                <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                  SEC-LVL: 03
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                {title}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex flex-col gap-6">
          {/* Context Details Card */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {actionType === 'price_override' && 'Restricted Line Price Override'}
                {actionType === 'void_item' && 'Line Item Removal / Void Request'}
                {actionType === 'cart_void' && 'Full Transaction Cancellation'}
                {actionType === 'drawer_open' && 'Manual Cash Drawer Release'}
                {actionType === 'custom_discount' && 'High-Threshold Discount Approval'}
              </span>
              {contextDetails?.ticketNumber && (
                <span className="text-slate-500 font-mono">
                  Ticket #{contextDetails.ticketNumber}
                </span>
              )}
            </div>

            {contextDetails?.itemName && (
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Item: {contextDetails.itemName}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700">
              {contextDetails?.originalPrice !== undefined && (
                <span>Original: LKR {contextDetails.originalPrice.toFixed(2)}</span>
              )}
              {contextDetails?.requestedPrice !== undefined && (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  Proposed: LKR {contextDetails.requestedPrice.toFixed(2)}
                </span>
              )}
              {contextDetails?.discountPercent !== undefined && (
                <span className="text-amber-600 dark:text-amber-400 font-bold">
                  Discount: {contextDetails.discountPercent}%
                </span>
              )}
              {contextDetails?.cashierName && (
                <span className="ml-auto text-slate-400">Cashier: {contextDetails.cashierName}</span>
              )}
            </div>
          </div>

          {/* Reason Selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Override Justification (Audit Log)
            </label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="Customer Goodwill / Manager Discretion">Customer Goodwill / Manager Discretion</option>
              <option value="Packaging Damaged / Near Expiry Markdown">Packaging Damaged / Near Expiry Markdown</option>
              <option value="Price Shelf Tag Mismatch">Price Shelf Tag Mismatch</option>
              <option value="Special VIP / Corporate Partner Discount">Special VIP / Corporate Partner Discount</option>
              <option value="Barcoded Weight / Batch Recalibration">Barcoded Weight / Batch Recalibration</option>
              <option value="Authorized Transaction Cancellation">Authorized Transaction Cancellation</option>
            </select>
          </div>

          {/* PIN Input & Visual Indicators */}
          <div className="flex flex-col items-center gap-3">
            <label className="text-xs font-mono text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-teal-600" />
              Enter 4-to-6 Digit Supervisor PIN
            </label>
            <div className="flex gap-3">
              {[0, 1, 2, 3, 4, 5].map(idx => (
                <div
                  key={idx}
                  className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center font-mono text-xl font-bold transition-all ${
                    idx < pin.length
                      ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 shadow-sm'
                      : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/40 text-transparent'
                  }`}
                >
                  {idx < pin.length ? '●' : '—'}
                </div>
              ))}
            </div>

            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 font-semibold flex items-center gap-1 animate-in fade-in">
                <AlertTriangle className="w-3.5 h-3.5" />
                {error}
              </div>
            )}
          </div>

          {/* Touch-Friendly Number Pad for POS Tablet */}
          <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto w-full">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
              <button
                key={num}
                type="button"
                onClick={() => handleKeyPress(num)}
                className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-xl font-semibold text-slate-900 dark:text-white transition-colors active:scale-95"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="h-12 rounded-xl bg-slate-200/60 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-xs uppercase font-bold text-slate-600 dark:text-slate-400 transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleKeyPress('0')}
              className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-xl font-semibold text-slate-900 dark:text-white transition-colors active:scale-95"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="h-12 rounded-xl bg-slate-200/60 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono text-xs uppercase font-bold text-slate-600 dark:text-slate-400 transition-colors"
            >
              ⌫
            </button>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Reject & Cancel
          </button>
          <button
            type="button"
            disabled={pin.length < 4 || isSubmitting}
            onClick={handleApprove}
            className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center gap-2 shadow-md transition-all active:scale-95"
          >
            {isSubmitting ? (
              <span>Verifying...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Grant Authorization</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

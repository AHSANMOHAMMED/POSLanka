'use client'

import { useState } from 'react'
import { AlertTriangle, AlertCircle, Info, Sparkles, Loader2 } from 'lucide-react'
import type { SmartWarning } from '@/lib/ai/smart-warnings'

interface SmartWarningBannerProps {
  warnings: SmartWarning[]
  loading?: boolean
  onProceed: () => void
  onCancel: () => void
  proceedText?: string
  cancelText?: string
  processing?: boolean
}

const severityConfig = {
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    icon: Info,
    iconColor: 'text-blue-500',
    titleColor: 'text-blue-800 dark:text-blue-300',
    textColor: 'text-blue-700 dark:text-blue-400',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    icon: AlertCircle,
    iconColor: 'text-amber-500',
    titleColor: 'text-amber-800 dark:text-amber-300',
    textColor: 'text-amber-700 dark:text-amber-400',
  },
  danger: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
    icon: AlertTriangle,
    iconColor: 'text-red-500',
    titleColor: 'text-red-800 dark:text-red-300',
    textColor: 'text-red-700 dark:text-red-400',
  },
}

export function SmartWarningBanner({
  warnings,
  loading,
  onProceed,
  onCancel,
  proceedText = 'Proceed Anyway',
  cancelText = 'Cancel',
  processing,
}: SmartWarningBannerProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  if (loading) {
    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded p-4 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" />
        Checking for potential issues...
      </div>
    )
  }

  if (warnings.length === 0) return null

  const hasDanger = warnings.some(w => w.severity === 'danger')
  const canProceed = !hasDanger || acknowledged

  return (
    <div className="border border-amber-300 dark:border-amber-700 rounded overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800">
        <Sparkles size={16} className="text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
          AI Smart Warnings ({warnings.length})
        </span>
      </div>

      {/* Warning list */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-60 overflow-y-auto">
        {warnings.map(warning => {
          const config = severityConfig[warning.severity]
          const Icon = config.icon
          return (
            <div key={warning.id} className={`px-4 py-3 ${config.bg}`}>
              <div className="flex items-start gap-2.5">
                <Icon size={16} className={`mt-0.5 flex-shrink-0 ${config.iconColor}`} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${config.titleColor}`}>
                    {warning.title}
                  </p>
                  <p className={`text-xs mt-0.5 ${config.textColor}`}>
                    {warning.message}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Danger acknowledgment */}
      {hasDanger && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-800">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="rounded border-red-300 text-red-600 focus:ring-red-500"
            />
            <span className="text-red-700 dark:text-red-400">
              I acknowledge the risks and want to proceed
            </span>
          </label>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onProceed}
          disabled={!canProceed || processing}
          className="px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-200 dark:hover:bg-amber-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" />
              Processing...
            </span>
          ) : (
            proceedText
          )}
        </button>
      </div>
    </div>
  )
}

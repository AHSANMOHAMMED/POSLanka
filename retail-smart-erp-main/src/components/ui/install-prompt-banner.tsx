'use client'

import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

interface InstallPromptBannerProps {
  companyName: string
  className?: string
}

export function InstallPromptBanner({ companyName, className = '' }: InstallPromptBannerProps) {
  const { canInstall, isInstalled, isIOS, install } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(false)

  if (isInstalled || dismissed || !canInstall) return null

  if (isIOS) {
    return (
      <div className={`bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/50 rounded-md p-4 ${className}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Download size={20} className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Install {companyName}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                Tap the share button, then &quot;Add to Home Screen&quot;
              </p>
            </div>
          </div>
          <button onClick={() => setDismissed(true)} className="text-blue-400 hover:text-blue-600 flex-shrink-0">
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/50 rounded-md p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Download size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
              Install {companyName}
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
              Quick access from your home screen
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={install}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
          >
            Install
          </button>
          <button onClick={() => setDismissed(true)} className="text-blue-400 hover:text-blue-600">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

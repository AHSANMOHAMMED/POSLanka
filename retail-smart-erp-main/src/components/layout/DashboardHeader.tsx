'use client'

import { useCallback } from 'react'
import { ConnectionDot } from '@/components/ui/connection-status'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { CompanySwitcher } from './CompanySwitcher'

interface DashboardHeaderProps {
  tenantName: string
  userEmail: string
  appVersion?: string
  companySlug?: string
}

export function DashboardHeader({ tenantName, userEmail, appVersion, companySlug }: DashboardHeaderProps) {
  // Persist theme change to API (fire and forget)
  const handleThemeChange = useCallback((theme: 'light' | 'dark' | 'system') => {
    fetch('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).catch(() => {
      // Theme is already saved to localStorage, API failure is non-critical
    })
  }, [])

  return (
    <div className="px-3 py-2 bg-white dark:bg-gray-900 border-b dark:border-gray-800 shadow-sm">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <CompanySwitcher currentSlug={companySlug} />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{tenantName}</span>
          {appVersion && (
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full font-mono">
              v{appVersion}
            </span>
          )}
          <ConnectionDot className="ml-0.5" />
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle onThemeChange={handleThemeChange} />
          <span className="text-xs text-gray-500 dark:text-gray-400">{userEmail}</span>
        </div>
      </div>
    </div>
  )
}

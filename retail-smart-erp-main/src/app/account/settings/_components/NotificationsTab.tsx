'use client'

import { useState } from 'react'
import { Bell, Loader2, Check } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface NotificationsTabProps {
  notifications: { email: boolean; billing: boolean; security: boolean; marketing: boolean }
  onNotificationsChange: (n: { email: boolean; billing: boolean; security: boolean; marketing: boolean }) => void
}

const NOTIFICATION_ITEMS = [
  { key: 'email', label: 'Email notifications', desc: 'Receive important updates via email' },
  { key: 'billing', label: 'Billing alerts', desc: 'Get notified about billing and invoices' },
  { key: 'security', label: 'Security alerts', desc: 'Important security notifications' },
  { key: 'marketing', label: 'Marketing emails', desc: 'Product updates and promotions' },
] as const

export function NotificationsTab({ notifications, onNotificationsChange }: NotificationsTabProps) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/account/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications }),
      })

      if (res.ok) {
        setSaved(true)
        toast.success('Notification preferences saved')
        setTimeout(() => setSaved(false), 2000)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save notification preferences')
      }
    } catch {
      toast.error('Failed to save notification preferences')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-md flex items-center justify-center">
          <Bell className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Notification Preferences</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage how you receive notifications</p>
        </div>
      </div>
      <div className="p-6 space-y-4 max-w-lg">
        {NOTIFICATION_ITEMS.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-md"
          >
            <div>
              <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{item.desc}</p>
            </div>
            <button
              role="switch"
              aria-checked={notifications[item.key]}
              aria-label={item.label}
              onClick={() =>
                onNotificationsChange({
                  ...notifications,
                  [item.key]: !notifications[item.key],
                })
              }
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                notifications[item.key]
                  ? 'bg-gray-900 dark:bg-blue-600'
                  : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow ${
                  notifications[item.key] ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        ))}
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 dark:bg-gray-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-gray-600 disabled:opacity-50 font-medium transition-colors mt-4"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : null}
          {saved ? 'Saved' : 'Save Preferences'}
        </button>
      </div>
    </div>
  )
}

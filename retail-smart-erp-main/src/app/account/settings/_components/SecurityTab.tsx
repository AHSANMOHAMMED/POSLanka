'use client'

import { useState } from 'react'
import { Shield, Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'

export function SecurityTab() {
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' })
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })
  const [passwordError, setPasswordError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleChangePassword = async () => {
    setPasswordError('')

    if (passwords.new !== passwords.confirm) {
      setPasswordError('Passwords do not match')
      return
    }

    if (passwords.new.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      })

      if (res.ok) {
        setPasswords({ current: '', new: '', confirm: '' })
        toast.success('Password updated successfully')
      } else {
        const data = await res.json()
        setPasswordError(data.error || 'Failed to change password')
      }
    } catch {
      setPasswordError('Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  const passwordFields = [
    { key: 'current' as const, label: 'Current Password' },
    { key: 'new' as const, label: 'New Password', hint: 'Minimum 8 characters' },
    { key: 'confirm' as const, label: 'Confirm New Password' },
  ]

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-md flex items-center justify-center">
          <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Security Settings</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Update your password</p>
        </div>
      </div>
      <div className="p-6 space-y-5 max-w-lg">
        {passwordError && (
          <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-md text-sm">
            {passwordError}
          </div>
        )}
        {passwordFields.map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {field.label}
            </label>
            <div className="relative">
              <input
                type={showPasswords[field.key] ? 'text' : 'password'}
                value={passwords[field.key]}
                onChange={(e) => setPasswords({ ...passwords, [field.key]: e.target.value })}
                autoComplete={field.key === 'current' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, [field.key]: !showPasswords[field.key] })}
                aria-label={showPasswords[field.key] ? 'Hide password' : 'Show password'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showPasswords[field.key] ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {field.hint && <p className="text-xs text-gray-500 mt-2">{field.hint}</p>}
          </div>
        ))}
        <button
          onClick={handleChangePassword}
          disabled={saving || !passwords.current || !passwords.new || !passwords.confirm}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 dark:bg-gray-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-gray-600 disabled:opacity-50 font-medium transition-colors"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Update Password
        </button>
      </div>
    </div>
  )
}

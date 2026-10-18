'use client'

import { useState } from 'react'
import { User, Loader2, Check } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface ProfileTabProps {
  profile: { fullName: string; email: string; phone: string }
  onProfileChange: (profile: { fullName: string; email: string; phone: string }) => void
}

export function ProfileTab({ profile, onProfileChange }: ProfileTabProps) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })

      if (res.ok) {
        setSaved(true)
        toast.success('Profile updated')
        setTimeout(() => setSaved(false), 2000)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save profile')
      }
    } catch {
      toast.error('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
          <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile Information</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Update your personal details</p>
        </div>
      </div>
      <div className="p-6 space-y-5 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Full Name
          </label>
          <input
            type="text"
            value={profile.fullName}
            onChange={(e) => onProfileChange({ ...profile, fullName: e.target.value })}
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Email Address
          </label>
          <input
            type="email"
            value={profile.email}
            disabled
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
          />
          <p className="text-xs text-gray-500 mt-2">Email cannot be changed</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Phone Number
          </label>
          <input
            type="tel"
            value={profile.phone}
            onChange={(e) => onProfileChange({ ...profile, phone: e.target.value })}
            placeholder="+1 234 567 8900"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 dark:bg-gray-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-gray-600 disabled:opacity-50 font-medium transition-colors"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : null}
          {saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { User, Lock, Bell, Palette, Monitor } from 'lucide-react'
import { PageSkeleton } from '@/components/ui/skeleton'
import { useUnsavedChangesWarning } from '@/hooks'
import { ProfileTab } from './_components/ProfileTab'
import { SecurityTab } from './_components/SecurityTab'
import { SessionsTab } from './_components/SessionsTab'
import { NotificationsTab } from './_components/NotificationsTab'
import { PreferencesTab } from './_components/PreferencesTab'

const tabs = [
  { id: 'profile', name: 'Profile', icon: User },
  { id: 'security', name: 'Security', icon: Lock },
  { id: 'sessions', name: 'Sessions', icon: Monitor },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'preferences', name: 'Preferences', icon: Palette },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('profile')
  const [loading, setLoading] = useState(true)

  const [profile, setProfile] = useState({
    fullName: '',
    email: '',
    phone: '',
  })

  const [preferences, setPreferences] = useState({
    language: 'en',
    timezone: 'UTC',
    dateFormat: 'MM/DD/YYYY',
    currency: 'LKR',
  })

  const [notifications, setNotifications] = useState({
    email: true,
    billing: true,
    security: true,
    marketing: false,
  })

  // Track original values for unsaved changes detection
  const [originalProfile, setOriginalProfile] = useState({ fullName: '', email: '', phone: '' })
  const [originalPreferences, setOriginalPreferences] = useState({ language: 'en', timezone: 'UTC', dateFormat: 'MM/DD/YYYY', currency: 'LKR' })
  const [originalNotifications, setOriginalNotifications] = useState({ email: true, billing: true, security: true, marketing: false })

  const hasUnsavedChanges = useMemo(() => {
    const profileChanged = profile.fullName !== originalProfile.fullName || profile.phone !== originalProfile.phone
    const prefsChanged = preferences.language !== originalPreferences.language || preferences.timezone !== originalPreferences.timezone || preferences.dateFormat !== originalPreferences.dateFormat || preferences.currency !== originalPreferences.currency
    const notifsChanged = notifications.email !== originalNotifications.email || notifications.billing !== originalNotifications.billing || notifications.security !== originalNotifications.security || notifications.marketing !== originalNotifications.marketing
    return profileChanged || prefsChanged || notifsChanged
  }, [profile, preferences, notifications, originalProfile, originalPreferences, originalNotifications])

  useUnsavedChangesWarning(hasUnsavedChanges)

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch('/api/account')
      if (res.ok) {
        const data = await res.json()
        const p = {
          fullName: data.fullName || '',
          email: data.email || '',
          phone: data.phone || '',
        }
        setProfile(p)
        setOriginalProfile(p)
      }
    } catch (error) {
      console.error('Failed to fetch account:', error)
    }
  }, [])

  const fetchPreferences = useCallback(async () => {
    try {
      const res = await fetch('/api/account/preferences')
      if (res.ok) {
        const data = await res.json()
        const prefs = {
          language: data.language || 'en',
          timezone: data.timezone || 'UTC',
          dateFormat: data.dateFormat || 'MM/DD/YYYY',
          currency: data.currency || 'LKR',
        }
        const notifs = {
          email: data.notifications?.email ?? true,
          billing: data.notifications?.billing ?? true,
          security: data.notifications?.security ?? true,
          marketing: data.notifications?.marketing ?? false,
        }
        setPreferences(prefs)
        setNotifications(notifs)
        setOriginalPreferences(prefs)
        setOriginalNotifications(notifs)
      }
    } catch (error) {
      console.error('Failed to fetch preferences:', error)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([fetchAccount(), fetchPreferences()]).finally(() => {
      setLoading(false)
    })
  }, [fetchAccount, fetchPreferences])

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your account settings and preferences</p>
        </div>
        <PageSkeleton layout="form" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your account settings and preferences</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Tab Navigation */}
        <div className="lg:w-64 flex-shrink-0">
          <nav
            className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-2 lg:p-3 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible no-scrollbar"
            aria-label="Settings tabs"
            role="tablist"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 flex items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 lg:py-3 rounded-md text-xs lg:text-sm font-medium transition-all lg:w-full ${
                  activeTab === tab.id
                    ? 'bg-gray-900 dark:bg-gray-700 text-white shadow-lg'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <tab.icon className="w-4 h-4 lg:w-5 lg:h-5" />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {activeTab === 'profile' && (
              <div id="panel-profile" role="tabpanel">
                <ProfileTab profile={profile} onProfileChange={setProfile} />
              </div>
            )}
            {activeTab === 'security' && (
              <div id="panel-security" role="tabpanel">
                <SecurityTab />
              </div>
            )}
            {activeTab === 'sessions' && (
              <div id="panel-sessions" role="tabpanel">
                <SessionsTab />
              </div>
            )}
            {activeTab === 'notifications' && (
              <div id="panel-notifications" role="tabpanel">
                <NotificationsTab notifications={notifications} onNotificationsChange={setNotifications} />
              </div>
            )}
            {activeTab === 'preferences' && (
              <div id="panel-preferences" role="tabpanel">
                <PreferencesTab preferences={preferences} onPreferencesChange={setPreferences} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

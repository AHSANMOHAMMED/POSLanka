'use client'

import { useState } from 'react'
import { Palette, Sun, Moon, Monitor, Globe, Calendar, Loader2, Check } from 'lucide-react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { toast } from '@/components/ui/toast'

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern Time (US)' },
  { value: 'America/Chicago', label: 'Central Time (US)' },
  { value: 'America/Denver', label: 'Mountain Time (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { value: 'Europe/London', label: 'London (UK)' },
  { value: 'Europe/Paris', label: 'Paris (France)' },
  { value: 'Asia/Colombo', label: 'Sri Lanka' },
  { value: 'Asia/Kolkata', label: 'India' },
  { value: 'Asia/Dubai', label: 'Dubai (UAE)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Tokyo (Japan)' },
  { value: 'Australia/Sydney', label: 'Sydney (Australia)' },
]

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ta', label: 'Tamil' },
  { value: 'si', label: 'Sinhala' },
]

const DATE_FORMATS = [
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (UK/Europe)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
  { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY' },
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY (Europe)' },
]

const CURRENCIES = [
  { value: 'LKR', label: 'Sri Lankan Rupee (Rs)' },
  { value: 'USD', label: 'US Dollar ($)' },
  { value: 'EUR', label: 'Euro (€)' },
  { value: 'GBP', label: 'British Pound (£)' },
  { value: 'INR', label: 'Indian Rupee (₹)' },
  { value: 'AUD', label: 'Australian Dollar (A$)' },
  { value: 'CAD', label: 'Canadian Dollar (C$)' },
  { value: 'SGD', label: 'Singapore Dollar (S$)' },
  { value: 'AED', label: 'UAE Dirham (د.إ)' },
  { value: 'SAR', label: 'Saudi Riyal (﷼)' },
  { value: 'MYR', label: 'Malaysian Ringgit (RM)' },
  { value: 'PKR', label: 'Pakistani Rupee (₨)' },
  { value: 'BDT', label: 'Bangladeshi Taka (৳)' },
  { value: 'NGN', label: 'Nigerian Naira (₦)' },
  { value: 'KES', label: 'Kenyan Shilling (KSh)' },
  { value: 'ZAR', label: 'South African Rand (R)' },
  { value: 'BRL', label: 'Brazilian Real (R$)' },
  { value: 'MXN', label: 'Mexican Peso (MX$)' },
  { value: 'JPY', label: 'Japanese Yen (¥)' },
  { value: 'KRW', label: 'South Korean Won (₩)' },
  { value: 'THB', label: 'Thai Baht (฿)' },
  { value: 'PHP', label: 'Philippine Peso (₱)' },
  { value: 'IDR', label: 'Indonesian Rupiah (Rp)' },
  { value: 'TRY', label: 'Turkish Lira (₺)' },
  { value: 'CHF', label: 'Swiss Franc (CHF)' },
  { value: 'SEK', label: 'Swedish Krona (kr)' },
  { value: 'NOK', label: 'Norwegian Krone (kr)' },
  { value: 'PLN', label: 'Polish Zloty (zł)' },
  { value: 'NPR', label: 'Nepalese Rupee (रू)' },
]

interface PreferencesTabProps {
  preferences: { language: string; timezone: string; dateFormat: string; currency: string }
  onPreferencesChange: (p: { language: string; timezone: string; dateFormat: string; currency: string }) => void
}

export function PreferencesTab({ preferences, onPreferencesChange }: PreferencesTabProps) {
  const { theme, setTheme } = useTheme()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/account/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      })

      if (res.ok) {
        if (preferences.language === 'en' || preferences.language === 'si') {
          localStorage.setItem('poslanka_locale', preferences.language)
          document.documentElement.lang = preferences.language === 'si' ? 'si' : 'en'
        }
        setSaved(true)
        toast.success('Preferences saved')
        setTimeout(() => setSaved(false), 2000)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save preferences')
      }
    } catch {
      toast.error('Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  const themeOptions = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ] as const

  const selectFields = [
    { label: 'Language', icon: Globe, value: preferences.language, key: 'language', options: LANGUAGES },
    { label: 'Timezone', value: preferences.timezone, key: 'timezone', options: TIMEZONES },
    { label: 'Date Format', icon: Calendar, value: preferences.dateFormat, key: 'dateFormat', options: DATE_FORMATS },
    { label: 'Currency', value: preferences.currency, key: 'currency', options: CURRENCIES, hint: 'This currency will be used for displaying subscription prices and wallet balance' },
  ]

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <div className="w-10 h-10 bg-cyan-100 dark:bg-cyan-900/30 rounded-md flex items-center justify-center">
          <Palette className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Display Preferences</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Customize your experience</p>
        </div>
      </div>
      <div className="p-6 space-y-6 max-w-lg">
        {/* Theme Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Theme</label>
          <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
            {themeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={theme === opt.id}
                onClick={() => setTheme(opt.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-md border-2 transition-all ${
                  theme === opt.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <opt.icon className={`w-6 h-6 ${theme === opt.id ? 'text-blue-600' : 'text-gray-500 dark:text-gray-400'}`} />
                <span className={`text-sm font-medium ${theme === opt.id ? 'text-blue-600' : 'text-gray-700 dark:text-gray-300'}`}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {selectFields.map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {field.icon ? (
                <span className="flex items-center gap-2">
                  <field.icon className="w-4 h-4" />
                  {field.label}
                </span>
              ) : (
                field.label
              )}
            </label>
            <select
              value={field.value}
              onChange={(e) => onPreferencesChange({ ...preferences, [field.key]: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {field.hint && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{field.hint}</p>
            )}
          </div>
        ))}

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
          {saved ? 'Saved' : 'Save Preferences'}
        </button>
      </div>
    </div>
  )
}

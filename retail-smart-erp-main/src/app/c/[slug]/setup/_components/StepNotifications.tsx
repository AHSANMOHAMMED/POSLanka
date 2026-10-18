'use client'

import { useState } from 'react'
import { Bell, Mail, MessageSquare, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'

interface StepNotificationsProps {
  data: SetupWizardData
  businessType: string
  onChange: (updates: Partial<SetupWizardData>) => void
  onNext: () => void
  onBack: () => void
}

// Available trigger events per business type
const TRIGGER_OPTIONS: { key: string; label: string; description: string; businessTypes?: string[] }[] = [
  { key: 'sale.completed', label: 'Sale Completed', description: 'Send receipt after each sale' },
  { key: 'work_order.created', label: 'Work Order Created', description: 'Notify when vehicle is checked in', businessTypes: ['auto_service'] },
  { key: 'work_order.completed', label: 'Work Order Completed', description: 'Notify when vehicle is ready', businessTypes: ['auto_service'] },
  { key: 'appointment.reminder', label: 'Appointment Reminder', description: 'Remind customers before appointments', businessTypes: ['auto_service', 'restaurant', 'dealership'] },
  { key: 'reservation.confirmed', label: 'Reservation Confirmed', description: 'Confirm restaurant reservations', businessTypes: ['restaurant'] },
]

export function StepNotifications({ data, businessType, onChange, onNext, onBack }: StepNotificationsProps) {
  const enabled = data.enableNotifications || false
  const smsProvider = data.smsProvider || 'none'
  const smsConfig = data.smsConfig || {}
  const enabledTriggers = data.enabledNotificationTriggers || []
  const [showSmsConfig, setShowSmsConfig] = useState(false)

  const updateSmsConfig = (key: string, value: string) => {
    onChange({ smsConfig: { ...smsConfig, [key]: value } })
  }

  const toggleTrigger = (key: string) => {
    const updated = enabledTriggers.includes(key)
      ? enabledTriggers.filter(t => t !== key)
      : [...enabledTriggers, key]
    onChange({ enabledNotificationTriggers: updated })
  }

  // Filter triggers relevant to this business type
  const availableTriggers = TRIGGER_OPTIONS.filter(
    t => !t.businessTypes || t.businessTypes.includes(businessType)
  )

  return (
    <div>
      {/* ==================== Enable Toggle ==================== */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Bell size={24} className="text-blue-600" />
            Notifications
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Set up email and SMS notifications for your customers. This step is optional and can be configured later.
          </p>
        </div>

        <label className="flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange({ enableNotifications: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <p className="font-medium text-gray-900 dark:text-white">Set up notifications now</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Configure email and SMS providers for automated customer notifications
            </p>
          </div>
        </label>
      </div>

      {enabled && (
        <>
          {/* ==================== Email (Platform Managed) ==================== */}
          <div className="mb-8">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Mail size={20} className="text-blue-600" />
                Email Notifications
              </h3>
            </div>
            <div className="flex items-start gap-3 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded">
              <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">Email is pre-configured</p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                  Notification emails are sent automatically from your company address. No setup required.
                </p>
              </div>
            </div>
          </div>

          {/* ==================== SMS Provider ==================== */}
          <div className="mb-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <MessageSquare size={20} className="text-blue-600" />
                SMS Provider
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { value: 'none', label: 'None' },
                { value: 'websms_lk', label: 'WebSMS.lk' },
                { value: 'twilio', label: 'Twilio' },
                { value: 'generic_http', label: 'Custom HTTP' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ smsProvider: opt.value })}
                  className={`py-2.5 px-3 rounded border text-sm font-medium transition-colors ${
                    smsProvider === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-500'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {smsProvider !== 'none' && (
              <div className="border border-gray-200 dark:border-gray-600 rounded p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowSmsConfig(!showSmsConfig)}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  Provider Configuration {showSmsConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showSmsConfig && smsProvider === 'websms_lk' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
                      <input type="password" value={smsConfig.websmsApiKey || ''} onChange={(e) => updateSmsConfig('websmsApiKey', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Token</label>
                      <input type="password" value={smsConfig.websmsApiToken || ''} onChange={(e) => updateSmsConfig('websmsApiToken', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sender ID</label>
                      <input type="text" value={smsConfig.websmsSenderId || ''} onChange={(e) => updateSmsConfig('websmsSenderId', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                    </div>
                  </div>
                )}

                {showSmsConfig && smsProvider === 'twilio' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account SID</label>
                      <input type="password" value={smsConfig.twilioAccountSid || ''} onChange={(e) => updateSmsConfig('twilioAccountSid', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Auth Token</label>
                      <input type="password" value={smsConfig.twilioAuthToken || ''} onChange={(e) => updateSmsConfig('twilioAuthToken', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone Number</label>
                      <input type="text" value={smsConfig.twilioPhoneNumber || ''} onChange={(e) => updateSmsConfig('twilioPhoneNumber', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="+1234567890" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ==================== Auto-trigger Templates ==================== */}
          <div className="mb-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Auto-Send Notifications</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Select which notifications to enable automatically with default templates.
              </p>
            </div>

            <div className="space-y-2">
              {availableTriggers.map(trigger => (
                <label
                  key={trigger.key}
                  className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={enabledTriggers.includes(trigger.key)}
                    onChange={() => toggleTrigger(trigger.key)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{trigger.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{trigger.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ==================== Navigation Buttons ==================== */}
      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

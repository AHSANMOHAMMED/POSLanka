'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

interface SmsSettingsFormProps {
  onSave?: () => void
}

interface StaticParam {
  key: string
  value: string
}

interface SmsSettings {
  isEnabled: boolean
  // SMS Gateway (ERPNext style)
  genericApiUrl?: string | null
  genericMethod?: string | null
  genericMessageParam?: string | null
  genericRecipientParam?: string | null
  genericStaticParams?: StaticParam[] | null
  // Limits
  dailyLimit?: number | null
  monthlyLimit?: number | null
}

export function SmsSettingsForm({ onSave }: SmsSettingsFormProps) {
  const [settings, setSettings] = useState<SmsSettings>({
    isEnabled: false,
    genericMethod: 'POST',
    genericMessageParam: 'text',
    genericRecipientParam: 'to',
    genericStaticParams: [],
    dailyLimit: 500,
    monthlyLimit: 10000,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/sms-settings')
      if (res.ok) {
        const data = await res.json()
        setSettings({
          isEnabled: data.isEnabled || false,
          genericApiUrl: data.genericApiUrl || '',
          genericMethod: data.genericMethod || 'POST',
          genericMessageParam: data.genericMessageParam || 'text',
          genericRecipientParam: data.genericRecipientParam || 'to',
          genericStaticParams: data.genericStaticParams || [],
          dailyLimit: data.dailyLimit || 500,
          monthlyLimit: data.monthlyLimit || 10000,
        })
      }
    } catch (error) {
      console.error('Failed to fetch SMS settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch('/api/sms-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          provider: 'generic_http', // Always use generic HTTP
        }),
      })

      if (res.ok) {
        setSaveSuccess(true)
        onSave?.()
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        const data = await res.json()
        setSaveError(data.error || 'Failed to save settings')
      }
    } catch (error) {
      console.error('Failed to save SMS settings:', error)
      setSaveError('Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleSendTest = async () => {
    if (!testPhone) return

    setSendingTest(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/sms-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_test', testPhone }),
      })

      const result = await res.json()
      console.log('Test SMS result:', result)
      setTestResult({
        success: result.success,
        message: result.success
          ? `Test SMS sent successfully!${result.messageId ? ` (ID: ${result.messageId})` : ''}`
          : result.errorMessage || result.error || 'Failed to send test SMS',
      })
    } catch {
      setTestResult({ success: false, message: 'Failed to send test SMS' })
    } finally {
      setSendingTest(false)
    }
  }

  const addStaticParam = () => {
    const params = settings.genericStaticParams || []
    setSettings({
      ...settings,
      genericStaticParams: [...params, { key: '', value: '' }],
    })
  }

  const updateStaticParam = (index: number, field: 'key' | 'value', value: string) => {
    const params = [...(settings.genericStaticParams || [])]
    params[index] = { ...params[index], [field]: value }
    setSettings({ ...settings, genericStaticParams: params })
  }

  const removeStaticParam = (index: number) => {
    const params = settings.genericStaticParams?.filter((_, i) => i !== index)
    setSettings({ ...settings, genericStaticParams: params })
  }

  if (loading) {
    return <div className="p-4">Loading...</div>
  }

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">SMS Notifications</h3>
          <p className="text-sm text-gray-500">Send SMS messages to customers</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.isEnabled}
            onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* SMS Gateway Settings */}
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">SMS Gateway Settings</h4>

        {/* SMS Gateway URL */}
        <div>
          <Label>SMS Gateway URL</Label>
          <Input
            value={settings.genericApiUrl || ''}
            onChange={(e) => setSettings({ ...settings, genericApiUrl: e.target.value })}
            placeholder="https://cloud.websms.lk/smsAPI"
          />
        </div>

        {/* Parameter Names */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Message Parameter</Label>
            <Input
              value={settings.genericMessageParam || 'text'}
              onChange={(e) => setSettings({ ...settings, genericMessageParam: e.target.value })}
              placeholder="text"
            />
          </div>
          <div>
            <Label>Receiver Parameter</Label>
            <Input
              value={settings.genericRecipientParam || 'to'}
              onChange={(e) => setSettings({ ...settings, genericRecipientParam: e.target.value })}
              placeholder="to"
            />
          </div>
        </div>

        {/* Static Parameters Table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Static Parameters</Label>
            <Button type="button" variant="outline" size="sm" onClick={addStaticParam}>
              Add Row
            </Button>
          </div>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Parameter</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Value</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(settings.genericStaticParams?.length || 0) === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-gray-500">
                      No parameters. Click &quot;Add Row&quot; to add API credentials.
                    </td>
                  </tr>
                ) : (
                  settings.genericStaticParams?.map((param, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <Input
                          value={param.key}
                          onChange={(e) => updateStaticParam(i, 'key', e.target.value)}
                          placeholder="apikey"
                          className="text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={param.value}
                          onChange={(e) => updateStaticParam(i, 'value', e.target.value)}
                          placeholder="your_api_key"
                          className="text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeStaticParam(i)}
                          className="text-red-500 hover:text-red-700 text-lg"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Use POST checkbox */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="usePost"
            checked={settings.genericMethod === 'POST'}
            onChange={(e) => setSettings({ ...settings, genericMethod: e.target.checked ? 'POST' : 'GET' })}
            className="rounded border-gray-300"
          />
          <Label htmlFor="usePost" className="mb-0 cursor-pointer">Use POST</Label>
        </div>
      </Card>

      {/* Rate Limits */}
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">Rate Limits</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Daily Limit</Label>
            <Input
              type="number"
              value={settings.dailyLimit || 500}
              onChange={(e) => setSettings({ ...settings, dailyLimit: parseInt(e.target.value) || 500 })}
              min={1}
            />
          </div>
          <div>
            <Label>Monthly Limit</Label>
            <Input
              type="number"
              value={settings.monthlyLimit || 10000}
              onChange={(e) => setSettings({ ...settings, monthlyLimit: parseInt(e.target.value) || 10000 })}
              min={1}
            />
          </div>
        </div>
      </Card>

      {/* Test SMS */}
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">Test SMS</h4>
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label>Test Phone Number</Label>
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="0771234567"
            />
          </div>
          <Button onClick={handleSendTest} disabled={sendingTest || !testPhone || !settings.genericApiUrl}>
            {sendingTest ? 'Sending...' : 'Send Test SMS'}
          </Button>
        </div>

        {testResult && (
          <div className={`p-3 rounded-md ${testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {testResult.message}
          </div>
        )}
      </Card>

      {/* Save Status */}
      {saveError && (
        <div className="p-3 rounded-md bg-red-50 text-red-800">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="p-3 rounded-md bg-green-50 text-green-800">
          Settings saved successfully!
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  )
}

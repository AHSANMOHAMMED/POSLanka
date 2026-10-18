'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SendMessageModal } from '@/components/notifications'

interface UsageStats {
  sms: {
    sentToday: number
    sentThisMonth: number
    dailyLimit: number
    monthlyLimit: number
  }
  email: {
    sentToday: number
    sentThisMonth: number
    dailyLimit: number
    monthlyLimit: number
  }
}

export default function NotificationsPage() {
  const { data: session } = useSession()
  const tenantSlug = session?.user?.tenantSlug || ''
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [, setLoading] = useState(true)
  const [showSendModal, setShowSendModal] = useState(false)
  const [defaultChannel, setDefaultChannel] = useState<'sms' | 'email'>('sms')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [smsRes, emailRes, usageRes] = await Promise.all([
        fetch('/api/sms-settings'),
        fetch('/api/email-settings'),
        fetch('/api/notification-usage'),
      ])

      if (smsRes.ok) {
        const data = await smsRes.json()
        setSmsEnabled(data.isEnabled)
      }

      if (emailRes.ok) {
        const data = await emailRes.json()
        setEmailEnabled(data.isEnabled)
      }

      if (usageRes.ok) {
        const usageData = await usageRes.json()
        setUsage(usageData)
      } else {
        // Fallback to defaults if usage API doesn't exist yet
        setUsage({
          sms: { sentToday: 0, sentThisMonth: 0, dailyLimit: 500, monthlyLimit: 10000 },
          email: { sentToday: 0, sentThisMonth: 0, dailyLimit: 500, monthlyLimit: 10000 },
        })
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
      setUsage({
        sms: { sentToday: 0, sentThisMonth: 0, dailyLimit: 500, monthlyLimit: 10000 },
        email: { sentToday: 0, sentThisMonth: 0, dailyLimit: 500, monthlyLimit: 10000 },
      })
    } finally {
      setLoading(false)
    }
  }

  const handleQuickSend = (channel: 'sms' | 'email') => {
    setDefaultChannel(channel)
    setShowSendModal(true)
  }

  const getUsagePercentage = (used: number, limit: number) => {
    return Math.min((used / limit) * 100, 100)
  }

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500'
    if (percentage >= 70) return 'bg-yellow-500'
    return 'bg-blue-500'
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Notification Center</h1>
        <p className="text-gray-500 mt-1">Configure SMS and email notifications for your business</p>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href={`/c/${tenantSlug}/settings/notifications/sms`}>
          <Card className="p-4 hover:border-blue-500 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium">SMS Settings</h3>
                <p className="text-sm text-gray-500">
                  {smsEnabled ? (
                    <span className="text-green-600">Enabled</span>
                  ) : (
                    <span className="text-gray-400">Not configured</span>
                  )}
                </p>
              </div>
            </div>
          </Card>
        </Link>

        <Link href={`/c/${tenantSlug}/settings/notifications/email`}>
          <Card className="p-4 hover:border-blue-500 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded">
                <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Email Settings</h3>
                <p className="text-sm text-gray-500">
                  {emailEnabled ? (
                    <span className="text-green-600">Enabled</span>
                  ) : (
                    <span className="text-gray-400">Not configured</span>
                  )}
                </p>
              </div>
            </div>
          </Card>
        </Link>

        <Link href={`/c/${tenantSlug}/settings/notifications/templates`}>
          <Card className="p-4 hover:border-blue-500 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Templates</h3>
                <p className="text-sm text-gray-500">Manage message templates</p>
              </div>
            </div>
          </Card>
        </Link>

        <Link href={`/c/${tenantSlug}/settings/notifications/logs`}>
          <Card className="p-4 hover:border-blue-500 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded">
                <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Message Logs</h3>
                <p className="text-sm text-gray-500">View sent messages</p>
              </div>
            </div>
          </Card>
        </Link>
      </div>

      {/* Usage Overview */}
      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* SMS Usage */}
          <Card className="p-4">
            <h3 className="font-medium mb-4">SMS Usage This Month</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Monthly ({usage.sms.sentThisMonth.toLocaleString()} / {usage.sms.monthlyLimit.toLocaleString()})</span>
                  <span>{getUsagePercentage(usage.sms.sentThisMonth, usage.sms.monthlyLimit).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getUsageColor(getUsagePercentage(usage.sms.sentThisMonth, usage.sms.monthlyLimit))}`}
                    style={{ width: `${getUsagePercentage(usage.sms.sentThisMonth, usage.sms.monthlyLimit)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Daily ({usage.sms.sentToday.toLocaleString()} / {usage.sms.dailyLimit.toLocaleString()})</span>
                  <span>{getUsagePercentage(usage.sms.sentToday, usage.sms.dailyLimit).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getUsageColor(getUsagePercentage(usage.sms.sentToday, usage.sms.dailyLimit))}`}
                    style={{ width: `${getUsagePercentage(usage.sms.sentToday, usage.sms.dailyLimit)}%` }}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Email Usage */}
          <Card className="p-4">
            <h3 className="font-medium mb-4">Email Usage This Month</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Monthly ({usage.email.sentThisMonth.toLocaleString()} / {usage.email.monthlyLimit.toLocaleString()})</span>
                  <span>{getUsagePercentage(usage.email.sentThisMonth, usage.email.monthlyLimit).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getUsageColor(getUsagePercentage(usage.email.sentThisMonth, usage.email.monthlyLimit))}`}
                    style={{ width: `${getUsagePercentage(usage.email.sentThisMonth, usage.email.monthlyLimit)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Daily ({usage.email.sentToday.toLocaleString()} / {usage.email.dailyLimit.toLocaleString()})</span>
                  <span>{getUsagePercentage(usage.email.sentToday, usage.email.dailyLimit).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getUsageColor(getUsagePercentage(usage.email.sentToday, usage.email.dailyLimit))}`}
                    style={{ width: `${getUsagePercentage(usage.email.sentToday, usage.email.dailyLimit)}%` }}
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Quick Send Actions */}
      <Card className="p-4">
        <h3 className="font-medium mb-3">Quick Actions</h3>
        <div className="flex gap-3">
          <Button
            onClick={() => handleQuickSend('sms')}
            disabled={!smsEnabled}
            className="flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Send SMS
          </Button>
          <Button
            onClick={() => handleQuickSend('email')}
            disabled={!emailEnabled}
            variant="outline"
            className="flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Send Email
          </Button>
          <Link href={`/c/${tenantSlug}/settings/notifications/sms-center`}>
            <Button variant="outline" className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              SMS Center
            </Button>
          </Link>
        </div>
      </Card>

      {/* Quick Info */}
      <Card className="p-4 bg-blue-50 border-blue-200">
        <h3 className="font-medium text-blue-900">Getting Started</h3>
        <ul className="mt-2 text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>Configure your SMS provider (WebSMS.lk, Twilio, or custom HTTP gateway)</li>
          <li>Set up email settings (SMTP, SendGrid, or Resend)</li>
          <li>Create message templates with variables like {`{{customer_name}}`}</li>
          <li>Templates can auto-trigger on events like appointment reminders</li>
        </ul>
      </Card>

      {/* Send Message Modal */}
      <SendMessageModal
        isOpen={showSendModal}
        onClose={() => setShowSendModal(false)}
        defaultChannel={defaultChannel}
        onSent={() => fetchData()}
      />
    </div>
  )
}

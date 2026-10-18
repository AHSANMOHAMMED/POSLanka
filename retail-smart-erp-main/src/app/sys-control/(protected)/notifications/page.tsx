'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Bell,
  Send,
  Loader2,
  Check,
  Info,
  AlertTriangle,
  CreditCard,
  Shield,
  Trash2,
  Sparkles,
  Clock,
} from 'lucide-react'

interface Account {
  id: string
  fullName: string
  email: string
}

interface SentNotification {
  id: string
  accountId: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
  accountName: string | null
  accountEmail: string | null
}

const notificationTypes = [
  { value: 'info', label: 'Info', icon: Info, color: 'text-blue-600' },
  { value: 'warning', label: 'Warning', icon: AlertTriangle, color: 'text-yellow-600' },
  { value: 'billing', label: 'Billing', icon: CreditCard, color: 'text-purple-600' },
  { value: 'security', label: 'Security', icon: Shield, color: 'text-red-600' },
  { value: 'success', label: 'Success', icon: Check, color: 'text-green-600' },
]

interface Template {
  label: string
  icon: typeof Clock
  type: string
  title: string
  message: string
  link?: string
}

const templates: Template[] = [
  {
    label: 'Subscription Expiring',
    icon: Clock,
    type: 'billing',
    title: 'Your subscription is expiring soon',
    message: 'Your subscription will end in a few days. Upgrade now to keep all your data and continue using all features.',
    link: '/account/billing',
  },
  {
    label: 'Payment Reminder',
    icon: CreditCard,
    type: 'billing',
    title: 'Payment reminder',
    message: 'Your subscription payment is due. Please complete the payment to avoid any service interruption.',
    link: '/account/billing',
  },
  {
    label: 'System Maintenance',
    icon: AlertTriangle,
    type: 'warning',
    title: 'Scheduled maintenance',
    message: 'We will be performing scheduled maintenance. Some features may be temporarily unavailable.',
  },
  {
    label: 'New Feature',
    icon: Sparkles,
    type: 'info',
    title: 'New feature available!',
    message: 'We\'ve added exciting new features to improve your experience. Check them out!',
  },
  {
    label: 'Welcome',
    icon: Check,
    type: 'success',
    title: 'Welcome to Smart POS!',
    message: 'Thank you for joining Smart POS. We\'re excited to have you on board. Get started by setting up your first company.',
    link: '/account',
  },
]

export default function AdminNotificationsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [sentNotifications, setSentNotifications] = useState<SentNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const [type, setType] = useState('info')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [link, setLink] = useState('')
  const [sendToAll, setSendToAll] = useState(true)
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [activeTemplate, setActiveTemplate] = useState<number | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [accountsRes, notificationsRes] = await Promise.all([
        fetch('/api/sys-control/users?limit=100'),
        fetch('/api/sys-control/notifications?limit=50'),
      ])

      if (accountsRes.ok) {
        const data = await accountsRes.json()
        // API returns array directly, not { users: [] }
        setAccounts(Array.isArray(data) ? data : data.users || [])
      }

      if (notificationsRes.ok) {
        const data = await notificationsRes.json()
        setSentNotifications(data.notifications || [])
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const applyTemplate = (index: number) => {
    const tmpl = templates[index]
    setType(tmpl.type)
    setTitle(tmpl.title)
    setMessage(tmpl.message)
    setLink(tmpl.link || '')
    setActiveTemplate(index)
  }

  // Clear active template highlight when user manually edits any field
  const handleFieldChange = (setter: (value: string) => void, value: string) => {
    setter(value)
    setActiveTemplate(null)
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !message.trim()) {
      alert('Title and message are required')
      return
    }

    if (!sendToAll && selectedAccounts.length === 0) {
      alert('Please select at least one user or choose "Send to All"')
      return
    }

    setSending(true)
    try {
      const res = await fetch('/api/sys-control/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          message: message.trim(),
          link: link.trim() || undefined,
          sendToAll,
          accountIds: sendToAll ? undefined : selectedAccounts,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        alert(data.message || 'Notification sent successfully!')
        setTitle('')
        setMessage('')
        setLink('')
        setSelectedAccounts([])
        setActiveTemplate(null)
        fetchData()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to send notification')
      }
    } catch (error) {
      console.error('Failed to send notification:', error)
      alert('Failed to send notification')
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this notification?')) return

    setDeleting(id)
    try {
      const res = await fetch('/api/sys-control/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })

      if (res.ok) {
        fetchData()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to delete notification')
      }
    } catch (error) {
      console.error('Failed to delete notification:', error)
      alert('Failed to delete notification')
    } finally {
      setDeleting(null)
    }
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Bell className="w-6 h-6" />
          Send Notifications
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Send notifications to users</p>
      </div>

      {/* Quick Templates */}
      <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Quick Templates</h3>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {templates.map((tmpl, index) => {
            const Icon = tmpl.icon
            const isActive = activeTemplate === index
            return (
              <button
                key={tmpl.label}
                type="button"
                onClick={() => applyTemplate(index)}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded border text-sm font-medium whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500'
                    : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {tmpl.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Send Notification Form */}
      <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Send className="w-5 h-5" />
            New Notification
          </h2>
        </div>
        <form onSubmit={handleSend} className="p-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => handleFieldChange(setType, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              >
                {notificationTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => handleFieldChange(setTitle, e.target.value)}
                placeholder="Notification title"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => handleFieldChange(setMessage, e.target.value)}
              rows={3}
              placeholder="Notification message..."
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Link (Optional)
            </label>
            <input
              type="text"
              value={link}
              onChange={(e) => handleFieldChange(setLink, e.target.value)}
              placeholder="e.g., /account/billing"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="send-to-all"
                checked={sendToAll}
                onChange={(e) => setSendToAll(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
              <label htmlFor="send-to-all" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Send to all users ({accounts.length} users)
              </label>
            </div>

            {!sendToAll && (
              <div className="border border-gray-200 dark:border-gray-700 rounded p-4 max-h-48 overflow-y-auto">
                <div className="space-y-2">
                  {accounts.map((account) => (
                    <label
                      key={account.id}
                      className="flex items-center gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAccounts.includes(account.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAccounts([...selectedAccounts, account.id])
                          } else {
                            setSelectedAccounts(selectedAccounts.filter((id) => id !== account.id))
                          }
                        }}
                        className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{account.fullName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{account.email}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={sending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {sending ? 'Sending...' : 'Send Notification'}
            </button>
          </div>
        </form>
      </div>

      {/* Sent Notifications History */}
      <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">Recent Notifications</h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {sentNotifications.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              No notifications sent yet
            </div>
          ) : (
            sentNotifications.map((notification) => {
              const typeConfig = notificationTypes.find((t) => t.value === notification.type)
              const Icon = typeConfig?.icon || Bell

              return (
                <div key={notification.id} className="px-6 py-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded bg-gray-100 dark:bg-gray-700 ${typeConfig?.color || 'text-gray-600 dark:text-gray-400'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-gray-900 dark:text-white">{notification.title}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDate(notification.createdAt)}
                          </span>
                          <button
                            onClick={() => handleDelete(notification.id)}
                            disabled={deleting === notification.id}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                            title="Delete notification"
                          >
                            {deleting === notification.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{notification.message}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        To: {notification.accountName || notification.accountEmail || 'Unknown'}
                        {notification.isRead && (
                          <span className="ml-2 text-green-600">Read</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import type { NotificationChannel, SendNotificationResult } from '@/lib/notifications/types'

interface Recipient {
  contact: string
  name?: string
  type?: 'customer' | 'supplier' | 'staff' | 'manual'
  id?: string
}

interface Template {
  id: string
  name: string
  channel: NotificationChannel
}

interface Customer {
  id: string
  name: string
  phone?: string | null
  email?: string | null
}

interface SendMessageModalProps {
  isOpen: boolean
  onClose: () => void
  // Pre-fill options
  defaultRecipients?: Recipient[]
  defaultChannel?: 'sms' | 'email'
  entityType?: string
  entityId?: string
  entityReference?: string
  // Callback after sending
  onSent?: (result: SendNotificationResult) => void
}

export function SendMessageModal({
  isOpen,
  onClose,
  defaultRecipients = [],
  defaultChannel = 'sms',
  entityType,
  entityId,
  entityReference,
  onSent,
}: SendMessageModalProps) {
  const [channel, setChannel] = useState<'sms' | 'email' | 'both'>(defaultChannel)
  const [recipients, setRecipients] = useState<Recipient[]>(defaultRecipients)
  const [newRecipient, setNewRecipient] = useState('')
  const [useTemplate, setUseTemplate] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [smsContent, setSmsContent] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendNotificationResult | null>(null)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchTemplates()
      setRecipients(defaultRecipients)
      setChannel(defaultChannel)
      setResult(null)
    }
  }, [isOpen, defaultRecipients, defaultChannel])

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/notification-templates?all=true')
      if (res.ok) {
        const data = await res.json()
        // Handle both array and {data: [...]} response formats
        setTemplates(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch templates:', error)
    }
  }

  const searchCustomers = async (search: string) => {
    if (!search.trim()) {
      setCustomers([])
      return
    }

    setLoadingCustomers(true)
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(search)}&pageSize=10`)
      if (res.ok) {
        const data = await res.json()
        setCustomers(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error('Failed to search customers:', error)
    } finally {
      setLoadingCustomers(false)
    }
  }

  const addCustomerAsRecipient = (customer: Customer) => {
    const contact = channel === 'email' ? customer.email : customer.phone
    if (!contact) return

    // Check for duplicates
    if (recipients.some(r => r.contact === contact)) return

    setRecipients([
      ...recipients,
      {
        contact,
        name: customer.name,
        type: 'customer',
        id: customer.id,
      },
    ])
    setShowCustomerPicker(false)
    setCustomerSearch('')
    setCustomers([])
  }

  const addRecipient = () => {
    if (!newRecipient.trim()) return

    // Validate format based on channel
    if (channel === 'sms' || channel === 'both') {
      // Basic phone validation - allow digits, +, -, spaces
      if (!/^[\d\s+()-]+$/.test(newRecipient)) {
        // Might be email
        if (!newRecipient.includes('@')) {
          return
        }
      }
    }

    setRecipients([...recipients, { contact: newRecipient.trim(), type: 'manual' }])
    setNewRecipient('')
  }

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index))
  }

  const handleSend = async () => {
    if (recipients.length === 0) return

    setSending(true)
    setResult(null)

    try {
      const payload: Record<string, unknown> = {
        channel,
        recipients,
        entityType,
        entityId,
        entityReference,
      }

      if (useTemplate && selectedTemplateId) {
        payload.templateId = selectedTemplateId
      } else {
        if (channel === 'sms' || channel === 'both') {
          payload.smsContent = smsContent
        }
        if (channel === 'email' || channel === 'both') {
          payload.emailSubject = emailSubject
          payload.emailBody = emailBody
        }
      }

      const res = await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: SendNotificationResult = await res.json()
      setResult(data)
      onSent?.(data)

      // Auto-close on complete success
      if (data.success && data.totalFailed === 0) {
        setTimeout(onClose, 2000)
      }
    } catch {
      setResult({
        success: false,
        results: [],
        totalSent: 0,
        totalFailed: recipients.length,
      })
    } finally {
      setSending(false)
    }
  }

  const isValid = () => {
    if (recipients.length === 0) return false

    if (useTemplate) {
      return !!selectedTemplateId
    }

    if (channel === 'sms' || channel === 'both') {
      if (!smsContent.trim()) return false
    }

    if (channel === 'email' || channel === 'both') {
      if (!emailSubject.trim() || !emailBody.trim()) return false
    }

    return true
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send Message">
      <div className="p-4 space-y-4">
        {/* Channel Selection */}
        <div>
          <Label>Channel</Label>
          <div className="flex gap-2 mt-1">
            <Button
              type="button"
              variant={channel === 'sms' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setChannel('sms')}
            >
              SMS
            </Button>
            <Button
              type="button"
              variant={channel === 'email' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setChannel('email')}
            >
              Email
            </Button>
            <Button
              type="button"
              variant={channel === 'both' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setChannel('both')}
            >
              Both
            </Button>
          </div>
        </div>

        {/* Recipients */}
        <div>
          <Label>Recipients</Label>
          <div className="mt-1 flex gap-2">
            <Input
              value={newRecipient}
              onChange={(e) => setNewRecipient(e.target.value)}
              placeholder={channel === 'email' ? 'email@example.com' : '0771234567'}
              onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
            />
            <Button type="button" onClick={addRecipient}>
              Add
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCustomerPicker(!showCustomerPicker)}
            >
              {showCustomerPicker ? 'Hide' : 'From Customers'}
            </Button>
          </div>

          {/* Customer Picker */}
          {showCustomerPicker && (
            <div className="mt-2 p-3 bg-gray-50 rounded-md">
              <Input
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value)
                  searchCustomers(e.target.value)
                }}
                placeholder="Search customers by name or phone..."
              />
              {loadingCustomers && (
                <p className="text-sm text-gray-500 mt-2">Searching...</p>
              )}
              {customers.length > 0 && (
                <div className="mt-2 max-h-[150px] overflow-y-auto divide-y border rounded-md bg-white">
                  {customers.map((c) => {
                    const contact = channel === 'email' ? c.email : c.phone
                    const hasContact = !!contact
                    return (
                      <button
                        key={c.id}
                        onClick={() => hasContact && addCustomerAsRecipient(c)}
                        disabled={!hasContact}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${!hasContact ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="font-medium">{c.name}</div>
                        <div className="text-gray-500 text-xs">
                          {contact || `No ${channel === 'email' ? 'email' : 'phone'}`}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {recipients.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {recipients.map((r, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm ${
                    r.type === 'customer' ? 'bg-blue-100' : 'bg-gray-100'
                  }`}
                >
                  {r.name ? `${r.name} (${r.contact})` : r.contact}
                  <button
                    onClick={() => removeRecipient(i)}
                    className="text-gray-500 hover:text-red-500"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Template Toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useTemplate}
            onChange={(e) => setUseTemplate(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-sm">Use template</span>
        </label>

        {/* Template Selection */}
        {useTemplate ? (
          <div>
            <Label>Template</Label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
            >
              <option value="">Select template...</option>
              {templates
                .filter((t) => t.channel === channel || t.channel === 'both')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.channel})
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <>
            {/* SMS Content */}
            {(channel === 'sms' || channel === 'both') && (
              <div>
                <Label>SMS Message</Label>
                <textarea
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
                  rows={3}
                  value={smsContent}
                  onChange={(e) => setSmsContent(e.target.value)}
                  placeholder="Enter your message..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  {smsContent.length} / 160 characters
                </p>
              </div>
            )}

            {/* Email Content */}
            {(channel === 'email' || channel === 'both') && (
              <>
                <div>
                  <Label>Email Subject</Label>
                  <Input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Subject line"
                  />
                </div>
                <div>
                  <Label>Email Body</Label>
                  <textarea
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
                    rows={6}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="<p>Your message here...</p>"
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* Result Display */}
        {result && (
          <div
            className={`p-3 rounded-md ${
              result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}
          >
            {result.success ? (
              <p>
                Successfully sent {result.totalSent} message(s)
                {result.totalFailed > 0 && `, ${result.totalFailed} failed`}
              </p>
            ) : (
              <div>
                <p>Failed to send messages</p>
                {result.results
                  .filter((r) => !r.success)
                  .slice(0, 3)
                  .map((r, i) => (
                    <p key={i} className="text-xs mt-1">
                      {r.recipient}: {r.errorMessage}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !isValid()}>
            {sending ? 'Sending...' : `Send to ${recipients.length} recipient(s)`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

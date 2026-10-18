'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { VariablePicker } from './VariablePicker'
import { previewTemplate } from '@/lib/notifications/templates/preview'
import { sanitizeHtml } from '@/lib/utils/sanitize-html'
import type { NotificationChannel, TriggerEvent } from '@/lib/notifications/types'

interface Template {
  id?: string
  name: string
  channel: NotificationChannel
  triggerEvent?: string | null
  isAutoTrigger: boolean
  smsContent?: string | null
  emailSubject?: string | null
  emailBody?: string | null
  isActive: boolean
}

interface TemplateEditorProps {
  isOpen: boolean
  onClose: () => void
  template?: Template | null
  onSave: (template: Template) => Promise<void>
}

const TRIGGER_EVENTS: { value: TriggerEvent; label: string }[] = [
  { value: 'work_order.created', label: 'Work Order Created' },
  { value: 'work_order.completed', label: 'Work Order Completed' },
  { value: 'work_order.invoice_created', label: 'Work Order Invoice Created' },
  { value: 'appointment.created', label: 'Appointment Scheduled' },
  { value: 'appointment.confirmed', label: 'Appointment Confirmed' },
  { value: 'appointment.reminder', label: 'Appointment Reminder (24h)' },
  { value: 'appointment.reminder_1h', label: 'Appointment Reminder (1h)' },
  { value: 'sale.completed', label: 'Sale Completed' },
  { value: 'vehicle.service_due', label: 'Vehicle Service Due' },
  { value: 'customer.birthday', label: 'Customer Birthday' },
  { value: 'estimate.approved', label: 'Estimate Approved' },
  { value: 'estimate.rejected', label: 'Estimate Rejected' },
]

export function TemplateEditor({ isOpen, onClose, template, onSave }: TemplateEditorProps) {
  const [formData, setFormData] = useState<Template>({
    name: '',
    channel: 'sms',
    isAutoTrigger: false,
    isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [showVariables, setShowVariables] = useState(false)
  const [activeField, setActiveField] = useState<'sms' | 'subject' | 'body'>('sms')
  const [previewMode, setPreviewMode] = useState(false)

  useEffect(() => {
    if (template) {
      setFormData(template)
    } else {
      setFormData({
        name: '',
        channel: 'sms',
        isAutoTrigger: false,
        isActive: true,
      })
    }
  }, [template, isOpen])

  const handleSave = async () => {
    if (!formData.name) return

    setSaving(true)
    try {
      await onSave(formData)
      onClose()
    } catch (error) {
      console.error('Failed to save template:', error)
    } finally {
      setSaving(false)
    }
  }

  const insertVariable = (variable: string) => {
    const tag = `{{${variable}}}`

    if (activeField === 'sms') {
      setFormData({
        ...formData,
        smsContent: (formData.smsContent || '') + tag,
      })
    } else if (activeField === 'subject') {
      setFormData({
        ...formData,
        emailSubject: (formData.emailSubject || '') + tag,
      })
    } else if (activeField === 'body') {
      setFormData({
        ...formData,
        emailBody: (formData.emailBody || '') + tag,
      })
    }

    setShowVariables(false)
  }

  const getPreviewContent = (content: string) => {
    return previewTemplate(content)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={template?.id ? 'Edit Template' : 'Create Template'}
    >
      <div className="space-y-4 p-4">
        {/* Name */}
        <div>
          <Label>Template Name</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Appointment Reminder"
          />
        </div>

        {/* Channel */}
        <div>
          <Label>Channel</Label>
          <select
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
            value={formData.channel}
            onChange={(e) => setFormData({ ...formData, channel: e.target.value as NotificationChannel })}
          >
            <option value="sms">SMS Only</option>
            <option value="email">Email Only</option>
            <option value="both">Both SMS & Email</option>
          </select>
        </div>

        {/* Auto-Trigger Settings */}
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.isAutoTrigger}
              onChange={(e) => setFormData({ ...formData, isAutoTrigger: e.target.checked })}
              className="rounded border-gray-300"
            />
            <span className="text-sm">Auto-send on trigger event</span>
          </label>

          {formData.isAutoTrigger && (
            <div>
              <Label>Trigger Event</Label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
                value={formData.triggerEvent || ''}
                onChange={(e) => setFormData({ ...formData, triggerEvent: e.target.value || null })}
              >
                <option value="">Select event...</option>
                {TRIGGER_EVENTS.map((event) => (
                  <option key={event.value} value={event.value}>
                    {event.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Preview Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Message Content</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowVariables(true)}
            >
              Insert Variable
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? 'Edit' : 'Preview'}
            </Button>
          </div>
        </div>

        {/* SMS Content */}
        {(formData.channel === 'sms' || formData.channel === 'both') && (
          <div>
            <Label>SMS Content</Label>
            {previewMode ? (
              <div className="mt-1 p-3 bg-gray-50 rounded-md text-sm whitespace-pre-wrap">
                {getPreviewContent(formData.smsContent || '')}
              </div>
            ) : (
              <textarea
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
                rows={4}
                value={formData.smsContent || ''}
                onChange={(e) => setFormData({ ...formData, smsContent: e.target.value })}
                onFocus={() => setActiveField('sms')}
                placeholder="Hi {{customer_first_name}}, your appointment is scheduled for {{appointment_datetime}}."
              />
            )}
            <p className="text-xs text-gray-500 mt-1">
              {formData.smsContent?.length || 0} characters
              {formData.smsContent && formData.smsContent.length > 160 && (
                <span className="text-amber-600">
                  {' '}
                  ({Math.ceil(formData.smsContent.length / 153)} SMS segments)
                </span>
              )}
            </p>
          </div>
        )}

        {/* Email Content */}
        {(formData.channel === 'email' || formData.channel === 'both') && (
          <>
            <div>
              <Label>Email Subject</Label>
              {previewMode ? (
                <div className="mt-1 p-3 bg-gray-50 rounded-md text-sm">
                  {getPreviewContent(formData.emailSubject || '')}
                </div>
              ) : (
                <Input
                  value={formData.emailSubject || ''}
                  onChange={(e) => setFormData({ ...formData, emailSubject: e.target.value })}
                  onFocus={() => setActiveField('subject')}
                  placeholder="Your appointment at {{business_name}}"
                />
              )}
            </div>

            <div>
              <Label>Email Body (HTML)</Label>
              {previewMode ? (
                <div
                  className="mt-1 p-3 bg-gray-50 rounded-md text-sm prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(getPreviewContent(formData.emailBody || '')) }}
                />
              ) : (
                <textarea
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border font-mono"
                  rows={8}
                  value={formData.emailBody || ''}
                  onChange={(e) => setFormData({ ...formData, emailBody: e.target.value })}
                  onFocus={() => setActiveField('body')}
                  placeholder="<p>Hi {{customer_name}},</p><p>Your appointment is confirmed for {{appointment_datetime}}.</p>"
                />
              )}
            </div>
          </>
        )}

        {/* Active Toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
            className="rounded border-gray-300"
          />
          <span className="text-sm">Template is active</span>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !formData.name}>
            {saving ? 'Saving...' : template?.id ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>

      {/* Variable Picker Modal */}
      <VariablePicker
        isOpen={showVariables}
        onClose={() => setShowVariables(false)}
        onSelect={insertVariable}
      />
    </Modal>
  )
}

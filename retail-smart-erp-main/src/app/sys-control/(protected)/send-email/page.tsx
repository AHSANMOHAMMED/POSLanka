'use client'

import { useState } from 'react'

const EMAIL_TEMPLATES = [
  { label: 'Custom (blank)', value: 'custom' },
  { label: 'Test - Plain text', value: 'test-plain' },
  { label: 'Test - HTML styled', value: 'test-html' },
  { label: 'OTP simulation', value: 'otp' },
  { label: 'Invite simulation', value: 'invite' },
]

function getTemplateContent(template: string): { subject: string; html: string; text: string } {
  const appName = 'Retail Smart POS'

  switch (template) {
    case 'test-plain':
      return {
        subject: `Test Email from ${appName}`,
        html: '',
        text: `This is a test email from ${appName} system admin panel.\n\nIf you received this, your email configuration is working correctly.\n\nSent at: ${new Date().toISOString()}`,
      }
    case 'test-html':
      return {
        subject: `Test Email from ${appName}`,
        text: '',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
    <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${appName}</h1>
  </div>
  <div style="padding: 40px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="color: #1e293b; font-size: 20px; margin: 0 0 16px 0;">Email Configuration Test</h2>
    <p style="color: #64748b; font-size: 15px; margin: 0 0 24px 0;">
      This is a test email sent from the system admin panel. If you're reading this, your Resend email configuration is working correctly.
    </p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="color: #166534; font-size: 14px; margin: 0; font-weight: 600;">Status: Email delivered successfully</p>
    </div>
    <p style="color: #94a3b8; font-size: 13px; margin: 0;">
      Sent at: ${new Date().toISOString()}
    </p>
  </div>
</div>`,
      }
    case 'otp':
      return {
        subject: `12345 is your verification code - ${appName}`,
        text: `Your verification code is: 12345\n\nThis code expires in 10 minutes.\n\nThis is a TEST - not a real OTP.`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
    <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${appName}</h1>
  </div>
  <div style="padding: 40px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="color: #334155; font-size: 16px; margin: 0 0 8px 0;">Hi there,</p>
    <p style="color: #64748b; font-size: 15px; margin: 0 0 28px 0;">This is a <strong>TEST</strong> OTP email. Not a real verification code.</p>
    <div style="text-align: center; margin-bottom: 28px;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
        <tr>
          ${['1','2','3','4','5'].map(d => `<td style="padding: 0 4px;"><div style="width: 52px; height: 64px; background: #f1f5f9; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 28px; font-weight: 700; color: #1e40af; line-height: 64px; text-align: center;">${d}</div></td>`).join('')}
        </tr>
      </table>
    </div>
    <div style="text-align: center; margin-bottom: 28px;">
      <span style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 20px;">Expires in 10 minutes</span>
    </div>
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; text-align: center;">
      <p style="color: #991b1b; font-size: 13px; margin: 0; font-weight: 600;">TEST EMAIL - This is not a real verification code</p>
    </div>
  </div>
</div>`,
      }
    case 'invite':
      return {
        subject: `You've been invited to join Test Company - ${appName}`,
        text: `Hi there,\n\nAdmin has invited you to join Test Company as a manager on ${appName}.\n\nThis is a TEST invite email.`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
    <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${appName}</h1>
  </div>
  <div style="padding: 40px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="color: #334155; font-size: 16px; margin: 0 0 8px 0;">Hi there,</p>
    <p style="color: #64748b; font-size: 15px; margin: 0 0 24px 0;"><strong>Admin</strong> has invited you to join <strong>Test Company</strong> as a <strong>Manager</strong>.</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 28px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
        <tr>
          <td style="width: 44px; vertical-align: top;">
            <div style="width: 40px; height: 40px; background: #dbeafe; border-radius: 8px; text-align: center; line-height: 40px; font-size: 18px; font-weight: 700; color: #1e40af;">T</div>
          </td>
          <td style="padding-left: 12px; vertical-align: top;">
            <div style="font-size: 15px; font-weight: 600; color: #1e293b;">Test Company</div>
            <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Role: Manager</div>
          </td>
        </tr>
      </table>
    </div>
    <div style="text-align: center; margin-bottom: 28px;">
      <a href="#" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; font-size: 15px; font-weight: 600; padding: 14px 36px; border-radius: 10px; text-decoration: none;">Accept Invitation</a>
    </div>
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; text-align: center;">
      <p style="color: #991b1b; font-size: 13px; margin: 0; font-weight: 600;">TEST EMAIL - This is not a real invitation</p>
    </div>
  </div>
</div>`,
      }
    default:
      return { subject: '', html: '', text: '' }
  }
}

type SendResult = {
  success: boolean
  dev?: boolean
  messageId?: string
  error?: string
}

export default function SendEmailPage() {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [contentMode, setContentMode] = useState<'html' | 'text'>('html')
  const [html, setHtml] = useState('')
  const [text, setText] = useState('')
  const [template, setTemplate] = useState('custom')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  function handleTemplateChange(value: string) {
    setTemplate(value)
    if (value === 'custom') return
    const content = getTemplateContent(value)
    setSubject(content.subject)
    if (content.html) {
      setContentMode('html')
      setHtml(content.html)
      setText(content.text)
    } else {
      setContentMode('text')
      setText(content.text)
      setHtml('')
    }
  }

  async function handleSend() {
    if (!to || !subject || (!html && !text)) return

    setSending(true)
    setResult(null)

    try {
      const res = await fetch('/api/sys-control/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          html: contentMode === 'html' ? html : undefined,
          text: contentMode === 'text' ? text : undefined,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setResult(data)
      } else {
        setResult({ success: false, error: data.error })
      }
    } catch {
      setResult({ success: false, error: 'Network error' })
    } finally {
      setSending(false)
    }
  }

  const canSend = to && subject && (html || text)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Send Test Email</h1>
        <p className="text-gray-500 mt-1">
          Test system email delivery via Resend (primary) or Brevo (fallback).
          Emails are sent from <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">noreply@retailsmarterp.com</code>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="bg-white rounded border shadow-sm">
          <div className="p-6 space-y-4">
            {/* Template selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
              <select
                value={template}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {EMAIL_TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* To */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Subject */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Content mode toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
              <div className="flex gap-1 mb-2 bg-gray-100 rounded p-1 w-fit">
                <button
                  onClick={() => setContentMode('html')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    contentMode === 'html' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  HTML
                </button>
                <button
                  onClick={() => setContentMode('text')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    contentMode === 'text' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Plain Text
                </button>
              </div>

              {contentMode === 'html' ? (
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  placeholder="<h1>Hello</h1><p>Your email content here...</p>"
                  rows={12}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              ) : (
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Plain text email content..."
                  rows={12}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSend}
                disabled={!canSend || sending}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? 'Sending...' : 'Send Email'}
              </button>
              {contentMode === 'html' && html && (
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition-colors"
                >
                  {showPreview ? 'Hide Preview' : 'Preview'}
                </button>
              )}
            </div>

            {/* Result */}
            {result && (
              <div className={`p-4 rounded border ${
                result.success
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                {result.success ? (
                  <div>
                    <p className="text-green-800 font-medium text-sm">Email sent successfully</p>
                    {result.messageId && (
                      <p className="text-green-600 text-xs mt-1">Message ID: {result.messageId}</p>
                    )}
                    {result.dev && (
                      <p className="text-yellow-700 text-xs mt-1">Dev mode: logged to console (no email provider configured)</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-red-800 font-medium text-sm">Failed to send</p>
                    <p className="text-red-600 text-xs mt-1">{result.error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Preview panel */}
        <div className="bg-white rounded border shadow-sm">
          <div className="p-4 border-b">
            <h2 className="text-sm font-medium text-gray-700">Email Preview</h2>
          </div>
          <div className="p-4">
            {contentMode === 'html' && html ? (
              <div className="border rounded overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b">
                  <p className="text-xs text-gray-500">From: Retail Smart POS &lt;noreply@retailsmarterp.com&gt;</p>
                  <p className="text-xs text-gray-500">To: {to || '(not set)'}</p>
                  <p className="text-xs font-medium text-gray-700">{subject || '(no subject)'}</p>
                </div>
                <iframe
                  srcDoc={html}
                  className="w-full border-0"
                  style={{ height: '500px' }}
                  sandbox=""
                  title="Email preview"
                />
              </div>
            ) : contentMode === 'text' && text ? (
              <div className="border rounded overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b">
                  <p className="text-xs text-gray-500">From: Retail Smart POS &lt;noreply@retailsmarterp.com&gt;</p>
                  <p className="text-xs text-gray-500">To: {to || '(not set)'}</p>
                  <p className="text-xs font-medium text-gray-700">{subject || '(no subject)'}</p>
                </div>
                <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-sans">{text}</pre>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
                Select a template or write content to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Receiver {
  mobile: string
  name?: string
}

type SendToType = '' | 'All Customer' | 'All Supplier' | 'All Contact' | 'Manual Entry'

export default function SmsCenterPage() {
  const router = useRouter()
  const params = useParams()
  const basePath = params.slug ? `/c/${params.slug}` : ''
  const [sendTo, setSendTo] = useState<SendToType>('')
  const [mobileNo, setMobileNo] = useState('')
  const [receivers, setReceivers] = useState<Receiver[]>([])
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [smsEnabled, setSmsEnabled] = useState(false)

  useEffect(() => {
    checkSmsEnabled()
  }, [])

  const checkSmsEnabled = async () => {
    try {
      const res = await fetch('/api/sms-settings')
      if (res.ok) {
        const data = await res.json()
        setSmsEnabled(data.isEnabled && !!data.genericApiUrl)
      }
    } catch (error) {
      console.error('Failed to check SMS status:', error)
    }
  }

  const getReceiverList = async () => {
    if (!sendTo || sendTo === 'Manual Entry') return

    setLoading(true)
    setReceivers([])

    try {
      let endpoint = ''
      if (sendTo === 'All Customer') {
        endpoint = '/api/customers?all=true'
      } else if (sendTo === 'All Supplier') {
        endpoint = '/api/suppliers?all=true'
      } else if (sendTo === 'All Contact') {
        endpoint = '/api/customers?all=true' // Contacts from customers
      }

      const res = await fetch(endpoint)
      if (res.ok) {
        const data = await res.json()
        const items = Array.isArray(data) ? data : data.data || []
        const receiverList: Receiver[] = items
          .filter((item: { phone?: string | null }) => item.phone)
          .map((item: { phone: string; name?: string }) => ({
            mobile: item.phone,
            name: item.name || '',
          }))
        setReceivers(receiverList)
      }
    } catch (error) {
      console.error('Failed to fetch receivers:', error)
    } finally {
      setLoading(false)
    }
  }

  const addManualNumber = () => {
    if (!mobileNo.trim()) return
    const mobile = mobileNo.trim().replace(/\s+/g, '')
    if (!/^[\d+()-]+$/.test(mobile)) return
    if (receivers.some(r => r.mobile === mobile)) return

    setReceivers([...receivers, { mobile }])
    setMobileNo('')
  }

  const removeReceiver = (index: number) => {
    setReceivers(receivers.filter((_, i) => i !== index))
  }

  const handleSend = async () => {
    if (receivers.length === 0 || !message.trim()) return

    setSending(true)
    setResult(null)

    try {
      const res = await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'sms',
          recipients: receivers.map(r => ({
            contact: r.mobile,
            name: r.name,
            type: 'manual',
          })),
          smsContent: message,
        }),
      })

      const data = await res.json()
      console.log('Send SMS result:', data)

      if (data.totalSent > 0) {
        setResult({
          success: true,
          message: `Successfully sent ${data.totalSent} SMS${data.totalFailed > 0 ? `, ${data.totalFailed} failed` : ''}`,
        })
        if (data.totalFailed === 0) {
          setReceivers([])
          setMessage('')
        }
      } else {
        // Build error message from results
        const errorDetails = data.results
          ?.filter((r: { success: boolean }) => !r.success)
          ?.map((r: { recipient: string; errorMessage?: string }) => `${r.recipient}: ${r.errorMessage || 'Unknown error'}`)
          ?.join('; ')
        setResult({
          success: false,
          message: errorDetails || data.error || 'Failed to send SMS',
        })
      }
    } catch (error) {
      console.error('Send SMS error:', error)
      setResult({
        success: false,
        message: 'Failed to send notification. Check server logs.',
      })
    } finally {
      setSending(false)
    }
  }

  // Character and SMS count calculations
  const charCount = message.length
  const isUnicode = /[^\x00-\x7F]/.test(message)
  const segmentSize = isUnicode ? 70 : 160
  const multiSegmentSize = isUnicode ? 67 : 153
  const segments = charCount === 0 ? 0 : charCount <= segmentSize ? 1 : Math.ceil(charCount / multiSegmentSize)
  const totalSms = receivers.length * segments

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">SMS Center</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`${basePath}/settings/notifications/sms`}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            SMS Settings
          </Link>
          <Link
            href={`${basePath}/settings/notifications/sms-log`}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            SMS Log
          </Link>
        </div>
      </div>

      {!smsEnabled && (
        <Card className="p-4 mb-6 bg-yellow-50 border-yellow-200">
          <div className="flex items-center gap-2 text-yellow-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>SMS is not configured. Please configure SMS Settings first.</span>
          </div>
        </Card>
      )}

      <Card className="p-6 space-y-6">
        {/* Send To */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Send To</Label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
              value={sendTo}
              onChange={(e) => {
                setSendTo(e.target.value as SendToType)
                setReceivers([])
              }}
            >
              <option value="">Select...</option>
              <option value="All Customer">All Customer</option>
              <option value="All Supplier">All Supplier</option>
              <option value="All Contact">All Contact</option>
              <option value="Manual Entry">Manual Entry</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            {sendTo && sendTo !== 'Manual Entry' && (
              <Button onClick={getReceiverList} disabled={loading}>
                {loading ? 'Loading...' : 'Get Receiver List'}
              </Button>
            )}
          </div>
        </div>

        {/* Mobile No for Manual Entry */}
        {sendTo === 'Manual Entry' && (
          <div>
            <Label>Mobile No</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={mobileNo}
                onChange={(e) => setMobileNo(e.target.value)}
                placeholder="0771234567"
                onKeyDown={(e) => e.key === 'Enter' && addManualNumber()}
              />
              <Button onClick={addManualNumber}>Add</Button>
            </div>
          </div>
        )}

        {/* Receiver List */}
        <div>
          <Label>Receiver List</Label>
          <div className="mt-1 border rounded-md max-h-[200px] overflow-y-auto">
            {receivers.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                {sendTo ? 'No receivers. Click "Get Receiver List" or add manually.' : 'Select "Send To" first'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 w-8">#</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Mobile No</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {receivers.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2">{r.mobile}</td>
                      <td className="px-3 py-2 text-gray-500">{r.name || '-'}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeReceiver(i)} className="text-red-500 hover:text-red-700">&times;</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Message */}
        <div>
          <Label>Message</Label>
          <textarea
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter your message here..."
          />
        </div>

        {/* Stats */}
        <div className="flex gap-8 text-sm">
          <div>
            <span className="text-gray-500">Total Characters: </span>
            <span className="font-medium">{charCount}</span>
            {isUnicode && <span className="text-amber-600 ml-1">(Unicode)</span>}
          </div>
          <div>
            <span className="text-gray-500">Total Message(s): </span>
            <span className="font-medium">{segments}</span>
          </div>
          <div>
            <span className="text-gray-500">Total SMS: </span>
            <span className="font-medium">{totalSms}</span>
          </div>
        </div>

        {/* Result */}
        {result && (
          <div className={`p-3 rounded-md ${result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {result.message}
          </div>
        )}

        {/* Send Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSend}
            disabled={sending || !smsEnabled || receivers.length === 0 || !message.trim()}
          >
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

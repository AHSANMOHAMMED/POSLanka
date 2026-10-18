'use client'

import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { CheckCircle } from 'lucide-react'

export default function EmailSettingsPage() {
  const router = useRouter()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="text-gray-500 hover:text-gray-700"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Email Notifications</h1>
          <p className="text-gray-500">Email notifications are handled automatically by the platform</p>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded bg-green-100 flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Platform Email is Active</h3>
            <p className="text-sm text-gray-600 mt-1">
              All notification emails are sent automatically from your company address. No configuration is needed.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}

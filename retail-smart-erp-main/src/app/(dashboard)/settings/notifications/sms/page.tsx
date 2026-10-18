'use client'

import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { SmsSettingsForm } from '@/components/notifications'

export default function SmsSettingsPage() {
  const router = useRouter()
  const params = useParams()
  const basePath = params.slug ? `/c/${params.slug}` : ''

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">SMS Settings</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`${basePath}/settings/notifications/sms-center`}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            SMS Center
          </Link>
          <Link
            href={`${basePath}/settings/notifications/sms-log`}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            SMS Log
          </Link>
        </div>
      </div>

      <Card className="p-6">
        <SmsSettingsForm onSave={() => {}} />
      </Card>
    </div>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { NotificationLogTable } from '@/components/notifications'

export default function NotificationLogsPage() {
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
          <h1 className="text-2xl font-semibold text-gray-900">Message Logs</h1>
          <p className="text-gray-500">View history of sent SMS and email notifications</p>
        </div>
      </div>

      <NotificationLogTable />
    </div>
  )
}

'use client'

import { signOut } from 'next-auth/react'
import { BrandWordmark } from '@/components/ui/logo'
import { broadcastAuthEvent } from '@/lib/auth/events'

/** Staff of a shop whose owner has not finished the setup wizard: only the owner can finish it. */
export function SetupPendingNotice({ slug, businessName }: { slug: string; businessName: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <div className="mb-6 flex justify-center"><BrandWordmark height={44} /></div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{businessName} is still being set up</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          The owner has not finished the setup yet. Ask them to sign in and complete it, then sign in again.
        </p>
        <button
          type="button"
          onClick={async () => {
            broadcastAuthEvent('logout', 'company')
            await signOut({ redirect: false })
            window.location.assign(`/c/${slug}/login?logout=true`)
          }}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

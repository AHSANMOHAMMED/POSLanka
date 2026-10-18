'use client'

import { useEffect } from 'react'

function reportToApi(error: Error & { digest?: string }) {
  const url = typeof window !== 'undefined' ? window.location.href : ''
  const payload = {
    errors: [
      {
        message: error.message,
        stack: error.stack ?? undefined,
        url,
        timestamp: Date.now(),
      },
    ],
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  }
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportToApi(error)
  }, [error])

  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center max-w-md">
        An error occurred. It has been reported and we will look into it.
      </p>
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors text-sm font-medium"
      >
        Try again
      </button>
    </div>
  )
}

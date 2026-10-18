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

export default function GlobalError({
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
    <html lang="en">
      <body>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16, textAlign: 'center', maxWidth: 400 }}>
            An error occurred. It has been reported and we will look into it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ padding: '8px 16px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}

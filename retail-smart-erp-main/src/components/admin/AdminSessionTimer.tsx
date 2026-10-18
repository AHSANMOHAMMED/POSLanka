'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
const WARNING_THRESHOLD_MS = 2 * 60 * 1000 // Warn at 2 minutes remaining

export function AdminSessionTimer() {
  const router = useRouter()
  const [timeRemaining, setTimeRemaining] = useState(SESSION_TIMEOUT_MS)
  const [lastActivity, setLastActivity] = useState(() => Date.now())
  const [showWarning, setShowWarning] = useState(false)

  // Reset timer on user activity
  const resetTimer = useCallback(() => {
    setLastActivity(Date.now())
    setShowWarning(false)
  }, [])

  // Track user activity
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']

    events.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true })
    })

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, resetTimer)
      })
    }
  }, [resetTimer])

  // Update countdown
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivity
      const remaining = Math.max(0, SESSION_TIMEOUT_MS - elapsed)
      setTimeRemaining(remaining)

      // Show warning when 2 minutes remaining
      if (remaining <= WARNING_THRESHOLD_MS && remaining > 0) {
        setShowWarning(true)
      }

      // Auto-logout when session expires
      if (remaining <= 0) {
        router.push('/sys-control/login?session=expired')
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [lastActivity, router])

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const isWarning = timeRemaining <= WARNING_THRESHOLD_MS

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
          isWarning
            ? 'bg-red-500/20 text-red-300'
            : 'bg-gray-700 text-gray-400'
        }`}
      >
        {isWarning ? (
          <AlertTriangle className="w-3 h-3" />
        ) : (
          <Clock className="w-3 h-3" />
        )}
        <span>{formatTime(timeRemaining)}</span>
      </div>

      {/* Warning Modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-md p-6 max-w-sm mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Session Expiring</h3>
                <p className="text-sm text-gray-500">
                  {formatTime(timeRemaining)} remaining
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Your admin session will expire due to inactivity. Click anywhere or press any key to stay logged in.
            </p>
            <button
              onClick={resetTimer}
              className="w-full px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors"
            >
              Stay Logged In
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

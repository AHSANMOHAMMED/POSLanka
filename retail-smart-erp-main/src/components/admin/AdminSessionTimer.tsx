'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Clock } from 'lucide-react'
import { AdminModal, Button } from './kit'
import { cn } from '@/lib/utils'

const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // sign out after 15 minutes without input
const WARNING_THRESHOLD_MS = 2 * 60 * 1000

export async function signOutAdmin(reason?: 'expired') {
  try {
    await fetch('/api/sys-control/auth/logout', { method: 'POST', redirect: 'manual' })
  } catch {
    // ignore — we navigate away regardless
  }
  window.location.href = reason ? `/sys-control/login?session=${reason}` : '/sys-control/login'
}

function formatTime(ms: number) {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Inactivity timer: shows the remaining idle time, warns at 2 minutes, signs out at 0. */
export function AdminSessionTimer({ className }: { className?: string }) {
  const lastActivity = useRef(0)
  const [timeRemaining, setTimeRemaining] = useState(SESSION_TIMEOUT_MS)
  const [warningOpen, setWarningOpen] = useState(false)
  const expired = useRef(false)

  const resetTimer = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  useEffect(() => {
    lastActivity.current = Date.now()
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, SESSION_TIMEOUT_MS - (Date.now() - lastActivity.current))
      setTimeRemaining(remaining)
      setWarningOpen(remaining > 0 && remaining <= WARNING_THRESHOLD_MS)
      if (remaining <= 0 && !expired.current) {
        expired.current = true
        signOutAdmin('expired')
      }
    }, 1000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer))
      window.clearInterval(interval)
    }
  }, [resetTimer])

  const warning = timeRemaining <= WARNING_THRESHOLD_MS

  return (
    <>
      <span
        title="Signs out automatically after 15 minutes without activity"
        className={cn(
          'adm-num inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium',
          warning ? 'bg-adm-danger-soft text-adm-danger' : 'text-adm-muted',
          className
        )}
      >
        <Clock size={14} aria-hidden />
        <span className="sr-only">Idle sign-out in </span>
        {formatTime(timeRemaining)}
      </span>
      <AdminModal
        open={warningOpen}
        onClose={resetTimer}
        size="sm"
        title="Still there?"
        description={`You'll be signed out in ${formatTime(timeRemaining)} because of inactivity.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => signOutAdmin()}>Sign out now</Button>
            <Button variant="primary" onClick={() => { resetTimer(); setWarningOpen(false) }}>Stay signed in</Button>
          </>
        }
      />
    </>
  )
}

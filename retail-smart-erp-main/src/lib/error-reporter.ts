/**
 * Client-side error reporter.
 * Captures unhandled JS errors and promise rejections,
 * batches them, deduplicates, and sends to /api/client-errors.
 */

interface CapturedError {
  message: string
  stack?: string
  url: string
  componentStack?: string
  timestamp: number
}

let errorBatch: CapturedError[] = []
let batchTimer: ReturnType<typeof setTimeout> | null = null
let reportCount = 0
let lastReportMinute = 0
const MAX_REPORTS_PER_MINUTE = 10
const BATCH_DELAY_MS = 2000
const MAX_FINGERPRINTS = 500
const seenFingerprints = new Set<string>()
let initialized = false

function fingerprint(message: string, stack?: string): string {
  const firstLine = stack?.split('\n').find(l => l.trim().startsWith('at '))?.trim() || ''
  return `${message}::${firstLine}`
}

function shouldReport(): boolean {
  const now = Math.floor(Date.now() / 60000)
  if (now !== lastReportMinute) {
    lastReportMinute = now
    reportCount = 0
  }
  if (reportCount >= MAX_REPORTS_PER_MINUTE) return false
  reportCount++
  return true
}

function queueError(error: CapturedError) {
  const fp = fingerprint(error.message, error.stack)
  if (seenFingerprints.has(fp)) return
  if (seenFingerprints.size >= MAX_FINGERPRINTS) {
    seenFingerprints.clear()
  }
  seenFingerprints.add(fp)

  if (!shouldReport()) return

  errorBatch.push(error)

  if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, BATCH_DELAY_MS)
  }
}

async function flushBatch() {
  batchTimer = null
  if (errorBatch.length === 0) return

  const batch = [...errorBatch]
  errorBatch = []

  try {
    await fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errors: batch,
        userAgent: navigator.userAgent,
        browserInfo: {
          language: navigator.language,
          platform: navigator.platform,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        },
      }),
      keepalive: true,
    })
  } catch {
    // Silently fail — don't create infinite error loops
  }
}

/**
 * Manually report an error from component code.
 */
export function reportError(error: Error, componentStack?: string) {
  queueError({
    message: error.message,
    stack: error.stack,
    url: typeof window !== 'undefined' ? window.location.href : '',
    componentStack,
    timestamp: Date.now(),
  })
}

/**
 * Initialize global error handlers. Call once on app mount.
 */
export function initErrorCapture() {
  if (typeof window === 'undefined') return
  if (initialized) return
  initialized = true

  // Capture unhandled JS errors
  const originalOnError = window.onerror
  window.onerror = function (message, source, lineno, colno, error) {
    queueError({
      message: typeof message === 'string' ? message : 'Unknown error',
      stack: error?.stack || `at ${source}:${lineno}:${colno}`,
      url: window.location.href,
      timestamp: Date.now(),
    })
    if (typeof originalOnError === 'function') {
      return originalOnError(message, source, lineno, colno, error)
    }
    return false
  }

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    queueError({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      url: window.location.href,
      timestamp: Date.now(),
    })
  })

  // Flush batch on page unload
  window.addEventListener('beforeunload', () => {
    if (errorBatch.length > 0) {
      flushBatch()
    }
  })
}

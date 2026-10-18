import { useState, useCallback } from 'react'
import type { SmartWarning } from '@/lib/ai/smart-warnings'

export function useSmartWarnings(action: string) {
  const [warnings, setWarnings] = useState<SmartWarning[]>([])
  const [loading, setLoading] = useState(false)

  const checkWarnings = useCallback(async (data: unknown): Promise<SmartWarning[]> => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/validate-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      })
      if (res.ok) {
        const result = await res.json()
        const w = result.warnings || []
        setWarnings(w)
        return w
      }
    } catch {
      // Silently fail — don't block the user
    } finally {
      setLoading(false)
    }
    setWarnings([])
    return []
  }, [action])

  const clearWarnings = useCallback(() => setWarnings([]), [])

  return { warnings, loading, checkWarnings, clearWarnings }
}

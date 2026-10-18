'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Detect iOS platform (stable — never changes during session)
function getIsIOS(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Detect standalone mode (already installed)
function getIsStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
}

// Subscribe to nothing — snapshot never changes
function subscribeNoop(cb: () => void) {
  void cb
  return () => {}
}

/**
 * Hook to handle PWA install prompt.
 * - Chrome/Edge: captures `beforeinstallprompt` event for native install dialog
 * - iOS Safari: detects platform for "Add to Home Screen" instructions
 * - Detects if already running in standalone (installed) mode
 */
export function useInstallPrompt() {
  // Stable platform detections (SSR-safe via useSyncExternalStore)
  const isIOS = useSyncExternalStore(subscribeNoop, getIsIOS, () => false)
  const isStandalone = useSyncExternalStore(subscribeNoop, getIsStandalone, () => false)

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const listenersAttachedRef = useRef(false)

  useEffect(() => {
    if (isStandalone || isIOS || listenersAttachedRef.current) return
    listenersAttachedRef.current = true

    const handlePrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    const handleInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [isStandalone, isIOS])

  const install = useCallback(async () => {
    if (!deferredPrompt) return false
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    if (outcome === 'accepted') {
      setIsInstalled(true)
    }
    return outcome === 'accepted'
  }, [deferredPrompt])

  // Derived state
  const alreadyInstalled = isStandalone || isInstalled
  const canInstall = !alreadyInstalled && (isIOS || deferredPrompt !== null)

  return { canInstall, isInstalled: alreadyInstalled, isIOS, install }
}

'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, Share, Bookmark, ExternalLink, Globe } from 'lucide-react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

function subscribeNoop(cb: () => void) { void cb; return () => {} }
function getIsStandalone() {
  return typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
}
function getIsIOSSafari() {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIOS) return false
  // On iOS, Safari doesn't have CriOS (Chrome), FxiOS (Firefox), EdgiOS (Edge) etc in UA
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

export function InstallPromptPopup() {
  const { isInstalled, isIOS, install, canInstall } = useInstallPrompt()
  const isStandalone = useSyncExternalStore(subscribeNoop, getIsStandalone, () => false)
  const isSafari = useSyncExternalStore(subscribeNoop, getIsIOSSafari, () => false)
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isStandalone || isInstalled) return
    const timer = setTimeout(() => setVisible(true), 2000)
    return () => clearTimeout(timer)
  }, [isStandalone, isInstalled])

  if (!mounted || isStandalone || isInstalled) return null

  const handleDismiss = () => {
    setVisible(false)
  }

  const handleInstall = async () => {
    const accepted = await install()
    if (accepted) {
      setVisible(false)
    }
  }

  return createPortal(
    <div
      className={`fixed bottom-6 right-6 z-50 w-80 max-w-[calc(100vw-3rem)] transition-all duration-300 ease-out ${
        visible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-8 opacity-0 pointer-events-none'
      }`}
    >
      <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 p-5">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="w-12 h-12 rounded-md bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <Download size={22} className="text-emerald-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">
              Install skyERPOS
            </h3>

            {isIOS && isSafari ? (
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Tap <Share size={12} className="inline text-zinc-300 mx-0.5" /> then
                <span className="text-zinc-300 font-medium"> &quot;Add to Home Screen&quot;</span>
              </p>
            ) : isIOS && !isSafari ? (
              <div className="mt-1.5 space-y-2">
                <div className="flex items-start gap-2">
                  <Globe size={13} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Open in <span className="text-zinc-300 font-medium">Safari</span> to install this app on your home screen
                  </p>
                </div>
              </div>
            ) : canInstall ? (
              <>
                <p className="text-xs text-zinc-400 mt-1">
                  Quick access from your home screen
                </p>
                <button
                  onClick={handleInstall}
                  className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded transition-colors w-full"
                >
                  Install App
                </button>
              </>
            ) : (
              <div className="mt-1.5 space-y-2">
                <div className="flex items-start gap-2">
                  <Bookmark size={13} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    <span className="text-zinc-300 font-medium">Bookmark</span> this page for quick access
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <ExternalLink size={13} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    <span className="text-zinc-300 font-medium">Create a shortcut</span> from your browser menu
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

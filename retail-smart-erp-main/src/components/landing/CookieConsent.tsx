'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cookie } from 'lucide-react'

const STORAGE_KEY = 'cookie-consent'
const PREFS_KEY = 'cookie-preferences'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem(STORAGE_KEY)
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  function handleAccept() {
    const prefs = { essential: true, analytics: true, marketing: true }
    localStorage.setItem(STORAGE_KEY, 'accepted')
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    window.dispatchEvent(new CustomEvent('cookie-consent-change', { detail: { state: 'accepted', preferences: prefs } }))
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed bottom-0 left-0 right-0 z-[100] p-4 sm:p-6"
        >
          <div className="max-w-4xl mx-auto rounded-2xl border border-white/20 bg-zinc-900/90 backdrop-blur-xl shadow-2xl shadow-black/30 overflow-hidden">
            {/* Main banner */}
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-md bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
                  <Cookie className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-white mb-1">We use cookies</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    This website uses cookies to enhance your browsing experience and analyze site traffic.
                    By continuing to use this site, you agree to our use of cookies.{' '}
                    <a href="/privacy" className="text-emerald-400 hover:underline font-medium">Privacy Policy</a>
                  </p>
                </div>
              </div>

              {/* Button */}
              <div className="mt-5">
                <button
                  onClick={handleAccept}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

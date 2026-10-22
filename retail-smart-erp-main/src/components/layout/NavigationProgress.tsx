'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

interface BarState {
  bar: HTMLDivElement | null
  started: boolean
  safety: ReturnType<typeof setTimeout> | null
}

function finishBar(s: BarState) {
  if (!s.bar || !s.started) return
  s.started = false
  if (s.safety) clearTimeout(s.safety)
  s.bar.style.transition = 'transform 150ms ease-out, opacity 250ms ease 150ms'
  s.bar.style.transform = 'scaleX(1)'
  s.bar.style.opacity = '0'
}

function startBar(s: BarState) {
  const bar = s.bar
  if (!bar || s.started) return
  s.started = true
  bar.style.transition = 'none'
  bar.style.opacity = '1'
  bar.style.transform = 'scaleX(0)'
  // Next frame: crawl towards 85 % (never completes on its own)
  requestAnimationFrame(() => {
    bar.style.transition = 'transform 8s cubic-bezier(0.1, 0.7, 0.2, 1)'
    bar.style.transform = 'scaleX(0.85)'
  })
  if (s.safety) clearTimeout(s.safety)
  s.safety = setTimeout(() => finishBar(s), 20_000)
}

/**
 * Thin progress bar at the top of the window that starts the instant an in-app link is clicked
 * (or the browser goes back/forward) and finishes when the new route has rendered. Without it a
 * click gave no feedback until the next page arrived — up to several seconds in `next dev` while
 * a route compiles for the first time.
 */
export function NavigationProgress() {
  const pathname = usePathname()
  const barRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<BarState>({ bar: null, started: false, safety: null })

  useEffect(() => {
    const s = stateRef.current
    s.bar = barRef.current

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Same page (or only the hash changes): nothing will load
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      startBar(s)
    }
    const onPopState = () => startBar(s)

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  // The route changed and rendered: complete and fade out
  useEffect(() => {
    finishBar(stateRef.current)
  }, [pathname])

  return (
    <div
      ref={barRef}
      aria-hidden="true"
      className="fixed left-0 top-0 z-[9999] h-[3px] w-full origin-left pointer-events-none"
      style={{ backgroundColor: 'var(--primary)', opacity: 0, transform: 'scaleX(0)' }}
    />
  )
}

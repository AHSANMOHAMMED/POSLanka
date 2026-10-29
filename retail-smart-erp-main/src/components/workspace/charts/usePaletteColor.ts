'use client'

import { useEffect, useState } from 'react'

/** Mix a #rrggbb colour with white (amount 0..1 of white). */
function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const ch = (i: number) => Math.round(parseInt(m[i], 16) + (255 - parseInt(m[i], 16)) * amount).toString(16).padStart(2, '0')
  return `#${ch(1)}${ch(2)}${ch(3)}`
}

function read(): { primary: string; light: string } {
  if (typeof document === 'undefined') return { primary: '#2563eb', light: '#60a5fa' }
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2563eb'
  return { primary, light: lighten(primary, 0.4) }
}

/**
 * The palette's primary colour (Settings → Appearance) for chart series 1, re-read when the palette or
 * light / dark mode changes, so charts follow the chosen look.
 */
export function usePaletteColor(): { primary: string; light: string } {
  const [c, setC] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setC(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => obs.disconnect()
  }, [])
  return c
}

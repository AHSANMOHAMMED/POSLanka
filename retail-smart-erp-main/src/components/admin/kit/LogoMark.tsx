'use client'

import { useId } from 'react'

/**
 * POSLanka storefront mark (same artwork as components/ui/logo) with a per-instance
 * gradient id, so several marks on one page — some inside display:none containers —
 * never lose their fill.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = `plg-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <path
        d="M14 28c0-2 1-4 4-4h28c3 0 4 2 4 4v1c0 3-2.5 5-5.5 5S40 32 40 29c0 3-2.5 5-5.5 5S30 31 30 29c0 3-3 5-6 5s-6-2-6-5v-1z"
        fill="rgba(255,255,255,0.95)"
      />
      <rect x="18" y="33" width="28" height="16" rx="2" fill="rgba(255,255,255,0.85)" />
      <rect x="27" y="38" width="10" height="11" rx="1.5" fill={`url(#${id})`} opacity="0.7" />
      <rect x="20.5" y="36" width="5" height="5" rx="1" fill={`url(#${id})`} opacity="0.35" />
      <path d="M44 18a8 8 0 0 1 0 8" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M48 15a13 13 0 0 1 0 14" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="43" cy="22" r="2" fill="rgba(255,255,255,0.95)" />
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0d9488" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
    </svg>
  )
}

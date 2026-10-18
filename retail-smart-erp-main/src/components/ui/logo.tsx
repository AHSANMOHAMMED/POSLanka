/**
 * POSLanka Logo Component
 *
 * Usage:
 *   <Logo />                        — Icon only, default 32px
 *   <Logo variant="full" />         — Icon + "POSLanka" text
 *   <Logo size={48} />              — Custom size
 *   <Logo onDark />                 — White text for dark backgrounds
 *   <Logo variant="full" subtitle="Point of Sale System" />
 */

interface LogoProps {
  /** "icon" = mark only, "full" = mark + wordmark */
  variant?: 'icon' | 'full'
  /** Icon size in pixels (text scales proportionally) */
  size?: number
  /** Use white text (for dark/image backgrounds) */
  onDark?: boolean
  /** Optional subtitle below the name */
  subtitle?: string
  className?: string
}

/** The SVG icon mark — a stylized storefront with a smart pulse */
function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Rounded square background */}
      <rect width="64" height="64" rx="16" fill="url(#logo-grad)" />

      {/* Storefront awning */}
      <path
        d="M14 28c0-2 1-4 4-4h28c3 0 4 2 4 4v1c0 3-2.5 5-5.5 5S40 32 40 29c0 3-2.5 5-5.5 5S30 31 30 29c0 3-3 5-6 5s-6-2-6-5v-1z"
        fill="rgba(255,255,255,0.95)"
      />

      {/* Store body */}
      <rect x="18" y="33" width="28" height="16" rx="2" fill="rgba(255,255,255,0.85)" />

      {/* Door */}
      <rect x="27" y="38" width="10" height="11" rx="1.5" fill="url(#logo-grad)" opacity="0.7" />

      {/* Window left */}
      <rect x="20.5" y="36" width="5" height="5" rx="1" fill="url(#logo-grad)" opacity="0.35" />

      {/* Smart pulse / signal arcs (top-right) — represents "smart" */}
      <path
        d="M44 18a8 8 0 0 1 0 8"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M48 15a13 13 0 0 1 0 14"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Dot for signal origin */}
      <circle cx="43" cy="22" r="2" fill="rgba(255,255,255,0.95)" />

      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0d9488" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function Logo({
  variant = 'icon',
  size = 32,
  onDark = false,
  subtitle,
  className = '',
}: LogoProps) {
  if (variant === 'icon') {
    return (
      <span className={className}>
        <LogoMark size={size} />
      </span>
    )
  }

  // Full variant — icon + wordmark
  const textSize = size >= 40 ? 'text-xl' : size >= 32 ? 'text-base' : 'text-sm'
  const subSize = size >= 40 ? 'text-sm' : 'text-xs'

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="flex flex-col leading-tight">
        <span className={`font-bold tracking-tight ${textSize} ${onDark ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
          POSLanka
        </span>
        {subtitle && (
          <span className={`${subSize} ${onDark ? 'text-white/60' : 'text-slate-500 dark:text-slate-400'}`}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  )
}

export default Logo

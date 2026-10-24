/**
 * skyERPOS logo (artwork: public/brand/skyerpos-logo.png, square icon: public/icons/icon-*.png).
 *
 * Usage:
 *   <Logo />                        — square icon, default 32px
 *   <Logo variant="full" />         — the skyERPOS wordmark (height = size)
 *   <Logo onDark />                 — wordmark on a white badge for dark backgrounds
 *   <Logo variant="full" subtitle="Point of Sale System" />
 */

interface LogoProps {
  /** "icon" = square icon, "full" = wordmark */
  variant?: 'icon' | 'full'
  /** Height in pixels */
  size?: number
  /** Dark / image background: the wordmark sits on a white badge so its blue stays readable */
  onDark?: boolean
  /** Optional subtitle below the logo */
  subtitle?: string
  className?: string
}

/** The wordmark image; width follows the artwork's aspect ratio (403 × 184). */
export function BrandWordmark({ height = 32, onDark = false, className = '' }: { height?: number; onDark?: boolean; className?: string }) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset, sized by height
    <img
      src="/brand/skyerpos-logo.png"
      srcSet="/brand/skyerpos-logo.png 1x, /brand/skyerpos-logo@2x.png 2x"
      alt="skyERPOS"
      height={height}
      width={Math.round((height * 403) / 184)}
      style={{ height, width: 'auto' }}
      className={onDark ? undefined : className}
      draggable={false}
    />
  )
  return onDark ? <span className={`inline-flex items-center rounded-lg bg-white px-2 py-1 shadow-sm ${className}`}>{img}</span> : img
}

/** The square app icon (favicon / launcher artwork). */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset
    <img src="/icons/icon-192.png" alt="" aria-hidden="true" width={size} height={size} className={`rounded-[22%] ${className}`} draggable={false} />
  )
}

export function Logo({ variant = 'icon', size = 32, onDark = false, subtitle, className = '' }: LogoProps) {
  if (variant === 'icon') {
    return (
      <span className={className}>
        <LogoMark size={size} />
      </span>
    )
  }
  const subSize = size >= 40 ? 'text-sm' : 'text-xs'
  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <BrandWordmark height={size} onDark={onDark} />
      {subtitle && <span className={`${subSize} ${onDark ? 'text-white/70' : 'text-slate-500 dark:text-slate-400'}`}>{subtitle}</span>}
    </span>
  )
}

export default Logo

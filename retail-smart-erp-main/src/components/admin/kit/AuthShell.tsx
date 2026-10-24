import type { ReactNode } from 'react'
import Link from 'next/link'
import { Boxes, Check, Printer, ScanBarcode, Wallet } from 'lucide-react'
import { BrandWordmark } from '@/components/ui/logo'
import { cn } from '@/lib/utils'

/** skyERPOS wordmark (on a white badge over the brand panel), with an optional subtitle. */
export function BrandMark({ onBrand, subtitle, size = 40, href }: { onBrand?: boolean; subtitle?: string; size?: number; href?: string }) {
  const inner = (
    <span className="inline-flex flex-col items-start gap-1.5">
      <BrandWordmark height={Math.round(size * 1.25)} onDark={onBrand} />
      {subtitle && <span className={cn('text-[12px]', onBrand ? 'text-white/75' : 'text-adm-subtle')}>{subtitle}</span>}
    </span>
  )
  return href ? <Link href={href} className="adm-focus rounded-md">{inner}</Link> : inner
}

/**
 * skyERPOS waves: layered blue waves with the logo's orange swoosh, drifting slowly (still when the
 * visitor prefers reduced motion). `tone="onBlue"` sits on the blue brand panel; "onLight" under a
 * light page.
 */
export function AuthWaves({ tone = 'onBlue', className }: { tone?: 'onBlue' | 'onLight'; className?: string }) {
  const onBlue = tone === 'onBlue'
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden', className)}>
      <svg className="adm-wave adm-wave--slow block h-[120px] w-[200%] sm:h-[160px]" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0 200 C 240 120 480 120 720 200 C 960 280 1200 280 1440 200 C 1680 120 1920 120 2160 200 C 2400 280 2640 280 2880 200 V320 H0Z" fill={onBlue ? 'rgba(255,255,255,0.08)' : 'rgba(0,80,192,0.06)'} />
      </svg>
      <svg className="adm-wave block -mt-[100px] h-[110px] w-[200%] sm:-mt-[136px] sm:h-[140px]" viewBox="0 0 2880 320" preserveAspectRatio="none">
        <path d="M0 232 C 240 292 480 292 720 232 C 960 172 1200 172 1440 232 C 1680 292 1920 292 2160 232 C 2400 172 2640 172 2880 232 V320 H0Z" fill={onBlue ? 'rgba(255,255,255,0.12)' : 'rgba(0,80,192,0.08)'} />
        <path d="M0 222 C 240 282 480 282 720 222 C 960 162 1200 162 1440 222 C 1680 282 1920 282 2160 222 C 2400 162 2640 162 2880 222" fill="none" stroke="#F87000" strokeWidth="6" strokeLinecap="round" opacity={onBlue ? 0.9 : 0.55} />
      </svg>
    </div>
  )
}

/** The poster's equipment line-up, as chips on the brand panel */
const BRAND_POINTS: Array<{ icon: typeof Check; text: string }> = [
  { icon: ScanBarcode, text: 'Barcode scanners & weighing scales' },
  { icon: Printer, text: 'Thermal receipts, WhatsApp bills' },
  { icon: Wallet, text: 'Cash drawer, shifts & day-end' },
  { icon: Boxes, text: 'Stock, purchasing & branches' },
]

/**
 * Brand panel shown on the left of sign-in pages (lg+): the skyERPOS logo, headline and waves.
 * Pass your own children (e.g. the company name/logo on the staff login) or use the default copy.
 */
export function AuthBrandPanel({ children, footer, className }: { children?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative hidden overflow-hidden lg:flex lg:w-[50%] xl:w-[48%] flex-col justify-between p-10 xl:p-14 text-white',
        className
      )}
      style={{ background: 'radial-gradient(120% 90% at 0% 0%, #1666e0 0%, var(--adm-brand-from) 38%, var(--adm-brand-to) 100%)' }}
    >
      {/* Orange swoosh arc behind the copy, echoing the logo */}
      <svg aria-hidden className="pointer-events-none absolute -right-28 -top-36 h-[360px] w-[560px]" viewBox="0 0 560 360" fill="none">
        <path d="M40 300 C 200 360 470 300 540 120" stroke="#F87000" strokeOpacity="0.85" strokeWidth="12" strokeLinecap="round" />
      </svg>
      <div aria-hidden className="pointer-events-none absolute -left-32 bottom-24 h-80 w-80 rounded-full bg-[#1666e0] opacity-30 blur-3xl" />
      <div className="relative">
        <Link href="/" className="adm-focus inline-flex rounded-2xl bg-white px-5 py-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)]">
          <BrandWordmark height={64} />
        </Link>
      </div>
      <div className="relative">{children ?? <DefaultBrandCopy />}</div>
      <div className="relative z-10 mb-24 text-[13px] text-white/75">{footer ?? <>© {new Date().getFullYear()} skyERPOS · Made for Sri Lankan businesses</>}</div>
      <AuthWaves />
    </div>
  )
}

function DefaultBrandCopy() {
  return (
    <div className="max-w-lg">
      <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[12.5px] font-medium text-white/90 ring-1 ring-white/20">
        <span className="h-1.5 w-1.5 rounded-full bg-[#F87000]" /> All-in-one POS & ERP
      </p>
      <h2 className="text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-white xl:text-[42px]">
        Powerful. Reliable.<br />
        <span className="text-[#FFB067]">Complete POS solution</span> for your business.
      </h2>
      <ul className="mt-8 grid grid-cols-2 gap-3">
        {BRAND_POINTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 rounded-xl bg-white/10 px-3.5 py-3 text-[13.5px] leading-snug text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#0050C0]">
              <Icon size={18} aria-hidden />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface AuthShellProps {
  /** Left panel (desktop only). Defaults to <AuthBrandPanel />. Pass `null` for a centred single-column page. */
  aside?: ReactNode | null
  /** Extra line under the skyERPOS logo in the phone / single-column header (e.g. the shop's name). */
  mobileHeader?: ReactNode
  /** Small print under the form. */
  footer?: ReactNode
  /** Max width of the form column. */
  width?: 'sm' | 'md'
  children: ReactNode
}

/**
 * Full-page frame for every sign-in style page: brand panel on the left (lg+), the form on a white
 * card on the right. Phones (and pages without the panel) get a blue wave header with the logo and
 * the card overlapping it. Follows the light/dark theme.
 */
export function AuthShell({ aside, mobileHeader, footer, width = 'sm', children }: AuthShellProps) {
  const hasAside = aside !== null
  return (
    <div className="adm-root relative flex min-h-[100dvh] w-full bg-[#f3f6fc] dark:bg-adm-bg">
      {hasAside && (aside ?? <AuthBrandPanel />)}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Blue wave header: phones, and pages without the brand panel */}
        <div
          className={cn('relative overflow-hidden px-4 pb-32 pt-9 text-center sm:pb-36', hasAside ? 'lg:hidden' : 'lg:pb-44 lg:pt-14')}
          style={{ background: 'radial-gradient(120% 120% at 0% 0%, #1666e0 0%, var(--adm-brand-from) 45%, var(--adm-brand-to) 100%)' }}
        >
          <div className="relative z-10 flex flex-col items-center gap-2.5">
            <Link href="/" className="adm-focus inline-flex rounded-2xl bg-white px-4 py-2.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]">
              <BrandWordmark height={48} />
            </Link>
            {mobileHeader
              ? <div className="rounded-xl bg-white/95 px-3.5 py-2 text-left shadow-sm">{mobileHeader}</div>
              : <span className="text-[13px] font-medium text-white/85">Powerful. Reliable. Complete POS solution.</span>}
          </div>
          <AuthWaves />
        </div>
        {hasAside && <AuthWaves tone="onLight" className="hidden lg:block" />}
        <div className={cn('relative z-10 -mt-14 flex flex-1 items-start justify-center px-4 pb-10 sm:-mt-16 sm:px-8', hasAside && 'lg:mt-0 lg:items-center lg:py-12')}>
          <div className={cn('adm-fade-in w-full', width === 'md' ? 'max-w-[480px]' : 'max-w-[420px]')}>
            <div className="rounded-2xl border border-adm-border bg-adm-surface p-6 shadow-[0_20px_60px_-24px_rgba(0,48,128,0.35)] sm:p-8">
              <div className="-mx-6 -mt-6 mb-6 h-1.5 rounded-t-2xl bg-gradient-to-r from-[#0050C0] via-[#1666e0] to-[#F87000] sm:-mx-8 sm:-mt-8" aria-hidden />
              {children}
            </div>
            {footer && <div className="mt-6 text-center text-[12.5px] text-adm-subtle">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  )
}

/** Title + description block at the top of an auth form. */
export function AuthHeading({ title, description, className }: { title: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6', className)}>
      <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-adm-fg">{title}</h1>
      {description && <p className="mt-1.5 text-[14px] text-adm-muted">{description}</p>}
    </div>
  )
}

/** Horizontal rule with centred text ("or"). */
export function Divider({ children }: { children?: ReactNode }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[12.5px] text-adm-subtle">
      <span className="h-px flex-1 bg-adm-border" />
      {children}
      {children && <span className="h-px flex-1 bg-adm-border" />}
    </div>
  )
}

const resultTone = {
  success: 'bg-adm-success-soft text-adm-success',
  warning: 'bg-adm-warning-soft text-adm-warning',
  danger: 'bg-adm-danger-soft text-adm-danger',
  info: 'bg-adm-primary-soft text-adm-primary-soft-fg',
} as const

/** Outcome screen for auth flows (email sent, password changed, invalid link…). */
export function AuthResult({
  icon,
  tone = 'success',
  title,
  description,
  children,
}: {
  icon: ReactNode
  tone?: keyof typeof resultTone
  title: ReactNode
  description?: ReactNode
  /** Buttons / links, stacked full width. */
  children?: ReactNode
}) {
  return (
    <div className="text-center">
      <span className={cn('mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full', resultTone[tone])}>{icon}</span>
      <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-adm-fg">{title}</h1>
      {description && <p className="mt-2 text-[14px] leading-relaxed text-adm-muted">{description}</p>}
      {children && <div className="mt-6 space-y-2.5">{children}</div>}
    </div>
  )
}

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
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
 * Brand panel shown on the left of sign-in pages (lg+). Pass your own children
 * (e.g. the company name/logo on the staff login) or use the default product copy.
 */
export function AuthBrandPanel({ children, footer, className }: { children?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative hidden overflow-hidden lg:flex lg:w-[46%] xl:w-[44%] flex-col justify-between p-10 xl:p-12 text-white',
        className
      )}
      style={{ background: 'linear-gradient(150deg, var(--adm-brand-from) 0%, var(--adm-brand-to) 100%)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '28px 28px' }}
      />
      <div className="relative">
        <BrandMark onBrand size={52} subtitle="All-in-one POS & ERP" href="/" />
      </div>
      <div className="relative">{children ?? <DefaultBrandCopy />}</div>
      <div className="relative text-[13px] text-white/65">{footer ?? <>© {new Date().getFullYear()} skyERPOS · Made for Sri Lankan businesses</>}</div>
    </div>
  )
}

function DefaultBrandCopy() {
  const points = [
    'Fast billing with barcode scanners, receipts and cash drawers',
    'Stock, purchasing and suppliers across all your branches',
    'LKR pricing, Sinhala support and WhatsApp receipts',
    'Every company’s data kept separate and private',
  ]
  return (
    <div className="max-w-md">
      <h2 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-white xl:text-[34px]">
        Powerful. Reliable.<br />Complete POS solution for your business.
      </h2>
      <ul className="mt-7 space-y-3">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-3 text-[14.5px] text-white/85">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
              <Check size={13} aria-hidden />
            </span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface AuthShellProps {
  /** Left panel (desktop only). Defaults to <AuthBrandPanel />. Pass `null` for a centred single-column page. */
  aside?: ReactNode | null
  /** Header shown above the form on phones / when there is no aside (defaults to the skyERPOS mark). */
  mobileHeader?: ReactNode
  /** Small print under the form. */
  footer?: ReactNode
  /** Max width of the form column. */
  width?: 'sm' | 'md'
  children: ReactNode
}

/**
 * Full-page frame for every sign-in style page: brand panel on the left (lg+),
 * form column on the right. Single column on phones. Follows the light/dark theme.
 */
export function AuthShell({ aside, mobileHeader, footer, width = 'sm', children }: AuthShellProps) {
  const hasAside = aside !== null
  return (
    <div className="adm-root flex min-h-[100dvh] w-full">
      {hasAside && (aside ?? <AuthBrandPanel />)}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:px-8 sm:py-12">
          <div className={cn('adm-fade-in w-full', width === 'md' ? 'max-w-[480px]' : 'max-w-[400px]')}>
            <div className={cn('mb-8', hasAside && 'lg:hidden')}>{mobileHeader ?? <BrandMark href="/" />}</div>
            {children}
            {footer && <div className="mt-8 text-center text-[12.5px] text-adm-subtle">{footer}</div>}
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

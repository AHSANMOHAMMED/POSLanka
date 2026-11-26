'use client'

import { FadeIn } from './motion'

interface SectionHeadingProps {
  badge?: string
  title: string
  highlight?: string
  subtitle?: string
  align?: 'center' | 'left'
  className?: string
  gradientClass?: string
}

export default function SectionHeading({
  badge,
  title,
  highlight,
  subtitle,
  align = 'center',
  className = '',
  gradientClass = 'gradient-text-brand',
}: SectionHeadingProps) {
  let titleParts: { before: string; highlighted: string; after: string } | null = null
  if (highlight && title.includes(highlight)) {
    const idx = title.indexOf(highlight)
    titleParts = {
      before: title.slice(0, idx),
      highlighted: highlight,
      after: title.slice(idx + highlight.length),
    }
  }

  return (
    <FadeIn className={`max-w-3xl ${align === 'center' ? 'mx-auto text-center' : ''} mb-14 ${className}`}>
      {badge && (
        <span className="inline-block px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-full bg-[#e8effb] text-[#0050c0] border border-[#0050c0]/20 mb-5">
          {badge}
        </span>
      )}
      <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-tight text-[#0f172a] tracking-tight">
        {titleParts ? (
          <>
            {titleParts.before}
            <span className={gradientClass}>
              {titleParts.highlighted}
            </span>
            {titleParts.after}
          </>
        ) : title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-lg text-[#556070] leading-relaxed max-w-2xl mx-auto">
          {subtitle}
        </p>
      )}
    </FadeIn>
  )
}

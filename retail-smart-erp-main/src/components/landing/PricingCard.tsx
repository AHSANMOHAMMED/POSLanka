'use client'

import Link from 'next/link'
import { Check, Star } from 'lucide-react'
import { motion } from 'framer-motion'

interface PricingCardProps {
  name: string
  price: string
  originalPrice?: string
  discountBadge?: string
  period: string
  features: string[]
  popular?: boolean
  storage?: string
  fileStorage?: string
  currencyNote?: string
  currencyCode?: string
  isCustom?: boolean
}

export default function PricingCard({
  name,
  price,
  originalPrice,
  discountBadge,
  period,
  features,
  popular = false,
  storage,
  fileStorage,
  currencyNote,
  currencyCode,
  isCustom = false,
}: PricingCardProps) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.25 }}
      className={`relative rounded-2xl p-7 ${
        popular
          ? 'bg-white border-2 border-[#0050c0] shadow-xl shadow-[#0050c0]/12'
          : 'bg-white border border-[#e2e6ec] shadow-sm hover:shadow-md'
      } transition-shadow`}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-4 py-1 bg-linear-to-r from-[#F87000] to-[#e06200] text-white text-xs font-bold rounded-full shadow-md">
          <Star size={12} className="fill-white" /> Most Popular
        </span>
      )}

      <h3 className="text-lg font-bold text-[#0f172a]">{name}</h3>
      <div className="mt-4 mb-5">
        {isCustom ? (
          <span className="text-2xl font-bold text-[#0f172a]">Custom Pricing</span>
        ) : (
          <>
            {period === 'forever' && (
              <span className="inline-block mb-3 bg-[#e8effb] text-[#0050c0] border border-[#0050c0]/20 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                Free Forever
              </span>
            )}
            {discountBadge && (
              <span className="inline-block mb-3 bg-[#fff3e6] text-[#c2410c] border border-[#F87000]/35 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                {discountBadge}
              </span>
            )}
            {originalPrice && (
              <div className="text-sm text-[#8a94a3] line-through mb-0.5">{originalPrice}</div>
            )}
            <div>
              <span className="text-4xl font-extrabold text-[#0f172a] tracking-tight">{currencyNote}{price}</span>
              {period === 'forever' ? (
                <span className="text-sm text-[#0050c0] ml-1">/forever</span>
              ) : (
                <span className="text-sm text-[#556070] ml-1">/{period}</span>
              )}
            </div>
            {currencyCode && <p className="text-xs text-[#556070] mt-1">{currencyCode}</p>}
            {period === 'forever' && (
              <p className="text-xs text-[#556070] mt-2">No credit card &middot; No expiry</p>
            )}
          </>
        )}
      </div>

      {(storage || fileStorage) && (
        <div className="mb-5 space-y-1 text-sm text-[#556070]">
          {storage && <p>Database: <span className="font-semibold text-[#0f172a]">{storage}</span></p>}
          {fileStorage && <p>File Storage: <span className="font-semibold text-[#0f172a]">{fileStorage}</span></p>}
        </div>
      )}

      <ul className="space-y-3 mb-7">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300">
            <div className="mt-0.5 w-4 h-4 rounded-full bg-gradient-to-br from-[#0050c0] to-[#2563eb] flex items-center justify-center flex-shrink-0">
              <Check size={10} className="text-white" />
            </div>
            {feature}
          </li>
        ))}
      </ul>

      <Link
        href={isCustom ? '/contact' : '/contact'}
        className={`block w-full py-3 text-center text-sm font-semibold rounded-md transition-all ${
          popular
            ? 'bg-linear-to-r from-[#0050c0] to-[#1666e0] text-white hover:from-[#00419e] hover:to-[#0050c0] shadow-md shadow-[#0050c0]/25'
            : 'border-2 border-[#e2e6ec] text-[#0f172a] hover:border-[#0050c0] hover:text-[#0050c0] hover:bg-[#e8effb]'
        }`}
      >
        {isCustom ? 'Contact Us' : period === 'forever' ? 'Get Started Free' : 'Get Started'}
      </Link>
    </motion.div>
  )
}

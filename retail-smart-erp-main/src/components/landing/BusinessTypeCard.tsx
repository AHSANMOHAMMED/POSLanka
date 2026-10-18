'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { type ReactNode } from 'react'

interface BusinessTypeCardProps {
  name: string
  description: string
  href: string
  icon: LucideIcon
  mockup?: ReactNode
  image?: string
  gradient?: string
}

export default function BusinessTypeCard({
  name,
  description,
  href,
  icon: Icon,
  mockup,
  image,
  gradient = 'from-emerald-600 to-emerald-500',
}: BusinessTypeCardProps) {
  return (
    <motion.div whileHover={{ y: -8 }} transition={{ duration: 0.25 }}>
      <Link href={href} className="group block rounded-2xl overflow-hidden bg-white/5 border border-white/[0.06] hover:shadow-2xl transition-all duration-300">
        <div className="relative h-48 overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900">
          {image && (
            <Image
              src={image}
              alt={name}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
              className="object-cover group-hover:scale-105 transition-transform duration-500"
            />
          )}
          {mockup && !image && (
            <div className="absolute inset-2 rounded overflow-hidden opacity-90 group-hover:opacity-100 transition-opacity duration-300 scale-[0.85] origin-top-left">
              {mockup}
            </div>
          )}
          <div className={`absolute inset-0 bg-gradient-to-t ${image ? 'from-black/60 via-black/20 to-transparent' : 'from-white via-transparent to-transparent'}`} />
          <div className="absolute top-4 left-4">
            <div className={`w-10 h-10 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
        <div className="p-5">
          <h3 className="text-lg font-bold text-white mb-1.5">{name}</h3>
          <p className="text-sm text-zinc-400 mb-3 line-clamp-2 leading-relaxed">{description}</p>
          <div className={`flex items-center gap-1.5 text-sm font-semibold bg-gradient-to-r ${gradient} bg-clip-text text-transparent group-hover:gap-2.5 transition-all`}>
            Explore <ArrowRight className="w-4 h-4 text-emerald-400" />
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

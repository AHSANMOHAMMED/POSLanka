'use client'

import { useRef, useState } from 'react'
import { type LucideIcon } from 'lucide-react'
import AIBadge from './AIBadge'

interface FeatureCardProps {
  icon: LucideIcon
  title: string
  description: string
  gradient?: string
  aiPowered?: boolean
}

export default function FeatureCard({
  icon: Icon,
  title,
  description,
  gradient = 'from-emerald-500 to-emerald-600',
  aiPowered = false,
}: FeatureCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState('')
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50 })

  function handleMouseMove(e: React.MouseEvent) {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const rotateX = (0.5 - y) * 10
    const rotateY = (x - 0.5) * 10
    setTransform(`perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`)
    setGlarePos({ x: x * 100, y: y * 100 })
  }

  function handleMouseLeave() {
    setTransform('')
    setGlarePos({ x: 50, y: 50 })
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transform, transition: transform ? 'none' : 'transform 0.4s ease' }}
      className="relative p-6 bg-white/5 rounded-2xl border border-white/[0.06] hover:shadow-xl transition-shadow overflow-hidden group"
    >
      {/* Glare */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(5, 150, 105, 0.06), transparent 60%)`,
        }}
      />

      <div className={`w-12 h-12 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-lg`}>
        <Icon size={22} className="text-white" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        {aiPowered && <AIBadge />}
      </div>
      <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { FadeIn } from './motion'

const testimonials = [
  {
    quote: 'Process sales in seconds with barcode scanning, split payments, held orders, gift cards, and real-time inventory tracking — all from one screen.',
    name: 'Point of Sale',
    role: 'Core Module',
    business: 'All Business Types',
    avatar: 'PO',
    image: '',
    gradient: 'from-blue-500 to-sky-500',
    rating: 5,
  },
  {
    quote: 'From kitchen display to floor plan management, handle dine-in orders, takeaway, and delivery with table tracking and recipe costing built in.',
    name: 'Restaurant',
    role: 'Specialized Module',
    business: 'Restaurant & Cafe',
    avatar: 'RE',
    image: '',
    gradient: 'from-orange-500 to-red-500',
    rating: 5,
  },
  {
    quote: 'Track stock across multiple warehouses, manage purchase orders, set reorder alerts, and handle batch tracking with full movement history.',
    name: 'Inventory',
    role: 'Core Module',
    business: 'All Business Types',
    avatar: 'IN',
    image: '',
    gradient: 'from-emerald-500 to-cyan-500',
    rating: 5,
  },
  {
    quote: 'Manage work orders from start to finish with vehicle tracking, multi-point inspections, insurance estimates, and parts management.',
    name: 'Auto Service',
    role: 'Specialized Module',
    business: 'Auto Service Centers',
    avatar: 'AS',
    image: '',
    gradient: 'from-violet-500 to-pink-500',
    rating: 5,
  },
]

export default function TestimonialCarousel() {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % testimonials.length)
    }, 6000)
    return () => clearInterval(timer)
  }, [])

  const prev = () => setCurrent((c) => (c - 1 + testimonials.length) % testimonials.length)
  const next = () => setCurrent((c) => (c + 1) % testimonials.length)

  return (
    <FadeIn className="max-w-4xl mx-auto">
      <div className="relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="glass-card-v2 p-8 sm:p-10 text-center"
          >
            {/* Stars */}
            <div className="flex items-center justify-center gap-1 mb-6">
              {Array.from({ length: testimonials[current].rating }).map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
              ))}
            </div>

            <blockquote className="text-lg sm:text-xl text-zinc-300 leading-relaxed mb-8 max-w-2xl mx-auto">
              &ldquo;{testimonials[current].quote}&rdquo;
            </blockquote>

            {/* Avatar + info */}
            <div className="flex items-center justify-center gap-4">
              {testimonials[current].image ? (
                <div className="w-12 h-12 rounded-full overflow-hidden shadow-lg relative flex-shrink-0">
                  <Image
                    src={testimonials[current].image}
                    alt={testimonials[current].name}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${testimonials[current].gradient} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
                  {testimonials[current].avatar}
                </div>
              )}
              <div className="text-left">
                <p className="font-bold text-white">{testimonials[current].name}</p>
                <p className="text-sm text-zinc-500">{testimonials[current].role} &middot; {testimonials[current].business}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-4 mt-8">
          <button onClick={prev} className="p-2.5 rounded-full border border-white/10 text-zinc-500 hover:text-white hover:border-white/20 hover:bg-white/5 transition-all">
            <ChevronLeft size={18} />
          </button>
          <div className="flex gap-2">
            {testimonials.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`h-2 rounded-full transition-all duration-300 ${i === current ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 w-8' : 'bg-zinc-700 w-2'}`}
              />
            ))}
          </div>
          <button onClick={next} className="p-2.5 rounded-full border border-white/10 text-zinc-500 hover:text-white hover:border-white/20 hover:bg-white/5 transition-all">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </FadeIn>
  )
}

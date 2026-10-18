'use client'

import { useEffect, useState, useRef, useSyncExternalStore, type ReactNode } from 'react'
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useInView,
  AnimatePresence,
  type Variants,
} from 'framer-motion'

// Re-export framer-motion for convenience
export { motion, AnimatePresence, useInView }

// ── Hydration hook ──
// Prevents SSR opacity:0 flash. Always pass `initial` (hidden state),
// toggle `animate` between hidden/visible based on hydrated.
const emptySubscribe = () => () => {}
export function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

// ── Scroll-triggered reveals ──
// All use whileInView with once:true so they animate once when scrolled into view

interface RevealProps {
  children: ReactNode
  className?: string
  delay?: number
}

export function FadeIn({ children, className = '', delay = 0 }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function FadeInLeft({ children, className = '', delay = 0 }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -40 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function FadeInRight({ children, className = '', delay = 0 }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function ScaleIn({ children, className = '', delay = 0 }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function BlurFadeIn({ children, className = '', delay = 0 }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function SpringIn({ children, className = '', delay = 0 }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ type: 'spring', stiffness: 100, damping: 15, delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Stagger containers ──

interface StaggerProps {
  children: ReactNode
  className?: string
  staggerDelay?: number
}

const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.4, 0.25, 1] } },
}

const staggerItemScaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.25, 0.4, 0.25, 1] } },
}

export function StaggerContainer({ children, className = '', staggerDelay = 0.08 }: StaggerProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: staggerDelay } } }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItemVariants} className={className}>
      {children}
    </motion.div>
  )
}

export function StaggerItemScale({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItemScaleVariants} className={className}>
      {children}
    </motion.div>
  )
}

// ── Parallax ──

interface ParallaxProps {
  children: ReactNode
  className?: string
  offset?: number  // pixels to shift (default 30)
}

export function Parallax({ children, className = '', offset = 30 }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })
  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset])
  const smoothY = useSpring(y, { stiffness: 100, damping: 30 })

  return (
    <div ref={ref} className={className} style={{ overflow: 'hidden' }}>
      <motion.div style={{ y: smoothY }}>
        {children}
      </motion.div>
    </div>
  )
}

// ── Animated counter ──
// Counts up from 0 to value when scrolled into view

interface AnimatedCounterProps {
  value: number
  suffix?: string
  prefix?: string
  duration?: number
}

export function AnimatedCounter({ value, suffix = '', prefix = '', duration = 2 }: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-40px' })
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!isInView) return
    let start = 0
    const step = value / (duration * 60) // ~60fps
    const timer = setInterval(() => {
      start += step
      if (start >= value) {
        setDisplay(value)
        clearInterval(timer)
      } else {
        setDisplay(Math.floor(start))
      }
    }, 1000 / 60)
    return () => clearInterval(timer)
  }, [isInView, value, duration])

  return <span ref={ref}>{prefix}{display}{suffix}</span>
}

// ── Page wrapper ──
// Wraps each landing page with fade-in + scroll progress bar

export function PageWrapper({ children }: { children: ReactNode }) {
  return (
    <main className="animate-fade-in">
      <ScrollProgressBar />
      {children}
    </main>
  )
}

// ── Scroll progress bar ──

export function ScrollProgressBar() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30 })

  return (
    <motion.div
      style={{ scaleX, transformOrigin: '0%' }}
      className="fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-indigo-500 z-[60]"
    />
  )
}

// ── Section divider ──

export function SectionDivider() {
  return (
    <div className="w-full flex justify-center py-2">
      <motion.div
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="h-px w-24 bg-gradient-to-r from-transparent via-blue-300 to-transparent"
      />
    </div>
  )
}

// ── Floating element ──
// Continuous gentle floating animation for decorative elements

interface FloatingProps {
  children: ReactNode
  className?: string
  duration?: number
  distance?: number
}

export function FloatingElement({ children, className = '', duration = 6, distance = 10 }: FloatingProps) {
  return (
    <motion.div
      animate={{
        y: [-distance, distance, -distance],
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Marquee ──
// Infinite horizontal scroll for trust/logo banners

interface MarqueeProps {
  children: ReactNode
  className?: string
  speed?: number  // seconds for one complete loop
  direction?: 'left' | 'right'
}

export function Marquee({ children, className = '', speed = 30, direction = 'left' }: MarqueeProps) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <motion.div
        className="flex gap-8 w-max"
        animate={{ x: direction === 'left' ? ['0%', '-50%'] : ['-50%', '0%'] }}
        transition={{
          x: { duration: speed, repeat: Infinity, ease: 'linear' },
        }}
      >
        {children}
        {children}
      </motion.div>
    </div>
  )
}

// ── Gradient orbs ──
// Decorative background gradient blobs

export function GradientOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute -top-20 right-[10%] w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 left-[5%] w-[400px] h-[400px] bg-indigo-500/8 rounded-full blur-3xl" />
      <div className="absolute top-1/3 left-1/3 w-[300px] h-[300px] bg-purple-500/6 rounded-full blur-3xl" />
    </div>
  )
}

// ── Word-by-word reveal ──

interface WordRevealProps {
  text: string
  className?: string
  delay?: number
}

export function WordReveal({ text, className = '', delay = 0 }: WordRevealProps) {
  const words = text.split(' ')
  return (
    <motion.span
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: delay } } }}
      className={className}
    >
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          variants={{ hidden: { opacity: 0, y: 10, filter: 'blur(4px)' }, visible: { opacity: 1, y: 0, filter: 'blur(0px)' } }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="inline-block mr-[0.25em]"
        >
          {word}
        </motion.span>
      ))}
    </motion.span>
  )
}

// ── Spring animated counter ──

interface SpringCounterProps {
  value: number
  suffix?: string
  prefix?: string
  className?: string
}

export function SpringCounter({ value, suffix = '', prefix = '', className = '' }: SpringCounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-40px' })
  const springValue = useSpring(0, { stiffness: 50, damping: 20 })
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (isInView) springValue.set(value)
  }, [isInView, value, springValue])

  useEffect(() => {
    const unsubscribe = springValue.on('change', (v) => setDisplay(Math.round(v)))
    return unsubscribe
  }, [springValue])

  return <span ref={ref} className={className}>{prefix}{display.toLocaleString()}{suffix}</span>
}

// ── Infinite logo/brand scroller ──

interface InfiniteScrollerProps {
  items: ReactNode[]
  speed?: number
  className?: string
  pauseOnHover?: boolean
}

export function InfiniteScroller({ items, speed = 25, className = '', pauseOnHover = true }: InfiniteScrollerProps) {
  const [paused, setPaused] = useState(false)
  return (
    <div
      className={`overflow-hidden ${className}`}
      onMouseEnter={() => pauseOnHover && setPaused(true)}
      onMouseLeave={() => pauseOnHover && setPaused(false)}
    >
      <motion.div
        className="flex gap-6 w-max"
        animate={{ x: paused ? undefined : ['0%', '-50%'] }}
        transition={{ x: { duration: speed, repeat: Infinity, ease: 'linear' } }}
      >
        {items}
        {items}
      </motion.div>
    </div>
  )
}

// ── Gradient Orbs v2 (configurable colors) ──

interface GradientOrbsV2Props {
  colors?: [string, string, string]
  intensity?: 'low' | 'medium' | 'high'
}

export function GradientOrbsV2({ colors = ['#3b82f6', '#8b5cf6', '#ec4899'], intensity = 'medium' }: GradientOrbsV2Props) {
  const opacityMap = { low: 0.15, medium: 0.3, high: 0.45 }
  const opacity = opacityMap[intensity]
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <motion.div
        animate={{ x: [0, 30, -20, 0], y: [0, -20, 30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-20 right-[10%] w-[500px] h-[500px] rounded-full blur-[100px]"
        style={{ background: colors[0], opacity }}
      />
      <motion.div
        animate={{ x: [0, -30, 20, 0], y: [0, 25, -15, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -bottom-20 left-[5%] w-[450px] h-[450px] rounded-full blur-[100px]"
        style={{ background: colors[1], opacity }}
      />
      <motion.div
        animate={{ x: [0, 20, -10, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/3 left-1/3 w-[350px] h-[350px] rounded-full blur-[100px]"
        style={{ background: colors[2], opacity }}
      />
    </div>
  )
}

// ── Browser Mockup Frame ──

interface BrowserMockupProps {
  children: ReactNode
  className?: string
  url?: string
}

export function BrowserMockup({ children, className = '', url = 'retailsmarterp.com' }: BrowserMockupProps) {
  return (
    <div className={`browser-mockup ${className}`}>
      <div className="browser-mockup-bar">
        <div className="browser-mockup-dot bg-red-400" />
        <div className="browser-mockup-dot bg-yellow-400" />
        <div className="browser-mockup-dot bg-green-400" />
        <div className="flex-1 ml-3">
          <div className="bg-white/5 rounded-md px-3 py-1 text-xs text-zinc-500 max-w-[200px] truncate border border-white/10">
            {url}
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

// ── Floating Mockup wrapper ──
// Wraps a mockup with floating animation + enhanced shadow

interface FloatingMockupProps {
  children: ReactNode
  className?: string
}

export function FloatingMockup({ children, className = '' }: FloatingMockupProps) {
  return (
    <motion.div
      animate={{ y: [0, -12, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      className={`relative ${className}`}
    >
      <div className="rounded-md overflow-hidden shadow-2xl shadow-indigo-500/20">
        {children}
      </div>
    </motion.div>
  )
}

// ── Count Up On View ──
// Numbers animate from 0 to value when scrolled into view

interface CountUpOnViewProps {
  value: number
  suffix?: string
  prefix?: string
  className?: string
  decimals?: number
}

export function CountUpOnView({ value, suffix = '', prefix = '', className = '', decimals = 0 }: CountUpOnViewProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-40px' })
  const springValue = useSpring(0, { stiffness: 40, damping: 25 })
  const [display, setDisplay] = useState('0')

  useEffect(() => {
    if (isInView) springValue.set(value)
  }, [isInView, value, springValue])

  useEffect(() => {
    const unsubscribe = springValue.on('change', (v) => {
      setDisplay(decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString())
    })
    return unsubscribe
  }, [springValue, decimals])

  return <span ref={ref} className={className}>{prefix}{display}{suffix}</span>
}

// ── Text Reveal ──
// Characters/words animate in one by one

interface TextRevealProps {
  text: string
  className?: string
  delay?: number
  byWord?: boolean
}

export function TextReveal({ text, className = '', delay = 0, byWord = true }: TextRevealProps) {
  const parts = byWord ? text.split(' ') : text.split('')
  return (
    <motion.span
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: byWord ? 0.06 : 0.02, delayChildren: delay } },
      }}
      className={className}
    >
      {parts.map((part, i) => (
        <motion.span
          key={`${part}-${i}`}
          variants={{
            hidden: { opacity: 0, y: 8, filter: 'blur(4px)' },
            visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
          }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={byWord ? 'inline-block mr-[0.25em]' : 'inline-block'}
        >
          {part}
        </motion.span>
      ))}
    </motion.span>
  )
}

// ── Hero Badge ──
// Animated pill badge for hero sections

interface HeroBadgeProps {
  text: string
  icon?: ReactNode
  className?: string
}

export function HeroBadge({ text, icon, className = '' }: HeroBadgeProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-emerald-500/20 to-amber-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm ${className}`}
    >
      {icon}
      {text}
    </motion.div>
  )
}

// ── Trust Bar ──
// Horizontal row of trust metrics

interface TrustMetric {
  label: string
  value: string
  icon?: ReactNode
}

interface TrustBarProps {
  metrics: TrustMetric[]
  className?: string
}

export function TrustBar({ metrics, className = '' }: TrustBarProps) {
  return (
    <div className={`trust-bar py-6 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap justify-center gap-8 sm:gap-12">
          {metrics.map((m) => (
            <FadeIn key={m.label} className="flex items-center gap-2 text-center">
              {m.icon}
              <div>
                <div className="text-lg font-bold text-white">{m.value}</div>
                <div className="text-xs text-zinc-500 font-medium">{m.label}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Text Shimmer ──
// Animated shimmer highlight that sweeps across text

interface TextShimmerProps {
  children: string
  className?: string
}

export function TextShimmer({ children, className = '' }: TextShimmerProps) {
  return (
    <span className={`text-shimmer ${className}`}>
      {children}
    </span>
  )
}

// ── TypeWriter ──
// Types out text character by character

interface TypeWriterProps {
  texts: string[]
  className?: string
  speed?: number
  pause?: number
}

export function TypeWriter({ texts, className = '', speed = 60, pause = 2000 }: TypeWriterProps) {
  const [currentText, setCurrentText] = useState('')
  const [textIndex, setTextIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const text = texts[textIndex]
    if (!deleting && charIndex < text.length) {
      const t = setTimeout(() => setCharIndex(c => c + 1), speed)
      return () => clearTimeout(t)
    } else if (!deleting && charIndex === text.length) {
      const t = setTimeout(() => setDeleting(true), pause)
      return () => clearTimeout(t)
    } else if (deleting && charIndex > 0) {
      const t = setTimeout(() => setCharIndex(c => c - 1), speed / 2)
      return () => clearTimeout(t)
    } else if (deleting && charIndex === 0) {
      setDeleting(false)
      setTextIndex(i => (i + 1) % texts.length)
    }
  }, [charIndex, deleting, textIndex, texts, speed, pause])

  useEffect(() => {
    setCurrentText(texts[textIndex].substring(0, charIndex))
  }, [charIndex, textIndex, texts])

  return (
    <span className={className}>
      {currentText}
      <span className="animate-pulse">|</span>
    </span>
  )
}

// ── Parallax Image ──
// Image that moves slower/faster than scroll

interface ParallaxImageProps {
  children: ReactNode
  className?: string
  offset?: number
}

export function ParallaxImage({ children, className = '', offset = 40 }: ParallaxImageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset])

  return (
    <div ref={ref} className={`overflow-hidden ${className}`}>
      <motion.div style={{ y }}>
        {children}
      </motion.div>
    </div>
  )
}

// ── Reveal Line ──
// Animated horizontal/vertical line reveal

interface RevealLineProps {
  direction?: 'horizontal' | 'vertical'
  className?: string
  delay?: number
}

export function RevealLine({ direction = 'horizontal', className = '', delay = 0 }: RevealLineProps) {
  return (
    <motion.div
      initial={{ scaleX: direction === 'horizontal' ? 0 : 1, scaleY: direction === 'vertical' ? 0 : 1 }}
      whileInView={{ scaleX: 1, scaleY: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={`origin-left ${className}`}
    />
  )
}

// ── Logo Marquee ──
// Infinite horizontal scrolling marquee

interface LogoMarqueeProps {
  children: ReactNode
  className?: string
  speed?: number
}

export function LogoMarquee({ children, className = '', speed = 25 }: LogoMarqueeProps) {
  return (
    <div className={`logo-marquee overflow-hidden ${className}`}>
      <motion.div
        className="flex gap-12 items-center"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: speed, ease: 'linear', repeat: Infinity }}
      >
        {children}
        {children}
      </motion.div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Store, UtensilsCrossed, ShoppingCart, Wrench, Car, Menu, X, ChevronDown, ArrowRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Logo } from '@/components/ui/logo'

const solutions = [
  { name: 'Retail', description: 'Complete POS for modern stores', href: '/retail', icon: Store, gradient: 'from-blue-500 to-sky-500' },
  { name: 'Restaurant', description: 'Kitchen, tables & orders', href: '/restaurant', icon: UtensilsCrossed, gradient: 'from-orange-500 to-red-500' },
  { name: 'Supermarket', description: 'High-volume checkout & departments', href: '/supermarket', icon: ShoppingCart, gradient: 'from-emerald-500 to-cyan-500' },
  { name: 'Auto Service', description: 'Work orders & vehicle management', href: '/auto-service', icon: Wrench, gradient: 'from-violet-500 to-pink-500' },
  { name: 'Vehicle Dealership', description: 'New & used vehicle sales', href: '/dealership', icon: Car, gradient: 'from-cyan-500 to-teal-500' },
]

const navLinks = [
  { name: 'Features', href: '/features' },
  { name: 'Pricing', href: '/pricing' },
  { name: 'About', href: '/about' },
  { name: 'Contact', href: '/contact' },
]

// Build absolute URL for app domain to avoid redirect loops from landing → app domain
const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN
const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
const appBase = appDomain ? `${protocol}://${appDomain}` : ''

export default function LandingNav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [solutionsOpen, setSolutionsOpen] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [announcementDismissed, setAnnouncementDismissed] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    fetch('/api/auth/session')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.user?.id) setLoggedIn(true) })
      .catch(() => {})
  }, [])

  // Close mobile menu on route change
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    if (mobileOpen) setMobileOpen(false)
  }

  const isActive = (href: string) => pathname === href

  const showAnnouncement = !announcementDismissed

  return (
    <>
      {/* Announcement Bar */}
      {showAnnouncement && (
        <div className="fixed top-0 left-0 right-0 z-[51] bg-gradient-to-r from-emerald-600/90 via-emerald-500/90 to-teal-500/90 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-center h-8 relative">
            <a href={`${appBase}/register`} className="text-xs text-white/95 font-medium hover:text-white transition-colors group">
              <span className="hidden sm:inline">Your first company is 100% free forever — no credit card, no expiry</span>
              <span className="sm:hidden">First company free forever</span>
              <ArrowRight size={12} className="inline ml-1.5 group-hover:translate-x-0.5 transition-transform" />
            </a>
            <button
              onClick={() => setAnnouncementDismissed(true)}
              className="absolute right-4 p-0.5 text-white/70 hover:text-white transition-colors"
              aria-label="Dismiss announcement"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <nav aria-label="Main navigation" className={`fixed left-0 right-0 z-50 transition-all duration-300 ${
        showAnnouncement ? 'top-8' : 'top-0'
      } ${
        scrolled
          ? 'bg-zinc-950/95 backdrop-blur-xl border-b border-white/10 shadow-sm'
          : 'bg-zinc-950/60 backdrop-blur-sm'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex-shrink-0">
            <Logo variant="full" size={28} />
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {/* Solutions Dropdown */}
            <div className="relative"
              onMouseEnter={() => setSolutionsOpen(true)}
              onMouseLeave={() => setSolutionsOpen(false)}
            >
              <button className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded transition-colors ${
                ['/retail', '/restaurant', '/supermarket', '/auto-service', '/dealership'].includes(pathname)
                  ? 'text-emerald-400'
                  : 'text-zinc-300 hover:text-emerald-400'
              }`}>
                Solutions
                <ChevronDown size={14} className={`transition-transform ${solutionsOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {solutionsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1 w-[520px] p-5 bg-zinc-950/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/30 border border-white/10 grid grid-cols-2 gap-2"
                  >
                    {solutions.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-start gap-3 p-3 rounded-md transition-all ${
                          isActive(item.href) ? 'bg-emerald-500/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <div className={`mt-0.5 w-9 h-9 rounded bg-gradient-to-br ${item.gradient} flex items-center justify-center shadow-sm`}>
                          <item.icon size={16} className="text-white" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">{item.name}</div>
                          <div className="text-xs text-zinc-500">{item.description}</div>
                        </div>
                      </Link>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Nav Links */}
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-3 py-2 text-sm font-medium rounded transition-colors ${
                  isActive(link.href) ? 'text-emerald-400' : 'text-zinc-300 hover:text-emerald-400'
                }`}
              >
                {link.name}
                {isActive(link.href) && (
                  <motion.div
                    layoutId="nav-active"
                    className="absolute bottom-0 left-3 right-3 h-0.5 bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-full"
                  />
                )}
              </Link>
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-3">
            {loggedIn ? (
              <a href={`${appBase}/account`} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 rounded-md transition-all shadow-lg shadow-emerald-600/25">
                My Account
              </a>
            ) : (
              <>
                <a href={`${appBase}/login`} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-emerald-400 transition-colors">
                  Log In
                </a>
                <a href={`${appBase}/register`} className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40">
                  Start Free Forever
                  <ArrowRight size={14} />
                </a>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 text-zinc-300 hover:text-emerald-400 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Scroll progress gradient line */}
        {scrolled && (
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
        )}
      </nav>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[55] lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-[300px] max-w-[85vw] bg-zinc-950 shadow-2xl z-[56] lg:hidden overflow-y-auto"
            >
              <div className="p-6">
                <div className="flex items-center justify-end mb-6">
                  <button onClick={() => setMobileOpen(false)} className="p-2 text-zinc-500 hover:text-white rounded hover:bg-white/5">
                    <X size={20} />
                  </button>
                </div>

                {/* Solutions */}
                <div className="mb-6">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Solutions</p>
                  <div className="space-y-1">
                    {solutions.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm ${
                          isActive(item.href) ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-300 hover:bg-white/5'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded bg-gradient-to-br ${item.gradient} flex items-center justify-center`}>
                          <item.icon size={14} className="text-white" />
                        </div>
                        {item.name}
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Nav links */}
                <div className="mb-6">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Navigation</p>
                  <div className="space-y-1">
                    {navLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={`block px-3 py-2.5 rounded-md text-sm font-medium ${
                          isActive(link.href) ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-300 hover:bg-white/5'
                        }`}
                      >
                        {link.name}
                      </Link>
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <div className="space-y-2 pt-4 border-t border-white/[0.06]">
                  {loggedIn ? (
                    <a href={`${appBase}/account`} className="block w-full px-4 py-2.5 text-sm font-semibold text-center text-white bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-md">
                      My Account
                    </a>
                  ) : (
                    <>
                      <a href={`${appBase}/login`} className="block w-full px-4 py-2.5 text-sm font-medium text-center text-zinc-300 border border-white/10 rounded-md hover:bg-white/5">
                        Log In
                      </a>
                      <a href={`${appBase}/register`} className="block w-full px-4 py-2.5 text-sm font-semibold text-center text-white bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-md">
                        Start Free Forever
                      </a>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

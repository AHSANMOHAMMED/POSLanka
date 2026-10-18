'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import { usePathname } from 'next/navigation'
import { useIsMobile, useBreakpoint } from '@/hooks/useResponsive'

// ============================================
// SIDEBAR CONTEXT
// ============================================

interface SidebarContextType {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  hidden: boolean
  showSidebar: () => void
  hideSidebar: () => void
  isAutoHideViewport: boolean
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

export function useSidebar() {
  const context = useContext(SidebarContext)
  // Return default values if context is not yet available (during SSR or before mount)
  if (!context) {
    return {
      collapsed: false,
      setCollapsed: () => {},
      hidden: false,
      showSidebar: () => {},
      hideSidebar: () => {},
      isAutoHideViewport: false,
      mobileOpen: false,
      setMobileOpen: () => {},
    }
  }
  return context
}

// ============================================
// SIDEBAR PROVIDER
// ============================================

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const isMobile = useIsMobile()
  const isDesktop = useBreakpoint('lg', 'up') // matches lg:hidden CSS on hamburger/sidebar

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value)
  }

  // Close mobile sidebar on route change
  const pathname = usePathname()
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false)
  }, [pathname])

  // Auto-close sidebar when viewport crosses lg breakpoint (matches lg:hidden CSS)
  useEffect(() => {
    if (isDesktop && mobileOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMobileOpen(false)
    }
  }, [isDesktop, mobileOpen])

  const showSidebar = () => {
    if (isMobile) {
      setMobileOpen(true)
    } else {
      setCollapsed(false)
    }
  }

  const hideSidebar = () => {
    if (isMobile) {
      setMobileOpen(false)
    } else {
      setCollapsed(true)
    }
  }

  // Prevent hydration mismatch
  if (!mounted) {
    return <>{children}</>
  }

  return (
    <SidebarContext.Provider value={{
      collapsed,
      setCollapsed,
      hidden: false,
      showSidebar,
      hideSidebar,
      isAutoHideViewport: isMobile,
      mobileOpen,
      setMobileOpen,
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

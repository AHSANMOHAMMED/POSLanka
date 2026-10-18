'use client'

import { useState, useEffect } from 'react'

/**
 * Breakpoint values matching Tailwind CSS defaults (mobile-first)
 */
export const breakpoints = {
  xs: 0,      // Extra small devices (portrait phones)
  sm: 640,    // Small devices (landscape phones)
  md: 768,    // Medium devices (tablets)
  lg: 1024,   // Large devices (laptops)
  xl: 1280,   // Extra large devices (desktops)
  '2xl': 1536, // 2X large devices (large desktops)
} as const

export type Breakpoint = keyof typeof breakpoints

/**
 * Hook to check if the current viewport matches a specific breakpoint
 * @param breakpoint The breakpoint to check (e.g., 'md', 'lg')
 * @param direction 'up' for min-width, 'down' for max-width
 * @returns boolean indicating if the breakpoint matches
 */
export function useBreakpoint(
  breakpoint: Breakpoint,
  direction: 'up' | 'down' = 'up'
): boolean {
  // Initialize with a SSR-safe guess: 'up' queries default true (desktop-first assumption)
  // to prevent hydration mismatch flash on desktop (the common case)
  const [matches, setMatches] = useState(() => direction === 'up')

  useEffect(() => {
    const mediaQuery = direction === 'up'
      ? `(min-width: ${breakpoints[breakpoint]}px)`
      : `(max-width: ${breakpoints[breakpoint] - 1}px)`
    
    const media = window.matchMedia(mediaQuery)
    
    // Set initial value
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(media.matches)
    
    // Define callback function
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }
    
    // Add event listener
    media.addEventListener('change', handler)
    
    // Clean up
    return () => {
      media.removeEventListener('change', handler)
    }
  }, [breakpoint, direction])

  return matches
}

/**
 * Hook to check if the current viewport is mobile (up to md breakpoint)
 * @returns boolean indicating if the viewport is mobile
 */
export function useIsMobile(): boolean {
  const isMobile = useBreakpoint('md', 'down')
  return isMobile
}

/**
 * Hook to check if the current viewport is tablet (md to lg breakpoint)
 * @returns boolean indicating if the viewport is tablet
 */
export function useIsTablet(): boolean {
  const isMd = useBreakpoint('md', 'up')
  const isLg = useBreakpoint('lg', 'down')
  
  return isMd && isLg
}

/**
 * Hook to check if the current viewport is desktop (lg breakpoint and up)
 * @returns boolean indicating if the viewport is desktop
 */
export function useIsDesktop(): boolean {
  const isDesktop = useBreakpoint('lg', 'up')
  return isDesktop
}

/**
 * Hook to get the current breakpoint name
 * @returns The current breakpoint name (e.g., 'sm', 'md', 'lg')
 */
export function useCurrentBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('xs')

  useEffect(() => {
    const checkBreakpoint = () => {
      const width = window.innerWidth
      
      if (width >= breakpoints['2xl']) {
        setBreakpoint('2xl')
      } else if (width >= breakpoints.xl) {
        setBreakpoint('xl')
      } else if (width >= breakpoints.lg) {
        setBreakpoint('lg')
      } else if (width >= breakpoints.md) {
        setBreakpoint('md')
      } else if (width >= breakpoints.sm) {
        setBreakpoint('sm')
      } else {
        setBreakpoint('xs')
      }
    }

    // Check on mount
    checkBreakpoint()

    // Debounced resize handler
    let timeoutId: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(checkBreakpoint, 100)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(timeoutId)
    }
  }, [])

  return breakpoint
}

/**
 * Hook to get the current screen width
 * @returns The current screen width in pixels
 */
export function useScreenWidth(): number {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 0)

  useEffect(() => {
    const handleResize = () => {
      setWidth(window.innerWidth)
    }

    // Set initial width
    handleResize()

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return width
}

/**
 * Hook to get the current screen height
 * @returns The current screen height in pixels
 */
export function useScreenHeight(): number {
  const [height, setHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0)

  useEffect(() => {
    const handleResize = () => {
      setHeight(window.innerHeight)
    }

    // Set initial height
    handleResize()

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return height
}

/**
 * Hook to conditionally render components based on breakpoint
 * @param mobile Component to render on mobile
 * @param desktop Component to render on desktop
 * @returns The appropriate component based on current breakpoint
 */
export function useResponsiveComponent<T, U>(
  mobile: T,
  desktop: U
): T | U {
  const isMobile = useIsMobile()
  return isMobile ? mobile : desktop
}

/**
 * Hook to get responsive values based on breakpoint
 * @param values Object with values for different breakpoints
 * @returns The value for the current breakpoint
 */
export function useResponsiveValue<T>(values: {
  xs?: T
  sm?: T
  md?: T
  lg?: T
  xl?: T
  '2xl'?: T
  default: T
}): T {
  const breakpoint = useCurrentBreakpoint()
  
  // Return value for current breakpoint, falling back through larger breakpoints
  switch (breakpoint) {
    case '2xl':
      return values['2xl'] ?? values.xl ?? values.lg ?? values.md ?? values.sm ?? values.xs ?? values.default
    case 'xl':
      return values.xl ?? values.lg ?? values.md ?? values.sm ?? values.xs ?? values.default
    case 'lg':
      return values.lg ?? values.md ?? values.sm ?? values.xs ?? values.default
    case 'md':
      return values.md ?? values.sm ?? values.xs ?? values.default
    case 'sm':
      return values.sm ?? values.xs ?? values.default
    case 'xs':
      return values.xs ?? values.default
    default:
      return values.default
  }
}

/**
 * Hook to detect touch capability
 * @returns boolean indicating if the device supports touch
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const checkTouch = () => {
      // Check for touch events support
      const hasTouch = 'ontouchstart' in window || 
        (navigator.maxTouchPoints > 0) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).msMaxTouchPoints > 0
      
      setIsTouch(hasTouch)
    }

    checkTouch()
  }, [])

  return isTouch
}

/**
 * Hook to detect if the device is in portrait orientation
 * @returns boolean indicating if the device is in portrait mode
 */
export function useIsPortrait(): boolean {
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false
  )

  useEffect(() => {
    const checkOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth)
    }

    checkOrientation()
    window.addEventListener('resize', checkOrientation)
    
    return () => {
      window.removeEventListener('resize', checkOrientation)
    }
  }, [])

  return isPortrait
}

/**
 * Hook to detect if the device is in landscape orientation
 * @returns boolean indicating if the device is in landscape mode
 */
export function useIsLandscape(): boolean {
  const isPortrait = useIsPortrait()
  return !isPortrait
}
// Hooks index for clean imports

export { useDebounce, useDebouncedValue } from './useDebounce'
export { usePermission, useUserRole, useCustomRoleName, useAllPermissions } from './usePermission'
export { useEffectivePermissions } from './useEffectivePermissions'
export { usePrint } from './usePrint'
export { useUnsavedChangesWarning } from './useUnsavedChangesWarning'
export { useAuthSync } from './useAuthSync'
export { useModuleAccess } from './useModuleAccess'
export { useTerminology } from './useTerminology'
export { usePaginatedData } from './usePaginatedData'
export { useSmartWarnings } from './useSmartWarnings'
export { useInstallPrompt } from './useInstallPrompt'

// Date formatting hook using tenant settings
export { useDateFormat } from './useDateFormat'

// Currency formatting hook using tenant settings
export { useCurrency } from './useCurrency'

// Currency hooks for dynamic currency formatting
export { useCurrencyDisplay, useTenantCurrency, useAccountCurrency } from './use-currency-display'

// WebSocket hooks for real-time updates
export {
  useWebSocket,
  usePresence,
  disconnectWebSocket,
} from './useWebSocket'

export {
  useRealtimeData,
  useRealtimeDataMultiple,
  useRealtimeDocument,
} from './useRealtimeData'

// Responsive design hooks for mobile-first development
export {
  useBreakpoint,
  useIsMobile,
  useIsTablet,
  useIsDesktop,
  useCurrentBreakpoint,
  useScreenWidth,
  useScreenHeight,
  useResponsiveComponent,
  useResponsiveValue,
  useIsTouchDevice,
  useIsPortrait,
  useIsLandscape,
  breakpoints,
} from './useResponsive'

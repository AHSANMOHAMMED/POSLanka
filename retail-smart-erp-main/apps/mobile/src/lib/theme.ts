// Stitch "Operational Velocity" Design System Tokens for POSLanka Mobile

export const THEME = {
  colors: {
    primary: '#0F766E', // Deep Teal - authoritative action & active state
    primaryDark: '#005C55',
    primaryLight: '#E6F4F2',
    primaryContainer: '#0F766E',
    onPrimary: '#FFFFFF',
    onPrimaryContainer: '#A3FAEF',

    secondary: '#855300', // Warm Amber
    secondaryAmber: '#F59E0B',
    secondaryContainer: '#FEA619',
    secondaryLight: '#FEF3C7',
    onSecondary: '#FFFFFF',
    onSecondaryContainer: '#684000',

    tertiary: '#16A34A', // Emerald - payment verified, live sync
    tertiaryContainer: '#007A33',
    tertiaryLight: '#DCFCE7',
    onTertiary: '#FFFFFF',

    error: '#DC2626', // Crimson - voids, warnings, drawer deficit
    errorLight: '#FEE2E2',
    onError: '#FFFFFF',

    background: '#FAF8FF',
    surface: '#FAF8FF',
    surfaceContainerLow: '#F2F3FF',
    surfaceContainer: '#EAEDFF',
    surfaceContainerHigh: '#E2E7FF',
    surfaceContainerHighest: '#DAE2FD',
    card: '#FFFFFF',

    outline: '#CBD5E1',
    border: '#E2E8F0',
    borderStrong: '#94A3B8',

    text: '#131B2E',
    textMuted: '#64748B',
    textSubtle: '#94A3B8',
    textDark: '#0F172A',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  radius: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },
}

/** Formats a numeric amount to Sri Lankan Rupee display standard (e.g. LKR 3,495.25) */
export function formatLKR(amount: number | string | undefined | null): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'))
  if (isNaN(num)) return 'LKR 0.00'
  return `LKR ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Formats pure number without LKR prefix */
export function formatAmount(amount: number | string | undefined | null): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'))
  if (isNaN(num)) return '0.00'
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

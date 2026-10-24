// skyERPOS mobile design tokens: logo blue (#0050C0) and orange (#F87000)

export const THEME = {
  colors: {
    primary: '#0050C0', // skyERPOS blue (logo) - actions & active state
    primaryDark: '#003C91',
    primaryLight: '#E8EFFB',
    primaryContainer: '#0050C0',
    onPrimary: '#FFFFFF',
    onPrimaryContainer: '#CFE0FF',

    secondary: '#C25700', // skyERPOS orange (logo #F87000) - highlights & attention
    secondaryAmber: '#F87000',
    secondaryContainer: '#FF9A3D',
    secondaryLight: '#FFF1E6',
    onSecondary: '#FFFFFF',
    onSecondaryContainer: '#7A3300',

    tertiary: '#16A34A', // Emerald - payment verified, live sync
    tertiaryContainer: '#007A33',
    tertiaryLight: '#DCFCE7',
    onTertiary: '#FFFFFF',

    error: '#DC2626', // Crimson - voids, warnings, drawer deficit
    errorLight: '#FEE2E2',
    onError: '#FFFFFF',

    background: '#F5F8FD',
    surface: '#F5F8FD',
    surfaceContainerLow: '#EEF3FB',
    surfaceContainer: '#E6EDF9',
    surfaceContainerHigh: '#DCE6F7',
    surfaceContainerHighest: '#D1DEF4',
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

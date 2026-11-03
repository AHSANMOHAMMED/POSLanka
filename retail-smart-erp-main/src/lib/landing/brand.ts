/**
 * skyERPOS landing accents. Primary brand is logo blue (#0050C0), not emerald/green.
 * Business-type pages keep a light secondary tint for identity, but CTAs/badges use brand.
 */
export const LANDING_BRAND = {
  from: '#0050c0',
  to: '#2563eb',
  hoverFrom: '#00419e',
  hoverTo: '#1d4ed8',
  soft: 'rgba(0, 80, 192, 0.14)',
  softText: '#93c5fd',
  ring: 'rgba(0, 80, 192, 0.35)',
  shadow: 'rgba(0, 80, 192, 0.35)',
} as const

/** Tailwind class bundles for shared landing chrome (CTAs, chips, icon wells). */
export const landingBrand = {
  /** Primary button fill */
  btn: 'bg-gradient-to-r from-[#0050c0] to-[#2563eb] hover:from-[#00419e] hover:to-[#1d4ed8] shadow-lg shadow-[rgba(0,80,192,0.35)] hover:shadow-[rgba(0,80,192,0.5)]',
  /** Soft pill / badge */
  chip: 'bg-[rgba(0,80,192,0.12)] text-sky-300 border border-[rgba(0,80,192,0.35)]',
  /** Icon well */
  iconWell: 'bg-gradient-to-br from-[#0050c0] to-[#2563eb] shadow-lg shadow-[rgba(0,80,192,0.25)]',
  /** Gradient text span */
  text: 'bg-gradient-to-r from-[#0050c0] via-[#3b82f6] to-amber-400 bg-clip-text text-transparent',
  /** Soft check / bullet */
  bullet: 'bg-gradient-to-br from-[#0050c0] to-[#2563eb]',
  /** Border hover */
  borderHover: 'hover:border-[rgba(0,80,192,0.4)]',
} as const

export type BusinessLandingKey = 'retail' | 'restaurant' | 'supermarket' | 'auto-service' | 'dealership'

/** Secondary tint per vertical (never primary green — brand blue owns CTAs). */
export const businessLandingAccent: Record<BusinessLandingKey, {
  gradient: string
  chip: string
  text: string
  glow: string
}> = {
  retail: {
    gradient: 'from-[#0050c0] to-sky-500',
    chip: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    text: 'text-sky-300',
    glow: 'shadow-sky-500/20',
  },
  restaurant: {
    gradient: 'from-[#0050c0] to-orange-500',
    chip: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
    text: 'text-orange-300',
    glow: 'shadow-orange-500/20',
  },
  supermarket: {
    gradient: 'from-[#0050c0] to-indigo-500',
    chip: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
    text: 'text-indigo-200',
    glow: 'shadow-indigo-500/20',
  },
  'auto-service': {
    gradient: 'from-[#0050c0] to-violet-500',
    chip: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
    text: 'text-violet-300',
    glow: 'shadow-violet-500/20',
  },
  dealership: {
    gradient: 'from-[#0050c0] to-cyan-500',
    chip: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    text: 'text-cyan-300',
    glow: 'shadow-cyan-500/20',
  },
}

import type { Metadata } from "next"
import localFont from "next/font/local"
import { ThemeProvider } from "@/components/providers/ThemeProvider"
import { ErrorCaptureProvider } from "@/components/providers/ErrorCaptureProvider"
import { NavigationProgress } from "@/components/layout/NavigationProgress"
import { TEXT_SCALE_SCRIPT } from "@/lib/ui/text-scale"
import "./globals.css"

// Inter (SIL OFL 1.1, see ./fonts/Inter-OFL-LICENSE.txt) is bundled so production builds never
// depend on downloading fonts from Google at build time.
const inter = localFont({
  src: "./fonts/InterVariable-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_LANDING_DOMAIN
    ? `https://${process.env.NEXT_PUBLIC_LANDING_DOMAIN.replace(/^https?:\/\//, '')}`
    : 'https://www.poslanka.lk'),
  title: {
    default: 'skyERPOS - All-in-one POS & ERP',
    template: '%s | skyERPOS',
  },
  description: 'Modern multi-tenant POS and light ERP for Sri Lankan retail shops, mini-supermarkets, and growing chains. LKR, Sinhala, WhatsApp, PayHere.',
  keywords: ['POS Sri Lanka', 'point of sale', 'skyERPOS', 'retail POS', 'supermarket POS', 'inventory management', 'LKR POS', 'Sinhala POS'],
  authors: [{ name: 'skyERPOS' }],
  creator: 'skyERPOS',
  publisher: 'skyERPOS',
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: {
    type: 'website',
    locale: 'en_LK',
    url: 'https://www.poslanka.lk',
    siteName: 'skyERPOS',
    title: 'skyERPOS - Sri Lanka POS & Light ERP',
    description: 'POS and light ERP for Sri Lankan shops. Fast billing, inventory, WhatsApp receipts, LKR-ready.',
    images: [{ url: '/og/home', width: 1200, height: 630, alt: 'skyERPOS - Sri Lanka POS & Light ERP' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'skyERPOS - Sri Lanka POS & Light ERP',
    description: 'POS and light ERP for Sri Lankan shops. Fast billing, inventory, WhatsApp receipts.',
    images: ['/og/home'],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-video-preview': -1, 'max-image-preview': 'large' as const, 'max-snippet': -1 } },
  category: 'technology',
  verification: {
    google: '', // TODO: Add Google Search Console verification code
  },
  other: {
    'application-name': 'skyERPOS',
    'subject': 'Business Management Software, Point of Sale, ERP',
    'classification': 'Business',
    'coverage': 'Sri Lanka',
    'distribution': 'Global',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  viewportFit: 'cover',
  userScalable: true,
}

// Script to prevent flash of wrong theme (FOUC)
const themeScript = `
(function() {
  try {
    var theme = localStorage.getItem('theme') || 'system';
    var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.add(isDark ? 'dark' : 'light');
    root.setAttribute('data-theme', localStorage.getItem('theme_palette') || 'default');
    root.setAttribute('data-ui', localStorage.getItem('ui_style') || 'classic');
    root.setAttribute('data-sidebar', localStorage.getItem('ui_sidebar') || 'hidden');
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // translate="no" + the google notranslate meta: the app ships its own English/Sinhala UI. Browser
    // auto-translation (Chrome/Google Translate) rewrites text nodes behind React's back, and the next
    // update then crashes with "Cannot read properties of null (reading 'removeChild')".
    <html lang="en" translate="no" className={inter.variable} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_SCRIPT }} />
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`} />
            <script dangerouslySetInnerHTML={{ __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}');
            `}} />
          </>
        )}
      </head>
      <body suppressHydrationWarning>
        <NavigationProgress />
        <ThemeProvider>
          <ErrorCaptureProvider>
            {children}
          </ErrorCaptureProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

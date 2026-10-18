import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import RestaurantClient from './RestaurantClient'

export const metadata: Metadata = {
  title: 'AI-Powered Restaurant Management - KDS, Tables, Orders',
  description: 'Kitchen display system, table management, floor plan, reservations, recipe costing, waste tracking, and AI analytics for restaurants. Unlimited users, free to start.',
  keywords: ['restaurant POS', 'kitchen display system', 'table management', 'restaurant management', 'recipe costing', 'KDS system', 'restaurant software'],
  openGraph: {
    title: 'Restaurant Management with Kitchen Display | RetailSmart ERP',
    description: 'KDS, table management, reservations, recipes. AI-powered analytics. Unlimited users.',
    url: 'https://www.retailsmarterp.com/restaurant',
    images: [{ url: '/og/restaurant', width: 1200, height: 630, alt: 'RetailSmart ERP Restaurant Management' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Restaurant Management with Kitchen Display | RetailSmart ERP',
    description: 'KDS, table management, reservations, recipes. AI-powered. Unlimited users.',
    images: ['/og/restaurant'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/restaurant',
  },
}

export default function RestaurantPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Solutions' },
    { name: 'Restaurant', url: '/restaurant' },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumb)
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "RetailSmart ERP - Restaurant Management",
            "applicationCategory": "BusinessApplication",
            "applicationSubCategory": "Restaurant Management",
            "operatingSystem": "Web",
            "description": "Kitchen display system, table management, floor plan, reservations, recipe costing, waste tracking, and AI analytics for restaurants. Unlimited users, free to start.",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD"
            }
          })
        }}
      />
      <RestaurantClient />
    </>
  )
}

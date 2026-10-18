import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import SupermarketClient from './SupermarketClient'

export const metadata: Metadata = {
  title: 'AI-Powered Supermarket POS - High-Volume Checkout & Departments',
  description: 'Supermarket management with high-volume checkout, department tracking, temperature zones, batch inventory, and AI-assisted analytics. Unlimited users, free to start.',
  keywords: ['supermarket POS', 'grocery POS', 'high volume checkout', 'department management', 'supermarket software', 'grocery store management'],
  openGraph: {
    title: 'Supermarket POS & Department Management | RetailSmart ERP',
    description: 'High-volume checkout, department management, batch tracking. AI-powered. Unlimited users.',
    url: 'https://www.retailsmarterp.com/supermarket',
    images: [{ url: '/og/supermarket', width: 1200, height: 630, alt: 'RetailSmart ERP Supermarket POS' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Supermarket POS & Department Management | RetailSmart ERP',
    description: 'High-volume checkout, department management, batch tracking. AI-powered.',
    images: ['/og/supermarket'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/supermarket',
  },
}

export default function SupermarketPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Solutions' },
    { name: 'Supermarket', url: '/supermarket' },
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
            "name": "RetailSmart ERP - Supermarket POS",
            "applicationCategory": "BusinessApplication",
            "applicationSubCategory": "Supermarket Management",
            "operatingSystem": "Web",
            "description": "Supermarket management with high-volume checkout, department tracking, temperature zones, batch inventory, and AI-assisted analytics. Unlimited users, free to start.",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD"
            }
          })
        }}
      />
      <SupermarketClient />
    </>
  )
}

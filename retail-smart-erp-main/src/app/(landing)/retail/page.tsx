import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import RetailClient from './RetailClient'

export const metadata: Metadata = {
  title: 'AI-Powered Retail POS System - Barcode, Inventory, Loyalty',
  description: 'Complete retail point of sale with barcode scanning, multi-warehouse inventory, loyalty programs, gift cards, and AI-powered analytics. Unlimited users, free to start.',
  keywords: ['retail POS', 'barcode scanning POS', 'retail inventory', 'loyalty program', 'gift card management', 'retail analytics', 'point of sale system'],
  openGraph: {
    title: 'Retail POS System with AI Analytics | RetailSmart ERP',
    description: 'Lightning-fast checkout, smart inventory, loyalty programs. Unlimited users. All features included.',
    url: 'https://www.retailsmarterp.com/retail',
    images: [{ url: '/og/retail', width: 1200, height: 630, alt: 'RetailSmart ERP Retail POS' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Retail POS System with AI Analytics | RetailSmart ERP',
    description: 'Lightning-fast checkout, smart inventory, loyalty programs. Unlimited users.',
    images: ['/og/retail'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/retail',
  },
}

export default function RetailPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Solutions' },
    { name: 'Retail POS', url: '/retail' },
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
            "name": "RetailSmart ERP - Retail POS",
            "applicationCategory": "BusinessApplication",
            "applicationSubCategory": "Point of Sale",
            "operatingSystem": "Web",
            "description": "Complete retail point of sale with barcode scanning, multi-warehouse inventory, loyalty programs, gift cards, and AI-powered analytics. Unlimited users, free to start.",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD"
            }
          })
        }}
      />
      <RetailClient />
    </>
  )
}

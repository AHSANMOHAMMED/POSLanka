import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import DealershipClient from './DealershipClient'

export const metadata: Metadata = {
  title: 'AI-Powered Vehicle Dealership Management - Sales & Inventory Tracking',
  description: 'Vehicle dealership management with inventory tracking, sales pipeline, trade-in management, test drive scheduling, and AI analytics. For car, motorbike, and vehicle dealerships. Unlimited users, free to start.',
  keywords: ['vehicle dealership software', 'car dealership management', 'vehicle inventory', 'dealership POS', 'vehicle sales', 'trade-in management', 'dealership CRM'],
  openGraph: {
    title: 'Vehicle Dealership Management System | RetailSmart ERP',
    description: 'Vehicle inventory, sales pipeline, trade-ins, test drives. AI-powered. Unlimited users.',
    url: 'https://www.retailsmarterp.com/dealership',
    images: [{ url: '/og/dealership', width: 1200, height: 630, alt: 'RetailSmart ERP Vehicle Dealership Management' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vehicle Dealership Management System | RetailSmart ERP',
    description: 'Vehicle inventory, sales pipeline, trade-ins, test drives. AI-powered.',
    images: ['/og/dealership'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/dealership',
  },
}

export default function DealershipPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Solutions' },
    { name: 'Dealership', url: '/dealership' },
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
            "name": "RetailSmart ERP - Vehicle Dealership Management",
            "applicationCategory": "BusinessApplication",
            "applicationSubCategory": "Vehicle Dealership Management",
            "operatingSystem": "Web",
            "description": "Vehicle dealership management with inventory tracking, sales pipeline, trade-in management, test drive scheduling, and AI analytics. Unlimited users, free to start.",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD"
            }
          })
        }}
      />
      <DealershipClient />
    </>
  )
}

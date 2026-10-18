import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import AutoServiceClient from './AutoServiceClient'

export const metadata: Metadata = {
  title: 'AI-Powered Auto Service Management - Work Orders & Vehicle Tracking',
  description: 'Auto service center management with work orders, vehicle tracking, multi-point inspections, insurance estimates, parts inventory, and AI analytics. Unlimited users, free to start.',
  keywords: ['auto service software', 'work order management', 'vehicle tracking', 'auto repair POS', 'insurance estimates', 'parts management', 'workshop management'],
  openGraph: {
    title: 'Auto Service Management System | RetailSmart ERP',
    description: 'Work orders, vehicle tracking, inspections, insurance estimates. AI-powered. Unlimited users.',
    url: 'https://www.retailsmarterp.com/auto-service',
    images: [{ url: '/og/auto-service', width: 1200, height: 630, alt: 'RetailSmart ERP Auto Service Management' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auto Service Management System | RetailSmart ERP',
    description: 'Work orders, vehicle tracking, inspections, insurance estimates. AI-powered.',
    images: ['/og/auto-service'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/auto-service',
  },
}

export default function AutoServicePage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Solutions' },
    { name: 'Auto Service', url: '/auto-service' },
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
            "name": "RetailSmart ERP - Auto Service Management",
            "applicationCategory": "BusinessApplication",
            "applicationSubCategory": "Auto Service Management",
            "operatingSystem": "Web",
            "description": "Auto service center management with work orders, vehicle tracking, multi-point inspections, insurance estimates, parts inventory, and AI analytics. Unlimited users, free to start.",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD"
            }
          })
        }}
      />
      <AutoServiceClient />
    </>
  )
}

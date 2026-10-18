import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'RetailSmart ERP - AI-Powered POS & Business Management for Everyone',
  description: 'All-in-one cloud POS and ERP with AI features for retail, restaurants, supermarkets, and auto service. Unlimited users. All features on every plan. Free forever.',
  keywords: ['POS system', 'point of sale', 'ERP software', 'AI business management', 'retail POS', 'restaurant management', 'inventory management', 'free POS system', 'cloud ERP', 'unlimited users', 'supermarket POS', 'auto service software'],
  openGraph: {
    title: 'RetailSmart ERP - AI-Powered POS & Business Management',
    description: 'Unlimited users. AI-assisted insights. All features on every plan. Free to start.',
    url: 'https://www.retailsmarterp.com/',
    images: [{ url: '/og/home', width: 1200, height: 630, alt: 'RetailSmart ERP - AI-Powered POS & Business Management' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RetailSmart ERP - AI-Powered POS & Business Management',
    description: 'Unlimited users. AI-assisted insights. All features on every plan.',
    images: ['/og/home'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/',
  },
}

export default function HomePage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home' },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            breadcrumb,
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": "RetailSmart ERP",
              "url": "https://www.retailsmarterp.com",
              "description": "All-in-one AI-powered cloud POS and ERP for retail, restaurants, supermarkets, and auto service.",
              "potentialAction": {
                "@type": "SearchAction",
                "target": "https://www.retailsmarterp.com/features?q={search_term_string}",
                "query-input": "required name=search_term_string"
              }
            },
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "RetailSmart ERP",
              "url": "https://www.retailsmarterp.com",
              "logo": "https://www.retailsmarterp.com/icons/icon-512.png",
              "description": "Cloud POS and business management platform with AI features for retail, restaurants, supermarkets, and auto service centers. Unlimited users on every plan.",
              "sameAs": [
                "https://www.retailsmarterp.com"
              ]
            },
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "RetailSmart ERP",
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web",
              "url": "https://www.retailsmarterp.com",
              "downloadUrl": "https://www.retailsmarterp.com/register",
              "screenshot": "https://www.retailsmarterp.com/og/home",
              "softwareVersion": "1.0",
              "description": "All-in-one cloud POS and ERP with AI features for retail, restaurants, supermarkets, and auto service. Unlimited users. All features on every plan.",
              "featureList": [
                "Point of Sale",
                "Inventory Management",
                "Double-Entry Accounting",
                "HR & Payroll",
                "Kitchen Display System",
                "Work Order Management",
                "AI Analytics",
                "Multi-Currency",
                "Real-Time Sync",
                "Unlimited Users"
              ],
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD",
                "name": "Free Forever",
                "description": "All features, unlimited users, 80 MB database, 100 MB file storage"
              }
            }
          ])
        }}
      />
      <HomeClient />
    </>
  )
}

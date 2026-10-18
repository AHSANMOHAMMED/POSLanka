import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import FeaturesClient from './FeaturesClient'

export const metadata: Metadata = {
  title: 'All Features - POS, Inventory, Accounting, HR, AI Analytics',
  description: 'Explore every feature: point of sale, inventory management, accounting, HR & payroll, kitchen display, work orders, and AI analytics. All included on every plan. No feature gating.',
  keywords: ['POS features', 'inventory management', 'accounting software', 'HR payroll', 'kitchen display system', 'work order management', 'AI analytics', 'restaurant POS features'],
  openGraph: {
    title: 'Every Feature Included on Every Plan | RetailSmart ERP',
    description: 'POS, inventory, accounting, HR, restaurant, auto service, and AI analytics. No feature gating. No hidden costs.',
    url: 'https://www.retailsmarterp.com/features',
    images: [{ url: '/og/features', width: 1200, height: 630, alt: 'RetailSmart ERP Features' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Every Feature Included on Every Plan | RetailSmart ERP',
    description: 'POS, inventory, accounting, HR, restaurant, auto service, and AI. No feature gating.',
    images: ['/og/features'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/features',
  },
}

export default function FeaturesPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Features', url: '/features' },
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
            "@type": "HowTo",
            "name": "How to Get Started with RetailSmart ERP",
            "description": "Set up your free business management system in minutes",
            "totalTime": "PT5M",
            "step": [
              {
                "@type": "HowToStep",
                "position": 1,
                "name": "Create your free account",
                "text": "Register at retailsmarterp.com with your email. No credit card required.",
                "url": "https://www.retailsmarterp.com/register"
              },
              {
                "@type": "HowToStep",
                "position": 2,
                "name": "Create your company",
                "text": "Choose your business type: retail, restaurant, supermarket, auto service, or dealership."
              },
              {
                "@type": "HowToStep",
                "position": 3,
                "name": "Add your products or services",
                "text": "Import items, set up categories, configure pricing, and add your inventory."
              },
              {
                "@type": "HowToStep",
                "position": 4,
                "name": "Start selling",
                "text": "Open the POS terminal and process your first transaction. Invite your team with unlimited user accounts."
              }
            ]
          })
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "RetailSmart ERP",
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Web",
            "description": "All-in-one AI-powered cloud POS and ERP with every feature included on every plan. No feature gating, no hidden costs.",
            "featureList": [
              "Point of Sale with Barcode Scanning",
              "Multi-Warehouse Inventory Management",
              "Double-Entry Accounting",
              "HR and Payroll Management",
              "Kitchen Display System",
              "Table and Reservation Management",
              "Floor Plan Designer",
              "Recipe Costing and Waste Tracking",
              "Work Order Management",
              "Vehicle Tracking",
              "Multi-Point Inspections",
              "Insurance Estimates",
              "AI Chat Assistant",
              "Smart Reorder Alerts",
              "Anomaly Detection",
              "Real-Time Dashboards",
              "Loyalty Programs and Gift Cards",
              "Multi-Currency Support",
              "Row-Level Security",
              "Real-Time Sync",
              "Unlimited Users",
              "Unlimited Locations"
            ],
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD"
            }
          })
        }}
      />
      <FeaturesClient />
    </>
  )
}

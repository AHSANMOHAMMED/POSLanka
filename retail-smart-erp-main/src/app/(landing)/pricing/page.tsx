import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import PricingClient from './PricingClient'

export const metadata: Metadata = {
  title: 'Pricing - All Features Included, Unlimited Users',
  description: 'Simple transparent pricing. All features on every plan. Unlimited users and transactions. First company free forever — no credit card needed. Scale as you grow.',
  keywords: ['POS pricing', 'ERP pricing', 'free POS', 'business software pricing', 'unlimited users', 'no per-user fees', 'affordable ERP'],
  openGraph: {
    title: 'Simple, Transparent Pricing | RetailSmart ERP',
    description: 'All features. Unlimited users. Free forever. Only pay for storage as you grow.',
    url: 'https://www.retailsmarterp.com/pricing',
    images: [{ url: '/og/pricing', width: 1200, height: 630, alt: 'RetailSmart ERP Pricing' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Simple, Transparent Pricing | RetailSmart ERP',
    description: 'All features. Unlimited users. Free forever.',
    images: ['/og/pricing'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/pricing',
  },
}

export default function PricingPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Pricing', url: '/pricing' },
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
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              "mainEntity": [
                {
                  "@type": "Question",
                  "name": "What's included in the free plan?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "The Free plan includes every feature \u2014 POS, inventory, restaurant, auto service, accounting, HR, AI insights, and more. You get unlimited users and locations with 20 MB of database and file storage each. Perfect for trying out the system."
                  }
                },
                {
                  "@type": "Question",
                  "name": "Why do all plans have the same features?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "We believe every business deserves access to all tools. You only pay for storage as your data grows. No feature gating, no surprises."
                  }
                },
                {
                  "@type": "Question",
                  "name": "Can I switch plans anytime?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately and billing is prorated."
                  }
                },
                {
                  "@type": "Question",
                  "name": "Is there a contract?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "No contracts. All plans are month-to-month or annual. Cancel anytime with no penalties."
                  }
                },
                {
                  "@type": "Question",
                  "name": "Do you offer discounts for annual billing?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes! Save 20% when you choose annual billing. The discount is applied automatically."
                  }
                },
                {
                  "@type": "Question",
                  "name": "What happens when I run out of storage?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "You'll receive warnings at 80% and 95% usage. At 100%, write operations pause while reads continue working. Upgrade instantly to increase your quota \u2014 no data loss."
                  }
                },
                {
                  "@type": "Question",
                  "name": "What payment methods do you accept?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "We accept all major credit and debit cards via our secure payment gateway. For enterprise plans, we also offer bank transfers and custom invoicing."
                  }
                },
                {
                  "@type": "Question",
                  "name": "Is my data secure?",
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Absolutely. We use database-level data isolation, encrypted connections, and regular backups. Your data is completely separated from other businesses."
                  }
                }
              ]
            },
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "RetailSmart ERP",
              "description": "All-in-one AI-powered cloud POS and ERP. All features on every plan. Unlimited users and transactions.",
              "brand": {
                "@type": "Brand",
                "name": "RetailSmart"
              },
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD",
                "availability": "https://schema.org/InStock",
                "description": "Free plan - All features included, unlimited users, 20 MB storage"
              }
            }
          ])
        }}
      />
      <PricingClient />
    </>
  )
}

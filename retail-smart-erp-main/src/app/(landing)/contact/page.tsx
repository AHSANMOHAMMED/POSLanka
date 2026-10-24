import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import ContactClient from './ContactClient'

export const metadata: Metadata = {
  title: 'Contact Us - Get Help & Support',
  description: 'Get in touch with skyERPOS. Questions about our POS, ERP, or business solutions? Our team is ready to help you get started.',
  keywords: ['contact skyERPOS', 'POS support', 'ERP help', 'business software support', 'schedule demo'],
  openGraph: {
    title: 'Contact skyERPOS',
    description: 'Questions? Our team is ready to help you get started with AI-powered business management.',
    url: 'https://www.retailsmarterp.com/contact',
    images: [{ url: '/og/contact', width: 1200, height: 630, alt: 'Contact skyERPOS' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact skyERPOS',
    description: 'Questions? Our team is ready to help you get started.',
    images: ['/og/contact'],
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/contact',
  },
}

export default function ContactPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Contact', url: '/contact' },
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
            "@type": "Organization",
            "name": "skyERPOS",
            "url": "https://www.retailsmarterp.com",
            "logo": "https://www.retailsmarterp.com/icons/icon-512.png",
            "contactPoint": {
              "@type": "ContactPoint",
              "email": "support@retailsmarterp.com",
              "contactType": "customer support",
              "availableLanguage": ["English"]
            }
          })
        }}
      />
      <ContactClient />
    </>
  )
}

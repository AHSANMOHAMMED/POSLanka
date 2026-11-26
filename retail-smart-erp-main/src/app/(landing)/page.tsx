import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'skyERPOS — Best Cloud & Offline POS System in Sri Lanka (LKR, Sinhala & English)',
  description:
    'Affordable Sri Lankan POS & ERP software by Skyloom Techno (Kalpitiya, Puttalam). Built for Retail, Supermarkets, Restaurants, Pharmacies, Auto Service, Hardware & Dealerships. Runs on Windows, Mac, Linux, Android & iOS.',
  keywords: [
    'POS system Sri Lanka',
    'POS software Sri Lanka',
    'best POS Sri Lanka',
    'supermarket POS Sri Lanka',
    'restaurant POS Sri Lanka',
    'pharmacy POS software Sri Lanka',
    'auto service garage software Sri Lanka',
    'hardware shop billing software LKR',
    'Android POS app Sri Lanka',
    'offline POS app',
    'Sinhala English POS billing',
    'thermal receipt printer POS',
    'skyERPOS',
    'Skyloom Techno',
    'POS Kalpitiya Puttalam',
  ],
  openGraph: {
    title: 'skyERPOS — All-in-One POS & ERP for Sri Lankan Businesses',
    description:
      '12 business types, any OS (Windows, Mac, Linux, Android, iOS), thermal printers, barcode scanners & affordable LKR plans with 25% annual discount.',
    url: 'https://www.skyerpos.com/',
    images: [{ url: '/og/home', width: 1200, height: 630, alt: 'skyERPOS — Sri Lanka Cloud & Offline POS' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'skyERPOS — Best POS & ERP Software in Sri Lanka',
    description: 'Fast LKR billing, inventory, KDS, auto service & accounting on any OS and Android.',
    images: ['/og/home'],
  },
  alternates: {
    canonical: 'https://www.skyerpos.com/',
  },
}

export default function HomePage() {
  const breadcrumb = generateBreadcrumbJsonLd([{ name: 'Home' }])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            breadcrumb,
            {
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'skyERPOS',
              url: 'https://www.skyerpos.com',
              description: 'All-in-one cloud and offline POS & ERP for 12 business types in Sri Lanka.',
              potentialAction: {
                '@type': 'SearchAction',
                target: 'https://www.skyerpos.com/features?q={search_term_string}',
                'query-input': 'required name=search_term_string',
              },
            },
            {
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'skyERPOS (Skyloom Techno)',
              url: 'https://www.skyerpos.com',
              logo: 'https://www.skyerpos.com/icons/icon-512.png',
              telephone: '+94 741228682',
              email: 'skyloomtechno@gmail.com',
              address: {
                '@type': 'PostalAddress',
                addressLocality: 'Kalpitiya',
                addressRegion: 'Puttalam',
                addressCountry: 'LK',
              },
            },
            {
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'skyERPOS',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Windows, macOS, Linux, Android, iOS',
              url: 'https://www.skyerpos.com',
              screenshot: 'https://www.skyerpos.com/og/home',
              offers: {
                '@type': 'Offer',
                price: '1490',
                priceCurrency: 'LKR',
                name: 'Starter Annual Plan (25% Off)',
              },
            },
          ]),
        }}
      />
      <HomeClient />
    </>
  )
}

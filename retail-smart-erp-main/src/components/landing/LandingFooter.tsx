'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Mail, Phone, MapPin, Store, UtensilsCrossed, ShoppingCart, Wrench, Car } from 'lucide-react'
import { Logo } from '@/components/ui/logo'

const defaultContact = {
  email: 'hello@poslanka.lk',
  phone: '077 840 7616',
  address: 'No 31, Akuressa Road, Nupe, Matara, Sri Lanka',
  companyName: 'POSLanka',
}

const productLinks = [
  { name: 'Features', href: '/features' },
  { name: 'Pricing', href: '/pricing' },
]

const solutionLinks = [
  { name: 'Retail POS', href: '/retail', icon: Store },
  { name: 'Restaurant', href: '/restaurant', icon: UtensilsCrossed },
  { name: 'Supermarket', href: '/supermarket', icon: ShoppingCart },
  { name: 'Auto Service', href: '/auto-service', icon: Wrench },
  { name: 'Vehicle Dealership', href: '/dealership', icon: Car },
]

const companyLinks = [
  { name: 'About Us', href: '/about' },
  { name: 'Contact', href: '/contact' },
  { name: 'Log In', href: '/login' },
  { name: 'Register', href: '/register' },
]

export default function LandingFooter() {
  const [contact, setContact] = useState(defaultContact)

  useEffect(() => {
    fetch('/api/public/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setContact({
            email: data.email || defaultContact.email,
            phone: data.phone || defaultContact.phone,
            address: data.address || defaultContact.address,
            companyName: data.companyName || defaultContact.companyName,
          })
        }
      })
      .catch(() => {})
  }, [])

  const telHref = `tel:${contact.phone.replace(/\s/g, '')}`

  return (
    <footer className="footer-gradient text-gray-300">
      {/* Gradient separator */}
      <div className="h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-8">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Logo variant="full" size={28} />
            <p className="mt-4 text-sm text-gray-400 max-w-xs leading-relaxed">
              Cloud POS & ERP with AI features for retail, restaurants, supermarkets, auto service centers, and vehicle dealerships. Unlimited users on every plan.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Product</h3>
            <ul className="space-y-2.5">
              {productLinks.map((link) => (
                <li key={link.href + link.name}>
                  <Link href={link.href} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Solutions */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Solutions</h3>
            <ul className="space-y-2.5">
              {solutionLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                    <link.icon size={14} />
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Company</h3>
            <ul className="space-y-2.5">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Contact</h3>
            <ul className="space-y-3">
              <li>
                <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                  <Mail size={14} className="flex-shrink-0" />
                  {contact.email}
                </a>
              </li>
              <li>
                <a href={telHref} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                  <Phone size={14} className="flex-shrink-0" />
                  {contact.phone}
                </a>
              </li>
              <li>
                <div className="flex items-start gap-2 text-sm text-gray-400">
                  <MapPin size={14} className="flex-shrink-0 mt-0.5" />
                  {contact.address}
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-14 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-500">
            &copy; {new Date().getFullYear()} {contact.companyName}. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-xs text-gray-500">
            <Link href="/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-gray-300 transition-colors">Terms of Service</Link>
            <button onClick={() => { localStorage.removeItem('cookie-consent'); window.location.reload() }} className="hover:text-gray-300 transition-colors">
              Cookie Settings
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}

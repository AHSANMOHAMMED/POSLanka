import type { Metadata } from 'next'
import RegisterClient from './RegisterClient'

export const metadata: Metadata = {
  title: 'Create Account - RetailSmart ERP',
  description: 'Create your free RetailSmart ERP account. AI-powered POS & business management with unlimited users. Free forever — no credit card needed.',
  keywords: ['register', 'create account', 'free POS', 'RetailSmart ERP', 'sign up'],
  openGraph: {
    title: 'Create Free Account | RetailSmart ERP',
    description: 'Your first company is free forever. AI-powered POS with unlimited users, all features included. No credit card needed.',
    images: [{ url: '/og/home', width: 1200, height: 630 }],
  },
}

export default function RegisterPage() {
  return <RegisterClient />
}

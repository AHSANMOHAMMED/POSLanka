import type { Metadata } from 'next'
import ForgotPasswordClient from './ForgotPasswordClient'

export const metadata: Metadata = {
  title: 'Forgot password',
  description: 'Reset the password of your skyERPOS owner account.',
  openGraph: {
    title: 'Forgot password | skyERPOS',
    description: 'Reset your account password securely.',
    images: [{ url: '/og/home', width: 1200, height: 630 }],
  },
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient />
}

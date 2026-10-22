import type { Metadata } from 'next'
import { getCompanyForSignIn } from '../login/company'
import { StaffForgotPasswordClient } from './StaffForgotPasswordClient'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const company = await getCompanyForSignIn(slug)
  return {
    title: company ? `Reset password · ${company.name}` : 'Reset password',
    robots: { index: false, follow: false },
  }
}

export default async function StaffForgotPasswordPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const company = await getCompanyForSignIn(slug)
  return <StaffForgotPasswordClient slug={slug} company={company} />
}

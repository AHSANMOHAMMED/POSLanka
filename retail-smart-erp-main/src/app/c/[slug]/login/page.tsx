import type { Metadata } from 'next'
import { getCompanyForSignIn } from './company'
import { CompanyLoginClient } from './CompanyLoginClient'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const company = await getCompanyForSignIn(slug)
  return {
    title: company ? `Sign in · ${company.name}` : 'Staff sign in',
    robots: { index: false, follow: false },
  }
}

export default async function CompanyLoginPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const company = await getCompanyForSignIn(slug)
  return <CompanyLoginClient slug={slug} company={company} />
}

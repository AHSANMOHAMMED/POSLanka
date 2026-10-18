import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import CookieConsent from '@/components/landing/CookieConsent'

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing-root">
      <div className="fixed inset-0 -z-50 bg-[#09090b]" aria-hidden="true" />
      <LandingNav />
      <main>{children}</main>
      <LandingFooter />
      <CookieConsent />
    </div>
  )
}

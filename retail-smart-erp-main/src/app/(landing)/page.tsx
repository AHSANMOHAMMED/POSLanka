import { redirect } from 'next/navigation'

/**
 * The site root opens the sign-in page (Business ID for staff, owner account sign-in); signed-in
 * owners are forwarded to their account from there. The product pages (/features, /pricing, …)
 * stay reachable by their own URLs.
 */
export default function HomePage() {
  redirect('/login')
}

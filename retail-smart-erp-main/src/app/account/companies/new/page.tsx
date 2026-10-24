import { redirect } from 'next/navigation'

// Businesses are added by skyERPOS (super admin → New vendor, with the owner's email), not by owners.
export default function NewCompanyPage() {
  redirect('/account')
}

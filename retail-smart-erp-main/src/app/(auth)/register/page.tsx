import { redirect } from 'next/navigation'

// Businesses and their staff are created by skyERPOS (super admin), so there is no self sign-up.
// Old links to /register land on the sign-in page.
export default function RegisterPage() {
  redirect('/')
}

import Link from 'next/link'
import { BrandWordmark } from '@/components/ui/logo'

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#f3f6fc] p-6 text-center">
      <BrandWordmark height={56} className="mb-8" />
      <p className="text-[64px] font-bold leading-none text-[#0050C0]">404</p>
      <h1 className="mt-3 text-xl font-semibold text-gray-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-600">The page you are looking for doesn’t exist or has moved.</p>
      <Link href="/login" className="mt-6 rounded-lg bg-[#0050C0] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#00419e]">
        Go to sign in
      </Link>
    </div>
  )
}

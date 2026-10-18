'use client'

import { useState } from 'react'
import { AccountHeader } from './AccountHeader'
import { AccountSidebar } from './AccountSidebar'

export function AccountShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <AccountHeader
        onMobileMenuToggle={() => setMobileOpen(!mobileOpen)}
        mobileMenuOpen={mobileOpen}
      />
      <div className="flex pt-16">
        <AccountSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <main className="flex-1 p-4 lg:p-8 lg:ml-64 pb-20 lg:pb-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </>
  )
}

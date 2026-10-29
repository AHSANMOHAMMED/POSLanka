'use client'

import { useEffect } from 'react'
import { useTheme } from './ThemeProvider'
import type { StoredAppearance } from '@/lib/ui/appearance'

/** Applies the business's saved look (Settings → Appearance) when the owner changed it since this PC last applied it. */
export function ShopAppearanceSync({ appearance }: { appearance: StoredAppearance }) {
  const { syncShopAppearance } = useTheme()
  useEffect(() => {
    syncShopAppearance(appearance)
  }, [appearance, syncShopAppearance])
  return null
}

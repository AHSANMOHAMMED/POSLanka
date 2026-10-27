import { router } from 'expo-router'
import { IS_ADMIN_APP } from './appVariant'

/**
 * Back navigation for screens that can be opened from a deep link / notification:
 * pops when there is history, otherwise goes to the Home tab (the dashboard; the
 * platform console in the admin app).
 */
export function goBack() {
  if (router.canGoBack()) {
    router.back()
    return
  }
  router.replace(IS_ADMIN_APP ? '/admin/pulse' : '/home')
}

/**
 * Open a bottom tab (/home, /pos, /items, /reports, /more) from anywhere: a screen pushed above
 * the tabs pops back to them (keeping the register's cart), a tab simply switches.
 */
export function goToTab(href: '/home' | '/pos' | '/items' | '/reports' | '/more') {
  if (router.canDismiss()) router.dismissTo(href)
  else router.replace(href)
}

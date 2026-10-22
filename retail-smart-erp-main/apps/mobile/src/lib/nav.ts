import { router } from 'expo-router'
import { getUser } from './api'
import { homeRoute } from './roles'

/**
 * Back navigation for screens that can be opened from a deep link / notification:
 * pops when there is history, otherwise goes to the user's home (POS for sellers,
 * the hub for roles that cannot sell).
 */
export function goBack() {
  if (router.canGoBack()) {
    router.back()
    return
  }
  getUser()
    .then((u) => router.replace(homeRoute(u)))
    .catch(() => router.replace('/home'))
}

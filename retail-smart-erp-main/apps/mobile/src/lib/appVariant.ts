// Two apps from one codebase (set at build time, see scripts/build-apk.sh / app.config.js):
//   vendor — "skyERPOS": shop staff sign in with their Business ID (POS, stock, shifts …)
//   admin  — "skyERPOS Admin": platform super admins (pulse, vendors, approvals)
// EXPO_PUBLIC_* values are inlined into the bundle, so read the variable directly.
export type AppVariant = 'vendor' | 'admin'

export const APP_VARIANT: AppVariant = process.env.EXPO_PUBLIC_APP_VARIANT === 'admin' ? 'admin' : 'vendor'
export const IS_ADMIN_APP = APP_VARIANT === 'admin'

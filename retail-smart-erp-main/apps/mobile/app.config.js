// Build-time variant on top of app.json: APP_VARIANT=admin builds "skyERPOS Admin" (separate
// package id, so both apps install side by side); anything else builds the vendor POS app
// "skyERPOS" (package lk.poslanka.app — unchanged, so it updates earlier installs).
module.exports = ({ config }) => {
  const admin = process.env.APP_VARIANT === 'admin'
  if (!admin) return { ...config, extra: { ...config.extra, appVariant: 'vendor' } }
  return {
    ...config,
    name: 'skyERPOS Admin',
    slug: config.slug,
    scheme: 'skyerpos-admin',
    icon: './assets/icon-admin.png',
    android: {
      ...config.android,
      package: 'lk.poslanka.admin',
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon-admin.png', backgroundColor: '#FFFFFF' },
    },
    notification: { ...config.notification, androidCollapsedTitle: 'skyERPOS Admin' },
    extra: { ...config.extra, appVariant: 'admin' },
  }
}

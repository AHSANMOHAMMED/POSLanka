/**
 * Expo config plugin: set Android compileSdkVersion, targetSdkVersion, and buildToolsVersion
 * to API level 36 (required by Google Play Store).
 */
const { withGradleProperties } = require('expo/config-plugins')

const SDK_PROPS = {
  'android.compileSdkVersion': '36',
  'android.targetSdkVersion': '36',
  'android.buildToolsVersion': '36.0.0',
}

module.exports = function withAndroidTargetSdk36(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults
    for (const [key, value] of Object.entries(SDK_PROPS)) {
      const existing = props.find((p) => p.type === 'property' && p.key === key)
      if (existing) {
        existing.value = value
      } else {
        props.push({ type: 'property', key, value })
      }
    }
    return cfg
  })
}

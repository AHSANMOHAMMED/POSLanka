/**
 * Expo config plugin: sign Android release builds with the POSLanka upload key when it is
 * configured, so every locally built APK can be installed as an update over the previous one.
 * Reads Gradle properties (pass with -P… or ORG_GRADLE_PROJECT_… env vars, see scripts/build-apk.sh):
 *   POSLANKA_STORE_FILE, POSLANKA_STORE_PASSWORD, POSLANKA_KEY_ALIAS, POSLANKA_KEY_PASSWORD
 * Without them the release build falls back to the debug key (installable, but not updatable
 * by a build signed with the real key). The key itself never lives in the repository.
 */
const { withAppBuildGradle } = require('expo/config-plugins')

const SIGNING_BLOCK = `
        release {
            if (project.hasProperty('POSLANKA_STORE_FILE')) {
                storeFile file(POSLANKA_STORE_FILE)
                storePassword POSLANKA_STORE_PASSWORD
                keyAlias POSLANKA_KEY_ALIAS
                keyPassword POSLANKA_KEY_PASSWORD
            }
        }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents
    if (src.includes('POSLANKA_STORE_FILE')) return cfg
    // 1. add a release signing config next to the debug one
    src = src.replace(/signingConfigs\s*\{\s*\n(\s*)debug\s*\{/, (m) => m.replace(/signingConfigs\s*\{/, `signingConfigs {${SIGNING_BLOCK}`))
    // 2. release build type uses it when the key is configured
    src = src.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('POSLANKA_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    )
    cfg.modResults.contents = src
    return cfg
  })
}

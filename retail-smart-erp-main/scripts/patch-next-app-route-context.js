/**
 * Next.js 16 + Turbopack: app-route/vendored/contexts/*.js files are missing
 * (only app-page and pages have them). Create them by re-exporting from app-page so
 * API routes and auth load correctly in dev.
 */

// Check Node.js version before proceeding
const nodeVersion = process.versions.node
const majorVersion = parseInt(nodeVersion.split('.')[0], 10)
if (majorVersion < 20) {
    console.error(`[patch-next-app-route-context] Error: Node.js version ${nodeVersion} detected. Next.js requires Node.js >=20.9.0.`)
    console.error('Please update your Node.js version to 20 or higher.')
    console.error('You can set NODE_VERSION=20 in your environment variables.')
    process.exit(1)
}

const fs = require('fs')
const path = require('path')

const nextDir = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'server', 'route-modules')
const appRouteDir = path.join(nextDir, 'app-route', 'vendored', 'contexts')
const appPageDir = path.join(nextDir, 'app-page', 'vendored', 'contexts')

// Get all .js files from app-page contexts
let appPageFiles = []
try {
  appPageFiles = fs.readdirSync(appPageDir).filter(f => f.endsWith('.js'))
} catch (err) {
  console.warn('[patch-next-app-route-context] Could not read app-page contexts:', err.message)
  process.exit(0)
}

console.log(`[patch-next-app-route-context] Found ${appPageFiles.length} context files in app-page`)

for (const filename of appPageFiles) {
  const appPageFile = path.join(appPageDir, filename)
  const targetFile = path.join(appRouteDir, filename)

  // Skip if already exists (may have been created previously)
  if (fs.existsSync(targetFile)) {
    console.log(`[patch-next-app-route-context] ${filename} already exists, skipping`)
    continue
  }

  if (!fs.existsSync(appPageFile)) {
    console.warn(`[patch-next-app-route-context] app-page ${filename} not found, skipping`)
    continue
  }

  // Read the source file to understand its export pattern
  const sourceContent = fs.readFileSync(appPageFile, 'utf8')
  // The source file typically exports from module.compiled
  // The original pattern: module.exports = require('../../module.compiled').vendored['contexts'].Something;
  // For app-route, we can re-export from app-page directly to be safe
  const content = [
    '"use strict";',
    `// Patched: app-route does not ship ${filename}; re-export from app-page`,
    `module.exports = require('../../../app-page/vendored/contexts/${filename}');`,
    ''
  ].join('\n')

  try {
    fs.mkdirSync(appRouteDir, { recursive: true })
    fs.writeFileSync(targetFile, content, 'utf8')
    console.log(`[patch-next-app-route-context] Created app-route/vendored/contexts/${filename}`)
  } catch (err) {
    console.warn(`[patch-next-app-route-context] ${filename}:`, err.message)
  }
}

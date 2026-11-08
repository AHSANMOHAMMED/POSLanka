/**
 * Bundle the custom Next.js server (server.ts) to server.js for production.
 * Running with plain Node (no tsx) avoids Next.js "AsyncLocalStorage not available" error.
 */
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Check Node.js version before proceeding
const nodeVersion = process.versions.node
const majorVersion = parseInt(nodeVersion.split('.')[0], 10)
if (majorVersion < 20) {
    console.error(`Error: Node.js version ${nodeVersion} detected. Next.js requires Node.js >=20.9.0.`)
    console.error('Please update your Node.js version to 20 or higher.')
    console.error('You can set NODE_VERSION=20 in your environment variables.')
    process.exit(1)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

await esbuild.build({
  entryPoints: [join(root, 'server.ts')],
  bundle: true,
  platform: 'node',
  outfile: join(root, 'server.js'),
  target: 'node20',
  // Resolve path alias so @/ points to src/
  alias: {
    '@': join(root, 'src'),
  },
  // Do not bundle node_modules; require at runtime so Next loads without tsx
  packages: 'external',
  // CJS so Node can require('next') at runtime without ESM/loader issues
  format: 'cjs',
  // Explicitly externalize ESM packages that cause issues with require()
  // next-auth v5 is ESM-only and cannot be required() in CommonJS
  external: [
    'next-auth',
    'next-auth/*',
    '@auth/core',
  ],
})

// Ensure .next/server/preview-props.json exists for Next 16.4+ runtime compatibility
try {
  const fs = await import('fs')
  const prerenderPath = join(root, '.next/prerender-manifest.json')
  const previewPropsPath = join(root, '.next/server/preview-props.json')
  if (fs.existsSync(prerenderPath) && !fs.existsSync(previewPropsPath)) {
    const prerender = JSON.parse(fs.readFileSync(prerenderPath, 'utf8'))
    fs.writeFileSync(previewPropsPath, JSON.stringify(prerender.preview || {}, null, 2))
    console.log('Created .next/server/preview-props.json from prerender-manifest.json')
  }
} catch {
  // Best-effort preview-props fallback
}

// Record which commit this build is from. The Droplet image (deploy/digitalocean/Dockerfile.droplet)
// refuses a .next from another commit, so a stale build can't be shipped by mistake.
try {
  const fs = await import('fs')
  const { execSync } = await import('child_process')
  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short=12 HEAD', { cwd: root }).toString().trim()
    try { execSync('git diff --quiet HEAD -- .', { cwd: root }) } catch { commit += '-dirty' }
  } catch {
    // no git (e.g. building inside a container): leave 'unknown'
  }
  if (fs.existsSync(join(root, '.next'))) fs.writeFileSync(join(root, '.next/skyerpos-commit'), commit + '\n')
} catch {
  // best effort
}

console.log('Built server.js (run with: node server.js)')

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

console.log('Built server.js (run with: node server.js)')

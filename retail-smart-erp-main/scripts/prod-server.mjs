/**
 * Run the built app (server.js) in production mode locally: pages are precompiled, so every
 * click is served immediately instead of compiling on first visit as `npm run dev` does.
 * Used by `npm run preview` (build + run). Reads .env / .env.local like `next start`.
 */
process.env.NODE_ENV = 'production'
const { spawn } = await import('child_process')
const { fileURLToPath } = await import('url')
const { dirname, join } = await import('path')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(process.execPath, [join(root, 'server.js')], {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
})
child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))

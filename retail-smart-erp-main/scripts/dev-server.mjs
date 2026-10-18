/**
 * Run server.js with NODE_ENV=development (no tsx = no AsyncLocalStorage crash).
 */
process.env.NODE_ENV = 'development'
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

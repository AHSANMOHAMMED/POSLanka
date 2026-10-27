/**
 * Download the local print agent (tools/print-agent) from the barcode print
 * page: GET ?file=index.mjs | start-windows.cmd | README.md
 * The agent is a dependency-free Node script (MIT) - nothing tenant specific.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const FILES: Record<string, string> = {
  'index.mjs': 'text/javascript; charset=utf-8',
  'start-windows.cmd': 'application/octet-stream',
  'README.md': 'text/markdown; charset=utf-8',
}

export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get('file') || 'index.mjs'
  const type = FILES[file]
  if (!type) return new Response('Unknown file', { status: 404 })
  try {
    const body = await readFile(path.join(process.cwd(), 'tools', 'print-agent', file))
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new Response('Print agent files are not available on this server', { status: 404 })
  }
}

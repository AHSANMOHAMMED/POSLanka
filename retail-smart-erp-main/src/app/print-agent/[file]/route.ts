/**
 * Public one-command installers for the local print agent (no login):
 *   GET /print-agent/install.ps1    Windows:  irm <origin>/print-agent/install.ps1 | iex
 *   GET /print-agent/uninstall.ps1  Windows uninstall
 *   GET /print-agent/install.sh     macOS / Linux:  curl -fsSL <origin>/print-agent/install.sh | bash
 *   GET /print-agent/index.mjs      the agent itself (tools/print-agent/index.mjs)
 * Exempt from tenant routing / auth in src/proxy.ts. Nothing tenant specific.
 */
import { loadPrintAgentFile, PRINT_AGENT_FILES, resolveInstallOrigin, type PrintAgentFile } from '@/lib/print/print-agent-install'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!Object.prototype.hasOwnProperty.call(PRINT_AGENT_FILES, file)) {
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  const origin = resolveInstallOrigin(request)
  try {
    const body = await loadPrintAgentFile(file as PrintAgentFile, origin)
    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        // The script embeds the host it was fetched from.
        Vary: 'Host, X-Forwarded-Host, X-Forwarded-Proto',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response('Print agent files are not available on this server\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}

'use client'

/**
 * One-line install command for the local print agent, for this computer's OS
 * (served by src/app/print-agent/[file]/route.ts), with a Copy button and the
 * other OS commands collapsed. Used by the Print Labels page and the printer
 * settings modal.
 */
import { useState, useSyncExternalStore } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { detectAgentOs, printAgentInstallCommands, type AgentInstallCommand, type AgentOs } from '@/lib/print/print-agent-commands'
import { toast } from '@/components/ui/toast'

const noopSubscribe = () => () => {}

interface ClientEnv {
  os: AgentOs
  origin: string
}
let cachedEnv: ClientEnv | null = null
function getEnv(): ClientEnv {
  if (!cachedEnv) cachedEnv = { os: detectAgentOs(), origin: window.location.origin }
  return cachedEnv
}

/** Browser OS + origin (null during SSR). */
export function useClientPrintEnv(): ClientEnv | null {
  return useSyncExternalStore(noopSubscribe, getEnv, () => null)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

function CommandRow({ cmd, text, primary }: { cmd: AgentInstallCommand; text: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <div className="flex items-stretch gap-1">
        <code
          className={`flex-1 min-w-0 overflow-x-auto whitespace-nowrap font-mono text-[11px] px-2 py-1.5 rounded border select-all ${
            primary ? 'bg-gray-900 text-emerald-200 border-gray-700' : 'bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700'
          }`}
        >
          {text}
        </code>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } else toast.error('Could not copy - select the command and copy it')
          }}
          className="shrink-0 px-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium flex items-center gap-1 text-[11px]"
          title="Copy command"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {primary && <p className="text-[11px] text-gray-600 dark:text-gray-400">{cmd.hint}</p>}
    </div>
  )
}

/** Windows: download one file and double-click it (curl.exe + tar.exe inside, no PowerShell). */
function WindowsSetupDownload({ origin }: { origin: string }) {
  const base = origin.replace(/\/+$/, '')
  return (
    <div className="space-y-1.5">
      <div className="font-medium text-gray-800 dark:text-gray-200">One-time setup on this Windows PC</div>
      <a
        href={`${base}/print-agent/skyERPOS-Printer-Setup.cmd`}
        download="skyERPOS-Printer-Setup.cmd"
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
      >
        <Download size={16} /> Download printer setup
      </a>
      <ol className="list-decimal pl-5 text-[11px] text-gray-700 dark:text-gray-300 space-y-0.5">
        <li>Open the downloaded <b>skyERPOS-Printer-Setup.cmd</b>. If Chrome says it may be dangerous, choose <b>Keep</b>; if Windows says &quot;Windows protected your PC&quot;, click <b>More info → Run anyway</b>.</li>
        <li>Wait until the black window says <b>DONE</b> (the first time downloads about 30 MB), then press any key.</li>
        <li>Press <b>Refresh</b> here - your printer appears. No admin rights or PowerShell needed; it starts with Windows from now on.</li>
      </ol>
      <p className="text-[11px] text-gray-500">
        Remove it later with{' '}
        <a href={`${base}/print-agent/skyERPOS-Printer-Uninstall.cmd`} download className="text-blue-700 dark:text-blue-400 underline">
          skyERPOS-Printer-Uninstall.cmd
        </a>
        .
      </p>
    </div>
  )
}

/** Command Prompt fallback for PCs where PowerShell's own download fails (old TLS, proxy). */
function AltCommand({ alt, cmd }: { alt: NonNullable<AgentInstallCommand['alt']>; cmd: AgentInstallCommand }) {
  return (
    <div className="space-y-1 pt-1">
      <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{alt.label}:</div>
      <CommandRow cmd={cmd} text={alt.install} />
      <p className="text-[11px] text-gray-500">{alt.hint}</p>
    </div>
  )
}

export function PrintAgentInstallCommands({ downloadBase }: { /** /c/<slug> for the manual file download links. */ downloadBase?: string }) {
  const env = useClientPrintEnv()
  if (!env) return null
  const cmds = printAgentInstallCommands(env.origin)
  const mine: AgentInstallCommand | null = env.os === 'windows' ? cmds.windows : env.os === 'mac' || env.os === 'linux' ? cmds.unix : null
  const others = [cmds.windows, cmds.unix].filter((c) => c !== mine)
  return (
    <div className="space-y-1.5">
      {mine?.os === 'windows' ? (
        <WindowsSetupDownload origin={env.origin} />
      ) : mine ? (
        <>
          <div className="font-medium text-gray-800 dark:text-gray-200">One-time setup on this computer: run this command</div>
          <CommandRow cmd={mine} text={mine.install} primary />
        </>
      ) : (
        <p className="text-gray-600 dark:text-gray-400">
          The print agent runs on a Windows, macOS or Linux computer. On this device use a direct USB / Bluetooth connection below.
        </p>
      )}
      <details className="text-[11px]">
        <summary className="cursor-pointer text-blue-700 dark:text-blue-400">
          {mine ? 'Advanced: install with a command, other computers, uninstall' : 'Install commands for Windows / macOS / Linux'}
        </summary>
        <div className="mt-1.5 space-y-2 pl-1">
          {mine?.os === 'windows' && (
            <div className="space-y-1">
              <div className="font-medium">Windows (PowerShell command)</div>
              <CommandRow cmd={mine} text={mine.install} />
              <p className="text-gray-500">{mine.hint}</p>
              {mine.alt && <AltCommand alt={mine.alt} cmd={mine} />}
            </div>
          )}
          {others.map((c) => (
            <div key={c.os} className="space-y-1">
              <div className="font-medium">{c.label}</div>
              <CommandRow cmd={c} text={c.install} />
              <p className="text-gray-500">{c.hint}</p>
              {c.alt && <AltCommand alt={c.alt} cmd={c} />}
            </div>
          ))}
          <div className="space-y-1">
            <div className="font-medium">Uninstall</div>
            {[cmds.windows, cmds.unix].map((c) => (
              <CommandRow key={c.os} cmd={c} text={c.uninstall} />
            ))}
          </div>
          <p className="text-gray-500">
            The command installs Node.js if needed, puts the agent in your user folder, starts it now and at every login, and allows this site (
            <code>{env.origin}</code>). Run it again to update.
            {downloadBase ? (
              <>
                {' '}
                Manual setup: install Node.js 20+, download{' '}
                <a href={`${downloadBase}/barcode/print-agent?file=index.mjs`} className="text-blue-700 underline">
                  index.mjs
                </a>{' '}
                and run <code>node index.mjs</code>.
              </>
            ) : null}
          </p>
        </div>
      </details>
    </div>
  )
}

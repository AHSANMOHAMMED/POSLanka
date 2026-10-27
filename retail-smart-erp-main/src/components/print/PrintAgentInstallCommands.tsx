'use client'

/**
 * One-line install command for the local print agent, for this computer's OS
 * (served by src/app/print-agent/[file]/route.ts), with a Copy button and the
 * other OS commands collapsed. Used by the Print Labels page and the printer
 * settings modal.
 */
import { useState, useSyncExternalStore } from 'react'
import { Check, Copy } from 'lucide-react'
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
      {mine ? (
        <>
          <div className="font-medium text-gray-800 dark:text-gray-200">
            One-time setup on this {mine.label === 'Windows' ? 'Windows PC' : 'computer'}: run this command
          </div>
          <CommandRow cmd={mine} text={mine.install} primary />
          {mine.alt && <AltCommand alt={mine.alt} cmd={mine} />}
        </>
      ) : (
        <p className="text-gray-600 dark:text-gray-400">
          The print agent runs on a Windows, macOS or Linux computer. On this device use a direct USB / Bluetooth connection below.
        </p>
      )}
      <details className="text-[11px]">
        <summary className="cursor-pointer text-blue-700 dark:text-blue-400">
          {mine ? 'Other computers, uninstall, manual setup' : 'Install commands for Windows / macOS / Linux'}
        </summary>
        <div className="mt-1.5 space-y-2 pl-1">
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

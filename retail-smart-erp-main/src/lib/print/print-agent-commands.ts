/**
 * One-line install commands for the local print agent (tools/print-agent),
 * served by src/app/print-agent/[file]/route.ts. Client-safe (no scripts here).
 */

export type AgentOs = 'windows' | 'mac' | 'linux' | 'chromeos' | 'android' | 'ios' | 'other'

export interface AgentInstallCommand {
  os: 'windows' | 'unix'
  label: string
  install: string
  uninstall: string
  hint: string
  /** Fallback when the main command can't download (old TLS, proxy): Command Prompt + curl.exe */
  alt?: { label: string; install: string; hint: string }
}

const clean = (origin: string) => origin.replace(/\/+$/, '')

export function printAgentInstallCommands(origin: string): { windows: AgentInstallCommand; unix: AgentInstallCommand } {
  const o = clean(origin)
  return {
    windows: {
      os: 'windows',
      label: 'Windows',
      // Windows PowerShell 5.1 may still default to TLS 1.0, which the server refuses ("Could not
      // create SSL/TLS secure channel" from Invoke-WebRequest); switch TLS 1.2 on before the download.
      install: `[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; irm ${o}/print-agent/install.ps1 | iex`,
      uninstall: `[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; irm ${o}/print-agent/uninstall.ps1 | iex`,
      hint: 'Start menu > type "PowerShell" > open Windows PowerShell (no admin needed), paste, press Enter.',
      alt: {
        label: 'If PowerShell shows an Invoke-WebRequest / Invoke-RestMethod error',
        install: `curl.exe -fsSL -o "%TEMP%\\skyerpos-print-agent.ps1" ${o}/print-agent/install.ps1 && powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\\skyerpos-print-agent.ps1"`,
        hint: 'Start menu > type "cmd" > open Command Prompt, paste, press Enter (uses the curl.exe built into Windows 10/11).',
      },
    },
    unix: {
      os: 'unix',
      label: 'macOS / Linux',
      install: `curl -fsSL ${o}/print-agent/install.sh | bash`,
      uninstall: `curl -fsSL ${o}/print-agent/install.sh | bash -s -- --uninstall`,
      hint: 'Open Terminal, paste, press Enter (no sudo needed).',
    },
  }
}

/** Best-effort OS of this browser (userAgentData when available, else UA / platform). */
export function detectAgentOs(nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined): AgentOs {
  if (!nav) return 'other'
  const uaData = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const p = `${uaData?.platform || ''} ${nav.platform || ''} ${nav.userAgent || ''}`.toLowerCase()
  if (/android/.test(p)) return 'android'
  if (/cros|chrome os|chromeos/.test(p)) return 'chromeos'
  if (/iphone|ipad|ipod/.test(p)) return 'ios'
  if (/win/.test(p)) return 'windows'
  if (/mac/.test(p)) return 'mac'
  if (/linux|x11/.test(p)) return 'linux'
  return 'other'
}

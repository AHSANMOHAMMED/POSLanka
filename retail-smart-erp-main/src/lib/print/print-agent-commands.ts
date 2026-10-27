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
}

const clean = (origin: string) => origin.replace(/\/+$/, '')

export function printAgentInstallCommands(origin: string): { windows: AgentInstallCommand; unix: AgentInstallCommand } {
  const o = clean(origin)
  return {
    windows: {
      os: 'windows',
      label: 'Windows',
      install: `irm ${o}/print-agent/install.ps1 | iex`,
      uninstall: `irm ${o}/print-agent/uninstall.ps1 | iex`,
      hint: 'Start menu > type "PowerShell" > open Windows PowerShell (no admin needed), paste, press Enter.',
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

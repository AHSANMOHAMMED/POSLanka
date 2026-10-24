/**
 * Platform (super-admin) accounts: password rules, temporary passwords and the
 * credentials email sent when an admin is created or has their password reset.
 */
import { randomInt } from 'crypto'
import { z } from 'zod'
import { sendSystemEmail } from '@/lib/email/system-email'
import { superAdmins } from '@/lib/db/schema'

/** Columns safe to send to the console (never the hash or TOTP secret). */
export const adminListColumns = {
  id: superAdmins.id,
  email: superAdmins.email,
  fullName: superAdmins.fullName,
  phone: superAdmins.phone,
  isActive: superAdmins.isActive,
  deactivatedAt: superAdmins.deactivatedAt,
  lastLoginAt: superAdmins.lastLoginAt,
  lastLoginIp: superAdmins.lastLoginIp,
  lockedUntil: superAdmins.lockedUntil,
  failedLoginAttempts: superAdmins.failedLoginAttempts,
  totpEnabled: superAdmins.totpEnabled,
  totpRequired: superAdmins.totpRequired,
  mustChangePassword: superAdmins.mustChangePassword,
  role: superAdmins.role,
  createdAt: superAdmins.createdAt,
}

/** New passwords for console admins: 10+ characters with a letter and a digit. */
export const adminPasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number')

const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGIT = '23456789'
const ALL = LOWER + UPPER + DIGIT

/** Readable random password (no 0/O/1/l/I) that always satisfies adminPasswordSchema. */
export function generateTempPassword(length = 14): string {
  const chars = [LOWER[randomInt(LOWER.length)], UPPER[randomInt(UPPER.length)], DIGIT[randomInt(DIGIT.length)]]
  while (chars.length < length) chars.push(ALL[randomInt(ALL.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Email a console admin their sign-in details. Returns how it went instead of throwing:
 * 'sent', 'logged' (no email transport configured — written to the server log) or 'failed'.
 */
export async function sendAdminCredentialsEmail(input: {
  to: string
  fullName: string
  tempPassword: string
  reason: 'created' | 'reset'
  baseUrl: string
  requireTotp: boolean
}): Promise<'sent' | 'logged' | 'failed'> {
  const app = process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'
  const loginUrl = `${input.baseUrl.replace(/\/$/, '')}/sys-control/login`
  const intro = input.reason === 'created'
    ? `An administrator account for the ${app} platform console has been created for you.`
    : `Your ${app} platform console password has been reset by another administrator.`
  const steps = [
    'Sign in with the temporary password below.',
    'You will be asked to choose a new password straight away.',
    ...(input.requireTotp ? ['Two-factor authentication is required: have an authenticator app ready.'] : []),
  ]
  const text = `Hi ${input.fullName},\n\n${intro}\n\nSign-in page: ${loginUrl}\nEmail: ${input.to}\nTemporary password: ${input.tempPassword}\n\n${steps.map((s) => `- ${s}`).join('\n')}\n\nIf you did not expect this email, contact your platform administrator.\n\n- ${app}`
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;color:#334155;font-size:15px;line-height:1.55;">
      <p>Hi ${esc(input.fullName)},</p>
      <p>${esc(intro)}</p>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Sign-in page</td><td><a href="${esc(loginUrl)}">${esc(loginUrl)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Email</td><td>${esc(input.to)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Temporary password</td><td style="font-family:monospace;font-size:16px;">${esc(input.tempPassword)}</td></tr>
      </table>
      <ul>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <p style="color:#94a3b8;font-size:12px;">If you did not expect this email, contact your platform administrator.</p>
    </div>`
  try {
    const res = await sendSystemEmail({
      to: input.to,
      subject: input.reason === 'created' ? `Your ${app} admin account` : `Your ${app} admin password was reset`,
      html,
      text,
    })
    return 'dev' in res && res.dev ? 'logged' : 'sent'
  } catch {
    return 'failed'
  }
}

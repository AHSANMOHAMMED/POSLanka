/**
 * Emails the super-admin console sends to a vendor's owner (password reset link,
 * sign-in details). Uses the platform's system email transport.
 */
import { SignJWT } from 'jose'
import { sendSystemEmail } from '@/lib/email/system-email'
import { formatBusinessId } from '@/lib/tenant/business-id'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function appName() {
  return process.env.NEXT_PUBLIC_APP_NAME || 'POSLanka'
}

function shell(title: string, body: string) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;">
    <div style="background:#0f766e;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="color:#ffffff;font-size:20px;font-weight:700;margin:0;">${esc(title)}</h1>
    </div>
    <div style="padding:28px 28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;color:#334155;font-size:15px;line-height:1.55;">
      ${body}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin:16px 0;">&copy; ${new Date().getFullYear()} ${esc(appName())}</p>
  </div>`
}

export interface OwnerMailTarget {
  userId: string
  email: string
  fullName: string
  tenantId: string
  tenantSlug: string
  tenantName: string
  businessId: string
}

/**
 * Signs a one-hour, single-use staff password-reset link (the same token the staff
 * "forgot password" flow issues; /api/auth/staff-reset-password consumes it).
 */
export async function createOwnerResetLink(t: OwnerMailTarget, baseUrl: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET not configured')
  const token = await new SignJWT({
    userId: t.userId,
    email: t.email,
    tenantId: t.tenantId,
    tenantSlug: t.tenantSlug,
    purpose: 'staff-password-reset',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret))
  return `${baseUrl}/c/${t.tenantSlug}/forgot-password?token=${token}`
}

export async function sendOwnerResetEmail(t: OwnerMailTarget, resetUrl: string) {
  const bid = formatBusinessId(t.businessId)
  return sendSystemEmail({
    to: t.email,
    subject: `Reset your password – ${t.tenantName}`,
    text: `Hi ${t.fullName},\n\nThe ${appName()} support team has sent you a link to set a new password for ${t.tenantName} (Business ID ${bid}).\n\n${resetUrl}\n\nThe link works once and expires in 1 hour. If you did not ask for this, contact support.\n\n- ${appName()}`,
    html: shell(t.tenantName, `
      <p style="margin:0 0 12px;">Hi ${esc(t.fullName)},</p>
      <p style="margin:0 0 20px;">The ${esc(appName())} support team has sent you a link to set a new password for <strong>${esc(t.tenantName)}</strong> (Business ID <strong>${esc(bid)}</strong>).</p>
      <p style="text-align:center;margin:0 0 20px;"><a href="${esc(resetUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">Set a new password</a></p>
      <p style="margin:0;color:#64748b;font-size:13px;">The link works once and expires in 1 hour. If you did not ask for this, contact support.</p>`),
  })
}

export async function sendOwnerWelcomeEmail(t: OwnerMailTarget, baseUrl: string) {
  const bid = formatBusinessId(t.businessId)
  const loginUrl = `${baseUrl}/login`
  return sendSystemEmail({
    to: t.email,
    subject: `Your ${appName()} sign-in details – ${t.tenantName}`,
    text: `Hi ${t.fullName},\n\nYour business ${t.tenantName} is set up on ${appName()}.\n\nSign in at ${loginUrl}\nBusiness ID: ${bid}\nEmail: ${t.email}\n\nUse the password you were given (or "Forgot password" on the sign-in page).\n\n- ${appName()}`,
    html: shell(t.tenantName, `
      <p style="margin:0 0 12px;">Hi ${esc(t.fullName)},</p>
      <p style="margin:0 0 16px;">Your business <strong>${esc(t.tenantName)}</strong> is set up on ${esc(appName())}. Here are your sign-in details:</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Sign-in page</td><td style="padding:10px 14px;"><a href="${esc(loginUrl)}">${esc(loginUrl)}</a></td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Business ID</td><td style="padding:10px 14px;font-weight:700;letter-spacing:0.04em;">${esc(bid)}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Email</td><td style="padding:10px 14px;">${esc(t.email)}</td></tr>
      </table>
      <p style="margin:0;color:#64748b;font-size:13px;">Use the password you were given, or choose &ldquo;Forgot password&rdquo; on the sign-in page.</p>`),
  })
}

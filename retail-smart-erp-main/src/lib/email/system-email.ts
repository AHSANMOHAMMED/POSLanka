// System-level email transport for OTP and system emails
// Independent of tenant email settings
// Uses Resend API (retailsmarterp.com verified domain)
import { fetchWithTimeout } from '@/lib/utils/fetch-timeout'

/** Escape HTML entities to prevent XSS in email templates */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendSystemEmail(options: {
  to: string
  subject: string
  html: string
  text?: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Dev fallback: log to console
    console.log('=== SYSTEM EMAIL (RESEND_API_KEY not set) ===')
    console.log(`To: ${options.to}`)
    console.log(`Subject: ${options.subject}`)
    console.log(`Body: ${options.text || options.html}`)
    console.log('==============================================')
    return { success: true, dev: true }
  }

  const senderEmail = process.env.SYSTEM_EMAIL_FROM || 'noreply@poslanka.lk'
  const senderName = process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'

  const res = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${senderName} <${senderEmail}>`,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    }),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok || !data.id) {
    throw new Error(`Resend API error: ${res.status} - ${data.message || res.statusText}`)
  }

  return { success: true, messageId: data.id }
}

export async function sendStaffInviteEmail(options: {
  email: string
  inviterName: string
  companyName: string
  role: string
  inviteUrl: string
}) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'
  const { email, inviterName, companyName, role, inviteUrl } = options

  // Escape user-provided values to prevent HTML injection in emails
  const safeInviterName = escapeHtml(inviterName)
  const safeCompanyName = escapeHtml(companyName)
  const safeRole = escapeHtml(role)

  return sendSystemEmail({
    to: email,
    subject: `You've been invited to join ${companyName} - ${appName}`,
    text: `Hi there,\n\n${inviterName} has invited you to join ${companyName} as a ${role} on ${appName}.\n\nAccept your invitation here: ${inviteUrl}\n\nThis invitation expires in 7 days.\n\nIf you didn't expect this invite, you can safely ignore this email.\n\n- ${appName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${appName}</h1>
        </div>

        <!-- Body -->
        <div style="padding: 40px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #334155; font-size: 16px; margin: 0 0 8px 0;">Hi there,</p>
          <p style="color: #64748b; font-size: 15px; margin: 0 0 24px 0;">
            <strong>${safeInviterName}</strong> has invited you to join <strong>${safeCompanyName}</strong> as a <strong style="text-transform: capitalize;">${safeRole}</strong>.
          </p>

          <!-- Company & Role Card -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 28px;">
            <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
              <tr>
                <td style="width: 44px; vertical-align: top;">
                  <div style="width: 40px; height: 40px; background: #dbeafe; border-radius: 8px; text-align: center; line-height: 40px; font-size: 18px; font-weight: 700; color: #1e40af;">
                    ${safeCompanyName.charAt(0).toUpperCase()}
                  </div>
                </td>
                <td style="padding-left: 12px; vertical-align: top;">
                  <div style="font-size: 15px; font-weight: 600; color: #1e293b;">${safeCompanyName}</div>
                  <div style="font-size: 13px; color: #64748b; text-transform: capitalize; margin-top: 2px;">Role: ${safeRole}</div>
                </td>
              </tr>
            </table>
          </div>

          <!-- CTA Button -->
          <div style="text-align: center; margin-bottom: 28px;">
            <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; font-size: 15px; font-weight: 600; padding: 14px 36px; border-radius: 10px; text-decoration: none;">
              Accept Invitation
            </a>
          </div>

          <!-- Timer badge -->
          <div style="text-align: center; margin-bottom: 28px;">
            <span style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 20px;">
              Expires in 7 days
            </span>
          </div>

          <!-- Divider -->
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />

          <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.5;">
            If you didn&rsquo;t expect this invitation, no worries &mdash; just ignore this email.
          </p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 20px 24px;">
          <p style="color: #cbd5e1; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
          </p>
        </div>
      </div>
    `,
  })
}

export async function sendOtpEmail(email: string, otp: string) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'
  const digits = otp.split('')

  return sendSystemEmail({
    to: email,
    subject: `${otp} is your verification code - ${appName}`,
    text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, please ignore this email.\n\n- ${appName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${appName}</h1>
        </div>

        <!-- Body -->
        <div style="padding: 40px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #334155; font-size: 16px; margin: 0 0 8px 0;">Hi there,</p>
          <p style="color: #64748b; font-size: 15px; margin: 0 0 28px 0;">
            Use this code to verify your email address. It&rsquo;s quick &mdash; just type it in and you&rsquo;re good to go!
          </p>

          <!-- OTP Code Boxes -->
          <div style="text-align: center; margin-bottom: 28px;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
              <tr>
                ${digits.map(d => `
                  <td style="padding: 0 4px;">
                    <div style="width: 52px; height: 64px; background: #f1f5f9; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 28px; font-weight: 700; color: #1e40af; line-height: 64px; text-align: center;">
                      ${d}
                    </div>
                  </td>
                `).join('')}
              </tr>
            </table>
          </div>

          <!-- Timer badge -->
          <div style="text-align: center; margin-bottom: 28px;">
            <span style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 20px;">
              Expires in 10 minutes
            </span>
          </div>

          <!-- Divider -->
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />

          <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.5;">
            If you didn&rsquo;t request this code, no worries &mdash; just ignore this email. Someone may have typed your address by mistake.
          </p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 20px 24px;">
          <p style="color: #cbd5e1; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
          </p>
        </div>
      </div>
    `,
  })
}

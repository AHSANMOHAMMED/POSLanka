import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'

export const metadata: Metadata = {
  title: 'Privacy Policy - RetailSmart ERP',
  description: 'Privacy Policy for RetailSmart ERP. Learn how we collect, use, and protect your data.',
  keywords: ['privacy policy', 'data protection', 'RetailSmart ERP privacy', 'data security'],
  openGraph: {
    title: 'Privacy Policy - RetailSmart ERP',
    description: 'Privacy Policy for RetailSmart ERP. Learn how we collect, use, and protect your data.',
    url: 'https://www.retailsmarterp.com/privacy',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Privacy Policy - RetailSmart ERP',
    description: 'Privacy Policy for RetailSmart ERP. Learn how we collect, use, and protect your data.',
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/privacy',
  },
}

export default function PrivacyPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Privacy Policy', url: '/privacy' },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumb)
        }}
      />
    <main className="min-h-screen pt-28 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h1 className="text-3xl font-bold text-white mb-8">Privacy Policy</h1>
        <div className="prose max-w-none text-zinc-400 space-y-6">
          <p className="text-sm text-zinc-500">Last updated: February 14, 2026</p>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">1. Information We Collect</h2>

            <h3 className="text-lg font-medium text-zinc-300 mt-5 mb-2">Account Information (collected at registration)</h3>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>Full name, email address, phone number, country</li>
              <li>Password (stored using industry-standard one-way hashing — we never store plain text passwords)</li>
              <li>Google account ID (if you use Google Sign-In)</li>
              <li>Terms acceptance timestamp</li>
            </ul>

            <h3 className="text-lg font-medium text-zinc-300 mt-5 mb-2">Business Data (entered by you during use)</h3>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>Company details (name, address, business type, tax settings)</li>
              <li>Customer records (names, emails, phones, addresses, credit balances)</li>
              <li>Products and inventory (items, SKUs, barcodes, prices, stock levels)</li>
              <li>Financial data (sales, purchases, invoices, payments, accounting entries)</li>
              <li>Employee and HR data (names, salary structures, payroll records)</li>
              <li>Vehicles, work orders, appointments (for auto service businesses)</li>
              <li>Restaurant data (tables, orders, reservations, recipes)</li>
              <li>Uploaded files (logos, photos, documents, inspection images)</li>
            </ul>

            <h3 className="text-lg font-medium text-zinc-300 mt-5 mb-2">Automatically Collected Information</h3>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>IP address (used only for GeoIP currency detection; not stored permanently)</li>
              <li>Device type and browser information (from HTTP headers)</li>
              <li>Login timestamps and last active timestamps</li>
              <li>Activity logs within the platform (actions performed within your company)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">2. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li><span className="text-zinc-300">Provide our services:</span> Process transactions, manage inventory, generate reports, and run your business operations</li>
              <li><span className="text-zinc-300">AI-powered features:</span> Analyze your business data to provide chat-based insights, detect anomalies, and suggest optimal settings (see Section 5)</li>
              <li><span className="text-zinc-300">Communications:</span> Send OTP verification codes, staff invitation emails, and configurable business notifications (appointment reminders, order updates, delivery notifications)</li>
              <li><span className="text-zinc-300">Billing:</span> Process subscription payments, manage wallet credits, and apply volume discounts</li>
              <li><span className="text-zinc-300">Security:</span> Detect unauthorized access, enforce Row Level Security, and log suspicious activity</li>
              <li><span className="text-zinc-300">Improvement:</span> Monitor error rates and performance to improve platform reliability</li>
            </ul>
            <div className="mt-4 p-4 rounded bg-white/5 border border-white/10">
              <p className="text-sm text-zinc-300 font-medium mb-2">We do NOT:</p>
              <ul className="list-disc pl-5 space-y-1 text-zinc-400 text-sm">
                <li>Sell your personal or business data to third parties</li>
                <li>Use your business data for advertising purposes</li>
                <li>Share your data with other tenants on the platform</li>
                <li>Intentionally use your data to train AI models (see Section 5 for details on third-party AI processing)</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">3. Data Storage & Security</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li><span className="text-zinc-300">Encryption:</span> All data is encrypted in transit (TLS/HTTPS). Data at rest is encrypted by our infrastructure providers (database and file storage)</li>
              <li><span className="text-zinc-300">Row Level Security (RLS):</span> Every tenant&apos;s data is isolated at the database level using database-level Row Level Security policies across all data tables. Your business data cannot be accessed by other tenants through the application</li>
              <li><span className="text-zinc-300">Tenant Isolation:</span> Each company operates in a completely isolated data context with unique tenant identifiers</li>
              <li><span className="text-zinc-300">File Storage:</span> Uploaded files are stored on encrypted cloud storage, organized by tenant with access controls</li>
              <li><span className="text-zinc-300">Authentication:</span> Secure token-based sessions, industry-standard password hashing, and email OTP verification</li>
              <li><span className="text-zinc-300">Infrastructure:</span> Hosted on secure cloud infrastructure with managed databases</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">4. Third-Party Services</h2>
            <p className="mb-4">We use the following third-party services to operate the platform. We only share the minimum data necessary for each service to function:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 pr-4 text-zinc-300 font-medium">Service</th>
                    <th className="text-left py-2 pr-4 text-zinc-300 font-medium">Purpose</th>
                    <th className="text-left py-2 text-zinc-300 font-medium">Data Shared</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-400">
                  <tr className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4 text-zinc-300">Google Gemini</td>
                    <td className="py-2 pr-4">Primary AI processing</td>
                    <td className="py-2">Business metrics for generating AI responses</td>
                  </tr>
                  <tr className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4 text-zinc-300">DeepSeek</td>
                    <td className="py-2 pr-4">Fallback AI processing</td>
                    <td className="py-2">Same as above (used when primary provider is unavailable)</td>
                  </tr>
                  <tr className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4 text-zinc-300">PayHere</td>
                    <td className="py-2 pr-4">Payment processing</td>
                    <td className="py-2">Billing name, email, subscription amount</td>
                  </tr>
                  <tr className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4 text-zinc-300">Email Service</td>
                    <td className="py-2 pr-4">Transactional email delivery</td>
                    <td className="py-2">Email addresses, notification content</td>
                  </tr>
                  <tr className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4 text-zinc-300">Cloud Storage</td>
                    <td className="py-2 pr-4">File storage</td>
                    <td className="py-2">Uploaded files (logos, photos, documents)</td>
                  </tr>
                  <tr className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4 text-zinc-300">GeoIP Service</td>
                    <td className="py-2 pr-4">GeoIP detection</td>
                    <td className="py-2">Your IP address (for currency display only; not stored)</td>
                  </tr>
                  <tr className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4 text-zinc-300">Google OAuth</td>
                    <td className="py-2 pr-4">Social login (optional)</td>
                    <td className="py-2">Google account ID, email, name</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 text-zinc-300">SMS Providers</td>
                    <td className="py-2 pr-4">SMS notifications (if enabled)</td>
                    <td className="py-2">Phone numbers, notification content</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">5. AI Data Processing</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li><span className="text-zinc-300">What is processed:</span> Aggregated business metrics (daily sales totals, top-selling items, stock levels, customer summaries, staff performance metrics)</li>
              <li><span className="text-zinc-300">How it&apos;s processed:</span> Your questions and relevant business data are sent to AI providers to generate natural language responses</li>
              <li><span className="text-zinc-300">Rate limits:</span> AI requests are rate-limited per tenant to prevent abuse</li>
              <li><span className="text-zinc-300">Error analysis:</span> Application errors may be analyzed by AI to improve reliability. Sensitive data (passwords, tokens) is stripped before processing</li>
              <li><span className="text-zinc-300">Data usage:</span> We do not use your business data to train AI models. Data is sent to third-party AI providers (Google Gemini, DeepSeek) solely to generate responses. These providers have their own data handling policies — we recommend reviewing their respective privacy policies for details</li>
              <li><span className="text-zinc-300">Optional:</span> AI features are supplementary. The platform is fully functional without AI features enabled</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">6. Cookies</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li><span className="text-zinc-300">Essential Cookies:</span> Authentication session tokens and user preferences (theme, language). Required for the platform to function. Cannot be disabled.</li>
              <li><span className="text-zinc-300">Analytics Cookies:</span> If analytics services are active, we use cookies to understand usage patterns. You can opt out through Cookie Settings.</li>
              <li><span className="text-zinc-300">Marketing Cookies:</span> We do not use marketing or advertising cookies.</li>
            </ul>
            <p className="mt-3">You can manage your cookie preferences through the Cookie Settings available in the website footer.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">7. Email & SMS Communications</h2>

            <h3 className="text-lg font-medium text-zinc-300 mt-5 mb-2">System Emails</h3>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>OTP verification codes during registration (required)</li>
              <li>Staff invitation emails (triggered by business owner)</li>
            </ul>

            <h3 className="text-lg font-medium text-zinc-300 mt-5 mb-2">Business Notifications</h3>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>Appointment confirmations and reminders</li>
              <li>Work order completion and invoicing notifications</li>
              <li>Sale receipts, delivery updates, reservation confirmations</li>
              <li>Configurable per business — can be enabled or disabled by the business owner</li>
            </ul>

            <p className="mt-3">We do not send unsolicited marketing emails. You may manage your notification preferences through your account settings.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">8. Data Retention</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li><span className="text-zinc-300">Active accounts:</span> Your data is retained for as long as your account is active</li>
              <li><span className="text-zinc-300">Company deletion:</span> When you delete a company, all associated business data is permanently deleted through a cascade deletion process across all data tables, including uploaded files</li>
              <li><span className="text-zinc-300">Expired subscriptions:</span> Locked companies are permanently deleted 7 days after locking. You will receive warnings before deletion.</li>
              <li><span className="text-zinc-300">Account data:</span> Your account-level information (email, name, phone, preferences) is retained until you request account deletion</li>
              <li><span className="text-zinc-300">Account deletion:</span> Upon request, your personal account data will be removed within 30 days, except where required by law</li>
              <li><span className="text-zinc-300">Backups:</span> Database backups may retain deleted data for up to 30 days for disaster recovery purposes</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">9. Your Rights</h2>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li><span className="text-zinc-300">Access</span> your personal and business data at any time through the platform</li>
              <li><span className="text-zinc-300">Correct</span> inaccurate personal information through your account settings</li>
              <li><span className="text-zinc-300">Export</span> your business data in Excel, CSV, or print formats (18+ report types plus entity-level export)</li>
              <li><span className="text-zinc-300">Delete</span> your company and all associated data (requires password confirmation)</li>
              <li><span className="text-zinc-300">Request</span> full account deletion by contacting support</li>
              <li><span className="text-zinc-300">Opt out</span> of non-essential email and SMS notifications through notification preferences</li>
              <li><span className="text-zinc-300">Manage</span> cookie preferences through the Cookie Settings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">10. Children&apos;s Privacy</h2>
            <p>RetailSmart ERP is a business management platform intended for users aged 18 and above. We do not knowingly collect information from children under 18. If we learn that we have collected data from a child under 18, we will delete it promptly.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">11. International Data Processing</h2>
            <p>Your data may be processed in jurisdictions outside your country of residence (including for AI processing and cloud infrastructure). We ensure that adequate data protection measures are in place regardless of where your data is processed.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">12. Changes to This Policy</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>We may update this Privacy Policy from time to time</li>
              <li>Material changes will be communicated via email at least 30 days in advance</li>
              <li>The &quot;Last updated&quot; date at the top of this page will reflect the most recent revision</li>
              <li>Your continued use of the platform after changes take effect constitutes acceptance</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">13. Contact</h2>
            <p>If you have questions about this Privacy Policy or wish to exercise your data rights, please reach out through our <a href="/contact" className="text-emerald-400 hover:text-emerald-300 hover:underline">contact page</a> or email <a href="mailto:support@retailsmarterp.com" className="text-emerald-400 hover:text-emerald-300 hover:underline">support@retailsmarterp.com</a>.</p>
          </section>
        </div>
      </div>
    </main>
    </>
  )
}

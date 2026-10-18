import { Metadata } from 'next'
import { generateBreadcrumbJsonLd } from '@/lib/seo/breadcrumbs'

export const metadata: Metadata = {
  title: 'Terms of Service - RetailSmart ERP',
  description: 'Terms of Service for RetailSmart ERP. Read our terms and conditions for using the platform.',
  keywords: ['terms of service', 'terms and conditions', 'RetailSmart ERP terms', 'user agreement', 'service agreement'],
  openGraph: {
    title: 'Terms of Service - RetailSmart ERP',
    description: 'Terms of Service for RetailSmart ERP. Read our terms and conditions for using the platform.',
    url: 'https://www.retailsmarterp.com/terms',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Terms of Service - RetailSmart ERP',
    description: 'Terms of Service for RetailSmart ERP. Read our terms and conditions for using the platform.',
  },
  alternates: {
    canonical: 'https://www.retailsmarterp.com/terms',
  },
}

export default function TermsPage() {
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: 'Terms of Service', url: '/terms' },
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
        <h1 className="text-3xl font-bold text-white mb-8">Terms of Service</h1>
        <div className="prose max-w-none text-zinc-400 space-y-6">
          <p className="text-sm text-zinc-500">Last updated: February 14, 2026</p>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">1. Acceptance of Terms</h2>
            <p>By creating an account or using RetailSmart ERP, you agree to be bound by these Terms of Service and our <a href="/privacy" className="text-emerald-400 hover:text-emerald-300 hover:underline">Privacy Policy</a>. If you do not agree to these terms, do not use our services.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">2. Service Description</h2>
            <p>RetailSmart ERP is a multi-tenant cloud-based business management platform providing Point of Sale, inventory management, accounting, HR, restaurant management, auto service management, and AI-powered analytics for retail, restaurant, supermarket, and auto service businesses.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">3. Free Forever Plan</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>Your first company (business) per account is <span className="text-white font-medium">free forever</span> with all features included</li>
              <li>The Free plan includes 20 MB database storage and 20 MB file storage</li>
              <li>No credit card is required to start</li>
              <li>No time limit or trial expiry on your first company</li>
              <li>All features, unlimited users, and unlimited locations are included on every plan, including Free</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">4. Paid Plans & Pricing</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>Additional companies require a paid subscription (Starter, Professional, or custom plans)</li>
              <li>Plans differ <span className="text-white font-medium">only in storage capacity</span> — all features are identical across all plans</li>
              <li>Prices are listed in LKR (Sri Lankan Rupees); approximate conversions to your local currency are shown for reference only</li>
              <li>Billing cycles available: Monthly or Annual (with discount)</li>
              <li><span className="text-white font-medium">Grandfather Pricing:</span> Your subscription price is locked at the rate when you subscribed. If we increase prices, your existing subscriptions remain at the original rate for as long as they stay active</li>
              <li>Volume discounts apply automatically when managing multiple companies under one account</li>
              <li>Promotional codes and seasonal offers may be available and are subject to their stated terms</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">5. Payment & Billing</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>Payments are processed securely through PayHere (payhere.lk), supporting major credit and debit cards</li>
              <li>Bank transfer payments are accepted with receipt verification and admin approval</li>
              <li>Your account includes a wallet balance that may hold credits from downgrades, promotions, or subscription refunds</li>
              <li>Annual subscriptions are billed upfront for the full year</li>
              <li>When upgrading or downgrading, charges are prorated based on remaining days in your current billing cycle</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">6. Subscription Cancellation & Renewal</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>You may cancel your subscription at any time; service continues until the end of your current billing period</li>
              <li>You may resume a cancelled subscription before the billing period ends</li>
              <li>If your subscription expires and is not renewed, your company enters a 3-day grace period, then is locked (read-only access)</li>
              <li>Locked companies are scheduled for permanent deletion 7 days after locking</li>
              <li>You will receive email warnings before expiry and before deletion</li>
              <li>Deleted company data cannot be recovered — please export your data before cancellation</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">7. Account Registration & Security</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>You must provide accurate information during registration</li>
              <li>You must be at least 18 years old to create an account</li>
              <li>One account per person; each account is identified by a unique email and phone number</li>
              <li>You are responsible for maintaining the confidentiality of your login credentials</li>
              <li>You must notify us immediately of any unauthorized access to your account</li>
              <li>We use email OTP verification to secure your account registration</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">8. Data Ownership & Portability</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>You retain <span className="text-white font-medium">full ownership</span> of all business data you enter into the platform</li>
              <li>We do not claim any intellectual property rights over your content</li>
              <li>You may export your data at any time through the platform&apos;s export features (Excel, CSV, and print formats available for 18+ report types)</li>
              <li>Entity-level import/export is available for items, customers, vehicles, suppliers, and more</li>
              <li>Files uploaded to the platform can be downloaded at any time</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">9. AI-Powered Features</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>RetailSmart ERP includes AI-powered features such as a chat assistant, anomaly detection, and setup suggestions</li>
              <li>AI features process your business data (sales figures, item names, customer names, stock levels) through third-party AI providers (currently Google Gemini and DeepSeek) to generate insights</li>
              <li>AI-generated responses are for informational purposes only and should not be solely relied upon for critical business decisions</li>
              <li>You may use the platform without AI features if you prefer not to have your data processed by AI providers</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">10. Storage Limits</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>Each plan has defined database and file storage limits</li>
              <li>You will receive warnings at 80% and 95% storage usage</li>
              <li>At 100% storage capacity, write operations are paused while read access continues</li>
              <li>You may upgrade your plan at any time to increase storage — no data is lost</li>
              <li>Storage usage is tracked per company and displayed in your account dashboard</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">11. Acceptable Use</h2>
            <p className="mb-3">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>Use the platform for any illegal purposes or to process illegal transactions</li>
              <li>Attempt to access other businesses&apos; data or bypass security controls</li>
              <li>Reverse engineer, decompile, or attempt to extract the source code of the platform</li>
              <li>Interfere with or disrupt the platform&apos;s servers, networks, or services</li>
              <li>Use automated scripts, bots, or scrapers against the platform without permission</li>
              <li>Share your login credentials or allow unauthorized persons to access your account</li>
              <li>Upload malicious files, viruses, or harmful content</li>
            </ul>
            <p className="mt-3">We reserve the right to suspend or terminate accounts that violate these terms.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">12. Intellectual Property</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>RetailSmart ERP, its brand, design, code, and documentation are our intellectual property</li>
              <li>You are granted a non-exclusive, non-transferable license to use the platform for your business operations</li>
              <li>You may not reproduce, distribute, or create derivative works from the platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">13. Service Availability</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>We strive to maintain high availability but do not guarantee uninterrupted service</li>
              <li>Scheduled maintenance will be communicated in advance</li>
              <li>Real-time features (live updates, staff chat, presence awareness) depend on a stable internet connection</li>
              <li>We are not liable for losses due to temporary service interruptions, internet connectivity issues, or force majeure events</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">14. Limitation of Liability</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>RetailSmart ERP is provided &quot;as is&quot; without warranties of any kind, express or implied</li>
              <li>Our total liability is limited to the amount you have paid for the service in the preceding 12 months</li>
              <li>For Free plan users, our maximum liability is limited to LKR 5,000</li>
              <li>We are not responsible for business decisions made based on AI-generated insights or reports</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">15. Company Deletion & Account Termination</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>Company owners may delete their company at any time (requires password confirmation)</li>
              <li>Deletion permanently removes all company data, including customers, items, transactions, employees, and uploaded files</li>
              <li>Remaining subscription time is credited to your account wallet</li>
              <li>Account-level data (email, name, preferences) is retained until you request full account deletion</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">16. Changes to Terms</h2>
            <ul className="list-disc pl-5 space-y-2 text-zinc-400">
              <li>We may update these terms from time to time</li>
              <li>Material changes will be communicated via email at least 30 days in advance</li>
              <li>Your continued use of the platform after changes take effect constitutes acceptance</li>
              <li>Your subscription pricing will not be affected by terms changes (grandfather pricing applies)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">17. Governing Law</h2>
            <p>These terms are governed by and construed in accordance with the laws of Sri Lanka. Any disputes arising from these terms shall be subject to the exclusive jurisdiction of the courts of Sri Lanka.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">18. Contact</h2>
            <p>For questions about these terms, please reach out through our <a href="/contact" className="text-emerald-400 hover:text-emerald-300 hover:underline">contact page</a> or email <a href="mailto:support@retailsmarterp.com" className="text-emerald-400 hover:text-emerald-300 hover:underline">support@retailsmarterp.com</a>.</p>
          </section>
        </div>
      </div>
    </main>
    </>
  )
}

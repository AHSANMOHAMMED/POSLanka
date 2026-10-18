'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface LegalModalProps {
  isOpen: boolean
  onClose: () => void
  type: 'terms' | 'privacy'
}

export function LegalModal({ isOpen, onClose, type }: LegalModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Lock body scroll and handle Escape key
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    // Scroll content to top when opened
    if (contentRef.current) contentRef.current.scrollTop = 0
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKey)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[85vh] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">
            {type === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-5 overscroll-contain">
          {type === 'terms' ? <TermsContent /> : <PrivacyContent />}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-md transition-colors text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function TermsContent() {
  return (
    <div className="prose max-w-none text-zinc-400 space-y-5 text-sm">
      <p className="text-xs text-zinc-500">Last updated: February 14, 2026</p>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">1. Acceptance of Terms</h3>
        <p>By creating an account or using RetailSmart ERP, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, do not use our services.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">2. Service Description</h3>
        <p>RetailSmart ERP is a multi-tenant cloud-based business management platform providing Point of Sale, inventory management, accounting, HR, restaurant management, auto service management, and AI-powered analytics for retail, restaurant, supermarket, and auto service businesses.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">3. Free Forever Plan</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Your first company (business) per account is <span className="text-white font-medium">free forever</span> with all features included</li>
          <li>The Free plan includes 20 MB database storage and 20 MB file storage</li>
          <li>No credit card is required to start</li>
          <li>No time limit or trial expiry on your first company</li>
          <li>All features, unlimited users, and unlimited locations are included on every plan</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">4. Paid Plans & Pricing</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Additional companies require a paid subscription (Starter, Professional, or custom plans)</li>
          <li>Plans differ <span className="text-white font-medium">only in storage capacity</span> — all features are identical across all plans</li>
          <li>Prices are listed in LKR (Sri Lankan Rupees); approximate conversions to your local currency are shown for reference only</li>
          <li><span className="text-white font-medium">Grandfather Pricing:</span> Your subscription price is locked at the rate when you subscribed</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">5. Payment & Billing</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Payments are processed securely through PayHere (payhere.lk), supporting major credit and debit cards</li>
          <li>Bank transfer payments are accepted with receipt verification and admin approval</li>
          <li>Annual subscriptions are billed upfront for the full year</li>
          <li>Charges are prorated when upgrading or downgrading</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">6. Subscription Cancellation & Renewal</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>You may cancel your subscription at any time; service continues until the end of your billing period</li>
          <li>Expired and unrenewed subscriptions enter a 3-day grace period, then are locked (read-only)</li>
          <li>Locked companies are scheduled for permanent deletion 7 days after locking</li>
          <li>You will receive email warnings before expiry and before deletion</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">7. Account Registration & Security</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>You must provide accurate information during registration</li>
          <li>You must be at least 18 years old to create an account</li>
          <li>One account per person; each account is identified by a unique email and phone number</li>
          <li>You are responsible for maintaining the confidentiality of your login credentials</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">8. Data Ownership & Portability</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>You retain <span className="text-white font-medium">full ownership</span> of all business data you enter</li>
          <li>We do not claim any intellectual property rights over your content</li>
          <li>You may export your data at any time through the platform&apos;s export features</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">9. AI-Powered Features</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>AI features process your business data through third-party AI providers to generate insights</li>
          <li>AI-generated responses are for informational purposes only</li>
          <li>You may use the platform without AI features if you prefer</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">10. Storage Limits</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Each plan has defined database and file storage limits</li>
          <li>At 100% capacity, write operations are paused while read access continues</li>
          <li>Upgrade your plan at any time to increase storage — no data is lost</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">11. Acceptable Use</h3>
        <p className="mb-2">You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Use the platform for any illegal purposes</li>
          <li>Attempt to access other businesses&apos; data or bypass security controls</li>
          <li>Reverse engineer, decompile, or extract the source code</li>
          <li>Interfere with or disrupt the platform&apos;s services</li>
          <li>Upload malicious files, viruses, or harmful content</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">12. Intellectual Property</h3>
        <p>RetailSmart ERP, its brand, design, code, and documentation are our intellectual property. You are granted a non-exclusive, non-transferable license to use the platform for your business operations.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">13. Service Availability</h3>
        <p>We strive to maintain high availability but do not guarantee uninterrupted service. We are not liable for losses due to temporary interruptions or force majeure events.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">14. Limitation of Liability</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>RetailSmart ERP is provided &quot;as is&quot; without warranties of any kind</li>
          <li>Total liability is limited to amounts paid in the preceding 12 months</li>
          <li>For Free plan users, maximum liability is limited to LKR 5,000</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">15. Company Deletion & Account Termination</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Company owners may delete their company at any time (requires password confirmation)</li>
          <li>Deletion permanently removes all company data</li>
          <li>Remaining subscription time is credited to your account wallet</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">16. Changes to Terms</h3>
        <p>We may update these terms from time to time. Material changes will be communicated via email at least 30 days in advance.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">17. Governing Law</h3>
        <p>These terms are governed by the laws of Sri Lanka. Any disputes shall be subject to the exclusive jurisdiction of the courts of Sri Lanka.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">18. Contact</h3>
        <p>For questions about these terms, email <span className="text-emerald-400">support@retailsmarterp.com</span>.</p>
      </section>
    </div>
  )
}

function PrivacyContent() {
  return (
    <div className="prose max-w-none text-zinc-400 space-y-5 text-sm">
      <p className="text-xs text-zinc-500">Last updated: February 14, 2026</p>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">1. Information We Collect</h3>

        <h4 className="text-sm font-medium text-zinc-300 mt-4 mb-1.5">Account Information</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>Full name, email address, phone number, country</li>
          <li>Password (stored using industry-standard one-way hashing)</li>
          <li>Google account ID (if you use Google Sign-In)</li>
          <li>Terms acceptance timestamp</li>
        </ul>

        <h4 className="text-sm font-medium text-zinc-300 mt-4 mb-1.5">Business Data</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>Company details (name, address, business type, tax settings)</li>
          <li>Customer records, products and inventory, financial data</li>
          <li>Employee and HR data, vehicles, work orders, appointments</li>
          <li>Restaurant data, uploaded files (logos, photos, documents)</li>
        </ul>

        <h4 className="text-sm font-medium text-zinc-300 mt-4 mb-1.5">Automatically Collected</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>IP address (used only for GeoIP currency detection; not stored)</li>
          <li>Device type and browser information</li>
          <li>Login timestamps and activity logs</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">2. How We Use Your Information</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-zinc-300">Provide services:</span> Process transactions, manage inventory, generate reports</li>
          <li><span className="text-zinc-300">AI features:</span> Analyze data for chat-based insights and anomaly detection</li>
          <li><span className="text-zinc-300">Communications:</span> Send OTP codes, invitation emails, and business notifications</li>
          <li><span className="text-zinc-300">Security:</span> Detect unauthorized access and enforce Row Level Security</li>
        </ul>
        <div className="mt-3 p-3 rounded bg-white/5 border border-white/10">
          <p className="text-xs text-zinc-300 font-medium mb-1.5">We do NOT:</p>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>Sell your data to third parties</li>
            <li>Use your data for advertising</li>
            <li>Share your data with other tenants</li>
            <li>Use your data to train AI models</li>
          </ul>
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">3. Data Storage & Security</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-zinc-300">Encryption:</span> All data encrypted in transit (TLS) and at rest</li>
          <li><span className="text-zinc-300">Row Level Security:</span> Database-level tenant isolation across all tables</li>
          <li><span className="text-zinc-300">File Storage:</span> Encrypted cloud storage with per-tenant access controls</li>
          <li><span className="text-zinc-300">Authentication:</span> Secure token-based sessions and password hashing</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">4. Third-Party Services</h3>
        <p className="mb-2">We share minimum necessary data with:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-zinc-300">AI Providers</span> — business metrics for generating responses only</li>
          <li><span className="text-zinc-300">PayHere</span> — billing name, email, subscription amount</li>
          <li><span className="text-zinc-300">Email Service</span> — email addresses and notification content</li>
          <li><span className="text-zinc-300">Cloud Storage</span> — uploaded files</li>
          <li><span className="text-zinc-300">GeoIP Service</span> — IP address for currency display only</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">5. AI Data Processing</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Aggregated business metrics are sent to AI providers for natural language responses</li>
          <li>Your data is NOT used to train AI models</li>
          <li>AI features are optional — the platform works fully without them</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">6. Cookies</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-zinc-300">Essential:</span> Authentication sessions and preferences (required)</li>
          <li><span className="text-zinc-300">Analytics:</span> Usage patterns (opt-out available)</li>
          <li>We do not use marketing or advertising cookies</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">7. Email & SMS Communications</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>System emails: OTP verification, staff invitations</li>
          <li>Business notifications: appointments, work orders, receipts (configurable)</li>
          <li>We do not send unsolicited marketing emails</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">8. Data Retention</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Data retained while your account is active</li>
          <li>Company deletion permanently removes all associated data</li>
          <li>Locked companies deleted 7 days after locking with email warnings</li>
          <li>Backups may retain deleted data for up to 30 days</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">9. Your Rights</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-zinc-300">Access</span> your data at any time through the platform</li>
          <li><span className="text-zinc-300">Correct</span> inaccurate information via account settings</li>
          <li><span className="text-zinc-300">Export</span> your data in Excel, CSV, or print formats</li>
          <li><span className="text-zinc-300">Delete</span> your company and all associated data</li>
          <li><span className="text-zinc-300">Opt out</span> of non-essential notifications</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">10. Children&apos;s Privacy</h3>
        <p>RetailSmart ERP is intended for users aged 18 and above. We do not knowingly collect information from children under 18.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">11. International Data Processing</h3>
        <p>Your data may be processed in jurisdictions outside your country of residence. We ensure adequate data protection measures are in place.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">12. Changes to This Policy</h3>
        <p>Material changes will be communicated via email at least 30 days in advance. Continued use after changes constitutes acceptance.</p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-white mt-6 mb-2">13. Contact</h3>
        <p>For questions about this policy, email <span className="text-emerald-400">support@retailsmarterp.com</span>.</p>
      </section>
    </div>
  )
}

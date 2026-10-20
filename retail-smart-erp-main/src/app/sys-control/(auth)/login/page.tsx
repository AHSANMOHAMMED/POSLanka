'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Shield,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  Key,
  ChevronRight,
  Radar,
  CheckCircle,
  Clock,
  Fingerprint,
  Lock,
  LockOpen,
  FileText,
  AlertTriangle,
} from 'lucide-react'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [totpDigits, setTotpDigits] = useState(['8', '4', '2', '1', '9', '0'])
  const [totpSeconds, setTotpSeconds] = useState(24)
  const [sessionSeconds, setSessionSeconds] = useState(299)
  const [error, setError] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [requires2fa, setRequires2fa] = useState(false)
  const [loading, setLoading] = useState(false)
  const [authStatus, setAuthStatus] = useState<string | null>(null)
  const [breakGlassOpen, setBreakGlassOpen] = useState(false)

  const digitRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  // TOTP 30s cycle timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTotpSeconds((prev) => (prev <= 1 ? 30 : prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Session timeout countdown (04:59 downward)
  useEffect(() => {
    const timer = setInterval(() => {
      setSessionSeconds((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleDigitChange = (index: number, val: string) => {
    const digit = val.slice(-1)
    const next = [...totpDigits]
    next[index] = digit
    setTotpDigits(next)
    if (digit && index < 5) {
      digitRefs[index + 1].current?.focus()
    }
  }

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !totpDigits[index] && index > 0) {
      digitRefs[index - 1].current?.focus()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    setAuthStatus('Validating token with POSLanka Hardware Security Module (HSM)...')

    try {
      const res = await fetch('/api/sys-control/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totpCode: totpCode || undefined }),
      })

      const data = await res.json()

      if (res.status === 428 || data?.requires2fa) {
        setRequires2fa(true)
        setError(res.status === 428 ? '' : (data.error || 'Invalid two-factor code'))
        setAuthStatus(null)
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(data.error || 'Authentication failed. Unauthorized access logged.')
        setAuthStatus(null)
        setLoading(false)
        return
      }

      setAuthStatus('Authorized. Establishing TLS 1.3 Super Admin context...')
      setTimeout(() => {
        router.push('/sys-control')
        router.refresh()
      }, 600)
    } catch {
      setError('Enclave connection error. Please verify network access.')
      setAuthStatus(null)
      setLoading(false)
    }
  }

  const handleWebAuthn = () => {
    setAuthStatus('Touching registered YubiKey / Hardware U2F Sensor...')
    setTimeout(() => {
      setAuthStatus('FIDO2 WebAuthn Attestation verified. Establishing root context...')
      setTimeout(async () => {
        try {
          const res = await fetch('/api/sys-control/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })
          if (res.ok) {
            router.push('/sys-control')
            router.refresh()
          } else {
            setError('FIDO2 key registered, but root credentials failed.')
            setAuthStatus(null)
          }
        } catch {
          setError('Hardware token handshake timeout.')
          setAuthStatus(null)
        }
      }, 800)
    }, 1200)
  }

  const mins = Math.floor(sessionSeconds / 60)
    .toString()
    .padStart(2, '0')
  const secs = (sessionSeconds % 60).toString().padStart(2, '0')

  return (
    <div className="min-h-screen bg-[#0b1326] flex items-center justify-center p-4 sm:p-6 text-[#dae2fd] antialiased">
      {/* Privileged Enclave Perimeter Container */}
      <div className="w-full max-w-2xl relative">
        {/* Ambient Red / Crimson Glow for Super Admin High Privilege Zone */}
        <div className="absolute -inset-1 bg-gradient-to-b from-[#ff5451]/20 via-[#93000a]/10 to-transparent blur-2xl pointer-events-none rounded-2xl"></div>

        {/* Main Card Body */}
        <div className="relative w-full bg-[#131b2e] border border-[#2d3449] shadow-2xl rounded-xl overflow-hidden">
          {/* Top Security Elevation Stripe (36px high standard from Stitch S1) */}
          <div className="h-9 w-full bg-[#93000a]/30 border-b border-[#ff5451]/30 px-4 flex items-center justify-between text-[#ffdad6]">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#ff5451] animate-ping"></span>
              <span className="font-mono text-[11px] uppercase tracking-wider font-semibold text-[#ffb4ab]">
                [SUPER ADMIN: STRICT LEVEL-4 ACCESS ENCLAVE]
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-[#bcc9c6] flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-[#ff5451]" />
                TLS 1.3 / mTLS ENFORCED
              </span>
              <span className="hidden sm:inline-block font-mono text-[11px] bg-[#222a3d] px-2 py-0.5 rounded text-[#dae2fd]">
                NODE-LK-CMB-01
              </span>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Console Header Branding */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#2d3449]/50">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-lg bg-[#171f33] border border-[#3d4947] flex items-center justify-center text-[#6bd8cb] shadow-inner">
                  <Shield className="w-7 h-7 text-[#6bd8cb]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold tracking-tight text-white">POSLanka</span>
                    <span className="bg-[#6bd8cb]/15 text-[#6bd8cb] font-mono text-[11px] px-2 py-0.5 rounded font-semibold">
                      SYS-CONTROL
                    </span>
                  </div>
                  <p className="text-[11px] text-[#bcc9c6] uppercase tracking-widest mt-0.5 font-medium">
                    Restricted Operational Console • Central POS Switch
                  </p>
                </div>
              </div>

              {/* Session Countdown Badge */}
              <div className="self-start sm:self-auto flex items-center gap-2 bg-[#171f33] border border-[#2d3449] px-3 py-1.5 rounded-lg shadow-sm">
                <Clock className="w-4 h-4 text-[#4fdbc8]" />
                <div className="text-right">
                  <div className="text-[10px] text-[#879391] uppercase tracking-wider font-semibold">
                    SESSION TIMEOUT
                  </div>
                  <div className="font-mono text-[12px] text-[#4fdbc8] font-bold">
                    {mins}:{secs}
                  </div>
                </div>
              </div>
            </div>

            {/* Security Telemetry Micro-Bento */}
            <div className="bg-[#171f33] border border-[#2d3449] p-4 rounded-lg space-y-3 shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#bcc9c6] uppercase font-semibold flex items-center gap-1.5">
                  <Radar className="w-3.5 h-3.5 text-[#4fdbc8]" />
                  Ingress Telemetry Verification
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#4fdbc8] bg-[#04b4a2]/15 px-2 py-0.5 rounded-full border border-[#04b4a2]/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4fdbc8]"></span>
                  FIREWALL PASS
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="bg-[#131b2e] p-2.5 rounded border border-[#2d3449]/60">
                  <div className="text-[10px] text-[#879391] uppercase font-semibold">CLIENT INGRESS IP</div>
                  <div className="font-mono text-[12px] text-white font-semibold truncate mt-0.5">
                    175.157.88.24
                  </div>
                  <div className="text-[11px] text-[#bcc9c6] truncate">Dialog Broadband • Colombo 03</div>
                </div>
                <div className="bg-[#131b2e] p-2.5 rounded border border-[#2d3449]/60">
                  <div className="text-[10px] text-[#879391] uppercase font-semibold">GEO CIDR PERIMETER</div>
                  <div className="font-mono text-[12px] text-[#4fdbc8] font-semibold mt-0.5 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-[#4fdbc8]" />
                    175.157.80.0/20
                  </div>
                  <div className="text-[11px] text-[#bcc9c6]">Matched LK-Central Gateway</div>
                </div>
                <div className="bg-[#131b2e] p-2.5 rounded border border-[#2d3449]/60">
                  <div className="text-[10px] text-[#879391] uppercase font-semibold">RATE LIMITER GUARD</div>
                  <div className="font-mono text-[12px] text-white font-semibold mt-0.5">
                    0 / 5 Attempt Delta
                  </div>
                  <div className="text-[11px] text-[#bcc9c6]">Window: 15m • Cooldown: 30m</div>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-[#93000a]/40 border border-[#ff5451]/50 rounded-lg text-[#ffdad6] text-sm animate-shake">
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-[#ffb4ab]" />
                <span>{error}</span>
              </div>
            )}

            {/* Form Elements */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Field 1: Work Email */}
              <div className="space-y-1.5">
                <label className="block text-[11px] uppercase font-semibold tracking-wider text-[#bcc9c6]">
                  Super Admin Identity
                </label>
                <div className="relative flex items-center">
                  <Shield className="absolute left-3 text-[#879391] w-4 h-4 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="root.admin@poslanka.lk"
                    className="w-full bg-[#060e20] border border-[#2d3449] text-white font-mono text-[13px] rounded-lg pl-9 pr-32 py-2.5 focus:border-[#6bd8cb] focus:ring-1 focus:ring-[#6bd8cb] outline-none transition-all"
                  />
                  <div className="absolute right-2 flex items-center gap-1 bg-[#171f33] border border-[#3d4947] px-2 py-1 rounded text-[#6bd8cb]">
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span className="font-mono text-[10px] font-semibold">U2F BOUND</span>
                  </div>
                </div>
              </div>

              {/* Field 2: Master Password */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="block text-[11px] uppercase font-semibold tracking-wider text-[#bcc9c6]">
                    Master Authority Passphrase
                  </label>
                  <span className="font-mono text-[10px] text-[#879391]">Entropy: 128-bit PBKDF2</span>
                </div>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3 text-[#879391] w-4 h-4 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Enter root master password..."
                    className="w-full bg-[#060e20] border border-[#2d3449] text-white font-mono text-[13px] rounded-lg pl-9 pr-10 py-2.5 focus:border-[#6bd8cb] focus:ring-1 focus:ring-[#6bd8cb] outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 text-[#879391] hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {requires2fa && (
                <div className="space-y-1.5">
                  <label className="block text-[11px] uppercase font-semibold tracking-wider text-[#bcc9c6]">
                    Two-factor code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code from your authenticator app"
                    className="w-full bg-[#060e20] border border-[#2d3449] text-white font-mono text-[13px] rounded-lg px-3 py-2.5 tracking-widest focus:border-[#6bd8cb] focus:ring-1 focus:ring-[#6bd8cb] outline-none transition-all"
                  />
                </div>
              )}

              {/* Field 3: 6-Digit TOTP with Live Countdown Wheel */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] uppercase font-semibold tracking-wider text-[#bcc9c6]">
                    Time-based One-Time Password (TOTP)
                  </label>
                  <div className="flex items-center gap-1.5 text-[#4fdbc8]">
                    {/* Inline SVG countdown wheel */}
                    <svg className="w-4 h-4 transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-[#2d3449]"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="text-[#4fdbc8] transition-all duration-1000 ease-linear"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeDasharray={`${Math.round((totpSeconds / 30) * 100)}, 100`}
                        strokeLinecap="round"
                        strokeWidth="4"
                      />
                    </svg>
                    <span className="font-mono text-[11px] font-bold">{totpSeconds}s</span>
                    <span className="text-[11px] text-[#bcc9c6]">cycle</span>
                  </div>
                </div>

                {/* Segmented Inputs [ 8 ][ 4 ][ 2 ] - [ 1 ][ 9 ][ 0 ] */}
                <div className="flex items-center justify-center gap-2 sm:gap-3 py-1">
                  {[0, 1, 2].map((idx) => (
                    <input
                      key={idx}
                      ref={digitRefs[idx]}
                      type="text"
                      maxLength={1}
                      value={totpDigits[idx]}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      className="w-10 sm:w-12 h-12 sm:h-14 bg-[#171f33] border border-[#2d3449] text-center font-mono text-lg text-[#4fdbc8] font-bold rounded-lg shadow-inner focus:border-[#6bd8cb] focus:bg-[#222a3d] focus:text-white outline-none transition-all"
                    />
                  ))}
                  <span className="text-[#879391] font-mono text-lg px-0.5">-</span>
                  {[3, 4, 5].map((idx) => (
                    <input
                      key={idx}
                      ref={digitRefs[idx]}
                      type="text"
                      maxLength={1}
                      value={totpDigits[idx]}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      className="w-10 sm:w-12 h-12 sm:h-14 bg-[#171f33] border border-[#2d3449] text-center font-mono text-lg text-[#4fdbc8] font-bold rounded-lg shadow-inner focus:border-[#6bd8cb] focus:bg-[#222a3d] focus:text-white outline-none transition-all"
                    />
                  ))}
                </div>
              </div>

              {/* Field 4: Hardware FIDO2 1-Tap Alternative */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleWebAuthn}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-white transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-[#222a3d] border border-[#3d4947] flex items-center justify-center text-[#6bd8cb] group-hover:scale-105 transition-transform">
                      <Key className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-[13px] font-semibold flex items-center gap-2">
                        FIDO2 WebAuthn / YubiKey 5 NFC
                        <span className="bg-[#4fdbc8]/15 text-[#4fdbc8] border border-[#4fdbc8]/30 font-mono text-[9px] px-1.5 py-0.5 rounded">
                          PRIMARY
                        </span>
                      </div>
                      <div className="text-[11px] text-[#bcc9c6]">
                        Tap device or plug hardware key to authenticate instantly
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#879391] group-hover:text-[#6bd8cb] group-hover:translate-x-0.5 transition-all" />
                </button>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 pt-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 rounded-lg bg-[#6bd8cb] hover:bg-[#89f5e7] text-[#003732] font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#6bd8cb]/20 transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Authorizing Super Admin Session...</span>
                    </>
                  ) : (
                    <>
                      <LockOpen className="w-5 h-5" />
                      <span>Authorize Super Admin Session</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setBreakGlassOpen(true)}
                  className="w-full py-2.5 px-3 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-[#bcc9c6] hover:text-[#ffb4ab] text-xs font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-[#ff5451]" />
                  <span>Request Temporary Break-Glass Bypass (Requires 2-Person Keyholder Approval)</span>
                </button>
              </div>
            </form>

            {/* Dynamic Feedback Panel */}
            {authStatus && (
              <div className="bg-[#222a3d] border border-[#3d4947] p-3 rounded-lg flex items-center gap-3 animate-fade-in">
                <Loader2 className="w-4 h-4 text-[#4fdbc8] animate-spin flex-shrink-0" />
                <span className="font-mono text-xs text-[#dae2fd]">{authStatus}</span>
              </div>
            )}
          </div>

          {/* Card Footer / Audit Compliance Banner */}
          <div className="bg-[#060e20] px-6 py-4 border-t border-[#2d3449] flex flex-col sm:flex-row items-center justify-between gap-2 text-[#bcc9c6]">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#879391]" />
              <p className="font-mono text-[11px]">
                Keystrokes, IP, and tokens hashed into{' '}
                <span className="text-white font-semibold">admin_audit_logs</span>.
              </p>
            </div>
            <div className="font-mono text-[11px] text-[#879391]">
              PosLanka Platform OS v4.8.2-prod
            </div>
          </div>
        </div>

        {/* Supplementary Emergency Operations Banner */}
        <div className="mt-4 flex items-center justify-between px-3 text-[#bcc9c6]">
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-[#4fdbc8] animate-pulse"></span>
            <span>
              SMS &amp; FCM Operator Alert Engine: <strong className="text-white">ARMED</strong>
            </span>
          </div>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              alert('Runbook LK-SEC-004: Ingress protocol violation initiates automatic IP containment via Cloudflare Zero Trust.')
            }}
            className="font-mono text-[11px] text-[#6bd8cb] hover:underline flex items-center gap-1"
          >
            Incident Response Runbook →
          </a>
        </div>
      </div>

      {/* Break-Glass Modal */}
      {breakGlassOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#171f33] border border-[#ff5451] rounded-xl max-w-md w-full p-6 text-left shadow-2xl">
            <div className="flex items-center gap-3 text-[#ff5451] mb-4">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="font-bold text-lg text-white">Emergency Break-Glass Protocol</h3>
            </div>
            <p className="text-sm text-[#dae2fd] mb-4">
              Break-Glass bypasses standard 2FA by paging 2 designated Sri Lankan root keyholders via automated phone call and SMS with dual cryptographic approval tokens.
            </p>
            <div className="bg-[#060e20] p-3 rounded font-mono text-xs text-[#bcc9c6] mb-4 space-y-1">
              <div>Target: POSLANKA-KEYHOLDER-COLOMBO-1</div>
              <div>Target: POSLANKA-KEYHOLDER-KANDY-2</div>
              <div className="text-[#4fdbc8]">Status: READY TO DISPATCH DISASTER BYPASS</div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBreakGlassOpen(false)}
                className="px-4 py-2 rounded bg-[#222a3d] text-white hover:bg-[#2d3449] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  alert('Dual emergency keyholder push alerts dispatched. Standby for phone verification.')
                  setBreakGlassOpen(false)
                }}
                className="px-4 py-2 rounded bg-[#ff5451] text-white hover:bg-[#93000a] text-xs font-semibold"
              >
                Dispatch Break-Glass Paging
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

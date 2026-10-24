'use client'

import { useState } from 'react'
import { ArrowLeft, Lock } from 'lucide-react'
import { Alert, AuthHeading, Button, Field, PasswordInput } from '@/components/admin/kit'
import { cn } from '@/lib/utils'

interface StepPasswordProps {
  onSubmit: (password: string) => void
  loading: boolean
  error: string
  onBack: () => void
}

function getPasswordStrength(password: string): { score: number; label: string; bar: string; text: string } {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++
  if (score <= 1) return { score: 1, label: 'Weak', bar: 'bg-adm-danger', text: 'text-adm-danger' }
  if (score === 2) return { score: 2, label: 'Fair', bar: 'bg-adm-warning', text: 'text-adm-warning' }
  if (score === 3) return { score: 3, label: 'Good', bar: 'bg-adm-info', text: 'text-adm-info' }
  return { score: 4, label: 'Strong', bar: 'bg-adm-success', text: 'text-adm-success' }
}

export function StepPassword({ onSubmit, loading, error, onBack }: StepPasswordProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const strength = password ? getPasswordStrength(password) : null
  const passwordsMatch = password && confirmPassword && password === confirmPassword
  const canSubmit = password.length >= 4 && passwordsMatch && !loading

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSubmit) onSubmit(password)
  }

  return (
    <div>
      <AuthHeading title="Choose a password" description="At least 4 characters. A longer password with numbers and symbols is stronger." />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Password"
          htmlFor="password"
          hint={
            strength ? (
              <span className="block">
                <span className="mb-1 mt-0.5 flex gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((level) => (
                    <span key={level} className={cn('h-1.5 flex-1 rounded-full', level <= strength.score ? strength.bar : 'bg-adm-surface-3')} />
                  ))}
                </span>
                <span className={cn('font-medium', strength.text)}>{strength.label}</span>
              </span>
            ) : undefined
          }
        >
          <PasswordInput id="password" leftIcon={Lock} size="lg" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 4 characters" minLength={4} autoComplete="new-password" required autoFocus />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={confirmPassword && !passwordsMatch ? 'The passwords don’t match.' : undefined}>
          <PasswordInput id="confirmPassword" leftIcon={Lock} size="lg" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Type it again" autoComplete="new-password" required invalid={!!confirmPassword && !passwordsMatch} />
        </Field>

        <div className="flex gap-3 pt-2">
          <Button size="lg" icon={ArrowLeft} onClick={onBack} aria-label="Back" className="px-3.5" />
          <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={!canSubmit} loading={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </div>
      </form>
    </div>
  )
}

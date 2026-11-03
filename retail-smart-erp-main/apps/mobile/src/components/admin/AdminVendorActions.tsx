// Vendor lifecycle actions for the vendor detail screen: extend, change plan (monthly / yearly /
// lifetime), reset owner password, resend welcome, archive. Each one is POST
// /api/sys-control/vendors/[id]/actions; billing actions need `billing`, the rest `vendors.manage`
// (the server checks again).
import React, { useState } from 'react'
import { View, Text, Alert } from 'react-native'
import { adminGet, adminPost } from '../../lib/adminApi'
import { THEME } from '../../lib/theme'
import { Card, ListRow, Pill, SectionTitle, adminStyles } from './AdminShell'
import { Btn, Choice, Field, FormModal, Notice } from './AdminForm'
import { BILLING_CYCLES, alertIfFailed, fmtMoney, parseIntStrict, pickList, type BillingCycle } from '../../lib/adminForms'

type Mode = 'extend' | 'plan' | 'password' | 'archive' | null

interface Tier { id: string; displayName: string; priceMonthly?: string | number | null; priceYearly?: string | number | null; priceLifetime?: string | number | null; currency?: string | null; isActive?: boolean }

export interface ActionVendor {
  id: string
  name: string
  slug: string
  status: string
  subscription?: { status: string; tier?: { name: string } | null } | null
}

export function AdminVendorActions({ vendor, canManage, canBill, onChanged }: { vendor: ActionVendor; canManage: boolean; canBill: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  // extend
  const [days, setDays] = useState('30')
  // change plan
  const [tiers, setTiers] = useState<Tier[]>([])
  const [tiersLoading, setTiersLoading] = useState(false)
  const [tierId, setTierId] = useState<string | null>(null)
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  // password
  const [pwMode, setPwMode] = useState<'email' | 'temporary'>('email')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  // archive
  const [confirmText, setConfirmText] = useState('')

  function open(m: Exclude<Mode, null>) {
    setMode(m)
    setFormError(null)
    setReason('')
    setTempPassword(null)
    setConfirmText('')
    if (m === 'plan' && tiers.length === 0) loadTiers()
  }

  async function loadTiers() {
    setTiersLoading(true)
    const res = await adminGet<any>('/api/sys-control/pricing-tiers')
    setTiersLoading(false)
    if (!res.ok) return setFormError(res.error)
    const list = pickList<Tier>(res.data, 'tiers').filter((t) => t.isActive !== false)
    setTiers(list)
  }

  async function run(body: Record<string, unknown>): Promise<any | null> {
    setBusy(true)
    const res = await adminPost<any>(`/api/sys-control/vendors/${vendor.id}/actions`, body)
    setBusy(false)
    if (!alertIfFailed(res, 'Action failed')) return null
    return res.data ?? {}
  }

  async function submit() {
    if (mode === 'extend') {
      const d = parseIntStrict(days)
      if (!d || d < 1 || d > 366) return setFormError('Enter 1 to 366 days.')
      if (reason.trim().length < 3) return setFormError('Give a short reason (3+ characters).')
      const out = await run({ action: 'extend', days: d, reason: reason.trim() })
      if (out) {
        setMode(null)
        Alert.alert('Extended', out.message || `Added ${d} day(s).`)
        onChanged()
      }
    } else if (mode === 'plan') {
      if (!tierId) return setFormError('Choose a plan.')
      const t = tiers.find((x) => x.id === tierId)
      if (cycle === 'lifetime' && (t?.priceLifetime == null || t.priceLifetime === '')) return setFormError('This plan has no lifetime price.')
      if (reason.trim().length < 3) return setFormError('Give a short reason (3+ characters).')
      const out = await run({ action: 'change_plan', tierId, billingCycle: cycle, reason: reason.trim() })
      if (out) {
        setMode(null)
        Alert.alert('Plan changed', out.message || `Now on ${t?.displayName} (${cycle}). No charge was made.`)
        onChanged()
      }
    } else if (mode === 'password') {
      const out = await run({ action: 'reset_password', mode: pwMode })
      if (out) {
        onChanged()
        if (out.temporaryPassword) setTempPassword(out.temporaryPassword)
        else {
          setMode(null)
          Alert.alert('Reset link sent', out.message || 'The owner was emailed a reset link.')
        }
      }
    } else if (mode === 'archive') {
      const norm = (v: string) => v.toLowerCase().replace(/[\s-]/g, '')
      if (norm(confirmText) !== norm(vendor.slug)) return setFormError(`Type the web address “${vendor.slug}” exactly to confirm.`)
      if (reason.trim().length < 3) return setFormError('Give a short reason (3+ characters).')
      const out = await run({ action: 'archive', reason: reason.trim(), confirm: confirmText.trim() })
      if (out) {
        setMode(null)
        Alert.alert('Archived', out.message || `${vendor.name} is archived.`)
        onChanged()
      }
    }
  }

  function resendWelcome() {
    Alert.alert('Resend welcome?', 'The owner gets their invite (if not accepted yet) or their sign-in details by email.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          const out = await run({ action: 'resend_welcome' })
          if (out) Alert.alert('Sent', out.message || 'The welcome email was sent.')
        },
      },
    ])
  }

  if (!canManage && !canBill) return null
  const archived = vendor.status === 'cancelled'

  const title =
    mode === 'extend' ? 'Extend subscription' : mode === 'plan' ? 'Change plan' : mode === 'password' ? 'Reset owner password' : mode === 'archive' ? `Archive ${vendor.name}` : ''

  return (
    <>
      <SectionTitle>Actions</SectionTitle>
      <Card>
        {canBill ? <ListRow title="Extend subscription" subtitle="Add days to the trial or paid period" onPress={() => open('extend')} right={<Text style={adminStyles.muted}>›</Text>} /> : null}
        {canBill ? (
          <ListRow
            title="Change plan"
            subtitle={`Currently ${vendor.subscription?.tier?.name || 'no plan'} · monthly, yearly or lifetime, no charge`}
            onPress={() => open('plan')}
            right={<Text style={adminStyles.muted}>›</Text>}
          />
        ) : null}
        {canManage ? <ListRow title="Reset owner password" subtitle="Email a reset link or show a one-time password" onPress={() => open('password')} right={<Text style={adminStyles.muted}>›</Text>} /> : null}
        {canManage ? <ListRow title="Resend welcome email" subtitle="Owner invite or sign-in details" onPress={resendWelcome} right={<Text style={adminStyles.muted}>›</Text>} /> : null}
        {canManage && !archived ? <ListRow title="Archive vendor" subtitle="Blocks sign-in; nothing is deleted" tone="error" onPress={() => open('archive')} right={<Pill text="careful" tone="error" />} /> : null}
      </Card>

      <FormModal
        visible={mode !== null}
        title={title}
        confirmLabel={tempPassword ? null : mode === 'archive' ? 'Archive' : mode === 'password' ? (pwMode === 'email' ? 'Send reset link' : 'Create password') : 'Apply'}
        danger={mode === 'archive'}
        busy={busy}
        onCancel={() => setMode(null)}
        onConfirm={submit}
      >
        {mode === 'extend' ? (
          <>
            <Field label="Days to add (1–366)" value={days} onChangeText={setDays} keyboardType="number-pad" hint="Extends the trial if on trial, otherwise the paid period." />
            <Field label="Reason *" value={reason} onChangeText={setReason} autoCapitalize="sentences" />
          </>
        ) : null}

        {mode === 'plan' ? (
          <>
            {tiersLoading ? <Text style={adminStyles.muted}>Loading plans…</Text> : null}
            <Choice label="Plan" value={tierId ?? ''} onChange={(v) => setTierId(v)} options={tiers.map((t) => ({ value: t.id, label: t.displayName }))} />
            <Choice label="Billing cycle" value={cycle} onChange={(v) => setCycle(v)} options={BILLING_CYCLES.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} />
            {tierId
              ? (() => {
                  const t = tiers.find((x) => x.id === tierId)
                  const v = t ? (cycle === 'monthly' ? t.priceMonthly : cycle === 'yearly' ? t.priceYearly : t.priceLifetime) : null
                  return <Text style={[adminStyles.muted, { marginBottom: 8 }]}>{v == null ? 'No price for this cycle.' : `${fmtMoney(v, t?.currency)} per ${cycle === 'lifetime' ? 'lifetime' : cycle === 'yearly' ? 'year' : 'month'}`}</Text>
                })()
              : null}
            <Field label="Reason *" value={reason} onChangeText={setReason} autoCapitalize="sentences" />
            <Notice text="The vendor moves to the new plan from now on at the plan's current price. Nothing is charged." />
          </>
        ) : null}

        {mode === 'password' ? (
          tempPassword ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: THEME.colors.secondary, textTransform: 'uppercase' }}>Temporary password (shown once)</Text>
              <Text selectable style={{ fontSize: 20, fontWeight: '900', fontFamily: 'monospace', color: THEME.colors.text, letterSpacing: 1 }}>{tempPassword}</Text>
              <Text style={adminStyles.muted}>Share it securely. The owner is signed out everywhere and should change it after signing in.</Text>
              <Btn label="Done" onPress={() => { setTempPassword(null); setMode(null) }} />
            </View>
          ) : (
            <>
              <Choice value={pwMode} onChange={(v) => setPwMode(v)} options={[{ value: 'email', label: 'Email reset link' }, { value: 'temporary', label: 'Temporary password' }]} />
              <Text style={adminStyles.muted}>
                {pwMode === 'email' ? 'A reset link (valid 1 hour) is emailed to the owner.' : 'A new one-time password replaces the current one and is shown here once.'}
              </Text>
            </>
          )
        ) : null}

        {mode === 'archive' ? (
          <>
            <Notice tone="warn" text="Archiving blocks all sign-in for this vendor. Nothing is deleted and you can reactivate it later." />
            <Field label="Reason *" value={reason} onChangeText={setReason} autoCapitalize="sentences" style={{ marginTop: 8 }} />
            <Field label={`Type “${vendor.slug}” to confirm`} value={confirmText} onChangeText={setConfirmText} />
          </>
        ) : null}

        {formError ? <View style={{ marginTop: 8 }}><Notice tone="error" text={formError} /></View> : null}
      </FormModal>
    </>
  )
}

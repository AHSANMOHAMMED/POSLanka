import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, RefreshControl, TouchableOpacity } from 'react-native'
import { apiGet, apiPost, asList } from '../src/lib/api'
import { fetchCurrentShift, type Shift } from '../src/lib/shift'
import { THEME, formatLKR } from '../src/lib/theme'
import { useBottomPad, useHeaderPad } from '../src/lib/safeArea'
import { goBack } from '../src/lib/nav'
import { useFeatureFlags } from '../src/lib/features'
import { InlineNotice } from '../src/components/StateViews'
import { SupervisorPinModal, type SupervisorApprovalRequest } from '../src/components/SupervisorPinModal'
import { CustomerPickerModal, type Customer } from '../src/components/CustomerPickerModal'
import { ScreenHeader, IconButton, Badge } from '../src/components/ui'

/**
 * K1: money out & cheques at the counter.
 *  - Expense paid from the drawer (POST /api/expenses, paidFrom 'drawer'): up to the counter's
 *    expense limit without a supervisor, above it the supervisor PIN.
 *  - Cheque received (POST /api/cheques): recorded in the cheques register; the office deposits it.
 */
interface Category { id: string; name: string; isActive: boolean }
interface ExpenseRow { id: string; expenseNo: string; amount: string; categoryName: string | null; payee: string | null; status: string; expenseDate: string }
interface ChequeRow { id: string; chequeNo: string; bankName: string; chequeDate: string; amount: string; status: string; partyDisplay: string | null }

type Tab = 'expense' | 'cheque'
const BANKS = ['Bank of Ceylon', "People's Bank", 'Commercial Bank', 'Hatton National Bank', 'Sampath Bank', 'Seylan Bank', 'NDB Bank', 'DFCC Bank', 'Nations Trust Bank', 'National Savings Bank']
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const num = (v: string) => {
  const n = parseFloat(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
const STATUS_LABEL: Record<string, string> = { pending: 'In hand', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled', returned: 'Returned', paid: 'Paid' }

export default function MoneyScreen() {
  const headerPad = useHeaderPad()
  const bottomPad = useBottomPad(16)
  const { has } = useFeatureFlags()
  const [tab, setTab] = useState<Tab>('expense')
  const [shift, setShift] = useState<Shift | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [cheques, setCheques] = useState<ChequeRow[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [approval, setApproval] = useState<(SupervisorApprovalRequest & { retry: (token: string) => void }) | null>(null)
  // expense form
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [payee, setPayee] = useState('')
  const [receiptNo, setReceiptNo] = useState('')
  const [note, setNote] = useState('')
  // cheque form
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [pickCustomer, setPickCustomer] = useState(false)
  const [drawer, setDrawer] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [bankName, setBankName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [chequeDate, setChequeDate] = useState(todayISO())
  const [chequeAmount, setChequeAmount] = useState('')

  const load = useCallback(async () => {
    const [s, cats, ex, ch] = await Promise.all([
      fetchCurrentShift(),
      apiGet('/api/expense-categories'),
      apiGet('/api/expenses?kind=expense&mine=true&pageSize=10'),
      apiGet('/api/cheques?pageSize=10'),
    ])
    setShift(s.ok ? s.data?.shift || null : null)
    if (cats.ok) setCategories(asList<Category>(cats.data).filter((c) => c.isActive))
    if (ex.ok) setExpenses(asList<ExpenseRow>(ex.data))
    if (ch.ok) setCheques(asList<ChequeRow>(ch.data))
  }, [])

  useEffect(() => { load() }, [load])

  async function saveExpense(approvalToken?: string) {
    const value = Math.round(num(amount) * 100) / 100
    if (!shift) { Alert.alert('No open shift', 'Open your shift first to pay from the drawer.'); return }
    if (!(value > 0)) { Alert.alert('Amount required', 'Enter an amount greater than zero.'); return }
    if (!categoryId && !note.trim()) { Alert.alert('What was it for?', 'Choose a category or write a note.'); return }
    setBusy(true)
    try {
      const res = await apiPost<ExpenseRow>('/api/expenses', {
        kind: 'expense', paidFrom: 'drawer', openingEntryId: shift.id, amount: value,
        categoryId: categoryId || undefined, payee: payee.trim() || undefined, receiptNo: receiptNo.trim() || undefined,
        description: note.trim() || undefined, approvalToken,
      })
      const body = res.data as unknown as { code?: string; scopes?: string[] } | null
      if (!res.ok && res.status === 403 && body?.code === 'APPROVAL_REQUIRED') {
        setApproval({ scopes: body.scopes || ['cash_paid_out'], message: res.error, amount: value, posOpeningEntryId: shift.id, retry: (t) => saveExpense(t) })
        return
      }
      if (!res.ok) { Alert.alert('Expense not saved', res.error); return }
      Alert.alert('Expense recorded', `${res.data.expenseNo}: ${formatLKR(value)} paid from the drawer.`)
      setAmount(''); setPayee(''); setReceiptNo(''); setNote('')
      load()
    } finally {
      setBusy(false)
    }
  }

  async function saveCheque() {
    const value = Math.round(num(chequeAmount) * 100) / 100
    if (!chequeNo.trim() || !bankName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)) {
      Alert.alert('Cheque details', 'Enter the cheque number, bank and date (YYYY-MM-DD).')
      return
    }
    if (!(value > 0)) { Alert.alert('Amount required', 'Enter the cheque amount.'); return }
    if (!customer && !drawer.trim()) { Alert.alert('From whom?', 'Pick the customer or type the name on the cheque.'); return }
    setBusy(true)
    try {
      const res = await apiPost<ChequeRow>('/api/cheques', {
        direction: 'received', chequeNo: chequeNo.trim(), bankName: bankName.trim(), branchName: branchName.trim() || undefined,
        chequeDate, amount: value, customerId: customer?.id, partyName: drawer.trim() || customer?.name, warehouseId: shift?.warehouseId,
      })
      if (!res.ok) { Alert.alert('Cheque not saved', res.error); return }
      Alert.alert('Cheque recorded', `${chequeNo} · ${formatLKR(value)}${chequeDate > todayISO() ? ` · post-dated ${chequeDate}` : ''}`)
      setChequeNo(''); setBranchName(''); setChequeAmount(''); setDrawer(''); setCustomer(null); setChequeDate(todayISO())
      load()
    } finally {
      setBusy(false)
    }
  }

  const chequesOn = has('cheques')

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Money out & cheques" subtitle={shift ? `Shift ${shift.entryNumber}` : 'No open shift'} />

      <View style={styles.tabs}>
        {(['expense', 'cheque'] as Tab[]).filter((t) => t === 'expense' || chequesOn).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'expense' ? 'Expense from drawer' : 'Cheque received'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 16 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
      >
        {tab === 'expense' ? (
          <>
            {!shift ? <InlineNotice text="Open your shift (Shift tile) to pay expenses from the drawer." /> : null}
            <Text style={styles.label}>CATEGORY</Text>
            <View style={styles.chips}>
              {categories.map((c) => (
                <Pressable key={c.id} style={[styles.chip, categoryId === c.id && styles.chipActive]} onPress={() => setCategoryId(categoryId === c.id ? '' : c.id)}>
                  <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>AMOUNT</Text>
            <View style={styles.inputRow}>
              <Text style={styles.prefix}>LKR</Text>
              <TextInput style={styles.amountInput} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={THEME.colors.textSubtle} value={amount} onChangeText={setAmount} />
            </View>
            <TextInput style={styles.input} placeholder="Paid to (shop / person)" placeholderTextColor={THEME.colors.textSubtle} value={payee} onChangeText={setPayee} maxLength={255} />
            <TextInput style={styles.input} placeholder="Receipt / bill no. (optional)" placeholderTextColor={THEME.colors.textSubtle} value={receiptNo} onChangeText={setReceiptNo} maxLength={100} />
            <TextInput style={styles.input} placeholder="Note" placeholderTextColor={THEME.colors.textSubtle} value={note} onChangeText={setNote} maxLength={1000} />
            <Pressable style={[styles.primaryBtn, (busy || !shift) && { opacity: 0.5 }]} disabled={busy || !shift} onPress={() => saveExpense()}>
              <Text style={styles.primaryBtnText}>{busy ? 'Saving…' : 'Pay from drawer'}</Text>
            </Pressable>
            <Text style={styles.hint}>Small expenses up to the counter limit need no PIN; bigger ones need a supervisor.</Text>

            <Text style={[styles.label, { marginTop: 20 }]}>MY RECENT EXPENSES</Text>
            {expenses.length === 0 ? <Text style={styles.hint}>None yet.</Text> : expenses.map((e) => (
              <View key={e.id} style={styles.row}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{e.expenseNo} · {e.categoryName || 'Expense'}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{e.expenseDate}{e.payee ? ` · ${e.payee}` : ''} · {e.status}</Text>
                </View>
                <Text style={styles.rowAmount}>{formatLKR(e.amount)}</Text>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={styles.label}>FROM</Text>
            <Pressable style={styles.input} onPress={() => setPickCustomer(true)}>
              <Text style={{ color: customer ? THEME.colors.text : THEME.colors.textSubtle }}>{customer ? customer.name : 'Pick customer (optional)'}</Text>
            </Pressable>
            <TextInput style={styles.input} placeholder="Name on the cheque (drawer)" placeholderTextColor={THEME.colors.textSubtle} value={drawer} onChangeText={setDrawer} maxLength={255} />
            <Text style={styles.label}>CHEQUE</Text>
            <TextInput style={styles.input} placeholder="Cheque no." placeholderTextColor={THEME.colors.textSubtle} value={chequeNo} onChangeText={(v) => setChequeNo(v.replace(/[^0-9A-Za-z-]/g, ''))} keyboardType="number-pad" maxLength={50} />
            <View style={styles.chips}>
              {BANKS.map((b) => (
                <Pressable key={b} style={[styles.chip, bankName === b && styles.chipActive]} onPress={() => setBankName(b)}>
                  <Text style={[styles.chipText, bankName === b && styles.chipTextActive]}>{b}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Bank" placeholderTextColor={THEME.colors.textSubtle} value={bankName} onChangeText={setBankName} maxLength={100} />
            <TextInput style={styles.input} placeholder="Branch (optional)" placeholderTextColor={THEME.colors.textSubtle} value={branchName} onChangeText={setBranchName} maxLength={100} />
            <TextInput style={styles.input} placeholder="Cheque date YYYY-MM-DD" placeholderTextColor={THEME.colors.textSubtle} value={chequeDate} onChangeText={setChequeDate} maxLength={10} />
            {chequeDate > todayISO() ? <InlineNotice tone="info" text={`Post-dated: it can be banked from ${chequeDate}.`} /> : null}
            <View style={styles.inputRow}>
              <Text style={styles.prefix}>LKR</Text>
              <TextInput style={styles.amountInput} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={THEME.colors.textSubtle} value={chequeAmount} onChangeText={setChequeAmount} />
            </View>
            <Pressable style={[styles.primaryBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={saveCheque}>
              <Text style={styles.primaryBtnText}>{busy ? 'Saving…' : 'Record cheque'}</Text>
            </Pressable>
            <Text style={styles.hint}>To pay a bill with a cheque, take it on the web POS or the invoice so the bill is settled.</Text>

            <Text style={[styles.label, { marginTop: 20 }]}>RECENT CHEQUES</Text>
            {cheques.length === 0 ? <Text style={styles.hint}>None yet.</Text> : cheques.map((c) => (
              <View key={c.id} style={styles.row}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{c.chequeNo} · {c.bankName}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{c.chequeDate} · {c.partyDisplay || '—'} · {STATUS_LABEL[c.status] || c.status}</Text>
                </View>
                <Text style={[styles.rowAmount, c.status === 'bounced' && { color: THEME.colors.error }]}>{formatLKR(c.amount)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <SupervisorPinModal
        request={approval}
        onCancel={() => setApproval(null)}
        onApproved={(token) => {
          const retry = approval?.retry
          setApproval(null)
          retry?.(token)
        }}
      />
      <CustomerPickerModal visible={pickCustomer} onClose={() => setPickCustomer(false)} onSelect={(c) => { setCustomer(c); setPickCustomer(false) }} />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: THEME.spacing.lg,
    paddingBottom: 10,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backButton: { width: 36, height: 36, borderRadius: THEME.radius.md, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  headerSub: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted },
  tabs: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: THEME.colors.card, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  tab: { flex: 1, paddingVertical: 10, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border, alignItems: 'center' },
  tabActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: THEME.colors.textMuted },
  tabTextActive: { color: THEME.colors.onPrimary },
  content: { padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  label: { fontSize: 11, fontWeight: '800', color: THEME.colors.textMuted, letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: THEME.radius.full, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.card },
  chipActive: { backgroundColor: THEME.colors.primaryLight, borderColor: THEME.colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: THEME.colors.textMuted },
  chipTextActive: { color: THEME.colors.primary },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: THEME.radius.lg, paddingHorizontal: 12, marginBottom: 8 },
  prefix: { fontSize: 14, fontWeight: '800', color: THEME.colors.textMuted, marginRight: 8 },
  amountInput: { flex: 1, height: 52, fontSize: 22, fontWeight: '800', color: THEME.colors.text },
  input: { minHeight: 46, justifyContent: 'center', backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: THEME.radius.lg, paddingHorizontal: 12, marginBottom: 8, fontSize: 14, color: THEME.colors.text },
  primaryBtn: { height: 52, borderRadius: THEME.radius.lg, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryBtnText: { color: THEME.colors.onPrimary, fontSize: 15, fontWeight: '800' },
  hint: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: THEME.radius.lg, padding: 12, marginBottom: 6 },
  rowTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  rowSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
})

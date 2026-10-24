// Pharmacy: the sale contains prescription / controlled medicines → capture the prescription.
// Shown when POST /api/sales answers 400 PRESCRIPTION_REQUIRED; the sale is retried with it.
import React, { useState } from 'react'
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { THEME } from '../lib/theme'

export interface PrescriptionInput {
  doctorName: string
  doctorRegNo?: string
  hospital?: string
  prescriptionNo?: string
  prescriptionDate?: string
  patientName?: string
  patientAge?: string
  patientPhone?: string
  notes?: string
}

export interface PrescriptionRequest {
  level: 'prescription' | 'controlled'
  items: Array<{ id: string; name: string }>
  message?: string
}

export function PrescriptionSheet({ request, initial, customerName, customerPhone, onSave, onClose }: {
  request: PrescriptionRequest | null
  initial: PrescriptionInput | null
  customerName?: string | null
  customerPhone?: string | null
  onSave: (p: PrescriptionInput) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<PrescriptionInput>(() => initial ?? {
    doctorName: '',
    patientName: customerName || '',
    patientPhone: customerPhone || '',
    prescriptionDate: new Date().toISOString().slice(0, 10),
  })
  const [error, setError] = useState<string | null>(null)
  if (!request) return null
  const controlled = request.level === 'controlled'
  const set = (k: keyof PrescriptionInput, v: string) => setForm((f) => ({ ...f, [k]: v }))

  function save() {
    if (form.doctorName.trim().length < 2) return setError('Enter the doctor’s name.')
    if (controlled && !form.doctorRegNo?.trim()) return setError('Controlled drugs need the doctor’s SLMC registration number.')
    if (controlled && !form.patientName?.trim()) return setError('Controlled drugs need the patient’s name.')
    onSave(form)
  }

  const field = (k: keyof PrescriptionInput, label: string, required = false, props: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{label}{required ? ' *' : ''}</Text>
      <TextInput style={styles.input} value={form[k] || ''} onChangeText={(v) => set(k, v)} {...props} />
    </View>
  )

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: THEME.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={styles.link}>Cancel</Text></Pressable>
          <Text style={styles.title}>{controlled ? 'Controlled drug' : 'Prescription'}</Text>
          <Pressable onPress={save} hitSlop={12}><Text style={[styles.link, { fontWeight: '800' }]}>Continue</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.notice, controlled && { backgroundColor: THEME.colors.errorLight }]}>
            <Text style={styles.noticeText}>{request.items.map((i) => i.name).join(', ')} need{request.items.length === 1 ? 's' : ''} a prescription.</Text>
          </View>
          {field('doctorName', 'Doctor’s name', true, { placeholder: 'Dr. N. Perera' })}
          {field('doctorRegNo', 'SLMC reg. no.', controlled)}
          {field('hospital', 'Hospital / clinic')}
          {field('prescriptionNo', 'Prescription no.')}
          {field('prescriptionDate', 'Prescription date (YYYY-MM-DD)')}
          {field('patientName', 'Patient name', controlled)}
          {field('patientAge', 'Patient age', false, { keyboardType: 'number-pad' })}
          {field('patientPhone', 'Patient phone', false, { keyboardType: 'phone-pad' })}
          {field('notes', 'Notes', false, { multiline: true })}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  header: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  title: { fontSize: 16, fontWeight: '800', color: THEME.colors.text },
  link: { color: THEME.colors.primary, fontWeight: '700', fontSize: 14 },
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.text, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: '#FFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: THEME.colors.text },
  notice: { backgroundColor: THEME.colors.primaryLight, borderRadius: 10, padding: 12, marginBottom: 14 },
  noticeText: { color: THEME.colors.text, fontSize: 13, fontWeight: '600' },
  error: { color: THEME.colors.error, fontWeight: '700', marginTop: 4 },
})

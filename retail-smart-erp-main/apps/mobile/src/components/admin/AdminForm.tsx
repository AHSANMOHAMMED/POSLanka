// Form building blocks shared by the platform-admin screens (inputs, option chips, switches,
// buttons, modal sheets, paged-list footer). Styled to match AdminShell / adminStyles.
import React from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  ActivityIndicator,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { THEME } from '../../lib/theme'
import { AdminShell, adminStyles } from './AdminShell'

/** Shell for screens opened from the More hub: back arrow + the bottom tab bar (More highlighted). */
export function MoreShell({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <AdminShell title={title} subtitle={subtitle} tab="more" back tabs backHref="/admin/more" right={right}>
      {children}
    </AdminShell>
  )
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  keyboardType,
  secureTextEntry,
  multiline,
  autoCapitalize = 'none',
  editable = true,
  maxLength,
  style,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  hint?: string
  keyboardType?: KeyboardTypeOptions
  secureTextEntry?: boolean
  multiline?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  editable?: boolean
  maxLength?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[adminStyles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }, !editable && { backgroundColor: THEME.colors.surfaceContainerLow }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={THEME.colors.textSubtle}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        maxLength={maxLength}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

/** Single-choice chips. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label?: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const on = o.value === value
          return (
            <Pressable
              key={o.value}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled }}
              style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.5 }]}
              onPress={() => onChange(o.value)}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** Multi-choice chips. */
export function MultiChoice<T extends string>({
  label,
  options,
  values,
  onChange,
}: {
  label?: string
  options: Array<{ value: T; label: string }>
  values: T[]
  onChange: (v: T[]) => void
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const on = values.includes(o.value)
          return (
            <Pressable
              key={o.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export function SwitchRow({ label, hint, value, onValueChange, disabled }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={styles.switchLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }} />
    </View>
  )
}

export function Btn({
  label,
  onPress,
  tone = 'primary',
  busy,
  disabled,
  style,
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'danger' | 'ghost'
  busy?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const base = tone === 'danger' ? adminStyles.dangerBtn : tone === 'ghost' ? adminStyles.ghostBtn : adminStyles.primaryBtn
  const textStyle = tone === 'ghost' ? adminStyles.ghostBtnText : adminStyles.primaryBtnText
  const off = busy || disabled
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} style={[base, off && { opacity: 0.5 }, style]} onPress={onPress} disabled={off}>
      {busy ? <ActivityIndicator color={tone === 'ghost' ? THEME.colors.primary : '#FFF'} /> : <Text style={textStyle}>{label}</Text>}
    </Pressable>
  )
}

/** Small text button for card headers / rows. */
export function LinkButton({ label, onPress, tone = 'primary', disabled }: { label: string; onPress: () => void; tone?: 'primary' | 'danger'; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={[{ paddingVertical: 4, paddingHorizontal: 6 }, disabled && { opacity: 0.4 }]}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: tone === 'danger' ? THEME.colors.error : THEME.colors.primary }}>{label}</Text>
    </Pressable>
  )
}

/**
 * Bottom-sheet style modal with a scrollable body and Cancel / confirm buttons. Pass
 * `confirmLabel={null}` for an info-only sheet (Close button only).
 */
export function FormModal({
  visible,
  title,
  message,
  children,
  confirmLabel = 'Save',
  danger,
  busy,
  disabled,
  onCancel,
  onConfirm,
}: {
  visible: boolean
  title: string
  message?: string
  children?: React.ReactNode
  confirmLabel?: string | null
  danger?: boolean
  busy?: boolean
  disabled?: boolean
  onCancel: () => void
  onConfirm?: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBg}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {message ? <Text style={[adminStyles.muted, { marginBottom: 8 }]}>{message}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
            {children}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Btn label={confirmLabel === null ? 'Close' : 'Cancel'} tone="ghost" onPress={onCancel} style={{ flex: 1 }} />
            {confirmLabel !== null && onConfirm ? (
              <Btn label={confirmLabel} tone={danger ? 'danger' : 'primary'} onPress={onConfirm} busy={busy} disabled={disabled} style={{ flex: 1 }} />
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** Footer for paged FlatLists. */
export function ListFooter({ loadingMore, hasMore, shown, total, onMore }: { loadingMore: boolean; hasMore: boolean; shown: number; total: number; onMore: () => void }) {
  if (loadingMore) return <ActivityIndicator color={THEME.colors.primary} style={{ padding: 12 }} />
  if (!hasMore) return null
  return (
    <Pressable style={adminStyles.ghostBtn} onPress={onMore}>
      <Text style={adminStyles.ghostBtnText}>
        Load more ({shown} of {total})
      </Text>
    </Pressable>
  )
}

/** Horizontal scrolling filter chips (single choice, not a form field). */
export function FilterChips<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={{ flexGrow: 0 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable key={o.value} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(o.value)}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              {o.label}
              {o.count != null ? ` (${o.count})` : ''}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warn' | 'error' | 'ok' }) {
  const bg = tone === 'error' ? THEME.colors.errorLight : tone === 'warn' ? THEME.colors.secondaryLight : tone === 'ok' ? THEME.colors.tertiaryLight : THEME.colors.primaryLight
  const fg = tone === 'error' ? THEME.colors.error : tone === 'warn' ? THEME.colors.onSecondaryContainer : tone === 'ok' ? THEME.colors.tertiary : THEME.colors.primaryDark
  return (
    <View style={{ backgroundColor: bg, borderRadius: 10, padding: 10 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  )
}

export const formStyles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    backgroundColor: THEME.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  mono: { fontFamily: 'monospace' },
  cardPad: { padding: 14, gap: 8 },
})

const styles = StyleSheet.create({
  field: { marginBottom: 10 },
  label: { fontSize: 11, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
  hint: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  chipOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  chipTextOn: { color: '#FFF' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 4 },
  switchLabel: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '88%' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: THEME.colors.text, marginBottom: 6 },
})

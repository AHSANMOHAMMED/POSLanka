// Shared building blocks for every screen: header with back navigation, cards, list rows,
// badges, empty states, KPI tiles and loading skeletons. Colours / spacing come from THEME.
import React, { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Animated, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { THEME } from '../lib/theme'
import { useHeaderPad } from '../lib/safeArea'
import { goBack } from '../lib/nav'

export type IconName = React.ComponentProps<typeof Ionicons>['name']
export type Tone = 'primary' | 'ok' | 'warn' | 'error' | 'muted'

export function toneColors(tone: Tone = 'muted'): { fg: string; bg: string } {
  switch (tone) {
    case 'primary':
      return { fg: THEME.colors.primary, bg: THEME.colors.primaryLight }
    case 'ok':
      return { fg: THEME.colors.tertiaryContainer, bg: THEME.colors.tertiaryLight }
    case 'warn':
      return { fg: THEME.colors.onSecondaryContainer, bg: THEME.colors.secondaryLight }
    case 'error':
      return { fg: THEME.colors.error, bg: THEME.colors.errorLight }
    default:
      return { fg: THEME.colors.textMuted, bg: THEME.colors.surfaceContainer }
  }
}

// ---------------------------------------------------------------------------- header
interface ScreenHeaderProps {
  title: string
  subtitle?: string | null
  /** Show the back arrow (default true). Tab roots pass false. */
  back?: boolean
  onBack?: () => void
  /** Optional element left of the title when there is no back arrow (logo). */
  leading?: React.ReactNode
  right?: React.ReactNode
}

export function ScreenHeader({ title, subtitle, back = true, onBack, leading, right }: ScreenHeaderProps) {
  const headerPad = useHeaderPad(4)
  return (
    <View style={[styles.header, headerPad]}>
      {back ? (
        <Pressable
          onPress={onBack || goBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={THEME.colors.text} />
        </Pressable>
      ) : (
        leading || null
      )}
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  )
}

/** Round icon button for headers / toolbars (48dp target). */
export function IconButton({
  name,
  onPress,
  label,
  color = THEME.colors.text,
  badge,
  size = 22,
  filled,
}: {
  name: IconName
  onPress: () => void
  label: string
  color?: string
  badge?: number | string | null
  size?: number
  filled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.iconBtn, filled && { backgroundColor: THEME.colors.primaryLight }, pressed && styles.pressed]}
    >
      <Ionicons name={name} size={size} color={color} />
      {badge ? (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>{typeof badge === 'number' && badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------- containers
export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}>
        {children}
      </Pressable>
    )
  }
  return <View style={[styles.card, style]}>{children}</View>
}

export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={THEME.colors.primary} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** Tinted circle with an icon (list rows, grid tiles). */
export function IconBubble({ name, tone = 'primary', size = 40 }: { name: IconName; tone?: Tone; size?: number }) {
  const c = toneColors(tone)
  return (
    <View style={[styles.bubble, { width: size, height: size, borderRadius: size / 2.6, backgroundColor: c.bg }]}>
      <Ionicons name={name} size={Math.round(size * 0.5)} color={c.fg} />
    </View>
  )
}

interface ListItemProps {
  icon?: IconName
  iconTone?: Tone
  title: string
  subtitle?: string | null
  /** Text or element on the right (amount, badge). */
  right?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  /** Chevron is shown by default when the row is pressable. */
  chevron?: boolean
  last?: boolean
  titleColor?: string
}

export function ListItem({ icon, iconTone = 'primary', title, subtitle, right, onPress, onLongPress, chevron, last, titleColor }: ListItemProps) {
  const showChevron = chevron ?? !!onPress
  const content = (
    <>
      {icon ? <IconBubble name={icon} tone={iconTone} size={38} /> : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, titleColor ? { color: titleColor } : null]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {typeof right === 'string' || typeof right === 'number' ? <Text style={styles.rowRight}>{right}</Text> : right}
      {showChevron ? <Ionicons name="chevron-forward" size={18} color={THEME.colors.textSubtle} /> : null}
    </>
  )
  if (!onPress && !onLongPress) return <View style={[styles.row, !last && styles.rowDivider]}>{content}</View>
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && { backgroundColor: THEME.colors.surfaceContainerLow }]}
    >
      {content}
    </Pressable>
  )
}

export function Badge({ text, tone = 'muted', icon }: { text: string; tone?: Tone; icon?: IconName }) {
  const c = toneColors(tone)
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={c.fg} /> : null}
      <Text style={[styles.badgeText, { color: c.fg }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  )
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  subtitle,
  actionLabel,
  onAction,
  tone = 'muted',
}: {
  icon?: IconName
  title: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
  tone?: Tone
}) {
  const c = toneColors(tone)
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.bg }]}>
        <Ionicons name={icon} size={30} color={c.fg} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
          <Text style={styles.primaryBtnText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  tone = 'primary',
  style,
}: {
  label: string
  onPress: () => void
  icon?: IconName
  disabled?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
  style?: StyleProp<ViewStyle>
}) {
  const bg = tone === 'danger' ? THEME.colors.error : tone === 'secondary' ? THEME.colors.card : THEME.colors.primary
  const fg = tone === 'secondary' ? THEME.colors.primary : THEME.colors.onPrimary
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryBtn,
        { backgroundColor: bg, marginTop: 0 },
        tone === 'secondary' && { borderWidth: 1, borderColor: THEME.colors.border },
        disabled && { opacity: 0.5 },
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.primaryBtnText, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------- KPI + skeleton
export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'primary',
  onPress,
  style,
}: {
  label: string
  value: string
  hint?: string | null
  icon?: IconName
  tone?: Tone
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const c = toneColors(tone)
  return (
    <Card onPress={onPress} style={[styles.kpi, style]}>
      <View style={styles.kpiTop}>
        {icon ? (
          <View style={[styles.kpiIcon, { backgroundColor: c.bg }]}>
            <Ionicons name={icon} size={16} color={c.fg} />
          </View>
        ) : null}
        <Text style={styles.kpiLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {hint ? (
        <Text style={styles.kpiHint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Card>
  )
}

/** Pulsing placeholder block shown while data loads. */
export function Skeleton({ width = '100%', height = 14, radius = 8, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.5)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: THEME.colors.surfaceContainerHigh, opacity }, style]} />
}

/** Grey / amber strip for offline + stale data. */
export function Banner({ text, tone = 'warn', icon = 'cloud-offline-outline', onPress }: { text: string; tone?: Tone; icon?: IconName; onPress?: () => void }) {
  const c = toneColors(tone)
  const Comp: React.ElementType = onPress ? Pressable : View
  return (
    <Comp onPress={onPress} style={[styles.banner, { backgroundColor: c.bg }]}>
      <Ionicons name={icon} size={16} color={c.fg} />
      <Text style={[styles.bannerText, { color: c.fg }]}>{text}</Text>
    </Comp>
  )
}

export const uiStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: THEME.colors.background },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  listCard: { padding: 0, overflow: 'hidden' },
})

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.borderStrong,
  },
  backBtn: { width: 44, height: 44, marginLeft: -8, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0, paddingHorizontal: 2 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  headerSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: THEME.colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: THEME.colors.card,
  },
  iconBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  card: {
    backgroundColor: THEME.colors.card,
    borderRadius: THEME.radius.xl,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 14,
    ...THEME.shadow,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  sectionActionText: { fontSize: 13, fontWeight: '700', color: THEME.colors.primary },
  bubble: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 60, backgroundColor: THEME.colors.card },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.outline },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: THEME.colors.text },
  rowSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  rowRight: { fontSize: 14, fontWeight: '800', color: THEME.colors.text, fontVariant: ['tabular-nums'] },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: THEME.radius.full, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 28, minHeight: 200, flexGrow: 1 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: THEME.colors.text, textAlign: 'center' },
  emptySub: { marginTop: 6, fontSize: 13, color: THEME.colors.textMuted, textAlign: 'center', maxWidth: 320 },
  primaryBtn: {
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: THEME.radius.lg,
    backgroundColor: THEME.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnText: { color: THEME.colors.onPrimary, fontWeight: '800', fontSize: 15 },
  kpi: { padding: 12, minHeight: 96, justifyContent: 'space-between' },
  kpiTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kpiIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { flex: 1, fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted },
  kpiValue: { fontSize: 20, fontWeight: '800', color: THEME.colors.text, marginTop: 8, fontVariant: ['tabular-nums'] },
  kpiHint: { fontSize: 11, color: THEME.colors.textSubtle, marginTop: 2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '700' },
})

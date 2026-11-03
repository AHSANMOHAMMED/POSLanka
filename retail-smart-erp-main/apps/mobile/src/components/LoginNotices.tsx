import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { getApiBase } from '../lib/api'
import { getAppLocale, LOCALE_OPTIONS, setAppLocale, type AppLocale } from '../lib/locale'
import { THEME } from '../lib/theme'

interface Notice {
  id: string
  kind: string
  type: string
  title: string
  body: string
}

const TONE: Record<string, { bg: string; fg: string; border: string }> = {
  info: { bg: '#EFF6FF', fg: '#1E3A8A', border: '#BFDBFE' },
  feature: { bg: '#EFF6FF', fg: '#1E3A8A', border: '#BFDBFE' },
  warning: { bg: '#FFFBEB', fg: '#78350F', border: '#FDE68A' },
  maintenance: { bg: '#FFFBEB', fg: '#78350F', border: '#FDE68A' },
  billing: { bg: '#F5F3FF', fg: '#4C1D95', border: '#DDD6FE' },
  error: { bg: '#FEF2F2', fg: '#7F1D1D', border: '#FECACA' },
}

/** Pre-login notices + EN/SI/TA picker (public /api/system/login-notices). */
export function LoginNotices({ slug }: { slug?: string | null }) {
  const [locale, setLocale] = useState<AppLocale>('en')
  const [notices, setNotices] = useState<Notice[]>([])
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getAppLocale().then(setLocale).catch(() => undefined)
  }, [])

  const load = useCallback(async (loc: AppLocale, companySlug?: string | null) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ locale: loc })
      if (companySlug?.trim()) params.set('slug', companySlug.trim().toLowerCase())
      const base = getApiBase().replace(/\/$/, '')
      const res = await fetch(`${base}/api/system/login-notices?${params}`, {
        headers: { Accept: 'application/json' },
      })
      const data = res.ok ? await res.json().catch(() => null) : null
      setNotices(Array.isArray(data?.notices) ? data.notices : [])
    } catch {
      setNotices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(locale, slug)
  }, [locale, slug, load])

  async function pickLocale(next: AppLocale) {
    setLocale(next)
    await setAppLocale(next)
  }

  const visible = notices.filter((n) => !hidden[n.id])

  return (
    <View style={styles.wrap}>
      <View style={styles.langRow} accessibilityRole="radiogroup">
        {LOCALE_OPTIONS.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => void pickLocale(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: locale === opt.value }}
            accessibilityLabel={opt.label}
            style={[styles.langChip, locale === opt.value && styles.langChipOn]}
          >
            <Text style={[styles.langText, locale === opt.value && styles.langTextOn]}>{opt.value.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <ActivityIndicator color={THEME.colors.primary} style={{ marginVertical: 8 }} /> : null}

      {visible.map((n) => {
        const tone = TONE[n.type] || TONE.info
        return (
          <View key={n.id} style={[styles.card, { backgroundColor: tone.bg, borderColor: tone.border }]} accessibilityRole="summary">
            <Pressable
              onPress={() => setHidden((h) => ({ ...h, [n.id]: true }))}
              style={styles.dismiss}
              hitSlop={8}
              accessibilityLabel="Dismiss"
            >
              <Text style={[styles.dismissText, { color: tone.fg }]}>✕</Text>
            </Pressable>
            <Text style={[styles.title, { color: tone.fg }]}>{n.title}</Text>
            <Text style={[styles.body, { color: tone.fg }]}>{n.body}</Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12, gap: 8 },
  langRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  langChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.card,
  },
  langChipOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  langText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  langTextOn: { color: THEME.colors.onPrimary },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, paddingRight: 28 },
  dismiss: { position: 'absolute', right: 8, top: 8, zIndex: 1 },
  dismissText: { fontSize: 14, fontWeight: '700', opacity: 0.7 },
  title: { fontSize: 14, fontWeight: '800', marginBottom: 4, paddingRight: 8 },
  body: { fontSize: 13, lineHeight: 18, opacity: 0.95 },
})

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiGet, apiPut, formatBusinessId, getPublicWebBase } from '../src/lib/api'
import { THEME } from '../src/lib/theme'
import {
  Badge,
  Card,
  IconBubble,
  ListItem,
  ScreenHeader,
  SectionHeader,
  uiStyles,
  type IconName,
  type Tone,
} from '../src/components/ui'
import { ErrorView, LoadingView } from '../src/components/StateViews'
import { useSessionUser } from '../src/lib/session'
import { openWeb } from '../src/lib/modules'
import { hasBusinessType } from '../src/lib/businessScope'
import { displayRole } from '../src/lib/roles'
import { TEXT_SCALES, useTextScale, type TextScale } from '../src/lib/textScale'

interface SettingItem {
  id: string
  title: string
  description: string
  icon: IconName
  tone: Tone
  webPath?: string
  nativeRoute?: string
  badgeText?: string
  badgeTone?: Tone
  group: 'receipts' | 'team' | 'inventory' | 'loyalty' | 'system' | 'auto'
  requiresOwner?: boolean
}

export default function ShopSettingsScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useSessionUser()
  const [currentTextScale, setTextScale] = useTextScale()

  // Business profile quick edit state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [profileExpanded, setProfileExpanded] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  // Loading state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter search
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiGet<any>('/api/tenant')
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const t = res.data?.tenant || res.data || {}
    setName(t.name || '')
    setPhone(t.phone || '')
    setAddress(t.address || '')
    setError(null)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function saveProfile() {
    setSavingProfile(true)
    const payload = { name: name.trim(), phone: phone.trim(), address: address.trim() }
    const res = await apiPut('/api/tenant', payload)
    if (!res.ok) {
      const res2 = await apiPut('/api/settings/business-profile', payload)
      setSavingProfile(false)
      if (!res2.ok) {
        Alert.alert('Save failed', res2.error || res.error || 'Could not update business profile')
      } else {
        Alert.alert('Success', 'Business profile updated')
      }
      return
    }
    setSavingProfile(false)
    Alert.alert('Success', 'Business profile updated')
  }

  const isVehicleBusiness = useMemo(() => {
    if (!user) return false
    return hasBusinessType(user.businessType ? user : 'retail', ['auto_service', 'dealership'])
  }, [user])

  const settingsList: SettingItem[] = useMemo(() => {
    const list: SettingItem[] = [
      // Receipts & Branding
      {
        id: 'receipt',
        title: 'Business Profile & Receipt',
        description: 'Business details, logo and receipt layout',
        icon: 'receipt-outline',
        tone: 'primary',
        webPath: '/settings/receipt',
        group: 'receipts',
      },
      {
        id: 'letter-heads',
        title: 'Letter Heads',
        description: 'Company branding for prints and quotes',
        icon: 'document-text-outline',
        tone: 'primary',
        webPath: '/settings/letter-heads',
        group: 'receipts',
      },
      {
        id: 'print-templates',
        title: 'Print Templates',
        description: 'Configure print layouts and invoice formats',
        icon: 'bookmark-outline',
        tone: 'primary',
        webPath: '/settings/print-templates',
        group: 'receipts',
      },
      {
        id: 'printers',
        title: 'Thermal & Hardware Printers',
        description: 'Configure Bluetooth & ESC/POS receipt printers',
        icon: 'print-outline',
        tone: 'ok',
        nativeRoute: '/printer',
        badgeText: 'In-App',
        badgeTone: 'ok',
        group: 'receipts',
      },

      // Team & Security
      {
        id: 'staff',
        title: 'Staff',
        description: 'Manage users, roles and cash drawer PINs',
        icon: 'people-outline',
        tone: 'primary',
        nativeRoute: '/staff',
        webPath: '/settings/staff',
        badgeText: 'In-App',
        badgeTone: 'ok',
        group: 'team',
      },
      {
        id: 'role-permissions',
        title: 'Role Permissions',
        description: 'Customize permissions per role',
        icon: 'shield-checkmark-outline',
        tone: 'error',
        webPath: '/settings/role-permissions',
        group: 'team',
        requiresOwner: true,
      },
      {
        id: 'commissions',
        title: 'Commissions',
        description: 'Rates, payouts and employee commission tracking',
        icon: 'cash-outline',
        tone: 'ok',
        webPath: '/settings/commissions',
        group: 'team',
      },

      // Inventory & POS Setup
      {
        id: 'warehouses',
        title: 'Warehouses',
        description: 'Manage inventory locations and branches',
        icon: 'business-outline',
        tone: 'ok',
        webPath: '/settings/warehouses',
        group: 'inventory',
      },
      {
        id: 'pos-profiles',
        title: 'POS Profiles',
        description: 'Configure POS terminals, default registers & devices',
        icon: 'desktop-outline',
        tone: 'primary',
        webPath: '/settings/pos-profiles',
        group: 'inventory',
      },

      // Loyalty & Customer Rewards
      {
        id: 'loyalty',
        title: 'Loyalty Program',
        description: 'Points, cash-back and customer rewards tiers',
        icon: 'gift-outline',
        tone: 'warn',
        webPath: '/settings/loyalty',
        group: 'loyalty',
      },
      {
        id: 'gift-cards',
        title: 'Gift Cards',
        description: 'Manage gift cards, vouchers and balances',
        icon: 'card-outline',
        tone: 'warn',
        webPath: '/settings/gift-cards',
        group: 'loyalty',
      },

      // Data, Logs & Diagnostics
      {
        id: 'notifications',
        title: 'Notifications',
        description: 'Email, SMS, stock alerts and notifications',
        icon: 'notifications-outline',
        tone: 'primary',
        nativeRoute: '/alerts',
        webPath: '/settings/notifications',
        badgeText: 'In-App',
        badgeTone: 'ok',
        group: 'system',
      },
      {
        id: 'files',
        title: 'File Manager',
        description: 'Upload and manage files, attachments and documents',
        icon: 'folder-open-outline',
        tone: 'warn',
        webPath: '/settings/files',
        group: 'system',
      },
      {
        id: 'import-export',
        title: 'Import / Export',
        description: 'Bulk data import, Excel spreadsheets and backup export',
        icon: 'swap-horizontal-outline',
        tone: 'primary',
        webPath: '/settings/import-export',
        group: 'system',
      },
      {
        id: 'ai-logs',
        title: 'AI Intelligence',
        description: 'Error logs, smart analysis and diagnostic insights',
        icon: 'sparkles-outline',
        tone: 'primary',
        webPath: '/settings/ai-logs',
        group: 'system',
      },
      {
        id: 'system-audit',
        title: 'System Audit',
        description: 'Integrity checks, audit trail and database diagnostics',
        icon: 'shield-outline',
        tone: 'error',
        webPath: '/settings/system-audit',
        group: 'system',
      },
    ]

    if (isVehicleBusiness) {
      list.push(
        {
          id: 'vehicle-types',
          title: 'Vehicle Types',
          description: 'Body types, models and visual inspection diagrams',
          icon: 'car-outline',
          tone: 'primary',
          webPath: '/settings/vehicle-types',
          group: 'auto',
        },
        {
          id: 'inspection-templates',
          title: 'Inspections',
          description: 'Vehicle inspection checklists and templates',
          icon: 'clipboard-outline',
          tone: 'primary',
          webPath: '/settings/inspection-templates',
          group: 'auto',
        }
      )
    }

    return list
  }, [isVehicleBusiness])

  const filteredSettings = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return settingsList
    return settingsList.filter(
      (item) => item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    )
  }, [settingsList, search])

  const groups = useMemo(() => {
    return [
      { key: 'receipts', title: 'Receipts & Branding', items: filteredSettings.filter((i) => i.group === 'receipts') },
      { key: 'team', title: 'Team & Permissions', items: filteredSettings.filter((i) => i.group === 'team') },
      { key: 'inventory', title: 'Inventory & POS Setup', items: filteredSettings.filter((i) => i.group === 'inventory') },
      { key: 'loyalty', title: 'Loyalty & Rewards', items: filteredSettings.filter((i) => i.group === 'loyalty') },
      { key: 'system', title: 'Data, Logs & Diagnostics', items: filteredSettings.filter((i) => i.group === 'system') },
      ...(isVehicleBusiness
        ? [{ key: 'auto', title: 'Automotive & Workshop', items: filteredSettings.filter((i) => i.group === 'auto') }]
        : []),
    ].filter((g) => g.items.length > 0)
  }, [filteredSettings, isVehicleBusiness])

  function handleOpenSetting(item: SettingItem) {
    if (item.nativeRoute && !item.webPath) {
      router.push(item.nativeRoute as any)
      return
    }

    if (item.nativeRoute && item.webPath) {
      // Offers choice or navigates natively with web fallback
      Alert.alert(
        item.title,
        'Choose how you want to open this setting:',
        [
          { text: 'In-App Screen', onPress: () => router.push(item.nativeRoute as any) },
          { text: 'Web Browser Settings', onPress: () => openWeb(user, item.webPath!) },
          { text: 'Cancel', style: 'cancel' },
        ],
        { cancelable: true }
      )
      return
    }

    if (item.webPath) {
      openWeb(user, item.webPath)
    }
  }

  function handleOpenAllWebSettings() {
    openWeb(user, '/settings')
  }

  return (
    <View style={[uiStyles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Settings"
        subtitle="Configure your business settings and preferences"
        right={
          <Pressable
            onPress={handleOpenAllWebSettings}
            hitSlop={8}
            style={({ pressed }) => [styles.webButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Open web settings"
          >
            <Ionicons name="open-outline" size={18} color={THEME.colors.primary} />
            <Text style={styles.webButtonText}>Web</Text>
          </Pressable>
        }
      />

      {loading ? (
        <LoadingView text="Loading settings…" />
      ) : error ? (
        <ErrorView message={error} onRetry={load} />
      ) : (
        <ScrollView contentContainerStyle={[uiStyles.content, { paddingBottom: 40 }]}>
          {/* Search box */}
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={18} color={THEME.colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search settings..."
              placeholderTextColor={THEME.colors.textMuted}
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={16} color={THEME.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* Quick Business Profile Editor */}
          {!search.trim() ? (
            <Card style={styles.profileCard}>
              <Pressable
                onPress={() => setProfileExpanded(!profileExpanded)}
                style={({ pressed }) => [styles.profileHeader, pressed && styles.pressed]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                  <IconBubble name="storefront-outline" tone="primary" size={38} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileTitle} numberOfLines={1}>
                      {name || 'Business Profile'}
                    </Text>
                    <Text style={styles.profileSub} numberOfLines={1}>
                      {phone || address ? `${phone} · ${address}` : 'Name, phone and store address'}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={profileExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={THEME.colors.textSubtle}
                />
              </Pressable>

              {profileExpanded ? (
                <View style={styles.profileForm}>
                  <Text style={styles.label}>Business name</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter store/business name"
                    placeholderTextColor={THEME.colors.textMuted}
                  />

                  <Text style={styles.label}>Phone number</Text>
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="e.g. +94 11 234 5678"
                    placeholderTextColor={THEME.colors.textMuted}
                    keyboardType="phone-pad"
                  />

                  <Text style={styles.label}>Address</Text>
                  <TextInput
                    style={[styles.input, { minHeight: 68 }]}
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Street, City, Postal Code"
                    placeholderTextColor={THEME.colors.textMuted}
                    multiline
                  />

                  <Pressable
                    style={[styles.saveBtn, savingProfile && styles.btnDisabled]}
                    onPress={saveProfile}
                    disabled={savingProfile}
                  >
                    {savingProfile ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="save-outline" size={16} color="#FFF" />
                        <Text style={styles.saveBtnText}>Save Profile</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* Settings Groups */}
          {groups.map((group) => (
            <View key={group.key} style={styles.sectionWrap}>
              <SectionHeader title={group.title} />
              <Card style={styles.cardGroup}>
                {group.items.map((item, idx) => (
                  <ListItem
                    key={item.id}
                    icon={item.icon}
                    iconTone={item.tone}
                    title={item.title}
                    subtitle={item.description}
                    right={
                      item.badgeText ? (
                        <Badge text={item.badgeText} tone={item.badgeTone || 'muted'} />
                      ) : (
                        <Ionicons name="open-outline" size={16} color={THEME.colors.textSubtle} />
                      )
                    }
                    onPress={() => handleOpenSetting(item)}
                    last={idx === group.items.length - 1}
                  />
                ))}
              </Card>
            </View>
          ))}

          {/* No results message */}
          {groups.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={36} color={THEME.colors.textMuted} />
              <Text style={styles.emptyTitle}>No matching settings</Text>
              <Text style={styles.emptySub}>Try searching for something else like &quot;receipt&quot;, &quot;staff&quot;, or &quot;warehouse&quot;.</Text>
            </View>
          ) : null}

          {/* Preferences & Text Size */}
          {!search.trim() ? (
            <>
              <SectionHeader title="Display & Accessibility" />
              <Card style={styles.prefCard}>
                <View style={styles.prefRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prefTitle}>Text size scaling</Text>
                    <Text style={styles.prefSub}>Adjust text scale for comfortable reading across all screens</Text>
                  </View>
                </View>
                <View style={styles.scaleButtonsRow}>
                  {TEXT_SCALES.map((scale: TextScale) => {
                    const active = currentTextScale === scale
                    return (
                      <Pressable
                        key={scale}
                        onPress={() => setTextScale(scale)}
                        style={[styles.scaleBtn, active && styles.scaleBtnActive]}
                      >
                        <Text style={[styles.scaleBtnText, active && styles.scaleBtnTextActive]}>
                          {Math.round(scale * 100)}%
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </Card>

              {/* Account summary */}
              <SectionHeader title="Signed-In Account" />
              <Card style={styles.accountCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconBubble name="person-circle-outline" tone="primary" size={42} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.accountName} numberOfLines={1}>
                      {user?.name || 'User'}
                    </Text>
                    <Text style={styles.accountSub} numberOfLines={1}>
                      {displayRole(user)}
                      {user?.tenantName ? ` · ${user.tenantName}` : ''}
                    </Text>
                    <Text style={styles.accountSubMuted} numberOfLines={1}>
                      {user?.businessId ? `ID: ${user.tenantSlug || formatBusinessId(user.businessId)}` : ''} · {getPublicWebBase()}
                    </Text>
                  </View>
                </View>
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  webButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: THEME.colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  webButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: THEME.colors.text,
    paddingVertical: 4,
  },
  profileCard: {
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#FFF',
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  profileSub: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  profileForm: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    paddingTop: 12,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.textMuted,
  },
  input: {
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: THEME.colors.text,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: THEME.colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  saveBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  sectionWrap: {
    marginBottom: 16,
  },
  cardGroup: {
    padding: 0,
    overflow: 'hidden',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  emptySub: {
    fontSize: 13,
    color: THEME.colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  prefCard: {
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  prefTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  prefSub: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  scaleButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  scaleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceContainerLow,
  },
  scaleBtnActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  scaleBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  scaleBtnTextActive: {
    color: '#FFF',
  },
  accountCard: {
    padding: 14,
    marginBottom: 16,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.text,
  },
  accountSub: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  accountSubMuted: {
    fontSize: 11,
    color: THEME.colors.textSubtle,
    marginTop: 2,
  },
})

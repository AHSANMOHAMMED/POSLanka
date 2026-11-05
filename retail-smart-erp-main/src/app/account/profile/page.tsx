'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { PageSkeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { useUnsavedChangesWarning } from '@/hooks'
import { useTheme, type Theme, type ThemePalette } from '@/components/providers/ThemeProvider'
import { useTextScale } from '@/components/ui/text-size-control'
import { TEXT_SCALES, TEXT_SCALE_LABELS, type TextScale } from '@/lib/ui/text-scale'
import { cn } from '@/lib/utils'
import {
  User,
  Lock,
  Save,
  Check,
  Eye,
  EyeOff,
  Mail,
  Phone,
  Calendar,
  Shield,
  Loader2,
  Camera,
  Trash2,
  Palette,
  Type,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react'

interface AccountProfile {
  id: string
  email: string
  fullName: string
  phone: string | null
  avatarUrl: string | null
  emailVerified: boolean
  createdAt: string
}

function resizeImage(file: File, maxDimension: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      reject(new Error('Canvas context not available'))
      return
    }

    img.onload = () => {
      URL.revokeObjectURL(img.src)
      let width = img.width
      let height = img.height

      if (width > height && width > maxDimension) {
        height = (height * maxDimension) / width
        width = maxDimension
      } else if (height > maxDimension) {
        width = (width * maxDimension) / height
        height = maxDimension
      }

      canvas.width = Math.round(width)
      canvas.height = Math.round(height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const quality = ['image/jpeg', 'image/webp'].includes(file.type) ? 0.85 : undefined
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to create blob'))
        },
        file.type,
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

const PROFILE_PALETTES: { value: ThemePalette; label: string; accent: string; desc: string }[] = [
  { value: 'default', label: 'Classic Slate', accent: '#2563eb', desc: 'Clean balanced contrast' },
  { value: 'midnight', label: 'Midnight Navy', accent: '#3b82f6', desc: 'Deep cosmic luxury dark' },
  { value: 'emerald', label: 'Emerald Green', accent: '#10b981', desc: 'Supermarket & fresh botanical' },
  { value: 'charcoal', label: 'Carbon OLED', accent: '#38bdf8', desc: 'Ultra contrast pitch black' },
  { value: 'amber', label: 'Warm Amber', accent: '#f59e0b', desc: 'Warm bistro tone' },
  { value: 'violet', label: 'Cyber Violet', accent: '#a855f7', desc: 'Neon amethyst dark' },
  { value: 'crimson', label: 'Ruby Crimson', accent: '#f43f5e', desc: 'High performance crimson' },
  { value: 'teal', label: 'Teal', accent: '#0d9488', desc: 'Fresh calm teal' },
  { value: 'rose', label: 'Rose Pink', accent: '#db2777', desc: 'Bright boutique pink' },
  { value: 'ocean', label: 'Deep Ocean', accent: '#0369a1', desc: 'Naval maritime blue' },
]

export default function ProfilePage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const { theme, setTheme, palette, setPalette } = useTheme()
  const { scale: textScale, setScale: setTextScale } = useTextScale('app', profile?.id || null)

  const handleThemeModeChange = (newTheme: Theme) => {
    setTheme(newTheme)
    fetch('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: newTheme }),
    }).catch(() => {})
    toast.success(`Theme mode set to ${newTheme}`)
  }

  const handlePaletteChange = (newPalette: ThemePalette) => {
    setPalette(newPalette)
    fetch('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themePalette: newPalette }),
    }).catch(() => {})
    toast.success('Color theme palette updated')
  }

  const handleTextScaleChange = (newScale: TextScale) => {
    setTextScale(newScale)
    fetch('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textScale: newScale }),
    }).catch(() => {})
    toast.success(`Text size set to ${TEXT_SCALE_LABELS[newScale] || `${Math.round(newScale * 100)}%`}`)
  }

  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
  })

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })

  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  })

  // Track unsaved changes for profile form
  const hasUnsavedChanges = useMemo(() => {
    if (!profile) return false
    return formData.fullName !== profile.fullName || formData.phone !== (profile.phone || '')
  }, [formData, profile])

  useUnsavedChangesWarning(hasUnsavedChanges)

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/account')
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setFormData({
          fullName: data.fullName,
          phone: data.phone || '',
        })
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const userInitials = (profile?.fullName || '')
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: PNG, JPEG, WebP')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large. Maximum 2MB')
      return
    }

    setUploadingAvatar(true)

    try {
      const resized = await resizeImage(file, 300)
      const formData = new FormData()
      formData.append('avatar', resized, file.name)

      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Failed to upload avatar')
        return
      }

      setProfile((prev) => prev ? { ...prev, avatarUrl: data.avatarUrl } : prev)
      toast.success('Profile picture updated')
    } catch {
      toast.error('Failed to upload avatar')
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    setUploadingAvatar(true)

    try {
      const res = await fetch('/api/account/avatar', { method: 'DELETE' })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to remove avatar')
        return
      }

      setProfile((prev) => prev ? { ...prev, avatarUrl: null } : prev)
      toast.success('Profile picture removed')
    } catch {
      toast.error('Failed to remove avatar')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleSaveProfile = async () => {
    setSaving(true)

    try {
      const res = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Failed to save profile')
        return
      }

      setProfile(data)
      toast.success('Profile saved successfully')
    } catch {
      toast.error('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError('')

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }

    if (passwordData.newPassword.length < 4) {
      setPasswordError('Password must be at least 4 characters')
      return
    }

    setSavingPassword(true)

    try {
      const res = await fetch('/api/account/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setPasswordError(data.error || 'Failed to change password')
        return
      }

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
      toast.success('Password changed successfully')
    } catch {
      toast.error('Failed to change password')
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profile Settings</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your personal information</p>
        </div>
        <PageSkeleton layout="form" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profile Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Manage your account information and security
        </p>
      </div>

      {/* Avatar Section */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-md flex items-center justify-center">
            <Camera className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile Picture</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Upload a photo to personalize your account</p>
          </div>
        </div>
        <div className="p-6">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            {/* Avatar preview */}
            <div className="relative">
              {profile?.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={profile.avatarUrl}
                  alt={profile.fullName}
                  className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 dark:border-gray-700"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center border-2 border-gray-200 dark:border-gray-700">
                  <span className="text-2xl font-semibold text-gray-400">{userInitials}</span>
                </div>
              )}
              {uploadingAvatar && (
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                </div>
              )}
            </div>

            {/* Upload controls */}
            <div className="flex flex-col gap-2 w-full sm:w-auto items-center sm:items-start">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-300 transition-colors text-sm font-medium disabled:opacity-50 w-full sm:w-auto"
              >
                <Camera className="w-4 h-4" />
                {profile?.avatarUrl ? 'Change Photo' : 'Upload Photo'}
              </button>
              {profile?.avatarUrl && (
                <button
                  onClick={handleRemoveAvatar}
                  disabled={uploadingAvatar}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors text-sm font-medium disabled:opacity-50 w-full sm:w-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove
                </button>
              )}
              <p className="text-xs text-gray-400 mt-1">PNG, JPEG, or WebP. Max 2MB.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Information */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
            <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile Information</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Update your name and contact details</p>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="email"
                value={profile?.email || ''}
                disabled
                className="w-full pl-12 pr-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Email cannot be changed
            </p>
          </div>

          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Full Name
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="fullName"
                value={formData.fullName}
                onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
                autoComplete="name"
                className="w-full pl-12 pr-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:ring-2 focus:ring-gray-900 focus:border-gray-900 transition-all dark:placeholder-gray-400"
                placeholder="Enter your full name"
              />
            </div>
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Phone Number
            </label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="+1 234 567 8900"
                autoComplete="tel"
                className="w-full pl-12 pr-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:ring-2 focus:ring-gray-900 focus:border-gray-900 transition-all dark:placeholder-gray-400"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md hover:bg-gray-800 dark:hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Appearance & Display Settings: Text Size & Theme Palette */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-2xs">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/30 rounded-xl flex items-center justify-center">
              <Palette className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Appearance & Display</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Customize text size and color themes for POS & app</p>
            </div>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
            {TEXT_SCALE_LABELS[textScale] || '100%'} · {palette}
          </span>
        </div>

        <div className="p-6 space-y-6">
          {/* Display & Cashier Text Size Zoom */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                <Type className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Cashier & Application Text Size
              </label>
              <span className="text-xs font-mono font-bold text-teal-600 dark:text-teal-400">
                {TEXT_SCALE_LABELS[textScale] || '100%'}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Increases or decreases button, product, and cart text size across all cashier screens and reports.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {TEXT_SCALES.map((s) => {
                const isSelected = Math.abs(textScale - s) < 0.01
                const label = s === 0.9 ? '90% (Compact)' : s === 1 ? '100% (Default)' : s === 1.1 ? '110% (Medium)' : s === 1.25 ? '125% (Large)' : '140% (XL)'
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleTextScaleChange(s)}
                    className={cn(
                      'flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all',
                      isSelected
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 ring-2 ring-teal-500/30 font-bold shadow-xs'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 bg-gray-50/50 dark:bg-gray-700/30'
                    )}
                  >
                    <span className="text-sm font-bold">{TEXT_SCALE_LABELS[s]}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{label.split(' ')[1] || ''}</span>
                  </button>
                )
              })}
            </div>

            {/* Live Text Size Preview */}
            <div className="mt-3 p-3.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 block mb-1">Live Text Preview</span>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-gray-900 dark:text-white" style={{ fontSize: `${textScale * 14}px` }}>
                  Sample Item: Premium Basmati 5kg · Rs. 2,450.00
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold">
                  Active
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-5">
            {/* Color Mode */}
            <label className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-2">
              <Sun className="w-4 h-4 text-amber-500" />
              Theme Mode
            </label>
            <div className="grid grid-cols-3 gap-2.5 mb-5">
              {[
                { value: 'light' as const, label: 'Light', icon: Sun, desc: 'Clean white surfaces' },
                { value: 'dark' as const, label: 'Dark', icon: Moon, desc: 'Eye-friendly low glare' },
                { value: 'system' as const, label: 'System', icon: Monitor, desc: 'Sync with OS' },
              ].map(({ value, label, icon: Icon, desc }) => {
                const isSelected = theme === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleThemeModeChange(value)}
                    className={cn(
                      'flex flex-col items-center justify-center p-3 rounded-xl border text-xs transition-all',
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/30 font-bold shadow-xs'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 bg-gray-50/50 dark:bg-gray-700/30'
                    )}
                  >
                    <Icon className="w-5 h-5 mb-1.5" />
                    <span className="font-semibold">{label}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 text-center">{desc}</span>
                  </button>
                )
              })}
            </div>

            {/* Color Palettes */}
            <label className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-2">
              <Palette className="w-4 h-4 text-purple-500" />
              Theme Color Palette
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Applies a coordinated accent color across navigation, tables, buttons, and POS checkout.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {PROFILE_PALETTES.map((p) => {
                const isSelected = palette === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handlePaletteChange(p.value)}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-xl border text-left text-xs transition-all',
                      isSelected
                        ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/30 text-teal-900 dark:text-teal-200 ring-2 ring-teal-500/30 font-semibold'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-gray-50/50 dark:bg-gray-700/30 text-gray-700 dark:text-gray-300'
                    )}
                  >
                    <span
                      className="w-5 h-5 rounded-full shrink-0 shadow-xs border border-white/20 flex items-center justify-center text-white"
                      style={{ backgroundColor: p.accent }}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <div className="min-w-0">
                      <span className="block font-medium truncate">{p.label}</span>
                      <span className="block text-[10px] text-gray-500 dark:text-gray-400 truncate">{p.desc}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-md flex items-center justify-center">
            <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Change Password</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Update your account password</p>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {passwordError && (
            <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-md text-sm flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {passwordError}
            </div>
          )}

          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Current Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="currentPassword"
                type={showPasswords.current ? 'text' : 'password'}
                value={passwordData.currentPassword}
                onChange={(e) =>
                  setPasswordData((prev) => ({ ...prev, currentPassword: e.target.value }))
                }
                autoComplete="current-password"
                className="w-full pl-12 pr-12 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:ring-2 focus:ring-gray-900 focus:border-gray-900 transition-all dark:placeholder-gray-400"
                placeholder="Enter current password"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((prev) => ({ ...prev, current: !prev.current }))}
                aria-label={showPasswords.current ? 'Hide password' : 'Show password'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showPasswords.current ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="newPassword"
                type={showPasswords.new ? 'text' : 'password'}
                value={passwordData.newPassword}
                onChange={(e) =>
                  setPasswordData((prev) => ({ ...prev, newPassword: e.target.value }))
                }
                autoComplete="new-password"
                className="w-full pl-12 pr-12 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:ring-2 focus:ring-gray-900 focus:border-gray-900 transition-all dark:placeholder-gray-400"
                placeholder="Enter new password"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((prev) => ({ ...prev, new: !prev.new }))}
                aria-label={showPasswords.new ? 'Hide password' : 'Show password'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showPasswords.new ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Must be at least 4 characters
            </p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Confirm New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="confirmPassword"
                type={showPasswords.confirm ? 'text' : 'password'}
                value={passwordData.confirmPassword}
                onChange={(e) =>
                  setPasswordData((prev) => ({ ...prev, confirmPassword: e.target.value }))
                }
                autoComplete="new-password"
                className="w-full pl-12 pr-12 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:ring-2 focus:ring-gray-900 focus:border-gray-900 transition-all dark:placeholder-gray-400"
                placeholder="Confirm new password"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((prev) => ({ ...prev, confirm: !prev.confirm }))}
                aria-label={showPasswords.confirm ? 'Hide password' : 'Show password'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showPasswords.confirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleChangePassword}
              disabled={
                savingPassword ||
                !passwordData.currentPassword ||
                !passwordData.newPassword ||
                !passwordData.confirmPassword
              }
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md hover:bg-gray-800 dark:hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
            >
              {savingPassword ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              {savingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>

      {/* Account Info */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center">
            <Shield className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Account Information</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Your account details</p>
          </div>
        </div>
        <div className="p-6">
          <div className="grid gap-4">
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">Account ID</span>
              </div>
              <span className="font-mono text-sm text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded">
                {profile?.id?.slice(0, 8)}...
              </span>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">Member since</span>
              </div>
              <span className="text-gray-900 dark:text-white font-medium">
                {profile?.createdAt
                  ? new Date(profile.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '-'}
              </span>
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">Email verified</span>
              </div>
              {profile?.emailVerified ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium rounded-full">
                  <Check className="w-4 h-4" />
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-sm font-medium rounded-full">
                  Pending
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

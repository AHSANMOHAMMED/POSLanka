// Downloads from the super-admin console: saved to the app's cache and handed to the Android share
// sheet (Files, Drive, WhatsApp, email…). The sheet can close before the chosen app has read the
// file, so it stays until the next download or sign-out, which clear the folder.
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { getApiBase } from './api'
import { SYS_CONTROL_PREFIX, getAdminToken } from './adminApi'

const DOWNLOAD_DIR = `${FileSystem.cacheDirectory}admin-downloads/`

export async function clearAdminDownloads(): Promise<void> {
  await FileSystem.deleteAsync(DOWNLOAD_DIR, { idempotent: true }).catch(() => undefined)
}

export function downloadName(vendorName: string, what: string, extension: 'csv' | 'zip'): string {
  const slug = vendorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vendor'
  return `${slug}-${what}.${extension}`
}

/** Returns an error message, or null once the share sheet has been shown. `onBytes` reports progress. */
export async function adminDownload(path: string, fileName: string, onBytes?: (bytes: number) => void): Promise<string | null> {
  if (!path.startsWith(SYS_CONTROL_PREFIX)) return 'Not a console download'
  const token = await getAdminToken()
  await clearAdminDownloads()
  await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true })
  const uri = `${DOWNLOAD_DIR}${fileName}`
  const task = FileSystem.createDownloadResumable(
    `${getApiBase()}${path}`,
    uri,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    (p) => onBytes?.(p.totalBytesWritten),
  )
  try {
    const res = await task.downloadAsync()
    if (!res) return 'The download was stopped.'
    if (res.status !== 200) {
      // A refused download leaves the server's JSON error in the file
      const body = await FileSystem.readAsStringAsync(uri).catch(() => '')
      await clearAdminDownloads()
      try {
        return (JSON.parse(body) as { error?: string }).error || `Download failed (${res.status})`
      } catch {
        return `Download failed (${res.status})`
      }
    }
    if (!(await Sharing.isAvailableAsync())) return 'This phone cannot share files.'
    await Sharing.shareAsync(uri, {
      mimeType: fileName.endsWith('.zip') ? 'application/zip' : 'text/csv',
      dialogTitle: fileName,
    })
    return null
  } catch {
    await clearAdminDownloads()
    return 'The download failed. Check your connection and try again.'
  }
}

/**
 * Encryption at rest for third-party credentials kept in the database (messaging provider API keys,
 * WhatsApp access token …). AES-256-GCM; the key is SHA-256 of SECRETS_ENCRYPTION_KEY, falling back
 * to NEXTAUTH_SECRET so existing deployments work without a new variable.
 * Changing the key makes stored secrets unreadable: they have to be entered again.
 *
 * Format: "enc:v1:" + base64url(iv[12] | tag[16] | ciphertext). Server-only.
 */
import crypto from 'crypto'

const PREFIX = 'enc:v1:'

function key(): Buffer {
  const material = process.env.SECRETS_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!material) {
    if (process.env.NODE_ENV === 'production') throw new Error('SECRETS_ENCRYPTION_KEY or NEXTAUTH_SECRET is required to store credentials')
    return crypto.createHash('sha256').update('poslanka-dev-secret-box').digest()
  }
  return crypto.createHash('sha256').update(`secret-box:${material}`).digest()
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

/** Plain text, or null when the value is empty or cannot be decrypted (wrong key / tampered). */
export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (!isEncrypted(value)) return value // legacy plain value
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** "••••••3f9a" — enough to recognise which key is saved, never the key itself. */
export function maskSecret(plain: string | null | undefined): string {
  if (!plain) return ''
  return plain.length <= 8 ? '••••••' : `••••••${plain.slice(-4)}`
}

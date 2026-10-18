import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createSession, validateSession } from '@/lib/auth/session-manager'
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit, LOGIN_RATE_LIMIT } from '@/lib/auth/rate-limit'

// Determine cookie domain based on environment
const getCookieDomain = () => {
  if (process.env.NODE_ENV === 'production') {
    const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'poslanka.lk').split(':')[0]
    if (base === 'localhost' || base === '127.0.0.1') return undefined
    return `.${base}`
  }
  return undefined
}

export const {
  handlers: accountHandlers,
  signIn: accountSignIn,
  signOut: accountSignOut,
  auth: accountAuth,
} = NextAuth({
  trustHost: true,
  providers: [
    // Google OAuth provider (optional)
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })]
      : []),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = (credentials.email as string).toLowerCase()
        const password = credentials.password as string

        // Extract IP and user-agent from request for session tracking
        const reqIp = request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
          || request?.headers?.get?.('x-real-ip')
          || 'unknown'
        const reqUserAgent = request?.headers?.get?.('user-agent') || 'unknown'

        // Brute-force protection: check rate limit before any DB work
        const rateLimitResult = await checkRateLimit(email, LOGIN_RATE_LIMIT)
        if (rateLimitResult.limited) {
          console.warn('[AccountAuth] Rate limited login attempt:', { email })
          throw new Error('Too many failed login attempts. Please try again later.')
        }

        try {
          const account = await db.query.accounts.findFirst({
            where: eq(accounts.email, email),
          })

          if (!account) {
            await recordRateLimitAttempt(email, LOGIN_RATE_LIMIT)
            throw new Error('Invalid email or password')
          }

          // Google-only accounts may not have a password
          if (!account.passwordHash) {
            throw new Error('Please sign in with Google')
          }

          const isValidPassword = await bcrypt.compare(password, account.passwordHash)
          if (!isValidPassword) {
            await recordRateLimitAttempt(email, LOGIN_RATE_LIMIT)
            throw new Error('Invalid email or password')
          }

          // Clear rate limit on successful login
          await clearRateLimit(email, LOGIN_RATE_LIMIT.category)

          // Update last login and activity
          await db.update(accounts)
            .set({ lastLoginAt: new Date(), lastActiveAt: new Date() })
            .where(eq(accounts.id, account.id))

          return {
            id: account.id,
            accountId: account.id,
            email: account.email,
            name: account.fullName,
            isSuperAdmin: account.isSuperAdmin ?? false,
            mode: 'account' as const,
            role: '',
            tenantId: '',
            tenantSlug: '',
            tenantName: '',
            businessType: '',
            isOwner: false,
            aiEnabled: false,
            logoUrl: undefined,
            avatarUrl: undefined,
            sessionToken: crypto.randomBytes(32).toString('hex'),
            _sessionMeta: { ip: reqIp, userAgent: reqUserAgent },
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error('[AccountAuth] authorize() failed:', { email, error: errorMessage })
          return null
        }
      },
    }),
  ],
  cookies: {
    sessionToken: {
      name: 'account-session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        domain: getCookieDomain(),
      }
    },
    callbackUrl: {
      name: 'account-auth.callback-url',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        domain: getCookieDomain(),
      }
    },
    csrfToken: {
      name: 'account-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        domain: getCookieDomain(),
      }
    },
    pkceCodeVerifier: {
      name: 'account-auth.pkce.code_verifier',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        domain: getCookieDomain(),
        maxAge: 60 * 15,
      }
    },
  },
  callbacks: {
    async signIn({ user, account: authAccount }) {
      // Handle Google OAuth sign-in
      if (authAccount?.provider === 'google' && user.email) {
        try {
          let existingAccount = await db.query.accounts.findFirst({
            where: eq(accounts.email, user.email.toLowerCase()),
          })

          if (existingAccount) {
            if (!existingAccount.googleId) {
              await db.update(accounts)
                .set({
                  googleId: authAccount.providerAccountId,
                  emailVerified: true,
                  lastLoginAt: new Date(),
                  lastActiveAt: new Date(),
                })
                .where(eq(accounts.id, existingAccount.id))
            } else {
              await db.update(accounts)
                .set({ lastLoginAt: new Date(), lastActiveAt: new Date() })
                .where(eq(accounts.id, existingAccount.id))
            }
          } else {
            const [newAccount] = await db.insert(accounts).values({
              email: user.email.toLowerCase(),
              passwordHash: '',
              fullName: user.name || user.email.split('@')[0],
              phone: '',
              googleId: authAccount.providerAccountId,
              emailVerified: true,
              isActive: true,
              country: 'LK',
              currency: 'LKR',
            }).returning()
            existingAccount = newAccount
          }

          user.id = existingAccount.id
          user.accountId = existingAccount.id
          user.email = existingAccount.email
          user.name = existingAccount.fullName
          user.isSuperAdmin = existingAccount.isSuperAdmin
          user.mode = 'account'
          user.sessionToken = crypto.randomBytes(32).toString('hex')
        } catch (error) {
          console.error('Google sign-in error:', error)
          return false
        }
      }
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.accountId = user.accountId || user.id
        token.isSuperAdmin = user.isSuperAdmin
        token.mode = 'account'
        token.invalid = false

        // Store session token and create DB session record
        if (user.sessionToken) {
          token.sessionToken = user.sessionToken
          const meta = (user as unknown as Record<string, unknown>)._sessionMeta as { ip: string; userAgent: string } | undefined
          try {
            await createSession(user.accountId || user.id, 'account', {
              sessionToken: user.sessionToken,
              ipAddress: meta?.ip,
              userAgent: meta?.userAgent,
            })
          } catch (err) {
            console.error('[AccountAuth] Failed to create session record:', err)
          }
        }
      }

      // Validate DB session is still active (not revoked)
      if (!user && token.sessionToken) {
        try {
          const dbSession = await validateSession(token.sessionToken as string)
          if (!dbSession) {
            token.invalid = true
            return token
          }
        } catch (error) {
          console.error('[AccountAuth JWT] Session DB validation error (keeping session):', error)
        }
      }

      // Validate account still exists on every request
      if (!user && token.accountId) {
        try {
          const account = await db.query.accounts.findFirst({
            where: eq(accounts.id, token.accountId as string),
            columns: { id: true, avatarUrl: true, passwordChangedAt: true },
          })
          if (!account) {
            token.invalid = true
            return token
          }

          // Invalidate session if password was changed after token was issued
          if (account.passwordChangedAt && token.iat) {
            const pwChangedSec = Math.floor(account.passwordChangedAt.getTime() / 1000)
            if (pwChangedSec >= (token.iat as number)) {
              token.invalid = true
              return token
            }
          }

          token.avatarUrl = account.avatarUrl || undefined
          if (token.invalid) {
            token.invalid = false
          }
        } catch (error) {
          console.error('[AccountAuth JWT] Validation DB error (keeping session):', error)
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.invalid) {
          session.user.id = ''
          session.user.accountId = null
          session.user.role = ''
          session.user.tenantId = ''
          session.user.tenantSlug = ''
          session.user.tenantName = ''
          session.user.businessType = ''
          session.user.isSuperAdmin = false
          session.user.isOwner = false
          session.user.mode = 'account'
          return session
        }

        session.user.id = token.id as string
        session.user.accountId = token.accountId as string
        session.user.role = ''
        session.user.tenantId = ''
        session.user.tenantSlug = ''
        session.user.tenantName = ''
        session.user.businessType = ''
        session.user.isSuperAdmin = token.isSuperAdmin as boolean
        session.user.isOwner = false
        session.user.mode = 'account'
        session.user.avatarUrl = token.avatarUrl as string | undefined
        session.user.sessionToken = token.sessionToken as string | undefined
      }
      return session
    },
  },
  basePath: '/api/account-auth',
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 15 * 60, // 15 minutes — auto-refreshed by SessionProvider refetchInterval
  },
})

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq, or } from 'drizzle-orm'
import { getCurrencyByCountry, getCountryByCode } from '@/lib/utils/countries'
import { logError } from '@/lib/ai/error-logger'
import { checkRateLimit, recordRateLimitAttempt, REGISTER_RATE_LIMIT } from '@/lib/auth/rate-limit'
import { validateBody } from '@/lib/validation'
import { registerSchema } from '@/lib/validation/schemas/auth'

export async function POST(request: NextRequest) {
  try {
    // Database-backed rate limiting by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    const rateLimitResult = await checkRateLimit(ip, REGISTER_RATE_LIMIT)
    if (rateLimitResult.limited) {
      return NextResponse.json({ error: 'Too many registration attempts. Please try again later.' }, { status: 429 })
    }

    await recordRateLimitAttempt(ip, REGISTER_RATE_LIMIT)

    const parsed = await validateBody(request, registerSchema)
    if (!parsed.success) return parsed.response

    const { fullName, email, password, country, phone, verificationToken, tosAcceptedAt } = parsed.data

    // Validate country exists in lookup
    const countryData = getCountryByCode(country)
    if (!countryData) {
      return NextResponse.json(
        { error: 'Invalid country selected' },
        { status: 400 }
      )
    }

    // Check if email or phone already exists
    const existingAccount = await db.query.accounts.findFirst({
      where: or(
        eq(accounts.email, email.toLowerCase()),
        eq(accounts.phone, phone.trim()),
      ),
    })

    if (existingAccount) {
      if (existingAccount.email === email.toLowerCase()) {
        return NextResponse.json(
          { error: 'This email is already registered' },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: 'This mobile number is already registered' },
        { status: 400 }
      )
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Create account in a transaction with re-verification
    const result = await db.transaction(async (tx) => {
      // Re-verify uniqueness inside transaction to prevent race conditions
      const existingInTx = await tx.query.accounts.findFirst({
        where: or(
          eq(accounts.email, email.toLowerCase()),
          eq(accounts.phone, phone.trim()),
        ),
      })
      if (existingInTx) {
        if (existingInTx.email === email.toLowerCase()) {
          throw new Error('DUPLICATE_EMAIL')
        }
        throw new Error('DUPLICATE_PHONE')
      }

      // Validate verification token if provided
      let emailVerified = false
      if (verificationToken) {
        try {
          const secret = process.env.NEXTAUTH_SECRET
          if (secret) {
            const { payload } = await jwtVerify(
              verificationToken,
              new TextEncoder().encode(secret)
            )
            if (payload.email === email.toLowerCase() && payload.verified === true) {
              emailVerified = true
            }
          }
        } catch {
          // Token invalid/expired - account still created but not verified
        }
      }

      // Create account with country and currency
      const currency = getCurrencyByCountry(country)
      const [newAccount] = await tx.insert(accounts).values({
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        phone: phone.trim(),
        country,
        currency,
        emailVerified,
        tosAcceptedAt: tosAcceptedAt ? new Date(tosAcceptedAt) : null,
      }).returning()

      return newAccount
    })

    return NextResponse.json({
      success: true,
      message: 'Account created successfully. Please sign in.',
      accountId: result.id,
    })
  } catch (error) {
    logError('api/register', error)
    const message = error instanceof Error ? error.message : ''

    // Handle specific race condition errors
    if (message === 'DUPLICATE_EMAIL') {
      return NextResponse.json(
        { error: 'This email is already registered' },
        { status: 400 }
      )
    }
    if (message === 'DUPLICATE_PHONE') {
      return NextResponse.json(
        { error: 'This mobile number is already registered' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 500 }
    )
  }
}

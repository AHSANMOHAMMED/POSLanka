import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Use admin connection for migrations (superuser, bypasses RLS)
    url: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL!,
  },
})

// Loads .env, .env.local and .env.<mode>(.local) exactly like `next dev` / `next start`, before any
// module imported by server.ts reads process.env. (dotenv/config only read .env, so a setup with
// just .env.local exited with "DATABASE_URL is required".) Existing environment variables win.
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')

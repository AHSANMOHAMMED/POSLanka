import 'dotenv/config'
import { db } from '../src/lib/db'
import { users } from '../src/lib/db/schema'
import { eq } from 'drizzle-orm'

const tenantId = 'f4098a06-24d4-45d8-ade4-23d6426debd7'

async function main() {
  // Check users in this tenant
  const tenantUsers = await db.query.users.findMany({
    where: eq(users.tenantId, tenantId),
    columns: { id: true, fullName: true, email: true, role: true }
  })

  console.log(`Users in tenant (${tenantUsers.length}):`)
  tenantUsers.forEach(u => console.log(`  - ${u.id}: ${u.fullName} (${u.email}) - ${u.role}`))

  // Check accounts table
  const allAccounts = await db.query.accounts.findMany({
    columns: { id: true, fullName: true, email: true }
  })

  console.log(`\nAccounts (${allAccounts.length}):`)
  allAccounts.forEach(a => console.log(`  - ${a.id}: ${a.fullName} (${a.email})`))

  process.exit(0)
}

main()

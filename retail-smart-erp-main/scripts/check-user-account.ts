import 'dotenv/config'
import { db } from '../src/lib/db'
import { users } from '../src/lib/db/schema'
import { eq } from 'drizzle-orm'

const tenantId = 'f4098a06-24d4-45d8-ade4-23d6426debd7'
const accountId = 'c705ee57-b6b5-42f0-8c68-62228bb29d82'

async function main() {
  // Check users in this tenant with their accountId
  const tenantUsers = await db.query.users.findMany({
    where: eq(users.tenantId, tenantId),
  })

  console.log('Users in tenant with accountId:')
  tenantUsers.forEach(u => {
    console.log(`  - ${u.id}`)
    console.log(`    name: ${u.fullName}`)
    console.log(`    email: ${u.email}`)
    console.log(`    accountId: ${u.accountId || 'NULL <-- MISSING!'}`)
    console.log('')
  })

  // Check if any user is linked to the account
  const linkedUser = tenantUsers.find(u => u.accountId === accountId)
  if (linkedUser) {
    console.log(`✓ Found user linked to account: ${linkedUser.id}`)
  } else {
    console.log(`✗ No user is linked to account ${accountId}`)
    console.log('\nFIX: Need to link user to account by setting users.accountId')
  }

  process.exit(0)
}

main()

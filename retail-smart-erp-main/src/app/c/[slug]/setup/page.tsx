import { db } from '@/lib/db'
import { SetupWizard } from './_components/SetupWizard'
import { SetupCompletePage } from './_components/SetupCompletePage'
import { eq } from 'drizzle-orm'
import { tenants } from '@/lib/db/schema'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function SetupPage({ params }: PageProps) {
  try {
    const { slug } = await params

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
      columns: {
        id: true,
        setupCompletedAt: true
      }
    })

    // Show friendly "already complete" page if setup is done
    if (tenant?.setupCompletedAt) {
      return <SetupCompletePage slug={slug} />
    }

    return <SetupWizard companySlug={slug} />
  } catch (error) {
    console.error('Setup page error:', error)
    // Return a basic error UI that won't crash
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center p-8 max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Setup Error
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Unable to load setup wizard. Please check your database connection and try again.
          </p>
          <div className="text-xs text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 p-4 rounded font-mono">
            {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        </div>
      </div>
    )
  }
}

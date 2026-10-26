import { redirect } from 'next/navigation'

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/c/${slug}/items`)
}


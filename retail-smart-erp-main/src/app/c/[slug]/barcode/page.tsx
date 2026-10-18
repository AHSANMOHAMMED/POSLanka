import { redirect } from 'next/navigation'

export default async function BarcodePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/c/${slug}/barcode/print`)
}

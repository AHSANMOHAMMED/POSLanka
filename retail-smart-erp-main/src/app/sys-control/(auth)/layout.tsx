export default function AdminAuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // No authentication check for auth pages
  return <>{children}</>
}

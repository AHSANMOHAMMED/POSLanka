// Minimal root layout for /sys-control/ routes
// This layout applies to ALL routes under /sys-control/, including login
// Authentication is handled in the (protected) route group layout

export default function SysControlRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

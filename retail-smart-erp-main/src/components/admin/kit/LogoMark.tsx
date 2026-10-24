/** skyERPOS square icon (same artwork as the favicon / app icon). */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset
    <img src="/icons/icon-192.png" alt="" aria-hidden="true" width={size} height={size} className={`rounded-[22%] ${className ?? ''}`} draggable={false} />
  )
}

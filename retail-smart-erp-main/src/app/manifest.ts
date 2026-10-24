import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'skyERPOS',
    short_name: 'skyERPOS',
    description: 'Powerful. Reliable. Complete POS solution for your business.',
    start_url: '/login',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0050c0',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}

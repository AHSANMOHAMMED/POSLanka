import type { NextConfig } from "next";
import packageJson from './package.json';

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: packageJson.version,
  },
  // Restrict image optimization to known domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: 'cdn.retailsmarterp.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
    qualities: [75, 85, 90],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=()'
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://www.payhere.lk https://sandbox.payhere.lk https://static.cloudflareinsights.com https://www.googletagmanager.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://cdn.retailsmarterp.com https://lh3.googleusercontent.com https://images.unsplash.com https://www.google-analytics.com https://www.googletagmanager.com",
              "media-src 'self' blob: https://cdn.retailsmarterp.com https://*.r2.cloudflarestorage.com",
              "connect-src 'self' https://*.retailsmarterp.com wss://*.retailsmarterp.com ws://localhost:* https://api.resend.com https://www.payhere.lk https://sandbox.payhere.lk https://generativelanguage.googleapis.com https://api.deepseek.com https://*.cloudflareinsights.com https://www.google-analytics.com https://www.googletagmanager.com https://analytics.google.com https://*.google-analytics.com https://stats.g.doubleclick.net",
              "frame-src 'self' blob: https://cdn.retailsmarterp.com https://*.r2.cloudflarestorage.com https://www.payhere.lk https://sandbox.payhere.lk",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self' https://www.payhere.lk https://sandbox.payhere.lk",
            ].join('; ')
          }
        ]
      }
    ]
  }
};

export default nextConfig;

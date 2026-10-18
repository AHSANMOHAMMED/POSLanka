import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/c/', '/account/', '/sys-control/'],
      },
      {
        userAgent: [
          'GPTBot',
          'Google-Extended',
          'ChatGPT-User',
          'CCBot',
          'Bytespider',
          'PerplexityBot',
          'Applebot-Extended',
          'cohere-ai',
          'YouBot',
          'Meta-ExternalAgent',
        ],
        allow: '/',
      },
    ],
    sitemap: 'https://www.retailsmarterp.com/sitemap.xml',
  }
}

/**
 * Sanitize HTML to prevent XSS attacks.
 * Removes script tags, event handlers, and dangerous URLs.
 * Works in both browser (DOMParser) and server (regex fallback) environments.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''

  // Server-side: use regex-based sanitization
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return sanitizeHtmlServer(html)
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Remove script tags
  doc.querySelectorAll('script').forEach(el => el.remove())

  // Remove iframe, object, embed, form, meta, link, base, svg, math, style, template, noscript elements
  doc.querySelectorAll('iframe, object, embed, form, meta, link, base, svg, math, style, template, noscript').forEach(el => el.remove())

  // Remove event handlers and dangerous attributes from all elements
  doc.querySelectorAll('*').forEach(el => {
    const attrs = Array.from(el.attributes)
    for (const attr of attrs) {
      const name = attr.name.toLowerCase()
      // Remove on* event handlers (onclick, onerror, onload, etc.)
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
      }
      // Remove javascript:, data:, and vbscript: URLs from href/src/action attributes
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name)) {
        const val = attr.value.trim().toLowerCase()
        if (val.startsWith('javascript:') || val.startsWith('data:') || val.startsWith('vbscript:')) {
          el.removeAttribute(attr.name)
        }
      }
    }
  })

  return doc.body.innerHTML
}

/**
 * Regex-based HTML sanitization for server-side use.
 * Less precise than DOMParser but safe — strips dangerous tags and attributes.
 */
function sanitizeHtmlServer(html: string): string {
  let sanitized = html

  // Remove dangerous tags and their contents
  const dangerousTags = ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'base', 'style', 'template', 'noscript']
  for (const tag of dangerousTags) {
    sanitized = sanitized.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
    sanitized = sanitized.replace(new RegExp(`<${tag}[^>]*\\/?>`, 'gi'), '')
  }

  // Remove svg and math (can contain scripts)
  sanitized = sanitized.replace(/<svg[\s\S]*?<\/svg>/gi, '')
  sanitized = sanitized.replace(/<math[\s\S]*?<\/math>/gi, '')

  // Remove on* event handler attributes
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  // Remove javascript:, vbscript:, data: URLs in attributes
  sanitized = sanitized.replace(/(href|src|action|formaction)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
  sanitized = sanitized.replace(/(href|src|action|formaction)\s*=\s*(?:"vbscript:[^"]*"|'vbscript:[^']*')/gi, '')
  sanitized = sanitized.replace(/(href|src|action|formaction)\s*=\s*(?:"data:[^"]*"|'data:[^']*')/gi, '')

  return sanitized
}

/**
 * Sanitize untrusted HTML (letterheads, receipt/email previews, DOCX output) before it is
 * rendered with dangerouslySetInnerHTML or written into a print document.
 *
 * Allowlist based: only the tags and attributes below survive; everything else is dropped.
 * URL attributes are checked after entity-decoding and removing whitespace/control
 * characters, so tricks like `java&#9;script:` or ` javascript:` are caught.
 * The same rules run in the browser (DOMParser) and on the server (tokenizer).
 *
 * Note: <svg>, <style> and data: URLs (except raster images in <img src>) are removed.
 * Label previews need SVG barcodes and use src/lib/labels/sanitize-label-html.ts instead.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption',
  'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q',
  's', 'samp', 'section', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
])

/** Elements removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript',
  'textarea', 'select', 'title', 'head', 'frameset', 'frame', 'noembed', 'noframes', 'xmp',
  'plaintext', 'applet', 'audio', 'video', 'canvas',
])

const VOID_TAGS = new Set(['br', 'col', 'hr', 'img', 'wbr'])

const ALLOWED_ATTRS = new Set([
  'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'class', 'color', 'colspan',
  'dir', 'face', 'headers', 'height', 'href', 'id', 'lang', 'rel', 'rowspan', 'scope', 'size',
  'span', 'src', 'start', 'style', 'target', 'title', 'type', 'valign', 'width', 'datetime',
])

const URL_ATTRS = new Set(['href', 'src'])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t',
  newline: '\n', sol: '/', lpar: '(', rpar: ')', semi: ';', comma: ',', period: '.',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? m
  })
}

/** True when a URL attribute value is safe: http(s), mailto, tel, relative, or (img only) a raster data URL. */
export function isSafeUrl(raw: string, allowImageData = false): boolean {
  const compact = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase()
  if (!compact) return true
  if (allowImageData && /^data:image\/(png|jpe?g|gif|webp|bmp);/.test(compact)) return true
  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/)
  if (!scheme) return true // relative URL, fragment or query
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1])
}

function isSafeStyle(value: string): boolean {
  const v = decodeEntities(value).replace(/\\/g, '').replace(/\s+/g, '').toLowerCase()
  return !/expression\(|javascript:|vbscript:|-moz-binding|behavior:|@import/.test(v) &&
    !/url\((?!['"]?(https?:|data:image\/(png|jpe?g|gif|webp);|\/|#))/.test(v)
}

function keepAttr(tag: string, name: string, value: string): boolean {
  if (!ALLOWED_ATTRS.has(name)) return false
  if (URL_ATTRS.has(name)) return isSafeUrl(value, tag === 'img' && name === 'src')
  if (name === 'style') return isSafeStyle(value)
  return true
}

/**
 * Make custom CSS safe to place inside a <style> element: removes every `<` so the
 * stylesheet can never close the style tag and inject markup, plus legacy script vectors.
 */
export function sanitizeCss(css: string | null | undefined): string {
  if (!css) return ''
  return String(css)
    .replace(/</g, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/(javascript|vbscript)\s*:/gi, '')
    .replace(/-moz-binding/gi, '')
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return sanitizeHtmlServer(html)
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase()
      if (DROP_WITH_CONTENT.has(tag)) {
        el.remove()
        continue
      }
      walk(el)
      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: keep the (already sanitized) children, drop the element itself.
        el.replaceWith(...Array.from(el.childNodes))
        continue
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        if (!keepAttr(tag, name, attr.value)) el.removeAttribute(attr.name)
      }
      if (tag === 'a' && el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer')
    }
  }
  walk(doc.body)
  // Comments are inert in innerHTML, but remove them so nothing odd survives round-trips.
  const it = doc.createNodeIterator(doc.body, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  for (let n = it.nextNode(); n; n = it.nextNode()) comments.push(n)
  comments.forEach((c) => c.parentNode?.removeChild(c))
  return doc.body.innerHTML
}

function escapeText(s: string): string {
  return s.replace(/&(?!(#x[0-9a-f]+|#\d+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Server-side allowlist sanitizer: tokenizes tags and rebuilds only allowed ones. */
function sanitizeHtmlServer(html: string): string {
  let src = String(html).replace(/<!--[\s\S]*?(-->|$)/g, '')
  // Drop dangerous elements with their content.
  for (const tag of DROP_WITH_CONTENT) {
    src = src.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(<\\/${tag}\\s*>|$)`, 'gi'), '')
  }

  const out: string[] = []
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g
  const attrRe = /([^\s"'>/=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let last = 0
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    out.push(escapeText(src.slice(last, m.index)))
    last = tagRe.lastIndex
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) continue
    if (closing) {
      if (!VOID_TAGS.has(tag)) out.push(`</${tag}>`)
      continue
    }
    const attrs: string[] = []
    let hasBlankTarget = false
    for (let a = attrRe.exec(m[3]); a; a = attrRe.exec(m[3])) {
      const name = a[1].toLowerCase()
      const value = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '')
      if (!keepAttr(tag, name, value)) continue
      if (name === 'rel') continue
      if (name === 'target' && value === '_blank') hasBlankTarget = true
      attrs.push(`${name}="${escapeAttr(value)}"`)
    }
    attrRe.lastIndex = 0
    if (tag === 'a' && hasBlankTarget) attrs.push('rel="noopener noreferrer"')
    out.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`)
  }
  out.push(escapeText(src.slice(last)))
  return out.join('')
}

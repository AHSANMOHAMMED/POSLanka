/**
 * Sanitiser for label preview HTML (renderLabelHtml output).
 *
 * The general sanitizeHtml() removes every <svg> and every data: URL, which
 * also removed the barcode from every label preview (barcodes are inline SVG
 * bars, 2D codes are data:image/svg+xml images). This one is an allowlist
 * rebuild that keeps exactly what the label renderer produces - div / span /
 * img and the SVG drawing tags, inline styles, data-* attributes, image data
 * URLs - and drops everything else: script / style / foreignObject / iframe
 * (with their content), on* handlers, javascript: / vbscript: / data:text
 * URLs, CSS expressions and url() in styles.
 *
 * Pure string code (no DOM), so the browser and the tests run the same path.
 */

/** Tags removed together with everything inside them. */
const DROP_WITH_CONTENT = ['script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'template', 'noscript', 'math', 'textarea', 'select', 'xmp', 'noembed', 'noframes', 'title']

/** Tags kept (lower case). Anything else is unwrapped (tag removed, text kept). */
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'b', 'strong', 'i', 'em', 'small', 'img',
  'svg', 'g', 'rect', 'path', 'text', 'tspan', 'line', 'circle', 'ellipse', 'polygon', 'polyline',
])

/** Attributes kept (lower case) besides data-* and aria-*. */
const ALLOWED_ATTRS = new Set([
  'style', 'class', 'id', 'alt', 'role', 'title', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'fill', 'stroke', 'stroke-width', 'viewbox', 'preserveaspectratio', 'shape-rendering', 'font-size', 'font-family',
  'font-weight', 'text-anchor', 'dominant-baseline', 'transform', 'xmlns', 'src',
])

const VOID_TAGS = new Set(['br', 'img'])

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')

const escAttr = (s: string) => s.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Image sources a label may show: raster / SVG data URLs, http(s), blob and same-site paths. */
export function isSafeLabelImageSrc(value: string): boolean {
  const v = decodeEntities(value).replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase()
  if (!v) return false
  if (/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/.test(v)) return true
  if (/^(https?:|blob:)/.test(v)) return true
  // no scheme at all (relative / absolute path)
  const colon = v.indexOf(':')
  const slash = v.search(/[/?#]/)
  return colon === -1 || (slash !== -1 && slash < colon)
}

function safeStyle(value: string): boolean {
  const v = decodeEntities(value).replace(/\\/g, '').replace(/[\u0000- ]/g, '').toLowerCase()
  return !/expression\(|javascript:|vbscript:|url\(|@import|behavior:|-moz-binding/.test(v)
}

/** Parse the attribute part of a start tag. */
function parseAttrs(src: string): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = []
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    out.push([m[1], m[2] ?? m[3] ?? m[4] ?? null])
  }
  return out
}

export function sanitizeLabelHtml(html: string): string {
  if (!html) return ''
  let s = String(html)
  // comments, CDATA, doctype / processing instructions
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/gi, '').replace(/<[!?][^>]*>/g, '')
  // dangerous containers with their content (repeat for nesting)
  const dropRe = new RegExp(`<(${DROP_WITH_CONTENT.join('|')})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi')
  for (let i = 0; i < 10; i++) {
    const next = s.replace(dropRe, '')
    if (next === s) break
    s = next
  }

  let out = ''
  let last = 0
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+(?:[^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(s))) {
    // text between tags: any stray '<' / '>' becomes text
    out += s.slice(last, m.index).replace(/</g, '&lt;').replace(/>/g, '&gt;')
    last = tagRe.lastIndex
    const closing = m[1] === '/'
    const name = m[2]
    const lower = name.toLowerCase()
    if (!ALLOWED_TAGS.has(lower)) continue // unknown / unclosed dangerous tag: drop the tag only
    if (closing) {
      if (!VOID_TAGS.has(lower)) out += `</${name}>`
      continue
    }
    let attrs = ''
    for (const [rawName, value] of parseAttrs(m[3] || '')) {
      const an = rawName.toLowerCase()
      if (an.startsWith('on')) continue
      const allowed = ALLOWED_ATTRS.has(an) || /^data-[\w-]+$/.test(an) || /^aria-[\w-]+$/.test(an)
      if (!allowed) continue
      if (value == null) {
        attrs += ` ${rawName}`
        continue
      }
      if (an === 'src' && (lower !== 'img' || !isSafeLabelImageSrc(value))) continue
      if (an === 'style' && !safeStyle(value)) continue
      if (/(javascript|vbscript|data):/i.test(decodeEntities(value).replace(/\s/g, '')) && an !== 'src') continue
      attrs += ` ${rawName}="${escAttr(value)}"`
    }
    const selfClose = m[4] === '/' || VOID_TAGS.has(lower)
    out += `<${name}${attrs}${selfClose && !VOID_TAGS.has(lower) ? '/' : ''}>`
  }
  out += s.slice(last).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return out
}

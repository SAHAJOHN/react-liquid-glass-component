import { splitCss } from './paint-box'
import type { SceneRect } from './types'

type StyleReader = (element: Element, pseudo?: string | null) => CSSStyleDeclaration
type RectReader = (element: Element) => DOMRect

interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

interface ProofInput {
  element: Element
  root: Element
  readStyle: StyleReader
  readRect: RectReader
  canInclude: (element: HTMLElement, style: CSSStyleDeclaration) => boolean
  shouldSkip?: (element: Element) => boolean
  containsGlass: (element: Element) => boolean
}

const omitted = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'])
const zero: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

function finiteRect(rect: DOMRect): SceneRect | null {
  const result = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  return [
    result.x,
    result.y,
    result.width,
    result.height,
    result.x + result.width,
    result.y + result.height,
  ].every(Number.isFinite) &&
    result.width >= 0 &&
    result.height >= 0
    ? result
    : null
}

function union(a: SceneRect | undefined, b: SceneRect): SceneRect {
  if (!a) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

function expand(rect: SceneRect, insets: Insets): SceneRect {
  return {
    x: rect.x - insets.left,
    y: rect.y - insets.top,
    width: rect.width + insets.left + insets.right,
    height: rect.height + insets.top + insets.bottom,
  }
}

function addInsets(a: Insets, b: Insets): Insets {
  return {
    top: a.top + b.top,
    right: a.right + b.right,
    bottom: a.bottom + b.bottom,
    left: a.left + b.left,
  }
}

function length(value: string): number | null {
  if (/^[+-]?0(?:\.0+)?$/.test(value)) return 0
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/i.test(value)) return null
  const result = Number.parseFloat(value)
  return Number.isFinite(result) ? result : null
}

function topLevelTokens(input: string): string[] | null {
  const tokens: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let index = 0; index <= input.length; index += 1) {
    const character = input[index] ?? ' '
    if (quote) {
      if (character === quote && input[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth < 0) return null
    } else if (/\s/.test(character) && depth === 0) {
      const token = input.slice(start, index).trim()
      if (token) tokens.push(token)
      start = index + 1
    }
  }
  return depth === 0 && !quote ? tokens : null
}

function shadowOutsets(value: string): Insets | null {
  const tokens = topLevelTokens(value)
  if (!tokens) return null
  const lengths = tokens.map((token) => ({ token, value: length(token) }))
  const numeric = lengths.filter((entry) => entry.value !== null)
  const colors = lengths.filter((entry) => entry.value === null)
  if ((numeric.length !== 2 && numeric.length !== 3) || colors.length > 1) return null
  const [xEntry, yEntry, blurEntry] = numeric
  const x = xEntry?.value
  const y = yEntry?.value
  const blur = blurEntry?.value ?? 0
  if (x === null || x === undefined || y === null || y === undefined || blur < 0) return null
  const halo = Math.ceil(blur * 3) + (blur > 0 ? 2 : 1)
  return {
    top: Math.max(0, -y) + halo,
    right: Math.max(0, x) + halo,
    bottom: Math.max(0, y) + halo,
    left: Math.max(0, -x) + halo,
  }
}

function filterFunctions(value: string): Array<{ name: string; value: string }> | null {
  const input = value.trim()
  if (!input || input === 'none') return []
  const result: Array<{ name: string; value: string }> = []
  let index = 0
  while (index < input.length) {
    while (/\s/.test(input[index] ?? '')) index += 1
    const match = /^([a-z-]+)\(/i.exec(input.slice(index))
    if (!match?.[1]) return null
    const name = match[1].toLowerCase()
    index += match[0].length
    const start = index
    let depth = 1
    let quote = ''
    while (index < input.length && depth > 0) {
      const character = input[index] ?? ''
      if (quote) {
        if (character === quote && input[index - 1] !== '\\') quote = ''
      } else if (character === '"' || character === "'") quote = character
      else if (character === '(') depth += 1
      else if (character === ')') depth -= 1
      index += 1
    }
    if (depth !== 0 || quote) return null
    result.push({ name, value: input.slice(start, index - 1).trim() })
  }
  return result
}

function filterOutsets(value: string): Insets | null {
  const functions = filterFunctions(value)
  if (!functions) return null
  let result = zero
  for (const fn of functions) {
    if (fn.name === 'blur') {
      const blur = length(fn.value)
      if (blur === null || blur < 0) return null
      const halo = Math.ceil(blur * 3) + (blur > 0 ? 2 : 0)
      result = addInsets(result, { top: halo, right: halo, bottom: halo, left: halo })
      continue
    }
    if (fn.name === 'drop-shadow') {
      const shadow = shadowOutsets(fn.value)
      if (!shadow) return null
      result = addInsets(result, shadow)
      continue
    }
    if (
      ['brightness', 'contrast', 'grayscale', 'invert', 'opacity', 'saturate', 'sepia'].includes(
        fn.name
      ) &&
      /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|e[+-]?\d+)?$/i.test(fn.value)
    )
      continue
    if (
      fn.name === 'hue-rotate' &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|rad|grad|turn)$/i.test(fn.value)
    )
      continue
    return null
  }
  return result
}

function translationOnly(style: CSSStyleDeclaration): boolean {
  if (
    (style.rotate && style.rotate !== 'none') ||
    (style.scale && style.scale !== 'none') ||
    (style.perspective && style.perspective !== 'none')
  )
    return false
  const transform = style.transform?.trim() ?? ''
  if (!transform || transform === 'none') return true
  const match = /^matrix\(([^()]*)\)$/.exec(transform)
  if (!match?.[1]) return false
  const values = match[1].split(',').map((value) => Number(value.trim()))
  return (
    values.length === 6 &&
    values.every(Number.isFinite) &&
    values[0] === 1 &&
    values[1] === 0 &&
    values[2] === 0 &&
    values[3] === 1
  )
}

function styleOutsets(style: CSSStyleDeclaration): Insets | null {
  const filter = filterOutsets(style.filter)
  if (!filter) return null
  let textShadow = zero
  if (style.textShadow && style.textShadow !== 'none') {
    for (const shadowValue of splitCss(style.textShadow)) {
      const shadow = shadowOutsets(shadowValue)
      if (!shadow) return null
      textShadow = {
        top: Math.max(textShadow.top, shadow.top),
        right: Math.max(textShadow.right, shadow.right),
        bottom: Math.max(textShadow.bottom, shadow.bottom),
        left: Math.max(textShadow.left, shadow.left),
      }
    }
  }
  // The element filter is applied after text-shadow has expanded the glyphs.
  return addInsets(filter, textShadow)
}

/**
 * Prove a viewport-space paint bound for a subtree with known CSS effects.
 * Unknown filters, generated content, native media, box shadows and top-layer
 * content fail closed because their painted pixels can escape DOM rectangles.
 */
export function proveUnsupportedSubtreeBounds({
  element,
  root,
  readStyle,
  readRect,
  canInclude,
  shouldSkip = () => false,
  containsGlass,
}: ProofInput): SceneRect | null {
  if (!root.contains(element) || containsGlass(element)) return null
  let visited = 0
  let textContext: CanvasRenderingContext2D | null | undefined

  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const ancestorStyle = readStyle(ancestor)
    const prefixedBackdrop = ancestorStyle.getPropertyValue('-webkit-backdrop-filter').trim()
    if (!translationOnly(ancestorStyle)) return null
    if (
      ancestor !== element &&
      ((ancestorStyle.filter && ancestorStyle.filter !== 'none') ||
        (ancestorStyle.backdropFilter && ancestorStyle.backdropFilter !== 'none') ||
        (prefixedBackdrop && prefixedBackdrop !== 'none'))
    )
      return null
    if (ancestor === root) break
    if (!ancestor.parentElement) return null
  }

  const textOutsets = (node: Text, style: CSSStyleDeclaration): Insets | null => {
    textContext ??= document.createElement('canvas').getContext('2d')
    if (!textContext) return null
    textContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = textContext.measureText(node.data)
    const values = [
      metrics.actualBoundingBoxLeft,
      metrics.actualBoundingBoxRight,
      metrics.actualBoundingBoxAscent,
      metrics.actualBoundingBoxDescent,
    ]
    if (!values.every((value) => value !== undefined && Number.isFinite(value))) return null
    const [left = 0, right = 0, ascent = 0, descent = 0] = values
    return {
      top: Math.ceil(Math.max(0, ascent)) + 2,
      right: Math.ceil(Math.max(0, right)) + 2,
      bottom: Math.ceil(Math.max(0, descent)) + 2,
      left: Math.ceil(Math.max(0, left)) + 2,
    }
  }

  const visit = (current: Element): SceneRect | null => {
    if (shouldSkip(current) || omitted.has(current.tagName))
      return { x: 0, y: 0, width: 0, height: 0 }
    if (!(current instanceof HTMLElement) || visited++ >= 128) return null
    const style = readStyle(current)
    if (style.display === 'none' || current.hasAttribute('hidden'))
      return { x: 0, y: 0, width: 0, height: 0 }
    if (
      current.shadowRoot ||
      current.hasAttribute('popover') ||
      (current.tagName === 'DIALOG' && current.hasAttribute('open')) ||
      current instanceof HTMLCanvasElement ||
      current instanceof HTMLVideoElement ||
      current instanceof HTMLIFrameElement ||
      current instanceof HTMLObjectElement ||
      current instanceof HTMLEmbedElement ||
      (document.fullscreenElement && current.contains(document.fullscreenElement)) ||
      !translationOnly(style) ||
      (style.boxShadow && style.boxShadow !== 'none') ||
      (style.backgroundAttachment && style.backgroundAttachment !== 'scroll') ||
      !canInclude(current, style)
    )
      return null
    for (const pseudo of ['::before', '::after'] as const) {
      const generated = readStyle(current, pseudo).content
      if (generated && generated !== 'none' && generated !== 'normal') return null
    }
    const own = finiteRect(readRect(current))
    const outsets = styleOutsets(style)
    if (!own || !outsets) return null
    let bounds: SceneRect | undefined = own.width || own.height ? own : undefined
    for (const node of current.childNodes) {
      if (node instanceof Element) {
        const child = visit(node)
        if (!child) return null
        if (child.width || child.height) bounds = union(bounds, child)
      } else if (node instanceof Text && node.data.trim()) {
        try {
          const range = document.createRange()
          range.selectNodeContents(node)
          const text = finiteRect(range.getBoundingClientRect())
          const ink = textOutsets(node, style)
          if (!text || !ink) return null
          if (text.width || text.height) bounds = union(bounds, expand(text, ink))
        } catch {
          return null
        }
      }
    }
    return expand(bounds ?? own, outsets)
  }

  const bounds = visit(element)
  if (!bounds || (!bounds.width && !bounds.height)) return null
  // Protect native glyph overhang and antialiasing at the sampling boundary.
  return expand(bounds, { top: 2, right: 2, bottom: 2, left: 2 })
}

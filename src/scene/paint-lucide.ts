import { boxRadii, roundedPath } from './paint-box'

type Shape =
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }

type LucidePaint = { status: 'ready'; bitmap: HTMLCanvasElement } | { status: 'unsupported' }

const cache = new WeakMap<SVGSVGElement, { key: string; bitmap: HTMLCanvasElement }>()
const unsupported: LucidePaint = { status: 'unsupported' }
const zero = (value: string) => !value || value === '0' || value === '0px'
const none = (value: string) => !value || value === 'none' || value === 'normal'

function plainStyle(style: CSSStyleDeclaration): boolean {
  const property = (name: string) => style.getPropertyValue(name).trim()
  return (
    ['inline', 'block', 'inline-block'].includes(style.display) &&
    style.visibility === 'visible' &&
    Number(style.opacity) === 1 &&
    style.fill === 'none' &&
    Number(style.strokeOpacity) === 1 &&
    ['2', '2px'].includes(style.strokeWidth) &&
    style.strokeLinecap === 'round' &&
    style.strokeLinejoin === 'round' &&
    none(style.strokeDasharray) &&
    zero(style.strokeDashoffset) &&
    none(style.vectorEffect) &&
    none(style.paintOrder) &&
    (!style.shapeRendering || style.shapeRendering === 'auto') &&
    none(style.transform) &&
    none(style.rotate) &&
    none(style.scale) &&
    none(style.translate) &&
    none(style.perspective) &&
    none(property('offset-path')) &&
    (!style.zoom || style.zoom === 'normal' || style.zoom === '1') &&
    none(style.filter) &&
    none(style.backdropFilter) &&
    none(property('-webkit-backdrop-filter')) &&
    none(style.clipPath) &&
    (!style.clip || style.clip === 'auto') &&
    none(style.maskImage) &&
    none(property('-webkit-mask-image')) &&
    none(style.mixBlendMode) &&
    none(property('marker-start')) &&
    none(property('marker-mid')) &&
    none(property('marker-end')) &&
    (!style.outlineStyle || style.outlineStyle === 'none') &&
    none(style.boxShadow) &&
    none(style.textShadow)
  )
}

/** Resolve CSS SVG geometry so style overrides cannot silently draw old attributes. */
function coordinate(element: Element, style: CSSStyleDeclaration, name: string): number | null {
  const computed = style.getPropertyValue(name).trim()
  const raw = computed && computed !== 'auto' ? computed : element.getAttribute(name) || '0'
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(raw)) return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

function pathData(element: Element, style: CSSStyleDeclaration): string | null {
  const computed = style.getPropertyValue('d').trim()
  let d = element.getAttribute('d')?.trim() || ''
  if (computed) {
    const cssPath = /^path\(\s*["']([^"']+)["']\s*\)$/i.exec(computed)
    if (!cssPath?.[1]) return null
    d = cssPath[1]
  }
  return d && d.length <= 20_000 && /^[MmLlHhVvCcSsQqTtAaZz0-9+\-.,eE\s]+$/.test(d) ? d : null
}

function shape(element: Element, style: CSSStyleDeclaration): Shape | null {
  if (
    element.children.length ||
    element.namespaceURI !== 'http://www.w3.org/2000/svg' ||
    [
      'transform',
      'pathLength',
      'marker-start',
      'marker-mid',
      'marker-end',
      'clip-path',
      'mask',
      'filter',
    ].some((name) => element.hasAttribute(name))
  )
    return null
  if (element.tagName === 'path') {
    const d = pathData(element, style)
    return d ? { kind: 'path', d } : null
  }
  if (element.tagName === 'circle') {
    const cx = coordinate(element, style, 'cx')
    const cy = coordinate(element, style, 'cy')
    const r = coordinate(element, style, 'r')
    return cx !== null && cy !== null && r !== null && r > 0 ? { kind: 'circle', cx, cy, r } : null
  }
  if (element.tagName === 'line') {
    const x1 = coordinate(element, style, 'x1')
    const y1 = coordinate(element, style, 'y1')
    const x2 = coordinate(element, style, 'x2')
    const y2 = coordinate(element, style, 'y2')
    return x1 !== null && y1 !== null && x2 !== null && y2 !== null
      ? { kind: 'line', x1, y1, x2, y2 }
      : null
  }
  if (element.tagName === 'rect') {
    const x = coordinate(element, style, 'x')
    const y = coordinate(element, style, 'y')
    const width = coordinate(element, style, 'width')
    const height = coordinate(element, style, 'height')
    const rx = coordinate(element, style, 'rx')
    const ryRaw = style.getPropertyValue('ry').trim() || element.getAttribute('ry') || 'auto'
    const ry = ryRaw === 'auto' ? rx : coordinate(element, style, 'ry')
    if (
      x === null ||
      y === null ||
      width === null ||
      height === null ||
      rx === null ||
      ry === null ||
      width <= 0 ||
      height <= 0 ||
      rx < 0 ||
      ry < 0 ||
      Math.abs(rx - ry) > 0.000001
    )
      return null
    return { kind: 'rect', x, y, width, height, radius: Math.min(rx, width / 2, height / 2) }
  }
  return null
}

/** Synchronous fast path for plain, round-stroked Lucide SVG icons. */
export function paintLucide(
  element: SVGSVGElement,
  logicalWidth: number,
  logicalHeight: number,
  ratio: number
): LucidePaint {
  if (
    !element.classList.contains('lucide') ||
    element.hasAttribute('transform') ||
    Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
    ) ||
    ![logicalWidth, logicalHeight, ratio].every(Number.isFinite) ||
    logicalWidth <= 0 ||
    logicalHeight <= 0 ||
    ratio <= 0 ||
    Math.abs(logicalWidth - logicalHeight) > 0.001 ||
    Math.ceil(logicalWidth * ratio) > 4096 ||
    Math.ceil(logicalHeight * ratio) > 4096 ||
    Math.ceil(logicalWidth * ratio) * Math.ceil(logicalHeight * ratio) > 2_000_000
  )
    return unsupported
  const viewBox = element
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    viewBox.some((value, index) => value !== [0, 0, 24, 24][index])
  )
    return unsupported
  const aspect = element.getAttribute('preserveAspectRatio')?.trim()
  if (aspect && aspect !== 'xMidYMid' && aspect !== 'xMidYMid meet') return unsupported
  const rootStyle = getComputedStyle(element)
  if (
    !plainStyle(rootStyle) ||
    !['hidden', 'clip'].includes(rootStyle.overflowX) ||
    !['hidden', 'clip'].includes(rootStyle.overflowY) ||
    rootStyle.objectFit !== 'fill' ||
    [
      rootStyle.borderTopWidth,
      rootStyle.borderRightWidth,
      rootStyle.borderBottomWidth,
      rootStyle.borderLeftWidth,
    ].some((value) => !zero(value))
  )
    return unsupported
  const paddingValues = [
    rootStyle.paddingTop,
    rootStyle.paddingRight,
    rootStyle.paddingBottom,
    rootStyle.paddingLeft,
  ]
  if (paddingValues.some((value) => !/^(?:0|(?:\d+\.?\d*|\.\d+)px)$/.test(value)))
    return unsupported
  const padding = Number.parseFloat(paddingValues[0] || '0')
  if (paddingValues.some((value) => Number.parseFloat(value) !== padding)) return unsupported
  const contentWidth = logicalWidth - padding * 2
  const contentHeight = logicalHeight - padding * 2
  if (contentWidth <= 0 || contentHeight <= 0 || Math.abs(contentWidth - contentHeight) > 0.001)
    return unsupported
  const radiusValues = [
    rootStyle.borderTopLeftRadius,
    rootStyle.borderTopRightRadius,
    rootStyle.borderBottomRightRadius,
    rootStyle.borderBottomLeftRadius,
  ]
  if (
    radiusValues.some(
      (value) =>
        !/^(?:0|(?:\d+\.?\d*|\.\d+)(?:px|%))(?:\s+(?:0|(?:\d+\.?\d*|\.\d+)(?:px|%)))?$/.test(value)
    )
  )
    return unsupported
  const radii = boxRadii(rootStyle, logicalWidth, logicalHeight)
  const radius = radii[0]?.[0]
  if (
    radius === undefined ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    radius > Math.min(logicalWidth, logicalHeight) / 2 ||
    radii.some(([x, y]) => Math.abs(x - radius) > 0.001 || Math.abs(y - radius) > 0.001)
  )
    return unsupported
  const innerRadii = radii.map(
    ([x, y]) => [Math.max(0, x - padding), Math.max(0, y - padding)] as const
  )
  const color = rootStyle.stroke
  if (!/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(color)) return unsupported
  const children = Array.from(element.children)
  if (!children.length || children.length > 100) return unsupported
  const shapes: Shape[] = []
  for (const child of children) {
    const style = getComputedStyle(child)
    if (!plainStyle(style) || style.stroke !== color) return unsupported
    const value = shape(child, style)
    if (!value) return unsupported
    shapes.push(value)
  }
  const key = JSON.stringify([
    logicalWidth,
    logicalHeight,
    ratio,
    padding,
    innerRadii,
    color,
    shapes,
  ])
  const previous = cache.get(element)
  if (previous?.key === key) return { status: 'ready', bitmap: previous.bitmap }
  if (typeof Path2D !== 'function') return unsupported
  const bitmap = document.createElement('canvas')
  bitmap.width = Math.max(1, Math.ceil(logicalWidth * ratio))
  bitmap.height = Math.max(1, Math.ceil(logicalHeight * ratio))
  const context = bitmap.getContext('2d')
  if (!context) return unsupported
  try {
    context.scale(ratio, ratio)
    context.translate(padding, padding)
    roundedPath(context, contentWidth, contentHeight, innerRadii)
    context.clip()
    context.scale(contentWidth / 24, contentHeight / 24)
    context.strokeStyle = color
    context.lineWidth = 2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const part of shapes) {
      let path: Path2D
      if (part.kind === 'path') path = new Path2D(part.d)
      else {
        path = new Path2D()
        if (part.kind === 'circle') path.arc(part.cx, part.cy, part.r, 0, 2 * Math.PI)
        else if (part.kind === 'line') {
          path.moveTo(part.x1, part.y1)
          path.lineTo(part.x2, part.y2)
        } else if (!part.radius) path.rect(part.x, part.y, part.width, part.height)
        else {
          if (typeof path.roundRect !== 'function') return unsupported
          path.roundRect(part.x, part.y, part.width, part.height, part.radius)
        }
      }
      context.stroke(path)
    }
  } catch {
    return unsupported
  }
  cache.set(element, { key, bitmap })
  return { status: 'ready', bitmap }
}

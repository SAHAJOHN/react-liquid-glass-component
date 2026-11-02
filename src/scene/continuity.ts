import type { SceneRect } from './types'
import type { GlassStudioProps } from '../studio-props'

/** Preserve the last complete frame briefly while same-scene assets decode. */
export const PENDING_FRAME_MS = 350

const pendingReasons = new Set([
  'Image is loading',
  'Background image is loading',
  'SVG is loading',
  'LiquidGlass displacement map is loading',
])

export function isPendingAssets(issues: readonly string[]): boolean {
  return issues.length > 0 && issues.every((issue) => pendingReasons.has(issue))
}

export interface Overscroll {
  left: number
  right: number
  top: number
  bottom: number
}

/** The host is in document coordinates; the enclosing pane is in viewport coordinates. */
export interface ElasticGeometry {
  host: SceneRect
  pane: SceneRect
  documentWidth: number
  documentHeight: number
  viewportWidth: number
  viewportHeight: number
  pixelRatio: number
}

export interface SamplingPane {
  rect: SceneRect
  studio: GlassStudioProps
}

/** Upper bound for all pixels read by overlapping/nested Studio surfaces. */
export function glassSamplingRegion(
  panes: readonly SamplingPane[],
  viewport: { width: number; height: number; pixelRatio: number }
): SceneRect | undefined {
  const { width, height, pixelRatio } = viewport
  if (
    !panes.length ||
    ![width, height, pixelRatio].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    pixelRatio <= 0
  )
    return undefined
  const ratio = Math.min(
    Math.max(1, Math.round(width * pixelRatio)) / width,
    Math.max(1, Math.round(height * pixelRatio)) / height
  )
  const aa = height * 0.001 + 1 / ratio
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  let totalApron = 0
  for (const { rect, studio } of panes) {
    const { refDistance, refFactor, refDispersion, blurRadius } = studio
    if (
      ![
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        refDistance,
        refFactor,
        refDispersion,
        blurRadius,
      ].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      refDistance < 0 ||
      refFactor < 1 ||
      refDispersion < 0
    )
      return undefined
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
    const shift =
      1.414213562 *
      1000 *
      refDistance *
      Math.sqrt(Math.max(0, refFactor * refFactor - 1)) *
      (1 + 0.02 * refDispersion)
    const radius = Math.max(0, Math.min(200, Math.round(blurRadius)))
    // Round outward to cover backing-buffer quantization and overlapping lenses.
    totalApron += shift + radius / ratio + aa + 4
  }
  if (!Number.isFinite(totalApron)) return undefined
  return {
    x: left - totalApron,
    y: top - totalApron,
    width: right - left + 2 * totalApron,
    height: bottom - top + 2 * totalApron,
  }
}

const nonPaintingTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'])
const absentEffect = (value: string | undefined) => !value || value === 'none' || value === 'normal'

/** Fail closed unless every visible body sibling is proven outside the sampling region. */
export function externalSiblingsAvoidRegion(host: HTMLElement, region: SceneRect): boolean {
  const body = document.body
  if (!body || host.parentElement !== body) return false
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.width <= 0 ||
    region.height <= 0
  )
    return false

  const intersects = (rect: DOMRect) =>
    rect.left < region.x + region.width &&
    rect.right > region.x &&
    rect.top < region.y + region.height &&
    rect.bottom > region.y
  const generated = (element: Element, pseudo: '::before' | '::after') => {
    const style = getComputedStyle(element, pseudo)
    if (!style || !style.content) return true
    return Boolean(
      style.content !== 'none' &&
      style.content !== 'normal' &&
      style.display !== 'none' &&
      Number.parseFloat(style.opacity || '1') > 0
    )
  }
  const uncertainEffects = (style: CSSStyleDeclaration) => {
    const effects = [
      style.filter,
      style.backdropFilter,
      style.getPropertyValue('-webkit-backdrop-filter'),
      style.boxShadow,
      style.textShadow,
      style.perspective,
      style.transform,
      style.rotate,
      style.scale,
      style.translate,
      style.clipPath,
      style.maskImage,
      style.getPropertyValue('-webkit-mask-image'),
      style.mixBlendMode,
    ]
    if (effects.some((value) => !absentEffect(value))) return true
    const stroke = style.getPropertyValue('-webkit-text-stroke-width')
    if (stroke && stroke !== '0px' && stroke !== '0') return true
    const outset = style.borderImageOutset
    if (outset && outset.split(/\s+/).some((value) => !/^(?:0|0(?:\.0+)?px)$/.test(value)))
      return true
    if (style.outlineStyle && style.outlineStyle !== 'none') {
      const outlineWidth = Number.parseFloat(style.outlineWidth)
      if (!Number.isFinite(outlineWidth) || outlineWidth > 0) return true
    }
    return style.display === 'list-item' && !!style.listStyleType && style.listStyleType !== 'none'
  }
  const definitelyClipped = (style: CSSStyleDeclaration) =>
    style.clipPath === 'inset(50%)' ||
    (['absolute', 'fixed'].includes(style.position) &&
      /^rect\(\s*0px\s*,?\s*0px\s*,?\s*0px\s*,?\s*0px\s*\)$/.test(style.clip || ''))
  const inspect = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) return !node.textContent?.trim()
    if (node.nodeType === Node.COMMENT_NODE) return true
    if (!(node instanceof Element)) return false
    if (nonPaintingTags.has(node.tagName)) return true
    const style = getComputedStyle(node)
    const opacity = Number.parseFloat(style.opacity || '1')
    if (!Number.isFinite(opacity)) return false
    if (style.display === 'none' || node.hasAttribute('hidden') || opacity <= 0) return true
    if (definitelyClipped(style)) return true
    if (uncertainEffects(style) || generated(node, '::before') || generated(node, '::after'))
      return false
    if (node instanceof SVGElement) return false
    const rect = node.getBoundingClientRect()
    if (
      ![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(
        Number.isFinite
      )
    )
      return false
    if (
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      rect.width > 0 &&
      rect.height > 0 &&
      intersects(rect)
    )
      return false
    if (node.tagName.includes('-') && !node.shadowRoot) return false
    if (node.shadowRoot && !Array.from(node.shadowRoot.childNodes).every(inspect)) return false
    return Array.from(node.childNodes).every(inspect)
  }

  try {
    for (const ancestor of [document.documentElement, body]) {
      const style = getComputedStyle(ancestor)
      if (
        uncertainEffects(style) ||
        generated(ancestor, '::before') ||
        generated(ancestor, '::after') ||
        (style.opacity && Number.parseFloat(style.opacity) !== 1)
      )
        return false
    }
    return Array.from(body.childNodes).every((node) => node === host || inspect(node))
  } catch {
    return false
  }
}

const GEOMETRY_TOLERANCE = 0.5

interface BackgroundPaint {
  color: string
  image: string
}

function colorAlpha(value: string): number | undefined {
  if (!value || value === 'transparent') return 0
  const match = /^rgba?\((.*)\)$/i.exec(value.trim())
  if (!match?.[1]) return undefined
  const body = match[1]
  let alpha: string | undefined
  if (body.includes(',')) {
    const parts = body.split(',')
    if (parts.length === 3) return 1
    if (parts.length !== 4) return undefined
    alpha = parts[3]?.trim()
  } else {
    const parts = body.split('/')
    if (parts.length === 1) return 1
    if (parts.length !== 2) return undefined
    alpha = parts[1]?.trim()
  }
  if (!alpha) return undefined
  const number = Number.parseFloat(alpha)
  return Number.isFinite(number) ? (alpha.endsWith('%') ? number / 100 : number) : undefined
}

/** Restrict the extra elastic region to a known, flat document canvas background. */
export function hasFlatElasticBackground(
  host: BackgroundPaint,
  body: BackgroundPaint,
  html: BackgroundPaint
): boolean {
  if ([host, body, html].some(({ image }) => image && image !== 'none')) return false
  if (colorAlpha(host.color) !== 0) return false
  const bodyAlpha = colorAlpha(body.color)
  const htmlAlpha = colorAlpha(html.color)
  if (bodyAlpha === 1 && htmlAlpha === 0) return true
  if (bodyAlpha === 0 && htmlAlpha === 1) return true
  return bodyAlpha === 1 && htmlAlpha === 1 && body.color === html.color
}

/** An elastic gap is eligible only when an unchanged, complete scene owns the document. */
export function canExpandElasticScene(
  previous: ElasticGeometry | undefined,
  current: ElasticGeometry | undefined,
  overscroll: Overscroll
): boolean {
  if (!previous || !current) return false
  const finite = (geometry: ElasticGeometry) =>
    [
      geometry.host.x,
      geometry.host.y,
      geometry.host.width,
      geometry.host.height,
      geometry.pane.x,
      geometry.pane.y,
      geometry.pane.width,
      geometry.pane.height,
      geometry.documentWidth,
      geometry.documentHeight,
      geometry.viewportWidth,
      geometry.viewportHeight,
      geometry.pixelRatio,
    ].every(Number.isFinite)
  if (!finite(previous) || !finite(current)) return false
  const near = (a: number, b: number) => Math.abs(a - b) <= GEOMETRY_TOLERANCE
  const coversDocument = ({ host, documentWidth, documentHeight }: ElasticGeometry) =>
    host.width > 0 &&
    host.height > 0 &&
    documentWidth > 0 &&
    documentHeight > 0 &&
    host.x <= GEOMETRY_TOLERANCE &&
    host.y <= GEOMETRY_TOLERANCE &&
    host.x + host.width >= documentWidth - GEOMETRY_TOLERANCE &&
    host.y + host.height >= documentHeight - GEOMETRY_TOLERANCE
  if (!coversDocument(previous) || !coversDocument(current)) return false
  if (
    !near(previous.host.x, current.host.x) ||
    !near(previous.host.y, current.host.y) ||
    !near(previous.host.width, current.host.width) ||
    !near(previous.host.height, current.host.height) ||
    !near(previous.documentWidth, current.documentWidth) ||
    !near(previous.documentHeight, current.documentHeight) ||
    // Safari can report a small viewport adjustment while rubber-banding.
    // All document, host and pane dimensions are still checked independently.
    Math.abs(previous.viewportWidth - current.viewportWidth) > 2 ||
    Math.abs(previous.viewportHeight - current.viewportHeight) > 2 ||
    !near(previous.pixelRatio, current.pixelRatio) ||
    !near(previous.pane.width, current.pane.width) ||
    !near(previous.pane.height, current.pane.height)
  )
    return false
  const horizontalExcursion = Math.max(overscroll.left, overscroll.right)
  const verticalExcursion = Math.max(overscroll.top, overscroll.bottom)
  return (
    Math.abs(previous.pane.x - current.pane.x) <= horizontalExcursion + GEOMETRY_TOLERANCE &&
    Math.abs(previous.pane.y - current.pane.y) <= verticalExcursion + GEOMETRY_TOLERANCE
  )
}

export function getOverscroll(
  x: number,
  y: number,
  maximumX: number,
  maximumY: number
): Overscroll {
  return {
    left: Math.max(0, -x),
    right: Math.max(0, x - Math.max(0, maximumX)),
    top: Math.max(0, -y),
    bottom: Math.max(0, y - Math.max(0, maximumY)),
  }
}

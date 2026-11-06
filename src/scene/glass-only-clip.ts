import type { SceneRect } from './types'

/** Geometry is expressed in viewport CSS pixels. */
export interface GlassOnlyPane {
  rect: SceneRect
  radius: number
  roundness: number
  shadowFactor: number
}

export type GlassOnlyClip =
  | { status: 'ready'; clipPath: string }
  | { status: 'fallback'; reason: string }

const EPSILON = 0.001

function finiteRect(rect: SceneRect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

function containsRect(outer: SceneRect, inner: SceneRect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  )
}

function containsPoint(rect: SceneRect, radius: number, x: number, y: number): boolean {
  const cx = Math.max(rect.x + radius, Math.min(rect.x + rect.width - radius, x))
  const cy = Math.max(rect.y + radius, Math.min(rect.y + rect.height - radius, y))
  return Math.hypot(x - cx, y - cy) <= radius + EPSILON
}

/** Conservative containment: do not reveal background between separate surfaces. */
function containsPane(outer: GlassOnlyPane, inner: GlassOnlyPane): boolean {
  if (!containsRect(outer.rect, inner.rect)) return false
  const { x, y, width, height } = inner.rect
  const corners: ReadonlyArray<readonly [number, number]> = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ]
  if (corners.every(([px, py]) => containsPoint(outer.rect, outer.radius, px, py))) return true

  // A rounded child inset on all sides is contained by the correspondingly
  // eroded outer rounded rectangle when its radius is at least as large.
  const inset = Math.min(
    x - outer.rect.x,
    y - outer.rect.y,
    outer.rect.x + outer.rect.width - x - width,
    outer.rect.y + outer.rect.height - y - height
  )
  return inner.radius + EPSILON >= Math.max(0, outer.radius - Math.max(0, inset))
}

/** True when one pane contains all other surfaces, including rounded corners. */
export function enclosingGlassPane(panes: readonly GlassOnlyPane[]): GlassOnlyPane | undefined {
  return panes.find((candidate) =>
    panes.every((pane) => pane === candidate || containsPane(candidate, pane))
  )
}

/** CSS path subpaths share a clockwise winding, producing the union of panes. */
function roundedPath(pane: GlassOnlyPane): string {
  const { x, y, width, height } = pane.rect
  const r = Math.min(pane.radius, width / 2, height / 2)
  const right = x + width
  const bottom = y + height
  if (r === 0) return `M ${x} ${y} H ${right} V ${bottom} H ${x} Z`
  return `M ${x + r} ${y} H ${right - r} A ${r} ${r} 0 0 1 ${right} ${y + r} V ${bottom - r} A ${r} ${r} 0 0 1 ${right - r} ${bottom} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${bottom - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
}

/** Build the viewport-relative clip after every pane has been validated. */
export function glassOnlyClipPath(
  panes: readonly GlassOnlyPane[],
  viewport: { width: number; height: number }
): string {
  const outer = enclosingGlassPane(panes)
  if (!outer) return `path("${panes.map(roundedPath).join(' ')}")`
  const { x, y, width, height } = outer.rect
  return `inset(${y}px ${viewport.width - x - width}px ${viewport.height - y - height}px ${x}px round ${outer.radius}px)`
}

/**
 * Clip the presentation canvas to one enclosing circular-corner pane. The
 * compiler and renderer still decide whether the backdrop can be rendered.
 */
export function getGlassOnlyClip(
  panes: readonly GlassOnlyPane[],
  viewport: { width: number; height: number },
  host: SceneRect
): GlassOnlyClip {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !finiteRect(host)
  ) {
    return { status: 'fallback', reason: 'Glass-only presentation needs valid scene bounds.' }
  }
  if (!panes.length) {
    return { status: 'fallback', reason: 'Glass-only presentation needs a visible glass pane.' }
  }
  for (const pane of panes) {
    if (
      !finiteRect(pane.rect) ||
      !Number.isFinite(pane.radius) ||
      pane.radius < 0 ||
      pane.radius > Math.min(pane.rect.width, pane.rect.height) / 2 + EPSILON
    ) {
      return { status: 'fallback', reason: 'Glass-only presentation needs valid pane geometry.' }
    }
    if (pane.roundness !== 2) {
      return { status: 'fallback', reason: 'Glass-only presentation requires shapeRoundness={2}.' }
    }
    if (pane.shadowFactor !== 0) {
      return { status: 'fallback', reason: 'Glass-only presentation requires shadowFactor={0}.' }
    }
  }
  const viewportRect = { x: 0, y: 0, width: viewport.width, height: viewport.height }
  if (panes.some(({ rect }) => !containsRect(host, rect) || !containsRect(viewportRect, rect))) {
    return {
      status: 'fallback',
      reason: 'Glass-only presentation requires the enclosing pane inside the scene and viewport.',
    }
  }
  return { status: 'ready', clipPath: glassOnlyClipPath(panes, viewport) }
}

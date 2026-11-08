import type { SceneFrame, SceneRect } from './types'
import type { GlassStudioProps } from '../studio-props'

type StudioShape = Pick<GlassStudioProps, 'shapeRadius' | 'shapeRoundness'>
type Point = readonly [number, number]
const appliedShapes = new WeakMap<HTMLCanvasElement, string>()

export interface LayerAtlasSlot {
  /** Source and destination rectangles in integer backing-buffer pixels, from the top left. */
  sourceX: number
  sourceY: number
  width: number
  height: number
  atlasX: number
  atlasY: number
}

/** Pack visible pane crops into one viewport-sized texture. Return null when it cannot fit. */
export function planLayerAtlas(
  rects: readonly SceneRect[],
  frame: SceneFrame,
  bufferWidth: number,
  bufferHeight: number
): Array<LayerAtlasSlot | null> | null {
  if (
    ![frame.width, frame.height, bufferWidth, bufferHeight].every(Number.isFinite) ||
    frame.width <= 0 || frame.height <= 0 || bufferWidth <= 0 || bufferHeight <= 0
  ) return null
  const scaleX = bufferWidth / frame.width
  const scaleY = bufferHeight / frame.height
  const slots: Array<LayerAtlasSlot | null> = []
  let rowX = 0
  let rowY = 0
  let rowHeight = 0
  let visible = 0
  for (const rect of rects) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null
    if (rect.x >= frame.width || rect.y >= frame.height || rect.x + rect.width <= 0 || rect.y + rect.height <= 0) {
      slots.push(null)
      continue
    }
    // Clipped panes and fractional backing sizes can produce different edge
    // alpha in WebKit. Fractional positions are safe to pack with the
    // one-pixel apron below; the final crop retains their subpixel offset.
    if (
      rect.x < 0 || rect.y < 0 ||
      rect.x + rect.width > frame.width || rect.y + rect.height > frame.height ||
      ![rect.width * scaleX, rect.height * scaleY].every(Number.isInteger)
    ) {
      slots.push(null)
      continue
    }
    // Preserve neighboring pixels for 2D image interpolation. Without a
    // one-pixel apron a fractional crop can sample a different atlas slot.
    const left = Math.max(0, Math.floor(rect.x * scaleX) - 1)
    const top = Math.max(0, Math.floor(rect.y * scaleY) - 1)
    const right = Math.min(bufferWidth, Math.ceil((rect.x + rect.width) * scaleX) + 1)
    const bottom = Math.min(bufferHeight, Math.ceil((rect.y + rect.height) * scaleY) + 1)
    if (right <= left || bottom <= top) {
      slots.push(null)
      continue
    }
    const width = right - left
    const height = bottom - top
    if (rowX + width > bufferWidth) {
      rowY += rowHeight
      rowX = 0
      rowHeight = 0
    }
    if (rowY + height > bufferHeight) return null
    slots.push({ sourceX: left, sourceY: top, width, height, atlasX: rowX, atlasY: rowY })
    rowX += width
    rowHeight = Math.max(rowHeight, height)
    visible += 1
  }
  return visible > 1 ? slots : null
}

/** Polygon approximation of the Studio rounded-superellipse SDF boundary. */
export function layeredShapePolygon(width: number, height: number, shape: StudioShape): string | null {
  if (
    ![width, height, shape.shapeRadius, shape.shapeRoundness].every(Number.isFinite) ||
    width <= 0 || height <= 0
  ) return null
  const radius = Math.max(0, Math.min(Math.min(width, height) / 2,
    (Math.min(width, height) * 0.5 * shape.shapeRadius) / 100))
  const n = Math.max(2, shape.shapeRoundness)
  if (radius === 0) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'

  const points: Point[] = []
  const corners: readonly (readonly [number, number, number])[] = [
    [radius, radius, Math.PI],
    [width - radius, radius, Math.PI * 1.5],
    [width - radius, height - radius, 0],
    [radius, height - radius, Math.PI * 0.5],
  ]
  const point = (cx: number, cy: number, angle: number): Point => {
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    return [
      cx + Math.sign(x) * radius * Math.pow(Math.abs(x), 2 / n),
      cy + Math.sign(y) * radius * Math.pow(Math.abs(y), 2 / n),
    ]
  }
  // Use the distance from the curve midpoint to its chord, rather than the
  // distance to the chord midpoint: superellipse parameterization is uneven.
  const appendArc = (cx: number, cy: number, start: number) => {
    const first = point(cx, cy, start)
    const lastAngle = start + Math.PI / 2
    const last = point(cx, cy, lastAngle)
    points.push(first)
    const append = (a: number, p: Point, b: number, q: Point, depth: number) => {
      const middle = (a + b) / 2
      const m = point(cx, cy, middle)
      const dx = q[0] - p[0]
      const dy = q[1] - p[1]
      const length = Math.hypot(dx, dy)
      const distance = length > 0 ? Math.abs(dx * (p[1] - m[1]) - (p[0] - m[0]) * dy) / length : 0
      if (distance > 0.2 && depth < 12) {
        append(a, p, middle, m, depth + 1)
        append(middle, m, b, q, depth + 1)
      } else points.push(q)
    }
    append(start, first, lastAngle, last, 0)
  }
  for (const [cx, cy, start] of corners) appendArc(cx, cy, start)
  const percent = (value: number, size: number) =>
    `${Number((Math.max(0, Math.min(1, value / size)) * 100).toFixed(5))}%`
  return `polygon(${points.map(([x, y]) => `${percent(x, width)} ${percent(y, height)}`).join(', ')})`
}

function applyLayeredShape(target: HTMLCanvasElement, rect: SceneRect, shape: StudioShape): boolean {
  const key = `${rect.width}|${rect.height}|${shape.shapeRadius}|${shape.shapeRoundness}`
  if (appliedShapes.get(target) === key) return true
  const polygon = layeredShapePolygon(rect.width, rect.height, shape)
  if (!polygon) return false
  target.style.clipPath = polygon
  // Older WebKit exposes the prefixed form even when the standard property
  // exists. Setting both is harmless and keeps the mask on that path too.
  target.style.setProperty('-webkit-clip-path', polygon)
  if (!target.style.clipPath && !target.style.getPropertyValue('-webkit-clip-path')) return false
  appliedShapes.set(target, key)
  return true
}

/**
 * Copy the currently presented WebGL frame into a pane-owned 2D canvas.
 * The caller must present the scene before calling this function and must do
 * so synchronously within the current WebGL render (preserveDrawingBuffer is
 * deliberately disabled). The target canvas is exclusively owned by a pane.
 */
export function copyLayerSnapshot(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  rect: SceneRect,
  frame: SceneFrame,
  shape: StudioShape,
  sourceOffset?: { x: number; y: number }
): boolean {
  if (
    ![rect.x, rect.y, rect.width, rect.height, frame.width, frame.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    source.width <= 0 ||
    source.height <= 0
  )
    return false

  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(frame.width, rect.x + rect.width)
  const bottom = Math.min(frame.height, rect.y + rect.height)
  // No canvas allocation is needed while the pane is outside the viewport.
  if (right <= left || bottom <= top) return true
  if (!applyLayeredShape(target, rect, shape)) return false

  const scaleX = source.width / frame.width
  const scaleY = source.height / frame.height
  const width = Math.max(1, Math.ceil(rect.width * scaleX))
  const height = Math.max(1, Math.ceil(rect.height * scaleY))
  // A pane can be far larger than the viewport. Avoid an unbounded secondary
  // backing store; the scene can safely fall back if it cannot be represented.
  if (width > 4096 || height > 4096 || width * height > 4_000_000) return false
  if (target.width !== width) target.width = width
  if (target.height !== height) target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) return false
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(
    source,
    left * scaleX + (sourceOffset?.x ?? 0),
    top * scaleY + (sourceOffset?.y ?? 0),
    (right - left) * scaleX,
    (bottom - top) * scaleY,
    (left - rect.x) * scaleX,
    (top - rect.y) * scaleY,
    (right - left) * scaleX,
    (bottom - top) * scaleY
  )
  return true
}

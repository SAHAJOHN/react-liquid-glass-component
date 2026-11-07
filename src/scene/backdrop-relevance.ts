import { parseBackdropFilter } from './backdrop-filter'
import { isSupportedIndividualTranslate } from './translate'
import { isEmptyLegacyClip } from './clip-geometry'
import type { SceneFrame, SceneRect } from './types'

type StyleReader = (element: Element, pseudo?: string | null) => CSSStyleDeclaration
type RectReader = (element: Element) => DOMRect

export interface BackdropRelevanceInput {
  root: Element
  /** Independent viewport-space optical regions, already including glass aprons. */
  regions: readonly SceneRect[] | undefined
  frame: SceneFrame
  /** Styles must expose current values; layout measurements must be fresh for each compile. */
  readStyle: StyleReader
  readRect: RectReader
  /** Subtrees painted natively above the output canvas contribute no backdrop. */
  shouldSkip?: (element: Element) => boolean
}

export interface BackdropRelevanceResult {
  /** Undefined disables off-region deferral because the source footprint is uncertain. */
  regions: readonly SceneRect[] | undefined
  /** Remeasure on scroll even if every layer was outside the last region. */
  hasBackdrop: boolean
}

interface Layer {
  rect: SceneRect
  /** Null means the source footprint cannot be bounded safely. */
  halo: { x: number; y: number } | null
}

const omitted = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'])
const MAX_LAYERS = 256
const MAX_REGIONS = 64
const MAX_OUTPUT_REGIONS = 256
const MAX_REACHABILITY_CHECKS = 32768

function validRect(rect: SceneRect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(
      Number.isFinite
    ) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

function absent(value: string | undefined): boolean {
  return !value || value === 'none'
}

/** A translation cannot change the blur sigma in viewport pixels. */
function isTranslationOnly(style: CSSStyleDeclaration): boolean {
  if (
    !isSupportedIndividualTranslate(style.translate) ||
    !absent(style.rotate) ||
    !absent(style.scale) ||
    !absent(style.perspective) ||
    (style.zoom && style.zoom !== 'normal' && style.zoom !== '1')
  )
    return false
  if (absent(style.transform)) return true
  const match = /^matrix\(([^()]*)\)$/.exec(style.transform)
  if (!match?.[1]) return false
  const parts = match[1].split(',').map((part) => part.trim())
  if (parts.length !== 6 || parts.some((part) => !part)) return false
  const values = parts.map(Number)
  return (
    values.every(Number.isFinite) &&
    values[0] === 1 &&
    values[1] === 0 &&
    values[2] === 0 &&
    values[3] === 1
  )
}

function backdrop(style: CSSStyleDeclaration): string | null {
  const standard = style.backdropFilter?.trim() ?? ''
  const prefixed = style.getPropertyValue('-webkit-backdrop-filter').trim()
  const a = absent(standard) ? '' : standard
  const b = absent(prefixed) ? '' : prefixed
  if (a && b && a !== b) return null
  return a || b
}

function expand(rect: SceneRect, x: number, y: number): SceneRect {
  return {
    x: rect.x - x,
    y: rect.y - y,
    width: rect.width + x * 2,
    height: rect.height + y * 2,
  }
}

function intersects(a: SceneRect, b: SceneRect): boolean {
  // Match samplingRelation's extra raster-boundary pixel.
  return (
    a.x + a.width >= b.x - 1 &&
    b.x + b.width >= a.x - 1 &&
    a.y + a.height >= b.y - 1 &&
    b.y + b.height >= a.y - 1
  )
}

function intersection(a: SceneRect, b: SceneRect): SceneRect | undefined {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined
}

function contains(a: SceneRect, b: SceneRect): boolean {
  return (
    a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height
  )
}

/** Preserve an exact rectangular union: a bounding box of an L shape may add a large gap. */
function addRegion(regions: SceneRect[], rect: SceneRect): boolean {
  let next = rect
  for (let index = 0; index < regions.length; ) {
    const existing = regions[index]
    if (!existing) return false
    if (contains(existing, next)) return true
    if (contains(next, existing)) {
      regions.splice(index, 1)
      index = 0
      continue
    }
    if (intersection(existing, next)) {
      const sameY = existing.y === next.y && existing.height === next.height
      const sameX = existing.x === next.x && existing.width === next.width
      if (sameX || sameY) {
        const x = Math.min(existing.x, next.x)
        const y = Math.min(existing.y, next.y)
        const right = Math.max(existing.x + existing.width, next.x + next.width)
        const bottom = Math.max(existing.y + existing.height, next.y + next.height)
        next = { x, y, width: right - x, height: bottom - y }
        regions.splice(index, 1)
        index = 0
        continue
      }
    }
    index += 1
  }
  if (regions.length >= MAX_OUTPUT_REGIONS) return false
  regions.push(next)
  return true
}

/**
 * Conservatively extend each glass sampling region through backdrop effects
 * before the compiler decides which unsupported or unavailable nodes to defer.
 *
 * Backdrop output is clipped to its border box. Layers can pass a dependency
 * between each other only where their border boxes meet. For each component
 * touching a pane, sum its Gaussian halos to bound every possible layer order,
 * then retain only the part of each layer inside that bound. This keeps thin
 * blur stripes from turning a distant unrelated part of the page relevant.
 *
 * Undefined regions mean no proof: callers must disable off-region deferral and
 * compile conservatively. A layer with unknown effects or transforms causes
 * that outcome only if it could influence a required region.
 */
export function expandBackdropRelevance({
  root,
  regions,
  frame,
  readStyle,
  readRect,
  shouldSkip,
}: BackdropRelevanceInput): BackdropRelevanceResult {
  const unproven: BackdropRelevanceResult = { regions: undefined, hasBackdrop: true }
  if (
    !regions?.length ||
    regions.length > MAX_REGIONS ||
    regions.some((region) => !validRect(region)) ||
    ![frame.width, frame.height, frame.pixelRatio].every(Number.isFinite) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.pixelRatio <= 0
  )
    return unproven
  const scaleX = Math.max(1, Math.round(frame.width * frame.pixelRatio)) / frame.width
  const scaleY = Math.max(1, Math.round(frame.height * frame.pixelRatio)) / frame.height
  if (![scaleX, scaleY].every(Number.isFinite) || scaleX <= 0 || scaleY <= 0) return unproven

  const layers: Layer[] = []
  let hasBackdrop = false
  try {
    const visit = (element: Element, transformed: boolean): boolean => {
      if (
        shouldSkip?.(element) ||
        omitted.has(element.tagName) ||
        element.hasAttribute('data-liquid-glass-scene-canvas') ||
        element.classList.contains('liquid-glass-scene__canvas')
      )
        return true
      const style = readStyle(element)
      if (style.display === 'none' || element.hasAttribute('hidden') || isEmptyLegacyClip(style))
        return true
      const opacity = style.opacity ? Number.parseFloat(style.opacity) : 1
      if (!Number.isFinite(opacity)) return false
      if (opacity <= 0) return true
      const uncertainGeometry = transformed || !isTranslationOnly(style)
      const value = backdrop(style)
      if (value === null || value) {
        hasBackdrop = true
        if (style.visibility !== 'hidden' && style.visibility !== 'collapse') {
          const raw = readRect(element)
          const rect = { x: raw.left, y: raw.top, width: raw.width, height: raw.height }
          if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false
          if (rect.width < 0 || rect.height < 0) return false
          if (rect.width > 0 && rect.height > 0) {
            if (!validRect(rect) || layers.length >= MAX_LAYERS) return false
            const parsed = value === null ? null : parseBackdropFilter(value)
            const halo =
              parsed && !uncertainGeometry
                ? {
                    x: (Math.ceil(3 * parsed.sigma * scaleX) + 2) / scaleX,
                    y: (Math.ceil(3 * parsed.sigma * scaleY) + 2) / scaleY,
                  }
                : null
            if (halo && ![halo.x, halo.y].every(Number.isFinite)) return false
            layers.push({ rect, halo })
          }
        }
      }
      // The compiler paints the root SVG as one image rather than walking its
      // descendants. Inspecting its backdrop as one layer matches that boundary.
      if (element instanceof SVGSVGElement) return true
      for (const child of element.children) if (!visit(child, uncertainGeometry)) return false
      return true
    }
    if (!visit(root, false)) return unproven
  } catch {
    // Unmeasurable DOM must not cause a false proof that assets are irrelevant.
    return unproven
  }

  // Build connected components conservatively: a one-pixel gap counts as a
  // connection because rasterized edges can touch at the sampling boundary.
  const parents = layers.map((_, index) => index)
  const find = (start: number): number => {
    let index = start
    while (parents[index] !== index) {
      const parent = parents[index]
      if (parent === undefined) return -1
      index = parent
    }
    return index
  }
  let checks = 0
  for (let i = 0; i < layers.length; i += 1) {
    for (let j = i + 1; j < layers.length; j += 1) {
      checks += 1
      if (checks > MAX_REACHABILITY_CHECKS) return unproven
      const a = layers[i]
      const b = layers[j]
      if (!a || !b) return unproven
      if (!intersects(a.rect, b.rect)) continue
      const first = find(i)
      const second = find(j)
      if (first < 0 || second < 0) return unproven
      if (first !== second) parents[first] = second
    }
  }
  const components = new Map<number, Layer[]>()
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index]
    const rootIndex = find(index)
    if (!layer || rootIndex < 0) return unproven
    const component = components.get(rootIndex) ?? []
    component.push(layer)
    components.set(rootIndex, component)
  }

  const result: SceneRect[] = []
  for (const initial of regions) {
    if (!addRegion(result, initial)) return unproven
    for (const component of components.values()) {
      let reachable = false
      for (const layer of component) {
        checks += 1
        if (checks > MAX_REACHABILITY_CHECKS) return unproven
        if (intersects(initial, layer.rect)) {
          reachable = true
          break
        }
      }
      if (!reachable) continue
      let x = 0
      let y = 0
      for (const layer of component) {
        if (!layer.halo) return { regions: undefined, hasBackdrop }
        x += layer.halo.x
        y += layer.halo.y
        if (!Number.isFinite(x) || !Number.isFinite(y)) return unproven
      }
      const required = expand(initial, x, y)
      if (!validRect(required)) return unproven
      for (const layer of component) {
        checks += 1
        if (checks > MAX_REACHABILITY_CHECKS) return unproven
        // Include one CSS pixel around the output box for conservative
        // raster boundary coverage, matching `intersects` and relation checks.
        const affected = intersection(required, expand(layer.rect, 1, 1))
        if (affected && !addRegion(result, affected)) return unproven
      }
    }
  }
  return { regions: result, hasBackdrop }
}

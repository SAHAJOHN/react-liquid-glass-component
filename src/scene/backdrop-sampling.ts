import { glassSamplingRegion, glassSamplingRegions } from './continuity'
import type { SceneFrame, SceneItem, SceneRect } from './types'

type Backdrop = Extract<SceneItem, { kind: 'backdrop' }>

export interface BackdropSamplingInput {
  items: readonly SceneItem[]
  frame: SceneFrame
  /** Present only for the glass-only presentation. */
  samplingRegion: SceneRect | undefined
  /** Optional independent viewport-space regions for disjoint panes. */
  samplingRegions?: readonly SceneRect[] | undefined
  targetWidth: number
  targetHeight: number
}

export interface BackdropSamplingProof {
  /** Backdrops absent from this set cannot contribute to the presented pane. */
  needed: ReadonlySet<Backdrop>
  /** Viewport-space output required from each backdrop, before its source halo. */
  outputRegions: ReadonlyMap<Backdrop, SceneRect>
  /** Viewport-space source pixels needed by the panes and every contributing blur layer. */
  sourceRegions: readonly SceneRect[]
}

const validRect = (r: SceneRect) =>
  [r.x, r.y, r.width, r.height, r.x + r.width, r.y + r.height].every(Number.isFinite) &&
  r.width > 0 &&
  r.height > 0

function intersection(a: SceneRect, b: SceneRect): SceneRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function union(a: SceneRect, b: SceneRect): SceneRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

const MAX_REQUIRED_REGIONS = 128
const MAX_REGION_CHECKS = 32768

/** Merge only intersecting rectangles. The bounding merge overestimates an L-shaped union. */
function addRequired(regions: SceneRect[], rect: SceneRect): boolean {
  let merged = rect
  for (let index = 0; index < regions.length; ) {
    const existing = regions[index]
    if (existing && intersection(merged, existing)) {
      merged = union(merged, existing)
      regions.splice(index, 1)
      // The enlarged rectangle can intersect an earlier nonintersecting region.
      index = 0
    } else index += 1
  }
  if (regions.length >= MAX_REQUIRED_REGIONS) return false
  regions.push(merged)
  return true
}

function viewportRect(item: SceneItem, frame: SceneFrame): SceneRect {
  return {
    ...item.rect,
    x: item.rect.x - (item.space === 'document' ? frame.scrollX : 0),
    y: item.rect.y - (item.space === 'document' ? frame.scrollY : 0),
  }
}

/**
 * Prove which blur layers can affect glass-only panes. Work backwards
 * through paint order: each relevant backdrop may sample a Gaussian halo of
 * the pixels required from everything behind it. For a partial element the
 * backdrop pass mirrors its viewport-clipped snapshot, so only pixels inside
 * that snapshot can contribute. This approximates native blur near the screen
 * edge when the native implementation samples outside the visible viewport.
 *
 * Recompute for every render frame, with the current scroll, viewport, target
 * size, item geometry and sampling region. Future item types that sample
 * earlier framebuffer contents remain unsupported until explicitly modeled.
 */
export function proveBackdropSampling({
  items,
  frame,
  samplingRegion,
  samplingRegions,
  targetWidth,
  targetHeight,
}: BackdropSamplingInput): BackdropSamplingProof | null {
  if (
    (samplingRegions === undefined
      ? !samplingRegion || !validRect(samplingRegion)
      : !samplingRegions.length ||
        samplingRegions.length > MAX_REQUIRED_REGIONS ||
        samplingRegions.some((region) => !validRect(region))) ||
    ![frame.width, frame.height, frame.scrollX, frame.scrollY, frame.pixelRatio].every(
      Number.isFinite
    ) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.pixelRatio <= 0 ||
    targetWidth !== Math.max(1, Math.round(frame.width * frame.pixelRatio)) ||
    targetHeight !== Math.max(1, Math.round(frame.height * frame.pixelRatio))
  )
    return null

  // Groups preserve their children's paint order; a first backdrop or glass
  // inside one can still sample earlier pixels from the main scene.
  const paints: readonly SceneItem[] = items.flatMap((item) =>
    item.kind === 'opacity-group' ? item.items : [item]
  )
  const glasses = paints.filter(
    (item): item is Extract<SceneItem, { kind: 'glass' }> => item.kind === 'glass'
  )
  if (!glasses.length) return null
  const panes: Array<{ rect: SceneRect; studio: NonNullable<(typeof glasses)[number]['studio']> }> =
    []
  for (const glass of glasses) {
    if (!glass.studio || glass.studio.shadowFactor !== 0 || !validRect(glass.rect)) return null
    const rect = viewportRect(glass, frame)
    if (!validRect(rect)) return null
    panes.push({ rect, studio: glass.studio })
  }

  // Do not rely solely on caller-supplied bounds: include the optical apron
  // computed from the actual glass item, even if the caller gives a smaller region.
  const viewport = { x: 0, y: 0, width: frame.width, height: frame.height }
  const required: SceneRect[] = []
  if (samplingRegions !== undefined) {
    const opticalRegions = glassSamplingRegions(panes, frame)
    if (!opticalRegions || opticalRegions.length > MAX_REQUIRED_REGIONS) return null
    for (const region of [...samplingRegions, ...opticalRegions]) {
      if (!validRect(region)) return null
      const visible = intersection(region, viewport)
      if (visible && !addRequired(required, visible)) return null
    }
  } else {
    const opticalRegion = glassSamplingRegion(panes, frame)
    if (!samplingRegion || !opticalRegion || !validRect(opticalRegion)) return null
    const visible = intersection(union(samplingRegion, opticalRegion), viewport)
    if (visible) required.push(visible)
  }
  if (!required.length) return null
  const scaleX = targetWidth / frame.width
  const scaleY = targetHeight / frame.height
  if (![scaleX, scaleY].every(Number.isFinite) || scaleX <= 0 || scaleY <= 0) return null
  const needed = new Set<Backdrop>()
  const outputRegions = new Map<Backdrop, SceneRect>()
  let checks = 0

  for (let i = paints.length - 1; i >= 0; i -= 1) {
    const item = paints[i]
    if (!item) return null
    if (item.kind !== 'backdrop') {
      // Ordinary items do not sample earlier pixels. The combined optical
      // region includes the summed apron of every interleaved glass pane.
      if (!['sprite', 'solid', 'media', 'glass', 'opacity-group'].includes(item.kind)) return null
      continue
    }
    if (!validRect(item.rect) || !Number.isFinite(item.sigma) || item.sigma < 0) return null
    if (!Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1) return null
    if (item.opacity === 0) continue
    const box = viewportRect(item, frame)
    if (!validRect(box)) return null
    const visible = intersection(box, viewport)
    if (!visible) continue
    // The shader truncates its kernel at ceil(3 sigma) backing pixels. Two
    // additional pixels cover bilinear filtering and rasterized boundaries.
    const xPad = (Math.ceil(3 * item.sigma * scaleX) + 2) / scaleX
    const yPad = (Math.ceil(3 * item.sigma * scaleY) + 2) / scaleY
    if (!Number.isFinite(xPad) || !Number.isFinite(yPad)) return null
    // Snapshot the regions before expanding this layer so it is applied only
    // once. Later iterations continue backwards to earlier painted layers.
    const dependencies: SceneRect[] = []
    for (const region of required) {
      checks += 1
      if (checks > MAX_REGION_CHECKS) return null
      const impact = intersection(region, visible)
      if (!impact) continue
      const prior = outputRegions.get(item)
      outputRegions.set(item, prior ? union(prior, impact) : impact)
      const expanded = {
        x: impact.x - xPad,
        y: impact.y - yPad,
        width: impact.width + 2 * xPad,
        height: impact.height + 2 * yPad,
      }
      // The blur shader mirrors against the visible snapshot bounds. Reflected
      // samples remain within both the viewport and the unreflected halo.
      const dependency = intersection(expanded, visible)
      if (!dependency || !validRect(dependency)) return null
      dependencies.push(dependency)
    }
    if (!dependencies.length) continue
    needed.add(item)
    for (const dependency of dependencies) if (!addRequired(required, dependency)) return null
  }
  return { needed, outputRegions, sourceRegions: required }
}

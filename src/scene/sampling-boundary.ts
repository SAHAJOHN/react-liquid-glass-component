import type { SamplingWatch, SceneRect } from './types'

export type SamplingRelation = 'inside' | 'outside' | 'invalid'

export function validSamplingRegion(region: SceneRect | undefined): region is SceneRect {
  return !!(
    region &&
    [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
    region.width > 0 &&
    region.height > 0 &&
    Number.isFinite(region.x + region.width) &&
    Number.isFinite(region.y + region.height)
  )
}

/** Rectangles use viewport CSS pixels; one pixel protects raster boundary coverage. */
export function samplingRelation(rect: SceneRect, region: SceneRect | undefined): SamplingRelation {
  if (
    !validSamplingRegion(region) ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    ![rect.x + rect.width, rect.y + rect.height].every(Number.isFinite)
  )
    return 'invalid'
  return rect.x + rect.width < region.x - 1 ||
    rect.y + rect.height < region.y - 1 ||
    rect.x > region.x + region.width + 1 ||
    rect.y > region.y + region.height + 1
    ? 'outside'
    : 'inside'
}

/** Check only unresolved assets; native element bounds are already viewport-relative. */
export function samplingBoundaryChanged(
  host: HTMLElement,
  watches: readonly SamplingWatch[],
  region: SceneRect | undefined
): boolean {
  if (!watches.length) return false
  try {
    for (const { element, relation } of watches) {
      if (!element.isConnected || !host.contains(element)) return true
      const bounds = element.getBoundingClientRect()
      const next = samplingRelation(
        { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
        region
      )
      if (next === 'invalid' || next !== relation) return true
    }
    return false
  } catch {
    return true
  }
}

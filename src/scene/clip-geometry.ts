import type { SceneRect } from './types'

const emptyLegacyClip =
  /^rect\(\s*0(?:px)?(?:\s*,\s*|\s+)0(?:px)?(?:\s*,\s*|\s+)0(?:px)?(?:\s*,\s*|\s+)0(?:px)?\s*\)$/i

/** The legacy `clip` property applies only to absolutely positioned boxes. */
export function isEmptyLegacyClip(style: CSSStyleDeclaration): boolean {
  if (style.position !== 'absolute' && style.position !== 'fixed') return false
  const value = style.clip?.trim() ?? ''
  return emptyLegacyClip.test(value)
}

/** True only when the entire inner rectangle fits inside the rounded outer clip. */
export function roundedClipContainsRect(
  outer: SceneRect,
  radius: number,
  roundness: number,
  inner: SceneRect
): boolean {
  if (
    inner.x < outer.x ||
    inner.y < outer.y ||
    inner.x + inner.width > outer.x + outer.width ||
    inner.y + inner.height > outer.y + outer.height
  )
    return false

  const r = Math.max(0, Math.min(radius, outer.width / 2, outer.height / 2))
  if (!r) return true
  const power = Math.max(2, roundness)
  const centerX = outer.x + outer.width / 2
  const centerY = outer.y + outer.height / 2
  const straightX = outer.width / 2 - r
  const straightY = outer.height / 2 - r
  const inside = (x: number, y: number) => {
    const dx = Math.max(0, Math.abs(x - centerX) - straightX)
    const dy = Math.max(0, Math.abs(y - centerY) - straightY)
    // Leave room for edge antialiasing; touching the outer curve is not containment.
    const safeRadius = Math.max(0, r - 1)
    return Math.pow(dx, power) + Math.pow(dy, power) <= Math.pow(safeRadius, power)
  }
  return (
    inside(inner.x, inner.y) &&
    inside(inner.x + inner.width, inner.y) &&
    inside(inner.x, inner.y + inner.height) &&
    inside(inner.x + inner.width, inner.y + inner.height)
  )
}

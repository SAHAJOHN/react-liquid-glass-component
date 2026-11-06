import { isEmptyLegacyClip } from './clip-geometry'

/**
 * A narrow paint-order plan for positive-z fixed contexts whose non-stacking
 * ancestors would otherwise make the compiler paint them too early.
 *
 * The compiler must defer the whole element subtree, not merely its glass
 * item, and retain the inherited geometry when invoking the callback later.
 */
export interface StackingHoistPlan {
  defer(element: Element, paint: () => void): boolean
  flush(owner: Element): void
  isHoisted(element: Element): boolean
}

interface Placement {
  owner: Element
  z: number
  order: number
  hoisted: boolean
}

interface Pending extends Placement {
  element: Element
  paint: () => void
}

const normal = (value: string | undefined, initial: string) => !value || value === initial
const omitted = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'])

function noPseudo(element: Element, readStyle: typeof getComputedStyle): boolean {
  return (['::before', '::after'] as const).every((name) => {
    const content = readStyle(element, name).content
    return !content || content === 'none' || content === 'normal'
  })
}

/** This intentionally excludes intermediate clips, transforms and group effects. */
function safeIntermediate(style: CSSStyleDeclaration): boolean {
  return (
    normal(style.opacity, '1') &&
    normal(style.transform, 'none') &&
    normal(style.translate, 'none') &&
    normal(style.rotate, 'none') &&
    normal(style.scale, 'none') &&
    normal(style.filter, 'none') &&
    normal(style.backdropFilter, 'none') &&
    normal(style.getPropertyValue('-webkit-backdrop-filter'), 'none') &&
    normal(style.perspective, 'none') &&
    normal(style.clipPath, 'none') &&
    normal(style.maskImage, 'none') &&
    normal(style.getPropertyValue('-webkit-mask-image'), 'none') &&
    normal(style.mixBlendMode, 'normal') &&
    normal(style.overflowX, 'visible') &&
    normal(style.overflowY, 'visible') &&
    normal(style.contain, 'none') &&
    normal(style.willChange, 'auto')
  )
}

/** Ancestors outside the scene can also establish a fixed-position containing block. */
function noFixedContainingAncestor(
  parent: Element | null,
  readStyle: typeof getComputedStyle
): boolean {
  for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
    const style = readStyle(ancestor)
    if (
      !normal(style.transform, 'none') ||
      !normal(style.translate, 'none') ||
      !normal(style.rotate, 'none') ||
      !normal(style.scale, 'none') ||
      !normal(style.filter, 'none') ||
      !normal(style.backdropFilter, 'none') ||
      !normal(style.getPropertyValue('-webkit-backdrop-filter'), 'none') ||
      !normal(style.perspective, 'none') ||
      !normal(style.contain, 'none') ||
      !normal(style.willChange, 'auto')
    )
      return false
  }
  return true
}

/**
 * Preflight a tree. If any other positive or negative z-index context escapes
 * in the same owner, preserve the compiler's existing fallback rather than
 * silently changing its order. Direct positive contexts are also deferred so
 * their z-index and document order can be compared with the hoisted block.
 */
export function createStackingHoistPlan(
  root: HTMLElement,
  createsContext: (element: Element, style: CSSStyleDeclaration) => boolean,
  readStyle: typeof getComputedStyle = getComputedStyle
): StackingHoistPlan {
  const candidates = new Map<Element, Placement[]>()
  const unsafeOwners = new Set<Element>()
  const otherEscapingLevels = new Map<Element, number[]>()
  let order = 0

  const visit = (element: Element, owner: Element) => {
    if (
      omitted.has(element.tagName) ||
      element.hasAttribute('data-liquid-glass-scene-canvas') ||
      element.classList.contains('liquid-glass-scene__canvas') ||
      (element !== root && element.hasAttribute('data-liquid-glass-scene')) ||
      (!(element instanceof HTMLElement) && !(element instanceof SVGSVGElement))
    )
      return
    const style = readStyle(element)
    if (
      style.display === 'none' ||
      element.hasAttribute('hidden') ||
      /^inset\(50%\)$/.test(style.clipPath) ||
      isEmptyLegacyClip(style) ||
      Number.parseFloat(style.opacity) === 0
    )
      return
    const currentOrder = order++
    const context = element !== root && createsContext(element, style)
    if (context) {
      const rawZ = style.zIndex.trim()
      if (rawZ !== 'auto' && rawZ !== '' && !/^-?\d+$/.test(rawZ)) {
        unsafeOwners.add(owner)
        return
      }
      const z = rawZ === 'auto' || rawZ === '' ? 0 : Number(rawZ)
      if (!Number.isSafeInteger(z)) {
        unsafeOwners.add(owner)
        return
      }
      const parent = element.parentElement
      if (z !== 0 && parent !== owner) {
        if (z < 0) unsafeOwners.add(owner)
        else if (style.position !== 'fixed') {
          const levels = otherEscapingLevels.get(owner) ?? []
          levels.push(z)
          otherEscapingLevels.set(owner, levels)
        } else {
          let ancestor = parent
          while (
            ancestor &&
            ancestor !== owner &&
            safeIntermediate(readStyle(ancestor)) &&
            noPseudo(ancestor, readStyle)
          )
            ancestor = ancestor.parentElement
          if (
            ancestor !== owner ||
            !safeIntermediate(readStyle(owner)) ||
            !noPseudo(owner, readStyle) ||
            !noFixedContainingAncestor(parent, readStyle)
          )
            unsafeOwners.add(owner)
          else {
            const placements = candidates.get(owner) ?? []
            placements.push({ owner, z, order: currentOrder, hoisted: true })
            candidates.set(owner, placements)
            elements.set(currentOrder, element)
          }
        }
      } else if (z > 0 && parent === owner) {
        const placements = candidates.get(owner) ?? []
        placements.push({ owner, z, order: currentOrder, hoisted: false })
        candidates.set(owner, placements)
        elements.set(currentOrder, element)
      }
    }
    // The compiler treats SVG, media, and native controls as indivisible leaf
    // paint operations; their descendants are not traversed by walk().
    if (
      element instanceof SVGSVGElement ||
      element instanceof HTMLImageElement ||
      element instanceof HTMLVideoElement ||
      element instanceof HTMLCanvasElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
      return
    for (const child of element.children) visit(child, context ? element : owner)
  }

  const elements = new Map<number, Element>()
  visit(root, root)
  const deferred = new Map<Element, Placement>()
  for (const [owner, placements] of candidates) {
    if (unsafeOwners.has(owner) || !placements.some((placement) => placement.hoisted)) continue
    // Other escaped positive contexts remain in normal traversal and retain
    // the compiler's ordering guard. Deferring is safe only if every queued
    // context paints strictly above all of them.
    const lowestDeferred = Math.min(...placements.map((placement) => placement.z))
    if ((otherEscapingLevels.get(owner) ?? []).some((z) => z >= lowestDeferred)) continue
    for (const placement of placements) {
      const element = elements.get(placement.order)
      if (element) deferred.set(element, placement)
    }
  }
  const hoisted = new Set(
    Array.from(deferred, ([element, placement]) => (placement.hoisted ? element : null)).filter(
      (element): element is Element => element !== null
    )
  )
  const pending = new Map<Element, Pending[]>()
  return {
    defer(element, paint) {
      const placement = deferred.get(element)
      if (!placement) return false
      deferred.delete(element)
      const queue = pending.get(placement.owner) ?? []
      queue.push({ ...placement, element, paint })
      pending.set(placement.owner, queue)
      return true
    },
    flush(owner) {
      const queue = pending.get(owner)
      if (!queue) return
      pending.delete(owner)
      queue.sort((a, b) => a.z - b.z || a.order - b.order)
      for (const item of queue) item.paint()
    },
    isHoisted(element) {
      return hoisted.has(element)
    },
  }
}

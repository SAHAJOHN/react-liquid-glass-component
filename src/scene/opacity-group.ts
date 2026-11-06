import { roundedClipContainsRect } from './clip-geometry'
import { MAX_SCENE_CLIPS, sceneClips } from './clip-stack'
import type { SceneClip, SceneFrame, SceneItem, SceneOpacityGroupPaint, SceneRect } from './types'

type Sprite = Extract<SceneItem, { kind: 'sprite' }>
type Paint = SceneOpacityGroupPaint
type DynamicGroup = Extract<SceneItem, { kind: 'opacity-group' }>

/** A rectangular overflow clip on a contained group's real DOM ancestor. */
function isProvenAncestorClip(owner: Element, clip: SceneClip, frame: SceneFrame): boolean {
  if (clip.radius !== 0 || (clip.roundness ?? 2) !== 2) return false
  try {
    const ownerStyle = getComputedStyle(owner)
    const establishesContainingBlock =
      owner instanceof HTMLElement &&
      ['block', 'flow-root', 'flex', 'grid', 'inline-block', 'inline-flex', 'inline-grid'].includes(
        ownerStyle.display
      ) &&
      Boolean(
        (ownerStyle.transform && ownerStyle.transform !== 'none') ||
        (ownerStyle.translate && ownerStyle.translate !== 'none')
      )
    // Transforms and individual translations contain fixed descendants.
    // Absolute and fixed owners can themselves escape the ancestor clip.
    if (
      !['relative', 'sticky', 'static'].includes(ownerStyle.position) ||
      ownerStyle.display === 'contents'
    )
      return false
    if (ownerStyle.position === 'static' && !establishesContainingBlock) {
      // A static subtree stays inside an ancestor's overflow clip only when
      // neither elements nor generated content can escape their containing block.
      const descendants = owner.querySelectorAll('*')
      if (descendants.length >= 128) return false
      const elements = [owner, ...Array.from(descendants)]
      for (const current of elements) {
        if (
          current.shadowRoot ||
          current.hasAttribute('popover') ||
          (current.tagName === 'DIALOG' && current.hasAttribute('open'))
        )
          return false
        const style = current === owner ? ownerStyle : getComputedStyle(current)
        if (current !== owner && ['absolute', 'fixed'].includes(style.position)) return false
      }
      for (const current of elements) {
        for (const pseudo of ['::before', '::after'] as const) {
          const pseudoStyle = getComputedStyle(current, pseudo)
          if (
            pseudoStyle.content &&
            pseudoStyle.content !== 'none' &&
            pseudoStyle.content !== 'normal' &&
            ['absolute', 'fixed'].includes(pseudoStyle.position)
          )
            return false
        }
      }
    }
    if (!establishesContainingBlock) {
      for (const descendant of owner.querySelectorAll('*')) {
        const style = getComputedStyle(descendant)
        if (style.display !== 'none' && style.position === 'fixed') return false
      }
    }
    for (let ancestor = owner.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (clip.owner !== ancestor) continue
      const style = getComputedStyle(ancestor)
      if (
        !['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) ||
        !['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
      )
        continue
      const borders = [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ]
      const radii = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ]
      const margin = style.getPropertyValue('overflow-clip-margin').trim()
      if (
        !borders.every((value) => Number.parseFloat(value) === 0) ||
        !radii.every((value) => Number.parseFloat(value) === 0) ||
        (margin && !/^(?:0|0px)$/.test(margin))
      )
        continue
      const rect = ancestor.getBoundingClientRect()
      const x = rect.left + (clip.space === 'document' ? frame.scrollX : 0)
      const y = rect.top + (clip.space === 'document' ? frame.scrollY : 0)
      if (
        [x, y, rect.width, rect.height].every(Number.isFinite) &&
        Math.abs(x - clip.rect.x) < 0.001 &&
        Math.abs(y - clip.rect.y) < 0.001 &&
        Math.abs(rect.width - clip.rect.width) < 0.001 &&
        Math.abs(rect.height - clip.rect.height) < 0.001
      )
        return true
    }
  } catch {
    // Detached or otherwise unmeasurable content cannot establish provenance.
  }
  return false
}

export type OpacityGroupResult =
  | { status: 'ready'; item: Sprite | DynamicGroup }
  | { status: 'empty' }
  | { status: 'unsupported'; reason: string }

export interface OpacityGroupInput {
  /** The element establishing this opacity group; used only for bitmap caching. */
  owner: Element
  /** Ordered paint emitted by that element and its descendants. */
  items: readonly SceneItem[]
  /** Combined opacity inherited from outer elements, excluding this group. */
  inheritedOpacity: number
  /** This element's opacity. Zero is handled by the compiler before painting. */
  groupOpacity: number
  frame: SceneFrame
  /** Use the viewport-sized GPU group target instead of allocating a content-sized bitmap. */
  preferGpu?: boolean
  /** The caller has already isolated any nested opacity groups in these flat paints. */
  preserveFlatOpacities?: boolean
}

/**
 * Compose a bounded opacity group in an isolated, transparent bitmap. The
 * compiler must reject nested opacity groups and unsupported paint ordering
 * before calling this function; an item list alone cannot establish either.
 *
 * Canvas bitmaps are cached per owner and reused if opacity alone changes.
 * Paint with nested alpha, brightness, glass, backdrop filters,
 * or ambiguous shared clipping fails closed. A common clip prefix is applied
 * once to the composed group, preserving its antialiased coverage.
 */
export function createOpacityGroupPainter() {
  let cache = new WeakMap<Element, { key: string; bitmap: HTMLCanvasElement }>()
  let bitmapIds = new WeakMap<HTMLCanvasElement, number>()
  let nextBitmapId = 1

  function bitmapId(bitmap: HTMLCanvasElement): number {
    const existing = bitmapIds.get(bitmap)
    if (existing !== undefined) return existing
    const id = nextBitmapId++
    bitmapIds.set(bitmap, id)
    return id
  }

  function compose({
    owner,
    items,
    inheritedOpacity,
    groupOpacity,
    frame,
    preferGpu = false,
    preserveFlatOpacities = false,
  }: OpacityGroupInput): OpacityGroupResult {
    const unsupported = (reason: string): OpacityGroupResult => ({ status: 'unsupported', reason })
    if (!items.length) return { status: 'empty' }
    if (
      ![inheritedOpacity, groupOpacity, frame.width, frame.height, frame.pixelRatio].every(
        Number.isFinite
      ) ||
      inheritedOpacity <= 0 ||
      inheritedOpacity > 1 ||
      groupOpacity <= 0 ||
      groupOpacity > 1 ||
      frame.width <= 0 ||
      frame.height <= 0 ||
      frame.pixelRatio <= 0
    )
      return unsupported('Invalid opacity group geometry or opacity')
    const opacity = inheritedOpacity * groupOpacity
    const space = items[0]?.space
    if (!space) return unsupported('Opacity group has no coordinate space')
    if (
      preserveFlatOpacities &&
      (!preferGpu ||
        inheritedOpacity !== 1 ||
        groupOpacity !== 1 ||
        items.some((item) => item.kind !== 'sprite' && item.kind !== 'solid'))
    )
      return unsupported('Independent opacity requires a precomposed flat GPU group')
    // Multiple paints may keep their individual alpha only when their caller
    // already isolated nested opacity groups before composing this group.
    const preservePaintAlpha =
      preferGpu &&
      inheritedOpacity === 1 &&
      groupOpacity === 1 &&
      (items.length === 1 || preserveFlatOpacities) &&
      items.every((item) => item.kind === 'sprite' || item.kind === 'solid')
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const paints: Paint[] = []
    for (const [index, item] of items.entries()) {
      if (
        item.kind !== 'sprite' &&
        item.kind !== 'solid' &&
        item.kind !== 'media' &&
        item.kind !== 'glass' &&
        item.kind !== 'backdrop'
      )
        return unsupported('Opacity group contains dynamic or unsupported paint')
      // The optical pass samples the scene as it stood before the group. If
      // any group paint preceded the lens, it would need an additional backdrop
      // compositing pass; leave those cases native until supported.
      if (item.kind === 'glass' && (index !== 0 || !item.studio || item.studio.shadowFactor !== 0))
        return unsupported('Opacity group requires one first, shadowless Studio glass pane')
      if (item.kind === 'backdrop' && index !== 0)
        return unsupported('Opacity group requires one first backdrop layer')
      if (
        item.kind === 'backdrop' &&
        (item.bitmap.width <= 0 ||
          item.bitmap.height <= 0 ||
          !Number.isFinite(item.sigma) ||
          item.sigma < 0)
      )
        return unsupported('Opacity group contains an invalid backdrop layer')
      if (
        item.space !== space ||
        !Number.isFinite(item.opacity) ||
        (preservePaintAlpha
          ? item.opacity < 0 || item.opacity > 1
          : Math.abs(item.opacity - opacity) > 1e-8) ||
        (item.brightness !== undefined && item.brightness !== 1)
      )
        return unsupported('Opacity group contains nested alpha, brightness or mixed coordinates')
      const { x, y, width, height } = item.rect
      if (
        ![x, y, width, height, x + width, y + height].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
      )
        return unsupported('Opacity group contains invalid paint bounds')
      if (item.kind === 'sprite' && (item.bitmap.width <= 0 || item.bitmap.height <= 0))
        return unsupported('Opacity group contains an empty bitmap')
      if (
        item.kind === 'media' &&
        item.source instanceof HTMLCanvasElement &&
        item.source.getAttribute('data-liquid-glass-canvas') !== '2d'
      )
        return unsupported('Opacity group canvas requires a declared 2D context')
      if (
        item.kind === 'solid' &&
        (item.radius !== 0 ||
          item.color.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1))
      )
        return unsupported('Opacity group contains an unsupported solid')
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + width)
      maxY = Math.max(maxY, y + height)
      paints.push(item)
    }
    const scaleX = Math.max(1, Math.round(frame.width * frame.pixelRatio)) / frame.width
    const scaleY = Math.max(1, Math.round(frame.height * frame.pixelRatio)) / frame.height
    const left = Math.floor(minX * scaleX) - 1
    const top = Math.floor(minY * scaleY) - 1
    const right = Math.ceil(maxX * scaleX) + 1
    const bottom = Math.ceil(maxY * scaleY) + 1
    const pixelWidth = right - left
    const pixelHeight = bottom - top
    if (
      ![scaleX, scaleY].every(Number.isFinite) ||
      ![left, top, right, bottom].every(Number.isSafeInteger) ||
      ![pixelWidth, pixelHeight].every(Number.isSafeInteger) ||
      pixelWidth <= 0 ||
      pixelHeight <= 0
    )
      return unsupported('Opacity group bitmap exceeds safe size')
    const bitmapTooLarge =
      pixelWidth > 4096 || pixelHeight > 4096 || pixelWidth * pixelHeight > 2_000_000
    const viewportWidth = Math.max(1, Math.round(frame.width * frame.pixelRatio))
    const viewportHeight = Math.max(1, Math.round(frame.height * frame.pixelRatio))
    const viewportTooLarge =
      !Number.isSafeInteger(viewportWidth) ||
      !Number.isSafeInteger(viewportHeight) ||
      viewportWidth > 4096 ||
      viewportHeight > 4096 ||
      frame.width * frame.height * frame.pixelRatio * frame.pixelRatio > 2_000_000 + 0.01
    if ((!preferGpu && bitmapTooLarge) || (preferGpu && viewportTooLarge))
      return unsupported('Opacity group bitmap exceeds safe size')
    const bounds: SceneRect = {
      x: left / scaleX,
      y: top / scaleY,
      width: pixelWidth / scaleX,
      height: pixelHeight / scaleY,
    }
    const stacks = paints.map(sceneClips)
    const validClip = (clip: SceneClip) =>
      (clip.space === 'document' || clip.space === 'viewport') &&
      [
        clip.rect.x,
        clip.rect.y,
        clip.rect.width,
        clip.rect.height,
        clip.rect.x + clip.rect.width,
        clip.rect.y + clip.rect.height,
        clip.radius,
        clip.roundness ?? 2,
      ].every(Number.isFinite) &&
      clip.rect.width > 0 &&
      clip.rect.height > 0 &&
      clip.radius >= 0 &&
      (clip.roundness ?? 2) >= 2
    if (
      stacks.some(
        (stack) => stack.length > MAX_SCENE_CLIPS || stack.some((clip) => !validClip(clip))
      )
    )
      return unsupported('Opacity group has invalid clips')

    const sameGeometry = (a: SceneClip, b: SceneClip) =>
      a.space === b.space &&
      a.rect.x === b.rect.x &&
      a.rect.y === b.rect.y &&
      a.rect.width === b.rect.width &&
      a.rect.height === b.rect.height &&
      a.radius === b.radius &&
      (a.roundness ?? 2) === (b.roundness ?? 2)
    // Geometry alone cannot distinguish two sibling overflow clips with
    // identical bounds. Factor only provenance established by the compiler.
    const sameClip = (a: SceneClip, b: SceneClip) =>
      Boolean(a.owner && a.owner === b.owner && a.owner.contains(owner) && sameGeometry(a, b))
    const firstStack = stacks[0] ?? []
    let prefixLength = 0
    while (prefixLength < firstStack.length) {
      const reference = firstStack[prefixLength]
      if (
        !reference ||
        !stacks.every((stack) => {
          const clip = stack[prefixLength]
          return clip !== undefined && sameClip(clip, reference)
        })
      )
        break
      prefixLength += 1
    }
    const common = firstStack.slice(0, prefixLength)
    const shared = stacks.every((stack) => stack.length === prefixLength)
    // Differing clips may only be discarded if they cannot clip any pixel of
    // the group. Do not mix document and viewport bounds for this proof.
    const cutsGroup =
      !shared &&
      stacks.some((stack) =>
        stack
          .slice(prefixLength)
          .some(
            (clip) =>
              clip.space !== space ||
              !roundedClipContainsRect(clip.rect, clip.radius, clip.roundness ?? 2, bounds)
          )
      )
    if (
      preferGpu ||
      paints.some(
        (item) => item.kind === 'media' || item.kind === 'glass' || item.kind === 'backdrop'
      ) ||
      cutsGroup
    ) {
      // If multiple overlapping paint operations share a remaining clip, it
      // might be a nested clipping group. Clipping them individually would
      // apply antialiasing before compositing and can change edge opacity.
      const margin = 2 / Math.min(scaleX, scaleY)
      const promoted: SceneClip[] = []
      for (let i = 0; i < paints.length; i += 1) {
        const a = paints[i]
        if (!a) return unsupported('Opacity group has invalid paint')
        for (let j = i + 1; j < paints.length; j += 1) {
          const b = paints[j]
          if (!b) return unsupported('Opacity group has invalid paint')
          const overlaps =
            a.rect.x < b.rect.x + b.rect.width + margin &&
            a.rect.x + a.rect.width + margin > b.rect.x &&
            a.rect.y < b.rect.y + b.rect.height + margin &&
            a.rect.y + a.rect.height + margin > b.rect.y
          if (overlaps) {
            for (const clip of stacks[i]?.slice(prefixLength) ?? []) {
              const matching = stacks[j]
                ?.slice(prefixLength)
                .find(
                  (other) =>
                    sameGeometry(clip, other) &&
                    (!clip.owner || !other.owner || clip.owner === other.owner)
                )
              if (!matching) continue
              // If the shared clip cannot touch the overlap, applying it to
              // each paint cannot compound antialiasing at that boundary.
              const overlap = {
                x: Math.max(a.rect.x, b.rect.x) - margin,
                y: Math.max(a.rect.y, b.rect.y) - margin,
                width:
                  Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) -
                  Math.max(a.rect.x, b.rect.x) +
                  margin * 2,
                height:
                  Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) -
                  Math.max(a.rect.y, b.rect.y) +
                  margin * 2,
              }
              const sharedAncestor = sameClip(clip, matching)
              if (sharedAncestor && promoted.some((other) => sameClip(clip, other))) continue
              if (
                sharedAncestor &&
                common.length + promoted.length < MAX_SCENE_CLIPS &&
                isProvenAncestorClip(owner, clip, frame)
              ) {
                promoted.push(clip)
                continue
              }
              if (
                (!sharedAncestor || clip.owner === owner) &&
                clip.space === space &&
                roundedClipContainsRect(clip.rect, clip.radius, clip.roundness ?? 2, overlap)
              )
                continue
              return unsupported('Opacity group has an ambiguous nested clip')
            }
          }
        }
      }
      // Keep the original browser canvas/video as a GPU media source. Reading
      // its context to determine a type can create one on a canvas that has not
      // yet initialized, and drawImage can diverge from WebGL uploads.
      const groupItems = paints.map((item, index) => {
        const unclipped = { ...item, opacity: preservePaintAlpha ? item.opacity : 1 }
        delete unclipped.clip
        delete unclipped.clips
        const remaining = (stacks[index]?.slice(prefixLength) ?? []).filter(
          (clip) => !promoted.some((outer) => sameClip(outer, clip))
        )
        if (remaining.length) unclipped.clips = remaining
        return unclipped
      })
      return {
        status: 'ready',
        item: {
          kind: 'opacity-group',
          items: groupItems,
          rect: bounds,
          space,
          opacity,
          ...(common.length || promoted.length ? { clips: [...common, ...promoted] } : {}),
        },
      }
    }
    const descriptors = paints.map((item) => [
      item.kind,
      (item.rect.x - bounds.x) * scaleX,
      (item.rect.y - bounds.y) * scaleY,
      item.rect.width * scaleX,
      item.rect.height * scaleY,
      ...(item.kind === 'sprite'
        ? [bitmapId(item.bitmap)]
        : item.kind === 'solid'
          ? [...item.color]
          : []),
    ])
    const key = JSON.stringify([pixelWidth, pixelHeight, descriptors])
    let bitmap = cache.get(owner)?.key === key ? cache.get(owner)?.bitmap : undefined
    if (!bitmap) {
      const canvas = document.createElement('canvas')
      canvas.width = pixelWidth
      canvas.height = pixelHeight
      const context = canvas.getContext('2d')
      if (!context) return unsupported('Opacity group canvas is unavailable')
      try {
        for (const item of paints) {
          const x = (item.rect.x - bounds.x) * scaleX
          const y = (item.rect.y - bounds.y) * scaleY
          const width = item.rect.width * scaleX
          const height = item.rect.height * scaleY
          if (item.kind === 'sprite') context.drawImage(item.bitmap, x, y, width, height)
          else if (item.kind === 'solid') {
            const [r, g, b, a] = item.color
            context.fillStyle = `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`
            context.fillRect(x, y, width, height)
          }
        }
      } catch {
        return unsupported('Opacity group paint could not be composed')
      }
      bitmap = canvas
      cache.set(owner, { key, bitmap })
    }
    return {
      status: 'ready',
      item: {
        kind: 'sprite',
        bitmap,
        rect: bounds,
        space,
        opacity,
        ...(common.length ? { clips: common } : {}),
      },
    }
  }

  return {
    compose,
    dispose() {
      cache = new WeakMap()
      bitmapIds = new WeakMap()
    },
  }
}

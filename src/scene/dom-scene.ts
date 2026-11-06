import { createDisplacementMapSvg } from '../displacement-map'
import { isEmptyLegacyClip, roundedClipContainsRect } from './clip-geometry'
import { MAX_SCENE_CLIPS } from './clip-stack'
import { paintLucide } from './paint-lucide'
import { paintEllipsis } from './paint-ellipsis'
import { samplingRelationToRegions, validSamplingRegion } from './sampling-boundary'
import { expandBackdropRelevance } from './backdrop-relevance'
import type {
  CompiledScene,
  SceneCompiler,
  SceneFrame,
  SceneItem,
  SceneRect,
  SceneTarget,
  SamplingWatch,
} from './types'
import { backgroundUrl, boxRadii, createColorReader, length, paintBox, splitCss } from './paint-box'
import { paintBoxShadows } from './paint-shadow'
import type { BoxShadowPaint, BoxShadowSprite } from './paint-shadow'
import { measurePseudoBox, paintPseudoBox, type PseudoName } from './paint-pseudo'
import { paintBackdropMask } from './backdrop-mask'
import { hasIntersectingSubtreeMask, paintSubtreeMask } from './subtree-mask'
import { createNativeBorderSource, paintNativeBorder } from './native-border'
import { parseBackdropFilter } from './backdrop-filter'
import { createStackingHoistPlan } from './stacking-hoist'
import { getBoundedRelativePaintRect } from './stacking-bounds'
import { isSupportedIndividualTranslate } from './translate'
import { createOpacityGroupPainter } from './opacity-group'
import {
  createAssetCache,
  canReuseLoadedImage,
  canStretchSvg,
  paintControlText,
  paintImage,
  paintText,
  serializeSvg,
  stableSvgRasterDimension,
} from './paint-content'

type StyleReader = (element: Element, pseudo?: string | null) => CSSStyleDeclaration

type Space = 'document' | 'viewport'
type Clip = NonNullable<SceneItem['clip']>
interface Geometry {
  space: Space
  scaleX: number
  scaleY: number
  opacity: number
  brightness: number
  filtered: boolean
  transformed: boolean
  clips?: readonly Clip[]
}
interface CachedPaint {
  key: string
  bitmap: HTMLCanvasElement
  issues: string[]
}
interface SvgRasterSize {
  layoutWidth: number
  layoutHeight: number
  width: number
  height: number
  ratio: number
  dpr: number
}
const omitted = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'])
const editableInputTypes = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'
const maskError = 'CSS masks and clip paths require native HTML rendering'

type Filter =
  | { kind: 'none' }
  | { kind: 'identity' }
  | { kind: 'brightness'; factor: number }
  | { kind: 'unsupported' }

/** Darkening commutes with source-over compositing; brightening can clip per layer. */
function readFilter(value: string | undefined): Filter {
  const input = value?.trim() ?? ''
  if (!input || input === 'none') return { kind: 'none' }
  if (/^blur\(\s*0(?:\.0+)?px\s*\)$/i.test(input)) return { kind: 'identity' }
  const match = /^brightness\(\s*([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(%)?\s*\)$/i.exec(
    input
  )
  if (!match?.[1]) return { kind: 'unsupported' }
  const factor = Number(match[1]) / (match[2] ? 100 : 1)
  return Number.isFinite(factor) && factor >= 0 && factor <= 1
    ? { kind: 'brightness', factor }
    : { kind: 'unsupported' }
}

function toRect(bounds: DOMRect, space: Space, frame: SceneFrame): SceneRect {
  return {
    x: bounds.left + (space === 'document' ? frame.scrollX : 0),
    y: bounds.top + (space === 'document' ? frame.scrollY : 0),
    width: bounds.width,
    height: bounds.height,
  }
}
function logicalSize(bounds: DOMRect, geometry: Geometry) {
  return { width: bounds.width / geometry.scaleX, height: bounds.height / geometry.scaleY }
}
function rasterRatio(width: number, height: number, ratio: number) {
  return Math.min(
    ratio,
    4096 / Math.max(1, width),
    4096 / Math.max(1, height),
    Math.sqrt(2_000_000 / Math.max(1, width * height))
  )
}

function sceneSamplingRelation(
  rect: SceneRect,
  space: Space,
  frame: SceneFrame,
  regions: readonly SceneRect[] | undefined
): ReturnType<typeof samplingRelationToRegions> {
  return samplingRelationToRegions(
    {
      x: rect.x - (space === 'document' ? frame.scrollX : 0),
      y: rect.y - (space === 'document' ? frame.scrollY : 0),
      width: rect.width,
      height: rect.height,
    },
    regions
  )
}
function base(rect: SceneRect, geometry: Geometry) {
  return {
    rect,
    space: geometry.space,
    opacity: geometry.opacity,
    ...(geometry.brightness !== 1 ? { brightness: geometry.brightness } : {}),
    ...(geometry.clips?.length ? { clips: geometry.clips } : {}),
  }
}
function appendClip(
  previous: readonly Clip[] | undefined,
  next: Clip,
  issues: Set<string>
): readonly Clip[] {
  const result: Clip[] = []
  for (const clip of previous ?? []) {
    if (clip.space !== next.space) {
      result.push(clip)
      continue
    }
    const a = clip.rect
    const b = next.rect
    const same =
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height &&
      clip.radius === next.radius &&
      (clip.roundness ?? 2) === (next.roundness ?? 2)
    if (same || roundedClipContainsRect(b, next.radius, next.roundness ?? 2, a)) return previous!
    if (!roundedClipContainsRect(a, clip.radius, clip.roundness ?? 2, b)) result.push(clip)
  }
  result.push(next)
  if (result.length > MAX_SCENE_CLIPS)
    issues.add(`More than ${MAX_SCENE_CLIPS} nested clips require native HTML rendering`)
  return result
}

function boundedLeafEffects(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (
    Array.from(element.childNodes).some(
      (node) => node instanceof Element || node.textContent?.trim()
    )
  )
    return false
  if (
    (style.filter && style.filter !== 'none') ||
    (style.boxShadow && style.boxShadow !== 'none') ||
    (style.textShadow && style.textShadow !== 'none') ||
    (style.outlineStyle && style.outlineStyle !== 'none')
  )
    return false
  return (['::before', '::after'] as const).every(
    (pseudo) => measurePseudoBox(element, pseudo).status === 'none'
  )
}

/** Box-clipped gradient masks and an overflow clip bound the entire subtree. */
function boundedMaskedSubtree(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  readStyle: StyleReader
): boolean {
  const maxProofNodes = 128
  const initial = (value: string | undefined, expected: string) => !value || value === expected
  const property = (name: string) => style.getPropertyValue(name).trim()
  const standard = style.maskImage?.trim() ?? ''
  const prefixed = property('-webkit-mask-image')
  const mask = standard && standard !== 'none' ? standard : prefixed
  const isIntersecting = splitCss(mask).length === 2 && hasIntersectingSubtreeMask(style)
  if (
    !mask ||
    mask === 'none' ||
    (standard && standard !== 'none' && prefixed && prefixed !== 'none' && standard !== prefixed) ||
    (splitCss(mask).length !== 1 && !isIntersecting) ||
    !/^linear-gradient\(/i.test(mask) ||
    /url\s*\(/i.test(mask) ||
    (!isIntersecting && !initial(property('mask-clip'), 'border-box')) ||
    (!isIntersecting && !initial(property('-webkit-mask-clip'), 'border-box')) ||
    (!isIntersecting && !initial(property('mask-composite'), 'add')) ||
    (!isIntersecting && !['', 'add', 'source-over'].includes(property('-webkit-mask-composite'))) ||
    !initial(property('mask-border-source'), 'none') ||
    !initial(property('-webkit-mask-box-image-source'), 'none') ||
    !initial(property('overflow-clip-margin'), '0px') ||
    !['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) ||
    !['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) ||
    !['static', 'relative'].includes(style.position) ||
    style.display === 'contents' ||
    !initial(style.clipPath, 'none') ||
    !initial(style.transform, 'none') ||
    !initial(style.translate, 'none') ||
    !initial(style.rotate, 'none') ||
    !initial(style.scale, 'none') ||
    !initial(style.filter, 'none') ||
    hasBackdropFilter(style) ||
    !initial(style.boxShadow, 'none') ||
    !initial(style.textShadow, 'none') ||
    !initial(style.outlineStyle, 'none') ||
    !initial(style.mixBlendMode, 'normal') ||
    !initial(style.opacity, '1') ||
    (document.fullscreenElement && element.contains(document.fullscreenElement))
  )
    return false

  try {
    // Refuse large groups before measuring descendant styles. This proof can
    // run during animation frames, so it must have a predictable cost.
    if (element.querySelectorAll('*').length >= maxProofNodes) return false
    const pending: Element[] = [element]
    let count = 0
    while (pending.length) {
      const current = pending.pop()
      if (!current || ++count > maxProofNodes || current.shadowRoot) return false
      if (
        (current.tagName === 'DIALOG' && current.hasAttribute('open')) ||
        current.hasAttribute('popover')
      )
        return false
      if (current !== element) {
        const childStyle = readStyle(current)
        if (childStyle.display === 'none' || current.hasAttribute('hidden')) continue
        if (childStyle.position === 'fixed' || childStyle.position === 'absolute') return false
      }
      for (const pseudo of ['::before', '::after'] as const) {
        const pseudoStyle = readStyle(current, pseudo)
        if (
          pseudoStyle.content &&
          pseudoStyle.content !== 'none' &&
          pseudoStyle.content !== 'normal' &&
          (pseudoStyle.position === 'fixed' || pseudoStyle.position === 'absolute')
        )
          return false
      }
      pending.push(...Array.from(current.children))
    }
    return true
  } catch {
    return false
  }
}

function backdropRadius(style: CSSStyleDeclaration, width: number, height: number): number | null {
  const values = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]
  if (
    !values.every((value) =>
      /^(?:\d+(?:\.\d+)?)(?:px|%)(?:\s+(?:\d+(?:\.\d+)?)(?:px|%))?$/.test(value)
    )
  )
    return null
  const radii = boxRadii(style, width, height)
  const radius = radii[0]?.[0]
  if (radius === undefined || !Number.isFinite(radius) || radius > Math.min(width, height) / 2)
    return null
  return radii.every(([x, y]) => x === radius && y === radius) ? radius : null
}

// A filtered ancestor limits the backdrop that can be sampled. This renderer
// currently holds a single flattened scene, so such groups must stay native.
function hasBackdropRootBetween(element: Element, root: Element, readStyle: StyleReader): boolean {
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = readStyle(ancestor)
    const effect = (value: string) => Boolean(value && value !== 'none')
    if (
      effect(style.filter) ||
      hasBackdropFilter(style) ||
      Number.parseFloat(style.opacity) < 1 ||
      effect(style.maskImage) ||
      effect(style.getPropertyValue('-webkit-mask-image')) ||
      effect(style.clipPath) ||
      (style.mixBlendMode && style.mixBlendMode !== 'normal') ||
      style.willChange
        .split(',')
        .some((value) =>
          [
            'filter',
            'backdrop-filter',
            'opacity',
            'mask',
            'mask-image',
            'clip-path',
            'mix-blend-mode',
          ].includes(value.trim())
        )
    )
      return true
    if (ancestor === root) return false
  }
  return true
}

/** Reads ordinary DOM; callers never annotate text, media, or paint primitives. */
export function createSceneCompiler(invalidate: () => void): SceneCompiler {
  const readColor = createColorReader()
  const assets = createAssetCache(invalidate)
  const boxCache = new WeakMap<Element, CachedPaint>()
  const nativeBorderCache = new WeakMap<
    Element,
    { key: string; bitmap: HTMLCanvasElement | null }
  >()
  const borderCache = new WeakMap<Element, CachedPaint>()
  const shadowCache = new WeakMap<Element, { key: string; paint: BoxShadowPaint }>()
  const pseudoCache = new WeakMap<HTMLElement, Partial<Record<PseudoName, CachedPaint>>>()
  const backdropMaskCache = new WeakMap<HTMLElement, { key: string; bitmap: HTMLCanvasElement }>()
  const subtreeMaskCache = new WeakMap<HTMLElement, { key: string; bitmap: HTMLCanvasElement }>()
  const opacityGroups = createOpacityGroupPainter()
  let opaqueMask: HTMLCanvasElement | undefined
  let textCache = new WeakMap<Text, CachedPaint>()
  let imageCache = new WeakMap<Element, CachedPaint>()
  const rejectedDomImages = new WeakMap<HTMLImageElement, string>()
  const svgSizes = new WeakMap<SVGSVGElement, SvgRasterSize>()
  const mapBitmaps = new Map<string, HTMLCanvasElement>()
  const channelIndexes = { R: 0, G: 1, B: 2 } as const
  let disposed = false
  const fonts = document.fonts
  const onFontsChanged = () => {
    textCache = new WeakMap()
    imageCache = new WeakMap()
    invalidate()
  }
  fonts?.addEventListener('loadingdone', onFontsChanged)
  fonts?.addEventListener('loadingerror', onFontsChanged)

  const paintCached = <T extends Element | Text>(
    cache: WeakMap<T, CachedPaint>,
    node: T,
    key: string,
    paint: (issues: Set<string>) => HTMLCanvasElement,
    issues: Set<string>
  ) => {
    const previous = cache.get(node)
    if (previous?.key === key) {
      previous.issues.forEach((issue) => issues.add(issue))
      return previous.bitmap
    }
    const paintIssues = new Set<string>()
    const bitmap = paint(paintIssues)
    const result: CachedPaint = { key, bitmap, issues: Array.from(paintIssues) }
    cache.set(node, result)
    result.issues.forEach((issue) => issues.add(issue))
    return bitmap
  }

  return {
    compile(
      root,
      glasses,
      frame,
      background,
      samplingRegion,
      samplingRegions,
      fixedContainer
    ): CompiledScene {
      if (disposed) throw new Error('Scene compiler is disposed')
      const items: SceneItem[] = []
      const targets: SceneTarget[] = []
      const issues = new Set<string>()
      assets.begin()
      const usedMapKeys = new Set<string>()
      const media: (HTMLVideoElement | HTMLCanvasElement)[] = []
      let liveGeometry = false
      const samplingWatches: SamplingWatch[] = []
      let shadowPaintCount = 0
      const styleCache = new WeakMap<Element, Map<string, CSSStyleDeclaration>>()
      const readStyle: StyleReader = (element, pseudo) => {
        let cache = styleCache.get(element)
        if (!cache) {
          cache = new Map()
          styleCache.set(element, cache)
        }
        const key = pseudo ?? ''
        const cached = cache.get(key)
        if (cached) return cached
        const style = getComputedStyle(element, pseudo)
        cache.set(key, style)
        return style
      }
      const stacking = createStackingHoistPlan(
        root,
        (element, style) => createsStackingContext(element, style, readStyle),
        readStyle
      )
      // Compilation is synchronous and does not mutate the source DOM. Reuse
      // layout reads within this pass, but discard them before the next frame.
      const rectCache = new WeakMap<Element, DOMRect>()
      const descendantCache = new WeakMap<Element, Element[]>()
      const readDescendants = (element: Element): Element[] => {
        const cached = descendantCache.get(element)
        if (cached) return cached
        const descendants = Array.from(element.querySelectorAll('*'))
        descendantCache.set(element, descendants)
        return descendants
      }
      const readRect = (element: Element): DOMRect => {
        const cached = rectCache.get(element)
        if (cached) return cached
        const rect = element.getBoundingClientRect()
        rectCache.set(element, rect)
        return rect
      }
      type Edges = { left: number; top: number; right: number; bottom: number }
      const descendantBounds = new WeakMap<Element, { bounds?: Edges; uncertain: boolean }>()
      const hasOverlappingDescendant = (element: Element, target: Edges): boolean => {
        let cached = descendantBounds.get(element)
        const descendants = readDescendants(element)
        if (!cached) {
          let left = Infinity,
            top = Infinity,
            right = -Infinity,
            bottom = -Infinity
          let uncertain = false
          for (const child of descendants) {
            const rect = readRect(child)
            if (rect.width <= 0 || rect.height <= 0) continue
            if (
              ![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(
                Number.isFinite
              )
            ) {
              uncertain = true
              continue
            }
            left = Math.min(left, rect.left)
            top = Math.min(top, rect.top)
            right = Math.max(right, rect.right)
            bottom = Math.max(bottom, rect.bottom)
          }
          cached = {
            uncertain,
            ...(left !== Infinity ? { bounds: { left, top, right, bottom } } : {}),
          }
          descendantBounds.set(element, cached)
        }
        const overlaps = (rect: Edges) =>
          target.left < rect.right &&
          target.right > rect.left &&
          target.top < rect.bottom &&
          target.bottom > rect.top
        if (!cached.uncertain && (!cached.bounds || !overlaps(cached.bounds))) return false
        return descendants.some((child) => {
          const rect = readRect(child)
          return rect.width > 0 && rect.height > 0 && overlaps(rect)
        })
      }
      const orderedChildren = new WeakMap<
        Element,
        { children: Element[]; levels: Map<Element, number> }
      >()
      const readOrderedChildren = (container: Element) => {
        const cached = orderedChildren.get(container)
        if (cached) return cached
        const layout = readStyle(container).display
        const levels = new Map<Element, number>()
        const children = Array.from(container.children)
        for (const child of children) {
          const childStyle = readStyle(child)
          levels.set(
            child,
            childStyle.position === 'static' && !layout.includes('flex') && !layout.includes('grid')
              ? 0
              : Number.parseInt(childStyle.zIndex, 10) || 0
          )
        }
        children.sort((a, b) => (levels.get(a) ?? 0) - (levels.get(b) ?? 0))
        const result = { children, levels }
        orderedChildren.set(container, result)
        return result
      }
      // Blur can sample content outside the glass optics. Expand relevance
      // before skipping unresolved media or unsupported effects.
      const relevance = samplingRegion
        ? expandBackdropRelevance({
            root,
            regions: samplingRegions ?? [samplingRegion],
            frame,
            readStyle,
            readRect,
          })
        : { regions: undefined, hasBackdrop: false }
      const sourceRegions = relevance.regions
      const boundedPaintRects = new WeakMap<Element, SceneRect | null>()
      const readBoundedPaintRect = (element: Element): SceneRect | null => {
        if (boundedPaintRects.has(element)) return boundedPaintRects.get(element) ?? null
        const bounded = getBoundedRelativePaintRect(element, root, readStyle)
        boundedPaintRects.set(element, bounded)
        return bounded
      }
      const outsideClippedStacking = (element: Element): boolean => {
        if (!sourceRegions) return false
        const raw = readRect(element)
        if (
          sceneSamplingRelation(
            toRect(raw, 'viewport', frame),
            'viewport',
            frame,
            sourceRegions
          ) !== 'outside'
        )
          return false
        for (
          let ancestor: Element | null = element;
          ancestor && ancestor !== root;
          ancestor = ancestor.parentElement
        ) {
          const style = readStyle(ancestor)
          if (
            style.position !== 'relative' ||
            !['hidden', 'clip'].includes(style.overflowX) ||
            !['hidden', 'clip'].includes(style.overflowY)
          )
            continue
          const bounded = readBoundedPaintRect(ancestor)
          if (
            bounded &&
            sceneSamplingRelation(bounded, 'viewport', frame, sourceRegions) === 'outside'
          ) {
            liveGeometry = true
            return true
          }
        }
        return false
      }
      const warmMargin = Math.max(frame.width, frame.height) * 1.5
      const warmSourceRegions = sourceRegions?.map((region) => ({
        x: region.x - warmMargin,
        y: region.y - warmMargin,
        width: region.width + warmMargin * 2,
        height: region.height + warmMargin * 2,
      }))
      // The GPU culling regions are viewport-relative; scrolling must rebuild
      // them even when no sticky or backdrop elements are present.
      if (relevance.hasBackdrop || sourceRegions) liveGeometry = true

      const text = (node: Text, parent: HTMLElement, geometry: Geometry) => {
        if (!node.data.trim()) return
        const range = document.createRange()
        range.selectNodeContents(node)
        const bounds = range.getBoundingClientRect()
        if (!bounds.width || !bounds.height) return
        const style = readStyle(parent)
        if (style.visibility !== 'visible') return
        const { width, height } = logicalSize(bounds, geometry)
        const ratio = rasterRatio(width, height, frame.pixelRatio)
        const key = [
          node.data,
          width.toFixed(3),
          height.toFixed(3),
          ratio,
          style.font,
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.fontStyle,
          style.letterSpacing,
          style.lineHeight,
          style.textTransform,
          style.textDecorationLine,
          style.color,
          parent.clientWidth,
        ].join('|')
        const bitmap = paintCached(
          textCache,
          node,
          key,
          () => paintText(node, bounds, style, ratio, geometry.scaleX, geometry.scaleY),
          issues
        )
        items.push({
          kind: 'sprite',
          ...base(toRect(bounds, geometry.space, frame), geometry),
          bitmap,
        })
      }

      const walk = (element: Element, inherited: Geometry) => {
        if (stacking.defer(element, () => walk(element, inherited))) return
        if (
          omitted.has(element.tagName) ||
          element.hasAttribute('data-liquid-glass-scene-canvas') ||
          element.classList.contains('liquid-glass-scene__canvas')
        )
          return
        if (element !== root && element.hasAttribute('data-liquid-glass-scene')) {
          issues.add('Nested LiquidGlassScene wrappers require native HTML rendering')
          return
        }
        if (!(element instanceof HTMLElement) && !(element instanceof SVGSVGElement)) return
        const style = readStyle(element)
        if (style.display === 'none' || element.hasAttribute('hidden')) return
        // A zero-area clip suppresses the element and all of its descendants.
        // This common screen-reader-only pattern still remains in the native DOM.
        if (/^inset\(50%\)$/.test(style.clipPath) || isEmptyLegacyClip(style)) return
        const bounds = readRect(element)
        if (
          warmSourceRegions &&
          style.position === 'relative' &&
          ['hidden', 'clip'].includes(style.overflowX) &&
          ['hidden', 'clip'].includes(style.overflowY) &&
          sceneSamplingRelation(
            toRect(bounds, 'viewport', frame),
            'viewport',
            frame,
            warmSourceRegions
          ) === 'outside'
        ) {
          const bounded = readBoundedPaintRect(element)
          // Keep nearby subtrees warm. A distant subtree can be omitted only
          // when its entire paint is clipped away from every source region.
          if (
            bounded &&
            sceneSamplingRelation(bounded, 'viewport', frame, warmSourceRegions) === 'outside'
          )
            return
        }
        const filter = readFilter(style.filter)
        const ownOpacity = Number.parseFloat(style.opacity) || 0
        const geometry: Geometry = {
          ...inherited,
          opacity: inherited.opacity * ownOpacity,
          brightness: inherited.brightness * (filter.kind === 'brightness' ? filter.factor : 1),
          filtered: inherited.filtered || filter.kind === 'brightness',
        }
        if (style.position === 'fixed' && !inherited.transformed) geometry.space = 'viewport'
        if (style.position === 'sticky') liveGeometry = true
        // A CSS filter creates a containing block for fixed descendants, even at brightness(1).
        if (filter.kind === 'brightness' || filter.kind === 'identity') geometry.transformed = true
        if (style.translate && style.translate !== 'none') geometry.transformed = true
        if (style.transform !== 'none') {
          geometry.transformed = true
          const matrix = new DOMMatrixReadOnly(style.transform)
          if (
            !matrix.is2D ||
            Math.abs(matrix.b) > 0.00001 ||
            Math.abs(matrix.c) > 0.00001 ||
            matrix.a <= 0 ||
            matrix.d <= 0
          )
            issues.add(
              'Rotated, skewed, mirrored or perspective transforms require native HTML rendering'
            )
          else {
            geometry.scaleX *= matrix.a
            geometry.scaleY *= matrix.d
          }
        }
        if (geometry.opacity <= 0) return
        const groupStart = items.length
        const targetStart = targets.length
        const shadowStart = shadowPaintCount
        let subtreeMask: { bitmap: HTMLCanvasElement; rect: SceneRect; space: Space } | undefined
        try {
          const glass = element instanceof HTMLElement ? glasses.get(element) : undefined
          const rect = toRect(bounds, geometry.space, frame)
          const size = logicalSize(bounds, geometry)
          const ratio = rasterRatio(size.width, size.height, frame.pixelRatio)
          let backdrop:
            | {
                bitmap: HTMLCanvasElement
                sigma: number
                radius: number
                filterSaturation: number
                filterBrightness: number
              }
            | undefined
          if (!glass) {
            const elementIssues = new Set<string>()
            inspectUnsupported(element, style, elementIssues, filter)
            const relation = sceneSamplingRelation(
              toRect(bounds, geometry.space, frame),
              geometry.space,
              frame,
              sourceRegions
            )
            const outside = sourceRegions && relation === 'outside'
            const maskOrClip = elementIssues.has(maskError)
            const boundedBackdrop =
              elementIssues.has(filterError) &&
              (filter.kind === 'none' || filter.kind === 'identity') &&
              hasBackdropFilter(style)
            const backdropFilter = parseBackdropFilter(backdropFilterValue(style))
            const corner = backdropRadius(style, size.width, size.height)
            const plainBackdrop =
              !maskOrClip &&
              (!style.getPropertyValue('-webkit-mask-image') ||
                style.getPropertyValue('-webkit-mask-image') === 'none') &&
              (!style.getPropertyValue('mask-border-source') ||
                style.getPropertyValue('mask-border-source') === 'none') &&
              (!style.getPropertyValue('-webkit-mask-box-image-source') ||
                style.getPropertyValue('-webkit-mask-box-image-source') === 'none')
            if (
              !outside &&
              boundedBackdrop &&
              backdropFilter &&
              element instanceof HTMLElement &&
              inherited.opacity === 1 &&
              geometry.scaleX === 1 &&
              geometry.scaleY === 1 &&
              (!style.clipPath || style.clipPath === 'none') &&
              !hasBackdropRootBetween(element, root, readStyle) &&
              corner !== null &&
              (plainBackdrop ||
                (maskOrClip &&
                  corner === 0 &&
                  boundedLeafEffects(element, style) &&
                  !hasBoxPaint(style, readColor)))
            ) {
              const properties = [
                'mask-image',
                '-webkit-mask-image',
                'mask-mode',
                'mask-position',
                '-webkit-mask-position',
                'mask-size',
                '-webkit-mask-size',
                'mask-repeat',
                '-webkit-mask-repeat',
                'mask-origin',
                '-webkit-mask-origin',
                'mask-clip',
                '-webkit-mask-clip',
                'mask-composite',
                '-webkit-mask-composite',
                'mask-border-source',
                '-webkit-mask-box-image-source',
              ]
              const key = [
                size.width,
                size.height,
                ratio,
                ...properties.map((name) => style.getPropertyValue(name)),
              ].join('|')
              const cached = backdropMaskCache.get(element)
              if (plainBackdrop && !opaqueMask) {
                const canvas = document.createElement('canvas')
                canvas.width = canvas.height = 1
                const context = canvas.getContext('2d')
                if (context) {
                  context.fillStyle = '#fff'
                  context.fillRect(0, 0, 1, 1)
                  opaqueMask = canvas
                }
              }
              const bitmap = plainBackdrop
                ? opaqueMask
                : cached?.key === key
                  ? cached.bitmap
                  : paintBackdropMask(style, size.width, size.height, ratio)
              if (bitmap) {
                if (!plainBackdrop && cached?.key !== key)
                  backdropMaskCache.set(element, { key, bitmap })
                backdrop = {
                  bitmap,
                  sigma: backdropFilter.sigma,
                  radius: corner,
                  filterSaturation: backdropFilter.saturation,
                  filterBrightness: backdropFilter.brightness,
                }
                elementIssues.delete(filterError)
                elementIssues.delete(maskError)
                liveGeometry = true
              }
            }
            // Backdrop-filter writes only inside the element's border box. Its
            // descendants still compile normally, so only defer this one effect.
            if (outside && boundedBackdrop) {
              elementIssues.delete(filterError)
              samplingWatches.push({ element, relation })
            }
            const onlyBoundedEffects =
              elementIssues.size > 0 &&
              Array.from(elementIssues).every((issue) => issue === maskError)
            if (
              outside &&
              maskOrClip &&
              onlyBoundedEffects &&
              element instanceof HTMLElement &&
              (boundedLeafEffects(element, style) ||
                boundedMaskedSubtree(element, style, readStyle))
            ) {
              if (!boundedBackdrop) samplingWatches.push({ element, relation })
              return
            }
            if (
              !outside &&
              onlyBoundedEffects &&
              maskOrClip &&
              element instanceof HTMLElement &&
              inherited.opacity === 1 &&
              geometry.scaleX === 1 &&
              geometry.scaleY === 1 &&
              boundedMaskedSubtree(element, style, readStyle)
            ) {
              const properties = [
                'mask-image',
                '-webkit-mask-image',
                'mask-mode',
                'mask-position',
                '-webkit-mask-position',
                'mask-size',
                '-webkit-mask-size',
                'mask-repeat',
                '-webkit-mask-repeat',
                'mask-origin',
                '-webkit-mask-origin',
                'mask-clip',
                '-webkit-mask-clip',
                'mask-composite',
                '-webkit-mask-composite',
                'mask-border-source',
                '-webkit-mask-box-image-source',
              ]
              const key = [
                size.width,
                size.height,
                ratio,
                style.maskImage,
                ...properties.map((name) => style.getPropertyValue(name)),
              ].join('|')
              const previous = subtreeMaskCache.get(element)
              const bitmap =
                previous?.key === key
                  ? previous.bitmap
                  : paintSubtreeMask(style, size.width, size.height, ratio)
              if (bitmap) {
                if (previous?.key !== key) subtreeMaskCache.set(element, { key, bitmap })
                subtreeMask = { bitmap, rect, space: geometry.space }
                elementIssues.delete(maskError)
                liveGeometry = true
              }
            }
            elementIssues.forEach((issue) => issues.add(issue))
          } else if (filter.kind === 'unsupported' || geometry.brightness !== 1)
            issues.add(filterError)
          // Group opacity can make separately painted overlapping items differ from native CSS.
          if (geometry.filtered && geometry.opacity < 1) issues.add(filterError)
          if (!stacking.isHoisted(element))
            inspectStackingOrder(
              element,
              style,
              root,
              issues,
              readRect,
              readStyle,
              hasOverlappingDescendant,
              readOrderedChildren,
              () => outsideClippedStacking(element),
              () => {
                liveGeometry = true
              }
            )
          const visible = style.visibility === 'visible' && bounds.width > 0 && bounds.height > 0
          let shadows: BoxShadowPaint = { status: 'none' }
          if (visible && style.boxShadow && style.boxShadow !== 'none') {
            const key = [
              size.width,
              size.height,
              ratio,
              style.boxShadow,
              style.color,
              style.borderTopWidth,
              style.borderRightWidth,
              style.borderBottomWidth,
              style.borderLeftWidth,
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomRightRadius,
              style.borderBottomLeftRadius,
            ].join('|')
            const cached = shadowCache.get(element)
            shadows =
              cached?.key === key
                ? cached.paint
                : paintBoxShadows(style, size.width, size.height, ratio)
            if (cached?.key !== key) shadowCache.set(element, { key, paint: shadows })
            if (shadows.status === 'unsupported') issues.add(`CSS box shadow: ${shadows.reason}`)
            if (shadows.status === 'ready') shadowPaintCount += 1
          }
          const appendShadow = (sprite: BoxShadowSprite | undefined) => {
            if (!sprite) return
            items.push({
              kind: 'sprite',
              ...base(
                {
                  x: rect.x + sprite.offsetX * geometry.scaleX,
                  y: rect.y + sprite.offsetY * geometry.scaleY,
                  width: sprite.width * geometry.scaleX,
                  height: sprite.height * geometry.scaleY,
                },
                geometry
              ),
              bitmap: sprite.bitmap,
            })
          }
          if (backdrop && visible) {
            items.push({ kind: 'backdrop', ...base(rect, geometry), ...backdrop })
          }
          const separateInset = Boolean(backdrop && shadows.status === 'ready' && shadows.inset)
          let borderBitmap: HTMLCanvasElement | undefined
          if (shadows.status === 'ready') {
            if (backdrop && shadows.inset && !separateInset)
              issues.add('Inset shadows on backdrop-filter elements require native HTML rendering')
            appendShadow(shadows.outer)
          }
          let radius =
            length(
              style.borderTopLeftRadius.split(/\s+/)[0] ?? '0',
              Math.min(size.width, size.height)
            ) * Math.min(geometry.scaleX, geometry.scaleY)
          if (visible && glass) {
            const glassColor = glass.color.startsWith('var(')
              ? style.getPropertyValue('--glass-color').trim() || style.color
              : glass.color === 'currentColor'
                ? style.color
                : glass.color
            const tint = readColor(glassColor)
            const studio = glass.studio
              ? {
                  ...glass.studio,
                  ...(glass.legacyTint
                    ? {
                        tint: {
                          r: tint[0] * 255,
                          g: tint[1] * 255,
                          b: tint[2] * 255,
                          a: tint[3] * glass.opacity,
                        },
                      }
                    : {}),
                  ...(glass.legacyRadius
                    ? {
                        shapeRadius: Math.min(
                          100,
                          Math.max(
                            0,
                            (glass.radius / Math.max(1, Math.min(size.width, size.height) * 0.5)) *
                              100
                          )
                        ),
                      }
                    : {}),
                }
              : undefined
            if (studio)
              radius = (Math.min(rect.width, rect.height) * 0.5 * studio.shapeRadius) / 100
            let map: Extract<SceneItem, { kind: 'glass' }>['map']
            if (glass.map && !studio) {
              // Keep the exact SVG optics shared with standalone LiquidGlass. Scroll
              // and channel selection do not change the immutable map's pixels.
              const mapWidth = Number(size.width.toFixed(3))
              const mapHeight = Number(size.height.toFixed(3))
              const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(createDisplacementMapSvg(mapWidth, mapHeight, glass.map))}`
              const mapRatio = rasterRatio(mapWidth, mapHeight, Math.min(frame.pixelRatio, 1))
              const key = `${mapRatio}|${source}`
              usedMapKeys.add(key)
              const asset = assets.get(source)
              if (asset.status !== 'ready') {
                issues.add(
                  asset.status === 'loading'
                    ? 'LiquidGlass displacement map is loading'
                    : 'LiquidGlass displacement map could not be rendered'
                )
              } else {
                let bitmap = mapBitmaps.get(key)
                if (!bitmap) {
                  bitmap = document.createElement('canvas')
                  bitmap.width = Math.max(1, Math.ceil(mapWidth * mapRatio))
                  bitmap.height = Math.max(1, Math.ceil(mapHeight * mapRatio))
                  const context = bitmap.getContext('2d')
                  if (!context) throw new Error('Displacement map canvas unavailable')
                  context.drawImage(asset.image, 0, 0, bitmap.width, bitmap.height)
                  mapBitmaps.set(key, bitmap)
                }
                map = {
                  bitmap,
                  xChannel: channelIndexes[glass.map.xChannel],
                  yChannel: channelIndexes[glass.map.yChannel],
                }
              }
            }
            items.push({
              kind: 'glass',
              ...base(rect, geometry),
              radius: studio ? radius : glass.radius * Math.min(geometry.scaleX, geometry.scaleY),
              displacement: glass.displacement,
              blur: glass.blur,
              saturation: glass.saturation,
              tint: [tint[0], tint[1], tint[2], tint[3] * glass.opacity],
              ...(glass.thickness !== undefined ? { thickness: glass.thickness } : {}),
              ...(glass.magnification !== undefined ? { magnification: glass.magnification } : {}),
              ...(map ? { map } : {}),
              ...(studio ? { studio } : {}),
            })
          } else if (visible && hasBoxPaint(style, readColor)) {
            const backgroundImages = new Map<string, HTMLImageElement>()
            let backgroundsReady = true
            for (const layer of splitCss(style.backgroundImage)) {
              const source = backgroundUrl(layer)
              if (!source) continue
              const asset = assets.get(source)
              if (asset.status === 'ready') backgroundImages.set(source, asset.image)
              else {
                backgroundsReady = false
                issues.add(
                  asset.status === 'loading'
                    ? 'Background image is loading'
                    : 'Background image could not be read; check its URL and CORS permission'
                )
              }
            }
            if (backgroundsReady) {
              const boxIssues = new Set<string>()
              const relation = sceneSamplingRelation(rect, geometry.space, frame, sourceRegions)
              // Integer raster scales avoid resizing a fractional native SVG
              // bitmap. Unsupported geometry stays on the existing fallback.
              const nativeRatio = frame.pixelRatio > 1.5 ? 2 : 1
              const nativeBorder =
                element instanceof HTMLElement && !backdrop && !separateInset
                  ? createNativeBorderSource(style, size.width, size.height, nativeRatio)
                  : null
              let nativeBitmap: HTMLCanvasElement | null = null
              let nativeLoading = false
              if (nativeBorder) {
                if (relation === 'outside') {
                  const warmRelation = sceneSamplingRelation(
                    rect,
                    geometry.space,
                    frame,
                    warmSourceRegions
                  )
                  if (warmRelation !== 'outside')
                    assets.prime(
                      nativeBorder.source,
                      nativeBorder.sourceWidth,
                      nativeBorder.sourceHeight
                    )
                } else {
                  const asset = assets.get(nativeBorder.source)
                  nativeLoading = asset.status === 'loading'
                  if (asset.status === 'ready') {
                    const cached = nativeBorderCache.get(element)
                    const nativeKey = `${nativeBorder.source}|${nativeBorder.ratio}`
                    if (cached?.key === nativeKey) nativeBitmap = cached.bitmap
                    else {
                      nativeBitmap = paintNativeBorder(asset.image, nativeBorder)
                      nativeBorderCache.set(element, {
                        key: nativeKey,
                        bitmap: nativeBitmap,
                      })
                    }
                  }
                }
              }
              const key = [
                size.width.toFixed(3),
                size.height.toFixed(3),
                ratio,
                style.backgroundColor,
                style.backgroundImage,
                style.backgroundSize,
                style.backgroundPosition,
                style.backgroundRepeat,
                style.borderWidth,
                style.borderStyle,
                style.borderColor,
                style.borderRadius,
              ].join('|')
              const bitmap =
                nativeBitmap ??
                paintCached(
                  boxCache,
                  element,
                  `${key}|${separateInset ? 'background' : 'all'}`,
                  (paintIssues) =>
                    paintBox(
                      style,
                      size.width,
                      size.height,
                      ratio,
                      paintIssues,
                      backgroundImages,
                      separateInset ? 'background' : 'all'
                    ),
                  boxIssues
                )
              items.push({ kind: 'sprite', ...base(rect, geometry), bitmap })
              if (separateInset) {
                borderBitmap = paintCached(
                  borderCache,
                  element,
                  `${key}|border`,
                  (paintIssues) =>
                    paintBox(
                      style,
                      size.width,
                      size.height,
                      ratio,
                      paintIssues,
                      backgroundImages,
                      'border'
                    ),
                  boxIssues
                )
              }
              // Border paint is confined to the border box. Retain unsupported
              // diagnostics when that box can reach a lens or backdrop blur.
              const roundedBorderIssue = 'Unequal rounded borders require native HTML rendering'
              if (nativeLoading && boxIssues.has(roundedBorderIssue)) {
                boxIssues.delete(roundedBorderIssue)
                issues.add('SVG is loading')
              }
              if (boxIssues.has(roundedBorderIssue) && relation === 'outside') {
                boxIssues.delete(roundedBorderIssue)
                samplingWatches.push({ element, relation })
              }
              boxIssues.forEach((issue) => issues.add(issue))
            }
          }
          if (shadows.status === 'ready') appendShadow(shadows.inset)
          if (borderBitmap)
            items.push({ kind: 'sprite', ...base(rect, geometry), bitmap: borderBitmap })
          if (
            visible &&
            element instanceof HTMLElement &&
            element.matches('a[href],button,input,select,textarea,[role="button"],[tabindex]') &&
            !element.matches(':disabled')
          )
            targets.push({
              element,
              rect,
              space: geometry.space,
              ...(geometry.brightness !== 1 ? { brightness: geometry.brightness } : {}),
            })

          let childrenGeometry = geometry
          const clipsX = style.overflowX !== 'visible' && style.overflowX !== 'unset'
          const clipsY = style.overflowY !== 'visible' && style.overflowY !== 'unset'
          if (clipsX || clipsY) {
            // Window scrolling translates this clip and its content together. Only
            // an actual nested scroll changes their relationship; useScene listens
            // for that event. Overflow alone must not recompile the entire page.
            const borderLeft = (Number.parseFloat(style.borderLeftWidth) || 0) * geometry.scaleX
            const borderTop = (Number.parseFloat(style.borderTopWidth) || 0) * geometry.scaleY
            const borderRight = (Number.parseFloat(style.borderRightWidth) || 0) * geometry.scaleX
            const borderBottom = (Number.parseFloat(style.borderBottomWidth) || 0) * geometry.scaleY
            const clipRect = {
              x: rect.x + borderLeft,
              y: rect.y + borderTop,
              width: Math.max(0, rect.width - borderLeft - borderRight),
              height: Math.max(0, rect.height - borderTop - borderBottom),
            }
            if (!clipsX) {
              clipRect.x = -1_000_000
              clipRect.width = 2_000_000
            }
            if (!clipsY) {
              clipRect.y = -1_000_000
              clipRect.height = 2_000_000
            }
            childrenGeometry = {
              ...geometry,
              clips: appendClip(
                geometry.clips,
                {
                  rect: clipRect,
                  space: geometry.space,
                  owner: element,
                  radius:
                    clipsX && clipsY ? Math.max(0, radius - Math.max(borderLeft, borderTop)) : 0,
                  ...(glass?.studio ? { roundness: glass.studio.shapeRoundness } : {}),
                },
                issues
              ),
            }
          }
          if (visible && element instanceof HTMLImageElement) {
            const source = element.currentSrc || element.src
            const relation = sceneSamplingRelation(rect, geometry.space, frame, sourceRegions)
            if (sourceRegions && relation === 'outside') {
              // Keep the asynchronous asset warm so it can be drawn as soon as
              // it approaches a pane, without eagerly loading an entire page.
              const near =
                sceneSamplingRelation(rect, geometry.space, frame, warmSourceRegions) !== 'outside'
              if (
                near &&
                source &&
                (rejectedDomImages.get(element) === source || !canReuseLoadedImage(element, source))
              )
                assets.get(source)
              samplingWatches.push({ element, relation })
              return
            }
            if (!source) return
            const reportUnavailable = (status: 'loading' | 'error') => {
              const relation = sceneSamplingRelation(rect, geometry.space, frame, sourceRegions)
              if (sourceRegions) samplingWatches.push({ element, relation })
              if (relation === 'outside') {
                return
              }
              issues.add(
                status === 'loading'
                  ? 'Image is loading'
                  : 'Image could not be read; check its URL and CORS permission'
              )
            }
            // With no decoded dimensions, the DOM image has no image pixels to
            // mirror yet. Keep its box paint and wait for the native load event
            // before painting, even if a speculative copy finishes first.
            if (
              !element.complete &&
              element.naturalWidth === 0 &&
              rejectedDomImages.get(element) !== source
            ) {
              const asset = assets.get(source)
              if (asset.status === 'error') reportUnavailable('error')
              else if (sourceRegions) samplingWatches.push({ element, relation })
              return
            }
            // A loaded same-origin DOM image is already a valid CanvasImageSource.
            // Reusing it avoids a second asynchronous load when a lazy image first
            // intersects the viewport. paintImage still performs the taint check,
            // so a no-CORS cross-origin image continues to fail closed.
            const reuseDomImage =
              rejectedDomImages.get(element) !== source && canReuseLoadedImage(element, source)
            let asset = reuseDomImage
              ? { image: element, status: 'ready' as const }
              : assets.get(source)
            if (asset.status !== 'ready') {
              reportUnavailable(asset.status)
              return
            }
            const key = (variant: 'dom' | 'anonymous') =>
              [
                source,
                variant,
                size.width.toFixed(3),
                size.height.toFixed(3),
                ratio,
                style.objectFit,
                style.objectPosition,
                style.borderRadius,
              ].join('|')
            let variant: 'dom' | 'anonymous' = reuseDomImage ? 'dom' : 'anonymous'
            let bitmap: HTMLCanvasElement
            let previous = imageCache.get(element)
            if (previous?.key === key(variant)) {
              previous.issues.forEach((issue) => issues.add(issue))
              bitmap = previous.bitmap
            } else {
              let paintIssues = new Set<string>()
              bitmap = paintImage(asset.image, size.width, size.height, ratio, style, paintIssues)
              if (reuseDomImage && paintIssues.has('Cross-origin image requires CORS permission')) {
                // A same-origin URL can redirect to a no-CORS CDN. The DOM image
                // then taints canvas even though its requested URL looked reusable.
                // Retry through a fresh anonymous request, and never cache the
                // tainted bitmap or its issue under the anonymous variant.
                rejectedDomImages.set(element, source)
                asset = assets.get(source)
                if (asset.status !== 'ready') {
                  reportUnavailable(asset.status)
                  return
                }
                variant = 'anonymous'
                previous = imageCache.get(element)
                if (previous?.key === key(variant)) {
                  previous.issues.forEach((issue) => issues.add(issue))
                  bitmap = previous.bitmap
                } else {
                  paintIssues = new Set<string>()
                  bitmap = paintImage(
                    asset.image,
                    size.width,
                    size.height,
                    ratio,
                    style,
                    paintIssues
                  )
                  const result = {
                    key: key(variant),
                    bitmap,
                    issues: Array.from(paintIssues),
                  }
                  imageCache.set(element, result)
                  result.issues.forEach((issue) => issues.add(issue))
                }
              } else {
                const result = { key: key(variant), bitmap, issues: Array.from(paintIssues) }
                imageCache.set(element, result)
                result.issues.forEach((issue) => issues.add(issue))
              }
            }
            // Keep a separate decoded image warm across route unmounts. The DOM
            // element itself can be reused by React with a different src; only
            // prime after the rendered bitmap passed its origin-clean check.
            if (variant === 'dom' && imageCache.get(element)?.issues.length === 0)
              assets.prime(source, element.naturalWidth, element.naturalHeight)
            items.push({ kind: 'sprite', ...base(rect, geometry), bitmap })
            return
          }
          if (visible && element instanceof SVGSVGElement) {
            let svgSize = { ...size, ratio }
            if (canStretchSvg(element, style)) {
              const cachedSize = svgSizes.get(element)
              const dpr = window.devicePixelRatio || 1
              const width = Number(size.width.toFixed(3))
              if (
                !cachedSize ||
                cachedSize.layoutWidth !== width ||
                cachedSize.dpr !== dpr ||
                size.height > cachedSize.layoutHeight * 1.5
              ) {
                // Bound the SVG image's intrinsic viewport as well as its raster.
                const scale = rasterRatio(width, size.height, 1)
                svgSize = {
                  width: width * scale,
                  height: size.height * scale,
                  ratio: rasterRatio(width * scale, size.height * scale, frame.pixelRatio),
                }
                svgSizes.set(element, {
                  ...svgSize,
                  layoutWidth: width,
                  layoutHeight: size.height,
                  dpr,
                })
              } else svgSize = cachedSize
            } else svgSizes.delete(element)
            // Motion can leave sub-millipixel noise in getBoundingClientRect even
            // after the inherited transform is divided out. Embedding that noise
            // in the SVG data URL creates a different Image on every frame.
            svgSize = {
              ...svgSize,
              width: stableSvgRasterDimension(svgSize.width),
              height: stableSvgRasterDimension(svgSize.height),
            }
            if (
              svgSize.width > 4096 ||
              svgSize.height > 4096 ||
              svgSize.width * svgSize.height > 2_000_001
            ) {
              issues.add('SVG viewport exceeds the safe raster size')
              return
            }
            const source = serializeSvg(element, svgSize.width, svgSize.height, issues)
            const icon = paintLucide(element, svgSize.width, svgSize.height, svgSize.ratio)
            if (icon.status === 'ready') {
              items.push({ kind: 'sprite', ...base(rect, geometry), bitmap: icon.bitmap })
              return
            }
            const asset = assets.get(source)
            if (asset.status !== 'ready') {
              const clipped =
                ['hidden', 'clip'].includes(style.overflowX) &&
                ['hidden', 'clip'].includes(style.overflowY)
              const boundedEffects =
                (!style.filter || style.filter === 'none') &&
                !hasBackdropFilter(style) &&
                (!style.outlineStyle || style.outlineStyle === 'none') &&
                shadows.status !== 'unsupported'
              const relation = sceneSamplingRelation(rect, geometry.space, frame, sourceRegions)
              if (sourceRegions && clipped && boundedEffects)
                samplingWatches.push({ element, relation })
              if (clipped && boundedEffects && relation === 'outside') return
              issues.add(
                asset.status === 'loading' ? 'SVG is loading' : 'SVG could not be rendered'
              )
              return
            }
            const key = [
              source,
              svgSize.ratio,
              style.padding,
              style.borderWidth,
              style.borderRadius,
              style.objectFit,
              style.objectPosition,
            ].join('|')
            const bitmap = paintCached(
              imageCache,
              element,
              key,
              (paintIssues) =>
                paintImage(
                  asset.image,
                  svgSize.width,
                  svgSize.height,
                  svgSize.ratio,
                  style,
                  paintIssues
                ),
              issues
            )
            items.push({ kind: 'sprite', ...base(rect, geometry), bitmap })
            return
          }
          if (
            visible &&
            (element instanceof HTMLVideoElement || element instanceof HTMLCanvasElement)
          ) {
            const relation = sceneSamplingRelation(rect, geometry.space, frame, sourceRegions)
            if (sourceRegions && relation === 'outside') {
              samplingWatches.push({ element, relation })
              return
            }
            const fit = style.objectFit
            if (fit !== 'fill' && fit !== 'contain' && fit !== 'cover')
              issues.add(`Unsupported media object-fit: ${fit}`)
            const position = style.objectPosition.split(/\s+/)
            const percentages = position.every((value) => value.endsWith('%'))
            if (!percentages)
              issues.add('Video and canvas object-position currently require percentage values')
            const left =
              (Number.parseFloat(style.paddingLeft) || 0) +
              (Number.parseFloat(style.borderLeftWidth) || 0)
            const top =
              (Number.parseFloat(style.paddingTop) || 0) +
              (Number.parseFloat(style.borderTopWidth) || 0)
            const right =
              (Number.parseFloat(style.paddingRight) || 0) +
              (Number.parseFloat(style.borderRightWidth) || 0)
            const bottom =
              (Number.parseFloat(style.paddingBottom) || 0) +
              (Number.parseFloat(style.borderBottomWidth) || 0)
            const mediaRect = {
              x: rect.x + left * geometry.scaleX,
              y: rect.y + top * geometry.scaleY,
              width: Math.max(0, rect.width - (left + right) * geometry.scaleX),
              height: Math.max(0, rect.height - (top + bottom) * geometry.scaleY),
            }
            media.push(element)
            items.push({
              kind: 'media',
              ...base(mediaRect, geometry),
              source: element,
              fit: fit === 'cover' || fit === 'contain' ? fit : 'fill',
              position: [
                (Number.parseFloat(position[0] ?? '50') || 0) / 100,
                (Number.parseFloat(position[1] ?? '50') || 0) / 100,
              ],
              radius: Math.max(0, radius - Math.max(left, top)),
            })
            return
          }
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            if (!visible) return
            if (element instanceof HTMLInputElement && element.type === 'password') {
              issues.add('Password fields retain native HTML rendering')
              return
            }
            if (document.activeElement === element) {
              issues.add('Active text editing requires native HTML rendering')
              return
            }
            if (element.scrollTop || element.scrollLeft) {
              issues.add('Internally scrolled form fields retain native HTML rendering')
              return
            }
            if (
              element instanceof HTMLInputElement &&
              !editableInputTypes.has(element.type) &&
              !['button', 'submit', 'reset'].includes(element.type)
            ) {
              issues.add(`Native ${element.type} inputs require HTML rendering`)
              return
            }
            if (
              element instanceof HTMLInputElement &&
              element.type === 'number' &&
              style.appearance !== 'none'
            ) {
              issues.add('Native number-input controls require HTML rendering')
              return
            }
            const value = element.value || element.placeholder
            const contentStyle = element.value ? style : readStyle(element, '::placeholder')
            const insetX =
              (Number.parseFloat(style.borderLeftWidth) || 0) +
              (Number.parseFloat(style.paddingLeft) || 0)
            const insetY =
              (Number.parseFloat(style.borderTopWidth) || 0) +
              (Number.parseFloat(style.paddingTop) || 0)
            const width = Math.max(
              0,
              size.width -
                insetX -
                (Number.parseFloat(style.borderRightWidth) || 0) -
                (Number.parseFloat(style.paddingRight) || 0)
            )
            const height = Math.max(
              0,
              size.height -
                insetY -
                (Number.parseFloat(style.borderBottomWidth) || 0) -
                (Number.parseFloat(style.paddingBottom) || 0)
            )
            if (width && height && value) {
              const rendered =
                element instanceof HTMLInputElement && element.type === 'password'
                  ? '•'.repeat(value.length)
                  : value
              const key = [
                rendered,
                width,
                height,
                ratio,
                contentStyle.font,
                contentStyle.color,
                style.textAlign,
                element.scrollTop,
                element.scrollLeft,
              ].join('|')
              const bitmap = paintCached(
                imageCache,
                element,
                key,
                () =>
                  paintControlText(
                    rendered,
                    width,
                    height,
                    ratio,
                    contentStyle,
                    element instanceof HTMLTextAreaElement
                  ),
                issues
              )
              items.push({
                kind: 'sprite',
                ...base(
                  {
                    x: rect.x + insetX * geometry.scaleX,
                    y: rect.y + insetY * geometry.scaleY,
                    width: width * geometry.scaleX,
                    height: height * geometry.scaleY,
                  },
                  geometry
                ),
                bitmap,
              })
            }
            return
          }
          if (element instanceof HTMLSelectElement) {
            if (visible) issues.add('Native select controls require HTML rendering')
            return
          }
          if (element instanceof HTMLElement) {
            type ChildPaint =
              | { kind: 'node'; node: Node; z: number }
              | {
                  kind: 'pseudo'
                  bitmap: HTMLCanvasElement
                  rect: SceneRect
                  opacity: number
                  z: number
                }
            const pseudo = (name: PseudoName): ChildPaint | undefined => {
              const measured = measurePseudoBox(element, name)
              if (measured.status === 'none') return undefined
              if (measured.status === 'unsupported') {
                issues.add(measured.reason)
                if (measured.detail) issues.add(measured.detail)
                return undefined
              }
              if (measured.zIndex !== 0 && !createsStackingContext(element, style, readStyle)) {
                issues.add('Escaping pseudo-element stacking order requires native HTML rendering')
                return undefined
              }
              const pseudoRatio = rasterRatio(
                measured.rect.width,
                measured.rect.height,
                frame.pixelRatio
              )
              const pseudoStyle = measured.style
              const key = [
                measured.rect.width,
                measured.rect.height,
                measured.localSize.width,
                measured.localSize.height,
                measured.scale.x,
                measured.scale.y,
                pseudoRatio,
                pseudoStyle.backgroundColor,
                pseudoStyle.backgroundImage,
                pseudoStyle.backgroundSize,
                pseudoStyle.backgroundPosition,
                pseudoStyle.backgroundRepeat,
                pseudoStyle.paddingTop,
                pseudoStyle.paddingRight,
                pseudoStyle.paddingBottom,
                pseudoStyle.paddingLeft,
                pseudoStyle.maskImage,
                pseudoStyle.maskClip,
                pseudoStyle.maskOrigin,
                pseudoStyle.maskComposite,
                pseudoStyle.maskSize,
                pseudoStyle.maskRepeat,
                pseudoStyle.maskPosition,
                pseudoStyle.maskMode,
                pseudoStyle.getPropertyValue('-webkit-mask-image'),
                pseudoStyle.getPropertyValue('-webkit-mask-clip'),
                pseudoStyle.getPropertyValue('-webkit-mask-origin'),
                pseudoStyle.getPropertyValue('-webkit-mask-composite'),
                pseudoStyle.getPropertyValue('-webkit-mask-size'),
                pseudoStyle.getPropertyValue('-webkit-mask-repeat'),
                pseudoStyle.getPropertyValue('-webkit-mask-position'),
                pseudoStyle.borderWidth,
                pseudoStyle.borderStyle,
                pseudoStyle.borderColor,
                pseudoStyle.borderRadius,
                pseudoStyle.borderTopWidth,
                pseudoStyle.borderRightWidth,
                pseudoStyle.borderBottomWidth,
                pseudoStyle.borderLeftWidth,
                pseudoStyle.borderTopStyle,
                pseudoStyle.borderRightStyle,
                pseudoStyle.borderBottomStyle,
                pseudoStyle.borderLeftStyle,
                pseudoStyle.borderTopColor,
                pseudoStyle.borderRightColor,
                pseudoStyle.borderBottomColor,
                pseudoStyle.borderLeftColor,
                pseudoStyle.borderTopLeftRadius,
                pseudoStyle.borderTopRightRadius,
                pseudoStyle.borderBottomRightRadius,
                pseudoStyle.borderBottomLeftRadius,
              ].join('|')
              const entry = pseudoCache.get(element) ?? {}
              let cached = entry[name]
              if (cached?.key !== key) {
                const painted = paintPseudoBox(element, name, pseudoRatio)
                if (painted.status !== 'ready') {
                  if (painted.status === 'unsupported') {
                    issues.add(painted.reason)
                    if (painted.detail) issues.add(painted.detail)
                  }
                  return undefined
                }
                cached = { key, bitmap: painted.bitmap, issues: [] }
                entry[name] = cached
                pseudoCache.set(element, entry)
              }
              return {
                kind: 'pseudo',
                bitmap: cached.bitmap,
                rect: {
                  ...measured.rect,
                  x: measured.rect.x + (geometry.space === 'document' ? frame.scrollX : 0),
                  y: measured.rect.y + (geometry.space === 'document' ? frame.scrollY : 0),
                },
                opacity: measured.opacity,
                z: measured.zIndex,
              }
            }
            const z = (node: Node) => {
              if (!(node instanceof Element)) return 0
              const childStyle = readStyle(node)
              return childStyle.position === 'static' &&
                style.display !== 'flex' &&
                style.display !== 'grid'
                ? 0
                : Number.parseInt(childStyle.zIndex, 10) || 0
            }
            const children: ChildPaint[] = []
            const ellipsis =
              style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth
                ? paintEllipsis(element, frame.pixelRatio)
                : { status: 'none' as const }
            if (ellipsis.status === 'unsupported') issues.add(ellipsis.reason)
            const before = pseudo('::before')
            if (before) children.push(before)
            if (ellipsis.status === 'ready') {
              children.push({
                kind: 'pseudo',
                bitmap: ellipsis.bitmap,
                rect: {
                  ...ellipsis.rect,
                  x: ellipsis.rect.x + (geometry.space === 'document' ? frame.scrollX : 0),
                  y: ellipsis.rect.y + (geometry.space === 'document' ? frame.scrollY : 0),
                },
                opacity: 1,
                z: 0,
              })
            } else {
              for (const node of element.childNodes)
                children.push({ kind: 'node', node, z: z(node) })
            }
            const after = pseudo('::after')
            if (after) children.push(after)
            children.sort((a, b) => a.z - b.z)
            for (const child of children) {
              if (child.kind === 'pseudo') {
                items.push({
                  kind: 'sprite',
                  ...base(child.rect, {
                    ...childrenGeometry,
                    opacity: geometry.opacity * child.opacity,
                  }),
                  bitmap: child.bitmap,
                })
              } else if (child.node instanceof Text) text(child.node, element, childrenGeometry)
              else if (child.node instanceof Element) walk(child.node, childrenGeometry)
            }
          }
          stacking.flush(element)
        } finally {
          if (subtreeMask) {
            const paints = items.slice(groupStart)
            const safe =
              paints.every((item) => item.kind === 'sprite' || item.kind === 'solid') &&
              !targets
                .slice(targetStart)
                .some(({ element: target }) => target.matches(':focus-visible'))
            const group = safe
              ? opacityGroups.compose({
                  owner: element,
                  items: paints,
                  inheritedOpacity: 1,
                  groupOpacity: 1,
                  frame,
                  preferGpu: true,
                  preserveFlatOpacities: true,
                })
              : { status: 'unsupported' as const, reason: 'dynamic or nested masked paint' }
            if (group.status === 'ready') {
              const item = group.item
              const child = item.kind === 'sprite' ? { ...item, opacity: 1 } : undefined
              if (child) {
                delete child.clip
                delete child.clips
              }
              items.splice(
                groupStart,
                items.length - groupStart,
                item.kind === 'opacity-group'
                  ? { ...item, mask: subtreeMask }
                  : {
                      ...item,
                      kind: 'opacity-group',
                      items: child ? [child] : [],
                      mask: subtreeMask,
                    }
              )
            } else if (group.status === 'unsupported') issues.add(maskError)
          }
          if (ownOpacity < 1) {
            const nested = inherited.opacity < 1
            const focused = targets
              .slice(targetStart)
              .some(({ element: target }) => target.matches(':focus-visible'))
            const group =
              !nested && !focused
                ? opacityGroups.compose({
                    owner: element,
                    items: items.slice(groupStart),
                    inheritedOpacity: inherited.opacity,
                    groupOpacity: ownOpacity,
                    frame,
                  })
                : {
                    status: 'unsupported' as const,
                    reason: nested ? 'nested opacity' : 'visible focus',
                  }
            if (group.status === 'ready')
              items.splice(groupStart, items.length - groupStart, group.item)
            else if (group.status === 'unsupported') {
              issues.add('CSS group opacity requires native HTML rendering')
              issues.add(`CSS group opacity: ${group.reason}`)
              if (shadowPaintCount > shadowStart)
                issues.add('CSS box shadows with opacity require native HTML rendering')
            }
          }
        }
      }

      walk(root, {
        space: 'document',
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        brightness: 1,
        filtered: false,
        transformed: false,
      })
      const focused = targets.find(({ element }) => element.matches(':focus-visible'))
      if (focused) {
        const { rect, space } = focused
        const edges: SceneRect[] = [
          { x: rect.x - 3, y: rect.y - 3, width: rect.width + 6, height: 2 },
          { x: rect.x - 3, y: rect.y + rect.height + 1, width: rect.width + 6, height: 2 },
          { x: rect.x - 3, y: rect.y - 3, width: 2, height: rect.height + 6 },
          { x: rect.x + rect.width + 1, y: rect.y - 3, width: 2, height: rect.height + 6 },
        ]
        edges.forEach((edge) =>
          items.push({
            kind: 'solid',
            rect: edge,
            space,
            opacity: 1,
            ...(focused.brightness !== undefined ? { brightness: focused.brightness } : {}),
            radius: 1,
            color: [0.55, 0.86, 1, 1],
          })
        )
      }
      assets.end()
      for (const key of mapBitmaps.keys()) {
        if (!usedMapKeys.has(key)) mapBitmaps.delete(key)
      }
      const certifyScrollTranslation = (): boolean => {
        if (
          issues.size ||
          !fixedContainer?.isConnected ||
          fixedContainer === root ||
          !root.contains(fixedContainer) ||
          !glasses.size ||
          [...glasses.keys()].some((pane) => !pane.isConnected || !fixedContainer.contains(pane)) ||
          !validSamplingRegion(samplingRegion) ||
          (samplingRegions !== undefined &&
            (!samplingRegions.length ||
              samplingRegions.some((region) => !validSamplingRegion(region)))) ||
          !sourceRegions?.length ||
          sourceRegions.some((region) => !validSamplingRegion(region)) ||
          (document.fullscreenElement && root.contains(document.fullscreenElement))
        )
          return false
        try {
          if (readStyle(fixedContainer).position !== 'fixed') return false
          // Regional paint culling can omit sticky/fixed nodes. Check the whole
          // DOM using this compile's styles before certifying pure translation.
          for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
            if (
              omitted.has(element.tagName) ||
              element.hasAttribute('data-liquid-glass-scene-canvas') ||
              element.classList.contains('liquid-glass-scene__canvas') ||
              (!(element instanceof HTMLElement) && !(element instanceof SVGSVGElement))
            )
              continue
            if (
              element.shadowRoot ||
              (element !== root && element.hasAttribute('data-liquid-glass-scene')) ||
              element.hasAttribute('popover') ||
              (element.tagName === 'DIALOG' && element.hasAttribute('open'))
            )
              return false
            const baseStyle = readStyle(element)
            if (
              baseStyle.display === 'none' ||
              element.hasAttribute('hidden') ||
              Number.parseFloat(baseStyle.opacity) === 0 ||
              isEmptyLegacyClip(baseStyle) ||
              /^inset\(50%\)$/.test(baseStyle.clipPath)
            )
              continue
            const inFixedBranch = fixedContainer.contains(element)
            for (const pseudo of [undefined, '::before', '::after']) {
              const style = readStyle(element, pseudo)
              if (pseudo && (!style.content || ['none', 'normal'].includes(style.content))) continue
              if (
                style.position === 'sticky' ||
                (style.position === 'fixed' && !inFixedBranch) ||
                (style.containerType && style.containerType !== 'normal') ||
                style.contentVisibility === 'auto' ||
                style.backgroundAttachment
                  .split(',')
                  .some((value) => value.trim() && value.trim() !== 'scroll') ||
                (inFixedBranch &&
                  hasBackdropFilter(style) &&
                  !(element instanceof HTMLElement && glasses.has(element)))
              )
                return false
            }
          }
          return items.every((item) => {
            const paints = item.kind === 'opacity-group' ? item.items : [item]
            if (
              item.kind === 'opacity-group' &&
              (item.items.some((paint) => paint.space !== item.space) ||
                (item.mask && item.mask.space !== item.space))
            )
              return false
            return paints.every((paint) => paint.kind !== 'backdrop' || paint.space === 'document')
          })
        } catch {
          return false
        }
      }
      return {
        scene: {
          background: readColor(background),
          items,
          ...(samplingRegion ? { samplingRegion } : {}),
          ...(samplingRegions ? { samplingRegions } : {}),
          ...(sourceRegions ? { renderRegions: sourceRegions } : {}),
        },
        targets,
        issues: Array.from(issues),
        liveGeometry,
        ...(certifyScrollTranslation() ? { scrollTranslationSafe: true } : {}),
        samplingWatches,
        media,
      }
    },
    dispose() {
      disposed = true
      fonts?.removeEventListener('loadingdone', onFontsChanged)
      fonts?.removeEventListener('loadingerror', onFontsChanged)
      assets.dispose()
      opacityGroups.dispose()
      mapBitmaps.clear()
    },
  }
}

function hasBoxPaint(style: CSSStyleDeclaration, color: (value: string) => readonly number[]) {
  return (
    (color(style.backgroundColor)[3] ?? 0) > 0 ||
    style.backgroundImage !== 'none' ||
    [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].some((value) => Number.parseFloat(value) > 0)
  )
}

function inspectUnsupported(
  element: HTMLElement | SVGSVGElement,
  style: CSSStyleDeclaration,
  issues: Set<string>,
  filter: Filter
) {
  if (
    element instanceof HTMLIFrameElement ||
    element instanceof HTMLObjectElement ||
    element instanceof HTMLEmbedElement
  )
    issues.add('Embedded documents require native HTML rendering')
  if (
    element instanceof HTMLInputElement &&
    editableInputTypes.has(element.type) &&
    document.activeElement === element
  )
    issues.add('Active text editing requires native HTML rendering')
  if (filter.kind === 'unsupported' || hasBackdropFilter(style)) issues.add(filterError)
  if (style.textShadow !== 'none') issues.add('CSS text shadows require native HTML rendering')
  if (style.borderImageSource !== 'none')
    issues.add('CSS border images require native HTML rendering')
  if (style.backgroundBlendMode.split(',').some((value) => value.trim() !== 'normal'))
    issues.add('Background blending requires native HTML rendering')
  if (style.perspective !== 'none') issues.add('CSS perspective requires native HTML rendering')
  if (style.display === 'list-item' && style.listStyleType !== 'none')
    issues.add('Native list markers require HTML rendering')
  if ((style.clipPath && style.clipPath !== 'none') || hasMaskImage(style)) issues.add(maskError)
  if (
    (style.position === 'absolute' || style.position === 'fixed') &&
    style.clip &&
    style.clip !== 'auto'
  )
    issues.add('CSS clip requires native HTML rendering')
  if (style.mixBlendMode !== 'normal') issues.add('CSS blend modes require native HTML rendering')
  if (style.backgroundClip === 'text' || style.backgroundAttachment === 'fixed')
    issues.add('Text-clipped and fixed CSS backgrounds require native HTML rendering')
  if (
    !(element instanceof HTMLElement) ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth)
      issues.add('Ellipsized controls require native HTML rendering')
  }
  if (
    (style.rotate && style.rotate !== 'none') ||
    (style.scale && style.scale !== 'none') ||
    !isSupportedIndividualTranslate(style.translate)
  )
    issues.add(
      'Individual CSS transform properties require native HTML rendering; use transform instead'
    )
  if (element.shadowRoot) issues.add('Shadow DOM content requires native HTML rendering')
  if (style.writingMode !== 'horizontal-tb')
    issues.add('Vertical text requires native HTML rendering')
}

function hasBackdropFilter(style: CSSStyleDeclaration): boolean {
  return Boolean(backdropFilterValue(style))
}

function hasMaskImage(style: CSSStyleDeclaration): boolean {
  const standard = style.maskImage?.trim()
  const prefixed = style.getPropertyValue('-webkit-mask-image').trim()
  return Boolean((standard && standard !== 'none') || (prefixed && prefixed !== 'none'))
}

function backdropFilterValue(style: CSSStyleDeclaration): string {
  const standard = style.backdropFilter?.trim()
  const prefixed = style.getPropertyValue('-webkit-backdrop-filter').trim()
  if (standard && standard !== 'none') {
    if (prefixed && prefixed !== 'none' && prefixed !== standard)
      return 'unsupported backdrop-filter'
    return standard
  }
  return prefixed === 'none' ? '' : prefixed
}

function createsStackingContext(
  element: Element,
  style: CSSStyleDeclaration,
  readStyle: StyleReader = getComputedStyle
): boolean {
  const parentDisplay = element.parentElement ? readStyle(element.parentElement).display : ''
  const positioned = style.position !== 'static'
  const flexOrGridItem = parentDisplay.includes('flex') || parentDisplay.includes('grid')
  return (
    style.isolation === 'isolate' ||
    style.position === 'fixed' ||
    style.position === 'sticky' ||
    ((positioned || flexOrGridItem) && style.zIndex !== 'auto') ||
    Number.parseFloat(style.opacity) < 1 ||
    style.transform !== 'none' ||
    Boolean(style.translate && style.translate !== 'none') ||
    Boolean(style.rotate && style.rotate !== 'none') ||
    Boolean(style.scale && style.scale !== 'none') ||
    style.filter !== 'none' ||
    hasBackdropFilter(style) ||
    style.perspective !== 'none' ||
    style.mixBlendMode !== 'normal' ||
    style.clipPath !== 'none' ||
    hasMaskImage(style) ||
    /(?:^|\s)(?:paint|layout|strict|content)(?:\s|$)/.test(style.contain) ||
    style.willChange
      .split(',')
      .some((value) => ['transform', 'opacity', 'filter', 'perspective'].includes(value.trim()))
  )
}

function inspectStackingOrder(
  element: Element,
  style: CSSStyleDeclaration,
  root: HTMLElement,
  issues: Set<string>,
  readRect: (element: Element) => DOMRect,
  readStyle: StyleReader,
  hasOverlappingDescendant: (
    element: Element,
    target: { left: number; top: number; right: number; bottom: number }
  ) => boolean,
  readOrderedChildren: (element: Element) => { children: Element[]; levels: Map<Element, number> },
  outsideClippedStacking: () => boolean,
  markLiveGeometry: () => void
) {
  const parent = element.parentElement
  if (element === root || !parent || parent === root || style.zIndex === 'auto') return
  const parentStyle = readStyle(parent)
  const parentLayout = parentStyle.display
  if (
    style.position === 'static' &&
    !parentLayout.includes('flex') &&
    !parentLayout.includes('grid')
  )
    return
  const zIndex = Number.parseInt(style.zIndex, 10) || 0
  if (!zIndex || createsStackingContext(parent, parentStyle, readStyle)) return
  // The compiler paints sibling subtrees atomically. A positioned descendant of
  // a non-stacking ancestor participates in a more distant stacking context and
  // may need to interleave with an uncle's paint. Preserve HTML when that order
  // cannot be represented by this traversal instead of silently covering it.
  if (zIndex < 0) {
    issues.add('Escaping negative stacking order requires native HTML rendering')
    return
  }
  const clipped = getBoundedRelativePaintRect(element, root, readStyle)
  if (clipped) markLiveGeometry()
  const raw = readRect(element)
  const bounds = clipped
    ? {
        left: clipped.x,
        top: clipped.y,
        right: clipped.x + clipped.width,
        bottom: clipped.y + clipped.height,
      }
    : raw
  const overlaps = (other: Element) => {
    const candidate = readRect(other)
    return (
      candidate.width > 0 &&
      candidate.height > 0 &&
      bounds.left < candidate.right &&
      bounds.right > candidate.left &&
      bounds.top < candidate.bottom &&
      bounds.bottom > candidate.top
    )
  }
  let branch: Element = parent
  while (branch !== root && branch.parentElement) {
    const container = branch.parentElement
    const containerStyle = readStyle(container)
    const { children: siblings, levels } = readOrderedChildren(container)
    const level = (child: Element) => levels.get(child) ?? 0
    const index = siblings.indexOf(branch)
    for (let i = index + 1; i < siblings.length; i += 1) {
      const sibling = siblings[i]
      if (!sibling || level(sibling) >= zIndex || readStyle(sibling).visibility !== 'visible')
        continue
      if (overlaps(sibling) || hasOverlappingDescendant(sibling, bounds)) {
        if (outsideClippedStacking()) return
        issues.add('Escaping descendant stacking order requires native HTML rendering')
        return
      }
    }
    if (container === root || createsStackingContext(container, containerStyle, readStyle)) return
    branch = container
  }
}

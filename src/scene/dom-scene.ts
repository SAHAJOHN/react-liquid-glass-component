import { createDisplacementMapSvg } from '../displacement-map'
import { roundedClipContainsRect } from './clip-geometry'
import { MAX_SCENE_CLIPS } from './clip-stack'
import { paintLucide } from './paint-lucide'
import { paintEllipsis } from './paint-ellipsis'
import { samplingRelation } from './sampling-boundary'
import type {
  CompiledScene,
  SceneCompiler,
  SceneFrame,
  SceneItem,
  SceneRect,
  SceneTarget,
  SamplingWatch,
} from './types'
import { backgroundUrl, createColorReader, length, paintBox, splitCss } from './paint-box'
import { paintBoxShadows } from './paint-shadow'
import type { BoxShadowPaint, BoxShadowSprite } from './paint-shadow'
import { measurePseudoBox, paintPseudoBox, type PseudoName } from './paint-pseudo'
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

type Space = 'document' | 'viewport'
type Clip = NonNullable<SceneItem['clip']>
interface Geometry {
  space: Space
  scaleX: number
  scaleY: number
  opacity: number
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
  region: SceneRect | undefined
): ReturnType<typeof samplingRelation> {
  return samplingRelation(
    {
      x: rect.x - (space === 'document' ? frame.scrollX : 0),
      y: rect.y - (space === 'document' ? frame.scrollY : 0),
      width: rect.width,
      height: rect.height,
    },
    region
  )
}
function base(rect: SceneRect, geometry: Geometry) {
  return {
    rect,
    space: geometry.space,
    opacity: geometry.opacity,
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

/** Reads ordinary DOM; callers never annotate text, media, or paint primitives. */
export function createSceneCompiler(invalidate: () => void): SceneCompiler {
  const readColor = createColorReader()
  const assets = createAssetCache(invalidate)
  const boxCache = new WeakMap<Element, CachedPaint>()
  const shadowCache = new WeakMap<Element, { key: string; paint: BoxShadowPaint }>()
  const pseudoCache = new WeakMap<HTMLElement, Partial<Record<PseudoName, CachedPaint>>>()
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
    compile(root, glasses, frame, background, samplingRegion): CompiledScene {
      if (disposed) throw new Error('Scene compiler is disposed')
      const items: SceneItem[] = []
      const targets: SceneTarget[] = []
      const issues = new Set<string>()
      assets.begin()
      const usedMapKeys = new Set<string>()
      const media: (HTMLVideoElement | HTMLCanvasElement)[] = []
      let liveGeometry = false
      const samplingWatches: SamplingWatch[] = []

      const text = (node: Text, parent: HTMLElement, geometry: Geometry) => {
        if (!node.data.trim()) return
        const range = document.createRange()
        range.selectNodeContents(node)
        const bounds = range.getBoundingClientRect()
        if (!bounds.width || !bounds.height) return
        const style = getComputedStyle(parent)
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
        const style = getComputedStyle(element)
        if (style.display === 'none' || element.hasAttribute('hidden')) return
        // A zero-area clip suppresses the element and all of its descendants.
        // This common screen-reader-only pattern still remains in the native DOM.
        if (/^inset\(50%\)$/.test(style.clipPath)) return
        const bounds = element.getBoundingClientRect()
        const geometry: Geometry = {
          ...inherited,
          opacity: inherited.opacity * (Number.parseFloat(style.opacity) || 0),
        }
        if (style.position === 'fixed' && !inherited.transformed) geometry.space = 'viewport'
        if (style.position === 'sticky') liveGeometry = true
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
        const glass = element instanceof HTMLElement ? glasses.get(element) : undefined
        if (!glass) inspectUnsupported(element, style, issues)
        inspectStackingOrder(element, style, root, issues)
        const visible = style.visibility === 'visible' && bounds.width > 0 && bounds.height > 0
        const rect = toRect(bounds, geometry.space, frame)
        const size = logicalSize(bounds, geometry)
        const ratio = rasterRatio(size.width, size.height, frame.pixelRatio)
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
          // CSS opacity applies to the combined element, not each paint operation.
          // Separate shadow and box sprites cannot reproduce group opacity exactly.
          if (shadows.status === 'ready' && geometry.opacity < 1)
            issues.add('CSS box shadows with opacity require native HTML rendering')
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
        if (shadows.status === 'ready') appendShadow(shadows.outer)
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
          if (studio) radius = (Math.min(rect.width, rect.height) * 0.5 * studio.shapeRadius) / 100
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
            const bitmap = paintCached(
              boxCache,
              element,
              key,
              (paintIssues) =>
                paintBox(style, size.width, size.height, ratio, paintIssues, backgroundImages),
              issues
            )
            items.push({ kind: 'sprite', ...base(rect, geometry), bitmap })
          }
        }
        if (shadows.status === 'ready') appendShadow(shadows.inset)
        if (
          visible &&
          element instanceof HTMLElement &&
          element.matches('a[href],button,input,select,textarea,[role="button"],[tabindex]') &&
          !element.matches(':disabled')
        )
          targets.push({ element, rect, space: geometry.space })

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
          if (!source) return
          const reportUnavailable = (status: 'loading' | 'error') => {
            const relation = sceneSamplingRelation(rect, geometry.space, frame, samplingRegion)
            if (samplingRegion) samplingWatches.push({ element, relation })
            if (relation === 'outside') {
              return
            }
            issues.add(
              status === 'loading'
                ? 'Image is loading'
                : 'Image could not be read; check its URL and CORS permission'
            )
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
                bitmap = paintImage(asset.image, size.width, size.height, ratio, style, paintIssues)
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
            const relation = sceneSamplingRelation(rect, geometry.space, frame, samplingRegion)
            if (samplingRegion && clipped && boundedEffects)
              samplingWatches.push({ element, relation })
            if (clipped && boundedEffects && relation === 'outside') return
            issues.add(asset.status === 'loading' ? 'SVG is loading' : 'SVG could not be rendered')
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
          const contentStyle = element.value ? style : getComputedStyle(element, '::placeholder')
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
              return undefined
            }
            if (measured.zIndex !== 0 && !createsStackingContext(element, style)) {
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
                if (painted.status === 'unsupported') issues.add(painted.reason)
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
            const childStyle = getComputedStyle(node)
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
            for (const node of element.childNodes) children.push({ kind: 'node', node, z: z(node) })
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
      }

      walk(root, { space: 'document', scaleX: 1, scaleY: 1, opacity: 1, transformed: false })
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
            radius: 1,
            color: [0.55, 0.86, 1, 1],
          })
        )
      }
      assets.end()
      for (const key of mapBitmaps.keys()) {
        if (!usedMapKeys.has(key)) mapBitmaps.delete(key)
      }
      return {
        scene: { background: readColor(background), items },
        targets,
        issues: Array.from(issues),
        liveGeometry,
        samplingWatches,
        media,
      }
    },
    dispose() {
      disposed = true
      fonts?.removeEventListener('loadingdone', onFontsChanged)
      fonts?.removeEventListener('loadingerror', onFontsChanged)
      assets.dispose()
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
  issues: Set<string>
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
  if (style.filter !== 'none' || hasBackdropFilter(style))
    issues.add('CSS filters outside LiquidGlass require native HTML rendering')
  if (style.textShadow !== 'none') issues.add('CSS text shadows require native HTML rendering')
  if (style.borderImageSource !== 'none')
    issues.add('CSS border images require native HTML rendering')
  if (style.backgroundBlendMode.split(',').some((value) => value.trim() !== 'normal'))
    issues.add('Background blending requires native HTML rendering')
  if (style.perspective !== 'none') issues.add('CSS perspective requires native HTML rendering')
  if (style.display === 'list-item' && style.listStyleType !== 'none')
    issues.add('Native list markers require HTML rendering')
  if (style.clipPath !== 'none' || (style.maskImage && style.maskImage !== 'none'))
    issues.add('CSS masks and clip paths require native HTML rendering')
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
    (style.translate && style.translate !== 'none')
  )
    issues.add(
      'Individual CSS transform properties require native HTML rendering; use transform instead'
    )
  if (element.shadowRoot) issues.add('Shadow DOM content requires native HTML rendering')
  if (style.writingMode !== 'horizontal-tb')
    issues.add('Vertical text requires native HTML rendering')
}

function hasBackdropFilter(style: CSSStyleDeclaration): boolean {
  const value = style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter')
  return Boolean(value && value !== 'none')
}

function createsStackingContext(element: Element, style: CSSStyleDeclaration): boolean {
  const parentDisplay = element.parentElement ? getComputedStyle(element.parentElement).display : ''
  const positioned = style.position !== 'static'
  const flexOrGridItem = parentDisplay.includes('flex') || parentDisplay.includes('grid')
  return (
    style.isolation === 'isolate' ||
    style.position === 'fixed' ||
    style.position === 'sticky' ||
    ((positioned || flexOrGridItem) && style.zIndex !== 'auto') ||
    Number.parseFloat(style.opacity) < 1 ||
    style.transform !== 'none' ||
    style.filter !== 'none' ||
    hasBackdropFilter(style) ||
    style.perspective !== 'none' ||
    style.mixBlendMode !== 'normal' ||
    style.clipPath !== 'none' ||
    Boolean(style.maskImage && style.maskImage !== 'none') ||
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
  issues: Set<string>
) {
  const parent = element.parentElement
  if (!parent || parent === root || style.zIndex === 'auto') return
  const parentStyle = getComputedStyle(parent)
  const parentLayout = parentStyle.display
  if (
    style.position === 'static' &&
    !parentLayout.includes('flex') &&
    !parentLayout.includes('grid')
  )
    return
  const zIndex = Number.parseInt(style.zIndex, 10) || 0
  if (!zIndex || createsStackingContext(parent, parentStyle)) return
  // The compiler paints sibling subtrees atomically. A positioned descendant of
  // a non-stacking ancestor participates in a more distant stacking context and
  // may need to interleave with an uncle's paint. Preserve HTML when that order
  // cannot be represented by this traversal instead of silently covering it.
  if (zIndex < 0) {
    issues.add('Escaping negative stacking order requires native HTML rendering')
    return
  }
  const bounds = element.getBoundingClientRect()
  const overlaps = (other: Element) => {
    const candidate = other.getBoundingClientRect()
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
    const containerStyle = getComputedStyle(container)
    const level = (child: Element) => {
      const childStyle = getComputedStyle(child)
      return childStyle.position === 'static' &&
        !containerStyle.display.includes('flex') &&
        !containerStyle.display.includes('grid')
        ? 0
        : Number.parseInt(childStyle.zIndex, 10) || 0
    }
    const siblings = Array.from(container.children).sort((a, b) => level(a) - level(b))
    const index = siblings.indexOf(branch)
    for (let i = index + 1; i < siblings.length; i += 1) {
      const sibling = siblings[i]
      if (
        !sibling ||
        level(sibling) >= zIndex ||
        getComputedStyle(sibling).visibility !== 'visible'
      )
        continue
      if (overlaps(sibling) || Array.from(sibling.querySelectorAll('*')).some(overlaps)) {
        issues.add('Escaping descendant stacking order requires native HTML rendering')
        return
      }
    }
    if (container === root || createsStackingContext(container, containerStyle)) return
    branch = container
  }
}

import { boxRadii, paintBox, splitCss } from './paint-box'
import type { SceneRect } from './types'

export type PseudoName = '::before' | '::after'

export type PseudoBoxMeasurement =
  | { status: 'none' }
  | { status: 'unsupported'; reason: string }
  | {
      status: 'ready'
      pseudo: PseudoName
      rect: SceneRect
      localSize: { width: number; height: number }
      scale: { x: number; y: number }
      style: CSSStyleDeclaration
      opacity: number
      zIndex: number
    }

export type PaintedPseudo =
  | { status: 'none' }
  | { status: 'unsupported'; reason: string }
  | {
      status: 'ready'
      pseudo: PseudoName
      rect: SceneRect
      bitmap: HTMLCanvasElement
      opacity: number
      zIndex: number
    }

type StyleReader = (element: Element, pseudo?: string | null) => CSSStyleDeclaration

const none = (value: string | undefined) => !value || value === 'none' || value === 'normal'
const px = (value: string): number | undefined => {
  if (value === '0') return 0
  if (!/^-?(?:\d+\.?\d*|\.\d+)px$/.test(value)) return undefined
  const result = Number.parseFloat(value)
  return Number.isFinite(result) ? result : undefined
}
const allLayers = (value: string, allowed: readonly string[]) =>
  !value || value.split(',').every((layer) => allowed.includes(layer.trim()))
const axisScale = (value: string): { x: number; y: number } | null => {
  if (none(value)) return { x: 1, y: 1 }
  const match = /^matrix\(([^)]+)\)$/.exec(value)
  if (!match?.[1]) return null
  const values = match[1].split(',').map((part) => Number(part.trim()))
  if (
    values.length === 6 &&
    values.every(Number.isFinite) &&
    (values[0] ?? 0) > 0 &&
    Math.abs(values[1] ?? 1) < 0.000001 &&
    Math.abs(values[2] ?? 1) < 0.000001 &&
    (values[3] ?? 0) > 0
  )
    return { x: values[0] ?? 1, y: values[3] ?? 1 }
  return null
}

/** Recognize only the opaque two-layer XOR mask used to create a padding-width ring. */
function hasRingMask(style: CSSStyleDeclaration): boolean {
  const image = style.maskImage || style.getPropertyValue('-webkit-mask-image')
  const layers = splitCss(image || '')
  const black =
    /^linear-gradient\(\s*rgb\(0,\s*0,\s*0\)\s+0(?:px|%)?,\s*rgb\(0,\s*0,\s*0\)\s+0(?:px|%)?\s*\)$/
  const equalLayers = (value: string, expected: string) =>
    splitCss(value).length === 2 && splitCss(value).every((part) => part === expected)
  const zeroPositions = (value: string) => {
    const positions = splitCss(value)
    return positions.length === 2 && positions.every((part) => /^(?:0px|0%) (?:0px|0%)$/.test(part))
  }
  const pair = (value: string, a: string, b: string) => {
    const parts = splitCss(value)
    return parts.length === 2 && parts[0] === a && parts[1] === b
  }
  const property = (name: string) => style.getPropertyValue(name).trim()
  const padding = [
    style.paddingLeft,
    style.paddingRight,
    style.paddingTop,
    style.paddingBottom,
  ].map((value) => px(value || '0px'))
  const radii = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]
  return (
    layers.length === 2 &&
    layers.every((layer) => black.test(layer)) &&
    pair(property('-webkit-mask-clip') || style.maskClip, 'content-box', 'border-box') &&
    pair(property('-webkit-mask-origin') || style.maskOrigin, 'content-box', 'border-box') &&
    (equalLayers(property('-webkit-mask-composite'), 'xor') ||
      equalLayers(style.maskComposite, 'exclude')) &&
    equalLayers(property('-webkit-mask-size') || style.maskSize, 'auto') &&
    equalLayers(property('-webkit-mask-repeat') || style.maskRepeat, 'repeat') &&
    zeroPositions(property('-webkit-mask-position') || style.maskPosition) &&
    (!style.maskMode || equalLayers(style.maskMode, 'match-source')) &&
    [
      style.borderLeftWidth,
      style.borderRightWidth,
      style.borderTopWidth,
      style.borderBottomWidth,
    ].every((value) => (px(value || '0px') ?? Number.NaN) === 0) &&
    padding[0] !== undefined &&
    padding[0] > 0 &&
    padding.every((value) => value === padding[0]) &&
    radii.every((value) => value === radii[0])
  )
}

interface EllipticalRadius {
  x: number
  y: number
}

/** Use the equivalent elliptical arcs on browsers that predate Canvas roundRect. */
function appendRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radii: readonly EllipticalRadius[]
) {
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, [...radii])
    return
  }
  if (typeof context.ellipse !== 'function') throw new Error('Canvas ellipse unavailable')
  const [tl = { x: 0, y: 0 }, tr = { x: 0, y: 0 }, br = { x: 0, y: 0 }, bl = { x: 0, y: 0 }] = radii
  const ratio = (extent: number, sum: number) => (sum > 0 ? extent / sum : 1)
  const factor = Math.min(
    1,
    ratio(width, tl.x + tr.x),
    ratio(width, bl.x + br.x),
    ratio(height, tl.y + bl.y),
    ratio(height, tr.y + br.y)
  )
  const corners = [tl, tr, br, bl].map((radius) => ({
    x: radius.x * factor,
    y: radius.y * factor,
  }))
  const [a, b, c, d] = corners
  if (!a || !b || !c || !d) throw new Error('Canvas radius unavailable')
  context.moveTo(x + a.x, y)
  context.lineTo(x + width - b.x, y)
  if (b.x && b.y) context.ellipse(x + width - b.x, y + b.y, b.x, b.y, 0, -Math.PI / 2, 0)
  else context.lineTo(x + width, y + b.y)
  context.lineTo(x + width, y + height - c.y)
  if (c.x && c.y) context.ellipse(x + width - c.x, y + height - c.y, c.x, c.y, 0, 0, Math.PI / 2)
  else context.lineTo(x + width - c.x, y + height)
  context.lineTo(x + d.x, y + height)
  if (d.x && d.y) context.ellipse(x + d.x, y + height - d.y, d.x, d.y, 0, Math.PI / 2, Math.PI)
  else context.lineTo(x, y + height - d.y)
  context.lineTo(x, y + a.y)
  if (a.x && a.y) context.ellipse(x + a.x, y + a.y, a.x, a.y, 0, Math.PI, (3 * Math.PI) / 2)
  else context.lineTo(x + a.x, y)
  context.closePath()
}

function applyRingMask(
  context: CanvasRenderingContext2D,
  style: CSSStyleDeclaration,
  width: number,
  height: number
) {
  const radii = boxRadii(style, width, height)
  const [tl = [0, 0], tr = [0, 0], br = [0, 0], bl = [0, 0]] = radii
  const factor = Math.min(
    1,
    width / Math.max(1, tl[0] + tr[0]),
    width / Math.max(1, bl[0] + br[0]),
    height / Math.max(1, tl[1] + bl[1]),
    height / Math.max(1, tr[1] + br[1])
  )
  const outer = radii.map(([x, y]) => ({ x: x * factor, y: y * factor }))
  const left = px(style.paddingLeft) ?? 0
  const right = px(style.paddingRight) ?? 0
  const top = px(style.paddingTop) ?? 0
  const bottom = px(style.paddingBottom) ?? 0
  const cornerInsets = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]
  const inner = outer.map(({ x, y }, index) => ({
    x: Math.max(0, x - (cornerInsets[index]?.[0] ?? 0)),
    y: Math.max(0, y - (cornerInsets[index]?.[1] ?? 0)),
  }))
  context.save()
  context.fillStyle = '#000'
  context.globalCompositeOperation = 'destination-in'
  context.beginPath()
  appendRoundRect(context, 0, 0, width, height, outer)
  context.fill()
  const innerWidth = Math.max(0, width - left - right)
  const innerHeight = Math.max(0, height - top - bottom)
  if (innerWidth && innerHeight) {
    context.globalCompositeOperation = 'destination-out'
    context.beginPath()
    appendRoundRect(context, left, top, innerWidth, innerHeight, inner)
    context.fill()
  }
  context.restore()
}

/** Measure the subset whose pseudo-element border box can be derived without layout guesses.
 * Returned coordinates are viewport-relative; scene geometry decides the coordinate space.
 */
export function measurePseudoBox(
  element: HTMLElement,
  pseudo: PseudoName,
  readStyle: StyleReader = (target, name) => getComputedStyle(target, name)
): PseudoBoxMeasurement {
  const style = readStyle(element, pseudo)
  if (none(style.content) || style.display === 'none' || style.visibility === 'hidden')
    return { status: 'none' }
  const opacity = style.opacity ? Number(style.opacity) : 1
  if (opacity === 0) return { status: 'none' }
  const unsupported = (reason: string): PseudoBoxMeasurement => ({ status: 'unsupported', reason })
  if (style.content !== '""' && style.content !== "''")
    return unsupported(
      'Pseudo-elements with text or replaced content require native HTML rendering'
    )
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    return unsupported('Unsupported pseudo-element opacity')
  if (style.position !== 'absolute')
    return unsupported('Non-absolute pseudo-element layout requires native HTML rendering')
  const parent = readStyle(element)
  if (!['relative', 'absolute', 'fixed', 'sticky'].includes(parent.position))
    return unsupported('Pseudo-element containing block must be its positioned parent')
  if (element.scrollLeft !== 0 || element.scrollTop !== 0)
    return unsupported('Scrolled pseudo-element containing blocks require native HTML rendering')
  let scaleX = 1
  let scaleY = 1
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const ancestorStyle = ancestor === element ? parent : readStyle(ancestor)
    const scale = axisScale(ancestorStyle.transform)
    if (
      !scale ||
      !none(ancestorStyle.translate) ||
      !none(ancestorStyle.rotate) ||
      !none(ancestorStyle.scale) ||
      !none(ancestorStyle.perspective) ||
      (ancestorStyle.zoom && !['normal', '1'].includes(ancestorStyle.zoom))
    )
      return unsupported(
        'Transformed pseudo-element containing blocks require native HTML rendering'
      )
    scaleX *= scale.x
    scaleY *= scale.y
    if (![scaleX, scaleY].every(Number.isFinite) || scaleX < 0.0001 || scaleY < 0.0001)
      return unsupported('Invalid pseudo-element ancestor scale')
  }
  if (
    !none(style.transform) ||
    !none(style.translate) ||
    !none(style.rotate) ||
    !none(style.scale) ||
    !none(style.filter) ||
    !none(style.backdropFilter) ||
    !none(style.getPropertyValue('-webkit-backdrop-filter')) ||
    !none(style.boxShadow) ||
    !none(style.textShadow) ||
    !none(style.clipPath) ||
    ((!none(style.maskImage) || !none(style.getPropertyValue('-webkit-mask-image'))) &&
      !hasRingMask(style)) ||
    !none(style.borderImageSource) ||
    !none(style.mixBlendMode) ||
    (style.backgroundBlendMode &&
      style.backgroundBlendMode.split(',').some((value) => value.trim() !== 'normal')) ||
    !allLayers(style.backgroundAttachment, ['scroll'])
  )
    return unsupported('Pseudo-element effects require native HTML rendering')

  const widths = [
    style.borderLeftWidth,
    style.borderRightWidth,
    style.borderTopWidth,
    style.borderBottomWidth,
    style.paddingLeft,
    style.paddingRight,
    style.paddingTop,
    style.paddingBottom,
  ].map((value) => px(value || '0px'))
  if (widths.some((value) => value === undefined))
    return unsupported('Pseudo-element box lengths must resolve to pixels')
  const [
    borderLeft = 0,
    borderRight = 0,
    borderTop = 0,
    borderBottom = 0,
    paddingLeft = 0,
    paddingRight = 0,
    paddingTop = 0,
    paddingBottom = 0,
  ] = widths
  if (
    [style.marginLeft, style.marginRight, style.marginTop, style.marginBottom].some(
      (value) => (px(value || '0px') ?? Number.NaN) !== 0
    )
  )
    return unsupported('Pseudo-element margins require native HTML rendering')
  const cssWidth = px(style.width)
  const cssHeight = px(style.height)
  if (cssWidth === undefined || cssHeight === undefined || cssWidth < 0 || cssHeight < 0)
    return unsupported('Pseudo-element size must resolve to pixels')
  const width =
    cssWidth +
    (style.boxSizing === 'border-box' ? 0 : borderLeft + borderRight + paddingLeft + paddingRight)
  const height =
    cssHeight +
    (style.boxSizing === 'border-box' ? 0 : borderTop + borderBottom + paddingTop + paddingBottom)
  if (width <= 0 || height <= 0) return { status: 'none' }
  const parentRect = element.getBoundingClientRect()
  const parentBorderLeft = px(parent.borderLeftWidth || '0px')
  const parentBorderRight = px(parent.borderRightWidth || '0px')
  const parentBorderTop = px(parent.borderTopWidth || '0px')
  const parentBorderBottom = px(parent.borderBottomWidth || '0px')
  if (
    [parentBorderLeft, parentBorderRight, parentBorderTop, parentBorderBottom].some(
      (value) => value === undefined
    )
  )
    return unsupported('Pseudo-element parent border must resolve to pixels')
  const parentWidth = parentRect.width / scaleX - (parentBorderLeft ?? 0) - (parentBorderRight ?? 0)
  const parentHeight =
    parentRect.height / scaleY - (parentBorderTop ?? 0) - (parentBorderBottom ?? 0)
  if (
    Math.abs(element.clientWidth - parentWidth) > 1 ||
    Math.abs(element.clientHeight - parentHeight) > 1
  )
    return unsupported('Pseudo-element parent scrollbars require native HTML rendering')
  const left = px(style.left)
  const right = px(style.right)
  const top = px(style.top)
  const bottom = px(style.bottom)
  if ((left === undefined && right === undefined) || (top === undefined && bottom === undefined))
    return unsupported('Pseudo-element offsets must resolve to pixels')
  if (
    (left !== undefined &&
      right !== undefined &&
      Math.abs(left + right + width - parentWidth) > 1) ||
    (top !== undefined &&
      bottom !== undefined &&
      Math.abs(top + bottom + height - parentHeight) > 1)
  )
    return unsupported('Over-constrained pseudo-element layout requires native HTML rendering')
  const x =
    parentRect.left +
    ((parentBorderLeft ?? 0) + (left ?? parentWidth - (right ?? 0) - width)) * scaleX
  const y =
    parentRect.top +
    ((parentBorderTop ?? 0) + (top ?? parentHeight - (bottom ?? 0) - height)) * scaleY
  if (![x, y, width * scaleX, height * scaleY].every(Number.isFinite))
    return unsupported('Pseudo-element geometry is invalid')
  if (style.backgroundImage.includes('url('))
    return unsupported('Pseudo-element image assets require native HTML rendering')
  const size = style.backgroundSize
  if (
    style.backgroundImage &&
    style.backgroundImage !== 'none' &&
    !allLayers(size, ['auto', 'auto auto', '100% 100%'])
  )
    return unsupported('Pseudo-element background sizing requires native HTML rendering')
  if (
    (borderLeft || borderRight || borderTop || borderBottom) &&
    (!allLayers(style.backgroundClip, ['border-box']) ||
      (style.backgroundImage &&
        style.backgroundImage !== 'none' &&
        !allLayers(style.backgroundOrigin, ['border-box'])))
  )
    return unsupported('Pseudo-element background origin requires native HTML rendering')
  if (
    [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].some(
      (value) =>
        value && !/^(?:\d+(?:\.\d+)?(?:px|%)|0)(?:\s+(?:\d+(?:\.\d+)?(?:px|%)|0))?$/.test(value)
    )
  )
    return unsupported('Pseudo-element corner radius requires native HTML rendering')
  const zIndex = style.zIndex === 'auto' || !style.zIndex ? 0 : Number(style.zIndex)
  if (!Number.isInteger(zIndex)) return unsupported('Unsupported pseudo-element stacking order')
  return {
    status: 'ready',
    pseudo,
    rect: { x, y, width: width * scaleX, height: height * scaleY },
    localSize: { width, height },
    scale: { x: scaleX, y: scaleY },
    style,
    opacity,
    zIndex,
  }
}

/** Rasterize only measured pseudo boxes; paintBox reports unsupported CSS rather than omitting it. */
export function paintPseudoBox(
  element: HTMLElement,
  pseudo: PseudoName,
  ratio: number,
  readStyle?: StyleReader
): PaintedPseudo {
  const measured = measurePseudoBox(element, pseudo, readStyle)
  if (measured.status !== 'ready') return measured
  if (!Number.isFinite(ratio) || ratio <= 0)
    return { status: 'unsupported', reason: 'Invalid pseudo-element raster ratio' }
  const { width, height } = measured.localSize
  const targetRatio = ratio * Math.max(measured.scale.x, measured.scale.y)
  let boundedRatio = Math.min(
    targetRatio,
    4096 / width,
    4096 / height,
    Math.sqrt(2_000_000 / (width * height))
  )
  while (Math.ceil(width * boundedRatio) * Math.ceil(height * boundedRatio) > 2_000_000) {
    boundedRatio *= 0.999
  }
  const issues = new Set<string>()
  try {
    const ring = hasRingMask(measured.style)
    // Draw the unrounded fill first. The mask applies the browser's elliptical
    // outside and inside curves, including its antialiasing, to that fill.
    const style = ring
      ? new Proxy(measured.style, {
          get(target, property) {
            if (
              property === 'borderTopLeftRadius' ||
              property === 'borderTopRightRadius' ||
              property === 'borderBottomRightRadius' ||
              property === 'borderBottomLeftRadius'
            )
              return '0px'
            return Reflect.get(target, property, target)
          },
        })
      : measured.style
    const bitmap = paintBox(style, width, height, boundedRatio, issues)
    if (issues.size) return { status: 'unsupported', reason: [...issues].join('; ') }
    if (ring) {
      const context = bitmap.getContext('2d')
      if (!context) return { status: 'unsupported', reason: 'Pseudo-element canvas unavailable' }
      // paintBox leaves its clipped path active. Mask on a fresh context state.
      context.resetTransform()
      context.scale(boundedRatio, boundedRatio)
      applyRingMask(context, measured.style, width, height)
    }
    return {
      status: 'ready',
      pseudo,
      rect: measured.rect,
      bitmap,
      opacity: measured.opacity,
      zIndex: measured.zIndex,
    }
  } catch {
    return { status: 'unsupported', reason: 'Pseudo-element rasterization failed' }
  }
}

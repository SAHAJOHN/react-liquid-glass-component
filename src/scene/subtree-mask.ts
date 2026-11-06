import { splitCss } from './paint-box'

const MAX_MASK_DIMENSION = 4096
const MAX_COMBINED_MASK_PIXELS = 2_000_000

type MaskGradient = {
  direction: 'to bottom' | 'to right'
  stops: Array<{ offset: number; alpha: number }>
}

function maskProperty(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim().toLowerCase()
}

function maskImages(style: CSSStyleDeclaration): string[] | null {
  const standard = maskProperty(style, 'mask-image') || style.maskImage?.trim().toLowerCase() || ''
  const prefixed = maskProperty(style, '-webkit-mask-image')
  if (standard && prefixed && standard !== 'none' && prefixed !== 'none' && standard !== prefixed)
    return null
  const value = standard && standard !== 'none' ? standard : prefixed
  const images = splitCss(value)
  return images.length > 0 && images.every((image) => /^linear-gradient\(/.test(image))
    ? images
    : null
}

function compatibleList(
  style: CSSStyleDeclaration,
  name: string,
  accepted: readonly string[],
  layers: number
): boolean {
  const value = maskProperty(style, name)
  if (!value) return true
  const list = splitCss(value)
  return (
    (list.length === 1 || list.length === layers) && list.every((entry) => accepted.includes(entry))
  )
}

function validMaskProperties(style: CSSStyleDeclaration, layers: number): boolean {
  return (
    compatibleList(style, 'mask-mode', ['match-source', 'alpha'], layers) &&
    compatibleList(style, 'mask-position', ['0% 0%', '0px 0px', '0% 0px', '0px 0%'], layers) &&
    compatibleList(
      style,
      '-webkit-mask-position',
      ['0% 0%', '0px 0px', '0% 0px', '0px 0%'],
      layers
    ) &&
    compatibleList(style, 'mask-size', ['auto', '100% 100%'], layers) &&
    compatibleList(style, '-webkit-mask-size', ['auto', '100% 100%'], layers) &&
    compatibleList(style, 'mask-repeat', ['repeat', 'no-repeat'], layers) &&
    compatibleList(style, '-webkit-mask-repeat', ['repeat', 'no-repeat'], layers) &&
    compatibleList(style, 'mask-origin', ['border-box'], layers) &&
    compatibleList(style, '-webkit-mask-origin', ['border-box'], layers) &&
    compatibleList(style, 'mask-clip', ['border-box'], layers) &&
    compatibleList(style, '-webkit-mask-clip', ['border-box'], layers) &&
    compatibleList(style, 'mask-border-source', ['none'], 1) &&
    compatibleList(style, '-webkit-mask-box-image-source', ['none'], 1)
  )
}

/** A two-layer mask must explicitly intersect the first layer with the second. */
export function hasIntersectingSubtreeMask(style: CSSStyleDeclaration): boolean {
  const images = maskImages(style)
  if (!images || images.length !== 2 || !validMaskProperties(style, 2)) return false
  const standard = maskProperty(style, 'mask-composite')
  const prefixed = maskProperty(style, '-webkit-mask-composite')
  if (!standard && !prefixed) return false
  const composite = (value: string, first: string, last: readonly string[]) => {
    if (!value) return true
    const values = splitCss(value)
    return (
      values[0] === first &&
      (values.length === 1 || (values.length === 2 && last.includes(values[1] ?? '')))
    )
  }
  // Chromium exposes the prefixed property as an alias of the standard
  // serialization. Only accept that alias when both explicitly match.
  const standardAlias = Boolean(
    standard &&
    prefixed &&
    splitCss(standard).join(',') === splitCss(prefixed).join(',') &&
    composite(prefixed, 'intersect', ['intersect', 'add'])
  )
  return (
    composite(standard, 'intersect', ['intersect', 'add']) &&
    (composite(prefixed, 'source-in', ['source-in', 'source-over']) || standardAlias)
  )
}

function parseGradient(image: string, width: number, height: number): MaskGradient | null {
  const match = /^linear-gradient\((.*)\)$/.exec(image)
  if (!match?.[1]) return null
  const parts = splitCss(match[1])
  const first = parts[0] ?? ''
  const direction = first === 'to bottom' || first === 'to right' ? parts.shift() : 'to bottom'
  if (direction !== 'to bottom' && direction !== 'to right') return null
  const extent = direction === 'to bottom' ? height : width
  if (parts.length < 2) return null
  const stops: MaskGradient['stops'] = []
  const token =
    /^(black|transparent|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[01](?:\.0+)?\s*\))\s+(0|(?:\d+(?:\.\d+)?)(?:px|%)|calc\(100%\s*-\s*(?:\d+(?:\.\d+)?)px\))$/
  for (const part of parts) {
    const stop = token.exec(part)
    if (!stop?.[1] || !stop[2]) return null
    const offset = stop[2].startsWith('calc(')
      ? 1 - Number.parseFloat(stop[2].slice(stop[2].indexOf('-') + 1)) / extent
      : stop[2].endsWith('%')
        ? Number.parseFloat(stop[2]) / 100
        : Number.parseFloat(stop[2]) / extent
    if (
      !Number.isFinite(offset) ||
      offset < 0 ||
      offset > 1 ||
      offset < (stops[stops.length - 1]?.offset ?? 0)
    )
      return null
    const alpha =
      stop[1] === 'transparent' || /^rgba\(.*?,\s*0(?:\.0+)?\s*\)$/.test(stop[1]) ? 0 : 1
    stops.push({ offset, alpha })
  }
  return { direction, stops }
}

/** Alpha-only linear gradients that can be applied after group compositing. */
export function paintSubtreeMask(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
  ratio: number
): HTMLCanvasElement | null {
  if (![width, height, ratio].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0)
    return null
  const images = maskImages(style)
  if (!images || (images.length !== 1 && images.length !== 2)) return null
  if (!validMaskProperties(style, images.length)) return null
  if (images.length === 1) {
    if (
      !compatibleList(style, 'mask-composite', ['add'], 1) ||
      !compatibleList(style, '-webkit-mask-composite', ['add', 'source-over'], 1)
    )
      return null
  } else if (!hasIntersectingSubtreeMask(style)) return null

  const gradients = images.map((image) => parseGradient(image, width, height))
  if (gradients.some((gradient) => !gradient)) return null
  const first = gradients[0]
  const second = gradients[1]
  if (!first || (images.length === 2 && (!second || first.direction === second.direction)))
    return null
  const pixelWidth = Math.ceil(width * ratio)
  const pixelHeight = Math.ceil(height * ratio)
  const canvasWidth = second || first.direction === 'to right' ? pixelWidth : 1
  const canvasHeight = second || first.direction === 'to bottom' ? pixelHeight : 1
  if (
    canvasWidth < 1 ||
    canvasHeight < 1 ||
    canvasWidth > MAX_MASK_DIMENSION ||
    canvasHeight > MAX_MASK_DIMENSION ||
    (second && canvasWidth * canvasHeight > MAX_COMBINED_MASK_PIXELS)
  )
    return null
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const [index, spec] of [first, ...(second ? [second] : [])].entries()) {
    const gradient = context.createLinearGradient(
      0,
      0,
      spec.direction === 'to right' ? canvas.width : 0,
      spec.direction === 'to bottom' ? canvas.height : 0
    )
    for (const { offset, alpha } of spec.stops)
      gradient.addColorStop(offset, `rgba(0, 0, 0, ${alpha})`)
    context.globalCompositeOperation = index ? 'destination-in' : 'source-over'
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  return canvas
}

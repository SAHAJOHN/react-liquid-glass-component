import { boxRadii, splitCss } from './paint-box'

type Radius = readonly [number, number]

export interface BoxShadowLayer {
  inset: boolean
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  color: string
}

export interface BoxShadowSprite {
  bitmap: HTMLCanvasElement
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export type BoxShadowPaint =
  | { status: 'none' }
  | { status: 'unsupported'; reason: string }
  | { status: 'ready'; outer?: BoxShadowSprite; inset?: BoxShadowSprite }

type ParsedShadows =
  | { status: 'none' }
  | { status: 'unsupported'; reason: string }
  | { status: 'ready'; layers: BoxShadowLayer[] }

function validColor(value: string): boolean {
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function')
    return CSS.supports('color', value)
  const probe = document.createElement('span')
  probe.style.color = value
  return Boolean(probe.style.color)
}

/** Parse the computed box-shadow syntax. Unresolved lengths and colors fail closed. */
export function parseBoxShadows(value: string, currentColor: string): ParsedShadows {
  if (!value || value.trim() === 'none') return { status: 'none' }
  const layers: BoxShadowLayer[] = []
  for (const raw of splitCss(value)) {
    if (layers.length >= 32) return { status: 'unsupported', reason: 'Too many box-shadow layers' }
    const lengths: number[] = []
    let inset = false
    let color: string | undefined
    for (const token of splitCss(raw, ' ').filter(Boolean)) {
      if (token.toLowerCase() === 'inset') {
        if (inset) return { status: 'unsupported', reason: 'Duplicate inset box-shadow' }
        inset = true
        continue
      }
      const match = token.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$/i)
      if (match) {
        const n = Number(match[1])
        if (!Number.isFinite(n) || (!match[2] && n !== 0))
          return { status: 'unsupported', reason: 'Box-shadow lengths must be resolved pixels' }
        lengths.push(n)
        continue
      }
      const candidate = token.toLowerCase() === 'currentcolor' ? currentColor : token
      if (color !== undefined || !validColor(candidate))
        return { status: 'unsupported', reason: 'Unsupported box-shadow value' }
      color = candidate
    }
    if (lengths.length < 2 || lengths.length > 4 || (lengths[2] ?? 0) < 0)
      return { status: 'unsupported', reason: 'Unsupported box-shadow geometry' }
    const resolvedColor = color ?? currentColor
    if (!resolvedColor || !validColor(resolvedColor))
      return { status: 'unsupported', reason: 'Unsupported box-shadow color' }
    layers.push({
      inset,
      offsetX: lengths[0] ?? 0,
      offsetY: lengths[1] ?? 0,
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      color: resolvedColor,
    })
  }
  return layers.length ? { status: 'ready', layers } : { status: 'none' }
}

function adjustedRadius(value: number, spread: number, outer: boolean): number {
  if (value <= 0) return 0
  if (outer && spread > 0 && value < spread) {
    return value + spread * (1 - Math.pow(1 - value / spread, 3))
  }
  return Math.max(0, value + spread)
}

function adjustedRadii(radii: readonly Radius[], spread: number, outer: boolean): Radius[] {
  return radii.map(([x, y]) => [adjustedRadius(x, spread, outer), adjustedRadius(y, spread, outer)])
}

/** Append a CSS-style elliptical rounded rectangle to the current canvas path. */
function appendRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radii: readonly Radius[]
): void {
  const [tl = [0, 0], tr = [0, 0], br = [0, 0], bl = [0, 0]] = radii
  const fit = (extent: number, sum: number) => (sum > 0 ? extent / sum : 1)
  const factor = Math.min(
    1,
    fit(width, tl[0] + tr[0]),
    fit(width, bl[0] + br[0]),
    fit(height, tl[1] + bl[1]),
    fit(height, tr[1] + br[1])
  )
  const corners = [tl, tr, br, bl].map(([rx, ry]) => [rx * factor, ry * factor] as const)
  const [a = [0, 0], b = [0, 0], c = [0, 0], d = [0, 0]] = corners
  context.moveTo(x + a[0], y)
  context.lineTo(x + width - b[0], y)
  if (b[0] && b[1]) context.ellipse(x + width - b[0], y + b[1], b[0], b[1], 0, -Math.PI / 2, 0)
  else context.lineTo(x + width, y)
  context.lineTo(x + width, y + height - c[1])
  if (c[0] && c[1])
    context.ellipse(x + width - c[0], y + height - c[1], c[0], c[1], 0, 0, Math.PI / 2)
  else context.lineTo(x + width, y + height)
  context.lineTo(x + d[0], y + height)
  if (d[0] && d[1])
    context.ellipse(x + d[0], y + height - d[1], d[0], d[1], 0, Math.PI / 2, Math.PI)
  else context.lineTo(x, y + height)
  context.lineTo(x, y + a[1])
  if (a[0] && a[1]) context.ellipse(x + a[0], y + a[1], a[0], a[1], 0, Math.PI, Math.PI * 1.5)
  else context.lineTo(x, y)
  context.closePath()
}

function canvasFor(width: number, height: number, ratio: number): HTMLCanvasElement | null {
  const pixelWidth = Math.ceil(width * ratio)
  const pixelHeight = Math.ceil(height * ratio)
  if (
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(pixelHeight) ||
    pixelWidth < 1 ||
    pixelHeight < 1 ||
    pixelWidth > 4096 ||
    pixelHeight > 4096 ||
    pixelWidth * pixelHeight > 2_000_000
  )
    return null
  const bitmap = document.createElement('canvas')
  bitmap.width = pixelWidth
  bitmap.height = pixelHeight
  return bitmap
}

function outerBounds(layers: readonly BoxShadowLayer[]) {
  const bounds = { left: 0, top: 0, right: 0, bottom: 0 }
  for (const shadow of layers) {
    const extent = Math.max(0, shadow.spread) + shadow.blur * 2 + 2
    bounds.left = Math.max(bounds.left, extent - shadow.offsetX)
    bounds.right = Math.max(bounds.right, extent + shadow.offsetX)
    bounds.top = Math.max(bounds.top, extent - shadow.offsetY)
    bounds.bottom = Math.max(bounds.bottom, extent + shadow.offsetY)
  }
  return bounds
}

function strokeColorSupported(context: CanvasRenderingContext2D, color: string): boolean {
  context.shadowColor = '#010203'
  context.shadowColor = color
  const first = context.shadowColor
  context.shadowColor = '#040506'
  context.shadowColor = color
  return first === context.shadowColor
}

/** Rasterize shadows into separate layers, leaving the original box paint untouched. */
export function paintBoxShadows(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
  ratio: number
): BoxShadowPaint {
  const parsed = parseBoxShadows(style.boxShadow, style.color)
  if (parsed.status !== 'ready') return parsed
  if (![width, height, ratio].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0)
    return { status: 'unsupported', reason: 'Invalid box-shadow geometry' }
  if (
    parsed.layers.some((shadow) =>
      [shadow.offsetX, shadow.offsetY, shadow.blur, shadow.spread].some(
        (value) => Math.abs(value) * ratio > 4096
      )
    )
  )
    return { status: 'unsupported', reason: 'Box-shadow geometry exceeds safe size' }

  const radii = boxRadii(style, width, height)
  const outerLayers = parsed.layers.filter((shadow) => !shadow.inset)
  const innerLayers = parsed.layers.filter((shadow) => shadow.inset)
  let outer: BoxShadowSprite | undefined
  let inset: BoxShadowSprite | undefined

  if (outerLayers.length) {
    const bounds = outerBounds(outerLayers)
    const bitmap = canvasFor(
      width + bounds.left + bounds.right,
      height + bounds.top + bounds.bottom,
      ratio
    )
    if (!bitmap) return { status: 'unsupported', reason: 'Box-shadow raster exceeds safe size' }
    const context = bitmap.getContext('2d')
    if (!context || typeof context.ellipse !== 'function')
      return { status: 'unsupported', reason: 'Box-shadow canvas unavailable' }
    context.scale(ratio, ratio)
    context.translate(bounds.left, bounds.top)
    for (const layer of [...outerLayers].reverse()) {
      if (!strokeColorSupported(context, layer.color))
        return { status: 'unsupported', reason: 'Box-shadow color unavailable in canvas' }
      const w = width + layer.spread * 2
      const h = height + layer.spread * 2
      if (w <= 0 || h <= 0) continue
      const jump = Math.ceil(
        width +
          height +
          bounds.left +
          bounds.right +
          bounds.top +
          bounds.bottom +
          Math.abs(layer.spread) * 2 +
          10
      )
      context.save()
      context.shadowColor = layer.color
      context.shadowBlur = layer.blur * ratio
      context.shadowOffsetX = (jump + layer.offsetX) * ratio
      context.shadowOffsetY = (jump + layer.offsetY) * ratio
      context.fillStyle = '#000'
      context.translate(-jump, -jump)
      context.beginPath()
      appendRoundedRect(
        context,
        -layer.spread,
        -layer.spread,
        w,
        h,
        adjustedRadii(radii, layer.spread, true)
      )
      context.fill()
      context.restore()
    }
    context.save()
    context.globalCompositeOperation = 'destination-out'
    context.beginPath()
    appendRoundedRect(context, 0, 0, width, height, radii)
    context.fill()
    context.restore()
    outer = {
      bitmap,
      offsetX: -bounds.left,
      offsetY: -bounds.top,
      width: bitmap.width / ratio,
      height: bitmap.height / ratio,
    }
  }

  if (innerLayers.length) {
    const bitmap = canvasFor(width, height, ratio)
    if (!bitmap) return { status: 'unsupported', reason: 'Box-shadow raster exceeds safe size' }
    const context = bitmap.getContext('2d')
    if (!context || typeof context.ellipse !== 'function')
      return { status: 'unsupported', reason: 'Box-shadow canvas unavailable' }
    const borders = [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].map((value) => Math.max(0, Number.parseFloat(value) || 0))
    const [top = 0, right = 0, bottom = 0, left = 0] = borders
    const w = Math.max(0, width - left - right)
    const h = Math.max(0, height - top - bottom)
    const paddingRadii = radii.map(
      ([rx, ry], index) =>
        [
          Math.max(0, rx - (index === 0 || index === 3 ? left : right)),
          Math.max(0, ry - (index < 2 ? top : bottom)),
        ] satisfies Radius
    )
    context.scale(ratio, ratio)
    if (w && h) {
      context.save()
      context.beginPath()
      appendRoundedRect(context, left, top, w, h, paddingRadii)
      context.clip()
      for (const layer of [...innerLayers].reverse()) {
        if (!strokeColorSupported(context, layer.color))
          return { status: 'unsupported', reason: 'Box-shadow color unavailable in canvas' }
        const margin = Math.ceil(
          Math.max(Math.abs(layer.offsetX), Math.abs(layer.offsetY)) +
            layer.blur * 2 +
            Math.abs(layer.spread) +
            4
        )
        const jump = Math.ceil(width + height + margin * 3 + 10)
        const holeWidth = Math.max(0, w - 2 * layer.spread)
        const holeHeight = Math.max(0, h - 2 * layer.spread)
        context.save()
        context.shadowColor = layer.color
        context.shadowBlur = layer.blur * ratio
        context.shadowOffsetX = (jump + layer.offsetX) * ratio
        context.shadowOffsetY = (jump + layer.offsetY) * ratio
        context.fillStyle = '#000'
        context.translate(-jump, -jump)
        context.beginPath()
        context.rect(left - margin, top - margin, w + 2 * margin, h + 2 * margin)
        if (holeWidth && holeHeight)
          appendRoundedRect(
            context,
            left + layer.spread,
            top + layer.spread,
            holeWidth,
            holeHeight,
            adjustedRadii(paddingRadii, -layer.spread, false)
          )
        context.fill('evenodd')
        context.restore()
      }
      context.restore()
    }
    inset = {
      bitmap,
      offsetX: 0,
      offsetY: 0,
      width: bitmap.width / ratio,
      height: bitmap.height / ratio,
    }
  }

  return { status: 'ready', ...(outer ? { outer } : {}), ...(inset ? { inset } : {}) }
}

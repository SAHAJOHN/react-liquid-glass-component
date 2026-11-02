import type { SceneColor } from './types'

export function splitCss(value: string, delimiter = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < value.length; i += 1) {
    const character = value[i]
    if (quote) {
      if (character === quote && value[i - 1] !== '\\') quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

export function createColorReader() {
  const cache = new Map<string, SceneColor>()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return (value: string): SceneColor => {
    const cached = cache.get(value)
    if (cached) return cached
    if (!context) throw new Error('Canvas color reader unavailable')
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const data = context.getImageData(0, 0, 1, 1).data
    const color: SceneColor = [
      (data[0] ?? 0) / 255,
      (data[1] ?? 0) / 255,
      (data[2] ?? 0) / 255,
      (data[3] ?? 0) / 255,
    ]
    cache.set(value, color)
    return color
  }
}

export function length(value: string, extent: number): number {
  return value.endsWith('%')
    ? (Number.parseFloat(value) * extent) / 100
    : Number.parseFloat(value) || 0
}

type Radius = readonly [number, number]
export function roundedPath(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  radii: readonly Radius[]
) {
  const [tl = [0, 0], tr = [0, 0], br = [0, 0], bl = [0, 0]] = radii
  const factor = Math.min(
    1,
    width / Math.max(1, tl[0] + tr[0]),
    width / Math.max(1, bl[0] + br[0]),
    height / Math.max(1, tl[1] + bl[1]),
    height / Math.max(1, tr[1] + br[1])
  )
  const [a, b, c, d] = [tl, tr, br, bl].map(([x, y]) => [x * factor, y * factor])
  if (!a || !b || !c || !d) return
  const ax = a[0] ?? 0,
    ay = a[1] ?? 0,
    bx = b[0] ?? 0,
    by = b[1] ?? 0
  const cx = c[0] ?? 0,
    cy = c[1] ?? 0,
    dx = d[0] ?? 0,
    dy = d[1] ?? 0
  context.beginPath()
  context.moveTo(ax, 0)
  context.lineTo(width - bx, 0)
  context.quadraticCurveTo(width, 0, width, by)
  context.lineTo(width, height - cy)
  context.quadraticCurveTo(width, height, width - cx, height)
  context.lineTo(dx, height)
  context.quadraticCurveTo(0, height, 0, height - dy)
  context.lineTo(0, ay)
  context.quadraticCurveTo(0, 0, ax, 0)
  context.closePath()
}

export function boxRadii(style: CSSStyleDeclaration, width: number, height: number): Radius[] {
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((value) => {
    const [x = '0', y = x] = value.split(/\s+/)
    return [length(x, width), length(y, height)]
  })
}

interface GradientStop {
  color: string
  offset?: number
}
function stops(parts: string[], extent: number): GradientStop[] | null {
  const result: GradientStop[] = []
  for (const part of parts) {
    const match = part.match(/^(.*?)(?:\s+(-?[\d.]+(?:%|px)))?(?:\s+(-?[\d.]+(?:%|px)))?$/)
    if (!match?.[1]) return null
    const color = match[1].trim()
    if (!CSS.supports('color', color)) return null
    const position = (value: string) =>
      value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value) / extent
    result.push(match[2] ? { color, offset: position(match[2]) } : { color })
    if (match[3]) result.push({ color, offset: position(match[3]) })
  }
  if (result.length < 2) return null
  const first = result[0],
    last = result[result.length - 1]
  if (!first || !last) return null
  first.offset ??= 0
  last.offset ??= 1
  let previous = 0
  for (let i = 1; i < result.length; i += 1) {
    const current = result[i]
    if (!current || current.offset === undefined) continue
    const start = result[previous]?.offset ?? 0
    current.offset = Math.max(start, current.offset)
    for (let j = previous + 1; j < i; j += 1) {
      const pending = result[j]
      if (pending)
        pending.offset = start + ((current.offset - start) * (j - previous)) / (i - previous)
    }
    previous = i
  }
  return result
}

export function paintGradient(
  context: CanvasRenderingContext2D,
  value: string,
  width: number,
  height: number
): boolean {
  const match = value.match(/^(linear|radial)-gradient\((.*)\)$/)
  if (!match?.[1] || !match[2]) return false
  const parts = splitCss(match[2])
  let extent = 1
  let gradient: CanvasGradient
  context.save()
  if (match[1] === 'linear') {
    let angle = Math.PI
    const first = parts[0] ?? ''
    if (/^-?[\d.]+(?:deg|rad|turn|grad)$/.test(first)) {
      const amount = Number.parseFloat(first)
      angle = first.endsWith('deg')
        ? (amount * Math.PI) / 180
        : first.endsWith('turn')
          ? amount * Math.PI * 2
          : first.endsWith('grad')
            ? (amount * Math.PI) / 200
            : amount
      parts.shift()
    } else if (first.startsWith('to ')) {
      const x = first.includes('right') ? 1 : first.includes('left') ? -1 : 0
      const y = first.includes('bottom') ? 1 : first.includes('top') ? -1 : 0
      if (!x && !y) {
        context.restore()
        return false
      }
      angle = Math.atan2(x * (y ? height : 1), -y * (x ? width : 1))
      parts.shift()
    }
    const x = Math.sin(angle),
      y = -Math.cos(angle)
    extent = Math.abs(width * x) + Math.abs(height * y)
    gradient = context.createLinearGradient(
      width / 2 - (x * extent) / 2,
      height / 2 - (y * extent) / 2,
      width / 2 + (x * extent) / 2,
      height / 2 + (y * extent) / 2
    )
  } else {
    let cx = width / 2,
      cy = height / 2
    let rx = Math.max(cx, width - cx) * Math.SQRT2,
      ry = Math.max(cy, height - cy) * Math.SQRT2
    const first = parts[0] ?? ''
    if (!CSS.supports('color', first.replace(/\s+-?[\d.]+(?:%|px).*$/, ''))) {
      parts.shift()
      const [shape = '', position] = first.split(/\s+at\s+/)
      if (position) {
        const [x = '50%', y = '50%'] = position.split(/\s+/)
        cx = positionValue(x, width)
        cy = positionValue(y, height)
      }
      const near = shape.includes('closest'),
        side = shape.includes('side')
      const dx = near ? Math.min(cx, width - cx) : Math.max(cx, width - cx)
      const dy = near ? Math.min(cy, height - cy) : Math.max(cy, height - cy)
      const sizes = shape.split(/\s+/).filter((token) => /^[\d.]+(?:px|%)$/.test(token))
      if (sizes.length) {
        rx = length(sizes[0] ?? '0', width)
        ry = length(sizes[1] ?? sizes[0] ?? '0', height)
      } else if (shape.includes('circle')) {
        rx = ry = side ? (near ? Math.min(dx, dy) : Math.max(dx, dy)) : Math.hypot(dx, dy)
      } else {
        rx = dx * (side ? 1 : Math.SQRT2)
        ry = dy * (side ? 1 : Math.SQRT2)
      }
    }
    if (rx <= 0 || ry <= 0) {
      context.restore()
      return true
    }
    extent = rx
    context.translate(cx, cy)
    context.scale(rx, ry)
    gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1)
  }
  const parsed = stops(parts, Math.max(extent, 1))
  if (!parsed) {
    context.restore()
    return false
  }
  try {
    for (const stop of parsed)
      gradient.addColorStop(Math.max(0, Math.min(1, stop.offset ?? 0)), stop.color)
    // The gradient records its transform at creation; restore before filling the box.
    context.restore()
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    return true
  } catch {
    context.restore()
    return false
  }
}

export function positionValue(value: string, extent: number): number {
  if (value === 'left' || value === 'top') return 0
  if (value === 'right' || value === 'bottom') return extent
  if (value === 'center') return extent / 2
  return length(value, extent)
}

export function backgroundUrl(value: string): string | null {
  const match = value.match(/^url\((['"]?)(.*?)\1\)$/)
  return match?.[2] ?? null
}

export function paintBox(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
  ratio: number,
  issues: Set<string>,
  images: ReadonlyMap<string, HTMLImageElement> = new Map()
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * ratio))
  canvas.height = Math.max(1, Math.ceil(height * ratio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Box canvas unavailable')
  context.scale(ratio, ratio)
  roundedPath(context, width, height, boxRadii(style, width, height))
  context.clip()
  context.fillStyle = style.backgroundColor
  context.fillRect(0, 0, width, height)
  const layers = splitCss(style.backgroundImage)
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index]
    if (!layer || layer === 'none') continue
    const source = backgroundUrl(layer)
    if (source) {
      const image = images.get(source)
      if (image) paintBackgroundImage(context, image, style, index, width, height, issues)
    } else if (!paintGradient(context, layer, width, height))
      issues.add(`Unsupported background image: ${layer.slice(0, 80)}`)
  }
  const borders = [
    {
      size: Number.parseFloat(style.borderTopWidth) || 0,
      color: style.borderTopColor,
      kind: style.borderTopStyle,
      rect: [0, 0, width, Number.parseFloat(style.borderTopWidth) || 0],
    },
    {
      size: Number.parseFloat(style.borderRightWidth) || 0,
      color: style.borderRightColor,
      kind: style.borderRightStyle,
      rect: [
        width - (Number.parseFloat(style.borderRightWidth) || 0),
        0,
        Number.parseFloat(style.borderRightWidth) || 0,
        height,
      ],
    },
    {
      size: Number.parseFloat(style.borderBottomWidth) || 0,
      color: style.borderBottomColor,
      kind: style.borderBottomStyle,
      rect: [
        0,
        height - (Number.parseFloat(style.borderBottomWidth) || 0),
        width,
        Number.parseFloat(style.borderBottomWidth) || 0,
      ],
    },
    {
      size: Number.parseFloat(style.borderLeftWidth) || 0,
      color: style.borderLeftColor,
      kind: style.borderLeftStyle,
      rect: [0, 0, Number.parseFloat(style.borderLeftWidth) || 0, height],
    },
  ]
  const firstBorder = borders[0]
  if (
    firstBorder &&
    firstBorder.size > 0 &&
    firstBorder.kind === 'solid' &&
    borders.every(
      (border) =>
        border.size === firstBorder.size &&
        border.kind === 'solid' &&
        border.color === firstBorder.color
    )
  ) {
    const inset = firstBorder.size / 2
    context.save()
    context.translate(inset, inset)
    const radii = boxRadii(style, width, height).map(
      ([x, y]) =>
        [Math.max(0, x - inset), Math.max(0, y - inset)] satisfies readonly [number, number]
    )
    roundedPath(
      context,
      Math.max(0, width - firstBorder.size),
      Math.max(0, height - firstBorder.size),
      radii
    )
    context.lineWidth = firstBorder.size
    context.strokeStyle = firstBorder.color
    context.stroke()
    context.restore()
    return canvas
  }
  if (
    borders.some((border) => border.size > 0) &&
    boxRadii(style, width, height).some(([x, y]) => x > 0 || y > 0)
  )
    issues.add('Unequal rounded borders require native HTML rendering')
  for (const border of borders) {
    if (!border.size || border.kind === 'none' || border.kind === 'hidden') continue
    if (border.kind !== 'solid') issues.add(`Unsupported border style: ${border.kind}`)
    const [x = 0, y = 0, w = 0, h = 0] = border.rect
    context.fillStyle = border.color
    context.fillRect(x, y, w, h)
  }
  return canvas
}

function paintBackgroundImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  style: CSSStyleDeclaration,
  index: number,
  width: number,
  height: number,
  issues: Set<string>
) {
  const layerValue = (value: string) => {
    const values = splitCss(value)
    return values[index % values.length] ?? ''
  }
  const size = layerValue(style.backgroundSize)
  let tileWidth = image.naturalWidth,
    tileHeight = image.naturalHeight
  if (!tileWidth || !tileHeight) return
  if (size === 'cover' || size === 'contain') {
    const scale =
      size === 'cover'
        ? Math.max(width / tileWidth, height / tileHeight)
        : Math.min(width / tileWidth, height / tileHeight)
    tileWidth *= scale
    tileHeight *= scale
  } else if (size !== 'auto' && size !== 'auto auto') {
    const [x = 'auto', y = 'auto'] = size.split(/\s+/)
    if (x !== 'auto') tileWidth = length(x, width)
    if (y !== 'auto') tileHeight = length(y, height)
    if (x === 'auto') tileWidth = (tileHeight * image.naturalWidth) / image.naturalHeight
    if (y === 'auto') tileHeight = (tileWidth * image.naturalHeight) / image.naturalWidth
  }
  if (tileWidth <= 0 || tileHeight <= 0) return
  const position = layerValue(style.backgroundPosition).split(/\s+/)
  if (position.length > 2) {
    issues.add('Four-value background-position requires native HTML rendering')
    return
  }
  const x = positionValue(position[0] ?? '0%', width - tileWidth),
    y = positionValue(position[1] ?? '0%', height - tileHeight)
  const repeat = layerValue(style.backgroundRepeat)
  if (repeat.includes('round') || repeat.includes('space')) {
    issues.add('Spaced or rounded background repeats require native HTML rendering')
    return
  }
  const repeatX = repeat === 'repeat' || repeat === 'repeat-x' || repeat.startsWith('repeat ')
  const repeatY = repeat === 'repeat' || repeat === 'repeat-y' || repeat.endsWith(' repeat')
  const startX = repeatX ? x - Math.ceil(x / tileWidth) * tileWidth : x
  const startY = repeatY ? y - Math.ceil(y / tileHeight) * tileHeight : y
  const columns = repeatX ? Math.ceil((width - startX) / tileWidth) : 1
  const rows = repeatY ? Math.ceil((height - startY) / tileHeight) : 1
  if (rows * columns > 10000) {
    issues.add('Background tiling exceeds the scene raster budget')
    return
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1)
      context.drawImage(
        image,
        startX + column * tileWidth,
        startY + row * tileHeight,
        tileWidth,
        tileHeight
      )
  }
}
